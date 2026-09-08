import { describe, expect, it } from "vitest";
import { PermissionEngine, classifyShellCommand, isProtectedPath } from "@zuvcode/permissions";

describe("permission engine", () => {
  it("protects secrets and production paths in balanced mode", () => {
    const permissions = new PermissionEngine({ mode: "BALANCED" });

    expect(permissions.evaluate({ kind: "read", riskLevel: "LOW", path: "src/index.ts" }).status).toBe("allowed");
    expect(permissions.evaluate({ kind: "write", riskLevel: "MEDIUM", path: ".env" }).status).toBe(
      "requires_approval"
    );
    expect(permissions.evaluate({ kind: "production", riskLevel: "HIGH" }).status).toBe("requires_approval");
  });

  it("matches protected glob paths", () => {
    expect(isProtectedPath("production/config.json", ["production/**"])).toBe(true);
    expect(isProtectedPath("src/config.json", ["production/**"])).toBe(false);
  });

  it("classifies destructive shell commands as critical", () => {
    expect(classifyShellCommand("git reset --hard HEAD")).toBe("CRITICAL");
    expect(classifyShellCommand("pnpm install")).toBe("MEDIUM");
  });
});

