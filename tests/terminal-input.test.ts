import { describe, expect, it } from "vitest";
import { render } from "@inquirer/testing";
import { commandPrompt, choose, filterCommands, slashCommandItems } from "@zuvcode/terminal-ui";

const config = { model: "AUTO", mode: "BALANCED", history: [] };

describe("interactive command input", () => {
  it("filters while typing without Enter, restores on backspace, and executes the selected command", async () => {
    const ui = await render(commandPrompt, config);
    ui.events.type("/");
    expect(ui.getScreen()).toContain("/connect");
    ui.events.type("m");
    expect(ui.getScreen()).toContain("/model");
    expect(ui.getScreen()).not.toContain("/connect");
    expect(ui.getScreen()).not.toContain("/providers");
    ui.events.keypress("backspace");
    expect(ui.getScreen()).toContain("/connect");
    ui.events.type("m");
    ui.events.keypress("down");
    ui.events.keypress("enter");
    await expect(ui.answer).resolves.toBe("/model");
  });

  it("completes with Tab and preserves editable command arguments", async () => {
    const ui = await render(commandPrompt, config);
    ui.events.type("/te");
    ui.events.keypress("tab");
    expect(ui.getScreen()).toContain("> /team");
    ui.events.type("build an API");
    ui.events.keypress("enter");
    await expect(ui.answer).resolves.toBe("/team build an API");
  });

  it("does not insert placeholder arguments when Enter accepts a command", async () => {
    const ui = await render(commandPrompt, config);
    ui.events.type("/te");
    ui.events.keypress("enter");
    expect(ui.getScreen()).toContain("> /team");
    expect(ui.getScreen()).not.toContain("<goal>");
    ui.events.type("my goal");
    ui.events.keypress("enter");
    await expect(ui.answer).resolves.toBe("/team my goal");
  });

  it("dismisses suggestions with Escape without erasing the input", async () => {
    const ui = await render(commandPrompt, config);
    ui.events.type("/m");
    ui.events.keypress("escape");
    expect(ui.getScreen()).not.toContain("Select, add");
    expect(ui.getScreen()).toContain("> /m");
    ui.events.keypress("enter");
    await expect(ui.answer).resolves.toBe("/m");
  });

  it("does not display unrelated commands for an unmatched prefix", async () => {
    const ui = await render(commandPrompt, config);
    ui.events.type("/zzzz");
    expect(ui.getScreen()).not.toContain("/connect");
    ui.events.keypress("enter");
    await expect(ui.answer).resolves.toBe("/zzzz");
  });

  it("keeps every registered command reachable and removes unimplemented placeholders", () => {
    expect(filterCommands("/")).toHaveLength(slashCommandItems.length);
    expect(filterCommands("/m").every((item) => item.command.startsWith("/m"))).toBe(true);
    expect(slashCommandItems.some((item) => item.summary.includes("placeholder"))).toBe(false);
  });

  it("restores the draft after browsing command history", async () => {
    const ui = await render(commandPrompt, { ...config, history: ["/doctor"] });
    ui.events.type("draft");
    ui.events.keypress("up");
    expect(ui.getScreen()).toContain("> /doctor");
    ui.events.keypress("down");
    ui.events.keypress("enter");
    await expect(ui.answer).resolves.toBe("draft");
  });

  it("supports searchable model selection and cancellation", async () => {
    const choices = [{ value: "a", name: "coder", description: "Local" }, { value: "b", name: "reasoner", description: "Cloud" }];
    const ui = await render(choose, { title: "Model", choices });
    ui.events.type("reason");
    expect(ui.getScreen()).not.toContain("coder");
    ui.events.keypress("enter");
    await expect(ui.answer).resolves.toBe("b");
    const cancelled = await render(choose, { title: "Model", choices });
    cancelled.events.keypress("escape");
    await expect(cancelled.answer).resolves.toBeUndefined();
  });

  it("resizes long provider and model labels to a narrow terminal", async () => {
    const previous = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 42, configurable: true });
    try {
      const ui = await render(choose, { title: "Model", choices: [{ value: "a", name: "A".repeat(160) }] });
      expect(ui.getScreen().split("\n").every((line) => line.length <= 40)).toBe(true);
      ui.events.keypress("escape");
      await ui.answer;
    } finally { Object.defineProperty(process.stdout, "columns", { value: previous, configurable: true }); }
  });
});
