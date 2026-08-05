/**
 * B05 — pure, deterministic engineering-context assembler.
 *
 * Builds a versioned, provider-neutral EngineeringContextEnvelope from
 * EXPLICIT caller-supplied snapshots and authority records. It never reaches
 * into React state, browser globals, providers, or databases; it contains no
 * prompt text and no provider message objects; it performs no retrieval and
 * no mutation. Every fact carries revision/provenance, collections are
 * bounded and deterministically ordered, units are explicit (nm), and
 * UNKNOWN (asked-for but unavailable) is distinguishable from OMITTED
 * (deliberately not supplied). Nothing here connects to /api/chat.
 */

import { engineeringDigest } from "./stable";
import { computeProjectRevision } from "./revision";
import { inspectComponentAuthority, type ComponentAuthorityInput, type ComponentAuthoritySummary } from "./component-authority";
import type { SelectionRef } from "../pcb/edit/commands";
import { pcbRevisionId } from "../pcb/revision";
import type { CanonicalProjectState } from "./types";

export type ContextSection<T> =
  | { status: "present"; data: T }
  | { status: "unknown"; reason: string }
  | { status: "omitted" };

export interface ContextBudget {
  maxNets: number;
  maxViolations: number;
  maxSelection: number;
  maxComponents: number;
  maxChangeRefs: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = Object.freeze({
  maxNets: 50, maxViolations: 50, maxSelection: 100, maxComponents: 100, maxChangeRefs: 20,
});

export interface ContextAssemblerInput {
  canonicalState: CanonicalProjectState;
  lineageId?: string;
  authoritySource: string;
  authorityStatus: "verified" | "unverified" | "unavailable";
  currentEditor: string;
  selection?: readonly SelectionRef[];
  /** Opaque schematic summary, explicitly supplied (never derived here). */
  schematicSummary?: unknown;
  componentAuthority?: ComponentAuthorityInput;
  /** Normalized validation failures explicitly supplied by the caller. */
  validationFailures?: ReadonlyArray<{ id: string; kind: string; severity: string; objectIds: readonly string[] }>;
  readinessSummary?: { status: string; blockingCount: number; sourceRevision: string };
  recentChangeRefs?: ReadonlyArray<{ transactionId: string; sequence: number; reason: string }>;
  budget?: Partial<ContextBudget>;
}

export interface EngineeringContextEnvelope {
  schema: "sirkit.engineering-context.v1";
  tenantId: string;
  projectId: string;
  branchId: string;
  pinnedRevision: { canonicalStateDigest: string; headSequence: number; headTransactionId: string; boardSemanticRevision: string };
  lineageId: string | null;
  authority: { source: string; status: string };
  currentEditor: string;
  units: "nm";
  selection: ContextSection<Array<{ kind: string; id: string }>>;
  boardSummary: ContextSection<{
    footprints: number; tracks: number; vias: number; zones: number; nets: number;
    layers: number; outline: { kind: string; widthNm: number; heightNm: number } | { kind: string };
  }>;
  schematicSummary: ContextSection<unknown>;
  componentAuthority: ContextSection<ComponentAuthoritySummary[]>;
  relevantNets: ContextSection<Array<{ id: number; name: string; items: number }>>;
  validationFailures: ContextSection<Array<{ id: string; kind: string; severity: string; objectIds: string[] }>>;
  readiness: ContextSection<{ status: string; blockingCount: number; sourceRevision: string }>;
  recentChanges: ContextSection<Array<{ transactionId: string; sequence: number; reason: string }>>;
  truncation: Array<{ section: string; kept: number; dropped: number }>;
  sourceDigests: { canonicalState: string };
  contextDigest: string;
}

function bounded<T>(items: readonly T[], max: number, section: string, truncation: EngineeringContextEnvelope["truncation"]): T[] {
  if (items.length <= max) return [...items];
  truncation.push({ section, kept: max, dropped: items.length - max });
  return items.slice(0, max);
}

export function assembleEngineeringContext(input: ContextAssemblerInput): EngineeringContextEnvelope {
  const state = input.canonicalState;
  const board = state.pcb;
  const budget: ContextBudget = { ...DEFAULT_CONTEXT_BUDGET, ...(input.budget ?? {}) };
  const truncation: EngineeringContextEnvelope["truncation"] = [];
  const revision = computeProjectRevision(state);

  const selection: EngineeringContextEnvelope["selection"] = input.selection === undefined
    ? { status: "omitted" }
    : {
        status: "present",
        data: bounded(
          [...input.selection]
            .map((ref) => ({ kind: ref.kind, id: ref.kind === "pad" ? `${ref.footprintId}:${ref.padNumber}` : ref.id }))
            .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
          budget.maxSelection, "selection", truncation,
        ),
      };

  const outline = board.outline as { kind: string; width?: number; height?: number };
  const boardSummary: EngineeringContextEnvelope["boardSummary"] = {
    status: "present",
    data: {
      footprints: board.footprints.length,
      tracks: board.tracks.length,
      vias: board.vias.length,
      zones: board.zones.length,
      nets: board.nets.length,
      layers: board.stackup,
      outline: typeof outline.width === "number" && typeof outline.height === "number"
        ? { kind: outline.kind, widthNm: outline.width, heightNm: outline.height }
        : { kind: outline.kind },
    },
  };

  const relevantNets: EngineeringContextEnvelope["relevantNets"] = {
    status: "present",
    data: bounded(
      [...board.nets]
        .filter((net) => net.id !== 0)
        .map((net) => ({
          id: net.id,
          name: net.name,
          items: board.tracks.filter((track) => track.netId === net.id).length + board.vias.filter((via) => via.netId === net.id).length,
        }))
        .sort((a, b) => b.items - a.items || a.id - b.id),
      budget.maxNets, "relevantNets", truncation,
    ),
  };

  const componentAuthority: EngineeringContextEnvelope["componentAuthority"] = input.componentAuthority === undefined
    ? { status: "omitted" }
    : {
        status: "present",
        data: bounded(inspectComponentAuthority(input.componentAuthority), budget.maxComponents, "componentAuthority", truncation),
      };

  const validationFailures: EngineeringContextEnvelope["validationFailures"] = input.validationFailures === undefined
    ? { status: "unknown", reason: "no validation report was supplied for this revision" }
    : {
        status: "present",
        data: bounded(
          [...input.validationFailures]
            .map((failure) => ({ id: failure.id, kind: failure.kind, severity: failure.severity, objectIds: [...failure.objectIds].sort() }))
            .sort((a, b) => a.severity.localeCompare(b.severity) || a.id.localeCompare(b.id)),
          budget.maxViolations, "validationFailures", truncation,
        ),
      };

  const envelopeBase = {
    schema: "sirkit.engineering-context.v1" as const,
    tenantId: state.tenantId,
    projectId: state.projectId,
    branchId: state.branchId,
    pinnedRevision: {
      canonicalStateDigest: revision.canonicalStateDigest,
      headSequence: revision.headSequence,
      headTransactionId: revision.headTransactionId,
      boardSemanticRevision: pcbRevisionId(board),
    },
    lineageId: input.lineageId ?? null,
    authority: { source: input.authoritySource, status: input.authorityStatus },
    currentEditor: input.currentEditor,
    units: "nm" as const,
    selection,
    boardSummary,
    schematicSummary: (input.schematicSummary === undefined
      ? { status: "omitted" }
      : { status: "present", data: input.schematicSummary }) as ContextSection<unknown>,
    componentAuthority,
    relevantNets,
    validationFailures,
    readiness: (input.readinessSummary === undefined
      ? { status: "unknown", reason: "readiness was not evaluated for this revision" }
      : { status: "present", data: input.readinessSummary }) as EngineeringContextEnvelope["readiness"],
    recentChanges: (input.recentChangeRefs === undefined
      ? { status: "omitted" }
      : {
          status: "present",
          data: bounded(
            [...input.recentChangeRefs].sort((a, b) => a.sequence - b.sequence),
            budget.maxChangeRefs, "recentChanges", truncation,
          ),
        }) as EngineeringContextEnvelope["recentChanges"],
    truncation,
    sourceDigests: { canonicalState: revision.canonicalStateDigest },
  };
  return { ...envelopeBase, contextDigest: engineeringDigest({ schema: "sirkit.engineering-context-digest.v1", envelope: envelopeBase }) };
}
