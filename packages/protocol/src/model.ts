import { z } from "zod";

export const modelCapabilitySchema = z.object({
  vision: z.boolean().default(false),
  toolCalling: z.boolean().default(false),
  structuredOutput: z.boolean().default(false),
  streaming: z.boolean().default(true)
});

export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

export const modelMetadataSchema = z.object({
  provider: z.string(),
  id: z.string(),
  displayName: z.string(),
  contextWindow: z.number().int().positive().optional(),
  capabilities: modelCapabilitySchema,
  approximateInputCostPerMillion: z.number().nonnegative().optional(),
  approximateOutputCostPerMillion: z.number().nonnegative().optional(),
  speed: z.enum(["slow", "balanced", "fast"]).default("balanced"),
  codingSuitability: z.enum(["low", "medium", "high"]).default("medium"),
  reasoningSuitability: z.enum(["low", "medium", "high"]).default("medium"),
  locality: z.enum(["cloud", "local"]),
  availability: z.enum(["available", "unavailable", "unknown"]).default("unknown")
});

export type ModelMetadata = z.infer<typeof modelMetadataSchema>;

export const finishReasonSchema = z.enum(["stop", "length", "tool_calls", "content_filter", "error"]);

export type FinishReason = z.infer<typeof finishReasonSchema>;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelResponse {
  id: string;
  provider: string;
  model: string;
  text: string;
  toolCalls: ToolCall[];
  usage?: Usage;
  finishReason: FinishReason;
  providerMessage?: Record<string, unknown>;
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface AgentProgress {
  kind: "status" | "plan" | "tool_start" | "tool_end" | "warning" | "message";
  message: string;
  speaker?: string;
  recipient?: string;
  intent?: "proposal" | "agreement" | "objection" | "question" | "reply" | "handoff";
  callId?: string;
  ok?: boolean;
}

export interface AgentCallbacks {
  onProgress?: (event: AgentProgress) => void;
  approve?: (description: string) => Promise<boolean>;
}

export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  providerMessage?: Record<string, unknown>;
}
