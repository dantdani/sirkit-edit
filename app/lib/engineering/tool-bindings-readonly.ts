/**
 * B05 — explicit, allowlisted, READ-ONLY implementation bindings.
 *
 * Every activated binding is registered here IN CODE. The resolver never
 * imports descriptor-supplied module strings, never uses dynamic import,
 * eval, generated code, or reflection — a descriptor is callable only when
 * its declared module+symbol EXACTLY match an allowlisted entry, and only
 * read bindings exist in this stage. Proposal, mutation, destructive,
 * release, view-session, and internal undo bindings are structurally absent
 * and explicitly rejected by the resolver.
 *
 * Bindings are pure over the caller-supplied ReadResourceSet: no provider
 * calls, no database access, no React/browser state, no history writes, no
 * browser storage, no durable envelopes, no manufacturing authority.
 * Non-deterministic timing fields from underlying engines are normalized so
 * results are digest-stable and replayable.
 */

import type { SelectionRef } from "../pcb/edit/commands";
import { getItems } from "../pcb/selection-queries";
import { buildAIPcbSnapshot } from "../pcb/ai/snapshot";
import { runDrc } from "../pcb/drc/run-drc";
import type { DrcPreset, DrcRules } from "../pcb/drc/types";
import { computeConnectivity } from "../pcb/connectivity-board";
import { evaluatePcbFabricationReadiness } from "../pcb/readiness/evaluate";
import type { FabPreset } from "../pcb/fab/types";
import type { PcbNetlist } from "../pcb/netlist-bridge";
import { pcbRevisionId } from "../pcb/revision";
import { inspectComponentAuthority, type ComponentAuthorityInput } from "./component-authority";
import { computeProjectRevision } from "./revision";
import { canonicalJsonValue } from "./stable";
import type { ToolDescriptor } from "./tool-registry";
import type { ToolAuthoritySource } from "./tool-registry";
import type { CanonicalProjectState } from "./types";

// ─── Resources (explicit snapshots; the binding never fetches anything) ──────

export interface ReadResourceSet {
  /** The pinned engineering snapshot every result is verified against. */
  canonicalState: CanonicalProjectState;
  authoritySource: ToolAuthoritySource;
  availableAuthority: readonly ToolAuthoritySource[];
  selectionRefs?: readonly SelectionRef[];
  componentAuthority?: Omit<ComponentAuthorityInput, "componentIds">;
  drcRules?: DrcRules;
  readiness?: { fabPreset: FabPreset; drcPreset: DrcPreset; netlist?: PcbNetlist };
}

/** Structured "this fact is unavailable" — mapped to authority_unavailable. */
export class ReadBindingUnavailableError extends Error {
  constructor(readonly missing: string) {
    super(`READ_RESOURCE_UNAVAILABLE:${missing}`);
    this.name = "ReadBindingUnavailableError";
  }
}

export interface ActivatedReadBinding {
  bindingId: string;
  bindingVersion: string;
  kind: "read";
  toolId: string;
  /** Must EXACTLY match the descriptor's declared implementation evidence. */
  module: string;
  symbol: string;
  invoke(args: Record<string, unknown>, resources: ReadResourceSet, signal?: AbortSignal): unknown | Promise<unknown>;
}

// ─── Deterministic normalizers ───────────────────────────────────────────────

/** Canonical plain-JSON projection: drops explicit `undefined` properties,
 *  sorts keys, and guarantees the output is digest-stable JSON. */
function toPlainJson<T>(value: T): T {
  return canonicalJsonValue(value) as T;
}

function withoutTiming<T extends Record<string, unknown>>(value: T, keys: string[]): T {
  const clone = structuredClone(value) as Record<string, unknown>;
  for (const key of keys) if (key in clone) clone[key] = 0;
  return toPlainJson(clone) as T;
}

// ─── The allowlist ───────────────────────────────────────────────────────────

