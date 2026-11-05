/**
 * [PR-J, 2026-10-22] Runbook J.6.2-J.6.3, increment J5-1 (OD-255 items 2 and 9): a PLANNED generation result as subsystem SHEETS - the
 * sheet set a durable generation's merge derives from the planner's blocks (`sirkit.generation-sheets.v1`), carried on the result BESIDE
 * its one flat netlist, never inside it. The flat netlist stays the one electrical truth every consumer reads (ERC, layout, PCB); the
 * sheet set is its organisation, and exists only when it provably connects exactly the same pins.
 *
 * Pure and browser-safe: no repository, provider, clock, catalog read or id draw. Sheet and port keys derive from the plan's block ids
 * (b1..b8; the root is "overview"), so the page's id sequence and the fixture router replay cannot move.
 *
 * The connection policy (OD-255 item 2; runbook J.4), ONE rule:
 *  - inside a block, labels join by name (`netLabelNameKey`: trimmed, case-insensitive - the editor's own label identity);
 *  - a power or ground label (its explicit `labelKind`, else `inferNetLabelKind`) is a PROJECT RAIL by its exact name: AGND, DGND and
 *    GND are three rails, never merged by look-alike (KiCad power-symbol semantics); the literal "GND" wire endpoint is the GND rail;
 *  - a signal label crosses blocks only as a hierarchical PORT, and only when its name is one of the plan's shared nets;
 *  - every other label is LOCAL to its sheet.
 * The conservative rule (OD-255 item 9): the flat merge joins every same-name label board-wide (merge-netlists.ts), so an undeclared
 * signal label used in two or more blocks would be one connection on the flat page and two on sheets. Such a result keeps the flat page
 * (`sheets: null`) with a finding naming the label and the blocks - never two truths. A second, independent check proves the rest: the
 * pin-to-net partition of the flat merge and of the sheet-scoped model must be identical, or the result stays flat.
 *
 * A planned block that was not designed stays a visible "omitted" sheet whose declared ports are unbound (J.6.3): an omitted subsystem
 * is never dropped. Reaching a bound (`GENERATED_SHEETS_BOUNDS`) is a refusal finding, never a silent cut. A single design (fewer than
 * two planned blocks) is one page: no sheets and no finding.
 */
import { inferNetLabelKind, isLabelConnection, netLabelNameKey, type BuildLogicalNetlist } from "@/lib/schematic-types";

export const GENERATION_SHEETS_SCHEMA = "sirkit.generation-sheets.v1" as const;
/** The bounds of a sheet set: the task's 8 planned blocks and 16 shared nets per block, its 512 components, and display bounds. */
export const GENERATED_SHEETS_BOUNDS = Object.freeze({
  sheets: 8,
  portsPerSheet: 16,
  components: 512,
  localNetsPerSheet: 256,
  rails: 32,
  interfaces: 128,
  findings: 20,
  findingChars: 200,
  sheetNameChars: 120,
  netChars: 128,
  refDesChars: 32,
});
export const GENERATED_OVERVIEW_SHEET = Object.freeze({ sheetKey: "overview", name: "System overview" } as const);
/** A child sheet's key is its planned block's id. */
export const GENERATED_SHEET_KEYS = Object.freeze(["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"] as const);
export type GeneratedSheetKey = (typeof GENERATED_SHEET_KEYS)[number];
/** KiCad's hierarchical-label shapes, read from the catalog pin types; `unspecified` when the pins' types are not known. */
export const GENERATED_PORT_DIRECTIONS = Object.freeze(["input", "output", "bidirectional", "tri_state", "passive", "unspecified"] as const);
export type GeneratedPortDirection = (typeof GENERATED_PORT_DIRECTIONS)[number];
export type GeneratedRailKind = "power" | "ground";
/** An interface is bound when at least two DESIGNED sheets carry its net; a port is bound when its interface is and its own sheet carries the net. */
export type GeneratedBinding = "bound" | "unbound";

