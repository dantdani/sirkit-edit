import { engineeringId } from "./stable";

export type Stage10MetricName = "transaction_accepted" | "transaction_rejected" | "transaction_conflicted" | "transaction_rebased" | "durable_commit_ms" | "dependency_fanout" | "queue_depth" | "stale_result_rejected" | "divergence" | "fallback" | "authorization_denied" | "recovery_failure" | "asset_missing" | "undo_conflict";

export interface Stage10TelemetryEvent {
  eventId: string;
  metric: Stage10MetricName;
  projectPseudonym: string;
  transactionId?: string;
  evaluatorId?: string;
  value: number;
  occurredAt: string;
  reasonCode?: string;
}

/** Privacy-minimized telemetry: no geometry, net names, comments, prompts, actor names, or asset content. */
export class Stage10Telemetry {
  private readonly events: Stage10TelemetryEvent[] = [];
  record(input: { metric: Stage10MetricName; tenantId: string; projectId: string; transactionId?: string; evaluatorId?: string; value?: number; reasonCode?: string }): Stage10TelemetryEvent {
    const projectPseudonym = engineeringId("project", { tenant: input.tenantId, project: input.projectId }); const event: Stage10TelemetryEvent = { eventId: engineeringId("telemetry", { metric: input.metric, projectPseudonym, transaction: input.transactionId, count: this.events.length }), metric: input.metric, projectPseudonym, ...(input.transactionId ? { transactionId: input.transactionId } : {}), ...(input.evaluatorId ? { evaluatorId: input.evaluatorId } : {}), value: input.value ?? 1, occurredAt: new Date().toISOString(), ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}) }; this.events.push(event); return structuredClone(event);
  }
  snapshot(): Stage10TelemetryEvent[] { return structuredClone(this.events); }
  counts(): Record<string, number> { const result: Record<string, number> = {}; for (const event of this.events) result[event.metric] = (result[event.metric] ?? 0) + event.value; return result; }
}
