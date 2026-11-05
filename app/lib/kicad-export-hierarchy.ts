/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (J.8 item 5; OD-258 item 2): the NATIVE hierarchical KiCad export of a project
 * organised into sheets - a root `.kicad_sch` holding one `(sheet ...)` symbol per child sheet (Sheetname / Sheetfile properties, one
 * `(pin "NAME" <shape>)` per bound port) and one child `.kicad_sch` file per sheet, written in the pinned schematic format
 * (`KICAD_VERSION` 20250610, KiCad 10; https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/). The connection policy of the
 * project connectivity authority (app/lib/schematic/project-connectivity.ts; J.4) is written out with KiCad's own scope vocabulary:
 *
 *  - a label without scope (kind "label") -> `(label ...)`: local to its file;
 *  - a label with scope "global" -> `(global_label ...)`: project-wide by name;
 *  - power and ground labels and Theory ground symbols -> `power:<name>` symbols per EXACT name (KiCad connects power symbols by their
 *    Value, so AGND, DGND and GND stay three nets), exactly as the flat exporter writes them;
 *  - a hierarchical label (scope "hierarchical") -> `(hierarchical_label "<port name>" (shape <dir>))` on the child file;
 *  - a sheet pin (scope "sheet-pin") -> a `(pin "<port name>" <shape>)` on the child's sheet symbol in the PARENT file, placed at the
 *    nearest free grid point of the child's block edge, with a two-point wire from the Sirkit anchor when the anchor is not on the
 *    edge (OD-258 item 2: lossless; the editor's planner anchors a pin at the parent-side cut point, not on the block); every pin
 *    placed and every connecting wire written earlier on the parent sheet is an obstacle for the pins placed after it ([PR-J4
 *    integration, 2026-10-23] review J4R-OUT-1: a later wire passing over an earlier pin, or a later pin on an earlier wire's interior,
 *    would be a connection in KiCad that this project does not have);
 *  - coordinates connect per file only, so identical XY on two sheets never meet; symbol instance paths chain the SHEET SYMBOL uuids
 *    (`/<root uuid>/<sheet symbol uuid>/...`), pages are numbered depth-first in document order, `(sheet_instances (path "/" (page
 *    "1")))` is written on the root only.
 *
 * Fail closed (the route answers a structured 422, nothing is zipped): a connectivity error (`SHEET_HIERARCHY_INVALID`); a local label
 * that carries a port anchor's name on its sheet on another net (`EXPORT_SHADOWED_PORT`, the authority's SHEET_LOCAL_SHADOWS_PORT:
 * KiCad would read one net where this project keeps two); a local label equal to a global, power or ground name on its own sheet
 * (`EXPORT_NAME_SHADOWS_GLOBAL`: a conservative reading of KiCad's scope rules - refused rather than guessed); two spellings of one
 * net name within one scope - local labels on one sheet, or the project-wide global / power / ground names, a Theory ground symbol
 * counting as "GND" - ([PR-J4 integration, 2026-10-23] review J4R-OUT-4, `EXPORT_NAME_CASE_AMBIGUOUS`: the authority joins label
 * names case-insensitively and trimmed, KiCad by exact text, so "OUT" beside "out" is one net here and two in the file); a sheet pin
 * that finds no free edge point (`EXPORT_SHEET_PIN_PLACEMENT`). Port directions power_in / power_out become the KiCad pin shapes
 * input / output (sheet pins have no power shapes).
 *
 * Deterministic: every uuid is `uuidFor(prefix, stable id)` (a SHA-256 digest; no `crypto.randomUUID` anywhere; a child sheet's
 * junction is keyed by its sheet id and coordinates, the root's by coordinates alone as the flat exporter's - [PR-J4 integration,
 * 2026-10-23] review J4R-OUT-5, so two sheets meeting wires at one coordinate never share a uuid), file names carry a digest of the
 * sheet id (two sheets whose sanitized names coincide stay distinct; renaming an UNRELATED sheet moves no other file), the title
 * block date is `today` (defaults to the flat exporter's TODAY) and the zip entries are sorted with a fixed DOS date, so two exports
 * of one project are byte-identical. A document WITHOUT sheets is never written here: the route hands it to `exportToKicadSch`,
 * whose bytes are pinned (j1-sheet-operations GOLDEN).
 *
 * Proof: a Sirkit reader over the pinned format (app/lib/__tests__/_kicad-hierarchy-oracle.ts) parses the files back and proves their
 * connectivity equals the authority's pin partition; no KiCad run is claimed (J.8 item 5).
 */

import JSZip from "jszip";
import { atomicSnapshotToCachedPart } from "@/app/lib/atomic/kicad-adapters";
import { validateSchematicStateIntegrity } from "@/app/lib/engineering/schematic-model";
import { pinWorldPos, pointKey } from "@/app/lib/geometry";
import { safeHref } from "@/app/lib/net/href-policy";
import { resolveProjectConnectivity, type PartPinsLookup, type ProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { nearestBlockEdgePoint, sheetBlockOf } from "@/app/lib/schematic/sheet-lens";
import { assertWholeProject, sheetOf, sheetPathName } from "@/app/lib/schematic/sheets";
import { compareCodePoints } from "@/app/lib/stable-compare";
import { assignFootprints } from "@/lib/footprint-assign";
import { DEFAULT_PAGE_SIZE, netLabelNameKey, schDisplayRef, type NetLabel, type Point, type SchematicSheet, type SchematicState, type SheetPortDirection } from "@/lib/schematic-types";
import {
  INTERSHEET_REFS_VALUE,
  KICAD_VERSION,
  SchematicExportLicenseError,
  SchematicExportValidationError,
  THEORY_LIB_ID,
  TODAY,
  assertSingleSymbolDefinition,
  buildGlobalLabel,
  buildJunction,
  buildPowerPort,
  buildSymbolInstance,
  buildWire,
  indent,
  mmFromPx,
  num,
  q,
  rewriteSymbolName,
  round3,
  sanitizeEmbeddedDatasheets,
  uuidFor,
  type KicadExportInput,
  type TheoryType,
} from "./kicad-export";
import { buildGenericPowerSymbol, getPowerSymbol } from "./kicad-power-symbols";
import type { CachedPart } from "./parts-cache";

// ── refusals ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KicadHierarchyRefusalCode = "SHEET_HIERARCHY_INVALID" | "EXPORT_SHADOWED_PORT" | "EXPORT_NAME_SHADOWS_GLOBAL" | "EXPORT_NAME_CASE_AMBIGUOUS" | "EXPORT_SHEET_PIN_PLACEMENT";

/** A typed, fail-closed refusal of the hierarchical export: the route maps it to a structured 422; nothing was serialized. */
export class SchematicExportHierarchyError extends Error {
  readonly code: KicadHierarchyRefusalCode;
  /** The label, net or port ids involved (sorted, unique). */
  readonly refs: readonly string[];
  constructor(code: KicadHierarchyRefusalCode, message: string, refs: readonly string[] = []) {
    super(message);
    this.name = "SchematicExportHierarchyError";
    this.code = code;
    this.refs = [...new Set(refs)].sort(compareCodePoints);
  }
}

// ── names and shapes ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KicadSheetPinShape = "input" | "output" | "bidirectional" | "passive";

/** The KiCad sheet-pin / hierarchical-label shape of a port direction: power_in -> input, power_out -> output (no power shapes exist). */
export function sheetPinShape(direction: SheetPortDirection): KicadSheetPinShape {
  if (direction === "power_in") return "input";
  if (direction === "power_out") return "output";
  return direction;
}

/** The route's file-name rule (app/api/export/kicad/route.ts sanitizeFilename), shared by the root file, the child files and the zip. */
export function sanitizeKicadFileStem(raw: string, fallback: string): string {
  const base = raw.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return base.length > 0 ? base : fallback;
}

/** `<sanitized sheet path>-<8 hex of uuidFor("sheet-file", id)>.kicad_sch`: stable under renames of other sheets, distinct for same-named sheets. */
export function kicadSheetFileName(state: Pick<SchematicState, "sheets">, sheet: SchematicSheet): string {
  if (sheet.parentId === null) throw new Error("kicadSheetFileName: the root sheet is the project file, named by the export title");
  return `${sanitizeKicadFileStem(sheetPathName(state, sheet.id), "sheet")}-${uuidFor("sheet-file", sheet.id).slice(0, 8)}.kicad_sch`;
}

// ── the pre-check (the route runs it before any catalog read; the exporter runs it again with the parts) ───────────────────────

const describeSheet = (state: SchematicState, sheetId: string): string => { const path = sheetPathName(state, sheetId); return path ? `sheet "${path}"` : "the overview"; };

/**
 * Why a project with sheets cannot be exported as a KiCad hierarchy, or null. Label-net membership needs no part pins (parts never
 * join nets), so the result without a part lookup equals the result with one; the exporter re-runs it with the parts as defence in
 * depth.
 */
export function refuseKicadHierarchy(state: SchematicState, getPart?: PartPinsLookup, resolved?: ProjectConnectivity): SchematicExportHierarchyError | null {
  assertWholeProject(state, "kicad-export-hierarchy");
  const conn = resolved ?? resolveProjectConnectivity(state, getPart);
  const errors = conn.diagnostics.filter((item) => item.severity === "error");
  if (!conn.ok || errors.length > 0) {
    return new SchematicExportHierarchyError("SHEET_HIERARCHY_INVALID", `The project's sheets or connections have errors, so nothing was exported: ${errors.map((item) => `${item.code}: ${item.message}`).join(" ")}`, errors.flatMap((item) => item.refs));
  }
  const shadows = conn.diagnostics.filter((item) => item.code === "SHEET_LOCAL_SHADOWS_PORT");
  if (shadows.length > 0) {
    return new SchematicExportHierarchyError("EXPORT_SHADOWED_PORT", `KiCad would read a local label and a same-named port label on one sheet as one net, while this project keeps them apart; nothing was exported. ${shadows.map((item) => item.message).join(" ")}`, shadows.flatMap((item) => item.refs));
  }
  const labels = state.netLabels ?? [];
  const globalNamesOn = new Map<string, Map<string, string>>(); // sheet -> name key -> display name
  const addGlobal = (sheetId: string, name: string): void => {
    const names = globalNamesOn.get(sheetId) ?? new Map<string, string>();
    if (!names.has(netLabelNameKey(name))) names.set(netLabelNameKey(name), name);
    globalNamesOn.set(sheetId, names);
  };
  for (const label of labels) if (label.scope === "global" || label.kind === "power" || label.kind === "ground") addGlobal(sheetOf(label), label.name);
  for (const component of state.components) if (component.type === "ground") addGlobal(sheetOf(component), "GND");
  const shadowed: string[] = [];
  const refs: string[] = [];
  for (const label of labels) {
    if (label.scope !== undefined || label.kind !== "label") continue;
    const rail = globalNamesOn.get(sheetOf(label))?.get(netLabelNameKey(label.name));
    if (rail === undefined) continue;
    shadowed.push(`"${label.name}" (${label.id}, on ${describeSheet(state, sheetOf(label))}, ${label.position.x},${label.position.y}) beside the project-wide net ${rail}`);
    refs.push(label.id);
  }
  if (shadowed.length > 0) {
    return new SchematicExportHierarchyError("EXPORT_NAME_SHADOWS_GLOBAL", `A local label carries the name of a global, power or ground net on the same sheet: ${shadowed.join("; ")}. KiCad's reading of such a pair is not this project's (the local label is its own net here), so nothing was exported. Rename the local label, or make it global if it is meant to be that net.`, refs);
  }
  // [PR-J4 integration, 2026-10-23] review J4R-OUT-4: the authority joins names by netLabelNameKey (trimmed, case-insensitive), KiCad by
  // exact text; two spellings of one key within one scope (a sheet's local labels; the project-wide global / power / ground names, a
  // Theory ground symbol spelled "GND") are one net here and two in the file, so they are refused rather than written
  const PROJECT_SCOPE = "\u0001project";
  const spellings = new Map<string, Map<string, Map<string, string[]>>>(); // scope -> name key -> spelling -> entity ids
  const spell = (scope: string, name: string, id: string): void => {
    const byKey = spellings.get(scope) ?? new Map<string, Map<string, string[]>>();
    const bySpelling = byKey.get(netLabelNameKey(name)) ?? new Map<string, string[]>();
    bySpelling.set(name, [...(bySpelling.get(name) ?? []), id]);
    byKey.set(netLabelNameKey(name), bySpelling);
    spellings.set(scope, byKey);
  };
  for (const label of labels) {
    if (label.scope === "global" || label.kind === "power" || label.kind === "ground") spell(PROJECT_SCOPE, label.name, label.id);
    else if (label.scope === undefined && label.kind === "label") spell(sheetOf(label), label.name, label.id);
  }
  for (const component of state.components) if (component.type === "ground") spell(PROJECT_SCOPE, "GND", component.id);
  const ambiguous: string[] = [];
  const ambiguousRefs: string[] = [];
  for (const [scope, byKey] of [...spellings.entries()].sort(([a], [b]) => compareCodePoints(a, b))) {
    for (const [, bySpelling] of [...byKey.entries()].sort(([a], [b]) => compareCodePoints(a, b))) {
      if (bySpelling.size < 2) continue;
      const variants = [...bySpelling.entries()].sort(([a], [b]) => compareCodePoints(a, b));
      ambiguous.push(`${variants.map(([spelling, ids]) => `"${spelling}" (${[...ids].sort(compareCodePoints).join(", ")})`).join(" and ")} ${scope === PROJECT_SCOPE ? "among the project-wide rail and global names" : `on ${describeSheet(state, scope)}`}`);
      for (const [, ids] of variants) ambiguousRefs.push(...ids);
    }
  }
  if (ambiguous.length > 0) {
    return new SchematicExportHierarchyError("EXPORT_NAME_CASE_AMBIGUOUS", `One net name is spelled two ways within one scope: ${ambiguous.join("; ")}. This project reads the spellings as one net (names compare case-insensitively), KiCad as separate nets, so nothing was exported. Use one spelling.`, ambiguousRefs);
  }
  return null;
}

// ── the export ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface KicadHierarchyExportInput extends KicadExportInput {
  /** The title-block date (YYYY-MM-DD); defaults to the flat exporter's TODAY. Tests inject it so a golden strips nothing. */
  today?: string;
}

export interface KicadHierarchyFile {
  /** The zip entry / file name (no directory). */
  path: string;
  content: string;
  sheetId: string;
  /** The KiCad page number (root 1; children depth-first in document order). */
  page: number;
  /** The KiCad symbol-instance path of this sheet (`/<root uuid>` for the root, chained sheet-symbol uuids below). */
  instancePath: string;
}

export interface KicadHierarchyExport {
  /** In page order (the root first). The route sorts the zip entries by path. */
  files: KicadHierarchyFile[];
  rootPath: string;
  rootUuid: string;
}

const GRID = 10;

const sameKey = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** `point` lies on the closed segment a-b (any direction; exact integer arithmetic on the px grid). */
function onSegment(point: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  if (cross !== 0) return false;
  return point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
}

type Block = NonNullable<SchematicSheet["block"]>;

/** The perimeter positions of a block, clockwise from its top-left corner, one per grid step (the block is grid-aligned by validation). */
function perimeterPoints(block: Block): Point[] {
  const points: Point[] = [];
  const { x, y, width, height } = block;
  for (let t = 0; t < width; t += GRID) points.push({ x: x + t, y });
  for (let t = 0; t < height; t += GRID) points.push({ x: x + width, y: y + t });
  for (let t = 0; t < width; t += GRID) points.push({ x: x + width - t, y: y + height });
  for (let t = 0; t < height; t += GRID) points.push({ x, y: y + height - t });
  return points;
}

/** The KiCad sheet-pin angle and text justification for a point on a block edge (left 180, right 0, top 90, bottom 270). */
function pinAngle(block: Block, point: Point): { angle: number; justify: "left" | "right" } {
  if (point.x === block.x) return { angle: 180, justify: "right" };
  if (point.x === block.x + block.width) return { angle: 0, justify: "left" };
  if (point.y === block.y) return { angle: 90, justify: "left" };
  return { angle: 270, justify: "right" };
}

interface ParentSheetNodes {
  /** Every point of the parent sheet KiCad would connect a wire end to: wire vertices, part pins, label anchors, ground symbol pins. */
  nodes: Map<string, Point>;
  /** The parent sheet's wire segments. */
  segments: Array<[Point, Point]>;
}

function parentSheetNodes(state: SchematicState, conn: ProjectConnectivity, sheetId: string): ParentSheetNodes {
  const nodes = new Map<string, Point>();
  const add = (point: Point): void => { nodes.set(pointKey(point), point); };
  const segments: Array<[Point, Point]> = [];
  for (const wire of state.wires) {
    if (sheetOf(wire) !== sheetId) continue;
    for (const vertex of wire.vertices) add(vertex);
    for (let index = 0; index + 1 < wire.vertices.length; index += 1) segments.push([wire.vertices[index]!, wire.vertices[index + 1]!]);
  }
  for (const pin of conn.pins) if (pin.sheetId === sheetId) add(pin.point);
  for (const label of state.netLabels ?? []) if (sheetOf(label) === sheetId) add(label.position);
  for (const component of state.components) if (component.type === "ground" && sheetOf(component) === sheetId) add(pinWorldPos(component, "pin"));
  return { nodes, segments };
}

/**
 * Where a sheet pin is written: the nearest grid point of the child's block edge to the Sirkit anchor that no other sheet pin of
 * this parent sheet takes, that no wire, pin or label of the parent sheet sits on (KiCad connects a wire end to whatever it
 * touches, a segment's interior included), and whose connecting wire from the anchor passes through no such point. The anchor
 * itself on the edge is taken as is (no wire). Clockwise perimeter walk from the nearest point; deterministic. [PR-J4 integration,
 * 2026-10-23] review J4R-OUT-1: the caller adds every placed pin to `parent.nodes` and every connecting wire it writes to
 * `parent.segments`, so the pins placed earlier on this parent sheet and their wires are obstacles too (a later wire over an earlier
 * pin fails the crossing test, a later candidate on an earlier wire's interior the segment test).
 */
function placeSheetPin(block: Block, anchor: Point, parent: ParentSheetNodes, taken: Set<string>): Point | null {
  const nearest = nearestBlockEdgePoint(block, anchor);
  const perimeter = perimeterPoints(block);
  const start = Math.max(0, perimeter.findIndex((point) => sameKey(point, nearest)));
  for (let step = 0; step < perimeter.length; step += 1) {
    const candidate = perimeter[(start + step) % perimeter.length]!;
    const key = pointKey(candidate);
    if (taken.has(key)) continue;
    if (sameKey(candidate, anchor)) return candidate;
    if (parent.nodes.has(key)) continue;
    if (parent.segments.some(([a, b]) => onSegment(candidate, a, b))) continue;
    const crossed = [...parent.nodes.values()].some((node) => !sameKey(node, anchor) && !sameKey(node, candidate) && onSegment(node, anchor, candidate));
    if (crossed) continue;
    return candidate;
  }
  return null;
}

function buildSheetSymbol(o: {
  x: number; y: number; width: number; height: number; name: string; file: string; uuid: string;
  pins: Array<{ name: string; shape: KicadSheetPinShape; x: number; y: number; angle: number; justify: "left" | "right"; uuid: string }>;
  parentPath: string; page: number;
}): string {
  return [
    `\t(sheet`,
    `\t\t(at ${num(o.x)} ${num(o.y)})`,
    `\t\t(size ${num(o.width)} ${num(o.height)})`,
    `\t\t(exclude_from_sim no)`,
    `\t\t(in_bom yes)`,
    `\t\t(on_board yes)`,
    `\t\t(dnp no)`,
    `\t\t(fields_autoplaced yes)`,
    `\t\t(stroke (width 0.1524) (type solid))`,
    `\t\t(fill (color 0 0 0 0.0000))`,
    `\t\t(uuid ${q(o.uuid)})`,
    `\t\t(property "Sheetname" ${q(o.name)} (at ${num(o.x)} ${num(round3(o.y - 0.7116))} 0) (effects (font (size 1.27 1.27)) (justify left bottom)))`,
    `\t\t(property "Sheetfile" ${q(o.file)} (at ${num(o.x)} ${num(round3(o.y + o.height + 0.5846))} 0) (effects (font (size 1.27 1.27)) (justify left top)))`,
    ...o.pins.map((pin) => `\t\t(pin ${q(pin.name)} ${pin.shape} (at ${num(pin.x)} ${num(pin.y)} ${num(pin.angle)}) (effects (font (size 1.27 1.27)) (justify ${pin.justify})) (uuid ${q(pin.uuid)}))`),
    `\t\t(instances`,
    `\t\t\t(project "sirkit_export"`,
    `\t\t\t\t(path ${q(o.parentPath)} (page ${q(String(o.page))}))`,
    `\t\t\t)`,
    `\t\t)`,
    `\t)`,
  ].join("\n");
}

function buildHierarchicalLabel(name: string, shape: KicadSheetPinShape, x: number, y: number, rotation: number, uuid: string): string {
  return [
    `\t(hierarchical_label ${q(name)}`,
    `\t\t(shape ${shape})`,
    `\t\t(at ${num(x)} ${num(y)} ${num(rotation)})`,
    `\t\t(fields_autoplaced yes)`,
    `\t\t(effects (font (size 1.27 1.27)) (justify left))`,
    `\t\t(uuid ${q(uuid)})`,
    `\t\t(property "Intersheetrefs" ${q(INTERSHEET_REFS_VALUE)} (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))`,
    `\t)`,
  ].join("\n");
}

function buildLocalLabel(name: string, x: number, y: number, rotation: number, uuid: string): string {
  return [
    `\t(label ${q(name)}`,
    `\t\t(at ${num(x)} ${num(y)} ${num(rotation)})`,
    `\t\t(fields_autoplaced yes)`,
    `\t\t(effects (font (size 1.27 1.27)) (justify left))`,
    `\t\t(uuid ${q(uuid)})`,
    `\t)`,
  ].join("\n");
}

/**
 * Export a project WITH sheets as a KiCad hierarchy (see the module header). Throws `SchematicExportValidationError` (the canonical
 * contract, exactly as the flat exporter), `SchematicExportLicenseError` (a pinned symbol whose license forbids export) or
 * `SchematicExportHierarchyError` (the refusals above); a document without sheets is refused (it belongs to `exportToKicadSch`).
 */
export function exportToKicadHierarchy(input: KicadHierarchyExportInput): KicadHierarchyExport {
  const { state, parts } = input;
  assertWholeProject(state, "kicad-export-hierarchy");
  if (state.sheets === undefined) throw new SchematicExportValidationError(["the document has no sheets: a single-sheet project is written by exportToKicadSch"]);
  const validationIssues = validateSchematicStateIntegrity(state);
  if (validationIssues.length > 0) throw new SchematicExportValidationError(validationIssues);
  const components = state.components;
  const kicadComponents = state.kicadComponents ?? [];
  const netLabels = state.netLabels ?? [];

  // the flat exporter's rule: a pinned instance is exported from its published snapshot, whose symbol license must permit export
  const effectivePartByInstance = new Map<string, CachedPart>();
  const licenseViolations: Array<{ refDes: string; licenseId: string; disposition: string }> = [];
  for (const instance of kicadComponents) {
    const selection = input.componentSelections?.[instance.id];
    const pinned = Boolean(selection && selection.atomicRevisionId === instance.atomicPartRevisionId && selection.symbolVersionId === instance.symbolAssetVersionId);
    if (pinned && selection) {
      const snapshot = selection.embeddedSnapshot;
      const licenseId = snapshot.symbol.origin.licenseId;
      const license = snapshot.licenses.find((item) => item.id === licenseId);
      if (!license || license.exportDisposition !== "redistributable") licenseViolations.push({ refDes: instance.refDes, licenseId, disposition: license?.exportDisposition ?? "missing" });
    }
    const exact = pinned && selection ? atomicSnapshotToCachedPart(selection.embeddedSnapshot) : null;
    const part = exact ?? parts.get(instance.partId);
    if (part) effectivePartByInstance.set(instance.id, part);
  }
  if (licenseViolations.length > 0) throw new SchematicExportLicenseError(licenseViolations);

  // the connectivity authority over the parts this export writes (pins per part id; a pinned snapshot carries the same pins)
  const partByPartId = new Map<string, CachedPart>();
  for (const instance of kicadComponents) { const part = effectivePartByInstance.get(instance.id); if (part && !partByPartId.has(instance.partId)) partByPartId.set(instance.partId, part); }
  const lookup: PartPinsLookup = (partId) => partByPartId.get(partId) ?? parts.get(partId) ?? null;
  const conn = resolveProjectConnectivity(state, lookup);
  const refusal = refuseKicadHierarchy(state, lookup, conn);
  if (refusal) throw refusal;

  // pages depth-first in document order; instance paths chain the sheet-symbol uuids
  const sheets = state.sheets.sheets;
  const root = sheets.find((sheet) => sheet.parentId === null)!;
  const childrenOf = (sheetId: string): SchematicSheet[] => sheets.filter((sheet) => sheet.parentId === sheetId);
  const order: SchematicSheet[] = [];
  const visit = (sheet: SchematicSheet): void => { order.push(sheet); for (const child of childrenOf(sheet.id)) visit(child); };
  visit(root);
  const pageOf = new Map(order.map((sheet, index) => [sheet.id, index + 1] as const));
  const rootUuid = uuidFor("schematic", "root");
  const sheetSymbolUuid = (sheet: SchematicSheet): string => uuidFor("sheet", sheet.id);
  const instancePath = new Map<string, string>([[root.id, `/${rootUuid}`]]);
  for (const sheet of order) if (sheet.parentId !== null) instancePath.set(sheet.id, `${instancePath.get(sheet.parentId)!}/${sheetSymbolUuid(sheet)}`);
  const title = input.title ?? "sirkit export";
  const rootPath = `${sanitizeKicadFileStem(input.title ?? "sirkit_export", "sirkit_export")}.kicad_sch`;
  const fileOf = new Map<string, string>([[root.id, rootPath]]);
  for (const sheet of order) if (sheet.parentId !== null) fileOf.set(sheet.id, kicadSheetFileName(state, sheet));
  if (new Set(fileOf.values()).size !== fileOf.size) throw new SchematicExportHierarchyError("SHEET_HIERARCHY_INVALID", "Two sheets would be written to one file name; rename a sheet or the export title. Nothing was exported.", [...fileOf.keys()]);
  const today = input.today ?? TODAY;

  // footprints exactly as the flat exporter assigns them (project-wide)
  const footprintByRefDes = new Map(assignFootprints(kicadComponents, parts).map((item) => [item.refDes, item.footprint] as const));
  for (const instance of kicadComponents) {
    const selection = input.componentSelections?.[instance.id];
    const snapshot = selection?.embeddedSnapshot;
    if (selection && snapshot?.mapping?.state === "approved" && snapshot.footprint && selection.atomicRevisionId === instance.atomicPartRevisionId && selection.footprintVersionId === instance.footprintAssetVersionId && selection.mappingCertificateId === instance.mappingCertificateId) {
      footprintByRefDes.set(instance.refDes, `${snapshot.footprint.origin.libraryNickname}:${snapshot.footprint.footprintName}`);
    }
  }
  let pwrIndex = 0;
  const nextPwrRef = (): string => `#PWR0${String(pwrIndex++).padStart(2, "0")}`;
  const portOf = (portId: string): { sheet: SchematicSheet; port: NonNullable<SchematicSheet["ports"]>[number] } | null => {
    for (const sheet of sheets) for (const port of sheet.ports ?? []) if (port.id === portId) return { sheet, port };
    return null;
  };

  const files: KicadHierarchyFile[] = [];
  for (const sheet of order) {
    const on = <T extends { sheetId?: string }>(items: readonly T[]): T[] => items.filter((item) => sheetOf(item) === sheet.id);
    const sheetInstances = on(kicadComponents);
    const sheetComponents = on(components);
    const sheetWires = on(state.wires);
    const sheetLabels = on(netLabels);
    const path = instancePath.get(sheet.id)!;
    const lines: string[] = [];
    lines.push("(kicad_sch");
    lines.push(`\t(version ${KICAD_VERSION})`);
    lines.push(`\t(generator "sirkit_export")`);
    lines.push(`\t(generator_version "1.0")`);
    lines.push(`\t(uuid ${q(sheet.parentId === null ? rootUuid : uuidFor("schematic", sheet.id))})`);
    lines.push(`\t(paper ${q(state.pageSize ?? DEFAULT_PAGE_SIZE)})`);
    lines.push(`\t(title_block`);
    lines.push(`\t\t(title ${q(sheet.parentId === null ? title : `${title} - ${sheetPathName(state, sheet.id)}`)})`);
    lines.push(`\t\t(company ${q(input.company ?? "")})`);
    lines.push(`\t\t(date ${q(today)})`);
    lines.push(`\t\t(comment 1 ${q(input.description ?? "")})`);
    lines.push(`\t)`);

    // (A) lib_symbols of this sheet: its parts (deduped per file) and the power symbols its rails and ground symbols use
    const partLibId = new Map<string, string>();
    lines.push(`\t(lib_symbols`);
    const embedded = new Set<string>();
    for (const instance of sheetInstances) {
      const assetKey = instance.atomicPartRevisionId ?? instance.partId;
      const part = effectivePartByInstance.get(instance.id);
      if (!part) continue; // missing parts are surfaced by the API layer
      const libId = `${part.libraryName}:${part.name}`;
      partLibId.set(instance.id, libId);
      if (embedded.has(assetKey)) continue;
      embedded.add(assetKey);
      const pinnedSelection = input.componentSelections?.[instance.id];
      if (pinnedSelection && pinnedSelection.atomicRevisionId === instance.atomicPartRevisionId && pinnedSelection.symbolVersionId === instance.symbolAssetVersionId) assertSingleSymbolDefinition(part.symbolRaw.trim(), instance.refDes);
      const raw = rewriteSymbolName(sanitizeEmbeddedDatasheets(part.symbolRaw.trim()), libId);
      if (raw) lines.push(indent(raw, 2));
    }
    const powerNames = new Set<string>();
    for (const label of sheetLabels) {
      if (label.kind === "ground") powerNames.add("GND");
      else if (label.kind === "power") powerNames.add(label.name);
    }
    if (sheetComponents.some((component) => component.type === "ground")) powerNames.add("GND");
    for (const name of powerNames) lines.push(indent(rewriteSymbolName((getPowerSymbol(name) ?? buildGenericPowerSymbol(name)).trim(), `power:${name}`), 2));
    lines.push(`\t)`);

    // (B) symbol instances, their instance path chaining the sheet symbols above this sheet
    for (const instance of sheetInstances) {
      const libId = partLibId.get(instance.id);
      if (!libId) continue;
      const part = effectivePartByInstance.get(instance.id);
      lines.push(buildSymbolInstance({ libId, x: mmFromPx(instance.x), y: mmFromPx(instance.y), rotation: instance.rotation, refDes: instance.refDes, value: instance.value, footprint: footprintByRefDes.get(instance.refDes) ?? "", datasheet: safeHref(part?.datasheet, "document") ?? "", uuid: uuidFor("symbol", instance.id), sheetPath: path }));
    }
    for (const component of sheetComponents) {
      if (component.type === "ground") continue; // a power:GND port below
      lines.push(buildSymbolInstance({ libId: THEORY_LIB_ID[component.type as TheoryType], x: mmFromPx(component.x), y: mmFromPx(component.y), rotation: component.rotation, refDes: schDisplayRef(component), value: component.value, footprint: "", datasheet: "", uuid: uuidFor("symbol", component.id), sheetPath: path }));
    }

    // (C) wires and junctions of this sheet
    const endpointCounts = new Map<string, { x: number; y: number; count: number }>();
    const tally = (x: number, y: number): void => { const key = `${x},${y}`; const hit = endpointCounts.get(key); if (hit) hit.count += 1; else endpointCounts.set(key, { x, y, count: 1 }); };
    for (const wire of sheetWires) {
      const vertices = wire.vertices;
      for (let index = 0; index + 1 < vertices.length; index += 1) lines.push(buildWire(mmFromPx(vertices[index]!.x), mmFromPx(vertices[index]!.y), mmFromPx(vertices[index + 1]!.x), mmFromPx(vertices[index + 1]!.y), uuidFor("wire", `${wire.id}:${index}`)));
      for (const vertex of vertices) tally(mmFromPx(vertex.x), mmFromPx(vertex.y));
    }
    for (const { x, y, count } of endpointCounts.values()) if (count >= 3) lines.push(buildJunction(x, y, uuidFor("junction", sheet.parentId === null ? `${x},${y}` : `${sheet.id}:${x},${y}`))); // [PR-J4 integration, 2026-10-23] review J4R-OUT-5: a child sheet's junction is keyed by its sheet too (the root keeps the flat exporter's key)

    // (D) the child sheets' symbols: one (pin) per bound port at a free block-edge point, wired from the Sirkit anchor when it differs
    const parent = parentSheetNodes(state, conn, sheet.id);
    const taken = new Set<string>();
    for (const child of childrenOf(sheet.id)) {
      const block = sheetBlockOf(state, child);
      const ports = child.ports ?? [];
      const pinLabels = sheetLabels
        .filter((label): label is NetLabel & { portId: string } => label.scope === "sheet-pin" && label.childSheetId === child.id && typeof label.portId === "string")
        .sort((a, b) => (ports.findIndex((port) => port.id === a.portId) - ports.findIndex((port) => port.id === b.portId)) || compareCodePoints(a.id, b.id));
      const pins: Parameters<typeof buildSheetSymbol>[0]["pins"] = [];
      for (const label of pinLabels) {
        const bound = portOf(label.portId);
        if (!bound) continue; // the validator refuses a pin without its port before this point
        const placed = placeSheetPin(block, label.position, parent, taken);
        if (!placed) throw new SchematicExportHierarchyError("EXPORT_SHEET_PIN_PLACEMENT", `Sheet pin "${bound.port.name}" of sheet "${child.name}" finds no free point on its block edge on ${describeSheet(state, sheet.id)}; move or enlarge the block. Nothing was exported.`, [label.id, bound.port.id]);
        taken.add(pointKey(placed));
        parent.nodes.set(pointKey(placed), placed); // [PR-J4 integration, 2026-10-23] review J4R-OUT-1: the placed pin is an obstacle for every pin placed after it on this parent sheet
        if (!sameKey(placed, label.position)) {
          lines.push(buildWire(mmFromPx(label.position.x), mmFromPx(label.position.y), mmFromPx(placed.x), mmFromPx(placed.y), uuidFor("wire", `sheet-pin:${label.id}`)));
          parent.segments.push([label.position, placed]); // and so is its connecting wire (a later pin on this wire's interior would join it)
        }
        const { angle, justify } = pinAngle(block, placed);
        pins.push({ name: bound.port.name, shape: sheetPinShape(bound.port.direction), x: mmFromPx(placed.x), y: mmFromPx(placed.y), angle, justify, uuid: uuidFor("sheet-pin", label.id) });
      }
      lines.push(buildSheetSymbol({ x: mmFromPx(block.x), y: mmFromPx(block.y), width: mmFromPx(block.width), height: mmFromPx(block.height), name: child.name, file: fileOf.get(child.id)!, uuid: sheetSymbolUuid(child), pins, parentPath: path, page: pageOf.get(child.id)! }));
    }

    // (E) labels: rails as power symbols, scope "global" as global labels, port anchors as hierarchical labels, the rest local
    for (const label of sheetLabels) {
      const x = mmFromPx(label.position.x);
      const y = mmFromPx(label.position.y);
      const uuid = uuidFor("label", label.id);
      if (label.kind === "ground") { lines.push(buildPowerPort("power:GND", label.name || "GND", x, y, label.orientation, nextPwrRef(), uuid, path)); continue; }
      if (label.kind === "power") { lines.push(buildPowerPort(`power:${label.name}`, label.name, x, y, label.orientation, nextPwrRef(), uuid, path)); continue; }
      if (label.scope === "sheet-pin") continue; // written on the child's sheet symbol above
      if (label.scope === "hierarchical") {
        const bound = typeof label.portId === "string" ? portOf(label.portId) : null;
        if (!bound) continue; // refused by the validator before this point
        lines.push(buildHierarchicalLabel(bound.port.name, sheetPinShape(bound.port.direction), x, y, label.orientation, uuid));
        continue;
      }
      if (label.scope === "global") { lines.push(buildGlobalLabel(label.name, x, y, label.orientation, uuid)); continue; }
      lines.push(buildLocalLabel(label.name, x, y, label.orientation, uuid));
    }
    for (const component of sheetComponents) {
      if (component.type !== "ground") continue;
      const pin = pinWorldPos(component, "pin");
      lines.push(buildPowerPort("power:GND", "GND", mmFromPx(pin.x), mmFromPx(pin.y), component.rotation, nextPwrRef(), uuidFor("symbol", component.id), path));
    }

    if (sheet.parentId === null) {
      lines.push(`\t(sheet_instances`);
      lines.push(`\t\t(path "/" (page "1"))`);
      lines.push(`\t)`);
    }
    lines.push(")");
    files.push({ path: fileOf.get(sheet.id)!, content: lines.join("\n") + "\n", sheetId: sheet.id, page: pageOf.get(sheet.id)!, instancePath: path });
  }
  return { files, rootPath, rootUuid };
}

// ── the zip ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every zip entry's date (the DOS epoch, UTC): two exports of one project give one byte sequence. */
export const KICAD_HIERARCHY_ZIP_DATE: Readonly<Date> = Object.freeze(new Date(Date.UTC(1980, 0, 1, 0, 0, 0)));

/** The project's files as ONE zip: entries sorted by path, STORED (no compression), the fixed date, no folders. */
export async function zipKicadHierarchy(files: ReadonlyArray<Pick<KicadHierarchyFile, "path" | "content">>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of [...files].sort((a, b) => compareCodePoints(a.path, b.path))) zip.file(file.path, file.content, { date: new Date(KICAD_HIERARCHY_ZIP_DATE.getTime()), createFolders: false, binary: false, compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "STORE", platform: "DOS" });
}