export interface GeneratedSheetPort { portKey: string; net: string; direction: GeneratedPortDirection; state: GeneratedBinding }
export interface GeneratedSheetRail { net: string; kind: GeneratedRailKind }
export interface GeneratedChildSheet {
  sheetKey: GeneratedSheetKey;
  name: string;
  status: "designed" | "omitted";
  /** the final (merged) reference designators of the block's components, in netlist order; none for an omitted block */
  components: string[];
  ports: GeneratedSheetPort[];
  rails: GeneratedSheetRail[];
  /** the sheet's local label names (they connect only on this sheet) */
  localNets: string[];
}
export interface GeneratedInterface { net: string; ports: string[]; state: GeneratedBinding }
export interface GeneratedRail { net: string; kind: GeneratedRailKind; sheets: GeneratedSheetKey[] }
export interface GeneratedSheetSet {
  root: { sheetKey: "overview"; name: "System overview" };
  children: GeneratedChildSheet[];
  interfaces: GeneratedInterface[];
  rails: GeneratedRail[];
}
/** The derivation and the result's optional `sheets` field: the sheet set, or null (one page) with the findings saying why. */
export interface GeneratedSheets { schema: typeof GENERATION_SHEETS_SCHEMA; sheets: GeneratedSheetSet | null; findings: string[] }

export interface GeneratedSheetsPlannedBlock { blockId: string; name: string; sharedNets: readonly string[]; status: "designed" | "omitted" }
/** A designed block's netlist with its FINAL reference designators (merge-netlists.ts `blocks`), in plan order. */
export interface GeneratedSheetsDesignedBlock { blockId: string; name: string; netlist: BuildLogicalNetlist }
/** A catalog part as far as port directions need it (parts-search.ts `AiPartResult` satisfies it). */
export interface PinTypedPart { partId: string; pins: ReadonlyArray<{ number: string; name: string; type?: string }> }
export interface DeriveGeneratedSheetsInput {
  /** every planned block in plan order, designed or omitted */
  planned: readonly GeneratedSheetsPlannedBlock[];
  /** the designed blocks in plan order, each with its final refDes */
  designed: readonly GeneratedSheetsDesignedBlock[];
  /** the merged netlist (the one truth the sheet set must reproduce) */
  flat: BuildLogicalNetlist;
  /** the catalog parts of the merged design (port directions), or null when the catalog read did not run */
  parts: readonly PinTypedPart[] | null;
}

const B = GENERATED_SHEETS_BOUNDS;
const isSheetKey = (value: unknown): value is GeneratedSheetKey => typeof value === "string" && (GENERATED_SHEET_KEYS as readonly string[]).includes(value);
const LITERAL_GROUND = "GND";

/** At most `findings` findings, each at most `findingChars` characters; a longer list ends with a count, never a silent cut. */
function boundedFindings(findings: readonly string[]): string[] {
  const lines = findings.map((finding) => finding.slice(0, B.findingChars));
  if (lines.length <= B.findings) return lines;
  return [...lines.slice(0, B.findings - 1), `... and ${lines.length - (B.findings - 1)} more finding(s).`];
}
function onePage(findings: readonly string[]): GeneratedSheets {
  return { schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: boundedFindings(findings) };
}

type PartOf = (refDes: string) => PinTypedPart | undefined;
/** The catalog pin a "REF.pin" endpoint names (by pin number or name, as the electrical check reads it), or undefined. */
function pinOf(endpoint: string, partOf: PartOf): { refDes: string; token: string; pin: { number: string; name: string; type?: string } | undefined } {
  const trimmed = endpoint.trim();
  const dot = trimmed.indexOf(".");
  const refDes = dot < 0 ? trimmed : trimmed.slice(0, dot);
  const token = dot < 0 ? "" : trimmed.slice(dot + 1).trim().toLowerCase();
  const pin = token ? partOf(refDes)?.pins.find((candidate) => candidate.number.toLowerCase() === token || candidate.name.toLowerCase() === token) : undefined;
  return { refDes, token, pin };
}
/** An endpoint as one node: the catalog pin NUMBER when the part names it (so "U1.VCC" and "U1.4" are one pin). */
function endpointNode(endpoint: string, partOf: PartOf): string {
  const { refDes, token, pin } = pinOf(endpoint, partOf);
  return pin ? `P:${refDes}#${pin.number}` : `P:${refDes}.${token}`;
}
const isLiteralGround = (endpoint: string): boolean => endpoint.trim().toUpperCase() === LITERAL_GROUND;

