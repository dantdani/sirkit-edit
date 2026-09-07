import type {
  FootprintInstance,
  PcbBoard,
  PcbNet,
  ResolvedPinPadMapping,
  Track,
  Via,
  Zone,
} from "./types";
import { reconcileStackupPlaneZones } from "./zones/plane";
import { markZoneFillDirty, zoneFillInputRevision, zoneFillIsCurrent } from "./zones/fill-lifecycle";
import { compareCodePoints } from "@/app/lib/stable-compare";

export type EngineeringDiagnosticSeverity = "error" | "warning" | "info";

/** Machine-readable correctness result shared by sync, export, edit, and AI paths. */
export interface EngineeringDiagnostic {
  code: string;
  severity: EngineeringDiagnosticSeverity;
  summary: string;
  details?: string;
  objectIds?: string[];
  componentIds?: string[];
  netStableIds?: string[];
  context?: Record<string, unknown>;
  suggestedActions?: string[];
}

export function engineeringDiagnostic(
  code: string,
  summary: string,
  fields: Omit<EngineeringDiagnostic, "code" | "severity" | "summary"> & {
    severity?: EngineeringDiagnosticSeverity;
  } = {},
): EngineeringDiagnostic {
  const { severity = "error", ...rest } = fields;
  return { code, severity, summary, ...rest };
}

export function compareDiagnostics(a: EngineeringDiagnostic, b: EngineeringDiagnostic): number {
  return compareCodePoints(a.code, b.code)
    || compareCodePoints(a.summary, b.summary)
    || compareCodePoints(JSON.stringify(a.objectIds ?? []), JSON.stringify(b.objectIds ?? []));
}

export function normalizePinIdentifier(value: string): string {
  return value.trim();
}

/** Pin identifiers remain case-sensitive and are never coerced to numbers. */
export function schematicEndpointKey(componentInstanceId: string, pinNumber: string): string {
  return `${encodeURIComponent(componentInstanceId)}::${encodeURIComponent(normalizePinIdentifier(pinNumber))}`;
}

export function canonicalEndpointSet(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort((a, b) => compareCodePoints(a, b));
}

