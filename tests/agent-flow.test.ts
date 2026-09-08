import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ZuvCodeRuntime } from "@zuvcode/orchestration";
import { WebTools } from "../packages/tools/dist/index.js";
import type { AgentProgress } from "../packages/protocol/dist/index.js";

interface WireMessage { role: string; content: string; tool_calls?: Array<Record<string, unknown>>; tool_call_id?: string; tool_name?: string }
interface Request { model: string; messages: WireMessage[]; tools?: Array<{ function: { name: string } }> }
type Reply = { status?: number; body: unknown };

async function fixture(handler: (request: Request, index: number) => Reply, kind: "openai-compatible" | "ollama" = "openai-compatible") {
  mkdirSync(".tmp-tests", { recursive: true });
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "agent-flow-"));
  const requests: Request[] = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const request = JSON.parse(text) as Request;
    requests.push(request);
    const result = handler(request, requests.length - 1);
    res.writeHead(result.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result.body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const runtime = ZuvCodeRuntime.silent({ projectRoot: root, permissionMode: "BALANCED" });
  runtime.addProvider({ kind, name: "Fixture", baseUrl: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}` });
  runtime.selectModel(runtime.addModel({ providerName: "Fixture", modelId: "custom-gemini" }));
  return { root, runtime, requests, cleanup: async () => {
    runtime.close(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  } };
}

function tool(name: string, args: unknown, id = name): Reply {
  return { body: { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{
    id, type: "function", function: { name, arguments: JSON.stringify(args) }, extra_content: { google: { thought_signature: "opaque-test-signature" } }
  }] } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } };
}
const final = (content: string): Reply => ({ body: { choices: [{ message: { content } }] } });

describe("model-driven coding", () => {
  it("turns an HTML request into real files, then reads and edits them while preserving Gemini signatures", async () => {
    const replies = [
      tool("update_plan", { steps: ["Inspect project", "Create and verify HTML"] }),
      tool("list_files", {}),
      tool("write_file", { path: "site/index.html", content: "<!doctype html>\n<h1>Hello</h1>" }),
      tool("read_file", { path: "site/index.html" }),
      tool("edit_file", { path: "site/index.html", old_text: "Hello", new_text: "ZuvCode" }),
      final("Created site/index.html.")
    ];
    const context = await fixture((_request, index) => replies[index] ?? final("done"));
    const events: AgentProgress[] = [];
    try {
      const response = await context.runtime.chat("Write an HTML page in this folder", undefined, { onProgress: (event) => events.push(event) });
      expect(readFileSync(join(context.root, "site/index.html"), "utf8")).toBe("<!doctype html>\n<h1>ZuvCode</h1>");
      expect(response.text).toContain("site/index.html");
      expect(response.usage?.totalTokens).toBe(75);
      expect(context.requests[0]?.tools?.map((item) => item.function.name)).toContain("write_file");
      expect(context.requests[0]?.messages[0]?.content).toContain("IMPLEMENT IT IN FILES");
      const next = context.requests[1]!.messages;
      expect(next.find((item) => item.role === "assistant")?.tool_calls?.[0]?.extra_content).toEqual({ google: { thought_signature: "opaque-test-signature" } });
      expect(next.at(-1)).toMatchObject({ role: "tool", tool_call_id: "update_plan" });
      expect(JSON.parse(next.at(-1)!.content).ok).toBe(true);
      expect(events.some((event) => event.kind === "plan")).toBe(true);
      expect(JSON.stringify(events)).not.toContain("opaque-test-signature");
      expect(context.runtime.fileChanges()).toHaveLength(2);
    } finally { await context.cleanup(); }
  });

  it("returns tool errors to the model so it can correct its arguments", async () => {
    const context = await fixture((_request, index) => [
      tool("write_file", { path: "../escape.html", content: "bad" }, "bad"),
      tool("write_file", { path: "index.html", content: "good" }, "good"), final("fixed")
    ][index] ?? final("done"));
    try {
      await context.runtime.chat("Create HTML");
      const error = JSON.parse(context.requests[1]!.messages.at(-1)!.content);
      expect(error.ok).toBe(false);
      expect(error.error).toContain("escapes");
      expect(readFileSync(join(context.root, "index.html"), "utf8")).toBe("good");
    } finally { await context.cleanup(); }
  });

  it("continues a large HTML edit after context checkpointing with valid tool pairs and Gemini metadata", async () => {
    const document = "<h1>Original</h1>\n<!--" + "x".repeat(190_000) + "-->";
    const events: AgentProgress[] = [];
    const context = await fixture((request, index) => {
      const unanswered = new Set<string>();
      for (const item of request.messages) {
        if (item.role === "assistant" && item.tool_calls) for (const call of item.tool_calls) unanswered.add(String(call.id));
        if (item.role === "tool") { expect(unanswered.has(item.tool_call_id!)).toBe(true); unanswered.delete(item.tool_call_id!); }
      }
      expect(unanswered.size).toBe(0);
      return [tool("write_file", { path: "large.html", content: document }), tool("read_file", { path: "large.html" }),
        tool("edit_file", { path: "large.html", old_text: "Original", new_text: "Integrated" }), final("Large file verified.")][index] ?? final("done");
    });
    try {
      expect((await context.runtime.chat("Create and verify one HTML file. No CDN.", undefined, { onProgress: (event) => events.push(event) })).text).toBe("Large file verified.");
      expect(events.some((event) => event.message.includes("checkpointed"))).toBe(true);
      expect(context.requests.every((request) => request.messages.some((item) => item.content.includes("No CDN.")))).toBe(true);
      const recent = context.requests[2]?.messages.find((item) => item.role === "assistant" && item.tool_calls);
      expect(recent?.tool_calls?.[0]?.extra_content).toEqual({ google: { thought_signature: "opaque-test-signature" } });
      expect(readFileSync(join(context.root, "large.html"), "utf8")).toBe(document.replace("Original", "Integrated"));
    } finally { await context.cleanup(); }
  });

  it("uses explicit JSON compatibility mode for providers without native tool support", async () => {
    const context = await fixture((_request, index) => index === 0
      ? { status: 400, body: { error: "This model does not support tools" } }
      : index === 1 ? final(JSON.stringify({ tool: "write_file", arguments: { path: "fallback.html", content: "<h1>Compatible</h1>" } }))
        : final(JSON.stringify({ final: "Created fallback.html" })));
    try {
      const response = await context.runtime.chat("Create a page");
      expect(response.text).toBe("Created fallback.html");
      expect(existsSync(join(context.root, "fallback.html"))).toBe(true);
      expect(context.requests[1]?.tools).toBeUndefined();
      expect(context.requests[1]?.messages[0]?.content).toContain("JSON action mode");
      expect(context.requests[2]?.messages.at(-1)?.content).toContain("Tool result");
      await context.runtime.chat("Thanks");
      expect(context.requests).toHaveLength(4);
      expect(context.requests[3]?.tools).toBeUndefined();
    } finally { await context.cleanup(); }
  });

  it("does not execute JSON examples during a normal native-tool conversation", async () => {
    const context = await fixture(() => final('{"tool":"write_file","arguments":{"path":"example.txt","content":"example"}}'));
    try {
      await context.runtime.chat("Show me a JSON example without executing anything");
      expect(existsSync(join(context.root, "example.txt"))).toBe(false);
    } finally { await context.cleanup(); }
  });

  it("serializes Ollama tool arguments and tool results correctly", async () => {
    const context = await fixture((_request, index) => ({ body: index === 0 ? { done: true, message: { content: "", tool_calls: [{
      function: { name: "write_file", arguments: { path: "ollama.html", content: "<p>Local</p>" } }
    }] } } : { done: true, message: { content: "Local file created." } } }), "ollama");
    try {
      await context.runtime.chat("Create HTML");
      expect(existsSync(join(context.root, "ollama.html"))).toBe(true);
      expect(context.requests[1]?.messages.at(-1)).toMatchObject({ role: "tool", tool_name: "write_file" });
      expect(context.requests[1]?.messages.find((item) => item.role === "assistant")?.tool_calls?.[0]?.function).toMatchObject({ arguments: { path: "ollama.html" } });
    } finally { await context.cleanup(); }
  });

  it("supports research through the same model-to-tool-result loop", async () => {
    const search = vi.spyOn(WebTools.prototype, "search").mockResolvedValue({ engine: "DuckDuckGo", results: [{ title: "Docs", url: "https://example.com/docs", snippet: "Useful reference" }] });
    const read = vi.spyOn(WebTools.prototype, "read").mockResolvedValue({ title: "Docs", url: "https://example.com/docs", content: "Current reference text", untrusted: true });
    const context = await fixture((_request, index) => [tool("web_search", { query: "HTML reference" }), tool("read_url", { url: "https://example.com/docs" }), final("Reference: https://example.com/docs")][index] ?? final("done"));
    try {
      const response = await context.runtime.chat("Research HTML");
      expect(search).toHaveBeenCalledWith("HTML reference", undefined);
      expect(read).toHaveBeenCalledWith("https://example.com/docs", undefined);
      expect(context.requests[2]?.messages.at(-1)?.content).toContain("Current reference text");
      expect(response.text).toContain("https://example.com/docs");
    } finally { search.mockRestore(); read.mockRestore(); await context.cleanup(); }
  });

  it("does not execute truncated calls or loop without a bound", async () => {
    const context = await fixture(() => ({ body: { choices: [{ finish_reason: "length", message: { content: "", tool_calls: [{ id: "a", function: { name: "write_file", arguments: '{"path":"broken.html"' } }] } }] } }));
    try {
      await expect(context.runtime.chat("Create HTML")).rejects.toThrow("truncated");
      expect(existsSync(join(context.root, "broken.html"))).toBe(false);
    } finally { await context.cleanup(); }
    const looping = await fixture((_request, index) => tool("list_files", {}, `loop-${index}`));
    try {
      looping.runtime.setExecutionStepLimit(6);
      await expect(looping.runtime.chat("Looping fixture")).rejects.toThrow("Step budget reached (6 model turns)");
      expect(looping.requests).toHaveLength(6);
    } finally { await looping.cleanup(); }
  });

  it("continues ordinary coding beyond 40 turns without confusing permission mode with work budget", async () => {
    const events: AgentProgress[] = [];
    const context = await fixture((_request, index) => index < 45 ? tool("update_plan", { steps: [`Action ${index + 1}`] }) : final("Long task finished."));
    try {
      context.runtime.setPermissionMode("FULL_ACCESS");
      expect(context.runtime.executionStepLimit()).toBe(120);
      expect((await context.runtime.chat("Long coding task", undefined, { onProgress: (event) => events.push(event) })).text).toBe("Long task finished.");
      expect(context.requests).toHaveLength(46);
      expect(events.some((event) => event.message.includes("Continuing automatically: 40/120"))).toBe(true);
      context.runtime.setExecutionStepLimit(300);
      context.runtime.setPermissionMode("SAFE");
      expect(context.runtime.executionStepLimit()).toBe(300);
      expect(() => context.runtime.setExecutionStepLimit(Infinity)).toThrow();
      expect(() => context.runtime.setExecutionStepLimit(0)).toThrow();
      expect(() => context.runtime.setExecutionStepLimit(1001)).toThrow();
    } finally { await context.cleanup(); }
  });

  it("cancels approval without executing and keeps the next conversation valid", async () => {
    const context = await fixture((_request, index) => index === 0
      ? tool("write_file", { path: "preserved.txt", content: "completed before cancellation" }, "reused")
      : index === 1 ? tool("run_command", { command: "node -e \"console.log('DO_NOT_EXECUTE')\"" }, "reused") : final("Ready again"));
    const controller = new AbortController();
    try {
      await expect(context.runtime.chat("Run a check", controller.signal, { approve: async () => {
        controller.abort(new Error("cancelled")); return false;
      } })).rejects.toThrow("cancelled");
      expect((await context.runtime.chat("Hello again")).text).toBe("Ready again");
      expect(context.requests[2]?.messages.filter((message) => message.role === "tool" && message.tool_call_id === "reused")).toHaveLength(2);
      expect(readFileSync(join(context.root, "preserved.txt"), "utf8")).toBe("completed before cancellation");
    } finally { await context.cleanup(); }
  });
});
