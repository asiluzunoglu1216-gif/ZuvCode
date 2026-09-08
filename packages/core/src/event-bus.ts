import { createId, nowIso } from "@zuvcode/shared";

export type ZuvCodeEventName =
  | "session.started"
  | "project.detected"
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "agent.spawned"
  | "agent.message"
  | "model.request"
  | "model.response"
  | "provider.fallback"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "checkpoint.created"
  | "budget.warning"
  | "goal.run"
  | "tasks.planned"
  | "provider.configured";

export interface ZuvCodeEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  name: ZuvCodeEventName;
  payload: TPayload;
  createdAt: string;
}

export type EventHandler<TPayload extends Record<string, unknown> = Record<string, unknown>> = (
  event: ZuvCodeEvent<TPayload>
) => void;

export class EventBus {
  private readonly handlers = new Map<ZuvCodeEventName, Set<EventHandler>>();
  private readonly recentEvents: ZuvCodeEvent[] = [];

  public emit<TPayload extends Record<string, unknown>>(name: ZuvCodeEventName, payload: TPayload): ZuvCodeEvent<TPayload> {
    const event: ZuvCodeEvent<TPayload> = {
      id: createId("event"),
      name,
      payload,
      createdAt: nowIso()
    };

    this.recentEvents.push(event);
    if (this.recentEvents.length > 500) {
      this.recentEvents.splice(0, this.recentEvents.length - 500);
    }

    const handlers = this.handlers.get(name);
    if (handlers !== undefined) {
      for (const handler of handlers) {
        handler(event);
      }
    }

    return event;
  }

  public subscribe(name: ZuvCodeEventName, handler: EventHandler): () => void {
    const handlers = this.handlers.get(name) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.handlers.set(name, handlers);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(name);
      }
    };
  }

  public recent(limit = 50): ZuvCodeEvent[] {
    return this.recentEvents.slice(-limit);
  }
}

