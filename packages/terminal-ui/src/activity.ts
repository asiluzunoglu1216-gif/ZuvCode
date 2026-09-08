import { createPrompt, useEffect, useKeypress, usePrefix, useState, isEnterKey } from "@inquirer/core";
import type { AgentCallbacks, AgentProgress } from "@zuvcode/protocol";
import { terminalPrompt } from "./session.js";
import { fit, plain, terminalWidth, theme } from "./format.js";
import stringWidth from "string-width";
import chalk from "chalk";
import wrapAnsi from "wrap-ansi";

interface Approval { description: string; resolve: (approved: boolean) => void }
interface ActivityConfig {
  start: (callbacks: AgentCallbacks) => Promise<unknown>;
  controller: AbortController;
  events: AgentProgress[];
}

export const activityPrompt = terminalPrompt(createPrompt<{ value?: unknown; error?: unknown }, ActivityConfig>((config, done) => {
  const prefix = usePrefix({ status: "loading" });
  const [status, setStatus] = useState("Thinking");
  const [revision, setRevision] = useState(0);
  const [approval, setApproval] = useState<Approval | undefined>();
  const [allow, setAllow] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [team, setTeam] = useState(false);
  const [reveal, setReveal] = useState({ index: -1, characters: 0 });
  useEffect(() => {
    const start = Date.now();
    let pending: Approval | undefined;
    let active = true;
    let revealIndex = -1, characters = 0;
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    const animation = setInterval(() => {
      const event = config.events[revealIndex];
      if (active && event?.kind === "message" && characters < event.message.length) {
        characters += 18; setReveal({ index: revealIndex, characters });
      }
    }, 40);
    const abort = () => { pending?.resolve(false); pending = undefined; };
    config.controller.signal.addEventListener("abort", abort, { once: true });
    config.start({
      onProgress: (event) => {
        if (!active) return;
        if (event.kind === "status") setStatus(event.message);
        else {
          config.events.push(event);
          if (event.kind === "message") {
            setTeam(true); revealIndex = config.events.length - 1; characters = 18;
            setReveal({ index: revealIndex, characters });
            setStatus(`${event.speaker ?? "agent"} -> ${event.recipient ?? "team"}`);
          }
          if (event.kind === "tool_start") setStatus(event.message);
          setRevision((value) => value + 1);
        }
      },
      approve: (description) => {
        if (!active || config.controller.signal.aborted) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
          pending = { description, resolve: (approved) => { pending = undefined; setApproval(undefined); resolve(approved); } };
          setAllow(false);
          setApproval(pending);
        });
      }
    }).then((value) => done({ value }), (error: unknown) => done({ error }));
    return () => { active = false; clearInterval(timer); clearInterval(animation); config.controller.abort(); abort(); };
  }, []);
  useKeypress((key) => {
    if (key.name === "escape") {
      setStatus("Stopping");
      config.controller.abort(new Error("Cancelled. Completed file changes are preserved."));
      return;
    }
    if (!approval) return;
    if (["left", "right", "up", "down"].includes(key.name ?? "")) setAllow(!allow);
    if (isEnterKey(key)) approval.resolve(allow);
  });
  const width = terminalWidth();
  const rows = Math.max(2, Math.min(8, (process.stdout.rows || 30) - (approval ? 12 : 7)));
  const trail = activityLines(config.events, width - 4, { reveal, maxMessageLines: 3, maxRows: rows }).map((line) => `  ${fit(line, width - 4)}`).join("\n");
  void revision;
  const lines = [`  ${prefix} ${team ? `${theme.accent.bold("TEAM")}  ` : ""}${fit(plain(status), width - (team ? 20 : 14))} ${theme.muted(`${seconds}s`)}`, trail];
  if (approval) {
    const details = approval.description.split("\n").flatMap((line) => wrap(plain(line), width - 4));
    lines.push("", `  ${theme.accent.bold("Approval required")}`, ...details.map((line) => `  ${line}`), "",
      `  ${!allow ? theme.selected(" > Deny ") : "   Deny "}   ${allow ? theme.selected(" > Allow once ") : "   Allow once "}`);
  }
  return lines.filter((line) => line !== undefined).join("\n");
}));

