import {
  ModelNotFoundError,
  ProviderAuthenticationError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  createId
} from "@zuvcode/shared";
import type { ChatMessage, ModelMetadata, ModelResponse } from "@zuvcode/protocol";
import type { AiProvider, ProviderChatRequest, ProviderConnection } from "./types.js";
import { ToolCallingUnsupportedError } from "./types.js";
import { SecretResolver, type SecretRef } from "./secrets.js";

interface OpenAiModelListResponse {
  data?: Array<{ id?: string; object?: string; owned_by?: string }>;
}

interface OpenAiChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAiCompatibleProvider implements AiProvider {
  public readonly id: string;
  public readonly name: string;
  public readonly kind: ProviderConnection["kind"];
  private readonly baseUrl: string;
  private readonly secretRef?: SecretRef;

  public constructor(
    connection: ProviderConnection,
    private readonly secrets: SecretResolver
  ) {
    this.id = connection.id;
    this.name = connection.name;
    this.kind = connection.kind;
    this.baseUrl = normalizeBaseUrl(connection.baseUrl ?? "https://api.openai.com/v1");

    if (connection.apiKeyEnv !== undefined) {
      this.secretRef = { kind: "env", name: connection.apiKeyEnv };
    } else if (connection.apiKeySession !== undefined) {
      this.secretRef = { kind: "session", id: connection.apiKeySession };
    }
  }

  public async listModels(signal?: AbortSignal): Promise<ModelMetadata[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
    });

    await assertProviderResponse(response);
    const body = (await response.json()) as OpenAiModelListResponse;
    return (body.data ?? [])
      .filter((model) => typeof model.id === "string")
      .map((model) => ({
        provider: this.name,
        id: String(model.id),
        displayName: String(model.id),
        capabilities: {
          vision: /vision|gpt-4o|omni|gemini/i.test(String(model.id)),
          toolCalling: true,
          structuredOutput: true,
          streaming: true
        },
        speed: "balanced" as const,
        codingSuitability: inferCodingSuitability(String(model.id)),
        reasoningSuitability: inferReasoningSuitability(String(model.id)),
        locality: ["lmstudio", "vllm", "llamacpp"].includes(this.kind) || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(this.baseUrl) ? "local" as const : "cloud" as const,
        availability: "available" as const
      }));
  }

  public async chat(request: ProviderChatRequest): Promise<ModelResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      headers: {
        ...this.headers(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(openAiMessage),
        ...(request.tools?.length ? { tools: request.tools } : {}),
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens
      })
    });

    if (response.status === 400 && request.tools?.length) {
      const detail = await response.text();
      if (/((tools?|function).*(not supported|unsupported|not allowed))|((not support|unsupported|unknown parameter).*(tools?|function))/i.test(detail)) {
        throw new ToolCallingUnsupportedError("Provider does not support native tools; using JSON actions.");
      }
      throw new ProviderUnavailableError("Provider rejected the chat request (HTTP 400). Check the model ID and endpoint compatibility.");
    }
    await assertProviderResponse(response);
    const body = (await response.json()) as OpenAiChatResponse;
    const choice = body.choices?.[0];
    if (choice === undefined) {
      throw new ModelNotFoundError("Provider returned no choices");
    }

    const modelResponse: ModelResponse = {
      id: body.id ?? createId("model-response"),
      provider: this.name,
      model: body.model ?? request.model,
      text: choice.message?.content ?? "",
      toolCalls: (choice.message?.tool_calls ?? []).map((toolCall) => ({
        id: toolCall.id ?? createId("tool-call"),
        name: toolCall.function?.name ?? "unknown",
        argumentsJson: toolCall.function?.arguments ?? "{}"
      })),
      finishReason: normalizeFinishReason(choice.finish_reason)
    };
    // Keep opaque provider metadata, including Gemini tool-call signatures, in history only.
    if (choice.message) modelResponse.providerMessage = {
      ...choice.message,
      ...(choice.message.tool_calls?.length ? { tool_calls: choice.message.tool_calls.map((call, index) => ({
        ...call, id: modelResponse.toolCalls[index]!.id, type: "function"
      })) } : {})
    };

    if (body.usage !== undefined) {
      modelResponse.usage = {
        inputTokens: body.usage.prompt_tokens ?? 0,
        outputTokens: body.usage.completion_tokens ?? 0,
        totalTokens: body.usage.total_tokens ?? 0
      };
    }

    return modelResponse;
  }

  private headers(): Record<string, string> {
    const apiKey = this.secrets.resolve(this.secretRef);
    if (apiKey === undefined || apiKey.length === 0) {
      return {};
    }

    return { authorization: `Bearer ${apiKey}` };
  }
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function openAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.providerMessage && message.role === "assistant") {
    return { ...message.providerMessage, role: "assistant" };
  }
  return {
    role: message.role, content: message.content,
    ...(message.name && message.role !== "tool" ? { name: message.name } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({
      id: call.id, type: "function", function: { name: call.name, arguments: call.argumentsJson }
    })) } : {})
  };
}

async function assertProviderResponse(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderAuthenticationError(`Provider authentication failed with HTTP ${response.status}`);
  }

  if (response.status === 429) {
    throw new ProviderRateLimitError("Provider rate limit reached");
  }

  throw new ProviderUnavailableError(`Provider request failed with HTTP ${response.status}`);
}

function inferCodingSuitability(modelId: string): "low" | "medium" | "high" {
  return /code|gpt-4|gpt-5|claude|deepseek|qwen|coder/i.test(modelId) ? "high" : "medium";
}

function inferReasoningSuitability(modelId: string): "low" | "medium" | "high" {
  return /reason|thinking|o\d|gpt-5|claude|gemini.*pro|deepseek/i.test(modelId) ? "high" : "medium";
}

function normalizeFinishReason(value: string | undefined): ModelResponse["finishReason"] {
  if (value === "length") {
    return "length";
  }
  if (value === "tool_calls") {
    return "tool_calls";
  }
  if (value === "content_filter") {
    return "content_filter";
  }
  return "stop";
}
