import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ZuvCodeRuntime } from "@zuvcode/orchestration";
import { availableProviderEnvVar, detectCredentialEnv, providerDefaults, providerEnvVar, ProviderManager, SecretResolver } from "../packages/providers/dist/index.js";
import { connectionPresets } from "../apps/cli/dist/connect.js";

const providers = [
  { kind: "google", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", env: "GEMINI_API_KEY", model: "gemini-test-flash" },
  { kind: "nvidia", name: "NVIDIA Build", baseUrl: "https://integrate.api.nvidia.com/v1", env: "NVIDIA_API_KEY", model: "nvidia/test-coder" }
] as const;

describe("Gemini and NVIDIA Build presets", () => {
  it("offers both real adapters with official defaults in the connect menu", () => {
    for (const provider of providers) {
      expect(connectionPresets).toContainEqual({ kind: provider.kind, name: provider.name });
      expect(providerDefaults(provider.kind)).toMatchObject({ kind: provider.kind, name: provider.name, baseUrl: provider.baseUrl });
      expect(providerEnvVar(provider.kind)).toBe(provider.env);
    }
    expect(new Set(connectionPresets.map((item) => item.kind)).size).toBe(connectionPresets.length);
  });

  it("uses provider-specific URLs for older saved connections without an explicit endpoint", async () => {
    const request = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", request);
    try {
      const manager = new ProviderManager(new SecretResolver());
      for (const provider of providers) {
        const adapter = manager.createProvider({ id: provider.kind, kind: provider.kind, name: provider.name, status: "detected" });
        expect(adapter).toBeDefined();
        await adapter!.listModels();
        expect(request.mock.lastCall?.[0]).toBe(`${provider.baseUrl}/models`);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it("detects NVIDIA and either Gemini key variable without mixing providers", () => {
    try {
      vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("GOOGLE_API_KEY", "google-test"); vi.stubEnv("NVIDIA_API_KEY", "nvidia-test");
      expect(availableProviderEnvVar("google")).toBe("GOOGLE_API_KEY");
      expect(availableProviderEnvVar("nvidia")).toBe("NVIDIA_API_KEY");
      expect(detectCredentialEnv()).toContainEqual({ envVar: "NVIDIA_API_KEY", present: true });
      const statuses = new ProviderManager(new SecretResolver()).listProviderStatus([]);
      expect(statuses.find((p) => p.kind === "google")).toMatchObject({ status: "Detected", detail: "env:GOOGLE_API_KEY" });
      expect(statuses.find((p) => p.kind === "nvidia")).toMatchObject({ status: "Detected", detail: "env:NVIDIA_API_KEY" });
      vi.stubEnv("GEMINI_API_KEY", "gemini-preferred");
      expect(availableProviderEnvVar("google")).toBe("GEMINI_API_KEY");
      vi.stubEnv("GOOGLE_API_KEY", ""); vi.stubEnv("GEMINI_API_KEY", "");
      expect(availableProviderEnvVar("google")).toBeUndefined();
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(providers)("$name discovers models, remembers a key across folders, and completes real tool work", async (provider) => {
    mkdirSync(".tmp-tests", { recursive: true });
    const root = mkdtempSync(join(process.cwd(), ".tmp-tests", `preset-${provider.kind}-`));
    const home = join(root, "user");
    const key = `fixture-only-${provider.kind}-secret`;
    const first = ZuvCodeRuntime.silent({ projectRoot: join(root, "project-a"), userConfigDir: home });
    let firstClosed = false;
    let second: ZuvCodeRuntime | undefined;
    const seen: Array<{ url: string; body?: Record<string, unknown> }> = [];
    let chat = 0;
    const signature = { google: { thought_signature: "opaque-signature" } };
    const request = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      expect(new Headers(options?.headers).get("authorization")).toBe(`Bearer ${key}`);
      if (url === `${provider.baseUrl}/models`) {
        seen.push({ url });
        return Response.json({ data: [{ id: provider.model }] });
      }
      expect(url).toBe(`${provider.baseUrl}/chat/completions`);
      const body = JSON.parse(String(options?.body)); seen.push({ url, body });
      expect(body.model).toBe(provider.model);
      expect(body.tools.some((t: { function: { name: string } }) => t.function.name === "write_file")).toBe(true);
      if (chat++ === 0) return Response.json({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{
        id: "preset-call", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "connected.html", content: "<h1>Connected</h1>" }) },
        ...(provider.kind === "google" ? { extra_content: signature } : {})
      }] } }] });
      expect(body.messages.find((m: { role: string }) => m.role === "tool")).toMatchObject({ tool_call_id: "preset-call" });
      if (provider.kind === "google") expect(body.messages.find((m: { role: string }) => m.role === "assistant").tool_calls[0].extra_content).toEqual(signature);
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Created connected.html." } }] });
    });
    vi.stubGlobal("fetch", request);
    try {
      const connection = first.addProvider({ kind: provider.kind, apiKey: key });
      const models = await first.discoverModels(connection.id);
      expect(models).toHaveLength(1); expect(models[0]?.locality).toBe("cloud");
      first.selectModel(models[0]!); first.close(); firstClosed = true;
      second = ZuvCodeRuntime.silent({ projectRoot: join(root, "project-b"), userConfigDir: home, permissionMode: "BALANCED" });
      expect(second.selectedModel()).toBe(`${provider.name}/${provider.model}`);
      expect(second.configuredProviders()).toHaveLength(1);
      const duplicate = second.addProvider({ kind: provider.kind });
      expect(duplicate.id).toBe(connection.id);
      expect((await second.chat("Create connected.html")).text).toBe("Created connected.html.");
      expect(readFileSync(join(root, "project-b", "connected.html"), "utf8")).toBe("<h1>Connected</h1>");
      expect(readFileSync(join(home, "config.json"), "utf8")).not.toContain(key);
      expect(seen).toHaveLength(3);
      request.mockResolvedValueOnce(Response.json({ error: "bad key" }, { status: 401 }));
      await expect(second.discoverModels(connection.id)).rejects.toThrow("authentication failed");
    } finally {
      vi.unstubAllGlobals(); if (!firstClosed) first.close(); second?.close(); rmSync(root, { recursive: true, force: true });
    }
  });
});
