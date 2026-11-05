/**
 * [PR-J3, 2026-10-22] Runbook section J increment 3 (J.3 items 1-3, 5-8; OD-257): the PURE half of the Sheets navigator.
 *
 *  - `projectSheet`: one sheet's entities as PLAIN filtered arrays for React props (never sheets.ts's branded, frozen `sheetLens`,
 *    which is not assignable to the editor's mutable `SchComponent[]` props and is refused by every whole-project consumer). A
 *    single-sheet document (no `sheets`) projects to the SAME array references (`legacyIdentity`), so the editor's single-sheet
 *    behaviour is byte-identical to what it was before section J.
 *  - `mergeSheetAfter`: the inverse. The editor computes an "after" graph over the active sheet's view; the merge puts it back into the
 *    whole project BY ID: an entity of another sheet is never touched, an entity of the active sheet is replaced in place, an entity
 *    absent from the result and on the active sheet is dropped, a NEW id is appended stamped with the active sheet (no stamp on the
 *    root). The result is deterministic in the base's order plus the new ids in the result's order, so `diffSchematicGraphOps`
 *    reproduces it exactly (no GRAPH_DIFF_ORDER) and never sees a sheet change on an existing entity (no GRAPH_DIFF_IMMUTABLE).
 *  - `scopedGraph`: the editor's graph authority wrapped for the active sheet (the sheet id is captured at invocation, so a command
 *    queued on sheet A lands on A after a switch to B).
 *  - The navigator's planning helpers: the selection as the move planner wants it (OD-257 item 1: the selected part with its attached
 *    wires and local labels, or the connected group restricted to the active sheet), the delete impact and the structural cleanup of
 *    an emptied sheet (OD-257 item 2), port placement (a hierarchical label on the child, one sheet pin on the parent), a free block
 *    slot for a new sheet, the sheet-pin snap to its block edge, and the destinations of a cross-sheet signal (J.3 item 6).
 *
 * Pure: no I/O, no randomness, no React. Ids come from the caller (the hook mints them from `randomGenerationUuid`, never
 * `crypto.randomUUID`, on an explicit user action only).
 */

import type { SchematicGraphAfter } from "@/app/lib/engineering/schematic-graph";
import type { EngineeringOperation, SchematicNetLabelSnapshot } from "@/app/lib/engineering/types";
import { findConnectedGroup, type KicadPinSite } from "@/app/lib/connectivity";
import { kicadPinWorldPos, pinWorldPos, pointKey } from "@/app/lib/geometry";
import type { KicadPin } from "@/app/lib/kicad/types";
import { PIN_NAMES, ROOT_SHEET_ID, netLabelNameKey, type KicadComponentInstance, type NetLabel, type Point, type SchComponent, type SchematicSheet, type SchematicState, type SheetPortDirection, type Wire } from "@/lib/schematic-types";
import { addSheetPortOperation, deleteSheetOperation, type MoveEntityRef } from "./sheet-operations";
import type { ProjectConnectivity, ProjectNet } from "./project-connectivity";
import { sheetOf, sheetPathName, sheetsOf } from "./sheets";

const PX = { schemaVersion: 1 as const, units: "px" as const };
const GRID = 10;

// ── the projection and its inverse ──────────────────────────────────────────────────────────────────────────────────────────

export interface SheetProjectionSource {
  components: SchComponent[];
  wires: Wire[];
  kicadComponents?: KicadComponentInstance[];
  netLabels?: NetLabel[];
  sheets?: SchematicState["sheets"];
}

export interface SheetProjection {
  sheetId: string;
  components: SchComponent[];
  wires: Wire[];
  kicadComponents: KicadComponentInstance[];
  netLabels: NetLabel[];
}

/** True when the document has no sheet tree: the editor keeps its exact single-sheet behaviour (same arrays, same graph object). */
export function legacyIdentity(state: Pick<SchematicState, "sheets">): boolean {
  return state.sheets === undefined;
}