interface NetUse { kinds: Set<"label" | "power" | "ground">; pins: string[] }
/** The label names one block uses (in first-use order), each with its kinds and the endpoints it is attached to. */
function labelUses(netlist: BuildLogicalNetlist): Map<string, NetUse> {
  const uses = new Map<string, NetUse>();
  const entryOf = (key: string): NetUse => {
    let entry = uses.get(key);
    if (!entry) { entry = { kinds: new Set(), pins: [] }; uses.set(key, entry); }
    return entry;
  };
  for (const connection of netlist.connections) {
    if (isLabelConnection(connection)) {
      const key = netLabelNameKey(connection.labelName);
      if (!key) continue;
      const entry = entryOf(key);
      entry.kinds.add(connection.labelKind ?? inferNetLabelKind(connection.labelName));
      entry.pins.push(connection.pin);
    } else if (isLiteralGround(connection.from) || isLiteralGround(connection.to)) entryOf(LITERAL_GROUND).kinds.add("ground");
  }
  return uses;
}

/** Union-find over endpoint and net nodes; a partition is each pin node's group, named by its smallest pin node. */
class Partition {
  private parent = new Map<string, string>();
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
  /** pin node -> the smallest pin node of its group (comparable across two partitions of the same pins) */
  groups(): Map<string, string> {
    const smallest = new Map<string, string>();
    const pins = [...this.parent.keys()].filter((node) => node.startsWith("P:"));
    for (const pin of pins) {
      const root = this.find(pin), seen = smallest.get(root);
      if (seen === undefined || pin < seen) smallest.set(root, pin);
    }
    return new Map(pins.map((pin) => [pin, smallest.get(this.find(pin))!] as const));
  }
}
function connect(partition: Partition, netlist: BuildLogicalNetlist, netNode: (key: string) => string, partOf: PartOf): void {
  for (const connection of netlist.connections) {
    if (isLabelConnection(connection)) {
      const pin = endpointNode(connection.pin, partOf), key = netLabelNameKey(connection.labelName);
      partition.find(pin);
      if (key) partition.union(pin, netNode(key));
      continue;
    }
    const from = isLiteralGround(connection.from) ? netNode(LITERAL_GROUND) : endpointNode(connection.from, partOf);
    const to = isLiteralGround(connection.to) ? netNode(LITERAL_GROUND) : endpointNode(connection.to, partOf);
    partition.union(from, to);
  }
}
function samePartition(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [pin, group] of a) if (b.get(pin) !== group) return false;
  return true;
}

/** A port's direction from the catalog types of the pins its label is attached to on its own sheet. */
function portDirection(pins: readonly string[], partOf: PartOf, partsKnown: boolean): GeneratedPortDirection {
  if (!partsKnown) return "unspecified";
  const seen = new Set<"out" | "in" | "bi" | "tri" | "passive">();
  for (const endpoint of pins) {
    const type = pinOf(endpoint, partOf).pin?.type?.trim().toLowerCase();
    if (type === "output" || type === "power_out" || type === "open_collector" || type === "open_emitter") seen.add("out");
    else if (type === "input" || type === "power_in") seen.add("in");
    else if (type === "bidirectional") seen.add("bi");
    else if (type === "tri_state") seen.add("tri");
    else if (type === "passive") seen.add("passive");
  }
  if (seen.size === 0) return "unspecified";
  if (seen.has("bi") || ((seen.has("out") || seen.has("tri")) && seen.has("in"))) return "bidirectional";
  if (seen.has("tri")) return "tri_state";
  if (seen.has("out")) return "output";
  if (seen.has("in")) return "input";
  return "passive";
}

/**
 * Derive the sheet set of a planned generation result: a root "System overview" plus one child sheet per planned block in plan order
 * (designed or omitted), each with its ports (the plan's shared signal nets it carries or declares, and their direction), its rails and
 * its local nets; the overview's interfaces (one per shared signal net, bound when two or more designed sheets carry it) and the
 * project rails. One page (`sheets: null`) with findings when the conservative rule, a bound or the partition proof refuses the split.
 */
