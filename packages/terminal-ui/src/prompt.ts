import { createPrompt, useState, useRef, useKeypress, useEffect, usePagination, isEnterKey } from "@inquirer/core";
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
  const [row, setRow] = useState(0);
  const cursor = useRef(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState("");
  const [width, setWidth] = useState(terminalWidth());
  const [rows, setRows] = useState(process.stdout.rows || 30);
  const [finished, setFinished] = useState(false);
  const lines = value.split("\n");
  const items = value.startsWith("/") && lines.length === 1 && !dismissed ? filterCommands(value) : [];
  const menuOpen = value.startsWith("/") && lines.length === 1 && !dismissed && !value.includes(" <");
  const pageSize = Math.min(9, Math.max(2, rows - 9));

  useEffect((rl) => {
    rl.output.unmute();
    rl.output.write("\x1b[?2004h");
    rl.output.mute();
    const resize = () => { setWidth(terminalWidth()); setRows(process.stdout.rows || 30); };
    process.stdout.on("resize", resize);
    return () => {
      process.stdout.off("resize", resize);
      rl.output.unmute();
      rl.output.write("\x1b[?2004l");
      rl.output.mute();
    };
  }, []);

  useKeypress((key, rl) => {
    const editor = rl as typeof rl & { cursor: number };
    const replace = (next: string, nextRow = next.split("\n").length - 1, column?: number) => {
      const line = next.split("\n")[nextRow] ?? "";
      editor.line = line;
      editor.cursor = Math.min(column ?? line.length, line.length);
      cursor.current = editor.cursor;
      setRow(nextRow);
      setValue(next);
    };
    const insert = (text: string, column = editor.cursor) => {
      const line = lines[row] ?? "";
      const inserted = (line.slice(0, column) + text).split("\n");
      const next = [...lines.slice(0, row), ...inserted.slice(0, -1), inserted.at(-1)! + line.slice(column), ...lines.slice(row + 1)];
      replace(next.join("\n"), row + inserted.length - 1, inserted.at(-1)!.length);
      setDismissed(true);
      setHistoryIndex(-1);
    };
    const paste = key as typeof key & { text?: string };
    if (key.name === "zuv-paste" && paste.text !== undefined) { insert(paste.text); return; }
    if ((key.ctrl && key.name === "j") || (key.shift && isEnterKey(key))) { insert("\n", cursor.current); return; }
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
      if (lines.length > 1) {
        const nextRow = Math.max(0, Math.min(lines.length - 1, row + (key.name === "up" ? -1 : 1)));
        replace(value, nextRow, cursor.current);
        return;
      }
      if (historyIndex === -1) setDraft(value);
      const next = Math.max(-1, Math.min(config.history.length - 1, historyIndex + (key.name === "up" ? 1 : -1)));
      setHistoryIndex(next);
      replace(next === -1 ? draft : config.history[next] ?? "");
      setDismissed(true);
      return;
    }
    if (row > 0 && cursor.current === 0 && (key.name === "backspace" || key.name === "left")) {
      const previous = lines[row - 1]!;
      if (key.name === "backspace") replace([...lines.slice(0, row - 1), previous + lines[row], ...lines.slice(row + 1)].join("\n"), row - 1, previous.length);
      else replace(value, row - 1, previous.length);
      return;
    }
    if (row < lines.length - 1 && cursor.current === lines[row]!.length && (key.name === "delete" || key.name === "right")) {
      if (key.name === "delete") replace([...lines.slice(0, row), lines[row]! + lines[row + 1], ...lines.slice(row + 2)].join("\n"), row, cursor.current);
      else replace(value, row + 1, 0);
      return;
    }
    if (rl.line !== lines[row]) { setActive(0); setDismissed(false); setHistoryIndex(-1); }
    cursor.current = editor.cursor;
    setValue([...lines.slice(0, row), rl.line, ...lines.slice(row + 1)].join("\n"));
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
  const visibleRows = Math.max(1, Math.min(9, rows - 8));
  const first = Math.max(0, Math.min(row - Math.floor(visibleRows / 2), lines.length - visibleRows));
  const last = Math.min(lines.length, first + visibleRows);
  const renderLine = (line: string, index: number) => `${index === 0 ? theme.accent("> ") : "  "}${fit(line, width - 2)}`;
  const before = lines.slice(first, row).map((line, offset) => renderLine(line, first + offset));
  const after = lines.slice(row + 1, last).map((line, offset) => renderLine(line, row + 1 + offset));
  if (first > 0) before.unshift(theme.muted(`  ... ${first} lines`));
  if (last < lines.length) after.push(theme.muted(`  ... ${lines.length - last} lines`));
  const content = [rule, ...before, `${row === 0 ? theme.accent("> ") : "  "}${lines[row]}`].join("\n");
  return [content, [...after, bottom].join("\n")];
}), { paste: true });
