import { toolManifestSchema, type ToolManifest } from "@zuvcode/protocol";
import { ValidationError, type RiskLevel } from "@zuvcode/shared";
import type { ToolSecurityStatus } from "./types.js";

export interface ToolValidationResult {
  manifest: ToolManifest;
  riskLevel: RiskLevel;
  status: ToolSecurityStatus;
}

export class ToolSecurityLayer {
  public validateManifest(input: unknown): ToolValidationResult {
    const parsed = toolManifestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Invalid tool manifest", { details: { issues: parsed.error.issues } });
    }

    return {
      manifest: parsed.data,
      riskLevel: parsed.data.riskLevel,
      status: this.describeSecurity(parsed.data)
    };
  }

  public describeSecurity(manifest: ToolManifest): ToolSecurityStatus {
    return {
      sandbox: "Process Isolation",
      filesystem: "Scoped",
      network: manifest.networkAccess.enabled ? "Restricted" : "Denied",
      secrets: manifest.environmentAccess.length > 0 ? "Restricted" : "Denied",
      isolationStrength: "BASIC"
    };
  }
}

