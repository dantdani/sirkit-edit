import { pcbSyncId } from "./stable";
import type { PcbSyncBoardClass, PcbSyncPreflightStatus, PcbSyncRiskClass } from "./types";

export type PcbSyncMetric = "preflight" | "preflight_ms" | "status" | "component" | "blocker" | "operation" | "board_class" | "resolver_batch_ms" | "apply" | "apply_ms" | "lock_failure" | "staged_validation_failure" | "commit" | "recovery" | "router_handoff" | "legacy_invocation";
export interface PcbSyncTelemetryEvent {
  eventId: string;
  projectPseudonym: string;
  metric: PcbSyncMetric;
  value: number;
  occurredAt: string;
  status?: PcbSyncPreflightStatus | string;
  reasonCode?: string;
  operationKind?: string;
  risk?: PcbSyncRiskClass;
  boardClass?: PcbSyncBoardClass;
  engineVersion: string;
  policyVersion: string;
}

export class PcbSyncTelemetry {
  private readonly events: PcbSyncTelemetryEvent[] = [];
  record(input: Omit<PcbSyncTelemetryEvent, "eventId" | "projectPseudonym"> & { tenantId: string; projectId: string }): PcbSyncTelemetryEvent {
    const projectPseudonym = pcbSyncId("pcb-sync-project", { tenantId: input.tenantId, projectId: input.projectId });
    const safe = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "tenantId" && key !== "projectId")) as Omit<PcbSyncTelemetryEvent, "eventId" | "projectPseudonym">;
    const event = { ...safe, projectPseudonym, eventId: pcbSyncId("pcb-sync-event", { projectPseudonym, metric: input.metric, ordinal: this.events.length, occurredAt: input.occurredAt }) };
    this.events.push(event);
    return structuredClone(event);
  }
  snapshot(): PcbSyncTelemetryEvent[] { return structuredClone(this.events); }
  counts(): Record<string, number> { return this.events.reduce<Record<string, number>>((out, item) => ({ ...out, [item.metric]: (out[item.metric] ?? 0) + item.value }), {}); }
}

