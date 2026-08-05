import { passivePolicyId } from "./stable";
import type { PassivePolicyMode, PassivePolicyStatus } from "./types";

export type PassivePolicyMetric = "evaluate" | "evaluate_ms" | "preview" | "preview_ms" | "validate" | "approve" | "publish" | "revoke" | "supersede" | "status" | "mode" | "rule_disposition" | "manufacturing_gap" | "ambiguous_alias" | "mapping_blocker" | "exact_override" | "stage2_invalidated" | "stage3_staled" | "legacy_default_detected" | "unauthorized" | "over_limit";
export interface PassivePolicyMetricEvent { eventId: string; projectPseudonym: string; metric: PassivePolicyMetric; value: number; occurredAt: string; evaluatorVersion: string; policyVersion: string; status?: PassivePolicyStatus; mode?: PassivePolicyMode; reasonCode?: string }
export class PassivePolicyTelemetry {
  private readonly events: PassivePolicyMetricEvent[] = [];
  record(input: Omit<PassivePolicyMetricEvent, "eventId" | "projectPseudonym"> & { tenantId: string; projectId: string }): PassivePolicyMetricEvent { const projectPseudonym = passivePolicyId("passive-project", { tenantId: input.tenantId, projectId: input.projectId }), safe = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "tenantId" && key !== "projectId")) as Omit<PassivePolicyMetricEvent, "eventId" | "projectPseudonym">, event = { ...safe, projectPseudonym, eventId: passivePolicyId("passive-metric", { projectPseudonym, metric: input.metric, ordinal: this.events.length, at: input.occurredAt }) }; this.events.push(event); return structuredClone(event); }
  snapshot(): PassivePolicyMetricEvent[] { return structuredClone(this.events); }
}