export function deriveGeneratedSheets(input: DeriveGeneratedSheetsInput): GeneratedSheets {
  const planned = input.planned;
  if (planned.length < 2) return onePage([]);
  if (planned.length > B.sheets) return onePage([`Kept on one page: the plan has ${planned.length} blocks; at most ${B.sheets} subsystem sheets are derived.`]);
  const keys = planned.map((block) => block.blockId);
  if (keys.some((key, index) => !isSheetKey(key) || keys.indexOf(key) !== index)) return onePage(["Kept on one page: the plan's blocks do not carry distinct block ids b1..b8."]);
  const plannedDesigned = planned.filter((block) => block.status === "designed");
  if (plannedDesigned.length === 0) return onePage(["Kept on one page: no planned block was designed."]);
  if (input.designed.length !== plannedDesigned.length || input.designed.some((block, index) => block.blockId !== plannedDesigned[index]!.blockId || block.name !== plannedDesigned[index]!.name)) {
    return onePage(["Kept on one page: the designed blocks do not match the plan's designed blocks."]);
  }
  const flatRefs = input.flat.components.map((component) => component.refDes);
  const blockRefs = input.designed.flatMap((block) => block.netlist.components.map((component) => component.refDes));
  const blockConnections = input.designed.reduce((sum, block) => sum + block.netlist.connections.length, 0);
  if (flatRefs.length !== blockRefs.length || flatRefs.some((ref, index) => ref !== blockRefs[index]) || blockConnections !== input.flat.connections.length) {
    return onePage(["Kept on one page: the designed blocks do not add up to the merged design."]);
  }
  if (flatRefs.length > B.components) return onePage([`Kept on one page: the design has ${flatRefs.length} components; a sheet set records at most ${B.components}.`]);

  const parts = new Map((input.parts ?? []).map((part) => [part.partId, part] as const));
  const partIdByRef = new Map(input.flat.components.map((component) => [component.refDes, component.partId] as const));
  const partOf: PartOf = (refDes) => {
    const partId = partIdByRef.get(refDes.trim());
    return partId === undefined ? undefined : parts.get(partId);
  };

  // the plan's shared nets (every planned block's, designed or omitted) and each designed block's label uses
  const shared = new Set(planned.flatMap((block) => block.sharedNets.map(netLabelNameKey).filter(Boolean)));
  const uses = new Map(input.designed.map((block) => [block.blockId, labelUses(block.netlist)] as const));
  // rails are project-wide by exact name: a name any block labels as power or ground (or the literal GND endpoint)
  const railKinds = new Map<string, Set<GeneratedRailKind>>();
  for (const blockUses of uses.values()) {
    for (const [key, use] of blockUses) for (const kind of use.kinds) if (kind !== "label") railKinds.set(key, (railKinds.get(key) ?? new Set<GeneratedRailKind>()).add(kind));
  }
  const labelledAnywhere = new Set([...uses.values()].flatMap((blockUses) => [...blockUses.keys()]));
  for (const key of shared) {
    if (labelledAnywhere.has(key)) continue;
    const kind = inferNetLabelKind(key); // a shared net no designed block labels (an omitted block's): its name decides
    if (kind !== "label") railKinds.set(key, new Set([kind]));
  }
  const mixed = [...railKinds].filter(([, kinds]) => kinds.size > 1).map(([key]) => key);
  if (mixed.length) return onePage(mixed.map((key) => `Kept on one page: ${key} is labelled both as a power rail and as a ground.`));
  const railKind = (key: string): GeneratedRailKind | null => {
    const kinds = railKinds.get(key);
    return kinds ? [...kinds][0]! : null;
  };

  // the conservative rule: an undeclared signal label in two or more blocks keeps the flat page
  const localUse = new Map<string, string[]>();
  for (const block of input.designed) {
    for (const key of uses.get(block.blockId)!.keys()) if (railKind(key) === null && !shared.has(key)) localUse.set(key, [...(localUse.get(key) ?? []), block.name]);
  }
  const collisions = [...localUse].filter(([, names]) => names.length >= 2);
  if (collisions.length) return onePage(collisions.map(([key, names]) => `Kept on one page: ${key} is labelled in ${names.join(", ")} but is not a planned shared net.`));

  // the children, in plan order
  const designedById = new Map(input.designed.map((block) => [block.blockId, block] as const));
  const children: GeneratedChildSheet[] = [];
  const carried = new Set<string>(); // the port keys whose own designed sheet labels the net
  for (const block of planned) {
    const sheetKey = block.blockId as GeneratedSheetKey;
    const declared = [...new Set(block.sharedNets.map(netLabelNameKey).filter(Boolean))];
    const designed = designedById.get(block.blockId);
    if (!designed) {
      children.push({
        sheetKey, name: block.name, status: "omitted", components: [],
        ports: declared.filter((net) => railKind(net) === null).map((net) => ({ portKey: `${sheetKey}:${net}`, net, direction: "unspecified", state: "unbound" })),
        rails: declared.flatMap((net) => {
          const kind = railKind(net);
          return kind ? [{ net, kind }] : [];
        }),
        localNets: [],
      });
      continue;
    }
    const blockUses = uses.get(block.blockId)!;
    const labelled = [...blockUses.keys()];
    const portNets = [...new Set([...declared.filter((net) => railKind(net) === null), ...labelled.filter((net) => railKind(net) === null && shared.has(net))])];
    for (const net of portNets) if (blockUses.has(net)) carried.add(`${sheetKey}:${net}`);
    children.push({
      sheetKey, name: block.name, status: "designed", components: designed.netlist.components.map((component) => component.refDes),
      ports: portNets.map((net) => ({ portKey: `${sheetKey}:${net}`, net, direction: blockUses.has(net) ? portDirection(blockUses.get(net)!.pins, partOf, input.parts !== null) : "unspecified", state: "unbound" })),
      rails: labelled.flatMap((net) => {
        const kind = railKind(net);
        return kind ? [{ net, kind }] : [];
      }),
      localNets: labelled.filter((net) => railKind(net) === null && !shared.has(net)),
    });
  }
  const refusals: string[] = [];
  for (const child of children) {
    if (child.ports.length > B.portsPerSheet) refusals.push(`Kept on one page: ${child.name} has ${child.ports.length} ports; a sheet records at most ${B.portsPerSheet}.`);
    if (child.localNets.length > B.localNetsPerSheet) refusals.push(`Kept on one page: ${child.name} has ${child.localNets.length} local nets; a sheet records at most ${B.localNetsPerSheet}.`);
  }
  const railNets = [...new Set(children.flatMap((child) => child.rails.map((rail) => rail.net)))];
  if (railNets.length > B.rails) refusals.push(`Kept on one page: the design has ${railNets.length} rails; a sheet set records at most ${B.rails}.`);
  const interfaceNets = [...new Set(children.flatMap((child) => child.ports.map((port) => port.net)))];
  if (interfaceNets.length > B.interfaces) refusals.push(`Kept on one page: the design has ${interfaceNets.length} interfaces; a sheet set records at most ${B.interfaces}.`);
  const netNames = [...interfaceNets, ...railNets, ...children.flatMap((child) => child.localNets)];
  if (netNames.some((name) => name.length > B.netChars) || children.some((child) => child.name.length > B.sheetNameChars || child.components.some((ref) => ref.length > B.refDesChars))) {
    refusals.push("Kept on one page: a sheet, net or reference name is longer than a sheet set records.");
  }
  if (refusals.length) return onePage(refusals);

  // the proof: the sheet-scoped model connects exactly the pins the flat merge connects
  const flatPartition = new Partition();
  connect(flatPartition, input.flat, (key) => `N:${key}`, partOf);
  const sheetPartition = new Partition();
  for (const block of input.designed) connect(sheetPartition, block.netlist, (key) => (railKind(key) !== null || shared.has(key) ? `N:${key}` : `L:${block.blockId}:${key}`), partOf);
  if (!samePartition(flatPartition.groups(), sheetPartition.groups())) return onePage(["Kept on one page: the sheet-scoped connections would not reproduce the merged design's pin-to-net partition."]);

  // the overview's interfaces, then each port's binding and the findings the user sees
  const findings: string[] = [];
  const nameOf = new Map(children.map((child) => [child.sheetKey as string, child.name] as const));
  const interfaces: GeneratedInterface[] = interfaceNets.map((net) => {
    const ports = children.flatMap((child) => child.ports.filter((port) => port.net === net).map((port) => port.portKey));
    const joined = ports.filter((key) => carried.has(key));
    const state: GeneratedBinding = joined.length >= 2 ? "bound" : "unbound";
    if (state === "unbound") findings.push(`Interface ${net} is carried by ${joined.length ? `${nameOf.get(joined[0]!.slice(0, joined[0]!.indexOf(":")))} only` : "no designed sheet"}; a shared net must join at least two sheets.`);
    return { net, ports, state };
  });
  const bound = new Set(interfaces.filter((entry) => entry.state === "bound").map((entry) => entry.net));
  for (const child of children) {
    for (const port of child.ports) port.state = bound.has(port.net) && carried.has(port.portKey) ? "bound" : "unbound";
    if (child.status === "omitted") {
      findings.push(child.ports.length ? `${child.name} was not designed: its ${child.ports.length === 1 ? "port" : "ports"} ${child.ports.map((port) => port.net).join(", ")} ${child.ports.length === 1 ? "is" : "are"} unbound.` : `${child.name} was not designed.`);
      continue;
    }
    const missing = child.ports.filter((port) => !carried.has(port.portKey)).map((port) => port.net);
    if (missing.length) findings.push(`${child.name} declares ${missing.join(", ")} but does not label ${missing.length === 1 ? "it; its port is" : "them; those ports are"} unbound.`);
  }
  const rails: GeneratedRail[] = railNets.map((net) => ({ net, kind: railKind(net)!, sheets: children.filter((child) => child.rails.some((rail) => rail.net === net)).map((child) => child.sheetKey) }));
  return { schema: GENERATION_SHEETS_SCHEMA, sheets: { root: { sheetKey: "overview", name: "System overview" }, children, interfaces, rails }, findings: boundedFindings(findings) };
}

