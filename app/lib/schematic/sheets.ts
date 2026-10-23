/**
 * [PR-J, 2026-10-22] Runbook section J increment 1 (OD-255 items 1, 5, 8): THE structural contract of a multi-sheet schematic.
 *
 * A multi-sheet project is the SAME `SchematicState` with an optional sheet tree (`state.sheets`) and an optional `sheetId` on each
 * component, wire and label (absent = the root sheet, `ROOT_SHEET_ID`). A single-sheet project has NO `sheets` and no `sheetId`, so
 * its bytes, digests and exports are exactly what they were before section J. This module owns:
 *
 *  - `isSingleSheet`, `sheetOf`, `sheetPathName`, `normalizeHierarchy` (the canonical form: no "root" sheetId is ever written, no
 *    empty `ports` array, and a tree with no child sheet collapses back to the single-sheet document);
 *  - `validateSheetHierarchy`: named diagnostics for every structural rule (one root first in the list, parents, cycles, depth <= 16
 *    and at most 512 sheets - the CD-8 capability limits, unique ids and sibling names, entity references, ports only on child sheets,
 *    unique port names, port-bound labels that reference a real port on the right sheet, one sheet pin per port) and the explicit
 *    refusals of what is not supported yet (bus / bundle ports, repeated sheet instances, one package's units on different sheets);
 *  - `sheetLens`: a BRANDED read-only view of one sheet. Its arrays are readonly (a lens is not assignable to `SchematicState` at
 *    compile time) and the lens and its arrays carry a non-enumerable brand that `assertWholeProject` refuses at run time; every
 *    whole-project consumer (PCB publication, ERC, design checks, BOM, SPICE and its IR, KiCad export, the connectivity authority)
 *    calls it first. [PR-J1 integration, 2026-10-22] review PC-3: the run-time half detects the lens and its own arrays, NOT a copy -
 *    a spread, filter, map or slice of a lens array is an ordinary array again; the guarantee for copies is the compile-time type.
 *
 * Connectivity (which pins form one net across sheets) is NOT decided here: app/lib/schematic/project-connectivity.ts is the one
 * authority. Pure module: no I/O, no randomness, no React.
 */

import type { HierarchicalPortDefinition } from "@/app/lib/schematic-compiler/types";
import { validateSchematicPoint } from "@/app/lib/engineering/schematic-geometry";
import {
  ROOT_SHEET_ID,
  netLabelNameKey,
  type KicadComponentInstance,
  type NetLabel,
  type SchComponent,
  type SchematicSheet,
  type SchematicSheetSet,
  type SchematicState,
  type SheetPort,
  type SheetPortDirection,
  type Wire,
} from "@/lib/schematic-types";

// ── the port direction vocabulary is the CD-8 one (compile-time parity) ─────────────────────────────────────────────────────

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Compile-time proof that the editor's port directions are exactly CD-8's `HierarchicalPortDefinition["direction"]`. */
export const SHEET_PORT_DIRECTION_PARITY: Same<SheetPortDirection, HierarchicalPortDefinition["direction"]> = true;
export const SHEET_PORT_DIRECTIONS: readonly SheetPortDirection[] = Object.freeze(["input", "output", "bidirectional", "passive", "power_in", "power_out"]);

/** The measured hierarchy limits, equal to the CD-8 capability profile (app/lib/schematic-compiler/capability.ts `limits`
 *  maximumSheets / maximumHierarchyDepth; a test asserts the equality). Root depth is 0; a child of the root has depth 1. */
export const SHEET_LIMITS = Object.freeze({ maximumSheets: 512, maximumHierarchyDepth: 16 });

// ── diagnostics ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SheetDiagnosticCode =
  | "SHEET_SET_INVALID" | "SHEET_SET_TRIVIAL" | "SHEET_ROOT_CARDINALITY" | "SHEET_ID_DUPLICATE" | "SHEET_NAME_INVALID" | "SHEET_NAME_DUPLICATE"
  | "SHEET_PARENT_MISSING" | "SHEET_HIERARCHY_CYCLE" | "SHEET_DEPTH_LIMIT" | "SHEET_COUNT_LIMIT" | "SHEET_BLOCK_INVALID"
  | "SHEET_PORT_INVALID" | "SHEET_PORT_ON_ROOT" | "SHEET_PORT_ID_DUPLICATE" | "SHEET_PORT_NAME_DUPLICATE" | "SHEET_BUNDLE_UNSUPPORTED"
  | "SHEET_REPEATED_INSTANCE_UNSUPPORTED" | "SHEET_UNIT_SPLIT_UNSUPPORTED"
  | "SHEET_REFERENCE_INVALID" | "SHEET_REFERENCE_NONCANONICAL" | "SHEET_LABEL_SCOPE_INVALID" | "SHEET_PIN_PORT_MISSING"
  | "SHEET_PIN_PLACEMENT_INVALID" | "SHEET_BINDING_DUPLICATE" | "SHEET_PORT_UNBOUND" | "SHEET_PORT_UNANCHORED";

