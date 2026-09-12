/**
 * B05/B05.1 — explicit, allowlisted, READ-ONLY implementation bindings.
 *
 * Every activated binding is registered here IN CODE. The resolver never
 * imports descriptor-supplied module strings, never uses dynamic import,
 * eval, generated code, or reflection — a descriptor is callable only when
 * its declared module+symbol EXACTLY match an allowlisted entry, and only
 * read bindings exist in this stage.
 *
 * B05.1: every binding DECLARES the resource kinds it consumes
 * (`requiredResources` / `optionalResources`). The invocation service hands
 * bindings a SCOPED view containing only declared resources — undeclared
 * resources are structurally absent, so a binding cannot read them. Outputs
 * that combine auxiliary authority (DRC rules, presets, netlist, authority
 * records) carry explicit `pinned` provenance naming the exact resource
 * ids/versions/digests they consumed.
 *
 * Bindings are pure over the supplied resources: no provider calls, no
 * database access, no React/browser state, no history writes, no browser
 * storage, no durable envelopes, no manufacturing authority.
 * Non-deterministic timing fields from underlying engines are normalized so
 * results are digest-stable and replayable.
 */

import { inspectProjectTimeline, inspectViewState, type CapturedViewContext } from "../agent/view-context";
import type { SelectionRef } from "../pcb/edit/commands";
import { getItems } from "../pcb/selection-queries";
import { buildAIPcbSnapshot } from "../pcb/ai/snapshot";
import { buildMechanicalSnapshot } from "../pcb/ai/mechanical"; // [B18-E E11] the bounded mechanical read
import { buildViaSnapshot } from "../pcb/ai/vias"; // [B18-E E13] the bounded via read
import { runDrc } from "../pcb/drc/run-drc";
import type { DrcPreset, DrcRules } from "../pcb/drc/types";
import { computeConnectivity } from "../pcb/connectivity-board";
import { evaluatePcbFabricationReadiness } from "../pcb/readiness/evaluate";
import type { FabPreset } from "../pcb/fab/types";
import type { PcbNetlist } from "../pcb/netlist-bridge";
import { pcbRevisionId } from "../pcb/revision";
import { inspectComponentAuthority, type ComponentAuthorityRecord, type ComponentCatalogCandidate } from "./component-authority";
import { inspectSchematicState } from "./schematic-read";
import { computeProjectRevision } from "./revision";
import type { ReadAuthorityResourceEnvelope, ReadResourceKind } from "./resource-envelopes";
import { canonicalJsonValue, engineeringDigest } from "./stable";
import type { ToolDescriptor } from "./tool-registry";
import type { CanonicalProjectState } from "./types";

// ─── Scoped resource view (only DECLARED kinds are present) ──────────────────

/** Envelope reference passed to bindings for pinning output provenance. */
export interface ConsumedResourceRef {
  resourceId: string;
  kind: ReadResourceKind;
  sourceVersion: string;
  contentDigest: string;
}

export interface ReadBindingResources {
  canonicalState: CanonicalProjectState;
  canonicalRef: ConsumedResourceRef;
  selection?: { refs: readonly SelectionRef[]; ref: ConsumedResourceRef };
  componentAuthority?: {
    records: readonly ComponentAuthorityRecord[];
    candidates?: readonly ComponentCatalogCandidate[];
    ref: ConsumedResourceRef;
  };
  drcRules?: { rules: DrcRules; ref: ConsumedResourceRef };
  fabPreset?: { preset: FabPreset; ref: ConsumedResourceRef };
  drcPreset?: { preset: DrcPreset; ref: ConsumedResourceRef };
  netlist?: { netlist: PcbNetlist; ref: ConsumedResourceRef };
  /** [B17-F] the captured view context (read tools answer from it; nothing here is engineering state). */
  viewState?: { view: CapturedViewContext; ref: ConsumedResourceRef };
  projectTimeline?: { view: CapturedViewContext; ref: ConsumedResourceRef };
}

export function consumedRef(envelope: ReadAuthorityResourceEnvelope): ConsumedResourceRef {
  return { resourceId: envelope.resourceId, kind: envelope.kind, sourceVersion: envelope.sourceVersion, contentDigest: envelope.contentDigest };
}