/** The entities drawn on `sheetId` as plain arrays. A single-sheet document (and the root) returns the source's own array references. */
export function projectSheet(source: SheetProjectionSource, sheetId: string): SheetProjection {
  const kicadComponents = source.kicadComponents ?? [];
  const netLabels = source.netLabels ?? [];
  if (legacyIdentity(source) && sheetId === ROOT_SHEET_ID) {
    return { sheetId, components: source.components, wires: source.wires, kicadComponents, netLabels };
  }
  const on = <T extends { sheetId?: string }>(items: readonly T[]): T[] => items.filter((item) => sheetOf(item) === sheetId);
  return { sheetId, components: on(source.components), wires: on(source.wires), kicadComponents: on(kicadComponents), netLabels: on(netLabels) };
}

/** `item` as it must be stored on `sheetId`: no `sheetId` key on the root, the exact id elsewhere. The object is reused when already right. */
function stampedOn<T extends { sheetId?: string }>(item: T, sheetId: string): T {
  if (sheetId === ROOT_SHEET_ID) {
    if (item.sheetId === undefined) return item;
    const copy = { ...item };
    delete copy.sheetId;
    return copy;
  }
  return item.sheetId === sheetId ? item : { ...item, sheetId };
}

function mergeFamily<T extends { id: string; sheetId?: string }>(base: readonly T[], after: readonly T[], sheetId: string): T[] {
  const byId = new Map(after.map((item) => [item.id, item] as const));
  const merged: T[] = [];
  for (const item of base) {
    if (sheetOf(item) !== sheetId) { merged.push(item); continue; } // another sheet's entity: never touched
    const next = byId.get(item.id);
    if (next === undefined) continue; // dropped: absent from the result AND on the active sheet
    merged.push(stampedOn(next, sheetId)); // replaced in place
  }
  const baseIds = new Set(base.map((item) => item.id));
  for (const item of after) if (!baseIds.has(item.id)) merged.push(stampedOn(item, sheetId)); // new ids: appended, stamped
  return merged;
}

/**
 * Merge the editor's "after" graph for `activeSheetId` back into the whole project (see the module header). Omitted arrays stay
 * omitted (unchanged for the graph diff). A single-sheet document on the root returns `scopedAfter` itself (legacy identity).
 */
export function mergeSheetAfter(base: SchematicState, activeSheetId: string, scopedAfter: SchematicGraphAfter): SchematicGraphAfter {
  if (legacyIdentity(base) && activeSheetId === ROOT_SHEET_ID) return scopedAfter;
  const merged: SchematicGraphAfter = {};
  if (scopedAfter.components) merged.components = mergeFamily(base.components, scopedAfter.components, activeSheetId);
  if (scopedAfter.kicadComponents) merged.kicadComponents = mergeFamily(base.kicadComponents ?? [], scopedAfter.kicadComponents, activeSheetId);
  if (scopedAfter.wires) merged.wires = mergeFamily(base.wires, scopedAfter.wires, activeSheetId);
  if (scopedAfter.netLabels) merged.netLabels = mergeFamily(base.netLabels ?? [], scopedAfter.netLabels, activeSheetId);
  return merged;
}

/** The state the editor's `buildAfter` callbacks read: the FULL component lists (reference designators are a project-wide namespace;
 *  placement mints the next free one over every sheet) and the active sheet's wires and labels. */
export function scopedCommandState(state: SchematicState, sheetId: string): SchematicState {
  if (legacyIdentity(state) && sheetId === ROOT_SHEET_ID) return state;
  const on = <T extends { sheetId?: string }>(items: readonly T[]): T[] => items.filter((item) => sheetOf(item) === sheetId);
  return { ...state, wires: on(state.wires), netLabels: on(state.netLabels ?? []) };
}

/** The editor's graph authority (app/page.tsx `graph` prop): the gesture lifecycle plus one canonical command runner. */
export interface SchematicGraphApi {
  run(label: string, commandId: string, buildAfter: (state: SchematicState) => SchematicGraphAfter | null): void;
  begin(): boolean;
  preview(frame: SchematicGraphAfter): void;
  cancel(): void;
  commit(label: string, finalGraph: SchematicGraphAfter): void;
}

/**
 * The graph authority wrapped for the active sheet. `run` captures the sheet at INVOCATION: the callback the queue runs later sees the
 * scoped state of that sheet and its result is merged onto that sheet, whatever sheet is active by then. `preview` and `commit` merge
 * the editor's scoped frames onto the whole project (`base()` is the authoritative state) so the page's arrays never shrink to one
 * sheet; sheet pins that moved are snapped back to their block edge before a commit. `begin` and `cancel` pass through.
 */
