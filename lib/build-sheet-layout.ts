/**
 * [PR-J5, 2026-10-23] Runbook section J increment 5 (J.6.2-J.6.3; OD-255 item 9; OD-259 items 1, 3, 5): a PLANNED generation result
 * laid out as REAL sheets. The result carries its flat netlist (the one electrical truth) and, beside it, the sheet set the merge derived
 * from the planner's blocks (`sirkit.generation-sheets.v1`, app/lib/schematic/generated-sheets.ts). This module turns the two into ONE
 * multi-sheet `SchematicState` the page offers through its existing review dialog and applies as one undoable replace:
 *
 *  - per DESIGNED child sheet, the block's netlist is rebuilt from the flat netlist by reference-designator membership (the J5-1 judge
 *    proves the children partition the netlist's references exactly) and laid out by the EXISTING `autoLayoutBuildValidated` - the
 *    same drawing and the same drawing validation a one-page result gets - then stamped with the sheet; every label of a port's net
 *    inside the block becomes the port's HIERARCHICAL label (ports connect by identity, lib/schematic-types.ts `NetLabelScope`), power
 *    and ground labels stay as drawn (project rails by exact name, OD-255 item 2), every other label stays local to its sheet;
 *  - the overview (the root sheet, "System overview"): one block per child in plan order (the J3 lens's free-slot rule, sized for the
 *    ports), one sheet pin per port on the block's edge (the J3 lens's anchor rule: inputs on the left edge, the rest on the right) and,
 *    at each sheet-pin point, a plain LOCAL label named after the interface (OD-259 item 3): same-named local labels join on the
 *    overview, each sheet pin joins its port, so an interface is one net across its sheets - readable, and one authority rule;
 *  - an OMITTED child (a planned block that was not designed, J.6.3) is an empty sheet with its declared ports and its block and pins on
 *    the overview: a visible incomplete requirement, never a dropped subsystem (its ports stay unanchored - a reported warning).
 *
 * The proof, never two truths: the laid-out document must be a valid hierarchy, its project connectivity (the ONE authority,
 * app/lib/schematic/project-connectivity.ts) must carry no error, and the pin-to-net partition it draws must equal the flat netlist's
 * (every catalog pin, by reference and pad), with every bound interface's net carrying exactly the flat label group's pins. Otherwise
 * the layout is NOT offered: `{ kind: "flat", finding }` and the page keeps today's one-page path with the finding beside the proposal
 * (the conservative rule of generated-sheets.ts).
 *
 * The drawing check the page shows is the WHOLE sheeted drawing validated against the flat netlist (`validateSchematicNetlist`, which
 * reads the project connectivity: a pin labelled with an interface reaches the other sheets through its port), not the blocks' own
 * checks merged - alone, a block reports every interface pin as floating (its one label has no partner on that sheet). The label
 * anchoring is the blocks' own (the converted labels keep their positions; the overview's labels sit on their sheet pins, whose
 * placement on the block edge the hierarchy check proves).
 *
 * Ids: structural ids (sheets, ports, hierarchical labels, sheet pins, overview labels) derive from the caller's `seed` (the task's
 * result digest) - no random draw; the per-block layouts mint their component / wire / label ids as `autoLayoutBuild` always has.
 * Component authority is untouched: each block adopts `publishedAtomicIdentity` through the existing layout (J.5: hierarchical
 * organisation is not permission to invent parts). Pure: no I/O, no clock, no React.
 */

import type { CachedPart } from "@/app/lib/parts-cache";
import type { GeneratedChildSheet, GeneratedPortDirection, GeneratedSheetKey, GeneratedSheetSet } from "@/app/lib/schematic/generated-sheets";
import { resolveProjectConnectivity, type PartPinsLookup } from "@/app/lib/schematic/project-connectivity";
import { DEFAULT_BLOCK_SIZE, freeBlockSlot, portAnchorSlots } from "@/app/lib/schematic/sheet-lens";
import { sheetErrors, validateSheetHierarchy } from "@/app/lib/schematic/sheets";
import { autoLayoutBuildValidated } from "./build-auto-layout";
import { planPageFit } from "./page-sizes";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES_MM,
  ROOT_SHEET_ID,
  isLabelConnection,
  netLabelNameKey,
  type BuildLogicalNetlist,
  type NetLabel,
  type PageSize,
  type SchematicSheet,
  type SchematicState,
  type SheetPort,
  type SheetPortDirection,
} from "./schematic-types";
import { validateSchematicNetlist, type NetlistValidation } from "./validate-netlist";

