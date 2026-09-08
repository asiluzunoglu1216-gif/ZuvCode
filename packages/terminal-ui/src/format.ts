import chalk from "chalk";
import sliceAnsi from "slice-ansi";
import stringWidth from "string-width";
import { stripVTControlCharacters } from "node:util";
import { renderWordmark } from "./wordmark.js";
import { zuvCodeVersion } from "@zuvcode/shared";

export const theme = {
  accent: chalk.hex("#6AD6A6"),
  muted: chalk.hex("#929292"),
  border: chalk.hex("#555555"),
  selected: chalk.bgHex("#243B32").hex("#B6F1D2"),
  error: chalk.hex("#F58D8D")
};

export function terminalWidth(): number {
  return Math.max(20, Math.min(100, (process.stdout.columns || 80) - 2));
}

export function plain(value: string): string {
  return stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f]/g, " ");
}

export function fit(value: string, width: number): string {
  if (width <= 0) return "";
  return stringWidth(value) <= width ? value : `${sliceAnsi(value, 0, Math.max(0, width - 1))}\u2026`;
}

export function pad(value: string, width: number): string {
  const clipped = fit(value, width);
  return clipped + " ".repeat(Math.max(0, width - stringWidth(clipped)));
}

export function banner(): string {
  return `${renderWordmark(terminalWidth())}\n  ${theme.muted(`ZuvCode  v${zuvCodeVersion}`)}`;
}

export function table(headers: string[], rows: string[][], available = terminalWidth()): string {
  const cleaned = rows.map((row) => row.map(plain));
  const widths = headers.map((header, index) => Math.max(header.length, ...cleaned.map((row) => stringWidth(row[index] ?? ""))));
  if (widths.reduce((a, b) => a + b, 0) + (headers.length - 1) * 2 > available) {
    return cleaned.map((row) => row.map((cell, index) => {
      const label = index === 0 ? "" : `${headers[index]}: `;
      return `  ${fit(label + cell, available - 2)}`;
    }).join("\n")).join("\n\n");
  }
  const renderRow = (row: string[]) => row.map((cell, index) => pad(cell, widths[index] ?? 0)).join("  ");
  return [theme.muted(renderRow(headers)), ...cleaned.map(renderRow)].join("\n");
}

export function section(title: string, body: string): string {
  return `\n${theme.accent.bold(title)}\n\n${body}\n`;
}

export function panel(title: string, rows: Array<[string, string]>): string {
  return section(title, table(["", ""], rows));
}
