import { stripVTControlCharacters } from "node:util";
import chalk from "chalk";
import { Marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";
import wrapAnsi from "wrap-ansi";
import { plain, table, terminalWidth, theme } from "./format.js";

export function renderMarkdown(markdown: string, columns = terminalWidth()): string {
  const width = Math.max(12, Math.floor(columns));
  const safe = stripVTControlCharacters(markdown).replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
  const parser = new Marked({ gfm: true });
  // The published typings call this a Renderer, but the package returns a Marked extension.
  parser.use(markedTerminal({
    showSectionPrefix: false, reflowText: false, width, emoji: false, tab: 2,
    firstHeading: theme.accent.bold.underline, heading: theme.accent.bold,
    strong: chalk.bold, em: chalk.italic, codespan: chalk.hex("#9BD9EC"),
    code: chalk.hex("#CFD8DC"), blockquote: theme.muted.italic,
    href: chalk.cyan.underline, link: chalk.cyan, html: theme.muted
  }) as unknown as MarkedExtension);
  parser.use({ renderer: {
    text(token) { return "tokens" in token && token.tokens ? this.parser.parseInline(token.tokens) : token.text; },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const target = plain(href);
      // Keep the real target visible and never emit terminal hyperlink/control sequences.
      if (!/^(?:https?:\/\/|mailto:)/i.test(target)) return label;
      return label === target ? chalk.cyan.underline(target) : `${label} (${chalk.cyan.underline(target)})`;
    },
    image({ href, text }) { return `${plain(text || "Image")} (${plain(href)})`; },
    table(token) {
      const cell = (tokens: Parameters<typeof this.parser.parseInline>[0]) => plain(this.parser.parseInline(tokens));
      return table(token.header.map((item) => cell(item.tokens)), token.rows.map((row) => row.map((item) => cell(item.tokens))), width) + "\n\n";
    },
    hr() { return theme.border("-".repeat(width)) + "\n\n"; }
  } });
  const rendered = parser.parse(safe, { async: false });
  return wrapAnsi(rendered.trimEnd(), width, { hard: true, trim: false });
}