export type { GeneratedSheets, GeneratedSheetSet } from "@/app/lib/schematic/generated-sheets";

/** One laid-out sheet, for the review dialog and the activity log. */
export interface GeneratedSheetLayoutSheet {
  sheetId: string;
  sheetKey: GeneratedSheetKey;
  name: string;
  status: "designed" | "omitted";
  /** catalog parts drawn on the sheet (0 for an omitted one) */
  components: number;
  /** the sheet's port names (its interfaces), in the sheet set's order */
  ports: string[];
}

export type GeneratedSheetLayout =
  | {
    kind: "sheets";
    state: SchematicState;
    /** the whole sheeted drawing checked against the flat netlist (the blocks' own label-anchoring findings included) */
    validation: NetlistValidation;
    findings: string[];
    sheets: GeneratedSheetLayoutSheet[];
    /** the bound interfaces, by net name */
    interfaces: string[];
  }
  | { kind: "flat"; kept: "flat"; finding: string };

export interface LayoutGeneratedSheetsOptions {
  /** The deterministic seed of every structural id (the task's result digest); never a random draw. */
  seed: string;
}

const KEPT = "Kept on one page:";
const LITERAL_GROUND = "GND";
const PIN_STEP = 20;

// ─── ids ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The seed's stable fragment inside every structural id: its digest body (the `eng1-` prefix dropped), at most 12 characters. */
export function generatedSheetSeedKey(seed: string): string {
  const body = seed.replace(/^[a-z0-9]+-/, "").replace(/[^A-Za-z0-9]/g, "");
  return (body.length > 0 ? body : seed.replace(/[^A-Za-z0-9]/g, "") || "seed").slice(0, 12);
}
export const generatedSheetId = (seed: string, sheetKey: GeneratedSheetKey): string => `gen-${generatedSheetSeedKey(seed)}-${sheetKey}`;
export const generatedPortId = (sheetId: string, net: string): string => `${sheetId}:port:${net}`;
export const generatedSheetPinId = (portId: string): string => `${portId}:pin`;
export const generatedOverviewLabelId = (portId: string): string => `${portId}:net`;
export const generatedHierarchicalLabelId = (portId: string, ordinal: number): string => `${portId}:label:${ordinal}`;

/** The editor's port directions for the generated set's (KiCad-shaped) directions: tri-state is bidirectional; unknown is passive. */
export function sheetPortDirectionOf(direction: GeneratedPortDirection): SheetPortDirection {
  switch (direction) {
    case "input": return "input";
    case "output": return "output";
    case "bidirectional": return "bidirectional";
    case "tri_state": return "bidirectional";
    default: return "passive";
  }
}

// ─── the flat netlist's pin partition (the truth the drawing must reproduce) ──────────────────────────────────────────────────

