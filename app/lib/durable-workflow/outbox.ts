import type { DurableOutboxEvent, DurableWorkflowRepository } from "./types";
import { assertDurableOutboxEvent, durableEventContractKey } from "./stable";

export type DurableEffectHandler = (event: DurableOutboxEvent, signal?: AbortSignal) => Promise<void>;

export interface DurableOutboxDispatchResult { claimed: number; completed: number; retried: number; failed: number; }

function safeCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "DW_EFFECT_FAILED";
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : "DW_EFFECT_FAILED";
}

export class DurableOutboxDispatcher {
  constructor(private readonly repository: DurableWorkflowRepository, private readonly handlers: ReadonlyMap<string, DurableEffectHandler>) {}

  async dispatch(input: { workerId: string; now: string; leaseMs?: number; limit?: number; maxAttempts?: number; retryDelayMs?: number; topics?: string[]; signal?: AbortSignal }): Promise<DurableOutboxDispatchResult> {
    const leaseMs = input.leaseMs ?? 30_000, limit = input.limit ?? 25, maxAttempts = input.maxAttempts ?? 8, retryDelayMs = input.retryDelayMs ?? 5_000;
    const leaseUntil = new Date(Date.parse(input.now) + leaseMs).toISOString();
    const events = await this.repository.claimOutbox({ workerId: input.workerId, now: input.now, leaseUntil, limit, ...(input.topics ? { topics: input.topics } : {}) });
    const result: DurableOutboxDispatchResult = { claimed: events.length, completed: 0, retried: 0, failed: 0 };
    for (const event of events) {
      if (input.signal?.aborted) break;
      try {
        assertDurableOutboxEvent(event);
        if (!event.leaseToken) throw new Error("DW_OUTBOX_LEASE_TOKEN_REQUIRED");
        const handler = this.handlers.get(durableEventContractKey(event.eventType, event.eventVersion));
        if (!handler) throw new Error("DW_EFFECT_HANDLER_MISSING");
        await handler(event, input.signal);
        await this.repository.completeOutbox({ scope: event.scope, eventId: event.eventId, workerId: input.workerId, leaseToken: event.leaseToken, completedAt: new Date().toISOString() });
        result.completed += 1;
      } catch (error) {
        const terminal = event.attempts >= maxAttempts || safeCode(error) === "DW_EFFECT_HANDLER_MISSING";
        if (!event.leaseToken) throw error;
        await this.repository.failOutbox({ scope: event.scope, eventId: event.eventId, workerId: input.workerId, leaseToken: event.leaseToken, errorCode: safeCode(error), failedAt: input.now, retryAt: new Date(Date.parse(input.now) + retryDelayMs).toISOString(), terminal });
        if (terminal) result.failed += 1; else result.retried += 1;
      }
    }
    return result;
  }
}