/** Two independently-seeded FNV-1a lanes, represented as 64 bits of stable text. */
function stableHash(value: string): string {
  const lane = (seed: number): string => {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
  return `${lane(0x811c9dc5)}${lane(0x9e3779b9)}`;
}

export function stableNetIdForEndpoints(endpointKeys: readonly string[], name = ""): string {
  const endpoints = canonicalEndpointSet(endpointKeys);
  const identityMaterial = endpoints.length > 0 ? endpoints.join("\0") : `name:${name.trim()}`;
  return `net:${stableHash(identityMaterial)}`;
}

function legacyStableNetId(projectId: string, net: PcbNet, endpointKeys: readonly string[]): string {
  return `legacy-net:${stableHash(`${projectId}\0${net.id}\0${net.name}\0${canonicalEndpointSet(endpointKeys).join("\0")}`)}`;
}

export function canonicalReference(reference: string): string {
  return reference.trim().toUpperCase();
}

const VALID_EXPORTED_REFERENCE = /^[A-Za-z][A-Za-z0-9_.:/+\-]*$/;

/** References are board-global. Display case is retained; comparison is trimmed uppercase. */
export function validateReferenceDesignators(
  components: readonly Pick<FootprintInstance, "id" | "ref">[],
): EngineeringDiagnostic[] {
  const diagnostics: EngineeringDiagnostic[] = [];
  const ids = new Map<string, number>();
  const byCanonical = new Map<string, Array<{ id: string; ref: string }>>();

  for (const component of [...components].sort((a, b) => compareCodePoints(a.id, b.id))) {
    ids.set(component.id, (ids.get(component.id) ?? 0) + 1);
    const trimmed = component.ref.trim();
    const canonical = canonicalReference(component.ref);
    if (trimmed.length === 0 || trimmed.includes("?")) {
      diagnostics.push(engineeringDiagnostic(
        "UNANNOTATED_COMPONENT",
        `Component ${component.id} needs a resolved reference designator before PCB sync or export.`,
        { componentIds: [component.id], context: { reference: component.ref }, suggestedActions: ["Annotate the schematic component with a unique board reference."] },
      ));
      continue;
    }
    if (trimmed !== component.ref || !VALID_EXPORTED_REFERENCE.test(trimmed) || !/\d/.test(trimmed)) {
      diagnostics.push(engineeringDiagnostic(
        "INVALID_REFERENCE_DESIGNATOR",
        `Reference '${component.ref}' on component ${component.id} is not a valid board-global exported reference.`,
        {
          componentIds: [component.id],
          context: { reference: component.ref, canonical },
          suggestedActions: ["Use an annotated reference such as R1, C4, U2, or J1 without surrounding whitespace."],
        },
      ));
    }
    const bucket = byCanonical.get(canonical) ?? [];
    bucket.push({ id: component.id, ref: component.ref });
    byCanonical.set(canonical, bucket);
  }

  for (const [id, count] of ids) {
    if (count > 1) {
      diagnostics.push(engineeringDiagnostic(
        "DUPLICATE_COMPONENT_ID",
        `Stable component identity '${id}' occurs ${count} times.`,
        { componentIds: [id], suggestedActions: ["Assign each schematic component instance one persistent unique ID."] },
      ));
    }
  }
  for (const [canonical, instances] of [...byCanonical].sort(([a], [b]) => compareCodePoints(a, b))) {
    const componentIds = [...new Set(instances.map((instance) => instance.id))].sort();
    if (componentIds.length < 2) continue;
    diagnostics.push(engineeringDiagnostic(
      "DUPLICATE_REFERENCE_DESIGNATOR",
      `Exported reference '${canonical}' identifies more than one component instance.`,
      {
        componentIds,
        context: { canonicalReference: canonical, references: instances.map((instance) => instance.ref) },
        suggestedActions: ["Reannotate the schematic so every physical component has a unique board-global reference."],
      },
    ));
  }
  return diagnostics.sort(compareDiagnostics);
}

export class BoardIntegrityError extends Error {
  constructor(public readonly diagnostics: EngineeringDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.summary).join(" "));
    this.name = "BoardIntegrityError";
  }
}

export function assertValidBoardReferences(board: Pick<PcbBoard, "footprints">): void {
  const diagnostics = validateReferenceDesignators(board.footprints);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new BoardIntegrityError(diagnostics);
  }
}

function endpointKeysByNumericNet(board: PcbBoard): Map<number, Set<string>> {
  const byNet = new Map<number, Set<string>>();
  const add = (netId: number, endpointKey: string): void => {
    if (netId === 0) return;
    const bucket = byNet.get(netId) ?? new Set<string>();
    bucket.add(endpointKey);
    byNet.set(netId, bucket);
  };
  for (const footprint of board.footprints) {
    if (footprint.pinPadMappings?.length) {
      for (const mapping of footprint.pinPadMappings) {
        const netIds = new Set(mapping.padNumbers.map((pad) => footprint.padNets[pad] ?? 0).filter((id) => id !== 0));
        if (netIds.size === 1) add([...netIds][0], mapping.endpointKey);
      }
      continue;
    }
    for (const [padNumber, netId] of Object.entries(footprint.padNets)) {
      if (netId !== 0) add(netId, schematicEndpointKey(footprint.id, padNumber));
    }
  }
  return byNet;
}

export interface BoardIdentityMigrationResult {
  board: PcbBoard;
  diagnostics: EngineeringDiagnostic[];
  migrated: boolean;
}

/**
 * Pure, deterministic legacy migration. It never changes a numeric net
 * association; stable IDs are derived once from project identity, the legacy
 * net record, and endpoint evidence, then persist with the returned board.
 */