class Partition {
  private readonly parent = new Map<string, string>();
  find(node: string): string {
    let root = this.parent.get(node);
    if (root === undefined) { this.parent.set(node, node); return node; }
    while (root !== node) { node = root; root = this.parent.get(node) ?? node; }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  /** The groups of pin nodes with two or more members, each sorted, as one canonical string per group. */
  groups(): Map<string, string[]> {
    const members = new Map<string, string[]>();
    for (const node of this.parent.keys()) {
      if (!node.startsWith("P:")) continue;
      const root = this.find(node);
      members.set(root, [...(members.get(root) ?? []), node.slice(2)]);
    }
    const out = new Map<string, string[]>();
    for (const [root, pins] of members) if (pins.length >= 2) out.set(root, pins.sort());
    return out;
  }
  /** The pin members of the group that holds `node`, sorted (empty when none). */
  groupOf(node: string): string[] {
    if (!this.parent.has(node)) return [];
    const root = this.find(node);
    const pins: string[] = [];
    for (const candidate of this.parent.keys()) if (candidate.startsWith("P:") && this.find(candidate) === root) pins.push(candidate.slice(2));
    return pins.sort();
  }
}

const isLiteralGround = (endpoint: string): boolean => endpoint.trim().toUpperCase() === LITERAL_GROUND;
const refOf = (endpoint: string): string => { const trimmed = endpoint.trim(); const dot = trimmed.indexOf("."); return dot < 0 ? trimmed : trimmed.slice(0, dot); };

/** A netlist endpoint as the drawing names its pin: `REF#padNumber` (the catalog pin by number or name), else `REF.token`. */
function pinKeyOf(endpoint: string, partOf: (refDes: string) => CachedPart | undefined): string {
  const trimmed = endpoint.trim();
  const dot = trimmed.indexOf(".");
  const refDes = dot < 0 ? trimmed : trimmed.slice(0, dot);
  const token = dot < 0 ? "" : trimmed.slice(dot + 1).trim();
  const lower = token.toLowerCase();
  const pin = token ? partOf(refDes)?.pins.find((candidate) => candidate.number.toLowerCase() === lower || candidate.name.toLowerCase() === lower) : undefined;
  return pin ? `${refDes}#${pin.number}` : `${refDes}.${token}`;
}

function flatPartition(netlist: BuildLogicalNetlist, parts: ReadonlyMap<string, CachedPart>): Partition {
  const partIdByRef = new Map(netlist.components.map((component) => [component.refDes, component.partId] as const));
  const partOf = (refDes: string): CachedPart | undefined => { const partId = partIdByRef.get(refDes); return partId === undefined ? undefined : parts.get(partId); };
  const partition = new Partition();
  const netNode = (name: string): string => `N:${netLabelNameKey(name)}`;
  for (const connection of netlist.connections) {
    if (isLabelConnection(connection)) {
      const pin = `P:${pinKeyOf(connection.pin, partOf)}`;
      partition.find(pin);
      const key = netLabelNameKey(connection.labelName);
      if (key) partition.union(pin, netNode(key));
      continue;
    }
    const from = isLiteralGround(connection.from) ? netNode(LITERAL_GROUND) : `P:${pinKeyOf(connection.from, partOf)}`;
    const to = isLiteralGround(connection.to) ? netNode(LITERAL_GROUND) : `P:${pinKeyOf(connection.to, partOf)}`;
    partition.union(from, to);
  }
  return partition;
}

// ─── the block netlists ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A designed child's netlist from the flat one: its components, and every connection whose endpoints are all its pins (or the literal GND). */
export function blockNetlistOf(flat: BuildLogicalNetlist, child: Pick<GeneratedChildSheet, "components">): BuildLogicalNetlist {
  const refs = new Set(child.components);
  const inBlock = (endpoint: string): boolean => isLiteralGround(endpoint) || refs.has(refOf(endpoint));
  return {
    components: flat.components.filter((component) => refs.has(component.refDes)),
    connections: flat.connections.filter((connection) => (isLabelConnection(connection) ? refs.has(refOf(connection.pin)) : inBlock(connection.from) && inBlock(connection.to))),
    explanation: flat.explanation,
  };
}

// ─── the page size ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const pageArea = (size: PageSize): number => PAGE_SIZES_MM[size].widthMm * PAGE_SIZES_MM[size].heightMm;
function largestPage(sizes: readonly PageSize[]): PageSize {
  let best: PageSize = DEFAULT_PAGE_SIZE;
  for (const size of sizes) if (pageArea(size) > pageArea(best)) best = size;
  return best;
}

// ─── the layout ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lay the planned result out as sheets (see the module header), or keep it flat with the reason. `parts` holds every catalog part the
 * netlist references (the page loads them before any layout); `seed` is the task's result digest.
 */
export function layoutGeneratedSheets(netlist: BuildLogicalNetlist, set: GeneratedSheetSet, parts: ReadonlyMap<string, CachedPart>, options: LayoutGeneratedSheetsOptions): GeneratedSheetLayout {
  const flat = (finding: string): GeneratedSheetLayout => ({ kind: "flat", kept: "flat", finding: `${KEPT} ${finding}` });
  const designed = set.children.filter((child) => child.status === "designed");
  if (designed.length === 0) return flat("no planned sheet was designed.");

  // the children partition the references exactly (the J5-1 judge's rule, re-checked here before any layout)
  const flatRefs = netlist.components.map((component) => component.refDes);
  const sheetRefs = designed.flatMap((child) => child.components);
  if (flatRefs.length !== sheetRefs.length || new Set(sheetRefs).size !== sheetRefs.length || flatRefs.some((ref) => !sheetRefs.includes(ref))) return flat("the sheets do not hold exactly the design's parts, each once.");
  const blockNetlists = designed.map((child) => ({ child, netlist: blockNetlistOf(netlist, child) }));
  const blockConnections = blockNetlists.reduce((sum, block) => sum + block.netlist.connections.length, 0);
  if (blockConnections !== netlist.connections.length) return flat(`${netlist.connections.length - blockConnections} connection(s) cross sheets without a declared interface.`);

  const seed = options.seed;
  const rootName = set.root.name;
  const sheets: SchematicSheet[] = [{ id: ROOT_SHEET_ID, name: rootName, parentId: null }];
  const portIdByKey = new Map<string, string>();
  const components: SchematicState["components"] = [];
  const wires: SchematicState["wires"] = [];
  const kicadComponents: NonNullable<SchematicState["kicadComponents"]> = [];
  const netLabels: NetLabel[] = [];
  const validations: NetlistValidation[] = [];
  const pageSizes: PageSize[] = [];
  const laidSheets: GeneratedSheetLayoutSheet[] = [];

  // 1. every child sheet: its ports (both statuses), its drawing (designed), its port labels as hierarchical labels
  for (const child of set.children) {
    const sheetId = generatedSheetId(seed, child.sheetKey);
    const ports: SheetPort[] = child.ports.map((port) => {
      const id = generatedPortId(sheetId, port.net);
      portIdByKey.set(port.portKey, id);
      return { id, name: port.net, direction: sheetPortDirectionOf(port.direction) };
    });
    sheets.push({ id: sheetId, name: child.name, parentId: ROOT_SHEET_ID, ...(ports.length > 0 ? { ports } : {}) });
    const block = blockNetlists.find((entry) => entry.child === child);
    if (!block) { laidSheets.push({ sheetId, sheetKey: child.sheetKey, name: child.name, status: "omitted", components: 0, ports: ports.map((port) => port.name) }); continue; }
    const built = autoLayoutBuildValidated(block.netlist, parts as Map<string, CachedPart>);
    validations.push(built.validation);
    if (built.state.pageSize) pageSizes.push(built.state.pageSize);
    for (const item of built.state.components) components.push({ ...item, sheetId });
    for (const item of built.state.wires) wires.push({ ...item, sheetId });
    for (const item of built.state.kicadComponents ?? []) kicadComponents.push({ ...item, sheetId });
    const ordinals = new Map<string, number>();
    for (const label of built.state.netLabels ?? []) {
      const port = label.kind === "label" ? ports.find((candidate) => netLabelNameKey(candidate.name) === netLabelNameKey(label.name)) : undefined;
      if (!port) { netLabels.push({ ...label, sheetId }); continue; }
      const ordinal = (ordinals.get(port.id) ?? 0) + 1;
      ordinals.set(port.id, ordinal);
      netLabels.push({ ...label, id: generatedHierarchicalLabelId(port.id, ordinal), name: port.name, kind: "label", sheetId, scope: "hierarchical", portId: port.id });
    }
    laidSheets.push({ sheetId, sheetKey: child.sheetKey, name: child.name, status: "designed", components: (built.state.kicadComponents ?? []).length, ports: ports.map((port) => port.name) });
  }

  // 2. the overview: the blocks first (the J3 free-slot rule over blocks alone, so the cells stay consecutive), then the pins and labels
  let state: SchematicState = { components, wires, kicadComponents, netLabels, pageSize: DEFAULT_PAGE_SIZE, sheets: { version: 1, sheets } };
  for (const sheet of sheets) {
    if (sheet.parentId === null) continue;
    const ports = sheet.ports ?? [];
    const inbound = ports.filter((port) => port.direction === "input" || port.direction === "power_in").length;
    const side = Math.max(inbound, ports.length - inbound);
    const height = Math.max(DEFAULT_BLOCK_SIZE.height, Math.ceil((40 + PIN_STEP * side) / PIN_STEP) * PIN_STEP);
    const slot = freeBlockSlot({ ...state, sheets: { version: 1, sheets: state.sheets!.sheets.filter((item) => item.parentId === null || item.block !== undefined) } }, ROOT_SHEET_ID, { width: DEFAULT_BLOCK_SIZE.width, height }); // [PR-J5 integration, 2026-10-26] review B-4: over the root and the blocks ALREADY placed only (a blockless sibling's default cell is not taken), so the blocks run left to right in plan order from the first cell
    // the placed blocks carry into the next slot search through the state's tree (never a mutation of the input list)
    state = { ...state, sheets: { version: 1, sheets: state.sheets!.sheets.map((item) => (item.id === sheet.id ? { ...item, block: slot } : item)) } };
  }
  for (const sheet of state.sheets!.sheets) {
    if (sheet.parentId === null) continue;
    for (const port of sheet.ports ?? []) {
      const slots = portAnchorSlots(state, sheet, port.direction);
      const pin: NetLabel = { id: generatedSheetPinId(port.id), position: slots.pin, name: port.name, kind: "label", orientation: 0, scope: "sheet-pin", portId: port.id, childSheetId: sheet.id };
      const local: NetLabel = { id: generatedOverviewLabelId(port.id), position: slots.pin, name: port.name, kind: "label", orientation: 0 };
      state = { ...state, netLabels: [...(state.netLabels ?? []), pin, local] };
    }
  }
  // the page size: the largest a block needed, or what the overview's blocks need
  const blocks = state.sheets!.sheets.flatMap((sheet) => (sheet.block ? [sheet.block] : []));
  const overviewFit = planPageFit({ minX: 0, minY: 0, maxX: Math.max(...blocks.map((block) => block.x + block.width), 0) + 100, maxY: Math.max(...blocks.map((block) => block.y + block.height), 0) + 100 });
  state = { ...state, pageSize: largestPage([...pageSizes, overviewFit.pageSize]) };

  // 3. the proof
  const hierarchy = sheetErrors(validateSheetHierarchy(state));
  if (hierarchy.length > 0) return flat(`the sheet layout is not a valid hierarchy (${[...new Set(hierarchy.map((item) => item.code))].join(", ")}).`);
  const lookup: PartPinsLookup = (partId) => { const part = parts.get(partId); return part ? { pins: part.pins } : null; };
  const conn = resolveProjectConnectivity(state, lookup);
  if (!conn.ok) return flat(`the sheeted drawing has connectivity errors (${[...new Set(conn.diagnostics.filter((item) => item.severity === "error").map((item) => item.code))].join(", ")}).`);
  if (conn.unresolvedPartIds.length > 0) return flat(`the pins of ${conn.unresolvedPartIds.length} part(s) are not loaded, so the sheeted connections cannot be proven.`);
  const refOfId = new Map(kicadComponents.map((item) => [item.id, item.refDes] as const));
  const drawnPins = (net: (typeof conn.nets)[number]): string[] => net.pins.filter((pin) => pin.family === "kicad").map((pin) => `${refOfId.get(pin.componentId) ?? pin.componentId}#${pin.pinId}`).sort();
  const drawnGroups = new Set(conn.nets.map(drawnPins).filter((pins) => pins.length >= 2).map((pins) => pins.join(",")));
  const truth = flatPartition(netlist, parts);
  const flatGroups = new Set([...truth.groups().values()].map((pins) => pins.join(",")));
  if (drawnGroups.size !== flatGroups.size || [...flatGroups].some((group) => !drawnGroups.has(group))) {
    const differ = [...flatGroups].filter((group) => !drawnGroups.has(group)).length + [...drawnGroups].filter((group) => !flatGroups.has(group)).length;
    return flat(`the sheeted drawing connects pins differently from the design (${differ} net group(s) differ).`);
  }
  const interfaces: string[] = [];
  for (const entry of set.interfaces) {
    if (entry.state !== "bound") continue;
    const portIds = new Set(entry.ports.map((key) => portIdByKey.get(key)).filter((id): id is string => id !== undefined));
    const nets = conn.nets.filter((net) => net.portIds.some((id) => portIds.has(id)));
    if (nets.length !== 1) return flat(`interface ${entry.net} is drawn as ${nets.length} nets instead of one.`);
    const expected = truth.groupOf(`N:${netLabelNameKey(entry.net)}`).join(",");
    if (drawnPins(nets[0]!).join(",") !== expected) return flat(`interface ${entry.net} does not reach exactly the design's pins.`);
    interfaces.push(entry.net);
  }
  // the drawing check: the whole sheeted drawing against the flat netlist, with the blocks' own label anchoring (see the header)
  const whole = validateSchematicNetlist(netlist, state, parts as Map<string, CachedPart>);
  const violations = [...whole.violations.filter((item) => item.kind !== "unanchored-label"), ...validations.flatMap((item) => item.violations.filter((violation) => violation.kind === "unanchored-label"))];
  return {
    kind: "sheets",
    state,
    validation: { ok: violations.length === 0, violations },
    findings: [],
    sheets: laidSheets,
    interfaces,
  };
}