export type SheetDiagnosticSeverity = "error" | "warning";

export interface SheetDiagnostic {
  code: SheetDiagnosticCode;
  /** "error" refuses the document (the canonical validator, imports, sheet operations); "warning" is a reported finding. */
  severity: SheetDiagnosticSeverity;
  message: string;
  /** The sheet, port, label or entity ids involved (sorted, unique). */
  refs: string[];
}

const diagnostic = (code: SheetDiagnosticCode, severity: SheetDiagnosticSeverity, message: string, refs: readonly string[] = []): SheetDiagnostic =>
  ({ code, severity, message, refs: [...new Set(refs)].sort() });

// ── basic accessors ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A document is single-sheet exactly when it has no sheet tree (the canonical form; see `normalizeHierarchy`). */
export function isSingleSheet(state: Pick<SchematicState, "sheets">): boolean {
  return state.sheets === undefined;
}

/** The sheet an entity is drawn on: its `sheetId`, or the root when absent. */
export function sheetOf(entity: { sheetId?: string }): string {
  return entity.sheetId ?? ROOT_SHEET_ID;
}

/** The sheets of a document, the implicit root alone for a single-sheet one. */
export function sheetsOf(state: Pick<SchematicState, "sheets">): SchematicSheet[] {
  return state.sheets?.sheets ?? [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }];
}

/** "Power/Regulator" for a grandchild; "" for the root (its nets keep their plain names). Unknown or cyclic ids yield "". */
export function sheetPathName(state: Pick<SchematicState, "sheets">, sheetId: string): string {
  const byId = new Map(sheetsOf(state).map((sheet) => [sheet.id, sheet]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(sheetId);
  while (current && current.parentId !== null) {
    if (seen.has(current.id)) return "";
    seen.add(current.id);
    names.unshift(current.name.trim());
    current = byId.get(current.parentId);
  }
  return current ? names.join("/") : "";
}

/** Depth of a sheet below the root (root 0), or null for an unknown / cyclic chain. */
export function sheetDepth(state: Pick<SchematicState, "sheets">, sheetId: string): number | null {
  const byId = new Map(sheetsOf(state).map((sheet) => [sheet.id, sheet]));
  let depth = 0;
  let current = byId.get(sheetId);
  const seen = new Set<string>();
  while (current && current.parentId !== null) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    depth += 1;
    current = byId.get(current.parentId);
  }
  return current ? depth : null;
}

// ── canonical form ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const stripRoot = <T extends { sheetId?: string }>(entity: T): T => {
  if (entity.sheetId !== ROOT_SHEET_ID) return entity;
  const copy = { ...entity };
  delete copy.sheetId;
  return copy;
};

/**
 * The canonical form of a document (pure; the input is not changed): an explicit "root" `sheetId` is removed, an empty `ports` array
 * is removed, and a sheet tree with no child sheet is dropped together with every remaining `sheetId`, which turns the document back
 * into the single-sheet form (and its digest back into the pre-section-J digest). A canonical document is returned unchanged
 * (the same object).
 */
