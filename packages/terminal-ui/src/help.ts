import { section, table } from "./format.js";

export interface SlashCommandItem {
  command: string;
  summary: string;
  group: "Core" | "Models" | "Agents" | "Project" | "Safety";
  usage?: string;
  acceptsArguments?: boolean;
}

export const slashCommandItems: SlashCommandItem[] = [
  { command: "/connect", summary: "Connect a provider", group: "Models" },
  { command: "/model", summary: "Select, add or refresh models", group: "Models", usage: "Open the model menu for Auto, manual IDs and refresh." },
  { command: "/providers", summary: "View provider connections", group: "Models" },
  { command: "/team", summary: "Discuss and implement with specialists", group: "Agents", acceptsArguments: true,
    usage: "/team <goal> starts team work. /team opens conversation, resume, retry, agent models and Work budget. Shortcuts: /team chat, /team resume, /team retry <task-id>." },
  { command: "/tasks", summary: "View tasks and results", group: "Agents", acceptsArguments: true, usage: "/tasks lists tasks. /tasks <id> shows details. Resume or retry from /team." },
  { command: "/changes", summary: "View changes and recover file history", group: "Project", acceptsArguments: true, usage: "/changes shows this session's edits. /changes history [page] lists saved checkpoints. /changes recover <id> exports a recovery copy without overwriting working files." },
  { command: "/skills", summary: "List project skill files", group: "Project" },
  { command: "/web", summary: "Choose or disable web search", group: "Core", usage: "/web opens settings. Shortcuts: /web on, off, google, default." },
  { command: "/permissions", summary: "Choose approval mode", group: "Safety", usage: "/permissions opens settings. Shortcuts: /permissions ask, smart, full." },
  { command: "/doctor", summary: "Inspect project, runtime and tool access", group: "Core" },
  { command: "/clear", summary: "Clear the current conversation", group: "Core" },
  { command: "/help", summary: "Show command reference", group: "Core" },
  { command: "/exit", summary: "Close ZuvCode", group: "Core" }
];

export const slashCommands = slashCommandItems.map((item) => item.command);

export function commandName(item: SlashCommandItem): string {
  return item.command;
}

export function filterCommands(input: string): SlashCommandItem[] {
  const query = input.trimStart().replace(/^\//, "").toLowerCase();
  return slashCommandItems.filter((item) => commandName(item).slice(1).startsWith(query));
}

export function renderCommandPalette(filter = ""): string {
  return section("Commands", table(["Command", "Description"],
    filterCommands(filter).map((item) => [item.command, item.summary])));
}

export function helpText(command?: string): string {
  if (!command) return renderCommandPalette();
  const normalized = command.replace(/^\//, "");
  const item = slashCommandItems.find((entry) => commandName(entry) === `/${normalized}`);
  return item ? `${item.command}  ${item.summary}${item.usage ? `\n${item.usage}` : ""}` : `Unknown command: /${normalized}`;
}
