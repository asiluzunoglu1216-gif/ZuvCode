import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import pty from "node-pty";
import xterm from "@xterm/headless";
import { DatabaseSync } from "node:sqlite";
import { FileHistory } from "../packages/tools/dist/index.js";

const captures = resolve(".tmp-terminal-captures");
mkdirSync(captures, { recursive: true });
const fixture = resolve("tests/fixtures/terminal-session.mjs");

for (const [cols, rows] of [[100, 36], [42, 26]]) {
  const root = mkdtempSync(resolve(".tmp-native-terminal-"));
  const terminal = new xterm.Terminal({ cols, rows, allowProposedApi: true, scrollback: 1000 });
  const child = pty.spawn(process.execPath, [fixture, root], {
    name: "xterm-256color", cols, rows, cwd: process.cwd(),
    env: { ...process.env, TERM: "xterm-256color", FORCE_COLOR: "3", NO_COLOR: "" }
  });
  let exited = false;
  let exitCode;
  let raw = "";
  const exit = new Promise((done) => child.onExit((event) => { exited = true; exitCode = event.exitCode; done(); }));
  child.onData((data) => {
    raw += data;
    terminal.write(data);
    // ConPTY can ask for the initial cursor position during console setup.
    if (data.includes("\x1b[6n")) child.write("\x1b[1;1R");
  });
  const screen = () => Array.from({ length: rows }, (_, y) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + y)?.translateToString(true) ?? "").join("\n");
  const cursorLine = () => (terminal.buffer.active.getLine(terminal.buffer.active.baseY + terminal.buffer.active.cursorY)?.translateToString(true) ?? "").trimEnd();
  const ready = () => cursorLine() === ">";
  const wait = async (predicate, label, timeout = 6000) => {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (exited || Date.now() > deadline) throw new Error(`${cols} columns: ${label}\n${screen()}`);
      await setTimeout(25);
    }
    await setTimeout(30);
  };
  const capture = (name) => {
    writeFileSync(join(captures, `${cols}-${name}.txt`), screen());
    const lines = [];
    for (let y = 0; y < rows; y++) {
      const line = terminal.buffer.active.getLine(terminal.buffer.active.viewportY + y);
      const cells = [];
      for (let x = 0; x < cols; x++) {
        const cell = line?.getCell(x);
        cells.push({ text: cell?.getChars() || " ", color: cell?.isFgRGB() ? cell.getFgColor() : 0xcfcfcf, bold: Boolean(cell?.isBold()) });
      }
      lines.push(cells);
    }
    writeFileSync(join(captures, `${cols}-${name}.json`), JSON.stringify(lines));
  };
  try {
    await wait(ready, "initial input");
    capture("welcome");
    for (const provider of ["Gemini", "NVIDIA"]) {
      child.write("/connect\r");
      await wait(() => screen().includes("Connect a provider") && screen().includes("Search:"), "connection picker");
      child.write(provider);
      await wait(() => screen().includes(provider === "Gemini" ? "Google Gemini" : "NVIDIA Build"), `${provider} preset search`);
      capture(`connect-${provider.toLowerCase()}`);
      child.write("\x1b");
      await wait(ready, "input restored after cancelling connection picker");
    }
    child.write("/model\r");
    await wait(() => screen().includes("Select model") && screen().includes("Search:"), "model discovery and picker");
    child.write("glasses");
    await wait(() => screen().includes("Search: glasses"), "picker search");
    child.write("\r");
    await wait(ready, "input after model selection");
    child.write("merhaba");
    await wait(() => cursorLine() === "> merhaba", "typing immediately after asynchronous model discovery");
    capture("typing");
    child.write("\r");
    await wait(() => screen().includes("REPLY: merhaba") && ready(), "model response and next input");
    for (let i = 0; i < 3; i++) {
      child.write(`message-${i}`);
      await wait(() => cursorLine() === `> message-${i}`, "typing after chat");
      child.write("\r");
      await wait(() => screen().includes(`REPLY: message-${i}`) && ready(), "repeated response");
    }
    child.write("markdown\r");
    await wait(() => screen().includes("Production:") && ready(), "formatted Markdown response");
    assert.ok(!screen().includes("**Production"));
    assert.ok(!screen().includes("### Yapilanlar"));
    const productionRow = Array.from({ length: rows }, (_, y) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + y))
      .find((line) => line?.translateToString(true).includes("Production:"));
    const productionColumn = productionRow.translateToString(true).indexOf("Production:");
    assert.ok(productionRow.getCell(productionColumn).isBold(), "Markdown strong text must be bold in the terminal buffer");
    capture("markdown");
    child.write("ask-check\r");
    await wait(() => screen().includes("Approval required"), "default mode asks before listing files");
    child.write("\r");
    await wait(() => screen().includes("ask-check: DENIED") && ready(), "default denial");
    child.write("/permissions\r");
    await wait(() => screen().includes("Ask Every Time") && screen().includes("Full Access") && screen().includes("Search:"), "permission chooser");
    capture("permissions");
    child.write("Smart\r");
    await wait(() => screen().includes("Permissions: Smart") && ready(), "Smart mode selection");
    child.write("smart-check\r");
    await wait(() => screen().includes("smart-check: PASSED") && ready(), "Smart command runs without approval");
    child.write("build-html\r");
    await wait(() => screen().includes("Approval required"), "live file tools and command approval");
    capture("approval");
    assert.equal(readFileSync(join(root, "index.html"), "utf8"), "<!doctype html><h1>ZuvCode</h1>");
    child.write("\x1b[C\r");
    await wait(() => screen().includes("FILES READY") && ready(), "approved command and agent completion");
    capture("agent-done");
    child.write("/changes\r");
    await wait(() => screen().includes("modified  index.html") && ready(), "changed file list");
    child.write("/permissions full\r");
    await wait(() => screen().includes("Permissions: Full Access") && ready(), "Full Access selection");
    child.write("full-check\r");
    await wait(() => screen().includes("full-check: PASSED") && ready(), "Full Access executes arbitrary command without approval");
    capture("full-access");
    const beforeTeam = new DatabaseSync(join(root, ".zuvcode", "state.db"), { readOnly: true });
    try { assert.equal(beforeTeam.prepare("SELECT count(*) AS count FROM agents").get().count, 0, "ordinary chat must not start a team"); }
    finally { beforeTeam.close(); }
    child.write("/team build frontend backend and ui-ux\r");
    await wait(() => screen().includes("Use an items array"), "live peer objection", 15000);
    capture("team-discussion");
    const unapproved = new DatabaseSync(join(root, ".zuvcode", "state.db"), { readOnly: true });
    try { assert.equal(unapproved.prepare("SELECT count(*) AS count FROM tasks").get().count, 0, "no tasks may execute before agreement"); }
    finally { unapproved.close(); }
    await wait(() => screen().includes("TEAM VERIFIED") && ready(), "discussion, agreement and specialist execution", 15000);
    const state = new DatabaseSync(join(root, ".zuvcode", "state.db"), { readOnly: true });
    let taskId;
    try { taskId = state.prepare("SELECT id FROM tasks WHERE title = 'Verify team page'").get().id; }
    finally { state.close(); }
    assert.equal(readFileSync(join(root, "team.html"), "utf8"), "<h1>Specialist work</h1>");
    capture("team-done");
    child.write(`/tasks ${taskId.slice(-8)}\r`);
    await wait(() => screen().includes("Result:") && screen().includes("TEAM VERIFIED") && ready(), "persisted task detail");
    capture("task-detail");
    child.write("/team\r");
    await wait(() => screen().includes("Agent models") && screen().includes("Search:"), "team menu");
    child.write("Agent models\r");
    await wait(() => screen().includes("frontend") && screen().includes("Search:"), "team member picker");
    child.write("frontend\r");
    await wait(() => screen().includes("Model for frontend") && screen().includes("Search:"), "agent model picker");
    child.write("glasses\r");
    await wait(ready, "input after agent model selection");
    child.write("/team chat\r");
    await wait(() => screen().includes("TEAM VERIFIED") && ready(), "persisted team conversation");
    capture("team-chat");
    child.write("/team\r");
    await wait(() => screen().includes("Work budget") && screen().includes("Search:"), "work budget in team menu");
    child.write("Work budget\r");
    await wait(() => screen().includes("Extended") && screen().includes("Search:"), "work budget picker");
    capture("work-budget");
    child.write("Custom\r");
    await wait(() => screen().includes("Model turns per task"), "custom work budget input");
    child.write("2\r");
    await wait(() => screen().includes("Work budget: 2") && ready(), "custom budget saved and input restored");
    child.write("/team budget-check\r");
    await wait(() => screen().includes("TEAM INCOMPLETE") && ready(), "budget pause reports an unfinished application", 15000);
    capture("team-incomplete");
    assert.equal(readFileSync(join(root, "budget.html"), "utf8"), "<h1>Preserved across budget pause</h1>");
    child.write("/team\r");
    await wait(() => screen().includes("Work budget") && screen().includes("Search:"), "budget menu after interrupted team");
    child.write("Work budget\r");
    await wait(() => screen().includes("Extended") && screen().includes("Search:"), "reopen work budget picker");
    child.write("Extended\r");
    await wait(() => screen().includes("Work budget: 300") && ready(), "extended budget and keyboard restored");
    child.write("/team resume\r");
    await wait(() => screen().includes("TEAM TASKS COMPLETE") && ready(), "explicit resume completes remaining work", 15000);
    capture("team-resumed");
    assert.equal(readFileSync(join(root, "budget.html"), "utf8"), "<h1>Preserved across budget pause</h1>");
    child.write("/changes history\r");
    await wait(() => screen().includes("recover <id>") && ready(), "persistent checkpoint listing");
    capture("file-history");
    const checkpoints = await FileHistory.forUser(root, join(root, "user-config")).list();
    const checkpoint = checkpoints.find((item) => item.files.some((file) => file.path === "budget.html"));
    assert.ok(checkpoint);
    child.write(`/changes recover ${checkpoint.id.slice(0, 8)}\r`);
    await wait(() => screen().includes("not overwritten") && ready(), "checkpoint export and input recovery");
    capture("file-recovered");
    assert.equal(readFileSync(join(root, "budget.html"), "utf8"), "<h1>Preserved across budget pause</h1>");
    child.write("/permissions ask\r");
    await wait(() => screen().includes("Permissions: Ask Every Time") && ready(), "return to Ask Every Time");
    child.write("/model\r");
    await wait(() => screen().includes("Select model"), "reopening picker");
    child.write("\x1b");
    await wait(ready, "input after cancelling picker");
    child.write("hold\r");
    await wait(() => screen().includes("Thinking"), "pending request");
    child.write("\x1b");
    await wait(ready, "input after cancelling request");
    child.write("/m");
    await wait(() => screen().includes("1 command"), "deduplicated slash filtering after cancellation");
    child.write("\x1b");
    await wait(() => !screen().includes("1 command") && cursorLine() === "> /m", "dismissing slash menu");
    child.write("\x15");
    await wait(ready, "clearing draft with Ctrl+U");
    child.write("final-message");
    await wait(() => cursorLine() === "> final-message", "typing after cancelling slash menu");
    child.write("\r");
    await wait(() => screen().includes("REPLY: final-message") && ready(), "final response");
    child.write("/exit\r");
    await Promise.race([exit, setTimeout(4000).then(() => { if (!exited) throw new Error("CLI did not exit"); })]);
    assert.equal(exitCode, 0);
    console.log(`PASS ${cols}x${rows}: live team discussion, agreement, peer questions, work budget picker, incomplete report, resume, file history/recovery, roles/models, 13 commands, files, cancellation, exit`);
  } finally {
    writeFileSync(join(captures, `${cols}-raw.ansi`), raw);
    if (!exited) { child.kill(); await Promise.race([exit, setTimeout(2000)]); }
    terminal.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

// All CLI children have exited; release node-pty's remaining Windows pipe workers.
process.exit(0);
