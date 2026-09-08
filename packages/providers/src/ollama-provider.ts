import { createId, ProviderUnavailableError } from "@zuvcode/shared";
import type { ModelMetadata, ModelResponse } from "@zuvcode/protocol";
import type { AiProvider, ProviderChatRequest, ProviderConnection } from "./types.js";
import { ToolCallingUnsupportedError } from "./types.js";

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string; details?: { parameter_size?: string } }>;
}

interface OllamaChatResponse {
  model?: string;
  message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements AiProvider {
  public readonly id: string;
  public readonly name: string;
  public readonly kind = "ollama" as const;
  private readonly baseUrl: string;

  public constructor(connection: ProviderConnection) {
    this.id = connection.id;
    this.name = connection.name;
    this.baseUrl = normalizeBaseUrl(connection.baseUrl ?? "http://localhost:11434");
  }

  public async listModels(signal?: AbortSignal): Promise<ModelMetadata[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new ProviderUnavailableError(`Ollama returned HTTP ${response.status}`);
    }

    const body = (await response.json()) as OllamaTagsResponse;
    return (body.models ?? [])
      .map((model) => model.name ?? model.model)
      .filter((model): model is string => typeof model === "string" && model.length > 0)
      .map((model) => ({
        provider: this.name,
        id: model,
        displayName: model,
        capabilities: {
          vision: /llava|vision|bakllava/i.test(model),
          toolCalling: false,
          structuredOutput: false,
          streaming: true
        },
        speed: "balanced" as const,
        codingSuitability: /code|coder|deepseek|qwen/i.test(model) ? ("high" as const) : ("medium" as const),
        reasoningSuitability: /reason|deepseek|qwen|llama3/i.test(model) ? ("high" as const) : ("medium" as const),
        locality: "local" as const,
        availability: "available" as const
      }));
  }

  public async chat(request: ProviderChatRequest): Promise<ModelResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        messages: request.messages.map((message) => {
          if (message.providerMessage && message.role === "assistant") return { ...message.providerMessage, role: "assistant" };
          return { role: message.role, content: message.content,
            ...(message.name ? { tool_name: message.name } : {}),
            ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({
              function: { name: call.name, arguments: JSON.parse(call.argumentsJson) }
            })) } : {}) };
        }),
        ...(request.tools?.length ? { tools: request.tools } : {})
      })
    });

    if (!response.ok) {
      if (response.status === 400 && request.tools?.length && /does not support tools|tools.*not supported/i.test(await response.text())) {
        throw new ToolCallingUnsupportedError("This Ollama model needs JSON actions instead of native tools.");
      }
      throw new ProviderUnavailableError(`Ollama returned HTTP ${response.status}`);
    }

    const body = (await response.json()) as OllamaChatResponse;
    const inputTokens = body.prompt_eval_count ?? 0;
    const outputTokens = body.eval_count ?? 0;
    return {
      id: createId("model-response"),
      provider: this.name,
      model: body.model ?? request.model,
      text: body.message?.content ?? "",
      toolCalls: (body.message?.tool_calls ?? []).map((call) => ({
        id: createId("tool-call"), name: call.function.name,
        argumentsJson: typeof call.function.arguments === "string" ? call.function.arguments : JSON.stringify(call.function.arguments)
      })),
      ...(body.message ? { providerMessage: body.message } : {}),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      finishReason: body.message?.tool_calls?.length ? "tool_calls" : body.done === false ? "length" : "stop"
    };
  }
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