export const ACTIVATED_READ_BINDINGS: readonly ActivatedReadBinding[] = Object.freeze([
  {
    bindingId: "read.canonical-revision", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.project.canonical-revision-inspect",
    module: "app/lib/engineering/revision.ts", symbol: "computeProjectRevision",
    invoke: (_args, resources) => ({ revision: computeProjectRevision(resources.canonicalState) }),
  },
  {
    bindingId: "read.pcb-revision", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.pcb.revision-inspect",
    module: "app/lib/pcb/revision.ts", symbol: "pcbRevisionId",
    invoke: (_args, resources) => ({ revision: pcbRevisionId(resources.canonicalState.pcb) }),
  },
  {
    bindingId: "read.board-snapshot", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.pcb.board-inspect",
    module: "app/lib/pcb/ai/snapshot.ts", symbol: "buildAIPcbSnapshot",
    invoke: (args, resources) => {
      const projectId = typeof args.projectId === "string" ? args.projectId : resources.canonicalState.projectId;
      const snapshot = buildAIPcbSnapshot(resources.canonicalState.pcb, { projectId });
      // generatedInMs is wall-clock; provenance is the revision, not the timer.
      return { snapshot: withoutTiming(snapshot as unknown as Record<string, unknown>, ["generatedInMs"]) };
    },
  },
  {
    bindingId: "read.selection", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.selection.inspect",
    module: "app/lib/pcb/selection-queries.ts", symbol: "getItems",
    invoke: (args, resources) => {
      const requested = (args.refs as SelectionRef[] | undefined) ?? [...(resources.selectionRefs ?? [])];
      const items = getItems(resources.canonicalState.pcb, requested);
      // Compact deterministic projection — never the raw objects (footprint
      // defs are large and carry no additional selection facts).
      const resolved = items.map((item) => {
        switch (item.kind) {
          case "footprint": return { kind: item.kind, id: item.footprint.id, ref: item.footprint.ref, x: item.footprint.at.x, y: item.footprint.at.y, side: item.footprint.side, units: "nm" };
          case "track": return { kind: item.kind, id: item.track.id, netId: item.track.netId, layer: item.track.layer, widthNm: item.track.width, units: "nm" };
          case "via": return { kind: item.kind, id: item.via.id, netId: item.via.netId, sizeNm: item.via.size, drillNm: item.via.drill, units: "nm" };
          case "zone": return { kind: item.kind, id: item.zone.id, netId: item.zone.netId, layer: item.zone.layer, units: "nm" };
          case "text": return { kind: item.kind, id: item.text.id, layer: item.text.layer, units: "nm" };
          case "pad": return { kind: item.kind, id: `${item.footprint.id}:${item.pad.number}`, netId: item.netId, units: "nm" };
        }
      }).sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
      const resolvedIds = new Set(resolved.map((item) => item.id));
      const dropped = requested
        .map((ref) => (ref.kind === "pad" ? `${ref.footprintId}:${ref.padNumber}` : ref.id))
        .filter((id) => !resolvedIds.has(id))
        .sort();
      return { items: resolved, droppedRefs: dropped };
    },
  },
  {
    bindingId: "read.drc", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.validation.drc-run",
    module: "app/lib/pcb/drc/run-drc.ts", symbol: "runDrc",
    invoke: (_args, resources) => {
      if (!resources.drcRules) throw new ReadBindingUnavailableError("drcRules");
      const report = runDrc(resources.canonicalState.pcb, resources.drcRules) as unknown as Record<string, unknown>;
      // stats.elapsedMs is wall-clock — normalize for digest determinism.
      const normalized = structuredClone(report);
      const stats = normalized.stats as Record<string, unknown> | undefined;
      if (stats && "elapsedMs" in stats) stats.elapsedMs = 0;
      return { report: toPlainJson(normalized) };
    },
  },
  {
    bindingId: "read.connectivity", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.validation.connectivity-verify",
    module: "app/lib/pcb/connectivity-board.ts", symbol: "computeConnectivity",
    invoke: (_args, resources) => {
      const connectivity = computeConnectivity(resources.canonicalState.pcb);
      // BoardConnectivity carries a Map — project to a plain, sorted, JSON-safe
      // report (Maps do not survive canonical JSON).
      const nets = [...connectivity.nets.values()]
        .map((net) => ({ netId: net.netId, complete: net.complete, clusters: net.clusters.length }))
        .sort((a, b) => a.netId - b.netId);
      return {
        report: toPlainJson({
          nets,
          completion: connectivity.completion,
          airwires: connectivity.airwires,
          shorts: connectivity.shorts,
          unknownContacts: connectivity.unknownContacts,
          orphans: connectivity.orphans,
        }),
      };
    },
  },
  {
    bindingId: "read.component-authority", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.component-authority.inspect",
    module: "app/lib/engineering/component-authority.ts", symbol: "inspectComponentAuthority",
    invoke: (args, resources) => {
      if (!resources.componentAuthority) throw new ReadBindingUnavailableError("componentAuthority");
      const componentIds = (args.componentIds as string[] | undefined) ?? resources.componentAuthority.records.map((record) => record.componentId);
      return { components: inspectComponentAuthority({ componentIds, ...resources.componentAuthority }) };
    },
  },
  {
    bindingId: "read.readiness", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.manufacturing.readiness-inspect",
    module: "app/lib/pcb/readiness/evaluate.ts", symbol: "evaluatePcbFabricationReadiness",
    invoke: (_args, resources) => {
      if (!resources.readiness) throw new ReadBindingUnavailableError("readinessInputs");
      const report = evaluatePcbFabricationReadiness({
        board: resources.canonicalState.pcb,
        fabPreset: resources.readiness.fabPreset,
        drcPreset: resources.readiness.drcPreset,
        ...(resources.readiness.netlist ? { netlist: resources.readiness.netlist } : {}),
      });
      return { report: toPlainJson(report) };
    },
  },
] satisfies readonly ActivatedReadBinding[]);

// ─── Resolver (allowlist-only; deny by default) ──────────────────────────────

export type ReadBindingResolution =
  | { state: "resolved"; binding: ActivatedReadBinding }
  | { state: "not_callable"; reason: string };

export function resolveReadBinding(
  descriptor: ToolDescriptor,
  bindings: readonly ActivatedReadBinding[] = ACTIVATED_READ_BINDINGS,
): ReadBindingResolution {
  if (descriptor.operationClass !== "read") {
    return { state: "not_callable", reason: `B05 resolves read bindings only; ${descriptor.operationClass} tools are rejected.` };
  }
  if (descriptor.binding.status !== "bound-read") {
    return { state: "not_callable", reason: `Descriptor binding status ${descriptor.binding.status} is not an activated read binding.` };
  }
  const entry = bindings.find((candidate) => candidate.toolId === descriptor.toolId);
  if (!entry) {
    return { state: "not_callable", reason: "No activated read binding is registered for this tool (metadata alone is never an implementation)." };
  }
  if (entry.kind !== "read") {
    return { state: "not_callable", reason: "Only read bindings may execute in B05." };
  }
  if (entry.module !== descriptor.binding.module || entry.symbol !== descriptor.binding.symbol) {
    return {
      state: "not_callable",
      reason: `Descriptor evidence (${descriptor.binding.module ?? "?"}#${descriptor.binding.symbol ?? "?"}) does not match the allowlisted implementation (${entry.module}#${entry.symbol}).`,
    };
  }
  return { state: "resolved", binding: entry };
}
