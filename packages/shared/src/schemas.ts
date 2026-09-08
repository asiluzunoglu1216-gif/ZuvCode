import { z } from "zod";

export const providerKindSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "nvidia",
  "openrouter",
  "deepseek",
  "groq",
  "mistral",
  "xai",
  "ollama",
  "lmstudio",
  "llamacpp",
  "vllm",
  "openai-compatible"
]);

export type ProviderKind = z.infer<typeof providerKindSchema>;

export const taskStatusSchema = z.enum([
  "queued",
  "blocked",
  "ready",
  "in_progress",
  "review",
  "testing",
  "failed",
  "cancelled",
  "complete"
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const agentStatusSchema = z.enum(["idle", "working", "blocked", "reviewing", "offline"]);

export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const permissionModeSchema = z.enum(["SAFE", "BALANCED", "AUTONOMOUS", "FULL_ACCESS"]);

export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const teamPlanSchema = z.object({
  tasks: z.array(z.object({
    agent: z.string().min(1).max(64),
    title: z.string().min(1).max(120),
    instructions: z.string().min(1).max(6000),
    depends_on: z.array(z.number().int().min(1).max(8)).max(8).default([]),
    checks: z.array(z.string().min(1).max(300)).max(6).default([])
  })).min(1).max(8)
}).superRefine((plan, context) => {
  plan.tasks.forEach((task, index) => {
    if (task.depends_on.some((id) => id > index) || new Set(task.depends_on).size !== task.depends_on.length) {
      context.addIssue({ code: "custom", path: ["tasks", index, "depends_on"], message: "Dependencies must be unique 1-based references to earlier tasks." });
    }
  });
});

export const taskOutcomeSchema = z.object({
  status: z.enum(["complete", "blocked", "failed"]),
  summary: z.string().min(1).max(16000)
});

export const specialistSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  role: z.string().min(1).max(80),
  responsibilities: z.string().min(1).max(1200)
});

export const teamProposalSchema = z.object({
  agents: z.array(specialistSchema).min(2).max(5),
  proposal: z.string().min(1).max(1600),
  tasks: teamPlanSchema.shape.tasks
}).superRefine((proposal, context) => {
  const names = proposal.agents.map((agent) => agent.name);
  if (new Set(names).size !== names.length || names.includes("orchestrator")) context.addIssue({ code: "custom", message: "Choose unique specialist names other than orchestrator." });
  if (proposal.tasks.some((task) => !names.includes(task.agent)) || names.some((name) => !proposal.tasks.some((task) => task.agent === name))) {
    context.addIssue({ code: "custom", message: "Every task needs a declared specialist, and every specialist needs a task." });
  }
  const parsed = teamPlanSchema.safeParse({ tasks: proposal.tasks });
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ code: "custom", message: issue.message });
});
export type TeamProposal = z.infer<typeof teamProposalSchema>;
export type SpecialistSpec = z.infer<typeof specialistSchema>;

export const teamMessageLimit = 8000;
export const teamReviewSchema = z.object({ approve: z.boolean(), message: z.string().min(1).max(teamMessageLimit) });
export const askAgentSchema = z.object({ to: z.string().min(1).max(40), message: z.string().min(1).max(teamMessageLimit) });
export const executionStepLimitSchema = z.number().int().min(1).max(1000);
export const defaultExecutionStepLimit = 120;
