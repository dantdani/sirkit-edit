import { resolverId } from "./stable";
import type { CandidateDispositionKind, CandidateSourceKind, CandidateSourceStatus, FootprintResolutionPurpose, FootprintResolutionStatus } from "./types";
import type { ResolutionShadowCategory } from "./shadow";

export type FootprintResolverMetric = "request" | "status" | "issue" | "candidate" | "conflict" | "ambiguity" | "adapter" | "evaluation_ms" | "shadow" | "legacy_guess" | "asset_mismatch" | "mapping_mismatch" | "batch_size";

export interface FootprintResolverTelemetryEvent {
  eventId: string;
  metric: FootprintResolverMetric;
  projectPseudonym: string;
  value: number;
  occurredAt: string;
  purpose?: FootprintResolutionPurpose;
  status?: FootprintResolutionStatus;
  reasonCode?: string;
  sourceKind?: CandidateSourceKind;
  sourceStatus?: CandidateSourceStatus;
  disposition?: CandidateDispositionKind;
  shadowCategory?: ResolutionShadowCategory;
  resolverVersion: string;
  policyVersion: string;
}

export class FootprintResolverTelemetry {
  private readonly events: FootprintResolverTelemetryEvent[] = [];
  record(input: Omit<FootprintResolverTelemetryEvent, "eventId" | "projectPseudonym"> & { tenantId: string; projectId: string }): FootprintResolverTelemetryEvent {
    const projectPseudonym = resolverId("resolver-project", { tenantId: input.tenantId, projectId: input.projectId });
    const safe = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "tenantId" && key !== "projectId")) as Omit<FootprintResolverTelemetryEvent, "eventId" | "projectPseudonym">;
    const event = { ...safe, projectPseudonym, eventId: resolverId("resolver-telemetry", { metric: input.metric, projectPseudonym, ordinal: this.events.length, occurredAt: input.occurredAt }) };
    this.events.push(event);
    return structuredClone(event);
  }
  snapshot(): FootprintResolverTelemetryEvent[] { return structuredClone(this.events); }
  counts(): Record<string, number> { return this.events.reduce<Record<string, number>>((counts, event) => ({ ...counts, [event.metric]: (counts[event.metric] ?? 0) + event.value }), {}); }
}