export function normalizeHierarchy(state: SchematicState): SchematicState {
  const hasChildSheet = (state.sheets?.sheets ?? []).some((sheet) => sheet.parentId !== null);
  const dropTree = state.sheets !== undefined && !hasChildSheet;
  const needsEntityPass = [...state.components, ...state.wires, ...(state.kicadComponents ?? []), ...(state.netLabels ?? [])]
    .some((entity) => entity.sheetId === ROOT_SHEET_ID || (dropTree && entity.sheetId !== undefined));
  const emptyPorts = (state.sheets?.sheets ?? []).some((sheet) => Array.isArray(sheet.ports) && sheet.ports.length === 0);
  if (!dropTree && !needsEntityPass && !emptyPorts) return state;
  const strip = <T extends { sheetId?: string }>(entity: T): T => {
    if (!dropTree) return stripRoot(entity);
    if (entity.sheetId === undefined) return entity;
    const copy = { ...entity };
    delete copy.sheetId;
    return copy;
  };
  const next: SchematicState = {
    ...state,
    components: state.components.map(strip),
    wires: state.wires.map(strip),
    ...(state.kicadComponents ? { kicadComponents: state.kicadComponents.map(strip) } : {}),
    ...(state.netLabels ? { netLabels: state.netLabels.map(strip) } : {}),
  };
  if (dropTree) delete next.sheets;
  else if (emptyPorts && next.sheets) {
    next.sheets = {
      ...next.sheets,
      sheets: next.sheets.sheets.map((sheet) => {
        if (!Array.isArray(sheet.ports) || sheet.ports.length > 0) return sheet;
        const copy = { ...sheet };
        delete copy.ports;
        return copy;
      }),
    };
  }
  return next;
}

// ── structural validation ───────────────────────────────────────────────────────────────────────────────────────────────────

const SHEET_SET_KEYS = new Set(["version", "sheets"]);
const SHEET_KEYS = new Set(["id", "name", "parentId", "block", "ports"]);
const PORT_KEYS = new Set(["id", "name", "direction"]);
/** Keys that would describe a repeated (reusable) sheet instance, refused until its own increment (OD-255 item 8). */
const REPEATED_INSTANCE_KEYS = new Set(["definitionId", "instanceOf", "repeatOf", "instances", "instanceName"]);
/** Keys that would describe a bus / bundle port, refused until its own increment. */
const BUNDLE_PORT_KEYS = new Set(["bundle", "bundleId", "member", "members", "busWidth"]);
/** Keys that would place one package's units on different sheets, refused until its own increment. */
const UNIT_SPLIT_KEYS = new Set(["unitPlacements", "unit", "units"]);

