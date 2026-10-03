import { AsyncLocalStorage } from "node:async_hooks";
import { PassThrough } from "node:stream";
import type { Context, Prompt } from "@inquirer/type";
import { PasteDecoder } from "./paste.js";

export interface TerminalInput extends NodeJS.ReadableStream {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode(mode: boolean): unknown;
}

const sessions = new AsyncLocalStorage<TerminalInputSession>();

class TerminalInputSession {
  private activeInput: PassThrough | undefined;
  private receive: ((data: Buffer) => void) | undefined;
  private readonly wasRaw: boolean;
  private readonly forward = (data: Buffer) => { this.receive?.(data); };

  public constructor(private readonly source: TerminalInput) {
    this.wasRaw = source.isRaw ?? false;
    source.setRawMode(true);
    source.on("data", this.forward);
    source.resume();
  }

  public async prompt<Value, Config>(prompt: Prompt<Value, Config>, config: Config, context?: Context, paste = false): Promise<Value> {
    if (this.activeInput) throw new Error("Another terminal prompt is already active.");
    // Each readline gets its own decoder, while the Windows TTY stays in raw mode.
    // Closing/reopening the real TTY between asynchronous prompts can stall input.
    const input = new PassThrough();
    this.activeInput = input;
    const decoder = paste ? new PasteDecoder((text) => input.write(text), (text) => input.emit("keypress", "", { name: "zuv-paste", text })) : undefined;
    this.receive = (data) => { if (decoder) decoder.write(data); else input.write(data); };
    try { return await prompt(config, { ...context, input }); }
    finally {
      this.receive = undefined;
      decoder?.close();
      this.activeInput = undefined;
      input.destroy();
    }
  }

  public close(): void {
    this.source.off("data", this.forward);
    this.source.pause();
    this.source.setRawMode(this.wasRaw);
  }
}

export async function withTerminalSession<T>(action: () => Promise<T>, source: TerminalInput = process.stdin): Promise<T> {
  if (!source.isTTY || sessions.getStore()) return action();
  const session = new TerminalInputSession(source);
  try { return await sessions.run(session, action); }
  finally { session.close(); }
}

export function terminalPrompt<Value, Config>(prompt: Prompt<Value, Config>, options: { paste?: boolean } = {}): Prompt<Value, Config> {
  return (config, context) => {
    const session = sessions.getStore();
    return session && !context?.input ? session.prompt(prompt, config, context, options.paste) : prompt(config, context);
  };
}
