import { PassThrough, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasteDecoder } from "../packages/terminal-ui/dist/paste.js";
import { commandPrompt, withTerminalSession, type TerminalInput } from "@zuvcode/terminal-ui";

afterEach(() => vi.useRealTimers());

describe("paste decoder", () => {
  it("decodes split markers, split UTF-8, blank lines and control characters without key actions", () => {
    const key = vi.fn(), paste = vi.fn();
    const decoder = new PasteDecoder(key, paste);
    const bytes = Buffer.from("\x1b[200~T\u00fcrk\u00e7e\r\n\r\n\tcode\x03\x1b[31m!\x1b[0m\x1b[201~");
    for (const byte of bytes) decoder.write(Buffer.from([byte]));
    expect(key).not.toHaveBeenCalled();
    expect(paste).toHaveBeenCalledExactlyOnceWith("T\u00fcrk\u00e7e\n\n    code!");
    decoder.close();
  });

  it("groups legacy CR/LF input across chunks and waits for an independent Enter", () => {
    vi.useFakeTimers();
    const key = vi.fn(), paste = vi.fn();
    const decoder = new PasteDecoder(key, paste);
    decoder.write(Buffer.from("first\r"));
    vi.advanceTimersByTime(20);
    decoder.write(Buffer.from("\nsecond\r\n"));
    vi.advanceTimersByTime(100);
    expect(key.mock.calls.flat().join("")).toBe("first");
    expect(paste).toHaveBeenCalledExactlyOnceWith("\nsecond\n");
    decoder.write(Buffer.from("\r"));
    vi.advanceTimersByTime(100);
    expect(key.mock.calls.flat().join("")).toBe("first\r");
    decoder.close();
  });

  it("preserves ordinary commands and escape keys and drops pending input on close", () => {
    vi.useFakeTimers();
    const key = vi.fn(), paste = vi.fn();
    const decoder = new PasteDecoder(key, paste);
    decoder.write(Buffer.from("/model\r"));
    vi.advanceTimersByTime(100);
    decoder.write(Buffer.from("\x1b"));
    vi.advanceTimersByTime(100);
    expect(key.mock.calls.flat().join("")).toBe("/model\r\x1b");
    decoder.write(Buffer.from("\r"));
    decoder.close();
    vi.advanceTimersByTime(100);
    expect(key.mock.calls.flat().join("")).toBe("/model\r\x1b");
    expect(paste).not.toHaveBeenCalled();
  });
});

async function composer(history: string[] = []) {
  const source = new PassThrough() as PassThrough & TerminalInput;
  source.isTTY = true;
  source.isRaw = false;
  source.setRawMode = (raw) => { source.isRaw = raw; };
  let output = "", settled = false;
  const previousTerm = process.env.TERM;
  process.env.TERM = "xterm-256color";
  const answer = withTerminalSession(() => commandPrompt({ model: "AUTO", mode: "BALANCED", history }, {
    clearPromptOnDone: true,
    output: new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } })
  }), source);
  if (previousTerm === undefined) delete process.env.TERM;
  else process.env.TERM = previousTerm;
  void answer.then(() => { settled = true; }, () => { settled = true; });
  await vi.waitFor(() => expect(output).toContain("AUTO"));
  return { source, answer, output: () => output, settled: () => settled };
}

describe("multiline command composer", () => {
  it.each([false, true])("keeps an entire paste pending until Enter (framed=%s)", async (framed) => {
    const ui = await composer();
    const text = "Build a page\r\n\r\n  <h1>hello</h1>\r\n/exit\r\n";
    ui.source.write(framed ? `\x1b[200~${text}\x1b[201~` : text);
    await delay(180);
    expect(ui.settled()).toBe(false);
    expect(ui.output()).toContain("<h1>hello</h1>");
    ui.source.write("\r");
    await expect(ui.answer).resolves.toBe("Build a page\n\n  <h1>hello</h1>\n/exit");
    expect(ui.output()).toContain("\x1b[?2004h");
    expect(ui.output()).toContain("\x1b[?2004l");
    expect(ui.source.isRaw).toBe(false);
    expect(ui.source.listenerCount("data")).toBe(0);
    ui.source.destroy();
  });

  it("edits pasted lines and inserts another paste at the cursor", async () => {
    const ui = await composer();
    ui.source.write("before ");
    ui.source.write("\x1b[200~first\nsecond\x1b[201~");
    ui.source.write("\x1b[A\x1b[H");
    ui.source.write("EDIT ");
    ui.source.write("\x1b[B\x1b[F");
    ui.source.write("\x1b[200~ plus\nlast\x1b[201~");
    ui.source.write("\r");
    await expect(ui.answer).resolves.toBe("EDIT before first\nsecond plus\nlast");
    ui.source.destroy();
  });

  it("joins lines with Backspace and supports a manual newline", async () => {
    const ui = await composer();
    ui.source.write("\x1b[200~first\nsecond\x1b[201~");
    ui.source.write("\x1b[H\x7f");
    ui.source.write("\x1b[F");
    ui.source.write("\x0a");
    await delay(100);
    ui.source.write("third\r");
    await expect(ui.answer).resolves.toBe("firstsecond\nthird");
    ui.source.destroy();
  });

  it("restores multiline history without submitting it", async () => {
    const ui = await composer(["/team first\n  second"]);
    ui.source.write("\x1b[A");
    await delay(100);
    expect(ui.settled()).toBe(false);
    ui.source.write("\r");
    await expect(ui.answer).resolves.toBe("/team first\n  second");
    ui.source.destroy();
  });

  it("retains a long paste delivered slowly in separate chunks", async () => {
    const ui = await composer();
    const lines = Array.from({ length: 160 }, (_, index) => `line ${index}`);
    ui.source.write("\x1b[20");
    ui.source.write("0~" + lines.slice(0, 80).join("\n") + "\n");
    await delay(150);
    expect(ui.settled()).toBe(false);
    expect(ui.output()).not.toContain("line 0");
    ui.source.write(lines.slice(80).join("\n") + "\x1b[201~");
    expect(ui.output()).toContain("line 159");
    expect(ui.output()).not.toContain("> line 0");
    ui.source.write("\r");
    await expect(ui.answer).resolves.toBe(lines.join("\n"));
    ui.source.destroy();
  });

  it("restores paste mode and raw mode on cancellation", async () => {
    const ui = await composer();
    ui.source.write("\x03");
    await expect(ui.answer).rejects.toThrow("SIGINT");
    expect(ui.output()).toContain("\x1b[?2004l");
    expect(ui.source.isRaw).toBe(false);
    ui.source.destroy();
  });
});