/** A KiCad bus vector ("DATA[0..7]") or bus group ("{SDA SCL}"): a bus name is never proof of a connection (J.4). */
export function isBusLikeName(name: string): boolean {
  return /\[\s*-?\d+\s*\.\.\s*-?\d+\s*\]/.test(name) || /\{[^}]*\}/.test(name);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function validateSheetSetShape(value: unknown, out: SheetDiagnostic[]): SchematicSheetSet | null {
  if (!isRecord(value)) { out.push(diagnostic("SHEET_SET_INVALID", "error", "The sheet tree must be an object { version: 1, sheets: [...] }.")); return null; }
  for (const key of Object.keys(value)) if (!SHEET_SET_KEYS.has(key)) out.push(diagnostic("SHEET_SET_INVALID", "error", `The sheet tree has an unknown field "${key}".`));
  if (value.version !== 1) out.push(diagnostic("SHEET_SET_INVALID", "error", `The sheet tree version must be 1 (found ${String(value.version)}).`));
  if (!Array.isArray(value.sheets)) { out.push(diagnostic("SHEET_SET_INVALID", "error", "The sheet tree has no sheets list.")); return null; }
  let shapeOk = true;
  value.sheets.forEach((raw, index) => {
    if (!isRecord(raw)) { out.push(diagnostic("SHEET_SET_INVALID", "error", `sheets[${index}] is not an object.`)); shapeOk = false; return; }
    const id = typeof raw.id === "string" ? raw.id : `sheets[${index}]`;
    for (const key of Object.keys(raw)) {
      if (SHEET_KEYS.has(key)) continue;
      if (REPEATED_INSTANCE_KEYS.has(key)) out.push(diagnostic("SHEET_REPEATED_INSTANCE_UNSUPPORTED", "error", `Sheet "${String(raw.name ?? id)}" declares "${key}": repeated (reusable) sheet instances are not supported yet; each sheet appears exactly once.`, [id]));
      else out.push(diagnostic("SHEET_SET_INVALID", "error", `Sheet "${String(raw.name ?? id)}" has an unknown field "${key}".`, [id]));
    }
    if (typeof raw.id !== "string" || raw.id.trim().length === 0 || raw.id !== raw.id.trim()) { out.push(diagnostic("SHEET_SET_INVALID", "error", `sheets[${index}] has no valid id.`)); shapeOk = false; }
    if (raw.parentId !== null && typeof raw.parentId !== "string") { out.push(diagnostic("SHEET_SET_INVALID", "error", `Sheet ${id} has an invalid parentId.`, [id])); shapeOk = false; }
    if (typeof raw.name !== "string" || raw.name.trim().length === 0 || raw.name !== raw.name.trim() || raw.name.includes("/") || raw.name.length > 120) {
      out.push(diagnostic("SHEET_NAME_INVALID", "error", `Sheet ${id} needs a trimmed, non-empty name of at most 120 characters without "/" (found ${JSON.stringify(raw.name)}).`, [id]));
    }
    if (raw.block !== undefined) {
      const block = raw.block;
      const blockKeysOk = isRecord(block) && Object.keys(block).every((key) => key === "x" || key === "y" || key === "width" || key === "height");
      const issues = isRecord(block) ? [...validateSchematicPoint({ x: block.x, y: block.y }, `${id}.block`), ...validateSchematicPoint({ x: block.width, y: block.height }, `${id}.block.size`)] : ["not an object"];
      if (!blockKeysOk || issues.length > 0 || !isRecord(block) || (block.width as number) <= 0 || (block.height as number) <= 0) {
        out.push(diagnostic("SHEET_BLOCK_INVALID", "error", `Sheet ${id}'s block must be { x, y, width, height } on the schematic grid with a positive size${issues.length ? ` (${issues[0]})` : ""}.`, [id]));
      }
    }
    if (raw.ports !== undefined) {
      if (!Array.isArray(raw.ports)) { out.push(diagnostic("SHEET_PORT_INVALID", "error", `Sheet ${id}'s ports must be a list.`, [id])); shapeOk = false; return; }
      if (raw.ports.length === 0) out.push(diagnostic("SHEET_SET_INVALID", "error", `Sheet ${id} has an empty ports list (the canonical form omits it).`, [id]));
      raw.ports.forEach((port, portIndex) => {
        if (!isRecord(port)) { out.push(diagnostic("SHEET_PORT_INVALID", "error", `Sheet ${id} ports[${portIndex}] is not an object.`, [id])); shapeOk = false; return; }
        const portId = typeof port.id === "string" ? port.id : `${id}.ports[${portIndex}]`;
        for (const key of Object.keys(port)) {
          if (PORT_KEYS.has(key)) continue;
          if (BUNDLE_PORT_KEYS.has(key)) out.push(diagnostic("SHEET_BUNDLE_UNSUPPORTED", "error", `Port ${String(port.name ?? portId)} declares "${key}": bus / bundle ports are not supported yet; connect each signal through its own scalar port.`, [id, portId]));
          else out.push(diagnostic("SHEET_PORT_INVALID", "error", `Port ${portId} has an unknown field "${key}".`, [id, portId]));
        }
        if (typeof port.id !== "string" || port.id.trim().length === 0 || port.id !== port.id.trim()) { out.push(diagnostic("SHEET_PORT_INVALID", "error", `Sheet ${id} ports[${portIndex}] has no valid id.`, [id])); shapeOk = false; }
        if (typeof port.name !== "string" || port.name.trim().length === 0 || port.name !== port.name.trim()) { out.push(diagnostic("SHEET_PORT_INVALID", "error", `Port ${portId} needs a trimmed, non-empty name.`, [id, portId])); shapeOk = false; }
        else if (isBusLikeName(port.name)) out.push(diagnostic("SHEET_BUNDLE_UNSUPPORTED", "error", `Port "${port.name}" on sheet ${id} is a bus name: bus / bundle ports are not supported yet; a name such as DATA[0..7] is not proof of a connection. Use one scalar port per signal.`, [id, portId]));
        if (!(SHEET_PORT_DIRECTIONS as readonly unknown[]).includes(port.direction)) out.push(diagnostic("SHEET_PORT_INVALID", "error", `Port ${portId} has an invalid direction ${JSON.stringify(port.direction)} (one of ${SHEET_PORT_DIRECTIONS.join(", ")}).`, [id, portId]));
      });
    }
  });
  return shapeOk ? (value as unknown as SchematicSheetSet) : null;
}

type AnyEntity = { id?: unknown; sheetId?: unknown };

