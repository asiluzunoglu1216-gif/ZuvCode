import { describe, expect, it } from "vitest";
import { defaultProjectConfig, EventBus } from "@zuvcode/core";

describe("core", () => {
  it("creates a validated default project config", () => {
    const config = defaultProjectConfig();

    expect(config.schemaVersion).toBe(1);
    expect(config.permissionMode).toBe("SAFE");
    expect(config.protectedPaths).toContain(".env");
  });

  it("emits and stores recent events", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe("session.started", (event) => {
      seen.push(String(event.payload.project));
    });

    bus.emit("session.started", { project: "demo" });
    unsubscribe();
    bus.emit("session.started", { project: "ignored" });

    expect(seen).toEqual(["demo"]);
    expect(bus.recent(1)[0]?.payload.project).toBe("ignored");
  });
});
