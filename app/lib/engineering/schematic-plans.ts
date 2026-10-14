/**
 * B06 — deterministic schematic impact planners.
 *
 * Pure functions over explicitly supplied state + catalog pin data. They
 * build the EXACT operations the canonical executor will apply, plus a
 * human-inspectable impact plan. Nothing here mutates state, queries the
 * catalog, or calls providers.
 *
 * DELETE policy (the audited tier-1 semantics, applied uniformly): removing
 * a component removes (a) every wire whose FIRST or LAST vertex sits exactly
 * on one of the component's pin coordinates, and (b) every net label
 * positioned exactly at one of those coordinates. Interior vertices never
 * match (no accidental removal of unrelated segments), same-name labels
 * elsewhere keep their nets alive (no hidden net merging), and orphan
 * cleanup is exactly the listed entities — deterministic and replayable.
 *
 * REPLACEMENT policy (fail closed): target identity must be an exact partId
 * with supplied pin data; authority status is RECORDED, never inferred; pin
 * mapping requires exact number+name identity or an explicit caller mapping;
 * connected pins that cannot be preserved must be explicitly acknowledged or
 * the plan is refused. Pin-count equality, display text, and
 * provider-generated names are never evidence.
 *
 * B06.1 authority closure: `verified-atomic` authority is ONLY a
 * `VerifiedReplacementAuthority` instance minted by the internal B05.1
 * resource-bundle adapter (`schematic-authority.internal.ts`). A plain
 * caller-supplied object carrying a status string and/or atomic identifiers
 * is structurally refused. Catalog swaps stay explicitly
 * `catalog-unverified` and CLEAR stale atomic authority.
 *
 * B06.1 label safety: replacement moves net labels attached to mapped pin
 * coordinates atomically with the wire endpoints (position-preconditioned,
 * exactly inverted); label connectivity is never silently reported as
 * preserved, and acknowledged drops that strand a label are surfaced.
 */

import { PIN_NAMES, schDisplayRef, type SchematicEditOp, type SchematicState } from "@/lib/schematic-types";
import { kicadPinWorldPos, pinWorldPos } from "../geometry";
import type { KicadPin } from "../kicad/types";
import { VerifiedReplacementAuthority } from "./schematic-authority.internal";
import type { EngineeringOperation } from "./types";
import { agentDeleteConnectivityRefusal } from "./agent-delete-connectivity";

const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;

export interface SchematicDeleteImpactPlan {
  family: "theory" | "kicad";
  componentId: string;
  componentLabel: string;
  pinCoordinates: Array<{ x: number; y: number }>;
  removeWireIds: string[];
  removeNetLabelIds: string[];
  /** Names of labels being removed — their nets survive via same-name labels elsewhere. */
  removedLabelNames: string[];
  downstream: {
    physicalBinding: string | null;
    pcbSync: string;
    bomSpice: string;
    readiness: string;
  };
}

export type SchematicDeletePlanResult =
  | { ok: true; plan: SchematicDeleteImpactPlan; operation: EngineeringOperation }
  | { ok: false; refusal: "component-not-found" | "pins-unavailable"; detail: string };