function entityFamilies(state: SchematicState): Array<{ family: string; items: readonly AnyEntity[] }> {
  return [
    { family: "component", items: (Array.isArray(state.components) ? state.components : []) as readonly AnyEntity[] },
    { family: "kicad component", items: (Array.isArray(state.kicadComponents) ? state.kicadComponents : []) as readonly AnyEntity[] },
    { family: "wire", items: (Array.isArray(state.wires) ? state.wires : []) as readonly AnyEntity[] },
    { family: "label", items: (Array.isArray(state.netLabels) ? state.netLabels : []) as readonly AnyEntity[] },
  ];
}

/**
 * Every structural rule of the sheet contract, as named diagnostics (errors refuse the document; warnings are findings). Runs on a
 * single-sheet document too: there, any `sheetId`, any hierarchical / sheet-pin label and any port field is a dangling reference.
 * A "global" label is allowed in a single-sheet document (every label there joins by name anyway).
 */
export function validateSheetHierarchy(state: SchematicState): SheetDiagnostic[] {
  const out: SheetDiagnostic[] = [];
  const labels = (Array.isArray(state.netLabels) ? state.netLabels : []) as NetLabel[];

  if (state.sheets === undefined) {
    for (const { family, items } of entityFamilies(state)) {
      for (const item of items) {
        if (item.sheetId !== undefined) out.push(diagnostic("SHEET_REFERENCE_INVALID", "error", `The ${family} ${String(item.id)} is on sheet ${JSON.stringify(item.sheetId)}, but the document has no sheets.`, [String(item.id)]));
      }
    }
    for (const label of labels) validateLabelFields(label, null, out);
    return out;
  }

  const set = validateSheetSetShape(state.sheets, out);
  if (!set) return out;
  const sheets = set.sheets;
  const byId = new Map<string, SchematicSheet>();
  for (const sheet of sheets) {
    if (byId.has(sheet.id)) out.push(diagnostic("SHEET_ID_DUPLICATE", "error", `Two sheets share the id ${sheet.id}.`, [sheet.id]));
    else byId.set(sheet.id, sheet);
  }
  if (sheets.length > SHEET_LIMITS.maximumSheets) out.push(diagnostic("SHEET_COUNT_LIMIT", "error", `The project has ${sheets.length} sheets; the supported maximum is ${SHEET_LIMITS.maximumSheets} (the CD-8 capability limit). Merge some sheets.`));

  // the root: exactly one sheet without a parent, with the constant root id, listed first
  const roots = sheets.filter((sheet) => sheet.parentId === null);
  if (roots.length !== 1 || roots[0]!.id !== ROOT_SHEET_ID || sheets[0]?.id !== ROOT_SHEET_ID) {
    out.push(diagnostic("SHEET_ROOT_CARDINALITY", "error", `The sheet tree needs exactly one root sheet, with the id "${ROOT_SHEET_ID}", listed first (found ${roots.length} sheet(s) without a parent: ${roots.map((sheet) => sheet.id).join(", ") || "none"}).`, roots.map((sheet) => sheet.id)));
  }
  if (!sheets.some((sheet) => sheet.parentId !== null)) out.push(diagnostic("SHEET_SET_TRIVIAL", "error", "A sheet tree with only the root sheet is not stored: a single-sheet project has no sheets field (normalizeHierarchy)."));

  // parents, cycles, depth
  for (const sheet of sheets) {
    if (sheet.parentId === null) continue;
    if (sheet.parentId === sheet.id) { out.push(diagnostic("SHEET_HIERARCHY_CYCLE", "error", `Sheet "${sheet.name}" is its own parent.`, [sheet.id])); continue; }
    if (!byId.has(sheet.parentId)) { out.push(diagnostic("SHEET_PARENT_MISSING", "error", `Sheet "${sheet.name}" names a parent sheet ${sheet.parentId} that does not exist.`, [sheet.id, sheet.parentId])); continue; }
    const seen = new Set<string>([sheet.id]);
    let depth = 1;
    let current = byId.get(sheet.parentId);
    while (current && current.parentId !== null) {
      if (seen.has(current.id)) { out.push(diagnostic("SHEET_HIERARCHY_CYCLE", "error", `Sheet "${sheet.name}" is inside a parent cycle (${[...seen].join(" -> ")}).`, [...seen])); depth = -1; break; }
      seen.add(current.id);
      depth += 1;
      current = byId.get(current.parentId);
    }
    if (depth > SHEET_LIMITS.maximumHierarchyDepth) out.push(diagnostic("SHEET_DEPTH_LIMIT", "error", `Sheet "${sheet.name}" is ${depth} levels below the overview; the supported maximum is ${SHEET_LIMITS.maximumHierarchyDepth} (the CD-8 capability limit).`, [sheet.id]));
  }

  // sibling names
  const siblingNames = new Map<string, string>();
  for (const sheet of sheets) {
    const key = `${sheet.parentId ?? ""}\u0000${netLabelNameKey(sheet.name)}`;
    const prior = siblingNames.get(key);
    if (prior !== undefined) out.push(diagnostic("SHEET_NAME_DUPLICATE", "error", `Two sheets under the same parent are both named "${sheet.name}"; sibling sheet names must differ (they name the sheet's nets).`, [prior, sheet.id]));
    else siblingNames.set(key, sheet.id);
  }

  // ports: only on child sheets, unique ids project-wide, unique names per sheet
  const portSheet = new Map<string, string>();
  const portById = new Map<string, SheetPort>();
  for (const sheet of sheets) {
    const names = new Map<string, string>();
    for (const port of sheet.ports ?? []) {
      if (sheet.parentId === null) out.push(diagnostic("SHEET_PORT_ON_ROOT", "error", `Port "${port.name}" is on the root sheet; ports belong to child sheets (the overview connects them through sheet pins).`, [sheet.id, port.id]));
      if (portSheet.has(port.id)) out.push(diagnostic("SHEET_PORT_ID_DUPLICATE", "error", `Two ports share the id ${port.id}.`, [port.id]));
      else { portSheet.set(port.id, sheet.id); portById.set(port.id, port); }
      const key = netLabelNameKey(port.name);
      if (names.has(key)) out.push(diagnostic("SHEET_PORT_NAME_DUPLICATE", "error", `Sheet "${sheet.name}" has two ports named "${port.name}".`, [sheet.id, names.get(key)!, port.id]));
      else names.set(key, port.id);
    }
  }

  // entity references
  for (const { family, items } of entityFamilies(state)) {
    for (const item of items) {
      if (item.sheetId === undefined) continue;
      if (item.sheetId === ROOT_SHEET_ID) out.push(diagnostic("SHEET_REFERENCE_NONCANONICAL", "error", `The ${family} ${String(item.id)} stores sheetId "${ROOT_SHEET_ID}"; an entity on the root sheet carries no sheetId (normalizeHierarchy).`, [String(item.id)]));
      else if (typeof item.sheetId !== "string" || !byId.has(item.sheetId)) out.push(diagnostic("SHEET_REFERENCE_INVALID", "error", `The ${family} ${String(item.id)} is on sheet ${JSON.stringify(item.sheetId)}, which does not exist.`, [String(item.id)]));
    }
  }
  for (const instance of (Array.isArray(state.kicadComponents) ? state.kicadComponents : []) as KicadComponentInstance[]) {
    for (const key of Object.keys(instance)) {
      if (UNIT_SPLIT_KEYS.has(key)) out.push(diagnostic("SHEET_UNIT_SPLIT_UNSUPPORTED", "error", `${instance.refDes} declares "${key}": placing one package's units on different sheets is not supported yet; the whole package is drawn on one sheet.`, [instance.id]));
    }
  }

  // port-bound labels
  const pinsByPort = new Map<string, string[]>();
  const anchorsByPort = new Map<string, string[]>();
  for (const label of labels) {
    validateLabelFields(label, { byId, portSheet, portById }, out);
    if (typeof label.portId !== "string") continue;
    if (label.scope === "sheet-pin") pinsByPort.set(label.portId, [...(pinsByPort.get(label.portId) ?? []), label.id]);
    if (label.scope === "hierarchical") anchorsByPort.set(label.portId, [...(anchorsByPort.get(label.portId) ?? []), label.id]);
  }
  for (const [portId, pins] of pinsByPort) {
    if (pins.length > 1) out.push(diagnostic("SHEET_BINDING_DUPLICATE", "error", `Port "${portById.get(portId)?.name ?? portId}" has ${pins.length} sheet pins; a port is bound by exactly one sheet pin (repeated sheet instances are not supported yet).`, [portId, ...pins]));
  }
  for (const sheet of sheets) {
    for (const port of sheet.ports ?? []) {
      const parent = sheet.parentId === null ? undefined : byId.get(sheet.parentId);
      if (!pinsByPort.has(port.id)) out.push(diagnostic("SHEET_PORT_UNBOUND", "warning", `Port "${port.name}" of sheet "${sheet.name}" has no sheet pin on "${parent?.name ?? "its parent"}": it connects nothing outside its sheet.`, [sheet.id, port.id]));
      if (!anchorsByPort.has(port.id)) out.push(diagnostic("SHEET_PORT_UNANCHORED", "warning", `Port "${port.name}" of sheet "${sheet.name}" has no hierarchical label inside the sheet: it connects nothing on "${sheet.name}".`, [sheet.id, port.id]));
    }
  }
  return out;
}