export function scopedGraph(raw: SchematicGraphApi, base: () => SchematicState, activeSheetId: () => string): SchematicGraphApi {
  return {
    run: (label, commandId, buildAfter) => {
      const sheetId = activeSheetId();
      raw.run(label, commandId, (state) => {
        const after = buildAfter(scopedCommandState(state, sheetId));
        return after === null ? null : mergeSheetAfter(state, sheetId, after);
      });
    },
    begin: () => raw.begin(),
    preview: (frame) => raw.preview(mergeSheetAfter(base(), activeSheetId(), frame)),
    cancel: () => raw.cancel(),
    commit: (label, finalGraph) => {
      const whole = base();
      const merged = mergeSheetAfter(whole, activeSheetId(), finalGraph);
      raw.commit(label, merged.netLabels ? { ...merged, netLabels: merged.netLabels.map((label) => snapSheetPinToBlock(whole, label)) } : merged);
    },
  };
}

// ── sheet geometry helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

const snapGrid = (value: number): number => Math.round(value / GRID) * GRID;

export const DEFAULT_BLOCK_SIZE = Object.freeze({ width: 300, height: 200 });

type Block = NonNullable<SchematicSheet["block"]>;

function entityBounds(state: SchematicState, sheetId: string): Array<{ x: number; y: number; width: number; height: number }> {
  const pad = 40;
  const boxes: Block[] = [];
  for (const item of state.components) if (sheetOf(item) === sheetId) boxes.push({ x: item.x - pad, y: item.y - pad, width: pad * 2, height: pad * 2 });
  for (const item of state.kicadComponents ?? []) if (sheetOf(item) === sheetId) boxes.push({ x: item.x - 120, y: item.y - 120, width: 240, height: 240 });
  for (const wire of state.wires) {
    if (sheetOf(wire) !== sheetId) continue;
    const xs = wire.vertices.map((vertex) => vertex.x), ys = wire.vertices.map((vertex) => vertex.y);
    boxes.push({ x: Math.min(...xs) - GRID, y: Math.min(...ys) - GRID, width: Math.max(...xs) - Math.min(...xs) + GRID * 2, height: Math.max(...ys) - Math.min(...ys) + GRID * 2 });
  }
  for (const label of state.netLabels ?? []) if (sheetOf(label) === sheetId) boxes.push({ x: label.position.x - 60, y: label.position.y - 30, width: 160, height: 60 });
  return boxes;
}

const overlaps = (a: Block, b: Block): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The block of a child sheet on its parent: the stored one, else a deterministic default slot (so every child is drawn). */
export function sheetBlockOf(state: SchematicState, sheet: SchematicSheet): Block {
  if (sheet.block) return sheet.block;
  // The default cells: the stored blocks and the parent's drawn entities are taken; the blockless siblings listed BEFORE this one
  // take the earlier free cells, so every blockless child gets its own deterministic cell.
  const sheets = sheetsOf(state);
  const siblings = sheets.filter((item) => item.parentId === sheet.parentId);
  const occupied: Block[] = [...siblings.flatMap((item) => (item.block ? [item.block] : [])), ...(sheet.parentId === null ? [] : entityBounds(state, sheet.parentId))];
  let slot = freeBlockSlotAmong(occupied, DEFAULT_BLOCK_SIZE);
  for (const sibling of siblings) {
    if (sibling.id === sheet.id) break;
    if (sibling.block) continue;
    occupied.push(slot);
    slot = freeBlockSlotAmong(occupied, DEFAULT_BLOCK_SIZE);
  }
  return slot;
}

function freeBlockSlotAmong(occupied: readonly Block[], size: { width: number; height: number }): Block {
  const stepX = size.width + 60, stepY = size.height + 60;
  for (let row = 0; row < 64; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const candidate: Block = { x: 100 + column * stepX, y: 100 + row * stepY, width: size.width, height: size.height };
      if (!occupied.some((box) => overlaps(box, candidate))) return candidate;
    }
  }
  return { x: 100, y: 100 + 64 * stepY, width: size.width, height: size.height };
}

/** A grid-aligned block slot on `parentSheetId` that overlaps neither an existing block nor the parent's drawn entities. */
export function freeBlockSlot(state: SchematicState, parentSheetId: string, size: { width: number; height: number } = DEFAULT_BLOCK_SIZE): Block {
  const blocks = sheetsOf(state).filter((sheet) => sheet.parentId === parentSheetId).map((sheet) => sheetBlockOf(state, sheet));
  return freeBlockSlotAmong([...blocks, ...entityBounds(state, parentSheetId)], size);
}