export function planSchematicDelete(
  state: SchematicState,
  target: { family: "theory" | "kicad"; componentId: string },
  /** Catalog pin data for kicad targets — supplied explicitly, never fetched. */
  kicadPins?: readonly KicadPin[],
): SchematicDeletePlanResult {
  let pinCoordinates: Array<{ x: number; y: number }>;
  let componentLabel: string;
  let hasAuthority = false;
  if (target.family === "theory") {
    const component = state.components.find((item) => item.id === target.componentId);
    if (!component) return { ok: false, refusal: "component-not-found", detail: `No theory component ${target.componentId}.` };
    pinCoordinates = (PIN_NAMES[component.type] ?? []).map((pin) => pinWorldPos(component, pin));
    // B07.1 — user-facing plan labels show the DISPLAYED reference.
    componentLabel = `${component.type} ${schDisplayRef(component)}`;
  } else {
    const component = (state.kicadComponents ?? []).find((item) => item.id === target.componentId);
    if (!component) return { ok: false, refusal: "component-not-found", detail: `No component ${target.componentId}.` };
    if (!kicadPins) return { ok: false, refusal: "pins-unavailable", detail: `Pin data for part ${component.partId} was not supplied; deterministic cleanup requires it.` };
    pinCoordinates = kicadPins.map((pin) => kicadPinWorldPos(component, pin));
    componentLabel = component.refDes;
    hasAuthority = Boolean(component.atomicPartRevisionId || component.mappingCertificateId || component.selectionRecordId);
  }
  const pinKeys = new Set(pinCoordinates.map(key));
  const removeWireIds = state.wires
    .filter((wire) => {
      const first = wire.vertices[0];
      const last = wire.vertices[wire.vertices.length - 1];
      return (first && pinKeys.has(key(first))) || (last && pinKeys.has(key(last)));
    })
    .map((wire) => wire.id)
    .sort();
  const removedLabels = (state.netLabels ?? []).filter((label) => pinKeys.has(key(label.position)));
  const plan: SchematicDeleteImpactPlan = {
    family: target.family,
    componentId: target.componentId,
    componentLabel,
    pinCoordinates,
    removeWireIds,
    removeNetLabelIds: removedLabels.map((label) => label.id).sort(),
    removedLabelNames: [...new Set(removedLabels.map((label) => label.name))].sort(),
    downstream: {
      physicalBinding: target.family === "kicad"
        ? hasAuthority
          ? "The physical-binding set keyed by this componentInstanceId becomes orphan-eligible. NO runtime orphan transition exists today — resolving the durable binding is an explicit owner action."
          : "No atomic authority recorded on this instance; durable publication already fails closed for it."
        : null,
      pcbSync: "The publication graph loses this componentInstanceId; the sync dirty flag flips and existing plans fail closed at preflight (PS_SCHEMATIC_REVISION_MISMATCH / removed-net protection).",
      bomSpice: "BOM regroups on the next signature change; SPICE captures a new design revision on next run (existing runs stay pinned to their snapshot).",
      readiness: "Schematic parity certificate and manufacturing readiness recompute against the new netlist.",
    },
  };
  return {
    ok: true,
    plan,
    operation: {
      operationId: `op:sch-delete:${target.componentId}`,
      schemaVersion: 1,
      units: "px",
      kind: "schematic_delete_component",
      family: target.family,
      componentId: target.componentId,
      removeWireIds,
      removeNetLabelIds: plan.removeNetLabelIds,
    },
  };
}

// ─── Replacement ─────────────────────────────────────────────────────────────

export interface SchematicReplacementInput {
  componentId: string;
  /** Exact target identity — partId plus supplied pin data (never fetched). */
  target: {
    partId: string;
    pins: readonly KicadPin[];
    value?: string;
    /**
     * B06.1: either an explicit catalog-unverified marker, or a
     * `VerifiedReplacementAuthority` minted by the approved internal adapter.
     * Any other shape — including a plain object claiming
     * `verified-atomic` or carrying atomic identifiers — is refused.
     */
    authority?: { status: "catalog-unverified" } | VerifiedReplacementAuthority;
  };
  /** Current part's pin data (for the instance being replaced). */
  currentPins: readonly KicadPin[];
  /** Explicit old→new pin mapping (by pin number) when identity mapping fails. */
  explicitPinMapping?: ReadonlyArray<{ fromPin: string; toPin: string }>;
  /** Connected pins the caller EXPLICITLY accepts losing (by pin number). */
  acknowledgeDroppedPins?: readonly string[];
}

export interface SchematicReplacementPlan {
  componentId: string;
  sourcePartId: string;
  targetPartId: string;
  mode: "value-only" | "pin-identical-substitution" | "mapped-substitution";
  authorityStatus: "verified-atomic" | "catalog-unverified" | "authority-cleared";
  pinMapping: Array<{ fromPin: string; toPin: string }>;
  preservedConnections: string[];
  droppedConnections: string[];
  wireEndpointMoves: Array<{ wireId: string; end: "start" | "end"; to: { x: number; y: number } }>;
  /** B06.1: label moves preserving label-attached connectivity (versioned in the operation, exactly inverted). */
  netLabelMoves: Array<{ labelId: string; labelName: string; from: { x: number; y: number }; to: { x: number; y: number } }>;
  /** B06.1: resource ids + digests a verified replacement consumed (empty otherwise). */
  consumedAuthorityResources: Array<{ resourceId: string; contentDigest: string }>;
  warnings: string[];
  downstream: string[];
}

export type SchematicReplacementResult =
  | { ok: true; plan: SchematicReplacementPlan; operation: EngineeringOperation }
  | {
      ok: false;
      refusal:
        | "component-not-found"
        | "explicit-pin-mapping-required"
        | "invalid-pin-mapping"
        | "unacknowledged-dropped-connections"
        | "ambiguous-authority"
        | "ambiguous-label-move";
      detail: string;
      /** Pin numbers needing an explicit decision, when applicable. */
      pins?: string[];
    };