// ─── Consistency and the defensive reader (the server judge and the browser share them) ──────────────────────────────────────

/** The cross-references a sheet set must satisfy beyond its shape: distinct sheet keys; each port key is its own sheet and net, once;
 *  a designed sheet has components and an omitted one none; at most 512 components; each interface names its own ports, once; each
 *  rail names existing sheets. Null when sound. */
export function generatedSheetsConsistencyIssue(set: GeneratedSheetSet): string | null {
  const keys = set.children.map((child) => child.sheetKey as string);
  if (new Set(keys).size !== keys.length) return "sheets.children: the sheet keys must be distinct";
  const portKeys = new Set<string>();
  for (const child of set.children) {
    if (child.status === "omitted" ? child.components.length > 0 : child.components.length === 0) return `sheets.children.${child.sheetKey}: a designed sheet has components and an omitted one has none`;
    for (const port of child.ports) {
      if (port.portKey !== `${child.sheetKey}:${port.net}` || portKeys.has(port.portKey)) return `sheets.children.${child.sheetKey}.ports: a port key is its sheet and net, once`;
      portKeys.add(port.portKey);
    }
  }
  if (set.children.reduce((sum, child) => sum + child.components.length, 0) > B.components) return `sheets.children: at most ${B.components} components`;
  const interfaceNets = new Set<string>();
  for (const entry of set.interfaces) {
    if (interfaceNets.has(entry.net) || entry.ports.some((key) => !portKeys.has(key) || !key.endsWith(`:${entry.net}`))) return "sheets.interfaces: each interface names its own ports, once";
    interfaceNets.add(entry.net);
  }
  for (const rail of set.rails) if (rail.sheets.some((key) => !keys.includes(key))) return "sheets.rails: a rail names existing sheets";
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const bounded = (value: unknown, max: number): value is string => typeof value === "string" && value.length >= 1 && value.length <= max;
const closed = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
function listOf<T>(value: unknown, max: number, read: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: T[] = [];
  for (const entry of value) {
    const item = read(entry);
    if (item === null) return null;
    out.push(item);
  }
  return out;
}
const railKindOf = (value: unknown): GeneratedRailKind | null => (value === "power" || value === "ground" ? value : null);
const bindingOf = (value: unknown): GeneratedBinding | null => (value === "bound" || value === "unbound" ? value : null);
const PORT_KEY_CHARS = B.netChars + 3;

function readChild(entry: unknown): GeneratedChildSheet | null {
  if (!isRecord(entry) || !closed(entry, ["sheetKey", "name", "status", "components", "ports", "rails", "localNets"]) || !isSheetKey(entry.sheetKey) || !bounded(entry.name, B.sheetNameChars)) return null;
  if (entry.status !== "designed" && entry.status !== "omitted") return null;
  const components = listOf(entry.components, B.components, (ref) => (bounded(ref, B.refDesChars) ? ref : null));
  const ports = listOf(entry.ports, B.portsPerSheet, (port): GeneratedSheetPort | null => {
    if (!isRecord(port) || !closed(port, ["portKey", "net", "direction", "state"]) || !bounded(port.portKey, PORT_KEY_CHARS) || !bounded(port.net, B.netChars)) return null;
    const state = bindingOf(port.state);
    return state && (GENERATED_PORT_DIRECTIONS as readonly unknown[]).includes(port.direction) ? { portKey: port.portKey, net: port.net, direction: port.direction as GeneratedPortDirection, state } : null;
  });
  const rails = listOf(entry.rails, B.rails, (rail): GeneratedSheetRail | null => {
    if (!isRecord(rail) || !closed(rail, ["net", "kind"]) || !bounded(rail.net, B.netChars)) return null;
    const kind = railKindOf(rail.kind);
    return kind ? { net: rail.net, kind } : null;
  });
  const localNets = listOf(entry.localNets, B.localNetsPerSheet, (net) => (bounded(net, B.netChars) ? net : null));
  if (!components || !ports || !rails || !localNets) return null;
  return { sheetKey: entry.sheetKey, name: entry.name, status: entry.status, components, ports, rails, localNets };
}

/** A sheet set document read defensively (the browser's result reader; the server's judge applies the same consistency rule): a fresh
 *  copy of a well-formed `sirkit.generation-sheets.v1` with closed keys and bounded values, or null - never a half-read document. */
export function readGeneratedSheets(value: unknown): GeneratedSheets | null {
  if (!isRecord(value) || !closed(value, ["schema", "sheets", "findings"]) || value.schema !== GENERATION_SHEETS_SCHEMA) return null;
  const findings = listOf(value.findings, B.findings, (entry) => (bounded(entry, B.findingChars) ? entry : null));
  if (findings === null) return null;
  if (value.sheets === null) return { schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings };
  const raw = value.sheets;
  if (!isRecord(raw) || !closed(raw, ["root", "children", "interfaces", "rails"])) return null;
  if (!isRecord(raw.root) || !closed(raw.root, ["sheetKey", "name"]) || raw.root.sheetKey !== GENERATED_OVERVIEW_SHEET.sheetKey || raw.root.name !== GENERATED_OVERVIEW_SHEET.name) return null;
  const children = listOf(raw.children, B.sheets, readChild);
  const interfaces = listOf(raw.interfaces, B.interfaces, (entry): GeneratedInterface | null => {
    if (!isRecord(entry) || !closed(entry, ["net", "ports", "state"]) || !bounded(entry.net, B.netChars)) return null;
    const ports = listOf(entry.ports, B.sheets, (key) => (bounded(key, PORT_KEY_CHARS) ? key : null));
    const state = bindingOf(entry.state);
    return ports && ports.length >= 1 && state ? { net: entry.net, ports, state } : null;
  });
  const rails = listOf(raw.rails, B.rails, (entry): GeneratedRail | null => {
    if (!isRecord(entry) || !closed(entry, ["net", "kind", "sheets"]) || !bounded(entry.net, B.netChars)) return null;
    const kind = railKindOf(entry.kind);
    const sheets = listOf(entry.sheets, B.sheets, (key) => (isSheetKey(key) ? key : null));
    return kind && sheets ? { net: entry.net, kind, sheets } : null;
  });
  if (!children || children.length < 2 || !interfaces || !rails) return null;
  const set: GeneratedSheetSet = { root: { sheetKey: "overview", name: "System overview" }, children, interfaces, rails };
  return generatedSheetsConsistencyIssue(set) === null ? { schema: GENERATION_SHEETS_SCHEMA, sheets: set, findings } : null;
}