export interface ActivatedReadBinding {
  bindingId: string;
  bindingVersion: string;
  kind: "read";
  toolId: string;
  /** Must EXACTLY match the descriptor's declared implementation evidence. */
  module: string;
  symbol: string;
  /** Resource kinds this binding consumes — the service supplies ONLY these. */
  requiredResources: readonly ReadResourceKind[];
  optionalResources?: readonly ReadResourceKind[];
  invoke(args: Record<string, unknown>, resources: ReadBindingResources, signal?: AbortSignal): unknown | Promise<unknown>;
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
    // [B17-F] read-only VIEW state of every open editor surface, from the run's captured view context.
    bindingId: "read.view-state", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.view.read-state",
    module: "app/lib/agent/view-context.ts", symbol: "inspectViewState",
    requiredResources: ["canonical-state", "view-state-snapshot"],
    invoke: (args, resources) => {
      if (!resources.viewState) throw new Error("VIEW_RESOURCE_ABSENT");
      // Inspection provenance only — view state is never engineering state or authority.
      return { report: inspectViewState(resources.viewState.view, { editor: args.editor }), pinned: { view: resources.viewState.ref } };
    },
  },
  {
    // [B17-F] the project operation timeline (both authoritative histories referenced, never replaced).
    bindingId: "read.project-timeline", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.project.history-inspect",
    module: "app/lib/agent/view-context.ts", symbol: "inspectProjectTimeline",
    requiredResources: ["canonical-state", "project-timeline-snapshot"],
    invoke: (args, resources) => {
      if (!resources.projectTimeline) throw new Error("TIMELINE_RESOURCE_ABSENT");
      return { report: inspectProjectTimeline(resources.projectTimeline.view, { limit: args.limit }), pinned: { timeline: resources.projectTimeline.ref } };
    },
  },
  {
    bindingId: "read.canonical-revision", bindingVersion: "1.1.0", kind: "read",
    toolId: "sirkit.project.canonical-revision-inspect",
    module: "app/lib/engineering/revision.ts", symbol: "computeProjectRevision",
    requiredResources: ["canonical-state"],
    invoke: (_args, resources) => ({ revision: computeProjectRevision(resources.canonicalState) }),
  },
  {
    bindingId: "read.schematic-snapshot", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.schematic.inspect",
    module: "app/lib/engineering/schematic-read.ts", symbol: "inspectSchematicState",
    requiredResources: ["canonical-state"],
    // B09 — the canonical-state envelope carries the authoritative schematic
    // snapshot as opaque JSON (B07.3); the pure accessor projects it
    // deterministically and fails closed on malformed shapes.
    invoke: (_args, resources) => ({ report: toPlainJson(inspectSchematicState(resources.canonicalState.schematic) as unknown as Record<string, unknown>) }),
  },
  {
    bindingId: "read.pcb-revision", bindingVersion: "1.1.0", kind: "read",
    toolId: "sirkit.pcb.revision-inspect",
    module: "app/lib/pcb/revision.ts", symbol: "pcbRevisionId",
    requiredResources: ["canonical-state"],
    invoke: (_args, resources) => ({ revision: pcbRevisionId(resources.canonicalState.pcb) }),
  },
  {
    bindingId: "read.board-snapshot", bindingVersion: "1.1.0", kind: "read",
    toolId: "sirkit.pcb.board-inspect",
    module: "app/lib/pcb/ai/snapshot.ts", symbol: "buildAIPcbSnapshot",
    requiredResources: ["canonical-state"],
    invoke: (args, resources) => {
      const projectId = typeof args.projectId === "string" ? args.projectId : resources.canonicalState.projectId;
      const snapshot = buildAIPcbSnapshot(resources.canonicalState.pcb, { projectId });
      // generatedInMs is wall-clock; provenance is the revision, not the timer.
      return { snapshot: withoutTiming(snapshot as unknown as Record<string, unknown>, ["generatedInMs"]) };
    },
  },
  {
    // [B18-E E11] the BOUNDED mechanical read: the board's extents and its mounting holes, and nothing else, so a dimension
    // can be planned on a board whose full snapshot exceeds the model's result budget.
    bindingId: "read.board-mechanical", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.pcb.mechanical-inspect",
    module: "app/lib/pcb/ai/mechanical.ts", symbol: "buildMechanicalSnapshot",
    requiredResources: ["canonical-state"],
    invoke: (_args, resources) => ({ mechanical: buildMechanicalSnapshot(resources.canonicalState.pcb, { boardRevisionId: pcbRevisionId(resources.canonicalState.pcb) }) as unknown as Record<string, unknown> }),
  },
  {
    // [B18-E E13] the BOUNDED via read: which nets carry vias, one net's vias with their padstack binding, and the board's
    // via padstack library — the facts a via proposal needs and the full snapshot never carried (and, on a routed board,
    // could not deliver within the model's result budget).
    bindingId: "read.board-vias", bindingVersion: "1.0.0", kind: "read",
    toolId: "sirkit.pcb.via-inspect",
    module: "app/lib/pcb/ai/vias.ts", symbol: "buildViaSnapshot",
    requiredResources: ["canonical-state"],
    invoke: (args, resources) => ({
      vias: buildViaSnapshot(resources.canonicalState.pcb, {
        netName: typeof (args as { netName?: unknown }).netName === "string" ? (args as { netName: string }).netName : null,
        boardRevisionId: pcbRevisionId(resources.canonicalState.pcb),
      }) as unknown as Record<string, unknown>,
    }),
  },
  {
    // [B10] 1.2.0: consumed by the agent over the sealed selection-snapshot
    // resource; without args.refs (the agent's empty strict schema) it
    // inspects the CURRENT sealed selection.
    bindingId: "read.selection", bindingVersion: "1.2.0", kind: "read",
    toolId: "sirkit.selection.inspect",
    module: "app/lib/pcb/selection-queries.ts", symbol: "getItems",
    requiredResources: ["canonical-state", "selection-snapshot"],
    invoke: (args, resources) => {
      if (!resources.selection) throw new Error("SELECTION_RESOURCE_ABSENT");
      const requested = (args.refs as SelectionRef[] | undefined) ?? [...resources.selection.refs];
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
          case "dimension": return { kind: item.kind, id: item.dimension.id, layer: item.dimension.layer, units: "nm" };
        }
      }).sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
      const resolvedIds = new Set(resolved.map((item) => item.id));
      const dropped = requested
        .map((ref) => (ref.kind === "pad" ? `${ref.footprintId}:${ref.padNumber}` : ref.id))
        .filter((id) => !resolvedIds.has(id))
        .sort();
      return { items: resolved, droppedRefs: dropped, pinned: { selection: resources.selection.ref } };
    },
  },
  {
    bindingId: "read.drc", bindingVersion: "1.1.0", kind: "read",
    toolId: "sirkit.validation.drc-run",
    module: "app/lib/pcb/drc/run-drc.ts", symbol: "runDrc",
    requiredResources: ["canonical-state", "drc-rules"],
    invoke: (_args, resources) => {
      if (!resources.drcRules) throw new Error("DRC_RULES_RESOURCE_ABSENT");
      const raw = runDrc(resources.canonicalState.pcb, resources.drcRules.rules) as unknown as Record<string, unknown>;
      // stats.elapsedMs is wall-clock — normalize for digest determinism.
      const normalized = structuredClone(raw);
      const stats = normalized.stats as Record<string, unknown> | undefined;
      if (stats && "elapsedMs" in stats) stats.elapsedMs = 0;
      const report = toPlainJson(normalized);
      return {
        report,
        pinned: {
          boardRevision: pcbRevisionId(resources.canonicalState.pcb),
          drcRules: resources.drcRules.ref,
          engineVersion: String((report as Record<string, unknown>).checkVersion ?? "unversioned"),
          reportDigest: engineeringDigest(report),
        },
      };
    },
  },
  {
    bindingId: "read.connectivity", bindingVersion: "1.1.0", kind: "read",
    toolId: "sirkit.validation.connectivity-verify",
    module: "app/lib/pcb/connectivity-board.ts", symbol: "computeConnectivity",
    requiredResources: ["canonical-state"],
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
    bindingId: "read.component-authority", bindingVersion: "1.1.0", kind: "read",
    toolId: "sirkit.component-authority.inspect",
    module: "app/lib/engineering/component-authority.ts", symbol: "inspectComponentAuthority",
    requiredResources: ["canonical-state", "component-authority-records"],
    invoke: (args, resources) => {
      if (!resources.componentAuthority) throw new Error("COMPONENT_AUTHORITY_RESOURCE_ABSENT");
      const componentIds = (args.componentIds as string[] | undefined) ?? resources.componentAuthority.records.map((record) => record.componentId);
      const components = inspectComponentAuthority({
        componentIds,
        projectId: resources.canonicalState.projectId,
        records: resources.componentAuthority.records,
        candidates: resources.componentAuthority.candidates,
      });
      return { components, pinned: { authorityResource: resources.componentAuthority.ref } };
    },
  },
  {
    bindingId: "read.readiness", bindingVersion: "1.1.0", kind: "read",
    toolId: "sirkit.manufacturing.readiness-inspect",
    module: "app/lib/pcb/readiness/evaluate.ts", symbol: "evaluatePcbFabricationReadiness",
    requiredResources: ["canonical-state", "fab-preset", "drc-preset"],
    optionalResources: ["netlist"],
    invoke: (_args, resources) => {
      if (!resources.fabPreset || !resources.drcPreset) throw new Error("READINESS_RESOURCES_ABSENT");
      const report = toPlainJson(evaluatePcbFabricationReadiness({
        board: resources.canonicalState.pcb,
        fabPreset: resources.fabPreset.preset,
        drcPreset: resources.drcPreset.preset,
        ...(resources.netlist ? { netlist: resources.netlist.netlist } : {}),
      }));
      return {
        report,
        // Inspection provenance ONLY — a readiness report is never
        // manufacturing authority or release evidence.
        pinned: {
          boardRevision: pcbRevisionId(resources.canonicalState.pcb),
          fabPreset: resources.fabPreset.ref,
          drcPreset: resources.drcPreset.ref,
          ...(resources.netlist ? { netlist: resources.netlist.ref } : {}),
          engineVersion: "pcb/readiness/evaluate",
          reportDigest: engineeringDigest(report),
        },
      };
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
  if (!entry.requiredResources.includes("canonical-state")) {
    return { state: "not_callable", reason: "Every read binding must declare the canonical-state resource." };
  }
  return { state: "resolved", binding: entry };
}
