import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { ZuvCodeRuntime } from "@zuvcode/orchestration";

describe("provider setup across working directories", () => {
  it("discovers models, preserves the connection and selection, and sends chat to that model", async () => {
    mkdirSync(".tmp-tests", { recursive: true });
    const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "connection-"));
    const home = join(root, "user");
    const requests: Array<Record<string, unknown>> = [];
    const server = createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/models") { res.end(JSON.stringify({ data: [{ id: "test-coder" }, { id: "test-reasoner" }] })); return; }
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      res.end(JSON.stringify({ choices: [{ message: { content: "Model connected." } }], model: "test-reasoner" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const endpoint = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;
    const first = ZuvCodeRuntime.silent({ projectRoot: join(root, "project-a"), userConfigDir: home });
    let second: ZuvCodeRuntime | undefined;
    try {
      const provider = first.addProvider({ kind: "openai-compatible", name: "Test server", baseUrl: endpoint, apiKeyEnv: "ZuvCode_TEST_API_KEY" });
      const duplicate = first.addProvider({ kind: "openai-compatible", name: "Test server", baseUrl: endpoint });
      expect(duplicate.id).toBe(provider.id);
      expect(first.configuredProviders()).toHaveLength(1);
      const models = await first.discoverModels(provider.id);
      expect(models).toHaveLength(2);
      expect(models[0]?.locality).toBe("local");
      first.selectModel(models[1]!);
      second = ZuvCodeRuntime.silent({ projectRoot: join(root, "project-b"), userConfigDir: home });
      expect(second.configuredProviders()).toHaveLength(1);
      expect(second.selectedModel()).toBe("Test server/test-reasoner");
      expect(second.savedModels()).toHaveLength(2);
      second.selectModel(models[1]!);
      const response = await second.chat("hello");
      expect(response.text).toBe("Model connected.");
      expect(requests[0]?.model).toBe("test-reasoner");
      expect(JSON.stringify(requests[0]?.messages)).toContain("project-b");
      const manual = second.addModel({ providerName: "Test server", modelId: "manual-model" });
      second.selectModel(manual);
      expect(second.selectedModel()).toBe("Test server/manual-model");
      expect(readFileSync(join(home, "config.json"), "utf8")).not.toContain("Bearer");
    } finally {
      first.close(); second?.close(); server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  });
});
