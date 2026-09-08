import type { ProviderRecord } from "@zuvcode/persistence";
import type { ChatMessage, ModelMetadata, ModelResponse, ToolDefinition } from "@zuvcode/protocol";

export interface ProviderChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  tools?: ToolDefinition[];
}

export class ToolCallingUnsupportedError extends Error {}

export interface AiProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderRecord["kind"];
  listModels(signal?: AbortSignal): Promise<ModelMetadata[]>;
  chat(request: ProviderChatRequest): Promise<ModelResponse>;
}

export interface ProviderStatusView {
  name: string;
  kind: ProviderRecord["kind"];
  group: "Cloud" | "Local" | "Custom";
  status: "Connected" | "Detected" | "Add" | "Not running" | "Unavailable";
  detail?: string;
}

export interface ProviderConnection {
  id: string;
  name: string;
  kind: ProviderRecord["kind"];
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKeySession?: string;
}
