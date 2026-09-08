import type { ProviderRecord } from "@zuvcode/persistence";
import type { ModelMetadata } from "@zuvcode/protocol";
import { createId, type ProviderKind } from "@zuvcode/shared";
import { OllamaProvider } from "./ollama-provider.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";
import { availableProviderEnvVar, SecretResolver } from "./secrets.js";
import type { AiProvider, ProviderConnection, ProviderStatusView } from "./types.js";

const cloudProviders: Array<{ name: string; kind: ProviderKind; defaultBaseUrl?: string }> = [
  { name: "OpenAI", kind: "openai", defaultBaseUrl: "https://api.openai.com/v1" },
  { name: "Anthropic", kind: "anthropic" },
  { name: "Google Gemini", kind: "google", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { name: "NVIDIA Build", kind: "nvidia", defaultBaseUrl: "https://integrate.api.nvidia.com/v1" },
  { name: "OpenRouter", kind: "openrouter", defaultBaseUrl: "https://openrouter.ai/api/v1" },
  { name: "DeepSeek", kind: "deepseek", defaultBaseUrl: "https://api.deepseek.com/v1" },
  { name: "Groq", kind: "groq", defaultBaseUrl: "https://api.groq.com/openai/v1" },
  { name: "Mistral", kind: "mistral", defaultBaseUrl: "https://api.mistral.ai/v1" },
  { name: "xAI", kind: "xai", defaultBaseUrl: "https://api.x.ai/v1" }
];

const localProviders: Array<{ name: string; kind: ProviderKind; defaultBaseUrl?: string }> = [
  { name: "Ollama", kind: "ollama", defaultBaseUrl: "http://localhost:11434" },
  { name: "LM Studio", kind: "lmstudio", defaultBaseUrl: "http://localhost:1234/v1" },
  { name: "llama.cpp", kind: "llamacpp" },
  { name: "vLLM", kind: "vllm" }
];

export class ProviderManager {
  public constructor(private readonly secrets: SecretResolver) {}

  public createProvider(record: ProviderRecord): AiProvider | undefined {
    const connection = toConnection(record);
    if (record.kind === "ollama") {
      return new OllamaProvider(connection);
    }

    if (supportsOpenAiCompatibleProtocol(record.kind)) {
      return new OpenAiCompatibleProvider(connection, this.secrets);
    }

    return undefined;
  }

  public createConfiguredProviders(records: ProviderRecord[]): AiProvider[] {
    return records
      .map((record) => this.createProvider(record))
      .filter((provider): provider is AiProvider => provider !== undefined);
  }

  public async listModels(records: ProviderRecord[]): Promise<ModelMetadata[]> {
    const providers = this.createConfiguredProviders(records);
    const collected: ModelMetadata[] = [];

    for (const provider of providers) {
      try {
        collected.push(...(await provider.listModels()));
      } catch {
        collected.push({
          provider: provider.name,
          id: `${provider.id}:unavailable`,
          displayName: `${provider.name} unavailable`,
          capabilities: { vision: false, toolCalling: false, structuredOutput: false, streaming: false },
          speed: "balanced",
          codingSuitability: "low",
          reasoningSuitability: "low",
          locality: provider.kind === "ollama" ? "local" : "cloud",
          availability: "unavailable"
        });
      }
    }

    return collected;
  }

  public listProviderStatus(records: ProviderRecord[]): ProviderStatusView[] {
    const configuredByKind = new Map(records.map((record) => [record.kind, record]));

    const cloud: ProviderStatusView[] = cloudProviders.map((provider) => {
      const configured = configuredByKind.get(provider.kind);
      const envVar = availableProviderEnvVar(provider.kind);
      const detected = envVar !== undefined;
      const status: ProviderStatusView = {
        name: provider.name,
        kind: provider.kind,
        group: "Cloud" as const,
        status: configured !== undefined ? connectionStatus(configured) : detected ? ("Detected" as const) : ("Add" as const)
      };
      const detail = configured?.baseUrl ?? (envVar !== undefined && detected ? `env:${envVar}` : undefined);
      if (detail !== undefined) {
        status.detail = detail;
      }
      return status;
    });

    const local: ProviderStatusView[] = localProviders.map((provider) => {
      const configured = configuredByKind.get(provider.kind);
      const status: ProviderStatusView = {
        name: provider.name,
        kind: provider.kind,
        group: "Local" as const,
        status: configured !== undefined ? connectionStatus(configured) : ("Add" as const)
      };
      const detail = configured?.baseUrl ?? provider.defaultBaseUrl;
      if (detail !== undefined) {
        status.detail = detail;
      }
      return status;
    });

    const custom: ProviderStatusView[] = records
      .filter((record) => record.kind === "openai-compatible")
      .map((record) => {
        const status: ProviderStatusView = {
          name: record.name,
          kind: record.kind,
          group: "Custom" as const,
          status: connectionStatus(record)
        };
        if (record.baseUrl !== undefined) {
          status.detail = record.baseUrl;
        }
        return status;
      });

    return [...cloud, ...local, ...custom];
  }
}

function connectionStatus(record: ProviderRecord): ProviderStatusView["status"] {
  if (record.status === "connected") return "Connected";
  if (record.status === "not_running") return "Not running";
  if (record.status === "unavailable") return "Unavailable";
  return "Detected";
}

export function providerDefaults(kind: ProviderKind): ProviderConnection {
  const provider = [...cloudProviders, ...localProviders].find((candidate) => candidate.kind === kind);
  const connection: ProviderConnection = {
    id: createId("provider"),
    name: provider?.name ?? "Custom Provider",
    kind
  };
  if (provider?.defaultBaseUrl !== undefined) {
    connection.baseUrl = provider.defaultBaseUrl;
  }
  return connection;
}

function supportsOpenAiCompatibleProtocol(kind: ProviderKind): boolean {
  return ["openai", "google", "nvidia", "openrouter", "deepseek", "groq", "mistral", "xai", "lmstudio", "vllm", "openai-compatible"].includes(
    kind
  );
}

function toConnection(record: ProviderRecord): ProviderConnection {
  const connection: ProviderConnection = {
    id: record.id,
    name: record.name,
    kind: record.kind
  };

  const baseUrl = record.baseUrl ?? providerDefaults(record.kind).baseUrl;
  if (baseUrl !== undefined) {
    connection.baseUrl = baseUrl;
  }
  if (record.apiKeyEnv !== undefined) {
    connection.apiKeyEnv = record.apiKeyEnv;
  }
  if (record.apiKeySession !== undefined) {
    connection.apiKeySession = record.apiKeySession;
  }

  return connection;
}
