import { PassThrough, Writable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { commandPrompt, choose, terminalPrompt, withTerminalSession, banner, type TerminalInput } from "@zuvcode/terminal-ui";
import { stripVTControlCharacters } from "node:util";

describe("terminal input lifecycle", () => {
  it("keeps input live through async work, model selection, and the next message", async () => {
    const source = new PassThrough() as PassThrough & TerminalInput;
    source.isTTY = true;
    source.isRaw = false;
    const modes: boolean[] = [];
    source.setRawMode = (mode) => { source.isRaw = mode; modes.push(mode); };
    let output = "";
    const context = () => ({
      output: new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } }),
      clearPromptOnDone: true
    });
    const run = withTerminalSession(async () => {
      const action = await commandPrompt({ model: "AUTO", mode: "BALANCED", history: [] }, context());
      await setTimeout(30);
      const model = await choose({ title: "Model picker", choices: [{ name: "Local coder", value: "coder" }] }, context());
      const text = await commandPrompt({ model: model ?? "AUTO", mode: "BALANCED", history: [action] }, context());
      return text;
    }, source);
    await vi.waitFor(() => expect(output).toContain("AUTO"));
    source.write("/models\r");
    await vi.waitFor(() => expect(output).toContain("Model picker"));
    source.write("\r");
    await vi.waitFor(() => expect(output).toContain("coder  /"));
    expect(modes).toEqual([true]);
    source.write("merhaba");
    await vi.waitFor(() => expect(output).toContain("> merhaba"));
    source.write("\r");
    await expect(run).resolves.toBe("merhaba");
    expect(modes).toEqual([true, false]);
    expect(source.listenerCount("data")).toBe(0);
    source.destroy();
  });

  it("restores the terminal on errors and permits another prompt after cancellation", async () => {
    const source = new PassThrough() as PassThrough & TerminalInput;
    source.isTTY = true;
    source.isRaw = false;
    source.setRawMode = (mode) => { source.isRaw = mode; };
    const fail = terminalPrompt(async () => { throw new Error("cancelled"); });
    await expect(withTerminalSession(() => fail({}), source)).rejects.toThrow("cancelled");
    expect(source.isRaw).toBe(false);
    expect(source.listenerCount("data")).toBe(0);
    source.destroy();
  });

  it.each([100, 80, 42, 30, 20])("fits the block wordmark inside %i columns", (columns) => {
    const previous = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
    try {
      const lines = stripVTControlCharacters(banner()).split("\n");
      expect(lines.every((line) => line.length < columns)).toBe(true);
      if (columns >= 30) expect(lines.join("")).toContain("\u2588");
    } finally { Object.defineProperty(process.stdout, "columns", { value: previous, configurable: true }); }
  });
});
