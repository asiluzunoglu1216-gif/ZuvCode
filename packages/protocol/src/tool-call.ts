import { riskLevelSchema } from "@zuvcode/shared";
import { z } from "zod";

export const toolManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  entrypoint: z.string().min(1),
  requiredPermissions: z.array(z.string()).default([]),
  filesystemScope: z
    .object({
      read: z.array(z.string()).default([]),
      write: z.array(z.string()).default([]),
      deny: z.array(z.string()).default(["**/*"])
    })
    .default({ read: [], write: [], deny: ["**/*"] }),
  networkAccess: z
    .object({
      enabled: z.boolean().default(false),
      allowedHosts: z.array(z.string()).default([])
    })
    .default({ enabled: false, allowedHosts: [] }),
  environmentAccess: z.array(z.string()).default([]),
  executionTimeoutMs: z.number().int().positive().max(300_000).default(30_000),
  memoryLimitMb: z.number().int().positive().max(4096).default(256),
  riskLevel: riskLevelSchema.default("LOW")
});

export type ToolManifest = z.infer<typeof toolManifestSchema>;

export interface ToolExecutionRequest<TInput = unknown> {
  toolName: string;
  input: TInput;
  agentId?: string;
  taskId?: string;
}

export interface ToolExecutionResult<TOutput = unknown> {
  ok: boolean;
  output?: TOutput;
  error?: string;
  startedAt: string;
  completedAt: string;
}