// ─── Tier-1 AI proposal compilation (B06.1: strictly all-or-nothing) ─────────

export interface Tier1CompileInput {
  ops: readonly SchematicEditOp[];
  /** Catalog pin data by partId for kicad delete targets — supplied, never fetched. */
  pinsByPartId: ReadonlyMap<string, readonly KicadPin[]>;
}

export type Tier1BlockerCode =
  | "empty-proposal"
  | "unknown-target"
  | "unsupported-theory-rename"
  | "pins-unavailable"
  | "delete-plan-refused";

export interface Tier1Blocker {
  code: Tier1BlockerCode;
  target?: string;
  detail: string;
}

export interface Tier1ProposalImpacts {
  propertyEdits: Array<{ family: "theory" | "kicad"; componentId: string; targetLabel: string; patch: { value?: string; refDes?: string } }>;
  deletes: SchematicDeleteImpactPlan[];
  /** True when any delete is present (destructive approval tier applies). */
  destructive: boolean;
}

export type Tier1CompilationResult =
  | {
      ok: true;
      /** One atomic canonical batch in original op order. */
      operations: EngineeringOperation[];
      impacts: Tier1ProposalImpacts;
    }
  | {
      ok: false;
      /** EVERY blocker found — the whole proposal is refused; no valid subset executes. */
      blockers: Tier1Blocker[];
    };

/**
 * Deterministically compile a tier-1 AI edit op list (set-value / rename /
 * delete, targets are theory ids or kicad refDes) into ONE canonical batch.
 *
 * B06.1 all-or-nothing rule: any unknown target, unsupported operation
 * (theory id-rename — rewriting the component primary key is blocked pending
 * stable-identity work), missing pin data, or refused delete plan BLOCKS the
 * COMPLETE proposal. There is no partial apply and no legacy side channel.
 *
 * The compiler simulates the op sequence against a copy of the state so
 * later ops resolve targets exactly as sequential application will —
 * including renamed kicad refDes targets and components removed earlier in
 * the batch. Provider text never becomes authority.
 */
