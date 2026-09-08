import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { ZuvCodeRuntime } from "@zuvcode/orchestration";
import { redactSecrets, teamPlanSchema } from "@zuvcode/shared";
import type { AgentProgress } from "../packages/protocol/dist/index.js";

interface Message { role: string; content: string; tool_calls?: Array<Record<string, unknown>> }
interface Request { model: string; messages: Message[]; tools?: Array<{ function: { name: string } }> }
type Reply = { status?: number; content?: string; call?: { name: string; args: unknown } };
const action = (name: string, args: unknown): Reply => ({ call: { name, args } });
const finish = (status = "complete", summary = "Verified task result.") => action("finish_task", { status, summary });
const plan = (tasks = [
  { agent: "coder", title: "Build the page", instructions: "Create team.html with a title", checks: ["Read the generated HTML"], depends_on: [] as number[] },
  { agent: "tester", title: "Verify the page", instructions: "Read team.html and verify its title", checks: ["Read the page"], depends_on: [1] }
]) => action("submit_plan", { proposal: "Coder builds the page, then tester verifies the result.", agents: [
  { name: "coder", role: "Developer", responsibilities: "Implement the page" },
  { name: "tester", role: "Tester", responsibilities: "Check the resulting page" }
], tasks });
const toolMessages = (request: Request) => request.messages.filter((message) => message.role === "tool");