export function migrateBoardElectricalIdentities(
  input: PcbBoard,
  projectId = "local-project",
): BoardIdentityMigrationResult {
  const board = structuredClone(input);
  const diagnostics: EngineeringDiagnostic[] = [];
  const numericIds = new Map<number, number>();
  for (const net of board.nets) numericIds.set(net.id, (numericIds.get(net.id) ?? 0) + 1);
  for (const [netId, count] of [...numericIds].sort(([a], [b]) => a - b)) {
    if (count > 1) diagnostics.push(engineeringDiagnostic(
      "DUPLICATE_NUMERIC_NET_ID",
      `Legacy board contains ${count} nets with numeric ID ${netId}; electrical ownership is ambiguous.`,
      { context: { netId, count }, suggestedActions: ["Repair the project net table before editing or synchronization."] },
    ));
  }
  if (!numericIds.has(0)) diagnostics.push(engineeringDiagnostic(
    "MISSING_UNCONNECTED_NET",
    "The board is missing reserved net 0.",
    { suggestedActions: ["Repair the project net table before editing or synchronization."] },
  ));

  const validIds = new Set(board.nets.map((net) => net.id));
  const checkNetRef = (netId: number, objectId: string): void => {
    if (netId === 0 || validIds.has(netId)) return;
    diagnostics.push(engineeringDiagnostic(
      "UNKNOWN_NUMERIC_NET_REFERENCE",
      `${objectId} references missing numeric net ${netId}.`,
      { objectIds: [objectId], context: { netId } },
    ));
  };
  for (const track of board.tracks) checkNetRef(track.netId, `track:${track.id}`);
  for (const via of board.vias) checkNetRef(via.netId, `via:${via.id}`);
  for (const zone of board.zones) checkNetRef(zone.netId, `zone:${zone.id}`);
  for (const footprint of board.footprints) {
    for (const [pad, netId] of Object.entries(footprint.padNets)) checkNetRef(netId, `pad:${footprint.id}:${pad}`);
  }
  for (const layer of board.stackupConfig?.copperLayers ?? []) {
    if (layer.planeNetId !== undefined) checkNetRef(layer.planeNetId, `plane:${layer.id}`);
  }
  for (const event of board.routingHistory ?? []) {
    checkNetRef(event.netId, `routing-event:${event.id}`);
  }
  for (const delta of board.netClassing?.ruleDeltas ?? []) {
    delta.changes.forEach((change, changeIndex) => {
      if (change.appliesTo.kind !== "nets") return;
      change.appliesTo.netIds.forEach((netId) => checkNetRef(netId, `rule-delta:${delta.id}:${changeIndex}`));
    });
  }

  const endpointsByNet = endpointKeysByNumericNet(board);
  for (const footprint of board.footprints) {
    if (footprint.pinPadMappings !== undefined) continue;
    const inferred: ResolvedPinPadMapping[] = Object.entries(footprint.padNets)
      .filter(([, netId]) => netId !== 0)
      .sort(([a], [b]) => compareCodePoints(a, b))
      .map(([padNumber]) => ({
        componentInstanceId: footprint.id,
        endpointKey: schematicEndpointKey(footprint.id, padNumber),
        symbolPinNumber: normalizePinIdentifier(padNumber),
        padNumbers: [padNumber],
        mappingKind: "electrical" as const,
        provenance: "legacy-inferred" as const,
      }));
    if (inferred.length > 0) footprint.pinPadMappings = inferred;
  }

  let migrated = input.identityVersion !== 1;
  for (const net of board.nets) {
    const endpoints = canonicalEndpointSet(net.endpointKeys ?? [...(endpointsByNet.get(net.id) ?? [])]);
    if (net.endpointKeys === undefined || JSON.stringify(net.endpointKeys) !== JSON.stringify(endpoints)) migrated = true;
    net.endpointKeys = endpoints;
    const desired = net.id === 0 ? "net:unconnected" : legacyStableNetId(projectId, net, endpoints);
    if (!net.stableId) {
      net.stableId = desired;
      migrated = true;
    }
  }

  const stableIds = new Map<string, PcbNet[]>();
  for (const net of board.nets) {
    if (!net.stableId) continue;
    const bucket = stableIds.get(net.stableId) ?? [];
    bucket.push(net);
    stableIds.set(net.stableId, bucket);
  }
  for (const [stableId, nets] of stableIds) {
    if (nets.length > 1) diagnostics.push(engineeringDiagnostic(
      "DUPLICATE_STABLE_NET_ID",
      `Stable net identity '${stableId}' is assigned to multiple numeric nets.`,
      { netStableIds: [stableId], context: { numericNetIds: nets.map((net) => net.id) } },
    ));
  }

  diagnostics.sort(compareDiagnostics);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { board: input, diagnostics, migrated: false };
  }
  board.identityVersion = 1;
  const planes = reconcileStackupPlaneZones(board);
  if (planes.created.length > 0 || planes.updated.length > 0 || planes.removed.length > 0) migrated = true;
  for (const unresolved of planes.unresolved) {
    diagnostics.push(engineeringDiagnostic(
      "NATIVE_PLANE_UNRESOLVED",
      `${unresolved.layer} plane intent was not materialized: ${unresolved.reason}`,
      {
        severity: "warning",
        context: unresolved,
        suggestedActions: ["Assign the plane to one proven net, then refill zones."],
      },
    ));
  }
  const fillInputRevision = zoneFillInputRevision(board);
  for (const zone of board.zones) {
    zone.source ??= "user";
    zone.priority ??= 0;
    if (zoneFillIsCurrent(board, zone)) continue;
    if (zone.fill.length > 0 || zone.dirty === false || zone.fillState?.status !== "dirty") migrated = true;
    markZoneFillDirty(zone, fillInputRevision);
  }
  diagnostics.sort(compareDiagnostics);
  return { board, diagnostics, migrated };
}