export function compileTier1Proposal(state: SchematicState, input: Tier1CompileInput): Tier1CompilationResult {
  const sim: SchematicState = structuredClone({
    components: state.components,
    wires: state.wires,
    kicadComponents: state.kicadComponents ?? [],
    netLabels: state.netLabels ?? [],
  });
  const operations: EngineeringOperation[] = [];
  const blockers: Tier1Blocker[] = [];
  const impacts: Tier1ProposalImpacts = { propertyEdits: [], deletes: [], destructive: false };

  if (input.ops.length === 0) {
    return { ok: false, blockers: [{ code: "empty-proposal", detail: "The proposal contains no operations." }] };
  }

  input.ops.forEach((op, index) => {
    // B07: theory targets are DISPLAY references (refDes ?? id); the compiled
    // operations always address the immutable stable id.
    const theory = sim.components.find((item) => (item.refDes ?? item.id) === op.target);
    const kicad = (sim.kicadComponents ?? []).find((item) => item.refDes === op.target);
    if (!theory && !kicad) {
      blockers.push({ code: "unknown-target", target: op.target, detail: `Target ${op.target} does not exist at its position in the proposed sequence.` });
      return;
    }
    const opId = (suffix: string): string => `op:tier1:${index}:${suffix}`;
    if (op.op === "set-value") {
      if (theory) {
        operations.push({ operationId: opId(`value:${theory.id}`), schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: theory.id, patch: { value: op.value } });
        impacts.propertyEdits.push({ family: "theory", componentId: theory.id, targetLabel: op.target, patch: { value: op.value } });
        theory.value = op.value;
      } else if (kicad) {
        operations.push({ operationId: opId(`value:${kicad.id}`), schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "kicad", componentId: kicad.id, patch: { value: op.value } });
        impacts.propertyEdits.push({ family: "kicad", componentId: kicad.id, targetLabel: op.target, patch: { value: op.value } });
        kicad.value = op.value;
      }
    } else if (op.op === "rename") {
      if (theory) {
        // B07: canonical theory rename EXISTS (it edits the display refDes,
        // never the stable id) as a trusted interactive command — but
        // enabling it for PROVIDER-GENERATED proposals is an explicit
        // activation decision the owner has not made. The whole proposal
        // stays blocked (all-or-nothing).
        blockers.push({ code: "unsupported-theory-rename", target: op.target, detail: `Renaming theory component ${op.target} from an AI proposal is not enabled (interactive rename exists; proposal activation is an explicit owner decision); the proposal is blocked.` });
        return;
      }
      if (kicad) {
        operations.push({ operationId: opId(`refdes:${kicad.id}`), schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "kicad", componentId: kicad.id, patch: { refDes: op.refDes } });
        impacts.propertyEdits.push({ family: "kicad", componentId: kicad.id, targetLabel: op.target, patch: { refDes: op.refDes } });
        kicad.refDes = op.refDes;
      }
    } else if (op.op === "delete") {
      const family = theory ? ("theory" as const) : ("kicad" as const);
      const simId = theory ? theory.id : kicad!.id;
      const pins = kicad ? input.pinsByPartId.get(kicad.partId) : undefined;
      if (kicad && !pins) {
        blockers.push({ code: "pins-unavailable", target: op.target, detail: `Pin data for part ${kicad.partId} was not supplied; a deterministic delete plan cannot be computed for ${op.target}.` });
        return;
      }
      const planned = planSchematicDelete(sim, { family, componentId: simId }, pins);
      if (!planned.ok) {
        blockers.push({ code: "delete-plan-refused", target: op.target, detail: planned.detail });
        return;
      }
      operations.push({ ...planned.operation, operationId: opId(`delete:${simId}`) });
      impacts.deletes.push(planned.plan);
      impacts.destructive = true;
      if (theory) {
        sim.components = sim.components.filter((item) => item.id !== simId);
      } else {
        sim.kicadComponents = (sim.kicadComponents ?? []).filter((item) => item.id !== simId);
      }
      const wireIds = new Set(planned.plan.removeWireIds);
      const labelIds = new Set(planned.plan.removeNetLabelIds);
      sim.wires = sim.wires.filter((wire) => !wireIds.has(wire.id));
      sim.netLabels = (sim.netLabels ?? []).filter((label) => !labelIds.has(label.id));
    }
  });

  if (blockers.length > 0) return { ok: false, blockers };
  const connectivityRefusal = agentDeleteConnectivityRefusal(state, impacts.deletes, input.pinsByPartId);
  if (connectivityRefusal) return { ok: false, blockers: [{ code: "delete-plan-refused", detail: connectivityRefusal }] };
  return { ok: true, operations, impacts };
}

