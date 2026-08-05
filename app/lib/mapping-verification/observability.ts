import { mappingId } from "./stable";
import type { MappingRiskClass, MappingVerificationStatus, MappingVerificationTier } from "./types";

export type MappingMetric = "verify" | "verify_ms" | "status" | "tier" | "pin_count" | "terminal_count" | "pad_count" | "finding" | "conflict" | "ambiguity" | "persist" | "approve" | "revoke" | "invalidation" | "unauthorized";
export interface MappingTelemetryEvent { eventId: string; projectPseudonym: string; metric: MappingMetric; value: number; occurredAt: string; status?: MappingVerificationStatus | string; tier?: MappingVerificationTier; riskClass?: MappingRiskClass; reasonCode?: string; verifierVersion: string; policyVersion: string }
export class MappingTelemetry {
  private readonly events: MappingTelemetryEvent[] = [];
  record(input: Omit<MappingTelemetryEvent, "eventId" | "projectPseudonym"> & { tenantId: string; projectId: string }): MappingTelemetryEvent {
    const projectPseudonym = mappingId("mapping-project", { tenantId: input.tenantId, projectId: input.projectId });
    const safe = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "tenantId" && key !== "projectId")) as Omit<MappingTelemetryEvent, "eventId" | "projectPseudonym">;
    const event = { ...safe, projectPseudonym, eventId: mappingId("mapping-telemetry", { projectPseudonym, metric: input.metric, ordinal: this.events.length, occurredAt: input.occurredAt }) };
    this.events.push(event); return structuredClone(event);
  }
  snapshot(): MappingTelemetryEvent[] { return structuredClone(this.events); }
}