function validateLabelFields(label: NetLabel, tree: { byId: Map<string, SchematicSheet>; portSheet: Map<string, string>; portById: Map<string, SheetPort> } | null, out: SheetDiagnostic[]): void {
  const id = String(label.id);
  const scope = label.scope;
  if (scope !== undefined && scope !== "global" && scope !== "hierarchical" && scope !== "sheet-pin") {
    out.push(diagnostic("SHEET_LABEL_SCOPE_INVALID", "error", `Label ${id} has an unknown scope ${JSON.stringify(scope)}.`, [id]));
    return;
  }
  if (scope !== undefined && label.kind !== "label") out.push(diagnostic("SHEET_LABEL_SCOPE_INVALID", "error", `Label ${id} is a ${label.kind} label with scope "${scope}"; power and ground labels are project rails by name and take no scope.`, [id]));
  const needsPort = scope === "hierarchical" || scope === "sheet-pin";
  if (!needsPort && label.portId !== undefined) out.push(diagnostic("SHEET_LABEL_SCOPE_INVALID", "error", `Label ${id} names a port but is not a hierarchical label or a sheet pin.`, [id]));
  if (scope !== "sheet-pin" && label.childSheetId !== undefined) out.push(diagnostic("SHEET_LABEL_SCOPE_INVALID", "error", `Label ${id} names a child sheet but is not a sheet pin.`, [id]));
  // [PR-J1 integration, 2026-10-22] review PC-7: power and ground labels join sheets by name exactly like global labels, so a bus name
  // on any of them is refused in a document with sheets (was: global labels only)
  if ((scope === "global" || label.kind === "power" || label.kind === "ground") && typeof label.name === "string" && isBusLikeName(label.name) && tree) out.push(diagnostic("SHEET_BUNDLE_UNSUPPORTED", "error", `${scope === "global" ? "Global" : label.kind === "power" ? "Power" : "Ground"} label "${label.name}" (a ${scope === "global" ? "global" : label.kind} label) is a bus name: buses are not supported yet and a bus name is not proof of a connection.`, [id]));
  if (!needsPort) return;
  if (tree === null) { out.push(diagnostic("SHEET_REFERENCE_INVALID", "error", `Label ${id} is a ${scope === "sheet-pin" ? "sheet pin" : "hierarchical label"}, but the document has no sheets.`, [id])); return; }
  if (typeof label.portId !== "string" || label.portId.length === 0) { out.push(diagnostic("SHEET_LABEL_SCOPE_INVALID", "error", `${scope === "sheet-pin" ? "Sheet pin" : "Hierarchical label"} ${id} names no port.`, [id])); return; }
  const portSheetId = tree.portSheet.get(label.portId);
  const port = tree.portById.get(label.portId);
  const labelSheet = sheetOf(label);
  if (portSheetId === undefined || !port) { out.push(diagnostic("SHEET_PIN_PORT_MISSING", "error", `${scope === "sheet-pin" ? "Sheet pin" : "Hierarchical label"} "${label.name}" (${id}) names port ${label.portId}, which does not exist.`, [id, label.portId])); return; }
  if (netLabelNameKey(label.name) !== netLabelNameKey(port.name)) out.push(diagnostic("SHEET_LABEL_SCOPE_INVALID", "error", `${scope === "sheet-pin" ? "Sheet pin" : "Hierarchical label"} ${id} shows "${label.name}" but its port is named "${port.name}".`, [id, label.portId]));
  if (scope === "hierarchical") {
    if (labelSheet !== portSheetId) out.push(diagnostic("SHEET_PIN_PORT_MISSING", "error", `Hierarchical label "${label.name}" (${id}) is on sheet ${labelSheet}, but its port belongs to sheet ${portSheetId}.`, [id, label.portId]));
    return;
  }
  if (typeof label.childSheetId !== "string" || label.childSheetId !== portSheetId) {
    out.push(diagnostic("SHEET_PIN_PORT_MISSING", "error", `Sheet pin "${label.name}" (${id}) names child sheet ${JSON.stringify(label.childSheetId)}, but its port belongs to sheet ${portSheetId}.`, [id, label.portId]));
    return;
  }
  const child = tree.byId.get(portSheetId);
  if (!child || child.parentId !== labelSheet) out.push(diagnostic("SHEET_PIN_PLACEMENT_INVALID", "error", `Sheet pin "${label.name}" (${id}) is on sheet ${labelSheet}, but sheet "${child?.name ?? portSheetId}" is a child of ${child?.parentId ?? "nothing"}: a sheet pin sits on the child's parent sheet.`, [id, label.portId, portSheetId]));
}

