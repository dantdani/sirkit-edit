/**
 * [PR-D d2] The Schematic → PCB preparation checks the editor runs BEFORE any server call, as bounded DATA for the agent's
 * `sirkit.pcb-sync.preflight` read (app/lib/agent/pcb-sync-preflight-reads.ts).
 *
 * `PcbEditor.handleSync` (app/components/pcb/PcbEditor.tsx, the Prepare PCB / Schematic → PCB button and the journey strip's
 * `prepare_pcb` action) refuses first and fails closed: `listUnresolvedInstances` names every instance that cannot reach the board,
 * `unresolvedInstancesRefusal` is the toast it shows, `UNRESOLVED_MISSING_LABEL` / `UNRESOLVED_REVIEW_PATH` are the row texts of the
 * list that outlives it, and `Boolean(k.atomicPartRevisionId)` is the filter that decides which instances the server preparation
 * would bind. This module calls exactly those (no second checker) and adds nothing the editor does not already decide; the server
 * stages the editor runs AFTER these checks (bindings, publication, the durable preflight and its blockers) are reported as
 * `not_run` - not checked is not a pass, and nothing here binds, publishes or applies.
 *
 * Pure: reads the schematic state only - no part cache, no network, no DOM, no board.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { theoryPinContract } from "@/app/lib/schematic/theory-physicality"; // [PR-G, 2026-10-17] the shared rule's own module, not the Stage 4 bridge (forbidden in Stage 3 code)
import { listUnresolvedInstances, unresolvedInstancesRefusal, UNRESOLVED_MISSING_LABEL, type UnresolvedInstance } from "./unresolved-instances";

export const PCB_SYNC_PREFLIGHT_REPORT_SCHEMA = "sirkit.pcb-sync-preflight-report.v1" as const;
/** The unresolved rows listed in full; the rest are counted (`truncated`), never dropped silently. */
export const MAX_PREFLIGHT_REPORT_ROWS = 200;
/** The server stages Prepare PCB runs after these checks, in order; this read runs none of them. */
export const PCB_SYNC_SERVER_STAGES = Object.freeze(["bindings", "publication", "preflight"] as const);
export type PcbSyncServerStage = (typeof PCB_SYNC_SERVER_STAGES)[number];

export interface PcbSyncPreflightUnresolvedRow extends UnresolvedInstance {
  /** The missing fact, worded as the editor's list row words it. */
  missingLabel: string;
}

export interface PcbSyncPreflightReport {
  schema: typeof PCB_SYNC_PREFLIGHT_REPORT_SCHEMA;
  /** Where this read stands in the editor's run: before its first server call. */
  stage: "before_server_call";
  /** `refused_unresolved_instances`: the editor would refuse here and call no server. `ready_for_server_preparation`: it would go on to bind. */
  status: "refused_unresolved_instances" | "ready_for_server_preparation";
  /** The refusal sentence the editor shows (null when it would not refuse). */
  refusal: string | null;
  unresolved: { count: number; rows: PcbSyncPreflightUnresolvedRow[]; truncated: number };
  /** The instance census the editor's own filters produce. */
  instances: {
    kicad: number;
    /** KiCad instances carrying a published exact revision - the ones the server preparation would bind (`Boolean(atomicPartRevisionId)`). */
    kicadWithPublishedRevision: number;
    /** Theory components that are physical parts (`theoryPinContract`): never on the board without a catalog part. */
    theoryPhysical: number;
    /** Theory components that are simulation stimuli (ground, sources): no footprint, never on the board, never a blocker. */
    theoryStimulus: number;
  };
  /** The editor's B07.2 session gate (conflicted or not ready) is evaluated by the editor when Prepare PCB runs; this read cannot. */
  sessionGate: { state: "not_evaluated"; detail: string };
  /** Each server stage, as this read leaves it. */
  serverPreparation: Array<{ stage: PcbSyncServerStage; state: "not_run"; detail: string }>;
  note: string;
}

const SERVER_STAGE_DETAIL: Readonly<Record<PcbSyncServerStage, string>> = Object.freeze({
  bindings: "the physical bindings of the instances with a published revision are ensured on the server by the editor's run, under the user's identity; this read bound nothing",
  publication: "the schematic snapshot is published to the durable board by the editor's run; this read published nothing",
  preflight: "the durable preflight resolves footprints and reports its blockers (the readiness panel); it was not run, so its blockers are unknown here - not checked is not a pass",
});

/** The report, computed from the SAME functions the editor's handleSync calls, in the same order. */
export function buildPcbSyncPreflightReport(state: SchematicState): PcbSyncPreflightReport {
  const unresolved = listUnresolvedInstances(state);
  const rows: PcbSyncPreflightUnresolvedRow[] = unresolved.slice(0, MAX_PREFLIGHT_REPORT_ROWS).map((item) => ({ ...item, missingLabel: UNRESOLVED_MISSING_LABEL[item.missing] }));
  const kicad = state.kicadComponents ?? [];
  let theoryPhysical = 0;
  let theoryStimulus = 0;
  for (const component of state.components) {
    if (theoryPinContract(component.type) === null) theoryStimulus += 1;
    else theoryPhysical += 1;
  }
  const refused = unresolved.length > 0;
  return {
    schema: PCB_SYNC_PREFLIGHT_REPORT_SCHEMA,
    stage: "before_server_call",
    status: refused ? "refused_unresolved_instances" : "ready_for_server_preparation",
    refusal: refused ? unresolvedInstancesRefusal(unresolved) : null,
    unresolved: { count: unresolved.length, rows, truncated: Math.max(0, unresolved.length - rows.length) },
    instances: {
      kicad: kicad.length,
      kicadWithPublishedRevision: kicad.filter((instance) => Boolean(instance.atomicPartRevisionId)).length,
      theoryPhysical,
      theoryStimulus,
    },
    sessionGate: { state: "not_evaluated", detail: "the editor's canonical schematic session gate (conflicted or not ready refuses the run) is evaluated by the editor when Prepare PCB runs; it is not part of this read" },
    serverPreparation: PCB_SYNC_SERVER_STAGES.map((stage) => ({ stage, state: "not_run" as const, detail: SERVER_STAGE_DETAIL[stage] })),
    note: refused
      ? "Prepare PCB would refuse at these instances before any server call; nothing would be bound or published. Resolve each row through its review path, then run Prepare PCB in the PCB editor."
      : "Every physical instance carries a published exact revision and its installed symbol asset, so Prepare PCB would go on to the server stages (bindings, publication, preflight) - which this read did not run. The user runs Prepare PCB in the PCB editor; applying a plan stays their explicit click.",
  };
}
