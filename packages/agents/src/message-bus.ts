import type { AgentMessage } from "@zuvcode/protocol";
import { createId, nowIso } from "@zuvcode/shared";

export interface SendAgentMessageInput {
  fromAgentId: string;
  toAgentId?: string;
  kind: AgentMessage["kind"];
  body: string;
  artifactRefs?: string[];
}

export class AgentMessageBus {
  private readonly messages: AgentMessage[] = [];
  private readonly maxMessages: number;

  public constructor(maxMessages = 200) {
    this.maxMessages = maxMessages;
  }

  public send(input: SendAgentMessageInput): AgentMessage {
    const message: AgentMessage = {
      id: createId("agent-message"),
      fromAgentId: input.fromAgentId,
      kind: input.kind,
      body: input.body,
      artifactRefs: input.artifactRefs ?? [],
      createdAt: nowIso()
    };

    if (input.toAgentId !== undefined) {
      message.toAgentId = input.toAgentId;
    }

    this.messages.push(message);
    if (this.messages.length > this.maxMessages) {
      this.messages.splice(0, this.messages.length - this.maxMessages);
    }

    return message;
  }

  public inbox(agentId: string): AgentMessage[] {
    return this.messages.filter((message) => message.toAgentId === agentId);
  }

  public all(): AgentMessage[] {
    return [...this.messages];
  }
}