/** The error diagnostics only. */
export function sheetErrors(diagnostics: readonly SheetDiagnostic[]): SheetDiagnostic[] {
  return diagnostics.filter((item) => item.severity === "error");
}

// ── the branded sheet lens ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The non-enumerable brand every lens and every lens array carries (JSON and structuredClone drop it; whole-project consumers check it). */
export const SHEET_LENS_BRAND: unique symbol = Symbol.for("sirkit.schematic.sheet-lens");

/** A readonly lens array: not assignable to a `SchematicState` field (which is mutable). */
export type SheetLensArray<T> = readonly T[] & { readonly [SHEET_LENS_BRAND]: string };

/** One sheet's entities, read-only. NOT a `SchematicState`: feeding it to a whole-project consumer fails to compile, and the lens or
 *  a state holding its own arrays is refused at run time by `assertWholeProject`. [PR-J1 integration, 2026-10-22] review PC-3: a COPY
 *  of a lens array (spread, filter, map, slice, JSON, structuredClone) carries no brand and is not detected at run time. */
export interface SheetLens {
  readonly [SHEET_LENS_BRAND]: string;
  readonly sheetId: string;
  readonly components: SheetLensArray<SchComponent>;
  readonly wires: SheetLensArray<Wire>;
  readonly kicadComponents: SheetLensArray<KicadComponentInstance>;
  readonly netLabels: SheetLensArray<NetLabel>;
}

