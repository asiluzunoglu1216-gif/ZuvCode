import { describe, expect, it } from "vitest";
import { AutoModelRouter, builtinModelRegistry } from "@zuvcode/model-router";

describe("auto model router", () => {
  it("selects a coding-suitable model for coding tasks", () => {
    const router = new AutoModelRouter(builtinModelRegistry());
    const decision = router.route({ taskKind: "coding", budgetMode: "balanced" });

    expect(decision).toBeDefined();
    expect(decision?.model.codingSuitability).toBe("high");
  });

  it("can prefer local models", () => {
    const router = new AutoModelRouter(builtinModelRegistry());
    const decision = router.route({ taskKind: "coding", preferLocal: true });

    expect(decision?.model.locality).toBe("local");
  });
});