/** The nearest grid point on the perimeter of `block` to `point`. */
export function nearestBlockEdgePoint(block: Block, point: Point): Point {
  const left = block.x, right = block.x + block.width, top = block.y, bottom = block.y + block.height;
  const clampY = Math.min(bottom, Math.max(top, point.y)), clampX = Math.min(right, Math.max(left, point.x));
  const candidates: Point[] = [{ x: left, y: clampY }, { x: right, y: clampY }, { x: clampX, y: top }, { x: clampX, y: bottom }];
  let best = candidates[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return { x: snapGrid(best.x), y: snapGrid(best.y) };
}

/** A sheet pin dragged off its child's block edge is put back on the edge (presentation: a pin belongs to the block it binds). Any
 *  other label, or a pin whose child has no stored block, is returned as is. */
export function snapSheetPinToBlock(state: SchematicState, label: NetLabel): NetLabel {
  if (label.scope !== "sheet-pin" || label.childSheetId === undefined) return label;
  const child = sheetsOf(state).find((sheet) => sheet.id === label.childSheetId);
  if (!child?.block) return label;
  const snapped = nearestBlockEdgePoint(child.block, label.position);
  return snapped.x === label.position.x && snapped.y === label.position.y ? label : { ...label, position: snapped };
}

/** Where a new port's anchors go: the hierarchical label at a free grid point on the child (inputs and power_in on the left column,
 *  the rest on the right), the sheet pin at a free grid point on the child's block edge on the parent (left edge for inputs). */
export function portAnchorSlots(state: SchematicState, child: SchematicSheet, direction: SheetPortDirection): { label: Point; pin: Point } {
  const inbound = direction === "input" || direction === "power_in";
  const labels = state.netLabels ?? [];
  const occupied = (sheetId: string): Set<string> => new Set(labels.filter((label) => sheetOf(label) === sheetId).map((label) => pointKey(label.position)));
  const onChild = occupied(child.id);
  const bounds = entityBounds(state, child.id);
  const minX = Math.min(100, ...bounds.map((box) => box.x)) - 40;
  const maxX = Math.max(700, ...bounds.map((box) => box.x + box.width)) + 40;
  const columnX = snapGrid(inbound ? Math.max(20, minX) : maxX);
  let label: Point = { x: columnX, y: 100 };
  for (let row = 0; row < 512; row += 1) {
    const candidate = { x: columnX, y: 100 + row * 40 };
    if (!onChild.has(pointKey(candidate))) { label = candidate; break; }
  }
  const block = sheetBlockOf(state, child);
  const onParent = occupied(child.parentId ?? ROOT_SHEET_ID);
  const edgeX = inbound ? block.x : block.x + block.width;
  let pin: Point = { x: snapGrid(edgeX), y: snapGrid(block.y + 20) };
  for (let step = 0; step < 64; step += 1) {
    const candidate = { x: snapGrid(edgeX), y: snapGrid(block.y + 20 + step * 20) };
    if (candidate.y > block.y + block.height) break;
    if (!onParent.has(pointKey(candidate))) { pin = candidate; break; }
  }
  return { label, pin };
}

// ── structural operations the navigator builds ──────────────────────────────────────────────────────────────────────────────

export interface AddPortInput {
  sheetId: string;
  port: { id: string; name: string; direction: SheetPortDirection };
  labelId: string;
  pinId: string;
  operationIdPrefix: string;
}

/** "Add port" as ONE schematic.sheet-structure transaction: the port, its hierarchical label on the child, its sheet pin on the parent
 *  (exactly what planMoveToSheet emits for a cut net). Refuses a port on the root or a duplicate name with a message. */
export function addPortOperations(state: SchematicState, input: AddPortInput): { ok: true; operations: EngineeringOperation[] } | { ok: false; message: string } {
  const child = sheetsOf(state).find((sheet) => sheet.id === input.sheetId);
  if (!child) return { ok: false, message: `Sheet ${input.sheetId} does not exist.` };
  if (child.parentId === null) return { ok: false, message: "Ports belong to subsystem sheets; the overview has none. Open a subsystem sheet to add a port." };
  const name = input.port.name.trim();
  if (name.length === 0) return { ok: false, message: "A port needs a name." };
  if ((child.ports ?? []).some((port) => netLabelNameKey(port.name) === netLabelNameKey(name))) return { ok: false, message: `Sheet "${child.name}" already has a port named ${name}.` };
  const slots = portAnchorSlots(state, child, input.port.direction);
  const labelIndex = (state.netLabels ?? []).length;
  const label: SchematicNetLabelSnapshot = { id: input.labelId, position: slots.label, name, kind: "label", orientation: 0, sheetId: child.id, scope: "hierarchical", portId: input.port.id };
  const pin: SchematicNetLabelSnapshot = { id: input.pinId, position: slots.pin, name, kind: "label", orientation: 0, scope: "sheet-pin", portId: input.port.id, childSheetId: child.id, ...(child.parentId === ROOT_SHEET_ID ? {} : { sheetId: child.parentId }) };
  return {
    ok: true,
    operations: [
      addSheetPortOperation(state, { operationId: `${input.operationIdPrefix}:port:${input.port.id}`, sheetId: child.id, port: { ...input.port, name } }),
      { ...PX, operationId: `${input.operationIdPrefix}:label:${input.labelId}`, kind: "schematic_add_net_label", label, atIndex: labelIndex },
      { ...PX, operationId: `${input.operationIdPrefix}:pin:${input.pinId}`, kind: "schematic_add_sheet_pin", pin, atIndex: labelIndex + 1 },
    ],
  };
}

export interface DeleteSheetImpact {
  sheetId: string;
  name: string;
  components: number;
  wires: number;
  /** Local, global, power and ground labels drawn on the sheet (the circuitry a move carries). */
  labels: number;
  /** The sheet's own ports, their hierarchical labels on the sheet and their sheet pins on the parent (structure the delete removes). */
  ports: number;
  anchors: number;
  childSheets: number;
  /** Circuitry to move before the sheet can go (OD-257 item 2: the first of two transactions). */
  populated: boolean;
  /** Can be deleted now (only its structure remains, and no child sheet). */
  deletable: boolean;
  message: string;
}

const isAnchor = (label: NetLabel): boolean => label.scope === "hierarchical" || label.scope === "sheet-pin";

/** The impact preview of deleting `sheetId` (J.3 item 7): what it still holds and which path is open. */
export function deleteSheetImpact(state: SchematicState, sheetId: string): DeleteSheetImpact {
  const sheets = sheetsOf(state);
  const sheet = sheets.find((item) => item.id === sheetId);
  const name = sheet?.name ?? sheetId;
  const components = state.components.filter((item) => sheetOf(item) === sheetId).length + (state.kicadComponents ?? []).filter((item) => sheetOf(item) === sheetId).length;
  const wires = state.wires.filter((item) => sheetOf(item) === sheetId).length;
  const labels = (state.netLabels ?? []).filter((item) => sheetOf(item) === sheetId && !isAnchor(item)).length;
  const anchors = (state.netLabels ?? []).filter((item) => (sheetOf(item) === sheetId && item.scope === "hierarchical") || (item.scope === "sheet-pin" && item.childSheetId === sheetId)).length;
  const ports = sheet?.ports?.length ?? 0;
  const childSheets = sheets.filter((item) => item.parentId === sheetId).length;
  const populated = components + wires + labels > 0;
  const root = sheet?.parentId === null;
  const deletable = !root && !populated && childSheets === 0 && sheet !== undefined;
  const held = [[components, "component"], [wires, "wire"], [labels, "label"]] as const;
  const message = root
    ? "The overview (root) sheet cannot be deleted."
    : childSheets > 0
      ? `Sheet "${name}" has ${childSheets} child sheet(s); delete or move them first. Nothing was deleted.`
      : populated
        ? `Sheet "${name}" still holds ${held.filter(([count]) => count > 0).map(([count, noun]) => `${count} ${noun}(s)`).join(", ")}; move its contents to the parent sheet first (one transaction), then delete the empty sheet (a second). Nothing was deleted.`
        : ports > 0 || anchors > 0
          ? `Deleting "${name}" removes its ${ports} port(s) with ${anchors} sheet pin(s) and hierarchical label(s), then the sheet - one transaction, one undo step.`
          : `Deleting the empty sheet "${name}" - one transaction, one undo step.`;
  return { sheetId, name, components, wires, labels, ports, anchors, childSheets, populated, deletable, message };
}

/** The ONE schematic.sheet-structure transaction that deletes a sheet holding only its structure: its sheet pins, its hierarchical
 *  labels, its ports, then the sheet. Refuses (with the impact message) while circuitry or a child sheet remains. */
export function deleteSheetOperations(state: SchematicState, sheetId: string, operationIdPrefix: string): { ok: true; operations: EngineeringOperation[] } | { ok: false; message: string } {
  const impact = deleteSheetImpact(state, sheetId);
  if (!impact.deletable) return { ok: false, message: impact.message };
  const labels = state.netLabels ?? [];
  const sheet = sheetsOf(state).find((item) => item.id === sheetId)!;
  const operations: EngineeringOperation[] = [];
  for (const pin of labels.filter((item) => item.scope === "sheet-pin" && item.childSheetId === sheetId)) operations.push({ ...PX, operationId: `${operationIdPrefix}:unpin:${pin.id}`, kind: "schematic_remove_sheet_pin", labelId: pin.id });
  for (const label of labels.filter((item) => item.scope === "hierarchical" && sheetOf(item) === sheetId)) operations.push({ ...PX, operationId: `${operationIdPrefix}:unlabel:${label.id}`, kind: "schematic_delete_net_label", labelId: label.id });
  for (const port of sheet.ports ?? []) operations.push({ ...PX, operationId: `${operationIdPrefix}:unport:${port.id}`, kind: "schematic_remove_sheet_port", sheetId, portId: port.id });
  operations.push(deleteSheetOperation(`${operationIdPrefix}:delete:${sheetId}`, sheetId));
  return { ok: true, operations };
}

/** The full sheet order after moving `sheetId` one place among its siblings (`delta` -1 up, +1 down); null when it cannot move. */
export function reorderedSheets(state: SchematicState, sheetId: string, delta: -1 | 1): string[] | null {
  const sheets = sheetsOf(state);
  const sheet = sheets.find((item) => item.id === sheetId);
  if (!sheet || sheet.parentId === null) return null;
  const siblings = sheets.filter((item) => item.parentId === sheet.parentId).map((item) => item.id);
  const index = siblings.indexOf(sheetId);
  const target = index + delta;
  if (target < 0 || target >= siblings.length) return null;
  const other = siblings[target]!;
  const order = sheets.map((item) => item.id);
  const a = order.indexOf(sheetId), b = order.indexOf(other);
  order[a] = other; order[b] = sheetId;
  return order;
}

/** A sibling-unique name: `base`, else `base 2`, `base 3`, ... */
export function nextSheetName(state: SchematicState, parentId: string, base: string): string {
  const taken = new Set(sheetsOf(state).filter((sheet) => sheet.parentId === parentId).map((sheet) => sheet.name.trim().toLowerCase()));
  if (!taken.has(base.trim().toLowerCase())) return base.trim();
  for (let n = 2; ; n += 1) { const candidate = `${base.trim()} ${n}`; if (!taken.has(candidate.toLowerCase())) return candidate; }
}

/** Why a sheet name is refused, or null. */
export function sheetNameProblem(state: SchematicState, parentId: string | null, name: string, exceptSheetId?: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "A sheet needs a name.";
  if (trimmed.length > 80) return "A sheet name has at most 80 characters.";
  if (trimmed.includes("/")) return "A sheet name cannot contain \"/\" (it separates the sheet path).";
  const clash = sheetsOf(state).some((sheet) => sheet.id !== exceptSheetId && sheet.parentId === parentId && sheet.name.trim().toLowerCase() === trimmed.toLowerCase());
  return clash ? `A sheet named "${trimmed}" already exists here.` : null;
}

// ── the selection as the move planner wants it (OD-257 item 1) ──────────────────────────────────────────────────────────────

export type PartPinsSource = (partId: string) => { pins: readonly KicadPin[] } | null | undefined;

export interface SheetSelection {
  family: "theory" | "kicad";
  id: string;
}

function partPinPoints(state: SchematicState, selection: SheetSelection, getPart: PartPinsSource): Point[] | null {
  if (selection.family === "theory") {
    const component = state.components.find((item) => item.id === selection.id);
    return component ? (PIN_NAMES[component.type] ?? []).map((pin) => pinWorldPos(component, pin)) : null;
  }
  const instance = (state.kicadComponents ?? []).find((item) => item.id === selection.id);
  if (!instance) return null;
  return (getPart(instance.partId)?.pins ?? []).map((pin) => kicadPinWorldPos(instance, pin));
}

function entitySheet(state: SchematicState, selection: SheetSelection): string | null {
  const pool: ReadonlyArray<{ id: string; sheetId?: string }> = selection.family === "theory" ? state.components : state.kicadComponents ?? [];
  const entity = pool.find((item) => item.id === selection.id);
  return entity ? sheetOf(entity) : null;
}

/** The selected part, the wires of its sheet touching its pins, and the local labels at those pins or wire ends (hierarchical labels
 *  and sheet pins are never moved: they belong to the sheet structure). Null when the part does not exist. */
export function attachedSelection(state: SchematicState, selection: SheetSelection, getPart: PartPinsSource): MoveEntityRef[] | null {
  const sheetId = entitySheet(state, selection);
  const pins = partPinPoints(state, selection, getPart);
  if (sheetId === null || pins === null) return null;
  const pinKeys = new Set(pins.map(pointKey));
  const wires = state.wires.filter((wire) => sheetOf(wire) === sheetId && (pinKeys.has(pointKey(wire.vertices[0]!)) || pinKeys.has(pointKey(wire.vertices[wire.vertices.length - 1]!))));
  const ends = new Set([...pinKeys, ...wires.flatMap((wire) => [pointKey(wire.vertices[0]!), pointKey(wire.vertices[wire.vertices.length - 1]!)])]);
  const labels = (state.netLabels ?? []).filter((label) => sheetOf(label) === sheetId && !isAnchor(label) && ends.has(pointKey(label.position)));
  return [{ family: selection.family, id: selection.id }, ...wires.map((wire) => ({ family: "wire" as const, id: wire.id })), ...labels.map((label) => ({ family: "label" as const, id: label.id }))];
}

/** The connected group of the selected part restricted to its sheet (app/lib/connectivity.ts findConnectedGroup over the sheet's own
 *  projection; label names are not followed), without the sheet's port anchors. Null when the part does not exist. */
export function connectedSelection(state: SchematicState, selection: SheetSelection, getPart: PartPinsSource): MoveEntityRef[] | null {
  const sheetId = entitySheet(state, selection);
  if (sheetId === null) return null;
  const view = projectSheet(state, sheetId);
  const sites: KicadPinSite[] = view.kicadComponents.map((instance) => ({ id: instance.id, pins: (getPart(instance.partId)?.pins ?? []).map((pin) => kicadPinWorldPos(instance, pin)) }));
  const group = findConnectedGroup({ kind: selection.family === "theory" ? "component" : "kicad", id: selection.id }, view.components, view.wires, sites, view.netLabels);
  const anchors = new Set(view.netLabels.filter(isAnchor).map((label) => label.id));
  return [
    ...view.components.filter((item) => group.componentIds.has(item.id)).map((item) => ({ family: "theory" as const, id: item.id })),
    ...view.kicadComponents.filter((item) => group.kicadInstanceIds.has(item.id)).map((item) => ({ family: "kicad" as const, id: item.id })),
    ...view.wires.filter((item) => group.wireIds.has(item.id)).map((item) => ({ family: "wire" as const, id: item.id })),
    ...view.netLabels.filter((item) => group.netLabelIds.has(item.id) && !anchors.has(item.id)).map((item) => ({ family: "label" as const, id: item.id })),
  ];
}

/** Everything movable on `sheetId` (its circuitry; not its port anchors): the first step of deleting a populated sheet. */
export function movableContents(state: SchematicState, sheetId: string): MoveEntityRef[] {
  const view = projectSheet(state, sheetId);
  return [
    ...view.components.map((item) => ({ family: "theory" as const, id: item.id })),
    ...view.kicadComponents.map((item) => ({ family: "kicad" as const, id: item.id })),
    ...view.wires.map((item) => ({ family: "wire" as const, id: item.id })),
    ...view.netLabels.filter((item) => !isAnchor(item)).map((item) => ({ family: "label" as const, id: item.id })),
  ];
}

/** The offsets a move tries, in order, when the moved items would land on other connections of an existing target sheet. */
export const MOVE_OFFSET_CANDIDATES: readonly { dx: number; dy: number }[] = Object.freeze([
  { dx: 0, dy: 0 }, { dx: 0, dy: 200 }, { dx: 0, dy: 400 }, { dx: 0, dy: 600 }, { dx: 0, dy: 800 }, { dx: 400, dy: 0 }, { dx: 400, dy: 400 }, { dx: 800, dy: 0 }, { dx: 800, dy: 400 }, { dx: 0, dy: 1200 },
]);

// ── cross-sheet signals (J.3 item 6) ─────────────────────────────────────────────────────────────────────────────────────────

export interface SignalDestination {
  sheetId: string;
  /** "" for the overview. */
  sheetPath: string;
  sheetName: string;
  labelId: string;
  labelName: string;
  position: Point;
  scope: "hierarchical" | "sheet-pin" | "global" | "local";
}

export interface InterfaceSignal {
  labelId: string;
  name: string;
  scope: "hierarchical" | "sheet-pin" | "global";
  position: Point;
  /** The project net's board name, when named. */
  netName: string | null;
  destinations: SignalDestination[];
}

const DESTINATION_SCOPE_ORDER: Readonly<Record<SignalDestination["scope"], number>> = Object.freeze({ hierarchical: 0, "sheet-pin": 1, global: 2, local: 3 });

/** The interface anchors drawn on `sheetId` (sheet pins, hierarchical labels, global labels) and, for each, where its net reaches on
 *  the other sheets: "<sheet path> > <label>", port anchors first. Needs a resolved connectivity (`resolveProjectConnectivity`). */
export function interfaceSignals(state: SchematicState, conn: ProjectConnectivity, sheetId: string): InterfaceSignal[] {
  const sheets = sheetsOf(state);
  const nameOf = (id: string): string => sheets.find((sheet) => sheet.id === id)?.name ?? id;
  const labels = state.netLabels ?? [];
  const anchors = labels.filter((label) => sheetOf(label) === sheetId && (label.scope === "hierarchical" || label.scope === "sheet-pin" || label.scope === "global"));
  return anchors.map((anchor) => {
    const net: ProjectNet | null = conn.ok ? conn.netAt(sheetId, anchor.position) : null;
    const destinations: SignalDestination[] = net === null ? [] : net.labels
      .filter((ref) => ref.id !== anchor.id && ref.sheetId !== sheetId)
      .map((ref) => {
        const label = labels.find((item) => item.id === ref.id);
        return label ? { sheetId: ref.sheetId, sheetPath: sheetPathName(state, ref.sheetId), sheetName: nameOf(ref.sheetId), labelId: ref.id, labelName: label.name, position: { ...label.position }, scope: label.scope ?? "local" } : null;
      })
      .filter((item): item is SignalDestination => item !== null)
      // the port's own anchors first (the other end of the interface), then the sheet's other labels on the net; sheet path, then id
      .sort((a, b) => DESTINATION_SCOPE_ORDER[a.scope] - DESTINATION_SCOPE_ORDER[b.scope] || (a.sheetPath < b.sheetPath ? -1 : a.sheetPath > b.sheetPath ? 1 : 0) || (a.labelId < b.labelId ? -1 : a.labelId > b.labelId ? 1 : 0));
    return { labelId: anchor.id, name: anchor.name, scope: anchor.scope as InterfaceSignal["scope"], position: { ...anchor.position }, netName: net?.name ?? null, destinations };
  });
}

/** The sheet a component (by reference designator or stable id) is drawn on, or null when it is not in the project. */
export function sheetOfComponentRef(state: SchematicState, ref: string): string | null {
  const key = ref.trim().toUpperCase();
  for (const component of state.components) if (component.id === ref || (component.refDes ?? component.id).trim().toUpperCase() === key) return sheetOf(component);
  for (const instance of state.kicadComponents ?? []) if (instance.id === ref || instance.refDes.trim().toUpperCase() === key) return sheetOf(instance);
  return null;
}

/** The parent of `sheetId`, the root for an unknown sheet. */
export function parentSheetOf(state: Pick<SchematicState, "sheets">, sheetId: string): string {
  return sheetsOf(state).find((sheet) => sheet.id === sheetId)?.parentId ?? ROOT_SHEET_ID;
}
