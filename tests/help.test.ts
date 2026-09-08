import { describe, expect, it } from "vitest";
import { helpText, renderCommandPalette, slashCommands } from "@zuvcode/terminal-ui";

describe("terminal help", () => {
  it("renders all slash commands in the command palette", () => {
    const palette = renderCommandPalette();

    expect(palette).toContain("/connect");
    expect(palette).toContain("/model");
    expect(palette).toContain("/team");
    expect(slashCommands).toHaveLength(13);
    expect(new Set(slashCommands).size).toBe(13);
    for (const removed of ["/models", "/provider add", "/agent", "/agents", "/run", "/auto", "/new", "/project", "/plan", "/izin"]) expect(slashCommands).not.toContain(removed);
    expect(helpText("team")).toContain("/team resume");
  });

  it("uses the command palette for general help", () => {
    expect(helpText()).toContain("Commands");
  });
});