export type LockedCopper = Track | Via | Zone;
export type LockedCopperKind = "track" | "via" | "zone";

export interface LockedCopperRef {
  kind: LockedCopperKind;
  id: string;
}

export function lockedCopperObject(board: PcbBoard, ref: LockedCopperRef): LockedCopper | undefined {
  if (ref.kind === "track") return board.tracks.find((item) => item.id === ref.id);
  if (ref.kind === "via") return board.vias.find((item) => item.id === ref.id);
  return board.zones.find((item) => item.id === ref.id);
}

export function lockedCopperRefs(board: PcbBoard): LockedCopperRef[] {
  return [
    ...board.tracks.filter((item) => item.locked).map((item) => ({ kind: "track" as const, id: item.id })),
    ...board.vias.filter((item) => item.locked).map((item) => ({ kind: "via" as const, id: item.id })),
    ...board.zones.filter((item) => item.locked).map((item) => ({ kind: "zone" as const, id: item.id })),
  ].sort((a, b) => compareCodePoints(a.kind, b.kind) || compareCodePoints(a.id, b.id));
}

export function lockedMutationDiagnostics(
  board: PcbBoard,
  refs: readonly LockedCopperRef[],
  operation: string,
): EngineeringDiagnostic[] {
  return refs
    .filter((ref) => lockedCopperObject(board, ref)?.locked === true)
    .sort((a, b) => compareCodePoints(a.kind, b.kind) || compareCodePoints(a.id, b.id))
    .map((ref) => engineeringDiagnostic(
      "LOCKED_OBJECT_MUTATION_DENIED",
      `${ref.kind} ${ref.id} is locked and cannot be ${operation}.`,
      {
        objectIds: [`${ref.kind}:${ref.id}`],
        context: { operation },
        suggestedActions: [`Unlock ${ref.kind} ${ref.id} in a separate transaction, then retry.`],
      },
    ));
}

/** Exact ordinary-transaction invariant: every object locked before remains bit-identical. */
export function validateLockedCopperUnchanged(before: PcbBoard, after: PcbBoard): EngineeringDiagnostic[] {
  const diagnostics: EngineeringDiagnostic[] = [];
  for (const ref of lockedCopperRefs(before)) {
    const oldObject = lockedCopperObject(before, ref);
    const newObject = lockedCopperObject(after, ref);
    if (newObject && JSON.stringify(oldObject) === JSON.stringify(newObject)) continue;
    diagnostics.push(engineeringDiagnostic(
      "LOCKED_OBJECT_MUTATION_DENIED",
      `${ref.kind} ${ref.id} would be modified or removed by this transaction.`,
      {
        objectIds: [`${ref.kind}:${ref.id}`],
        context: { before: oldObject, after: newObject },
        suggestedActions: [`Unlock ${ref.kind} ${ref.id} explicitly before changing it.`],
      },
    ));
  }
  return diagnostics;
}
