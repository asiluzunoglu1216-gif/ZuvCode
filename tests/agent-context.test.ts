import { describe, expect, it } from "vitest";
import { compactAgentContext } from "../packages/orchestration/dist/agent-context.js";
import type { ChatMessage } from "@zuvcode/protocol";

function batch(id: string, size = 20_000): ChatMessage[] {
  return [
    { role: "assistant", content: "", toolCalls: [{ id, name: "read_file", argumentsJson: JSON.stringify({ path: `${id}.html` }) }], providerMessage: { extra_content: { google: { thought_signature: `${id}-opaque-signature` } } } },
    { role: "tool", name: "read_file", toolCallId: id, content: JSON.stringify({ ok: true, output: { content: "x".repeat(size) } }) }
  ];
}

describe("long-running agent context", () => {
  it("preserves all user requirements, recent batches and their opaque metadata", () => {
    const last = batch("recent", 500);
    const messages: ChatMessage[] = [{ role: "user", content: "Single HTML, no CDN, include import/export and all controls." }, ...batch("old"),
      { role: "user", content: "Preserve the audio engine." }, ...last];
    expect(compactAgentContext(messages, 10_000, 4000)).toBe(true);
    expect(messages.filter((item) => item.role === "user").map((item) => item.content)).toEqual(["Single HTML, no CDN, include import/export and all controls.", "Preserve the audio engine."]);
    expect(messages.slice(-2)).toEqual(last);
    expect(JSON.stringify(messages)).not.toContain("old-opaque-signature");
    expect(JSON.stringify(messages)).toContain("recent-opaque-signature");
    expect(JSON.stringify(messages)).toContain("old.html");
    expect(JSON.stringify(messages).length).toBeLessThan(4000);
    const before = JSON.stringify(messages);
    expect(compactAgentContext(messages)).toBe(false);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("never drops a partial tool batch or leaves orphaned tool results", () => {
    const messages = batch("pending");
    messages[0]!.toolCalls!.push({ id: "missing", name: "read_file", argumentsJson: '{}' });
    const before = JSON.stringify(messages);
    expect(compactAgentContext(messages, 1000, 500)).toBe(false);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("records failed operations honestly and handles malformed tool arguments", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "Keep my files." }, ...batch("bad")];
    messages[1]!.toolCalls![0]!.argumentsJson = "null";
    messages[2]!.content = JSON.stringify({ ok: false, error: "Permission denied: do not retry", output: "x".repeat(5000) });
    expect(compactAgentContext(messages, 1000, 900)).toBe(true);
    expect(JSON.stringify(messages)).toContain("Permission denied");
    expect(messages.some((item) => item.role === "tool")).toBe(false);
    expect(messages[0]?.content).toBe("Keep my files.");
  });

  it("bounds repeated checkpoints while retaining newest activity and user constraints", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "Do not use external libraries." }];
    for (let index = 0; index < 100; index++) {
      messages.push(...batch(`file-${index}`, 1000));
      compactAgentContext(messages, 4000, 2000);
    }
    expect(messages.filter((item) => item.name === "zuvcode_execution_checkpoint")).toHaveLength(1);
    expect(JSON.stringify(messages).length).toBeLessThan(30_000);
    expect(JSON.stringify(messages)).toContain("file-99.html");
    expect(messages[0]?.content).toBe("Do not use external libraries.");
  });
});
