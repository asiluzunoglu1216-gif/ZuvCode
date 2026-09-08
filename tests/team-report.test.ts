import { describe, expect, it } from "vitest";
import { stripVTControlCharacters } from "node:util";
import { renderFileHistory, renderTeamReport } from "../apps/cli/dist/render.js";
import type { TaskRecord } from "@zuvcode/persistence";

const task = (status: TaskRecord["status"], title: string, resultText = "") => ({
  id: title, title, status, resultText
} as TaskRecord);

describe("team completion report", () => {
  it("paginates persistent file history and wraps every line in a narrow terminal", () => {
    const before = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 42, configurable: true });
    try {
      const records = Array.from({ length: 9 }, (_, index) => ({ id: `${index}1234567`, createdAt: "2026-09-07T10:00:00Z", reason: "Before shell command", files: ["index.html"] }));
      const output = stripVTControlCharacters(renderFileHistory(records));
      expect(output.split("\n").every((line) => line.length <= 40)).toBe(true);
      expect(output).toContain("/changes history 2");
      expect(output).not.toContain("81234567");
      expect(renderFileHistory(records, 2)).toContain("81234567");
      expect(() => renderFileHistory(records, 3)).toThrow("page");
      expect(() => renderFileHistory(records, NaN)).toThrow("page");
    } finally { Object.defineProperty(process.stdout, "columns", { value: before, configurable: true }); }
  });

  it("does not present one completed engine as a finished application", () => {
    const output = renderTeamReport([task("complete", "Audio engine", "Very long component success report."),
      task("failed", "UI and canvas", "Invalid peer request"), task("queued", "Sequencer"), task("queued", "Integration and QA")], []);
    expect(output).toContain("TEAM INCOMPLETE");
    expect(output).toContain("1/4 tasks complete");
    expect(output).toContain("/team resume");
    expect(output).toContain("Invalid peer request");
    expect(output).not.toContain("Very long component success report");
    expect(output).not.toContain("TEAM TASKS COMPLETE");
  });

  it("shows the final integration result only after all assignments finish", () => {
    const output = renderTeamReport([task("complete", "Engine", "Component only"), task("complete", "Integration", "App integrated; real browser not verified.")], []);
    expect(output).toContain("TEAM TASKS COMPLETE");
    expect(output).toContain("App integrated; real browser not verified");
    expect(output).not.toContain("Component only");
  });

  it("keeps the final incomplete status readable in a narrow terminal", () => {
    const before = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 42, configurable: true });
    try {
      const output = stripVTControlCharacters(renderTeamReport([task("blocked", "UI", "Budget reached.")], []));
      const status = output.slice(output.indexOf("TEAM INCOMPLETE"));
      expect(status.split("\n").every((line) => line.length <= 40)).toBe(true);
      expect(status).toContain("Completed");
    } finally { Object.defineProperty(process.stdout, "columns", { value: before, configurable: true }); }
  });
});