export function activityLines(events: AgentProgress[], width = 100, options: { reveal?: { index: number; characters: number }; maxMessageLines?: number; maxRows?: number } = {}): string[] {
  const completed = new Set(events.filter((event) => event.kind === "tool_end").map((event) => event.callId));
  const blocks = events.map((event, index) => {
    if (event.kind === "status" || (event.kind === "tool_start" && completed.has(event.callId))) return [];
    if (event.kind === "message") {
      const name = plain(event.speaker ?? "agent"), target = plain(event.recipient ?? "team");
      const colors = ["#6AD6A6", "#91D2E8", "#E6CD85", "#EEA7B8"];
      const color = chalk.hex(colors[Array.from(name).reduce((sum, character) => sum + character.charCodeAt(0), 0) % colors.length]!);
      const intent = event.intent === "agreement" ? "AGREED" : event.intent === "objection" ? "CHANGES REQUESTED" : (event.intent ?? "message").toUpperCase();
      const identity = `${color.bold(name)} -> ${theme.muted(target)}`;
      const verdict = event.intent === "objection" ? theme.error(intent) : theme.muted(intent);
      const heading = `${identity}  ${verdict}`;
      const text = index === options.reveal?.index ? event.message.slice(0, options.reveal.characters) : event.message;
      const body = wrapAnsi(plain(text), Math.max(4, width - 2), { hard: true, trim: true }).split("\n");
      const visible = options.maxMessageLines ? body.slice(0, options.maxMessageLines) : body;
      if (visible.length < body.length) visible[visible.length - 1] = fit(visible.at(-1)! + "...", Math.max(4, width - 2));
      return [...(stringWidth(heading) <= width ? [heading] : [fit(identity, width), fit(verdict, width)]), ...visible.map((line) => `  ${line}`), ""];
    }
    const marker = event.kind === "tool_end" ? (event.ok ? "+" : "!") : event.kind === "tool_start" ? ">" : "-";
    return event.message.split("\n").map((line) => `${marker} ${plain(line)}`);
  });
  if (options.maxRows === undefined) return blocks.flat();
  const limit = Math.max(1, options.maxRows);
  const visible: string[] = [];
  // Keep speaker headers with their messages instead of exposing orphaned tail lines.
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index]!;
    if (!block.length) continue;
    if (block.length + visible.length > limit) {
      if (!visible.length) visible.push(...block.slice(0, limit));
      break;
    }
    visible.unshift(...block);
  }
  return visible;
}

export async function runActivity<T>(action: (signal: AbortSignal, callbacks: AgentCallbacks) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const events: AgentProgress[] = [];
  let work: Promise<T> | undefined;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return action(controller.signal, { onProgress: (event) => {
      if (event.kind !== "status") for (const line of activityLines([event], terminalWidth() - 4)) console.log(`  ${line}`);
    }, approve: async (description) => { console.log(`  Approval unavailable in non-interactive mode: ${plain(description)}`); return false; } });
  }
  try {
    const result = await activityPrompt({ controller, events,
      start: (callbacks) => { work = action(controller.signal, callbacks); return work; }
    }, { clearPromptOnDone: true });
    if (result.error !== undefined) throw result.error;
    return result.value as T;
  } finally {
    controller.abort();
    // Do not return to the input loop while cancelled writes or commands are still running.
    await work?.catch(() => undefined);
    for (const line of activityLines(events, terminalWidth() - 4)) console.log(`  ${fit(line, terminalWidth() - 4)}`);
    if (events.length) console.log();
  }
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const character of text) {
    if (stringWidth(line + character) > width && line) { lines.push(line); line = ""; }
    line += character;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
