import { describe, expect, it, vi } from "vitest";
import { render } from "@inquirer/testing";
import { activityPrompt, activityLines } from "@zuvcode/terminal-ui";

describe("live agent activity", () => {
  it("shows the plan and real actions, denies by default, and allows a later explicit approval", async () => {
    const decisions: boolean[] = [];
    const controller = new AbortController();
    const ui = await render(activityPrompt, { controller, events: [], start: async (callbacks) => {
      callbacks.onProgress?.({ kind: "plan", message: "1. Read files\n2. Create HTML" });
      decisions.push(await callbacks.approve!("First command\necho first"));
      decisions.push(await callbacks.approve!("Second command\necho second"));
      return "finished";
    } });
    await vi.waitFor(() => expect(ui.getScreen()).toContain("First command"));
    expect(ui.getScreen()).toContain("1. Read files");
    expect(ui.getScreen()).toContain("2. Create HTML");
    ui.events.keypress("enter");
    await vi.waitFor(() => expect(ui.getScreen()).toContain("Second command"));
    ui.events.keypress("right");
    ui.events.keypress("enter");
    await expect(ui.answer).resolves.toEqual({ value: "finished" });
    expect(decisions).toEqual([false, true]);
  });

  it("Escape aborts work and waits for the operation to acknowledge it", async () => {
    const controller = new AbortController();
    let stopped = false;
    const ui = await render(activityPrompt, { controller, events: [], start: async () => {
      await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => setTimeout(resolve, 30), { once: true }));
      stopped = true;
      controller.signal.throwIfAborted();
    } });
    ui.events.keypress("escape");
    expect(controller.signal.aborted).toBe(true);
    const result = await ui.answer;
    expect(result.error).toBeInstanceOf(Error);
    expect(stopped).toBe(true);
  });

  it("shows full approval commands without truncation on narrow terminals", async () => {
    const before = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 42, configurable: true });
    const command = "abcdefghijklmnopqrstuvwxy0123456789".repeat(3);
    try {
      const ui = await render(activityPrompt, { controller: new AbortController(), events: [], start: async (callbacks) => callbacks.approve!(command) });
      await vi.waitFor(() => expect(ui.getScreen()).toContain("Approval required"));
      const screen = ui.getScreen();
      expect(screen.replace(/\s/g, "")).toContain(command);
      expect(screen.split("\n").every((line) => line.length <= 40)).toBe(true);
      ui.events.keypress("enter");
      await ui.answer;
    } finally { Object.defineProperty(process.stdout, "columns", { value: before, configurable: true }); }
  });

  it("shows a completed action once and strips terminal control sequences", () => {
    expect(activityLines([
      { kind: "tool_start", callId: "a", message: "write_file index.html" },
      { kind: "tool_end", callId: "a", message: "\x1b[2Jwrite_file index.html", ok: true }
    ])).toEqual(["+ write_file index.html"]);
  });

  it("keeps speaker headers with messages when the activity viewport fills up", () => {
    const events = [
      { kind: "message" as const, speaker: "frontend", recipient: "orchestrator", intent: "agreement" as const, message: "Earlier message about the responsibilities and checks for the interface." },
      { kind: "message" as const, speaker: "backend", recipient: "orchestrator", intent: "objection" as const, message: "Use an items array in the API response before implementing." }
    ];
    const lines = activityLines(events, 38, { maxMessageLines: 3, maxRows: 8 });
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(lines[0]).toContain("backend");
    expect(lines.join("\n")).toContain("CHANGES REQUESTED");
    expect(lines.join("\n")).not.toContain("interface");
    expect(activityLines(events, 38).join("\n")).toContain("interface");
    expect(activityLines(events, 38, { maxRows: 2 })[0]).toContain("backend");
  });

  it("animates actual speaker messages and keeps them readable in a narrow terminal", async () => {
    const before = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 42, configurable: true });
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    try {
      const ui = await render(activityPrompt, { controller: new AbortController(), events: [], start: async (callbacks) => {
        callbacks.onProgress?.({ kind: "message", speaker: "frontend", recipient: "backend", intent: "question", message: "Can we use an items array for the API response? Please confirm the contract." });
        await pending;
      } });
      expect(ui.getScreen()).toContain("frontend -> backend");
      const first = ui.getScreen();
      await vi.waitFor(() => expect(ui.getScreen()).not.toBe(first));
      await vi.waitFor(() => expect(ui.getScreen().replace(/\s+/g, " ")).toContain("Please confirm the contract."));
      expect(ui.getScreen().split("\n").every((line) => line.length <= 40)).toBe(true);
      finish(); await ui.answer;
    } finally { finish?.(); Object.defineProperty(process.stdout, "columns", { value: before, configurable: true }); }
  });
});
