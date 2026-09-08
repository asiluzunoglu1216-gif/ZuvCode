import type { AgentRecord, StateStore } from "@zuvcode/persistence";
import type { AgentCallbacks, AgentProgress, ToolDefinition } from "@zuvcode/protocol";
import type { SpecialistSpec } from "@zuvcode/shared";
import type { AgentTools, FileChange } from "@zuvcode/tools";
import type { AgentRunOptions } from "./agent-loop.js";
import { ZodError } from "zod";

export interface TeamOptions {
  store: StateStore;
  session: (selection: string, signal?: AbortSignal) => Promise<Omit<AgentRunOptions, "messages" | "tools">>;
  createTools: () => AgentTools;
  recordChanges: (changes: FileChange[]) => void;
  ensureSpecialist: (spec: SpecialistSpec) => AgentRecord;
}

export function definition(name: string, description: string, schema: { toJSONSchema: () => Record<string, unknown> }): ToolDefinition {
  const { $schema: _, ...parameters } = schema.toJSONSchema();
  return { type: "function", function: { name, description, parameters } };
}

export const inspection = new Set(["list_files", "read_file", "search_files", "update_plan"]);
const categories: Record<string, string[]> = {
  filesystem: ["list_files", "read_file", "search_files", "write_file", "edit_file"],
  shell: ["run_command"], git: ["run_command"], "test-runner": ["run_command"], web: ["web_search", "read_url"]
};

export function allowedTools(agent: AgentRecord): Set<string> {
  return new Set(["update_plan", ...agent.allowedTools.flatMap((name) => categories[name] ?? [name])]);
}

export function labelled(callbacks: AgentCallbacks, name: string, id: string, observe?: (event: AgentProgress) => void): AgentCallbacks {
  return {
    onProgress: (event) => {
      observe?.(event);
      callbacks.onProgress?.({ ...event, message: event.kind === "message" ? event.message : `[${name}] ${event.message}`,
        ...(event.callId ? { callId: `${id}:${event.callId}` } : {}) });
    },
    approve: async (description) => await callbacks.approve?.(`Agent: ${name}\n${description}`) ?? false
  };
}

export function message(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; ");
  return error instanceof Error ? error.message : String(error);
}
