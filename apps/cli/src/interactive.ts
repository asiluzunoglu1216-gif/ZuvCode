import readline from "node:readline";
import type { ZuvCodeRuntime } from "@zuvcode/orchestration";
import { askSecret, choose, runActivity, commandPrompt, helpText, renderCommandPalette, renderMarkdown, permissionChoices, permissionLabel, theme, plain, fit, terminalWidth, withTerminalSession } from "@zuvcode/terminal-ui";
import { renderDoctor, renderFileHistory, renderModels, renderProviders, renderTaskDetails, renderTasks, renderWelcome } from "./render.js";
import { connectProvider, pickModel } from "./connect.js";
import { handleTeam } from "./team.js";

export async function startInteractiveShell(runtime: ZuvCodeRuntime): Promise<void> {
  return withTerminalSession(() => interactiveShell(runtime));
}

async function interactiveShell(runtime: ZuvCodeRuntime): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const welcome = () => console.log(renderWelcome(runtime.doctor(), runtime.selectedModel()));
  const history: string[] = [];
  welcome();
  try {
    if (!interactive) {
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      try {
        for await (const line of rl) {
          if (await handleLine(runtime, line.trim(), false, welcome)) break;
        }
      } finally { rl.close(); }
      return;
    }
    while (true) {
      let line: string;
      try {
        line = await commandPrompt({ model: runtime.selectedModel(), mode: runtime.permissions.mode, history }, { clearPromptOnDone: true });
      } catch (error) {
        if (isExit(error)) break;
        throw error;
      }
      history.unshift(line);
      history.splice(200);
      console.log(`\n${theme.accent("> ")}${plain(line)}\n`);
      try {
        if (await handleLine(runtime, line, true, welcome)) break;
      } catch (error) {
        if (!isExit(error)) console.log(theme.error(`  ${plain(error instanceof Error ? error.message : String(error))}\n`));
      }
    }
  } finally { runtime.close(); process.stdin.pause(); }
}

async function handleLine(runtime: ZuvCodeRuntime, line: string, interactive: boolean, welcome: () => void): Promise<boolean> {
  if (!line) return false;
  if (!line.startsWith("/")) {
    if (!runtime.configuredProviders().length && interactive) await connectProvider(runtime);
    await runCodingRequest(runtime, line);
    return false;
  }
  const [command = "", ...parts] = line.slice(1).split(/\s+/);
  const args = parts.join(" ");
  if (command === "exit") return true;
  switch (command) {
    case "": console.log(renderCommandPalette()); break;
    case "help": console.log(helpText(args)); break;
    case "doctor": console.log(renderDoctor(runtime.doctor())); console.log(renderMarkdown(`### Tool access\n\n\`\`\`json\n${JSON.stringify(runtime.toolSecurityStatus(), null, 2)}\n\`\`\``)); break;
    case "clear":
      runtime.clearConversation();
      if (interactive) process.stdout.write("\x1b[2J\x1b[H");
      welcome();
      break;
    case "providers": console.log(renderProviders(runtime.listProviders())); break;
    case "connect":
      if (interactive) await connectProvider(runtime);
      else console.log("Use zuvcode provider:add --kind <kind> --base-url <url> for non-interactive setup.");
      break;
    case "model":
      if (!interactive) console.log(renderModels(await runtime.listModels()));
      else if (!args) await pickModel(runtime);
      else console.log(helpText("model"));
      break;
    case "team": await handleTeam(runtime, args, interactive); break;
    case "tasks":
      if (!args) console.log(renderTasks(runtime.listTasks(), runtime.listAgents()));
      else console.log(renderTaskDetails(runtime.findTask(args), runtime.listAgents()));
      break;
    case "skills": console.log(runtime.listSkills().map((skill) => plain(skill.name)).join("\n") || "  No project skills."); break;
    case "changes":
      if (parts[0] === "history" && parts.length <= 2) {
        console.log(renderFileHistory(await runtime.fileCheckpoints(), parts[1] ? Number(parts[1]) : 1));
      } else if (parts[0] === "recover" && parts.length === 2) {
        console.log(`  Recovery copy: ${plain(await runtime.recoverFiles(parts[1]!))}\n  Your working files were not overwritten.\n`);
      } else if (args) console.log(helpText("changes"));
      else {
        console.log(runtime.fileChanges().map((change) => `  ${change.action}  ${plain(change.path)}  (${change.bytes} bytes)`).join("\n") || "  No file changes in this session.");
        console.log("\n  /changes history shows persistent file checkpoints.\n");
      }
      break;
    case "web": {
      const mode = args || (interactive ? await choose({ title: `Web: ${runtime.webStatus()}`, choices: [
        { value: "default", name: "DuckDuckGo", description: "No API key" },
        { value: "google", name: "Google", description: "Serper API key" },
        { value: "on", name: "Enable web research" }, { value: "off", name: "Disable web research" }
      ] }, { clearPromptOnDone: true }) : "");
      if (mode === "google") {
        if (!interactive) { console.log("  Set SERPER_API_KEY before starting ZuvCode, or use /web google interactively."); break; }
        console.log("  Google search via Serper: https://serper.dev\n");
        runtime.configureWeb("google", await askSecret("Serper API key"));
      } else if (mode && ["on", "off", "default"].includes(mode)) runtime.configureWeb(mode as "on" | "off" | "default");
      else if (mode) { console.log("  /web [on|off|google|default]"); break; }
      console.log(`  Web: ${runtime.webStatus()}\n`);
      break;
    }
    case "permissions": {
      const shortcuts: Record<string, "SAFE" | "BALANCED" | "FULL_ACCESS"> = { ask: "SAFE", smart: "BALANCED", full: "FULL_ACCESS" };
      if (args && !shortcuts[args]) { console.log("  /permissions [ask|smart|full]"); break; }
      const selected = args ? shortcuts[args] : interactive ? await choose({
        title: `Permissions: ${permissionLabel(runtime.permissions.mode)}`,
        choices: permissionChoices.map((choice) => ({ ...choice }))
      }, { clearPromptOnDone: true }) : undefined;
      if (selected) runtime.setPermissionMode(selected as "SAFE" | "BALANCED" | "FULL_ACCESS");
      const mode = runtime.permissions.mode;
      console.log(`  Permissions: ${permissionLabel(mode)}\n`);
      if (mode === "FULL_ACCESS") console.log(theme.error("  No approval prompts. Destructive cleanup guard remains on. OS-user access, not a sandbox.\n"));
      break;
    }
    default: console.log(`  Unknown command: /${plain(command)}. Use /help.`);
  }
  return false;
}

export async function runCodingRequest(runtime: ZuvCodeRuntime, text: string): Promise<void> {
  const response = await runActivity((signal, callbacks) => runtime.chat(text, signal, callbacks));
  const heading = fit(`${theme.accent("  ZuvCode")} ${theme.muted(plain(response.model))}`, terminalWidth());
  console.log(`${heading}\n\n${renderMarkdown(response.text)}\n`);
}

function isExit(error: unknown): boolean {
  return error instanceof Error && ["ExitPromptError", "AbortPromptError"].includes(error.name);
}
