import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@zuvcode/persistence";
import { createSilentLogger } from "@zuvcode/shared";

const roots: string[] = [];
const testRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(testRoot, { recursive: true });

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("state store", () => {
  it("persists project, provider, agent, and task records", () => {
    const root = mkdtempSync(join(testRoot, "zuvcode-store-"));
    roots.push(root);
    const store = new StateStore({ projectRoot: root, logger: createSilentLogger() });
    store.initialize();

    const project = store.ensureProject(root, "sample");
    const session = store.createSession(project.id);
    const provider = store.upsertProvider({
      kind: "ollama",
      name: "Ollama",
      baseUrl: "http://localhost:11434",
      status: "connected"
    });
    const agent = store.createAgent({
      name: "coder",
      role: "Coder",
      systemInstructions: "Implement code",
      selectedModel: "AUTO"
    });
    const task = store.createTask({
      title: "Build",
      description: "Build the project",
      ownerAgentId: agent.id,
      status: "ready"
    });

    expect(session.projectId).toBe(project.id);
    expect(provider.name).toBe("Ollama");
    expect(store.listAgents()).toHaveLength(1);
    expect(store.listTasks()[0]?.id).toBe(task.id);

    store.close();
  });
});