function brandedArray<T>(items: readonly T[], sheetId: string): SheetLensArray<T> {
  const array = [...items];
  Object.defineProperty(array, SHEET_LENS_BRAND, { value: sheetId, enumerable: false });
  return Object.freeze(array) as unknown as SheetLensArray<T>;
}

/** The entities drawn on `sheetId` (state order preserved). Throws SHEET_NOT_FOUND for an unknown sheet. */
export function sheetLens(state: SchematicState, sheetId: string): SheetLens {
  if (!sheetsOf(state).some((sheet) => sheet.id === sheetId)) throw new Error(`SHEET_NOT_FOUND:${sheetId}`);
  const on = <T extends { sheetId?: string }>(items: readonly T[] | undefined): SheetLensArray<T> => brandedArray((items ?? []).filter((item) => sheetOf(item) === sheetId), sheetId);
  const lens = {
    sheetId,
    components: on(state.components),
    wires: on(state.wires),
    kicadComponents: on(state.kicadComponents),
    netLabels: on(state.netLabels),
  };
  Object.defineProperty(lens, SHEET_LENS_BRAND, { value: sheetId, enumerable: false });
  return Object.freeze(lens) as SheetLens;
}

/** True for a lens, or for any object one of whose entity arrays came from a lens. */
export function carriesSheetLens(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (SHEET_LENS_BRAND in value) return true;
  return ["components", "wires", "kicadComponents", "netLabels"].some((key) => {
    const field = value[key];
    return Array.isArray(field) && SHEET_LENS_BRAND in field;
  });
}

/** Whole-project consumers call this first: one sheet is never the project (SHEET_LENS_NOT_PROJECT). */
export function assertWholeProject(value: unknown, consumer: string): void {
  if (carriesSheetLens(value)) throw new Error(`SHEET_LENS_NOT_PROJECT:${consumer}: a whole-project consumer was handed one sheet's view; pass the complete schematic`);
}
