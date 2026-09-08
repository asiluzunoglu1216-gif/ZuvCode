import { describe, expect, it } from "vitest";
import chalk from "chalk";
import { stripVTControlCharacters } from "node:util";
import { renderMarkdown } from "@zuvcode/terminal-ui";

describe("terminal Markdown", () => {
  it("renders the reported heading and bold text instead of showing Markdown markers", () => {
    const before = chalk.level;
    chalk.level = 3;
    try {
      const output = renderMarkdown("### Yapilanlar\n1. **Original quality:** Restored.\n2. **Production:** Deployed.");
      expect(output).toContain("\x1b[1m");
      expect(output).toMatch(/\x1b\[(?:3\d|38;)\w*/);
      expect(stripVTControlCharacters(output)).toContain("1. Original quality:");
      expect(output).not.toContain("###");
      expect(output).not.toContain("**");
    } finally { chalk.level = before; }
  });

  it("preserves fenced code, inline code, emphasis and link destinations", () => {
    const output = stripVTControlCharacters(renderMarkdown("# Result\n*Ready* with `index.html`.\n\n```js\nconst marker = '**literal**';\n```\n\n[Docs](https://example.com/a+b?q=1)"));
    expect(output).toContain("const marker = '**literal**';");
    expect(output).not.toContain("```js");
    expect(output).toContain("index.html");
    expect(output).toContain("https://example.com/a+b?q=1");
    expect(output).not.toContain("*Ready*");
  });

  it.each([20, 40, 98])("wraps paragraphs, headings, code and tables inside %i columns", (width) => {
    const sample = "# A long heading with several words\n\n" + "A paragraph with bold **important information**. ".repeat(5)
      + "\n\n```text\n" + "x".repeat(180) + "\n```\n\n| File | Result |\n| --- | --- |\n| src/some-long-file-name.ts | Verified |";
    const lines = stripVTControlCharacters(renderMarkdown(sample, width)).split("\n");
    expect(lines.every((line) => line.length <= width)).toBe(true);
    expect(lines.join(" ")).toContain("Verified");
  });

  it("removes untrusted terminal controls and never emits hidden hyperlink targets", () => {
    const output = renderMarkdown("\x1b[2J# Title\n\x1b]0;hijack\x07**Safe**\n[Click](javascript:alert%281%29)");
    expect(output).not.toContain("\x1b[2J");
    expect(output).not.toContain("\x1b]");
    expect(output).not.toContain("javascript:");
    expect(stripVTControlCharacters(output)).toContain("Safe");
  });
});