async function fixture(handler: (request: Request, index: number) => Reply | Promise<Reply>, autoReview = true) {
  mkdirSync(".tmp-tests", { recursive: true });
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "team-flow-"));
  const requests: Request[] = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    try {
      const request = JSON.parse(text) as Request;
      requests.push(request);
      const reply = autoReview && request.messages[0]?.content.includes("TEAM_REVIEW")
        ? action("review_plan", { approve: true, message: "I agree with this scope and the handoff." })
        : await handler(request, requests.length - 1);
      res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.status ? { error: reply.content } : { choices: [{ finish_reason: reply.call ? "tool_calls" : "stop", message: {
        content: reply.content ?? "", ...(reply.call ? { tool_calls: [{ id: "reused-call-id", type: "function", function: {
          name: reply.call.name, arguments: JSON.stringify(reply.call.args)
        }, extra_content: { google: { thought_signature: "opaque-team-signature" } } }] } : {})
      } }] }));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  let runtime = ZuvCodeRuntime.silent({ projectRoot: root, permissionMode: "BALANCED" });
  runtime.addProvider({ kind: "openai-compatible", name: "Fixture", baseUrl: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}` });
  runtime.selectModel(runtime.addModel({ providerName: "Fixture", modelId: "custom-coder" }));
  return { root, requests, get runtime() { return runtime; }, restart() {
    runtime.close(); runtime = ZuvCodeRuntime.silent({ projectRoot: root, permissionMode: "BALANCED" }); return runtime;
  }, async cleanup() {
    runtime.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  } };
}

describe("real specialist agents", () => {
  it("recovers from malformed write arguments without poisoning completion or the next worker", async () => {
    const context = await fixture((request) => {
      const system = request.messages[0]!.content;
      if (system.includes("PLANNING-ONLY")) return plan();
      if (system.includes("named specialist coder,")) return [
        action("write_file", {}), finish(),
        action("write_file", { path: "team.html", content: "<h1>Preserved</h1>" }),
        action("write_file", { path: "test.js", content: "console.log('test')" }),
        action("run_command", { command: "node -e \"require('fs').unlinkSync('test.js')\"" }),
        action("edit_file", { path: "team.html", old_text: "not there", new_text: "unused" }),
        action("write_file", {}), finish()
      ][toolMessages(request).length] ?? finish();
      return toolMessages(request).length ? finish() : action("read_file", { path: "team.html" });
    });
    try {
      context.runtime.setPermissionMode("FULL_ACCESS");
      const results = await context.runtime.runTeam("Build and verify a page; keep all files");
      expect(results.map((t) => t.status)).toEqual(["complete", "complete"]);
      expect(readFileSync(join(context.root, "test.js"), "utf8")).toContain("console.log");
      expect(context.requests.some((r) => r.messages.some((m) => m.content.includes("no successful tool work")))).toBe(true);
      expect((await context.runtime.fileCheckpoints()).some((r) => r.files.some((f) => f.path === "test.js"))).toBe(true);
    } finally { await context.cleanup(); }
  });

  it("creates distinct names and only the specialists selected for the job", async () => {
    const context = await fixture(() => plan());
    try {
      expect(context.runtime.createAgent("code").name).toBe("code");
      expect(context.runtime.createAgent("coder").name).toBe("coder");
      expect(context.runtime.createAgent("CODE").id).toBe(context.runtime.createAgent("code").id);
      expect(() => context.runtime.createAgent("../bad")).toThrow("Agent names");
      await context.runtime.planTeam("Build a page");
      expect(context.runtime.listAgents().map((agent) => agent.name)).toEqual(expect.arrayContaining(["code", "coder", "orchestrator", "tester"]));
      expect(context.runtime.listAgents().some((agent) => agent.name === "architect")).toBe(false);
    } finally { await context.cleanup(); }
  });

  it("executes an assigned task with a separate configured model, actual files and persisted results", async () => {
    const context = await fixture((request) => toolMessages(request).length === 0
      ? action("write_file", { path: "named.html", content: "<h1>Named worker</h1>" }) : finish("complete", "Created named.html."));
    try {
      context.runtime.createAgent("frontend");
      context.runtime.addModel({ providerName: "Fixture", modelId: "custom-designer" });
      context.runtime.setAgentModel("frontend", "Fixture/custom-designer");
      const task = await context.runtime.runNamedAgent("frontend", "Create named.html");
      expect(task.status).toBe("complete");
      expect(task.attempts).toBe(1);
      expect(task.modelUsed).toBe("custom-designer");
      expect(task.generatedFiles).toEqual(["named.html"]);
      expect(task.completionEvidence.join(" ")).toContain("OK: write_file");
      expect(readFileSync(join(context.root, "named.html"), "utf8")).toContain("Named worker");
      expect(context.runtime.fileChanges()).toHaveLength(1);
      expect(context.runtime.listAgents()[0]).toMatchObject({ status: "idle" });
      expect(context.runtime.listAgents()[0]?.currentTaskId).toBeUndefined();
      expect(context.runtime.selectedModel()).toBe("Fixture/custom-coder");
      expect(context.requests[0]?.messages[0]?.content).toContain("named specialist frontend");
      const assistant = context.requests[1]?.messages.find((message) => message.role === "assistant");
      expect(assistant?.tool_calls?.[0]?.extra_content).toEqual({ google: { thought_signature: "opaque-team-signature" } });
      context.restart();
      expect(context.runtime.findTask(task.id.slice(-8)).resultText).toBe("Created named.html.");
      expect(context.runtime.listAgents()[0]?.selectedModel).toBe("Fixture/custom-designer");
      await expect(context.runtime.runTask(task.id)).rejects.toThrow("already complete");
    } finally { await context.cleanup(); }
  });

  it("plans without writes, runs specialists in separate contexts, passes prerequisite results and resumes without repeating completed work", async () => {
    const events: AgentProgress[] = [];
    const context = await fixture((request) => {
      const system = request.messages[0]!.content;
      if (system.includes("PLANNING-ONLY")) return plan();
      if (system.includes("named specialist coder,")) return toolMessages(request).length === 0
        ? action("write_file", { path: "team.html", content: "<h1>Team</h1>" }) : finish("complete", "CODER_HANDOFF: team.html created.");
      return toolMessages(request).length === 0 ? action("read_file", { path: "team.html" }) : finish("complete", "Tester verified the page.");
    });
    try {
      const tasks = await context.runtime.planTeam("Make and verify a page");
      expect(tasks).toHaveLength(2);
      expect(tasks[1]?.dependencies).toEqual([tasks[0]!.id]);
      expect(existsSync(join(context.root, "team.html"))).toBe(false);
      await expect(context.runtime.runTask(tasks[1]!.id)).rejects.toThrow("Prerequisite");
      context.restart();
      const results = await context.runtime.runSavedPlan(undefined, { onProgress: (event) => events.push(event) });
      expect(results.map((task) => task.status)).toEqual(["complete", "complete"]);
      const tester = context.requests.find((request) => request.messages[0]?.content.includes("named specialist tester,"));
      expect(tester?.messages).toHaveLength(2);
      expect(tester?.messages[1]?.content).toContain("CODER_HANDOFF");
      const coder = context.requests.find((request) => request.messages[0]?.content.includes("named specialist coder,"));
      expect(coder?.messages).toHaveLength(2);
      expect(coder?.messages[1]?.content).not.toContain("CODER_HANDOFF");
      expect(new Set(events.filter((event) => event.kind === "tool_start").map((event) => event.callId)).size).toBe(2);
      const before = context.requests.length;
      await context.runtime.runSavedPlan();
      expect(context.requests.length).toBe(before);
      expect(context.runtime.listTasks().map((task) => task.attempts)).toEqual([1, 1]);
    } finally { await context.cleanup(); }
  });

  it("rejects cyclic/forward dependencies and unknown owners without persisting a partial plan", async () => {
    expect(teamPlanSchema.safeParse({ tasks: [{ agent: "coder", title: "x", instructions: "x", depends_on: [1] }] }).success).toBe(false);
    expect(teamPlanSchema.safeParse({ tasks: Array.from({ length: 9 }, () => ({ agent: "coder", title: "x", instructions: "x" })) }).success).toBe(false);
    const context = await fixture((_request, index) => index === 0
      ? plan([{ agent: "missing", title: "bad", instructions: "bad", checks: [], depends_on: [] }]) : { content: "Done" });
    try {
      await expect(context.runtime.planTeam("Build a page")).rejects.toThrow("structured result");
      expect(context.runtime.listTasks()).toEqual([]);
      expect(context.runtime.store.getSetting("lastTeamPlan")).toBeUndefined();
      expect(context.requests[1]?.messages.at(-1)?.content).toContain("declared specialist");
      expect(context.runtime.listAgents().every((agent) => agent.status === "idle")).toBe(true);
    } finally { await context.cleanup(); }
  });

  it("prevents a planning model from executing hidden write tools", async () => {
    const context = await fixture((_request, index) => index === 0 ? action("write_file", { path: "forbidden.txt", content: "bad" }) : plan());
    try {
      await context.runtime.planTeam("Plan a page");
      expect(existsSync(join(context.root, "forbidden.txt"))).toBe(false);
      expect(context.requests[1]?.messages.at(-1)?.content).toContain("not available");
    } finally { await context.cleanup(); }
  });

  it("honours approval denial and refuses a false completion", async () => {
    const context = await fixture((_request, index) => index === 0
      ? action("write_file", { path: "denied.html", content: "bad" }) : index === 1 ? finish() : finish("blocked", "Permission denied."));
    const approve = vi.fn(async () => false);
    try {
      context.runtime.setPermissionMode("SAFE"); context.runtime.createAgent("coder");
      const task = await context.runtime.runNamedAgent("coder", "Create HTML", undefined, { approve });
      expect(task.status).toBe("blocked");
      expect(existsSync(join(context.root, "denied.html"))).toBe(false);
      expect(approve.mock.calls[0]).toEqual([expect.stringContaining("Agent: coder")]);
      expect(context.requests[2]?.messages.at(-1)?.content).toContain("Cannot mark complete");
    } finally { await context.cleanup(); }
  });

  it("cancels pending approval, preserves completed files and releases the execution lock", async () => {
    const context = await fixture((_request, index) => index === 0
      ? action("write_file", { path: "preserved.html", content: "kept" }) : index === 1
        ? action("run_command", { command: "node -e \"console.log('not-run')\"" }) : { content: "Ready after cancellation" });
    const controller = new AbortController();
    try {
      context.runtime.createAgent("coder");
      await expect(context.runtime.runNamedAgent("coder", "Build a page", controller.signal, { approve: async () => {
        controller.abort(new Error("cancelled")); return false;
      } })).rejects.toThrow("cancelled");
      expect(context.runtime.listTasks()[0]).toMatchObject({ status: "cancelled", generatedFiles: ["preserved.html"] });
      expect(readFileSync(join(context.root, "preserved.html"), "utf8")).toBe("kept");
      expect(context.runtime.listAgents()[0]?.status).toBe("idle");
      expect((await context.runtime.chat("hello")).text).toBe("Ready after cancellation");
    } finally { await context.cleanup(); }
  });

  it("stops the team after a failed worker, retains the queue and supports an explicit retry", async () => {
    let retry = false;
    const context = await fixture((request) => {
      if (request.messages[0]?.content.includes("PLANNING-ONLY")) return plan();
      if (!retry) return { content: "I stopped without finishing" };
      if (!toolMessages(request).length) return action("write_file", { path: "retry.txt", content: "fixed" });
      return finish();
    });
    try {
      const tasks = await context.runtime.runTeam("Build and verify");
      expect(tasks.map((task) => task.status)).toEqual(["failed", "queued"]);
      expect(tasks[0]?.resultText).toContain("structured result");
      expect(tasks[1]?.attempts).toBe(0);
      retry = true;
      const task = await context.runtime.runTask(tasks[0]!.id);
      expect(task.status).toBe("complete"); expect(task.attempts).toBe(2);
    } finally { await context.cleanup(); }
  });

  it("does not mark a failed command complete and can recover after the exact command passes", async () => {
    const command = "node -e \"const fs=require('fs'); process.exit(fs.existsSync('fix.txt') ? 0 : 1)\"";
    const context = await fixture((_request, index) => [action("run_command", { command }), finish(),
      action("write_file", { path: "fix.txt", content: "fixed" }), action("run_command", { command }), finish()][index] ?? finish());
    try {
      context.runtime.setPermissionMode("FULL_ACCESS"); context.runtime.createAgent("tester");
      const task = await context.runtime.runNamedAgent("tester", "Run checks and fix failure");
      expect(context.requests[2]?.messages.at(-1)?.content).toContain("Cannot mark complete");
      expect(task.status).toBe("complete");
      expect(task.completionEvidence.join(" ")).toContain('"exitCode":1');
      expect(task.completionEvidence.join(" ")).toContain('"exitCode":0');
    } finally { await context.cleanup(); }
  });

  it("supports JSON tool compatibility for named workers", async () => {
    const context = await fixture((_request, index) => index === 0 ? { status: 400, content: "This model does not support tools" }
      : { content: JSON.stringify(index === 1 ? { tool: "write_file", arguments: { path: "compat.html", content: "compatible" } }
        : { tool: "finish_task", arguments: { status: "complete", summary: "Created compat.html" } }) });
    try {
      context.runtime.createAgent("coder");
      expect((await context.runtime.runNamedAgent("coder", "Create HTML")).status).toBe("complete");
      expect(context.requests[1]?.tools).toBeUndefined();
      expect(context.requests[1]?.messages[0]?.content).toContain("finish_task");
    } finally { await context.cleanup(); }
  });

  it("blocks simultaneous operations even through another runtime on the same project", async () => {
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const context = await fixture(async () => { started(); await gate; return { content: "done" }; });
    let second: ZuvCodeRuntime | undefined;
    const running = context.runtime.chat("wait");
    try {
      await ready;
      await expect(context.runtime.runTeam("parallel")).rejects.toThrow("already running");
      second = ZuvCodeRuntime.silent({ projectRoot: context.root });
      await expect(second.chat("parallel")).rejects.toThrow("Another ZuvCode operation");
    } finally { release(); await running; second?.close(); await context.cleanup(); }
  });

  it("recovers stale running task state on the next explicit execution", async () => {
    const context = await fixture(() => ({ content: "ready" }));
    try {
      const agent = context.runtime.createAgent("coder");
      const task = context.runtime.store.createTask({ title: "Interrupted", description: "old run", ownerAgentId: agent.id, status: "in_progress" });
      context.runtime.store.updateAgentState(agent.id, "working", task.id);
      await context.runtime.chat("hello");
      expect(context.runtime.findTask(task.id).status).toBe("cancelled");
      expect(context.runtime.listAgents()[0]?.currentTaskId).toBeUndefined();
    } finally { await context.cleanup(); }
  });

  it("masks single-capture secrets in saved command evidence", () => {
    expect(redactSecrets("sk-1234567890123456")).toBe("[REDACTED]");
    expect(redactSecrets("api_key=private-value")).toBe("api_key=[REDACTED]");
  });
});

function productProposal(revision = 1): Reply {
  return action("submit_plan", {
    proposal: revision === 1 ? "Frontend and backend will agree on an API, with UI/UX reviewing the design." : "Revised proposal: use an items array in every API response and verify the shared contract.",
    agents: [
      { name: "frontend", role: "Frontend developer", responsibilities: "Implement the browser interface" },
      { name: "backend", role: "Backend developer", responsibilities: "Implement the API contract" },
      { name: "ui-ux", role: "UI/UX designer", responsibilities: "Review and document usability" }
    ],
    tasks: [
      { agent: "frontend", title: "Build frontend", instructions: "Write frontend.txt", checks: ["Inspect output"], depends_on: [] },
      { agent: "backend", title: "Build backend", instructions: "Write backend.txt", checks: ["Inspect contract"], depends_on: [1] },
      { agent: "ui-ux", title: "Review experience", instructions: "Write ui-ux.txt", checks: ["Inspect usability"], depends_on: [1, 2] }
    ]
  });
}

function participant(request: Request): string {
  const system = request.messages[0]!.content;
  return ["frontend", "backend", "ui-ux"].find((name) => system.includes(`You are ${name},`) || system.includes(`named specialist ${name},`)) ?? "orchestrator";
}

describe("team conversations and agreement", () => {
  it("delivers long peer questions and replies without the old 1200-character failure or silent truncation", async () => {
    const question = "Confirm the shared UI and sequencer contract. ".repeat(130) + "QUESTION_END";
    const reply = "Use the existing audio engine and preserve the controls. ".repeat(100) + "REPLY_END";
    const context = await fixture((request) => {
      const system = request.messages[0]!.content, who = participant(request);
      if (system.includes("TEAM_PROPOSAL")) return productProposal();
      if (system.includes("TEAM_REPLY")) {
        expect(request.messages[1]!.content).toContain(question);
        return action("reply_message", { approve: true, message: reply });
      }
      if (who === "frontend") return [action("ask_agent", { to: "backend", message: question }),
        action("write_file", { path: "frontend.txt", content: "Integrated controls" }), finish()][toolMessages(request).length] ?? finish();
      return toolMessages(request).length ? finish() : action("read_file", { path: "frontend.txt" });
    });
    try {
      const tasks = await context.runtime.runTeam("Build a single-file sequencer");
      expect(tasks.every((task) => task.status === "complete")).toBe(true);
      const messages = context.runtime.teamState().messages;
      expect(messages.find((item) => item.kind === "question")?.body).toBe(question);
      expect(messages.find((item) => item.kind === "reply")?.body).toBe(reply);
      expect(context.requests.some((request) => toolMessages(request).some((item) => item.content.includes("REPLY_END")))).toBe(true);
    } finally { await context.cleanup(); }
  });

  it("returns invalid peer messages to the worker for correction without spending valid peer-question slots", async () => {
    let peers = 0;
    const context = await fixture((request) => {
      const system = request.messages[0]!.content, who = participant(request);
      if (system.includes("TEAM_PROPOSAL")) return productProposal();
      if (system.includes("TEAM_REPLY")) { peers++; return action("reply_message", { approve: true, message: "Approved contract." }); }
      if (who === "frontend") {
        const index = toolMessages(request).length;
        if (index < 4) return action("ask_agent", index % 2 ? null : { to: "backend", message: "x".repeat(8001) });
        if (index === 4) {
          expect(toolMessages(request).every((item) => JSON.parse(item.content).error.includes("Correct the arguments and retry"))).toBe(true);
          return action("ask_agent", { to: "backend", message: "Confirm this corrected contract." });
        }
        return index === 5 ? action("write_file", { path: "frontend.txt", content: "Recovered after validation" }) : finish();
      }
      return toolMessages(request).length ? finish() : action("read_file", { path: "frontend.txt" });
    });
    try {
      const tasks = await context.runtime.runTeam("Build the complete application");
      expect(tasks.every((task) => task.status === "complete")).toBe(true);
      expect(peers).toBe(1);
      expect(context.runtime.teamState().run?.openObjections).toEqual([]);
      expect(context.runtime.teamState().messages.filter((item) => item.kind === "question")).toHaveLength(1);
    } finally { await context.cleanup(); }
  });

  it("checkpoints a spent worker budget as blocked, preserves files and resumes with the persisted larger budget", async () => {
    let resumed = false;
    const context = await fixture((request) => {
      const system = request.messages[0]!.content, index = toolMessages(request).length;
      if (system.includes("TEAM_PROPOSAL")) return plan();
      if (system.includes("named specialist coder,")) {
        if (!resumed) return index === 0 ? action("write_file", { path: "team.html", content: "<h1>Engine</h1>" }) : action("update_plan", { steps: ["Add controls", "Test integration"] });
        return [action("read_file", { path: "team.html" }), action("edit_file", { path: "team.html", old_text: "Engine", new_text: "Engine with controls" }), finish()][index] ?? finish();
      }
      return index ? finish() : action("read_file", { path: "team.html" });
    });
    try {
      context.runtime.setExecutionStepLimit(2);
      const tasks = await context.runtime.runTeam("Build and integrate the app");
      expect(tasks[0]).toMatchObject({ status: "blocked", attempts: 1, generatedFiles: ["team.html"] });
      expect(tasks[0]?.resultText).toContain("/team resume");
      expect(tasks[1]?.status).toBe("queued");
      expect(readFileSync(join(context.root, "team.html"), "utf8")).toBe("<h1>Engine</h1>");
      context.runtime.setExecutionStepLimit(300); context.restart(); resumed = true;
      expect(context.runtime.executionStepLimit()).toBe(300);
      const completed = await context.runtime.runSavedPlan();
      expect(completed.every((task) => task.status === "complete")).toBe(true);
      expect(readFileSync(join(context.root, "team.html"), "utf8")).toBe("<h1>Engine with controls</h1>");
      expect(completed[0]?.attempts).toBe(2);
    } finally { await context.cleanup(); }
  });

  it("keeps a team worker running beyond 40 model turns", async () => {
    const context = await fixture((request) => {
      const system = request.messages[0]!.content, index = toolMessages(request).length;
      if (system.includes("TEAM_PROPOSAL")) return plan();
      if (system.includes("named specialist coder,")) return index < 42 ? action("update_plan", { steps: [`Step ${index + 1}`] })
        : index === 42 ? action("write_file", { path: "team.html", content: "<h1>Completed after turn 40</h1>" }) : finish();
      return index ? finish() : action("read_file", { path: "team.html" });
    });
    try {
      const tasks = await context.runtime.runTeam("Build a larger app");
      expect(tasks.every((task) => task.status === "complete")).toBe(true);
      expect(tasks[0]?.attempts).toBe(1);
      expect(context.requests.filter((request) => request.messages[0]!.content.includes("named specialist coder,"))).toHaveLength(44);
    } finally { await context.cleanup(); }
  });

  it("generates job-specific roles, revises a real objection, and waits for all votes before writing", async () => {
    let revision = 0, votes = 0;
    const events: AgentProgress[] = [];
    const context = await fixture((request) => {
      const system = request.messages[0]!.content, who = participant(request);
      if (system.includes("TEAM_PROPOSAL")) {
        revision++;
        if (revision === 2) expect(request.messages[1]!.content).toContain("Always return an items array");
        return productProposal(revision);
      }
      if (system.includes("TEAM_REVIEW")) {
        votes++;
        expect(existsSync(join(context.root, "frontend.txt"))).toBe(false);
        if (who === "ui-ux" && revision === 1) expect(request.messages[1]!.content).toContain("Always return an items array");
        return action("review_plan", { approve: !(revision === 1 && who === "backend"), message: revision === 1 && who === "backend" ? "Always return an items array; revise the contract." : `${who} agrees with proposal ${revision}.` });
      }
      expect(votes).toBe(6);
      return toolMessages(request).length ? finish("complete", `${who} finished.`) : action("write_file", { path: `${who}.txt`, content: "real work" });
    }, false);
    try {
      const results = await context.runtime.runTeam("Create a complete product with frontend, API and UI/UX", undefined, { onProgress: (event) => events.push(event) });
      expect(results.every((task) => task.status === "complete")).toBe(true);
      expect(context.runtime.teamState().agents.map((agent) => agent.name).sort()).toEqual(["backend", "frontend", "orchestrator", "ui-ux"]);
      expect(context.runtime.teamState().run).toMatchObject({ status: "complete", round: 2, openObjections: [] });
      expect(events.some((event) => event.kind === "message" && event.speaker === "backend" && event.intent === "objection")).toBe(true);
      expect(JSON.stringify(events)).not.toContain("opaque-team-signature");
      context.restart();
      expect(context.runtime.teamState().messages.filter((item) => item.kind === "agreement")).toHaveLength(5);
      expect(context.runtime.teamState().messages.some((item) => item.body.includes("Always return an items array"))).toBe(true);
    } finally { await context.cleanup(); }
  });

  it("blocks work and preserves the discussion when agreement is never reached", async () => {
    let proposals = 0, reviews = 0;
    const context = await fixture((request) => {
      if (request.messages[0]!.content.includes("TEAM_PROPOSAL")) { proposals++; return productProposal(); }
      if (request.messages[0]!.content.includes("TEAM_REVIEW")) { reviews++; return action("review_plan", { approve: false, message: "The API contract is unresolved." }); }
      throw new Error("No worker may run without agreement");
    }, false);
    try {
      await expect(context.runtime.runTeam("Build a product")).rejects.toThrow("did not agree");
      expect(proposals).toBe(3); expect(reviews).toBe(9);
      expect(context.runtime.listTasks()).toEqual([]);
      expect(context.runtime.teamState().run?.status).toBe("blocked");
      expect(context.runtime.teamState().messages).toHaveLength(12);
      await expect(context.runtime.runSavedPlan()).rejects.toThrow("agreed team plan");
      expect(context.runtime.listAgents().every((agent) => agent.status === "idle")).toBe(true);
    } finally { await context.cleanup(); }
  });

  it("cannot remove a dissenting reviewer to manufacture agreement", async () => {
    let attempts = 0;
    const context = await fixture((request) => {
      if (request.messages[0]!.content.includes("TEAM_REVIEW")) return action("review_plan", { approve: false, message: "Keep me in this review and resolve the API issue." });
      const proposal = productProposal();
      if (++attempts > 1) {
        const args = proposal.call!.args as { agents: Array<{ name: string }>; tasks: Array<{ agent: string }> };
        args.agents.find((agent) => agent.name === "backend")!.name = "replacement";
        args.tasks.find((task) => task.agent === "backend")!.agent = "replacement";
      }
      return proposal;
    }, false);
    try {
      await expect(context.runtime.runTeam("Build a product")).rejects.toThrow("Do not remove dissenting");
      expect(context.runtime.listTasks()).toEqual([]);
      expect(context.runtime.listAgents().some((agent) => agent.name === "replacement")).toBe(false);
    } finally { await context.cleanup(); }
  });

  it("supports real peer questions and gates mutations until the peer resolves its objection", async () => {
    let replies = 0;
    const events: AgentProgress[] = [];
    const context = await fixture((request) => {
      const system = request.messages[0]!.content, who = participant(request);
      if (system.includes("TEAM_PROPOSAL")) return productProposal();
      if (system.includes("TEAM_REPLY")) {
        expect(who).toBe("backend");
        expect(request.messages[1]!.content).toContain("frontend asks you");
        return action("reply_message", { approve: ++replies > 1, message: replies === 1 ? "Use an items array before implementing." : "Agreed. The revised items array contract works." });
      }
      if (who === "frontend") return [
        action("ask_agent", { to: "backend", message: "May I render /api/items as a bare string?" }),
        action("write_file", { path: "must-not-exist.txt", content: "unapproved" }),
        action("ask_agent", { to: "backend", message: "I will use an items array instead. Do you agree?" }),
        action("write_file", { path: "frontend.txt", content: "approved work" }), finish()
      ][toolMessages(request).length] ?? finish();
      return toolMessages(request).length ? finish() : action("read_file", { path: "frontend.txt" });
    });
    try {
      const tasks = await context.runtime.runTeam("Build a product", undefined, { onProgress: (event) => events.push(event) });
      expect(tasks.every((task) => task.status === "complete")).toBe(true);
      expect(existsSync(join(context.root, "must-not-exist.txt"))).toBe(false);
      expect(readFileSync(join(context.root, "frontend.txt"), "utf8")).toBe("approved work");
      expect(context.runtime.teamState().run?.openObjections).toEqual([]);
      expect(events.some((event) => event.speaker === "frontend" && event.recipient === "backend" && event.intent === "question")).toBe(true);
      expect(events.some((event) => event.speaker === "backend" && event.recipient === "frontend" && event.intent === "reply")).toBe(true);
    } finally { await context.cleanup(); }
  });

  it("preserves unresolved peer objections across restart and explicit retry", async () => {
    let retry = false;
    const context = await fixture((request) => {
      const system = request.messages[0]!.content, who = participant(request);
      if (system.includes("TEAM_PROPOSAL")) return productProposal();
      if (system.includes("TEAM_REPLY")) return action("reply_message", { approve: retry, message: retry ? "The contract is resolved." : "Do not write before fixing the contract." });
      if (who === "frontend") return (!retry ? [action("ask_agent", { to: "backend", message: "Please confirm the contract." }), finish("blocked", "Peer requested changes.")]
        : [action("write_file", { path: "still-blocked.txt", content: "bad" }), action("ask_agent", { to: "backend", message: "I addressed your concern; please confirm." }),
          action("write_file", { path: "frontend.txt", content: "fixed" }), finish()])[toolMessages(request).length] ?? finish();
      return toolMessages(request).length ? finish() : action("read_file", { path: "frontend.txt" });
    });
    try {
      const first = await context.runtime.runTeam("Build a product");
      expect(first[0]?.status).toBe("blocked");
      expect(context.runtime.teamState().run?.openObjections).toHaveLength(1);
      context.restart(); retry = true;
      expect((await context.runtime.runSavedPlan()).every((task) => task.status === "complete")).toBe(true);
      expect(existsSync(join(context.root, "still-blocked.txt"))).toBe(false);
      expect(context.runtime.teamState().run?.openObjections).toEqual([]);
    } finally { await context.cleanup(); }
  });

  it("does not start agents for ordinary chat and never exposes delegation tools there", async () => {
    const context = await fixture(() => ({ content: "Single-agent response." }));
    try {
      await context.runtime.chat("Build frontend and backend");
      expect(context.runtime.listAgents()).toEqual([]);
      expect(context.runtime.teamState().run).toBeUndefined();
      const names = context.requests[0]?.tools?.map((tool) => tool.function.name);
      expect(names).not.toContain("submit_plan"); expect(names).not.toContain("ask_agent");
    } finally { await context.cleanup(); }
  });

  it("cancels discussion without implementation and returns to normal chat", async () => {
    const controller = new AbortController();
    const context = await fixture((request) => request.messages[0]!.content.includes("TEAM_PROPOSAL") ? productProposal() : { content: "Normal chat is ready." });
    try {
      await expect(context.runtime.runTeam("Build a product", controller.signal, { onProgress: (event) => {
        if (event.kind === "message") controller.abort(new Error("cancelled discussion"));
      } })).rejects.toThrow("cancelled discussion");
      expect(context.runtime.teamState().run?.status).toBe("cancelled");
      expect(context.runtime.listTasks()).toEqual([]);
      expect((await context.runtime.chat("hello")).text).toBe("Normal chat is ready.");
    } finally { await context.cleanup(); }
  });

  it("refuses to resume task assignments changed after agreement", async () => {
    const context = await fixture(() => productProposal());
    try {
      const tasks = await context.runtime.planTeam("Build a product");
      const database = new DatabaseSync(context.runtime.store.dbPath);
      try { database.prepare("UPDATE tasks SET description = ? WHERE id = ?").run("Changed scope", tasks[0]!.id); }
      finally { database.close(); }
      const before = context.requests.length;
      await expect(context.runtime.runSavedPlan()).rejects.toThrow("changed after team agreement");
      expect(context.requests).toHaveLength(before);
      expect(context.runtime.listTasks()[0]?.attempts).toBe(0);
    } finally { await context.cleanup(); }
  });
});
