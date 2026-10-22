/**
 * [PR-J, 2026-10-22] Runbook section J increment 1 (J.3 items 1, 3, 7; J.5; OD-255): pure builders of the canonical sheet operations
 * and the move-to-sheet PLANNER. Nothing here mutates a document or draws a random id: callers pass the ids of new sheets and ports
 * (the Sheets UI mints them at the user's action, never on the generate -> approve -> placement path), and the planner derives the ids
 * of the port anchors it adds from the port id. Every plan is verified by applying it with the executor's own operation code
 * (`applySchematicOperationsToCanonical`) and resolving the project connectivity before and after: a plan exists only when the
 * project pin-to-net partition is unchanged and the component set (stable ids, references, values, part identities) is untouched.
 * Ambiguous or non-equivalent moves are refused with named diagnostics and no operations.
 */

import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { fromCanonicalSchematic, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import type { EngineeringOperation, SchematicNetLabelSnapshot, SchematicSheetAssignment, SchematicSheetSnapshot } from "@/app/lib/engineering/types";
import { compareCodePoints } from "@/app/lib/stable-compare";
import { ROOT_SHEET_ID, netLabelNameKey, type Point, type SchematicState, type SheetPortDirection } from "@/lib/schematic-types";
import { resolveProjectConnectivity, type ConnectivityDiagnostic, type PartPinsLookup, type ProjectConnectivity, type ProjectNet } from "./project-connectivity";
import { sheetOf, sheetsOf } from "./sheets";

const PX = { schemaVersion: 1 as const, units: "px" as const };

// ── single-operation builders (ids come from the caller) ────────────────────────────────────────────────────────────────────

/** Create a child sheet at the end of the list (or at `atIndex`). The first child of a single-sheet project carries the root record. */
export function createSheetOperation(state: SchematicState, input: { operationId: string; sheet: SchematicSheetSnapshot; atIndex?: number; rootName?: string }): EngineeringOperation {
  const exists = state.sheets !== undefined;
  return {
    ...PX, operationId: input.operationId, kind: "schematic_create_sheet", sheet: structuredClone(input.sheet),
    atIndex: input.atIndex ?? (exists ? state.sheets!.sheets.length : 1),
    ...(exists ? {} : { root: { id: ROOT_SHEET_ID, name: input.rootName ?? "Overview", parentId: null } }),
  };
}

export function deleteSheetOperation(operationId: string, sheetId: string): EngineeringOperation {
  return { ...PX, operationId, kind: "schematic_delete_sheet", sheetId };
}

export function renameSheetOperation(operationId: string, sheetId: string, name: string): EngineeringOperation {
  return { ...PX, operationId, kind: "schematic_rename_sheet", sheetId, name };
}

export function reorderSheetsOperation(operationId: string, order: readonly string[]): EngineeringOperation {
  return { ...PX, operationId, kind: "schematic_reorder_sheets", order: [...order] };
}

export function addSheetPortOperation(state: SchematicState, input: { operationId: string; sheetId: string; port: { id: string; name: string; direction: SheetPortDirection }; atIndex?: number }): EngineeringOperation {
  const sheet = sheetsOf(state).find((item) => item.id === input.sheetId);
  return { ...PX, operationId: input.operationId, kind: "schematic_add_sheet_port", sheetId: input.sheetId, port: { ...input.port }, atIndex: input.atIndex ?? (sheet?.ports?.length ?? 0) };
}

export function removeSheetPortOperation(operationId: string, sheetId: string, portId: string): EngineeringOperation {
  return { ...PX, operationId, kind: "schematic_remove_sheet_port", sheetId, portId };
}

export function setLabelScopeOperation(operationId: string, labelId: string, scope: "global" | null): EngineeringOperation {
  return { ...PX, operationId, kind: "schematic_set_label_scope", labelId, scope, portId: null, childSheetId: null };
}

// ── the move-to-sheet planner ───────────────────────────────────────────────────────────────────────────────────────────────

export type MoveEntityRef = { family: SchematicSheetAssignment["family"]; id: string };

export interface MoveToSheetInput {
  /** The components, wires and labels to move; all must be on one source sheet. */
  entities: readonly MoveEntityRef[];
  /** An existing sheet that is a child or the parent of the source sheet, or a NEW child sheet of the source sheet. */
  target: { sheetId: string } | { newSheet: { id: string; name: string; block?: SchematicSheetSnapshot["block"] } };
  /** Grid-aligned translation applied to the moved entities (to keep clear of what already sits on the target sheet). */
  offset?: { dx: number; dy: number };
  /** The root sheet's name when this move creates the project's first child sheet. */
  rootName?: string;
  /** Operation-id prefix (deterministic; default "move"). */
  operationIdPrefix?: string;
}

export interface MoveCrossing {
  /** The net's name before the move (null when unnamed) and its endpoint identity. */
  netName: string | null;
  netId: string;
  port: { id: string; name: string; sheetId: string };
  /** Where the sheet pin sits on the parent sheet and where the hierarchical label(s) sit on the child sheet. */
  sheetPin: { sheetId: string; position: Point };
  hierarchicalLabels: Array<{ sheetId: string; position: Point }>;
}

export interface MoveToSheetPreview {
  sourceSheetId: string;
  targetSheetId: string;
  createdSheet: { id: string; name: string; parentId: string } | null;
  moved: { components: number; wires: number; labels: number };
  /** Every net the selection boundary cuts, and the explicit port / sheet pin that keeps it one net. */
  crossings: MoveCrossing[];
  partitionDigest: string;
}

export type MoveToSheetPlan =
  | { ok: true; operations: EngineeringOperation[]; inverseOperations: EngineeringOperation[]; preview: MoveToSheetPreview; after: SchematicState }
  | { ok: false; code: MoveRefusalCode; message: string; diagnostics: ConnectivityDiagnostic[] };

export type MoveRefusalCode =
  | "SHEET_MOVE_SELECTION_INVALID" | "SHEET_MOVE_TARGET_UNSUPPORTED" | "SHEET_MOVE_CONNECTIVITY_INVALID" | "SHEET_MOVE_AMBIGUOUS"
  | "SHEET_MOVE_NOT_EQUIVALENT" | "SHEET_MOVE_REFUSED";

const refuse = (code: MoveRefusalCode, message: string, diagnostics: ConnectivityDiagnostic[] = []): MoveToSheetPlan => ({ ok: false, code, message, diagnostics });

function entityOf(state: SchematicState, ref: MoveEntityRef): { sheetId?: string; id: string } | undefined {
  const pool: ReadonlyArray<{ id: string; sheetId?: string }> = ref.family === "theory" ? state.components : ref.family === "kicad" ? state.kicadComponents ?? [] : ref.family === "wire" ? state.wires : state.netLabels ?? [];
  return pool.find((item) => item.id === ref.id);
}

/** A deterministic, unused id derived from `base`. */
function freshId(base: string, taken: Set<string>): string {
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}:${suffix}`;
  taken.add(candidate);
  return candidate;
}

/** The anchor of one side of a cut net on `sheetId`: its first member pin there, else its first label there, else the first wire
 *  end there (document order) - every one already on the schematic grid. */
function anchorOf(state: SchematicState, conn: ProjectConnectivity, net: ProjectNet, sheetId: string): Point | null {
  const pin = net.pins.find((item) => item.sheetId === sheetId);
  if (pin) return { ...pin.point };
  const label = (state.netLabels ?? []).find((item) => sheetOf(item) === sheetId && net.labels.some((ref) => ref.id === item.id));
  if (label) return { ...label.position };
  for (const wire of state.wires) {
    if (sheetOf(wire) !== sheetId) continue;
    for (const vertex of [wire.vertices[0], wire.vertices[wire.vertices.length - 1]]) {
      if (vertex && conn.netAt(sheetId, vertex) === net) return { ...vertex };
    }
  }
  return null;
}

const componentIdentity = (state: SchematicState): string[] => [
  ...state.components.map((item) => JSON.stringify([item.id, item.type, item.value, item.refDes ?? null])),
  ...(state.kicadComponents ?? []).map((item) => JSON.stringify([item.id, item.partId, item.refDes, item.value, item.atomicPartRevisionId ?? null, item.symbolAssetVersionId ?? null, item.footprintAssetVersionId ?? null, item.mappingCertificateId ?? null, item.selectionRecordId ?? null])),
].sort(compareCodePoints);

/**
 * Plan moving a selection to another sheet as ONE canonical transaction (command schematic.move-to-sheet): the sheet assignments, a new
 * target sheet when requested, an optional offset, and - for every net the selection boundary cuts - an explicit port on the child
 * sheet, its hierarchical label(s) at the child-side cut point(s) and its sheet pin at the parent-side cut point. Same-named LOCAL
 * labels that would end up on different sheets are cut nets like any other and are carried through a port, never by name. The plan is
 * returned only when the pin-to-net partition before and after are equal and no component identity changed.
 */
export function planMoveToSheet(state: SchematicState, input: MoveToSheetInput, getPart?: PartPinsLookup): MoveToSheetPlan {
  const prefix = input.operationIdPrefix ?? "move";
  if (input.entities.length === 0) return refuse("SHEET_MOVE_SELECTION_INVALID", "Select at least one component, wire or label to move.");
  const seen = new Set<string>();
  const sources = new Set<string>();
  for (const ref of input.entities) {
    const key = `${ref.family}:${ref.id}`;
    if (seen.has(key)) return refuse("SHEET_MOVE_SELECTION_INVALID", `${key} is selected twice.`);
    seen.add(key);
    const entity = entityOf(state, ref);
    if (!entity) return refuse("SHEET_MOVE_SELECTION_INVALID", `${key} does not exist.`);
    if (ref.family === "label") {
      const scope = (state.netLabels ?? []).find((item) => item.id === ref.id)?.scope;
      if (scope === "hierarchical" || scope === "sheet-pin") return refuse("SHEET_MOVE_SELECTION_INVALID", `Label ${ref.id} is a ${scope === "sheet-pin" ? "sheet pin" : "hierarchical label"}: port anchors stay with their sheet structure and are not moved.`);
    }
    sources.add(sheetOf(entity));
  }
  if (sources.size !== 1) return refuse("SHEET_MOVE_SELECTION_INVALID", `The selection spans ${sources.size} sheets; move items from one sheet at a time.`);
  const sourceSheetId = [...sources][0]!;
  const sheets = sheetsOf(state);
  const newSheet = "newSheet" in input.target ? input.target.newSheet : null;
  const targetSheetId = newSheet ? newSheet.id : (input.target as { sheetId: string }).sheetId;
  if (targetSheetId === sourceSheetId) return refuse("SHEET_MOVE_TARGET_UNSUPPORTED", "The selection is already on that sheet.");
  const target = sheets.find((sheet) => sheet.id === targetSheetId);
  if (newSheet && target) return refuse("SHEET_MOVE_TARGET_UNSUPPORTED", `A sheet with the id ${newSheet.id} already exists.`);
  if (!newSheet && !target) return refuse("SHEET_MOVE_TARGET_UNSUPPORTED", `Sheet ${targetSheetId} does not exist.`);
  const source = sheets.find((sheet) => sheet.id === sourceSheetId);
  const pushDown = newSheet !== null || target!.parentId === sourceSheetId;
  const pullUp = !pushDown && source?.parentId === targetSheetId;
  if (!pushDown && !pullUp) return refuse("SHEET_MOVE_TARGET_UNSUPPORTED", "Move a selection to a child sheet of its sheet, to a new child sheet, or up to its parent sheet; other moves go one level at a time.");
  const childSheetId = pushDown ? targetSheetId : sourceSheetId;
  const parentSheetId = pushDown ? sourceSheetId : targetSheetId;
  const offset = input.offset ?? { dx: 0, dy: 0 };
  if (!Number.isSafeInteger(offset.dx) || !Number.isSafeInteger(offset.dy) || offset.dx % 10 !== 0 || offset.dy % 10 !== 0) return refuse("SHEET_MOVE_SELECTION_INVALID", "The offset must be whole multiples of the 10 px schematic grid.");

  const before = resolveProjectConnectivity(state, getPart);
  if (!before.ok) return refuse("SHEET_MOVE_CONNECTIVITY_INVALID", "The project's connectivity has errors; fix them before moving circuitry between sheets.", before.diagnostics.filter((item) => item.severity === "error"));
  // OD-255 item 3: a single-sheet design whose PCB joins different ground names into one GND would lose that join in a multi-sheet
  // document (which keeps every ground name separate): refuse rather than silently split its ground net.
  const legacyGround = before.mode === "single-sheet" ? before.diagnostics.find((item) => item.code === "LEGACY_GROUND_NAME_COLLAPSE") : undefined;
  if (legacyGround) return refuse("SHEET_MOVE_NOT_EQUIVALENT", `${legacyGround.message} Rename the ground labels to one name, or tie them explicitly, before organizing this design into sheets. Nothing was changed.`, [legacyGround]);

  // 1. the move itself: (new sheet) + assignments + offset
  const ops: EngineeringOperation[] = [];
  let counter = 0;
  const opId = (kind: string, id: string): string => `${prefix}:${counter++}:${kind}:${id}`;
  if (newSheet) ops.push(createSheetOperation(state, { operationId: opId("sheet", newSheet.id), sheet: { id: newSheet.id, name: newSheet.name, parentId: sourceSheetId, ...(newSheet.block ? { block: { ...newSheet.block } } : {}) }, ...(input.rootName ? { rootName: input.rootName } : {}) }));
  const moveOps: EngineeringOperation[] = [{ ...PX, operationId: opId("assign", targetSheetId), kind: "schematic_assign_sheet", entries: input.entities.map((ref) => ({ family: ref.family, id: ref.id, from: sourceSheetId, to: targetSheetId })) }];
  if (offset.dx !== 0 || offset.dy !== 0) {
    for (const ref of input.entities) {
      if (ref.family === "theory" || ref.family === "kicad") {
        const item = (ref.family === "theory" ? state.components : state.kicadComponents ?? []).find((candidate) => candidate.id === ref.id)!;
        moveOps.push({ ...PX, operationId: opId("xform", ref.id), kind: "schematic_transform_component", family: ref.family, componentId: ref.id, x: item.x + offset.dx, y: item.y + offset.dy, rotation: item.rotation });
      } else if (ref.family === "wire") {
        const wire = state.wires.find((candidate) => candidate.id === ref.id)!;
        moveOps.push({ ...PX, operationId: opId("wire", ref.id), kind: "schematic_update_wire_geometry", wireId: ref.id, vertices: wire.vertices.map((vertex) => ({ x: vertex.x + offset.dx, y: vertex.y + offset.dy })) });
      } else {
        const label = (state.netLabels ?? []).find((candidate) => candidate.id === ref.id)!;
        moveOps.push({ ...PX, operationId: opId("label", ref.id), kind: "schematic_update_net_label", labelId: ref.id, patch: { position: { x: label.position.x + offset.dx, y: label.position.y + offset.dy } } });
      }
    }
  }
  let mid: SchematicState;
  try { mid = fromCanonicalSchematic(applySchematicOperationsToCanonical(toCanonicalSchematic(state), [...ops, ...moveOps]).schematic); }
  catch (error) { return refuse("SHEET_MOVE_REFUSED", `The move cannot be applied: ${error instanceof Error ? error.message : String(error)}`); }
  const midConn = resolveProjectConnectivity(mid, getPart);
  if (!midConn.ok) return refuse("SHEET_MOVE_CONNECTIVITY_INVALID", "Moving the selection leaves the project's connectivity invalid.", midConn.diagnostics.filter((item) => item.severity === "error"));

  // 2. the moved items must not land on other connections of the target sheet (a new coincidence would join nets)
  for (const net of midConn.nets) {
    const owners = new Set(net.members.map((member) => before.netOfPin(member)?.id).filter((id): id is string => id !== undefined));
    if (owners.size > 1) return refuse("SHEET_MOVE_NOT_EQUIVALENT", `The moved items would touch other connections on the target sheet (net ${net.name ?? net.id}); move them with an offset to a clear area. Nothing was changed.`);
  }

  // 3. every net the move cut: one port per parent-side piece, hierarchical labels on the child side
  const takenIds = new Set<string>([...sheets.flatMap((sheet) => (sheet.ports ?? []).map((port) => port.id)), ...(state.netLabels ?? []).map((label) => label.id)]);
  const childPortNames = new Set((sheets.find((sheet) => sheet.id === childSheetId)?.ports ?? []).map((port) => netLabelNameKey(port.name)));
  const crossings: MoveCrossing[] = [];
  const portOps: EngineeringOperation[] = [];
  const anchorOps: EngineeringOperation[] = [];
  let labelIndex = (mid.netLabels ?? []).length;
  let unnamed = 0;
  const cutNets = before.nets.filter((net) => net.members.length > 0 && new Set(net.members.map((member) => midConn.netOfPin(member)?.id)).size > 1);
  for (const net of cutNets) {
    const pieces = [...new Map(net.members.map((member) => midConn.netOfPin(member)!).map((piece) => [piece.id, piece])).values()];
    const parentPieces = pieces.filter((piece) => piece.sheetIds.includes(parentSheetId) && !piece.sheetIds.includes(childSheetId));
    const childPieces = pieces.filter((piece) => piece.sheetIds.includes(childSheetId) && !piece.sheetIds.includes(parentSheetId));
    const spanning = pieces.filter((piece) => piece.sheetIds.includes(childSheetId) && piece.sheetIds.includes(parentSheetId));
    // A piece that already crosses between the two sheets through one of the child's ports is the hub: the other pieces join it.
    const hubPortId = spanning.length === 1 ? spanning[0]!.portIds.find((portId) => (sheets.find((item) => item.id === childSheetId)?.ports ?? []).some((port) => port.id === portId)) : undefined;
    const ambiguous = parentPieces.length + childPieces.length + spanning.length !== pieces.length || spanning.length > 1 || (spanning.length === 1 && hubPortId === undefined)
      || (spanning.length === 0 && (parentPieces.length === 0 || childPieces.length === 0));
    if (ambiguous) {
      return refuse("SHEET_MOVE_AMBIGUOUS", `Net ${net.name ?? net.id} would be split in a way ports cannot carry unambiguously (pieces on ${pieces.map((piece) => piece.sheetIds.join("+")).join(", ")}); select its connecting wires too, or move it in smaller steps. Nothing was changed.`);
    }
    const hub = spanning[0];
    const hubChildAnchor = hub ? anchorOf(mid, midConn, hub, childSheetId) : null;
    const childAnchors = childPieces.map((piece) => anchorOf(mid, midConn, piece, childSheetId));
    const parentAnchors = parentPieces.map((piece) => anchorOf(mid, midConn, piece, parentSheetId));
    if (childAnchors.some((point) => point === null) || parentAnchors.some((point) => point === null) || (hub && hubChildAnchor === null)) return refuse("SHEET_MOVE_AMBIGUOUS", `Net ${net.name ?? net.id} has no grid point to anchor its port on one side. Nothing was changed.`);
    const base = (net.name?.split("/").pop() ?? `SIG${(unnamed += 1)}`).replace(/[^A-Za-z0-9_+\-.]/g, "_") || `SIG${(unnamed += 1)}`;
    // one NEW port per parent-side piece (a port has exactly one sheet pin)
    const ports: Array<{ id: string; name: string }> = [];
    parentPieces.forEach((_, index) => {
      let ordinal = index + 1;
      let name = ordinal === 1 ? base : `${base}_${ordinal}`;
      while (childPortNames.has(netLabelNameKey(name))) { ordinal += 1; name = `${base}_${ordinal}`; }
      childPortNames.add(netLabelNameKey(name));
      const id = freshId(`port:${childSheetId}:${net.id.replace(/^pnet:/, "").slice(0, 12)}${index === 0 ? "" : `:${index + 1}`}`, takenIds);
      ports.push({ id, name });
      portOps.push({ ...PX, operationId: opId("port", id), kind: "schematic_add_sheet_port", sheetId: childSheetId, port: { id, name, direction: "passive" }, atIndex: (sheets.find((sheet) => sheet.id === childSheetId)?.ports?.length ?? 0) + portOps.length });
    });
    const hubPort = hubPortId === undefined ? undefined : (sheets.find((item) => item.id === childSheetId)?.ports ?? []).find((port) => port.id === hubPortId)!;
    const hierarchical: MoveCrossing["hierarchicalLabels"] = [];
    const addHierarchical = (point: Point, port: { id: string; name: string }): void => {
      const id = freshId(`${port.id}:label`, takenIds);
      const label: SchematicNetLabelSnapshot = { id, position: { ...point }, name: port.name, kind: "label", orientation: 0, sheetId: childSheetId, scope: "hierarchical", portId: port.id };
      anchorOps.push({ ...PX, operationId: opId("hlabel", id), kind: "schematic_add_net_label", label, atIndex: labelIndex++ });
      hierarchical.push({ sheetId: childSheetId, position: { ...point } });
    };
    if (hubPort) {
      // child-side pieces join the hub's existing port; each new port is anchored inside the child on the hub piece
      for (const point of childAnchors) addHierarchical(point!, hubPort);
      for (const port of ports) addHierarchical(hubChildAnchor!, port);
      if (ports.length === 0) crossings.push({ netName: net.name, netId: net.id, port: { id: hubPort.id, name: hubPort.name, sheetId: childSheetId }, sheetPin: { sheetId: parentSheetId, position: { ...(anchorOf(mid, midConn, hub!, parentSheetId) ?? hubChildAnchor!) } }, hierarchicalLabels: hierarchical });
    } else {
      childAnchors.forEach((point, pieceIndex) => { for (const port of pieceIndex === 0 ? ports : [ports[0]!]) addHierarchical(point!, port); });
    }
    parentAnchors.forEach((point, index) => {
      const port = ports[index]!;
      const id = freshId(`${port.id}:pin`, takenIds);
      const pin: SchematicNetLabelSnapshot = { id, position: { ...point! }, name: port.name, kind: "label", orientation: 0, scope: "sheet-pin", portId: port.id, childSheetId, ...(parentSheetId === ROOT_SHEET_ID ? {} : { sheetId: parentSheetId }) };
      anchorOps.push({ ...PX, operationId: opId("pin", id), kind: "schematic_add_sheet_pin", pin, atIndex: labelIndex++ });
      crossings.push({ netName: net.name, netId: net.id, port: { id: port.id, name: port.name, sheetId: childSheetId }, sheetPin: { sheetId: parentSheetId, position: { ...point! } }, hierarchicalLabels: hierarchical });
    });
  }

  // 4. apply the whole batch with the executor's own code and prove equivalence
  const operations = [...ops, ...portOps, ...moveOps, ...anchorOps];
  let applied: ReturnType<typeof applySchematicOperationsToCanonical>;
  try { applied = applySchematicOperationsToCanonical(toCanonicalSchematic(state), operations); }
  catch (error) { return refuse("SHEET_MOVE_REFUSED", `The move cannot be applied: ${error instanceof Error ? error.message : String(error)}`); }
  const after = fromCanonicalSchematic(applied.schematic);
  const afterConn = resolveProjectConnectivity(after, getPart);
  if (!afterConn.ok) return refuse("SHEET_MOVE_CONNECTIVITY_INVALID", "The moved design would have connectivity errors; nothing was changed.", afterConn.diagnostics.filter((item) => item.severity === "error"));
  if (afterConn.partitionDigest !== before.partitionDigest) {
    const legacy = before.diagnostics.find((item) => item.code === "LEGACY_GROUND_NAME_COLLAPSE");
    const changed = before.pins.filter((pin) => {
      const was = before.netOfPin(pin.key);
      const now = afterConn.netOfPin(pin.key);
      return was && now && (was.members.join("\u0000") !== now.members.join("\u0000"));
    }).map((pin) => pin.key);
    return refuse("SHEET_MOVE_NOT_EQUIVALENT", `The move would change which pins are connected (${changed.slice(0, 6).join(", ")}${changed.length > 6 ? ", ..." : ""}).${legacy ? ` ${legacy.message}` : ""} Nothing was changed.`, legacy ? [legacy] : []);
  }
  if (JSON.stringify(componentIdentity(after)) !== JSON.stringify(componentIdentity(state))) return refuse("SHEET_MOVE_NOT_EQUIVALENT", "The move would change a component's identity; nothing was changed.");
  return {
    ok: true,
    operations,
    inverseOperations: applied.inverseOperations,
    after,
    preview: {
      sourceSheetId, targetSheetId,
      createdSheet: newSheet ? { id: newSheet.id, name: newSheet.name, parentId: sourceSheetId } : null,
      moved: { components: input.entities.filter((ref) => ref.family === "theory" || ref.family === "kicad").length, wires: input.entities.filter((ref) => ref.family === "wire").length, labels: input.entities.filter((ref) => ref.family === "label").length },
      crossings,
      partitionDigest: afterConn.partitionDigest,
    },
  };
}
