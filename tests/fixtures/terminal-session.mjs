import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { ZuvCodeRuntime } from "../../packages/orchestration/dist/index.js";
import { startInteractiveShell } from "../../apps/cli/dist/interactive.js";

const root = process.argv[2];
const model = "glassesglitchstudio/x_fable_coder:V1";
let proposalRound = 0;
let budgetGoal = false;
const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/api/tags") {
    await setTimeout(150);
    response.end(JSON.stringify({ models: [{ name: model }] }));
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  const messages = JSON.parse(body).messages;
  const input = messages.at(-1).content;
  const start = messages.findLastIndex((message) => message.role === "user");
  const task = messages[start]?.content;
  const system = messages[0]?.content ?? "";
  if (system.includes("PLANNING-ONLY")) {
    budgetGoal = task.includes("budget-check");
    proposalRound++;
    await setTimeout(120);
    response.end(JSON.stringify({ model, done: true, message: { content: "", tool_calls: [{ function: { name: "submit_plan", arguments: {
      proposal: proposalRound === 1 ? "Frontend will build the page. Backend will check the API contract. UI/UX will review the experience." : "Revised: the API returns an items array. Frontend and backend will use that contract, then UI/UX reviews it.",
      agents: [
        { name: "frontend", role: "Frontend developer", responsibilities: "Build the interface" },
        { name: "backend", role: "Backend developer", responsibilities: "Check integration" },
        { name: "ui-ux", role: "UI/UX designer", responsibilities: "Review the experience" }
      ], tasks: [
      { agent: "frontend", title: "Create team page", instructions: "Create team.html", depends_on: [], checks: ["Verify title"] },
      { agent: "backend", title: "Check integration", instructions: "Read team.html", depends_on: [1], checks: ["Verify contract"] },
      { agent: "ui-ux", title: "Verify team page", instructions: "Read team.html", depends_on: [1, 2], checks: ["Verify title"] }
    ] } } }] } }));
    return;
  }
  if (system.includes("TEAM_REVIEW") || system.includes("TEAM_REPLY")) {
    const reply = system.includes("TEAM_REPLY");
    const objection = !reply && proposalRound === 1 && system.includes("You are backend,");
    const who = system.includes("You are frontend,") ? "frontend" : system.includes("You are backend,") ? "backend" : "ui-ux";
    await setTimeout(450);
    response.end(JSON.stringify({ model, done: true, message: { content: "", tool_calls: [{ function: { name: reply ? "reply_message" : "review_plan", arguments: {
      approve: !objection, message: reply ? "Yes, use the agreed items array. The frontend contract is ready." : objection ? "Use an items array in the API response before implementing." : `${who} agrees. The responsibilities and checks are clear.`
    } } }] } }));
    return;
  }
  if (system.includes("named specialist")) {
    const completed = messages.filter((message) => message.role === "tool").length;
    const frontend = system.includes("named specialist frontend,");
    const designer = system.includes("named specialist ui-ux,");
    const budgetCall = frontend && completed === 0 && !existsSync(join(root, "budget.html"))
      ? { name: "write_file", arguments: { path: "budget.html", content: "<h1>Preserved across budget pause</h1>" } }
      : completed === 0 || (frontend && completed === 1 && !messages.some((message) => message.role === "tool" && message.tool_name === "read_file"))
        ? { name: "read_file", arguments: { path: "budget.html" } }
        : { name: "finish_task", arguments: { status: "complete", summary: designer ? "BUDGET TEAM VERIFIED" : "BUDGET TASK FINISHED" } };
    const fn = budgetGoal ? budgetCall : frontend && completed === 0 ? { name: "ask_agent", arguments: { to: "backend", message: "Can I render the items array using the agreed API contract?" } }
      : completed === (frontend ? 1 : 0) ? frontend ? { name: "write_file", arguments: { path: "team.html", content: "<h1>Specialist work</h1>" } }
        : { name: "read_file", arguments: { path: "team.html" } }
        : { name: "finish_task", arguments: { status: "complete", summary: designer ? "TEAM VERIFIED" : frontend ? "TEAM CREATED" : "BACKEND REVIEWED" } };
    await setTimeout(120);
    response.end(JSON.stringify({ model, done: true, message: { content: "", tool_calls: [{ function: fn }] } }));
    return;
  }
  if (["ask-check", "smart-check", "full-check"].includes(task)) {
    const result = messages.slice(start).find((message) => message.role === "tool");
    const fn = task === "ask-check" ? { name: "list_files", arguments: {} }
      : { name: "run_command", arguments: { command: task === "smart-check" ? "echo SMART_CHECK" : "node -e \"console.log('FULL_CHECK')\"", timeout_ms: 5000 } };
    response.end(JSON.stringify({ model, done: true, message: result
      ? { content: `${task}: ${JSON.parse(result.content).ok ? "PASSED" : "DENIED"}` }
      : { content: "", tool_calls: [{ function: fn }] } }));
    return;
  }
  if (task === "markdown") {
    response.end(JSON.stringify({ model, done: true, message: { content: "### Yapilanlar\n1. **Original quality:** Restored.\n2. **Production:** Verified locally.\n\n```js\nconst ready = true;\n```\n\n[Documentation](https://example.com/docs)" } }));
    return;
  }
  if (messages[start]?.content === "build-html") {
    const completed = messages.slice(start).filter((message) => message.role === "tool").length;
    const calls = [
      ["update_plan", { steps: ["Create HTML", "Read and verify the page"] }],
      ["write_file", { path: "index.html", content: "<!doctype html><h1>Hello</h1>" }],
      ["read_file", { path: "index.html" }],
      ["edit_file", { path: "index.html", old_text: "Hello", new_text: "ZuvCode" }],
      ["run_command", { command: "node -e \"console.log('VERIFIED')\"", timeout_ms: 5000 }]
    ];
    await setTimeout(120);
    const call = calls[completed];
    response.end(JSON.stringify({ model, done: true, message: call
      ? { content: "", tool_calls: [{ function: { name: call[0], arguments: call[1] } }] }
      : { content: "FILES READY: index.html" } }));
    return;
  }
  if (input === "hold") {
    response.on("close", () => response.destroy());
    return;
  }
  await setTimeout(100);
  response.end(JSON.stringify({ model, done: true, message: { content: `REPLY: ${input}` } }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const runtime = ZuvCodeRuntime.silent({ projectRoot: root, userConfigDir: join(root, "user-config") });
runtime.addProvider({ kind: "ollama", baseUrl: `http://127.0.0.1:${server.address().port}` });
try { await startInteractiveShell(runtime); }
finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
