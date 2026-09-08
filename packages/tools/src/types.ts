import type { ToolExecutionRequest, ToolExecutionResult, ToolManifest } from "@zuvcode/protocol";

export interface ZuvCodeTool<TInput = unknown, TOutput = unknown> {
  manifest: ToolManifest;
  execute(request: ToolExecutionRequest<TInput>): Promise<ToolExecutionResult<TOutput>>;
}

export interface ToolSecurityStatus {
  sandbox: "Process Isolation";
  filesystem: "Scoped";
  network: "Denied" | "Restricted" | "Allowed";
  secrets: "Denied" | "Restricted";
  isolationStrength: "BASIC" | "STRONG";
}

