import { physicalBindingId } from "./stable";

export type PhysicalBindingMetricName =
  | "candidate_created" | "candidate_selected" | "candidate_rejected" | "candidate_approved" | "candidate_revoked" | "candidate_superseded"
  | "readiness_assessed" | "readiness_blocking_gate" | "dependency_stale" | "binding_conflict" | "migration_scanned" | "migration_migrated"
  | "migration_skipped" | "migration_ambiguous" | "migration_failed" | "schema_encountered" | "validation_failed" | "optimistic_conflict"
  | "shadow_disagreement" | "evaluation_ms" | "migration_ms";

export interface PhysicalBindingTelemetryEvent {
  eventId: string;
  metric: PhysicalBindingMetricName;
  projectPseudonym: string;
  value: number;
  reasonCode?: string;
  schemaVersion?: string;
  occurredAt: string;
}

/** Cardinality-safe telemetry: component, part, MPN, path, user, and raw imported values are excluded. */
export class PhysicalBindingTelemetry {
  private readonly events: PhysicalBindingTelemetryEvent[] = [];
  record(input: { metric: PhysicalBindingMetricName; tenantId: string; projectId: string; value?: number; reasonCode?: string; schemaVersion?: string; occurredAt: string }): PhysicalBindingTelemetryEvent {
    const projectPseudonym = physicalBindingId("project", { tenantId: input.tenantId, projectId: input.projectId });
    const event: PhysicalBindingTelemetryEvent = { eventId: physicalBindingId("physical-binding-telemetry", { metric: input.metric, projectPseudonym, ordinal: this.events.length, at: input.occurredAt }), metric: input.metric, projectPseudonym, value: input.value ?? 1, ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}), ...(input.schemaVersion ? { schemaVersion: input.schemaVersion } : {}), occurredAt: input.occurredAt };
    this.events.push(event);
    return structuredClone(event);
  }
  snapshot(): PhysicalBindingTelemetryEvent[] { return structuredClone(this.events); }
  counts(): Record<string, number> { return this.events.reduce<Record<string, number>>((counts, event) => ({ ...counts, [event.metric]: (counts[event.metric] ?? 0) + event.value }), {}); }
}
