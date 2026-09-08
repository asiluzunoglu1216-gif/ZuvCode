import { createPrompt, useState, useKeypress, useEffect, usePagination, isEnterKey } from "@inquirer/core";
import type { Prompt } from "@inquirer/type";
import { commandName, filterCommands } from "./help.js";
import { fit, pad, plain, terminalWidth, theme } from "./format.js";
import { terminalPrompt } from "./session.js";
import { permissionLabel } from "./permissions.js";

interface CommandPromptConfig {
  model: string;
  mode: string;
  history: string[];
}

export const commandPrompt: Prompt<string, CommandPromptConfig> = terminalPrompt(createPrompt<string, CommandPromptConfig>((config, done) => {
  const [value, setValue] = useState("");
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState("");
  const [width, setWidth] = useState(terminalWidth());
  const [rows, setRows] = useState(process.stdout.rows || 30);
  const [finished, setFinished] = useState(false);
  const items = value.startsWith("/") && !dismissed ? filterCommands(value) : [];
  const menuOpen = value.startsWith("/") && !dismissed && !value.includes(" <");
  const pageSize = Math.min(9, Math.max(2, rows - 9));

  useEffect(() => {
    const resize = () => { setWidth(terminalWidth()); setRows(process.stdout.rows || 30); };
    process.stdout.on("resize", resize);
    return () => { process.stdout.off("resize", resize); };
  }, []);

  useKeypress((key, rl) => {
    const replace = (next: string) => { rl.clearLine(0); rl.write(next); setValue(next); };
    if (key.ctrl && key.name === "d" && !value) { done("/exit"); return; }
    if (key.name === "escape") { setDismissed(true); return; }
    if (menuOpen && items.length && (key.name === "up" || key.name === "down")) {
      setActive((active + (key.name === "up" ? -1 : 1) + items.length) % items.length);
      return;
    }
    if (key.name === "tab" && items.length) {
      const item = items[active] ?? items[0]!;
      replace(commandName(item) + (item.acceptsArguments ? " " : ""));
      setActive(0);
      setDismissed(true);
      return;
    }
    if (isEnterKey(key)) {
      const item = items[active];
      if (menuOpen && item) {
        if (item.acceptsArguments && value.trim() !== commandName(item)) { replace(`${commandName(item)} `); setDismissed(true); return; }
        setFinished(true);
        done(commandName(item));
      } else if (value.trim()) { setFinished(true); done(value.trim()); }
      return;
    }
    if (!menuOpen && (key.name === "up" || key.name === "down")) {
      if (historyIndex === -1) setDraft(value);
      const next = Math.max(-1, Math.min(config.history.length - 1, historyIndex + (key.name === "up" ? 1 : -1)));
      setHistoryIndex(next);
      replace(next === -1 ? draft : config.history[next] ?? "");
      setDismissed(true);
      return;
    }
    if (rl.line !== value) { setActive(0); setDismissed(false); setHistoryIndex(-1); }
    setValue(rl.line);
  });

  const page = usePagination({
    items, active: Math.min(active, Math.max(0, items.length - 1)), pageSize, loop: true,
    renderItem: ({ item, isActive }) => {
      const nameWidth = Math.min(26, Math.floor(width * 0.46));
      const row = ` ${isActive ? ">" : " "} ${pad(item.command, nameWidth)} ${fit(item.summary, Math.max(0, width - nameWidth - 5))}`;
      return isActive ? theme.selected(pad(row, width)) : row;
    }
  });
  if (finished) return "";
  const rule = theme.border("\u2500".repeat(width));
  const mode = permissionLabel(config.mode);
  const modeStyle = config.mode === "FULL_ACCESS" ? theme.error.bold : theme.muted;
  const status = `  ${theme.muted(fit(plain(config.model), Math.max(1, width - mode.length - 7)))}  /  ${modeStyle(mode)}`;
  const bottom = menuOpen && items.length
    ? `${rule}\n${page}\n${theme.muted(`  ${items.length} command${items.length === 1 ? "" : "s"}`)}\n${status}`
    : `${rule}\n${status}`;
  return [`${rule}\n${theme.accent("> ")}${value}`, bottom];
}));