export function planSchematicReplacement(state: SchematicState, input: SchematicReplacementInput): SchematicReplacementResult {
  const component = (state.kicadComponents ?? []).find((item) => item.id === input.componentId);
  if (!component) return { ok: false, refusal: "component-not-found", detail: `No component ${input.componentId}.` };

  // B06.1 authority closure: verified-atomic authority exists ONLY as a
  // branded instance from the approved internal adapter. Any other supplied
  // shape — a status string, atomic identifier fields, a deserialized or
  // structurally-forged copy — is refused. The legacy swap defect (retaining
  // stale authority across a partId change) stays structurally impossible
  // because the operation replaces every identity field together.
  const authority = input.target.authority;
  let verified: VerifiedReplacementAuthority | null = null;
  if (authority instanceof VerifiedReplacementAuthority) {
    if (authority.componentId !== component.id || authority.targetPartId !== input.target.partId) {
      return { ok: false, refusal: "ambiguous-authority", detail: `The supplied verified authority is bound to component ${authority.componentId} → part ${authority.targetPartId}, not ${component.id} → ${input.target.partId}.` };
    }
    verified = authority;
  } else if (authority !== undefined) {
    const structural = authority as { status?: unknown } & Record<string, unknown>;
    const carriesAtomicIdentity = Boolean(structural.atomicPartRevisionId || structural.mappingCertificateId || structural.symbolAssetVersionId || structural.footprintAssetVersionId || structural.selectionRecordId);
    if (structural.status !== "catalog-unverified" || carriesAtomicIdentity) {
      return { ok: false, refusal: "ambiguous-authority", detail: "Verified atomic authority can only be established by the approved authority adapter consuming a validated resource bundle; a caller-supplied status/identifier object is never authority." };
    }
  }
  const authorityStatus: SchematicReplacementPlan["authorityStatus"] =
    verified ? "verified-atomic" : authority ? "catalog-unverified" : "authority-cleared";

  const samePart = component.partId === input.target.partId;
  const oldByNumber = new Map(input.currentPins.map((pin) => [pin.number, pin]));
  const newByNumber = new Map(input.target.pins.map((pin) => [pin.number, pin]));

  // Connected old pins: a wire endpoint or label sits exactly on the pin.
  const wireEndpointsAt = (coordinate: { x: number; y: number }): Array<{ wireId: string; end: "start" | "end" }> => {
    const at = key(coordinate);
    const hits: Array<{ wireId: string; end: "start" | "end" }> = [];
    for (const wire of state.wires) {
      const first = wire.vertices[0];
      const last = wire.vertices[wire.vertices.length - 1];
      if (first && key(first) === at) hits.push({ wireId: wire.id, end: "start" });
      if (last && wire.vertices.length > 1 && key(last) === at) hits.push({ wireId: wire.id, end: "end" });
    }
    return hits;
  };
  const connectedPins = input.currentPins.filter((pin) => {
    const coordinate = kicadPinWorldPos(component, pin);
    return wireEndpointsAt(coordinate).length > 0 || (state.netLabels ?? []).some((label) => key(label.position) === key(coordinate));
  });

  // Pin mapping: exact number+name identity, or the caller's explicit map.
  let mapping: Array<{ fromPin: string; toPin: string }>;
  if (input.explicitPinMapping) {
    const seenFrom = new Set<string>();
    const seenTo = new Set<string>();
    for (const entry of input.explicitPinMapping) {
      if (!oldByNumber.has(entry.fromPin)) return { ok: false, refusal: "invalid-pin-mapping", detail: `Mapping source pin ${entry.fromPin} does not exist on the current part.` };
      if (!newByNumber.has(entry.toPin)) return { ok: false, refusal: "invalid-pin-mapping", detail: `Mapping target pin ${entry.toPin} does not exist on the replacement part.` };
      if (seenFrom.has(entry.fromPin) || seenTo.has(entry.toPin)) return { ok: false, refusal: "invalid-pin-mapping", detail: "Pin mapping entries must be one-to-one." };
      seenFrom.add(entry.fromPin);
      seenTo.add(entry.toPin);
    }
    mapping = input.explicitPinMapping.map((entry) => ({ ...entry }));
  } else if (samePart) {
    mapping = input.currentPins.map((pin) => ({ fromPin: pin.number, toPin: pin.number }));
  } else {
    // Identity mapping: SAME number AND same trimmed name. Pin-count
    // equality alone is never accepted.
    mapping = [];
    const unmappable: string[] = [];
    for (const pin of connectedPins) {
      const candidate = newByNumber.get(pin.number);
      if (candidate && candidate.name.trim() === pin.name.trim()) mapping.push({ fromPin: pin.number, toPin: candidate.number });
      else unmappable.push(pin.number);
    }
    if (unmappable.length > 0) {
      return {
        ok: false,
        refusal: "explicit-pin-mapping-required",
        detail: `Connected pin(s) ${unmappable.sort().join(", ")} have no identity-equal pin on the replacement part; an explicit mapping (or acknowledged drop) is required.`,
        pins: unmappable.sort(),
      };
    }
  }

  const mappedFrom = new Set(mapping.map((entry) => entry.fromPin));
  const dropped = connectedPins.filter((pin) => !mappedFrom.has(pin.number)).map((pin) => pin.number).sort();
  const acknowledged = new Set(input.acknowledgeDroppedPins ?? []);
  const unacknowledged = dropped.filter((pin) => !acknowledged.has(pin));
  if (unacknowledged.length > 0) {
    return {
      ok: false,
      refusal: "unacknowledged-dropped-connections",
      detail: `Connected pin(s) ${unacknowledged.join(", ")} would lose their connections; explicit acknowledgement is required.`,
      pins: unacknowledged,
    };
  }

  // Wire endpoint AND net-label moves for mapped connected pins whose
  // position changes. Labels move atomically with the wires; a label pulled
  // toward two DIFFERENT destinations (stacked old pins mapping apart) is
  // ambiguous and refuses the whole plan.
  const wireEndpointMoves: SchematicReplacementPlan["wireEndpointMoves"] = [];
  const netLabelMoves: SchematicReplacementPlan["netLabelMoves"] = [];
  const labelDestinations = new Map<string, string>();
  for (const entry of mapping) {
    const oldPin = oldByNumber.get(entry.fromPin);
    const newPin = newByNumber.get(entry.toPin);
    if (!oldPin || !newPin) continue;
    const oldCoordinate = kicadPinWorldPos(component, oldPin);
    const newCoordinate = kicadPinWorldPos(component, newPin);
    if (key(oldCoordinate) === key(newCoordinate)) continue;
    for (const hit of wireEndpointsAt(oldCoordinate)) wireEndpointMoves.push({ ...hit, to: newCoordinate });
    for (const netLabel of (state.netLabels ?? []).filter((candidate) => key(candidate.position) === key(oldCoordinate))) {
      const existing = labelDestinations.get(netLabel.id);
      if (existing !== undefined && existing !== key(newCoordinate)) {
        return { ok: false, refusal: "ambiguous-label-move", detail: `Net label ${netLabel.name} (${netLabel.id}) sits on stacked pins that map to different positions; refusing the ambiguous move.` };
      }
      if (existing === undefined) {
        labelDestinations.set(netLabel.id, key(newCoordinate));
        netLabelMoves.push({ labelId: netLabel.id, labelName: netLabel.name, from: { ...netLabel.position }, to: newCoordinate });
      }
    }
  }

  const warnings: string[] = [];
  if (authorityStatus === "catalog-unverified") warnings.push("Replacement carries catalog identity only; durable publication will fail closed until atomic authority is bound.");
  if (authorityStatus === "authority-cleared" && (component.atomicPartRevisionId || component.mappingCertificateId)) {
    warnings.push("Existing atomic authority on this instance is CLEARED by the replacement (it belonged to the previous part).");
  }
  // Explicitly surface labels stranded by acknowledged drops — dropped label
  // connectivity is handled (warned + left in place), never silent.
  for (const pinNumber of dropped) {
    const droppedPin = oldByNumber.get(pinNumber);
    if (!droppedPin) continue;
    const coordinate = kicadPinWorldPos(component, droppedPin);
    const strandedNames = (state.netLabels ?? []).filter((candidate) => key(candidate.position) === key(coordinate)).map((candidate) => candidate.name).sort();
    if (strandedNames.length > 0) warnings.push(`Acknowledged drop of pin ${pinNumber} leaves net label(s) ${strandedNames.join(", ")} at the old pin position, no longer attached to this component.`);
  }

  const plan: SchematicReplacementPlan = {
    componentId: component.id,
    sourcePartId: component.partId,
    targetPartId: input.target.partId,
    mode: samePart ? "value-only" : wireEndpointMoves.length === 0 && dropped.length === 0 && !input.explicitPinMapping ? "pin-identical-substitution" : "mapped-substitution",
    authorityStatus,
    pinMapping: mapping,
    preservedConnections: mapping.filter((entry) => connectedPins.some((pin) => pin.number === entry.fromPin)).map((entry) => entry.fromPin).sort(),
    droppedConnections: dropped,
    wireEndpointMoves,
    netLabelMoves,
    consumedAuthorityResources: verified ? verified.consumedResources.map((entry) => ({ ...entry })) : [],
    warnings,
    downstream: [
      "netlist pin set changes under a stable component id; schematic parity + sync dirty flag update",
      "physical-binding qualification for this componentInstanceId must be re-established for the new identity",
      "existing pcb-sync plans go stale (fail closed at preflight)",
      "BOM regroups by the new part identity; SPICE captures a new design revision on next run",
      "manufacturing readiness recomputes against the new netlist",
    ],
    };
  return {
    ok: true,
    plan,
    operation: {
      operationId: `op:sch-replace:${component.id}`,
      schemaVersion: 1,
      units: "px",
      kind: "schematic_replace_component",
      componentId: component.id,
      expectedCurrentPartId: component.partId,
      replacement: {
        partId: input.target.partId,
        ...(input.target.value !== undefined ? { value: input.target.value } : {}),
        ...(verified
          ? {
              atomicPartRevisionId: verified.atomicPartRevisionId,
              symbolAssetVersionId: verified.symbolAssetVersionId,
              footprintAssetVersionId: verified.footprintAssetVersionId,
              mappingCertificateId: verified.mappingCertificateId,
              selectionRecordId: verified.selectionRecordId,
            }
          : {}),
      },
      pinMapping: mapping,
      wireEndpointMoves,
      netLabelMoves: netLabelMoves.map((move) => ({ labelId: move.labelId, from: move.from, to: move.to })),
      ...(verified ? { consumedAuthorityResources: verified.consumedResources.map((entry) => ({ ...entry })), authorityGrantId: verified.grantId } : {}),
    },
  };
}
