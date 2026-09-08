import type { ModelMetadata } from "@zuvcode/protocol";

export function builtinModelRegistry(): ModelMetadata[] {
  return [
    cloud("OpenAI", "gpt-5", "GPT-5", 400_000, "high", "high", true),
    cloud("OpenAI", "gpt-4.1", "GPT-4.1", 1_000_000, "high", "high", true),
    cloud("OpenRouter", "openrouter/auto", "OpenRouter Auto", undefined, "medium", "medium", true),
    cloud("DeepSeek", "deepseek-chat", "DeepSeek Chat", 64_000, "high", "high", true),
    cloud("Groq", "llama-3.3-70b-versatile", "Llama 3.3 70B Versatile", 128_000, "medium", "medium", true),
    cloud("Mistral", "mistral-large-latest", "Mistral Large", 128_000, "medium", "high", true),
    cloud("xAI", "grok-4", "Grok 4", 256_000, "medium", "high", true),
    local("Ollama", "qwen2.5-coder", "Qwen Coder via Ollama", 128_000, "high", "medium"),
    local("LM Studio", "local-openai-compatible", "LM Studio Local Model", undefined, "medium", "medium")
  ];
}

function cloud(
  provider: string,
  id: string,
  displayName: string,
  contextWindow: number | undefined,
  codingSuitability: "low" | "medium" | "high",
  reasoningSuitability: "low" | "medium" | "high",
  structuredOutput: boolean
): ModelMetadata {
  const metadata: ModelMetadata = {
    provider,
    id,
    displayName,
    capabilities: {
      vision: /gpt|grok|mistral|llama/i.test(id),
      toolCalling: true,
      structuredOutput,
      streaming: true
    },
    speed: "balanced",
    codingSuitability,
    reasoningSuitability,
    locality: "cloud",
    availability: "unknown"
  };

  if (contextWindow !== undefined) {
    metadata.contextWindow = contextWindow;
  }

  return metadata;
}

function local(
  provider: string,
  id: string,
  displayName: string,
  contextWindow: number | undefined,
  codingSuitability: "low" | "medium" | "high",
  reasoningSuitability: "low" | "medium" | "high"
): ModelMetadata {
  const metadata: ModelMetadata = {
    provider,
    id,
    displayName,
    capabilities: {
      vision: false,
      toolCalling: false,
      structuredOutput: false,
      streaming: true
    },
    speed: "balanced",
    codingSuitability,
    reasoningSuitability,
    locality: "local",
    availability: "unknown"
  };

  if (contextWindow !== undefined) {
    metadata.contextWindow = contextWindow;
  }

  return metadata;
}

