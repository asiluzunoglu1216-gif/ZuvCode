import type { AgentStatus, ProviderKind, TaskStatus, TeamProposal } from "@zuvcode/shared";
import type { ModelMetadata } from "@zuvcode/protocol";

export type ProviderStatus = "connected" | "add" | "detected" | "not_running" | "unavailable";

export interface ProjectRecord {
  id: string;
  rootPath: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  projectId: string;
  startedAt: string;
  endedAt?: string;
  status: "active" | "closed" | "crashed";
}

export interface ProviderRecord {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKeySession?: string;
  status: ProviderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRecord {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  metadata: ModelMetadata;
  availability: ModelMetadata["availability"];
  updatedAt: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  role: string;
  systemInstructions: string;
  selectedModel: string;
  allowedTools: string[];
  allowedFiles: string[];
  memoryScope: string;
  currentTaskId?: string;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  ownerAgentId?: string;
  status: TaskStatus;
  attempts: number;
  generatedFiles: string[];
  testRequirements: string[];
  completionEvidence: string[];
  dependencies: string[];
  resultText: string;
  modelUsed: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecord {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TeamRunRecord {
  id: string;
  goal: string;
  status: "planning" | "discussing" | "approved" | "running" | "complete" | "blocked" | "failed" | "cancelled";
  agentIds: string[];
  taskIds: string[];
  approvedFingerprint: string;
  openObjections: string[];
  round: number;
  proposal?: TeamProposal;
}

export interface TeamMessageRecord {
  id: string;
  runId: string;
  fromAgentId: string;
  toAgentId?: string;
  kind: "proposal" | "agreement" | "objection" | "question" | "reply" | "handoff";
  body: string;
  round: number;
}
