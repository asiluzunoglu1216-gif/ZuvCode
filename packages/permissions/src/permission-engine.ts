import type { PermissionMode, RiskLevel } from "@zuvcode/shared";
import { ToolPermissionError } from "@zuvcode/shared";
import { isProtectedPath } from "./protected-paths.js";
import { needsCommandApproval } from "./shell-risk.js";

export type OperationKind = "read" | "write" | "delete" | "shell" | "network" | "production" | "secret";

export type PermissionDecision =
  | { status: "allowed"; reason: string }
  | { status: "requires_approval"; reason: string }
  | { status: "denied"; reason: string };

export interface PermissionRequest {
  kind: OperationKind;
  riskLevel: RiskLevel;
  path?: string;
  command?: string;
  production?: boolean;
}

export interface PermissionPolicyOptions {
  mode?: PermissionMode;
  protectedPaths?: string[];
}

export class PermissionEngine {
  public mode: PermissionMode;
  public readonly protectedPaths: string[];

  public constructor(options: PermissionPolicyOptions = {}) {
    this.mode = options.mode ?? "SAFE";
    this.protectedPaths = options.protectedPaths ?? [".env", ".env.*", "production/**"];
  }

  public evaluate(request: PermissionRequest): PermissionDecision {
    if (this.mode === "FULL_ACCESS") return { status: "allowed", reason: "Full Access selected by the user; no approval prompts" };
    if (this.mode === "SAFE") return { status: "requires_approval", reason: `Ask Every Time: approval required for ${request.kind}` };
    if (request.path !== undefined && isProtectedPath(request.path, this.protectedPaths)) {
      return { status: "requires_approval", reason: `Path is protected: ${request.path}` };
    }

    if (request.kind === "secret") {
      return { status: "requires_approval", reason: "Secret access requires explicit approval" };
    }

    if (request.production === true || request.kind === "production") {
      return { status: "requires_approval", reason: "Production actions require explicit approval" };
    }

    if (request.riskLevel === "CRITICAL") {
      return { status: "requires_approval", reason: "Critical-risk operation requires explicit approval" };
    }

    if (request.kind === "shell" && (!request.command || needsCommandApproval(request.command))) {
      return { status: "requires_approval", reason: "This command needs approval: it can modify external state or run arbitrary code" };
    }

    if (this.mode === "BALANCED") {
      if (request.kind === "delete" || request.riskLevel === "HIGH") {
        return { status: "requires_approval", reason: "Balanced mode requires approval for high-risk operations" };
      }

      return { status: "allowed", reason: "Balanced mode allows normal project operations" };
    }

    if (request.kind === "delete" && request.riskLevel !== "LOW") {
      return { status: "requires_approval", reason: "Autonomous mode still protects destructive operations" };
    }

    return { status: "allowed", reason: "Autonomous mode allows this project operation" };
  }

  public assertAllowed(request: PermissionRequest): void {
    const decision = this.evaluate(request);
    if (decision.status !== "allowed") {
      throw new ToolPermissionError(decision.reason, { details: { decision } });
    }
  }
}
