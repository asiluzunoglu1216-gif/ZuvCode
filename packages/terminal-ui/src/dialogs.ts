import { createPrompt, useKeypress, useState, usePagination, isEnterKey, useEffect, usePrefix } from "@inquirer/core";
import { input, password } from "@inquirer/prompts";
import type { Prompt } from "@inquirer/type";
import { fit, pad, plain, terminalWidth, theme } from "./format.js";
import { terminalPrompt } from "./session.js";

export interface Choice {
  value: string;
  name: string;
  description?: string;
}

export const choose: Prompt<string | undefined, { title: string; choices: Choice[] }> = terminalPrompt(createPrompt<string | undefined, { title: string; choices: Choice[] }>((config, done) => {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [width, setWidth] = useState(terminalWidth());
  const items = config.choices.filter((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    const resize = () => setWidth(terminalWidth());
    process.stdout.on("resize", resize);
    return () => { process.stdout.off("resize", resize); };
  }, []);
  useKeypress((key, rl) => {
    if (key.name === "escape") { done(undefined); return; }
    if (isEnterKey(key) && items[active]) { done(items[active]!.value); return; }
    if ((key.name === "up" || key.name === "down") && items.length) {
      setActive((active + (key.name === "up" ? -1 : 1) + items.length) % items.length);
      return;
    }
    if (rl.line !== query) { setQuery(rl.line); setActive(0); }
  });
  const page = usePagination({
    items, active, pageSize: Math.max(2, Math.min(10, (process.stdout.rows || 30) - 8)), loop: true,
    renderItem: ({ item, isActive }) => {
      const description = item.description ? `  ${plain(item.description)}` : "";
      const line = pad(` ${isActive ? ">" : " "} ${plain(item.name)}${description}`, width);
      return isActive ? theme.selected(line) : line;
    }
  });
  return [`\n  ${theme.accent.bold(config.title)}\n\n  ${theme.muted("Search:")} ${query}`,
    `\n${page || theme.muted("  No matches")}\n\n${theme.muted(`  ${items.length} available`)}`];
}));

export async function ask(message: string, defaultValue?: string): Promise<string> {
  return terminalPrompt(input)({ message, ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    theme: { prefix: theme.accent(">"), style: { message: (text: string) => text } }
  }, { clearPromptOnDone: true });
}

export async function askSecret(message: string): Promise<string> {
  return terminalPrompt(password)({ message, mask: "*", theme: { prefix: theme.accent(">") } }, { clearPromptOnDone: true });
}

const progress = terminalPrompt(createPrompt<{ value?: unknown; error?: unknown }, { message: string; action: (signal: AbortSignal) => Promise<unknown> }>((config, done) => {
  const prefix = usePrefix({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    config.action(controller.signal).then((value) => done({ value }), (error: unknown) => done({ error }));
    return () => controller.abort();
  }, []);
  useKeypress((key) => {
    if (key.name === "escape") done({ error: new Error("Cancelled.") });
  });
  return `  ${prefix} ${fit(config.message, terminalWidth() - 5)}`;
}));

export async function busy<T>(message: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return action(new AbortController().signal);
  const result = await progress({ message, action }, { clearPromptOnDone: true });
  if (result.error !== undefined) throw result.error;
  return result.value as T;
}
