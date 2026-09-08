import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ZuvCodeRuntime } from "@zuvcode/orchestration";

const roots: string[] = [];
const testRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(testRoot, { recursive: true });

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("zuvcode runtime", () => {
  it("initializes a project and creates a persistent plan", () => {
    const root = mkdtempSync(join(testRoot, "zuvcode-runtime-"));
    roots.push(root);
    const runtime = ZuvCodeRuntime.silent({ projectRoot: root });

    const doctor = runtime.doctor();
    const plan = runtime.plan("Build a simple TypeScript REST API in the current project.");

    expect(doctor.databasePath).toContain("state.db");
    expect(plan.definitionOfDone).toHaveLength(8);
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(runtime.listTasks().length).toBe(plan.tasks.length);

    runtime.close();
  });

  it("adds providers without storing plaintext secrets", () => {
    const root = mkdtempSync(join(testRoot, "zuvcode-provider-"));
    roots.push(root);
    const runtime = ZuvCodeRuntime.silent({ projectRoot: root });

    const provider = runtime.addProvider({
      kind: "openai-compatible",
      name: "Local AI",
      baseUrl: "http://localhost:1234/v1",
      apiKeyEnv: "LOCAL_AI_KEY"
    });

    expect(provider.apiKeyEnv).toBe("LOCAL_AI_KEY");
    expect(JSON.stringify(provider)).not.toContain("sk-");

    runtime.close();
  });

  it("adds manual models to the registry", async () => {
    const root = mkdtempSync(join(testRoot, "zuvcode-model-"));
    roots.push(root);
    const runtime = ZuvCodeRuntime.silent({ projectRoot: root });

    const model = runtime.addModel({
      providerName: "Ollama",
      providerKind: "ollama",
      modelId: "llama3.1:8b",
      locality: "local",
      codingSuitability: "high",
      reasoningSuitability: "medium"
    });
    const models = await runtime.listModels();

    expect(model.provider).toBe("Ollama");
    expect(models.some((item) => item.provider === "Ollama" && item.id === "llama3.1:8b")).toBe(true);

    runtime.close();
  });

  it("runs the first milestone simple TypeScript REST API flow", async () => {
    const root = mkdtempSync(join(testRoot, "zuvcode-api-flow-"));
    roots.push(root);
    const runtime = ZuvCodeRuntime.silent({ projectRoot: root, permissionMode: "BALANCED" });
    try {
      const result = await runtime.runGoal("Build a simple TypeScript REST API in the current project");
      expect(result.execution?.ok).toBe(true);
      expect(result.evidence.join("\n")).toContain("TypeScript compile passed");
      expect(result.plan.definitionOfDone.filter((item) => item.verified).length).toBeGreaterThanOrEqual(6);
    } finally { runtime.close(); }
  }, 20000);
});
