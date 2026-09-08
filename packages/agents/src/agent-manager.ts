import type { AgentRecord, StateStore } from "@zuvcode/persistence";
import { findRoleTemplate } from "./agent-roles.js";
import type { SpecialistSpec } from "@zuvcode/shared";

export class AgentManager {
  public constructor(private readonly store: StateStore) {}

  public ensureDefaultTeam(): AgentRecord[] {
    for (const role of ["orchestrator", "architect", "coder", "tester"]) this.createAgent(role);
    return this.store.listAgents();
  }

  public createAgent(nameOrRole: string, selectedModel = "AUTO"): AgentRecord {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u.test(nameOrRole.trim())) throw new Error("Agent names must be 1-64 letters, numbers, hyphens or underscores, without spaces.");
    const template = findRoleTemplate(nameOrRole);
    const existing = this.store.findAgentByName(template.name);
    if (existing !== undefined) {
      return existing;
    }

    return this.store.createAgent({
      name: template.name,
      role: template.role,
      systemInstructions: template.systemInstructions,
      selectedModel,
      allowedTools: template.allowedTools,
      allowedFiles: template.allowedFiles,
      memoryScope: "project",
      status: "idle"
    });
  }

  public listAgents(): AgentRecord[] {
    return this.store.listAgents();
  }

  public ensureSpecialist(spec: SpecialistSpec): AgentRecord {
    const existing = this.store.findAgentByName(spec.name);
    if (existing) return existing;
    const template = findRoleTemplate(spec.name);
    return this.store.createAgent({ name: spec.name, role: spec.role,
      systemInstructions: `Work as ${spec.role}. Responsibilities: ${spec.responsibilities}`,
      selectedModel: "AUTO", allowedTools: template.allowedTools, allowedFiles: template.allowedFiles, status: "idle" });
  }
}
