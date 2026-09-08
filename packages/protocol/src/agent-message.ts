import { z } from "zod";

export const agentMessageKindSchema = z.enum([
  "request",
  "response",
  "review",
  "objection",
  "proposal",
  "handoff",
  "status",
  "artifact"
]);

export type AgentMessageKind = z.infer<typeof agentMessageKindSchema>;

export const agentMessageSchema = z.object({
  id: z.string(),
  fromAgentId: z.string(),
  toAgentId: z.string().optional(),
  kind: agentMessageKindSchema,
  body: z.string(),
  artifactRefs: z.array(z.string()).default([]),
  createdAt: z.string()
});

export type AgentMessage = z.infer<typeof agentMessageSchema>;

