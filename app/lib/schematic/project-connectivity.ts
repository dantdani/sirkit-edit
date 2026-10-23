/**
 * [PR-J, 2026-10-22] Runbook section J increment 1 (J.4, J.5; OD-255 items 2-5): THE project connectivity authority - one function
 * that says which pins form one electrical net across the whole project, for every consumer (PCB publication, ERC, design checks,
 * BOM, missing parts, SPICE, KiCad export; builder J2 switches them onto it).
 *
 * Single-sheet document (no `sheets`): the result is DERIVED from the existing geometric union, `buildNetUnionFind`
 * (app/lib/connectivity.ts), called exactly as the PCB netlist calls it, plus the legacy naming the consumers apply today: every
 * ground-kind label and Theory ground symbol is named "GND", power labels keep their name, other labels theirs, and same-named roots
 * are one net (app/lib/pcb/netlist-bridge.ts buildNetlist). So an existing project keeps its exact nets, names and union-find root
 * strings. The legacy collapse of DIFFERENT ground names (AGND, DGND, PGND ... -> one "GND") is kept for these documents (existing
 * boards keep their nets, OD-255 item 3) and reported as the finding LEGACY_GROUND_NAME_COLLAPSE.
 *
 * Multi-sheet document: the strict policy (J.4):
 *  1. coordinates connect only on the same sheet (union keys are scoped by sheet; the root keeps the bare "x,y" key);
 *  2. a label without scope is LOCAL: it joins same-named labels on its own sheet only;
 *  3. a label with scope "global", every power / ground label and every Theory ground symbol ("GND") join project-wide by EXACT name
 *     (case-normalized like every label); distinct rail names are never merged (AGND, DGND and GND stay three nets);
 *  4. a sheet pin joins exactly its port, and the port joins exactly its hierarchical labels on the child sheet - by port identity,
 *     never by name;
 *  5. a net that lives below the root is displayed by sheet path ("Power/OUT"); its identity is endpoint-based (`ProjectNet.id`).
 * Structural errors (app/lib/schematic/sheets.ts validateSheetHierarchy) make the result `ok: false` with no nets: nothing is guessed.
 *
 * Findings on both kinds of document: ISOLATION_DOMAIN_JOIN (two different ground / return names, or a ground and a power name, on one
 * net) and POWER_RAIL_JOIN (two different power names on one net) are reported, never repaired; a sheet operation that would CREATE one
 * is refused by the canonical executor (OD-255 item 4; it compares the `railJoins` of the result before and after the batch).
 *
 * Pure: no I/O, no randomness. KiCad pin positions come from the caller's part lookup (the parts cache in the browser, the committed
 * catalog in tests); without one, KiCad parts contribute no pins (connectivity between labels and wires is unaffected).
 *
 * [PR-J1 integration, 2026-10-22] Round-1 review fixes: (PC-1) a net whose only names are port anchors (sheet pins, hierarchical
 * labels) is named by the port's sheet path ("Power/OUT") when another net would carry the same name - a collision is an error only
 * when a name the user wrote (a local, global, power or ground label, a ground symbol) is involved; (PC-2) the single-sheet
 * derivation is linear in the pins; (PC-3) the authority refuses a sheet lens itself; (PC-4) LEGACY_GROUND_NAME_COLLAPSE is
 * reported only when the legacy rule really joins nets the strict rule keeps apart (a lone non-GND ground name is the finding
 * LEGACY_GROUND_RENAMED), and (J1-OPS-2) that collapse is a rail-join key, so a sheet operation that brings it back is refused;
 * (PC-5) one name on a net is never a rail join; (PC-6) a local label that carries a port anchor's name on the same sheet, on a
 * different net, is the finding SHEET_LOCAL_SHADOWS_PORT whether or not the port is bound; (J1-OPS-1) `singleSheetRuleChange`
 * says whether turning a single-sheet document into a multi-sheet one (or back) would change its circuit by the change of rules.
 */

import { buildNetUnionFind, UnionFind } from "@/app/lib/connectivity";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { kicadPinWorldPos, pinWorldPos, pointKey } from "@/app/lib/geometry";
import type { KicadPin } from "@/app/lib/kicad/types";
import { schematicEndpointKey } from "@/app/lib/pcb/integrity";
import { theoryPinContract } from "@/app/lib/schematic/theory-physicality";
import { compareCodePoints } from "@/app/lib/stable-compare";
import {
  PIN_NAMES,
  ROOT_SHEET_ID,
  netLabelNameKey,
  type NetLabel,
  type NetLabelKind,
  type NetLabelScope,
  type Point,
  type SchematicState,
  type Wire,
} from "@/lib/schematic-types";
import { assertWholeProject, sheetDepth, sheetOf, sheetPathName, validateSheetHierarchy, type SheetDiagnosticCode } from "./sheets";

export const PROJECT_CONNECTIVITY_SCHEMA = "sirkit.project-connectivity.v1" as const;

/** Structurally satisfied by the netlist bridge's `PartLookup` and by the parts cache. */
export type PartPinsLookup = (partId: string) => { pins: readonly KicadPin[] } | null;

export interface ProjectPin {
  /** `componentId::pinId` (app/lib/pcb/integrity.ts schematicEndpointKey): the endpoint identity the PCB uses. */
  key: string;
  componentId: string;
  family: "theory" | "kicad";
  /** The netlist pin identity: the pad number of a physical part (KiCad pin number; Theory pad from theoryPinContract), else the
   *  Theory pin name (voltage / current sources and ground symbols have no pads). */
  pinId: string;
  /** Theory pin name ("left", "+", "pin") or the KiCad pin name. */
  pinName: string;
  sheetId: string;
  point: Point;
}

export interface ProjectNetLabel { id: string; name: string; kind: NetLabelKind; sheetId: string; scope: NetLabelScope | "local"; portId?: string }

export type ProjectNetKind = "ground" | "power" | "label" | "unnamed";
/** "global": a project-wide name (any label in a single-sheet document; global, power and ground labels in a multi-sheet one);
 *  "hierarchical": spans sheets through ports; "local": one sheet only. */
export type ProjectNetScope = "global" | "hierarchical" | "local";

export interface ProjectNet {
  /** Endpoint-based identity: a digest of the sorted member pin keys (of the label ids for a pin-less net). Renaming a label or a
   *  sheet never changes it. */
  id: string;
  /** Display / board name: the legacy name in a single-sheet document; scoped in a multi-sheet one; null when unnamed. */
  name: string | null;
  kind: ProjectNetKind;
  scope: ProjectNetScope;
  /** The shallowest sheet the net touches (the root in a single-sheet document). */
  homeSheetId: string;
  sheetIds: string[];
  /** Sorted unique member pin keys. */
  members: string[];
  /** Member pins in document order. */
  pins: ProjectPin[];
  /** Labels on the net in document order. */
  labels: ProjectNetLabel[];
  /** Ports the net passes through. */
  portIds: string[];
  /** A Theory ground symbol is on the net. */
  groundSymbol: boolean;
  /** The union-find roots the net covers. In a single-sheet document these are buildNetUnionFind's own root strings. */
  rootKeys: string[];
}

export type ConnectivityDiagnosticCode = SheetDiagnosticCode | "ISOLATION_DOMAIN_JOIN" | "POWER_RAIL_JOIN" | "LEGACY_GROUND_NAME_COLLAPSE" | "SHEET_NET_NAME_COLLISION"
  // [PR-J1 integration, 2026-10-22] review PC-4 and PC-6
  | "LEGACY_GROUND_RENAMED" | "SHEET_LOCAL_SHADOWS_PORT";

export interface ConnectivityDiagnostic {
  code: ConnectivityDiagnosticCode;
  /** "error": the result carries no nets (or, for a name collision, cannot be published); "warning": a reported finding. */
  severity: "error" | "warning";
  message: string;
  refs: string[];
}

export interface ProjectConnectivity {
  schema: typeof PROJECT_CONNECTIVITY_SCHEMA;
  mode: "single-sheet" | "multi-sheet";
  /** False when any diagnostic is an error: consumers refuse (they never publish a guessed net). */
  ok: boolean;
  diagnostics: ConnectivityDiagnostic[];
  pins: ProjectPin[];
  nets: ProjectNet[];
  /** Whether KiCad pins were resolved (a part lookup was supplied); KiCad parts the lookup did not know are listed. */
  kicadPinsResolved: boolean;
  unresolvedPartIds: string[];
  /** Digest of the pin-to-net partition (every pin, singletons included): equal before and after any change that keeps the circuit. */
  partitionDigest: string;
  /** Sorted rail-join keys ("AGND|DGND"): one per net that joins different rail / return names. */
  railJoins: string[];
  netOfPin(key: string): ProjectNet | null;
  netAt(sheetId: string, point: Point): ProjectNet | null;
  /** The union-find root of a point on a sheet (single-sheet: buildNetUnionFind's root string), or null when unknown. */
  rootAt(sheetId: string, point: Point): string | null;
}

// ── shared helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort(compareCodePoints);

function wirePoints(wire: Wire): Point[] {
  const legacy = wire as unknown as { vertices?: Point[]; start?: Point; end?: Point };
  if (legacy.vertices && legacy.vertices.length >= 2) return legacy.vertices;
  if (legacy.start && legacy.end) return [legacy.start, legacy.end];
  return [];
}

function collectPins(state: SchematicState, getPart: PartPinsLookup | undefined): { pins: ProjectPin[]; kicadPinPoints: Point[]; unresolved: string[] } {
  const pins: ProjectPin[] = [];
  for (const component of state.components) {
    const pads = theoryPinContract(component.type);
    for (const pinName of PIN_NAMES[component.type] ?? []) {
      const pinId = pads?.[pinName] ?? pinName;
      pins.push({ key: schematicEndpointKey(component.id, pinId), componentId: component.id, family: "theory", pinId, pinName, sheetId: sheetOf(component), point: pinWorldPos(component, pinName) });
    }
  }
  const kicadPinPoints: Point[] = [];
  const unresolved = new Set<string>();
  for (const instance of state.kicadComponents ?? []) {
    const part = getPart ? getPart(instance.partId) : null;
    if (getPart && !part) unresolved.add(instance.partId);
    for (const pin of part?.pins ?? []) {
      const point = kicadPinWorldPos(instance, pin);
      kicadPinPoints.push(point);
      pins.push({ key: schematicEndpointKey(instance.id, pin.number), componentId: instance.id, family: "kicad", pinId: pin.number, pinName: pin.name, sheetId: sheetOf(instance), point });
    }
  }
  return { pins, kicadPinPoints, unresolved: sortedUnique(unresolved) };
}

const labelRef = (label: NetLabel): ProjectNetLabel => ({
  id: label.id, name: label.name, kind: label.kind, sheetId: sheetOf(label), scope: label.scope ?? "local",
  ...(label.portId !== undefined ? { portId: label.portId } : {}),
});

interface RootBucket { pins: ProjectPin[]; labels: NetLabel[]; groundSymbol: boolean }

function railNames(bucket: { labels: readonly NetLabel[]; groundSymbol: boolean }): { ground: string[]; power: string[] } {
  const ground = new Set<string>();
  const power = new Set<string>();
  if (bucket.groundSymbol) ground.add("GND");
  for (const label of bucket.labels) {
    if (label.kind === "ground") ground.add(netLabelNameKey(label.name));
    else if (label.kind === "power") power.add(netLabelNameKey(label.name));
  }
  return { ground: sortedUnique(ground), power: sortedUnique(power) };
}

function railFindings(buckets: Iterable<{ labels: readonly NetLabel[]; groundSymbol: boolean; refs: string[] }>, diagnostics: ConnectivityDiagnostic[]): string[] {
  const joins = new Set<string>();
  for (const bucket of buckets) {
    const { ground, power } = railNames(bucket);
    // [PR-J1 integration, 2026-10-22] review PC-5: one name is never a join (a ground symbol and a power-kind "GND" label are one rail)
    const names = sortedUnique([...ground, ...power]);
    if (names.length >= 2 && (ground.length >= 2 || (ground.length >= 1 && power.length >= 1))) {
      joins.add(names.join("|"));
      diagnostics.push({ code: "ISOLATION_DOMAIN_JOIN", severity: "warning", message: `One net joins ${names.join(", ")}: different ground / return or power domains are connected here. Check that this is an intended tie (a sheet operation never creates one).`, refs: sortedUnique(bucket.refs) });
    }
    if (power.length >= 2) {
      joins.add(power.join("|"));
      diagnostics.push({ code: "POWER_RAIL_JOIN", severity: "warning", message: `One net joins the power rails ${power.join(", ")}. Check that this is an intended tie.`, refs: sortedUnique(bucket.refs) });
    }
  }
  return sortedUnique(joins);
}

function netIdentity(members: readonly string[], labels: readonly ProjectNetLabel[]): string {
  return `pnet:${engineeringDigest(members.length > 0 ? { members } : { labels: sortedUnique(labels.map((label) => label.id)) }).replace(/^eng1-/, "")}`;
}

function partitionDigestOf(nets: readonly ProjectNet[]): string {
  const groups = nets.filter((net) => net.members.length > 0).map((net) => net.members.join("\u0000")).sort(compareCodePoints);
  return engineeringDigest({ schema: "sirkit.pin-partition.v1", groups });
}

function finish(input: Omit<ProjectConnectivity, "schema" | "ok" | "partitionDigest" | "netOfPin" | "netAt" | "rootAt"> & { keyOf: (sheetId: string, point: Point) => string | null; uf: UnionFind | null; netByRoot: Map<string, ProjectNet> }): ProjectConnectivity {
  const { keyOf, uf, netByRoot, ...rest } = input;
  const netByPin = new Map<string, ProjectNet>();
  for (const net of rest.nets) for (const member of net.members) if (!netByPin.has(member)) netByPin.set(member, net);
  const rootAt = (sheetId: string, point: Point): string | null => {
    const key = keyOf(sheetId, point);
    return key !== null && uf && uf.has(key) ? uf.find(key) : null;
  };
  return {
    schema: PROJECT_CONNECTIVITY_SCHEMA,
    ...rest,
    ok: !rest.diagnostics.some((item) => item.severity === "error"),
    partitionDigest: partitionDigestOf(rest.nets),
    netOfPin: (key) => netByPin.get(key) ?? null,
    netAt: (sheetId, point) => { const root = rootAt(sheetId, point); return root === null ? null : netByRoot.get(root) ?? null; },
    rootAt,
  };
}

const compareNets = (a: ProjectNet, b: ProjectNet): number => {
  if (a.name !== null && b.name !== null) return compareCodePoints(a.name, b.name) || compareCodePoints(a.id, b.id);
  if (a.name !== null) return -1;
  if (b.name !== null) return 1;
  return compareCodePoints(a.members[0] ?? a.labels[0]?.id ?? "", b.members[0] ?? b.labels[0]?.id ?? "") || compareCodePoints(a.id, b.id);
};

// ── the one entry point ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function resolveProjectConnectivity(state: SchematicState, getPart?: PartPinsLookup): ProjectConnectivity {
  assertWholeProject(state, "project-connectivity"); // [PR-J1 integration, 2026-10-22] review PC-3: one sheet's view is never the project
  return state.sheets === undefined ? resolveSingleSheet(state, getPart) : resolveMultiSheet(state, getPart);
}

/** The pin-and-label partition of a result: each net's member pin keys and label ids (a pin-less, label-only net included). */
function connectionGroups(conn: ProjectConnectivity): Array<{ key: string; pins: string[]; labels: string[] }> {
  return conn.nets
    .map((net) => { const labels = sortedUnique(net.labels.map((label) => label.id)); return { key: JSON.stringify([net.members, labels]), pins: net.members, labels }; })
    .filter((group) => group.pins.length + group.labels.length > 0);
}

/**
 * [PR-J1 integration, 2026-10-22] Review J1-OPS-1. A document gains sheets (v1 -> v2) or loses its last child sheet (v2 -> v1) by a
 * sheet operation, and that alone switches its connection rules: the legacy single-sheet rule (every ground name is GND; a plain
 * label joins a power or ground label of the same name) or the strict multi-sheet rule (OD-255 items 2, 3). For a single-sheet
 * document, this resolves its entities under BOTH rules (the strict side through a synthetic, empty child sheet) and returns null
 * when they connect exactly the same pins and labels, else the reason in a sentence. A sheet operation that changes the rules is
 * refused unless this is null: organising a design into sheets never changes its circuit by itself.
 */
export function singleSheetRuleChange(state: SchematicState, getPart?: PartPinsLookup): string | null {
  if (state.sheets !== undefined) return null;
  const legacy = resolveProjectConnectivity(state, getPart);
  const collapse = legacy.diagnostics.find((item) => item.code === "LEGACY_GROUND_NAME_COLLAPSE");
  if (collapse) return `${collapse.message} Rename the ground labels to one name, or tie them explicitly, before organizing this design into sheets.`;
  const strict = resolveProjectConnectivity({ ...state, sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, { id: "sheet-rule-probe", name: "Rule probe", parentId: ROOT_SHEET_ID }] } }, getPart);
  const error = strict.diagnostics.find((item) => item.severity === "error");
  if (error) return `A multi-sheet project uses the strict connection rules (a plain label never joins a power or ground label, a global label never joins a local one), under which this design has an error: ${error.message}`;
  const kept = new Set(connectionGroups(strict).map((group) => group.key));
  const changed = connectionGroups(legacy).filter((group) => !kept.has(group.key));
  if (changed.length === 0) return null;
  const labelName = new Map((state.netLabels ?? []).map((label) => [label.id, label.name] as const));
  const names = sortedUnique(changed.flatMap((group) => group.labels.map((id) => labelName.get(id) ?? id)));
  const detail = names.length > 0 ? `labels ${names.slice(0, 6).join(", ")}` : `pins ${changed.flatMap((group) => group.pins).slice(0, 6).join(", ")}`;
  return `A multi-sheet project uses the strict connection rules, under which ${changed.length} net(s) of this design would be connected differently (${detail}). Rename or re-kind those labels so both rules agree before organizing this design into sheets.`;
}

// ── single-sheet: the legacy union, named exactly as the consumers name it today ────────────────────────────────────────────

function resolveSingleSheet(state: SchematicState, getPart: PartPinsLookup | undefined): ProjectConnectivity {
  const diagnostics: ConnectivityDiagnostic[] = validateSheetHierarchy(state).map((item) => ({ ...item }));
  const { pins, kicadPinPoints, unresolved } = collectPins(state, getPart);
  const netLabels = state.netLabels ?? [];
  // The SAME call the PCB netlist makes (netlist-bridge.ts buildNetlist): identical union order, identical root strings.
  const uf = buildNetUnionFind(state.components, state.wires, kicadPinPoints, netLabels);
  const keyOf = (sheetId: string, point: Point): string | null => (sheetId === ROOT_SHEET_ID ? pointKey(point) : null);

  const buckets = new Map<string, RootBucket>();
  const bucketOf = (root: string): RootBucket => { let bucket = buckets.get(root); if (!bucket) { bucket = { pins: [], labels: [], groundSymbol: false }; buckets.set(root, bucket); } return bucket; };
  for (const pin of pins) bucketOf(uf.find(pointKey(pin.point))).pins.push(pin);
  for (const label of netLabels) { const key = pointKey(label.position); if (uf.has(key)) bucketOf(uf.find(key)).labels.push(label); }
  for (const component of state.components) {
    if (component.type !== "ground") continue;
    const key = pointKey(pinWorldPos(component, "pin"));
    if (uf.has(key)) bucketOf(uf.find(key)).groundSymbol = true;
  }

  // Legacy naming (buildNetlist): ground beats power beats generic label; every ground root is "GND".
  const legacyName = (bucket: RootBucket): string | null => {
    if (bucket.groundSymbol || bucket.labels.some((label) => label.kind === "ground")) return "GND";
    const power = bucket.labels.filter((label) => label.kind === "power").map((label) => netLabelNameKey(label.name));
    if (power.length > 0) return [...power].sort()[0]!;
    const named = bucket.labels.filter((label) => label.kind !== "ground" && label.kind !== "power").map((label) => netLabelNameKey(label.name));
    if (named.length > 0) return [...named].sort()[0]!;
    return null;
  };

  const railJoins = railFindings([...buckets.entries()].map(([root, bucket]) => ({ labels: bucket.labels, groundSymbol: bucket.groundSymbol, refs: [root, ...bucket.labels.map((label) => label.id)] })), diagnostics);
  // [PR-J1 integration, 2026-10-22] review PC-4 / J1-OPS-2: the legacy rule names every ground root "GND" and merges them; it JOINS
  // nets only where the strict rule (a ground name, a ground symbol or a power "GND" label joins by its exact name) keeps two or more
  // ground groups apart. Only then is it the collapse finding - and a rail-join key, so a sheet operation that re-creates it (the
  // last child sheet deleted) is refused like any other join. A single non-GND ground name is a rename of that one net, never a join.
  const groundNamesOf = (bucket: RootBucket): string[] => { const { ground, power } = railNames(bucket); return sortedUnique([...ground, ...power.filter((name) => name === "GND")]); };
  const groundBuckets = [...buckets.values()].map(groundNamesOf).filter((names) => names.length > 0);
  const groundGroups = new UnionFind();
  for (const names of groundBuckets) for (const name of names) groundGroups.union(names[0]!, name);
  const strictGroundGroups = new Set(groundBuckets.map((names) => groundGroups.find(names[0]!))).size;
  const groundNames = sortedUnique(groundBuckets.flat());
  const collapsedGroundNames = groundNames.filter((name) => name !== "GND");
  /** The name the strict rule gives the one ground net (a ground name beats a power "GND"; a ground symbol is GND). */
  const strictGroundName = sortedUnique([...buckets.values()].flatMap((bucket) => railNames(bucket).ground))[0] ?? "GND";
  if (strictGroundGroups >= 2) {
    railJoins.splice(0, railJoins.length, ...sortedUnique([...railJoins, groundNames.join("|")]));
    diagnostics.push({
      code: "LEGACY_GROUND_NAME_COLLAPSE", severity: "warning",
      message: `This single-sheet design's PCB netlist and ERC publish every ground label as one net named GND: ${["GND", ...collapsedGroundNames].join(", ")} are joined (the legacy rule, kept so existing boards keep their nets; OD-255 item 3). A multi-sheet project keeps each ground name separate, so organizing this design into sheets would split that net.`,
      refs: collapsedGroundNames,
    });
  } else if (groundNames.length > 0 && strictGroundName !== "GND") {
    diagnostics.push({
      code: "LEGACY_GROUND_RENAMED", severity: "warning",
      message: `This single-sheet design's PCB netlist and ERC publish its ground net as GND (the legacy rule; OD-255 item 3), while its ground label${collapsedGroundNames.length === 1 ? " names" : "s name"} it ${collapsedGroundNames.join(", ")}. No two nets are merged; a multi-sheet project names that net ${strictGroundName}, so organizing this design into sheets renames it on the board (its connections are unchanged).`,
      refs: collapsedGroundNames,
    });
  }

  // Same-named roots are one net (two unwired ground symbols are still one GND); unnamed roots stay apart.
  const groups = new Map<string, string[]>();
  for (const [root, bucket] of buckets) {
    const name = legacyName(bucket);
    const groupKey = name === null ? `root\u0000${root}` : `name\u0000${name}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), root]);
  }
  const nets: ProjectNet[] = [];
  const netByRoot = new Map<string, ProjectNet>();
  // [PR-J1 integration, 2026-10-22] review PC-2: document order by index (each pin and label is in exactly one bucket), never a scan
  // of every pin once per net - that made each edit's design checks and live netlist quadratic in the pins
  const pinIndex = new Map(pins.map((pin, index) => [pin, index] as const));
  const labelIndex = new Map(netLabels.map((label, index) => [label, index] as const));
  for (const [groupKey, roots] of groups) {
    const parts = roots.map((root) => buckets.get(root)!);
    const groupPins = parts.flatMap((bucket) => bucket.pins).sort((a, b) => pinIndex.get(a)! - pinIndex.get(b)!);
    const labels = parts.flatMap((bucket) => bucket.labels).sort((a, b) => labelIndex.get(a)! - labelIndex.get(b)!).map(labelRef);
    const members = sortedUnique(groupPins.map((pin) => pin.key));
    const named = groupKey.startsWith("name\u0000") ? groupKey.slice(5) : null;
    const groundSymbol = parts.some((bucket) => bucket.groundSymbol);
    const kind: ProjectNetKind = named === null ? "unnamed" : groundSymbol || labels.some((label) => label.kind === "ground") ? "ground" : labels.some((label) => label.kind === "power") ? "power" : "label";
    const net: ProjectNet = {
      id: netIdentity(members, labels), name: named, kind, scope: named === null ? "local" : "global", homeSheetId: ROOT_SHEET_ID, sheetIds: [ROOT_SHEET_ID],
      members, pins: groupPins, labels, portIds: [], groundSymbol, rootKeys: sortedUnique(roots),
    };
    nets.push(net);
    for (const root of roots) netByRoot.set(root, net);
  }
  nets.sort(compareNets);
  return finish({ mode: "single-sheet", diagnostics, pins, nets, kicadPinsResolved: getPart !== undefined, unresolvedPartIds: unresolved, railJoins, keyOf, uf, netByRoot });
}

// ── multi-sheet: the strict scoped policy ──────────────────────────────────────────────────────────────────────────────────

function resolveMultiSheet(state: SchematicState, getPart: PartPinsLookup | undefined): ProjectConnectivity {
  const diagnostics: ConnectivityDiagnostic[] = validateSheetHierarchy(state).map((item) => ({ ...item }));
  const { pins, unresolved } = collectPins(state, getPart);
  const keyOf = (sheetId: string, point: Point): string => (sheetId === ROOT_SHEET_ID ? pointKey(point) : `${sheetId}\u0000${pointKey(point)}`);
  if (diagnostics.some((item) => item.severity === "error")) {
    return finish({ mode: "multi-sheet", diagnostics, pins, nets: [], kicadPinsResolved: getPart !== undefined, unresolvedPartIds: unresolved, railJoins: [], keyOf, uf: null, netByRoot: new Map() });
  }
  const netLabels = state.netLabels ?? [];
  const uf = new UnionFind();
  for (const wire of state.wires) {
    const points = wirePoints(wire);
    const sheet = sheetOf(wire);
    for (let index = 0; index < points.length - 1; index += 1) uf.union(keyOf(sheet, points[index]!), keyOf(sheet, points[index + 1]!));
  }
  for (const pin of pins) uf.find(keyOf(pin.sheetId, pin.point));
  for (const label of netLabels) uf.find(keyOf(sheetOf(label), label.position));
  // virtual nodes (cannot collide with point keys: they start with U+0001)
  const local = (sheet: string, name: string): string => `\u0001local\u0000${sheet}\u0000${netLabelNameKey(name)}`;
  const global = (name: string): string => `\u0001global\u0000${netLabelNameKey(name)}`;
  const port = (portId: string): string => `\u0001port\u0000${portId}`;
  for (const label of netLabels) {
    const site = keyOf(sheetOf(label), label.position);
    if (label.scope === "hierarchical" || label.scope === "sheet-pin") uf.union(site, port(label.portId!));
    else if (label.scope === "global" || label.kind === "power" || label.kind === "ground") uf.union(site, global(label.name));
    else uf.union(site, local(sheetOf(label), label.name));
  }
  const groundSymbolSites = new Set<string>();
  for (const component of state.components) {
    if (component.type !== "ground") continue;
    const site = keyOf(sheetOf(component), pinWorldPos(component, "pin"));
    groundSymbolSites.add(site);
    uf.union(site, global("GND"));
  }

  const buckets = new Map<string, RootBucket>();
  const bucketOf = (root: string): RootBucket => { let bucket = buckets.get(root); if (!bucket) { bucket = { pins: [], labels: [], groundSymbol: false }; buckets.set(root, bucket); } return bucket; };
  for (const pin of pins) bucketOf(uf.find(keyOf(pin.sheetId, pin.point))).pins.push(pin);
  for (const label of netLabels) bucketOf(uf.find(keyOf(sheetOf(label), label.position))).labels.push(label);
  for (const site of groundSymbolSites) bucketOf(uf.find(site)).groundSymbol = true;

  const railJoins = railFindings([...buckets.entries()].map(([root, bucket]) => ({ labels: bucket.labels, groundSymbol: bucket.groundSymbol, refs: [root.replace(/[\u0000\u0001]/g, "|"), ...bucket.labels.map((label) => label.id)] })), diagnostics);

  const depthOf = new Map<string, number>();
  const pathOf = new Map<string, string>();
  for (const sheet of state.sheets!.sheets) { depthOf.set(sheet.id, sheetDepth(state, sheet.id) ?? 0); pathOf.set(sheet.id, sheetPathName(state, sheet.id)); }
  const nets: ProjectNet[] = [];
  const netByRoot = new Map<string, ProjectNet>();
  /** [PR-J1 integration, 2026-10-22] review PC-1: the nets named ONLY by a port anchor (no name the user wrote), with the sheet that
   *  owns that port and the port's name - such a name is qualified by the port's sheet path when another net would carry it. */
  const portNamed = new Map<ProjectNet, { portSheetId: string; portName: string }>();
  for (const [root, bucket] of buckets) {
    const labels = bucket.labels.map(labelRef);
    const sheetIds = sortedUnique([...bucket.pins.map((pin) => pin.sheetId), ...labels.map((label) => label.sheetId)]);
    const homeSheetId = [...sheetIds].sort((a, b) => (depthOf.get(a)! - depthOf.get(b)!) || compareCodePoints(pathOf.get(a)!, pathOf.get(b)!))[0] ?? ROOT_SHEET_ID;
    const { ground, power } = railNames(bucket);
    const globals = sortedUnique(bucket.labels.filter((label) => label.scope === "global").map((label) => netLabelNameKey(label.name)));
    let name: string | null = null;
    let kind: ProjectNetKind = "unnamed";
    let scope: ProjectNetScope = sheetIds.length > 1 ? "hierarchical" : "local";
    if (ground.length > 0) { name = ground[0]!; kind = "ground"; scope = "global"; }
    else if (power.length > 0) { name = power[0]!; kind = "power"; scope = "global"; }
    else if (globals.length > 0) { name = globals[0]!; kind = "label"; scope = "global"; }
    let anchoredBy: { portSheetId: string; portName: string } | null = null;
    if (name === null) {
      const onHome = bucket.labels.filter((label) => sheetOf(label) === homeSheetId);
      const local = sortedUnique(onHome.filter((label) => label.scope === undefined).map((label) => netLabelNameKey(label.name)))[0];
      const anchors = onHome.filter((label) => label.scope === "hierarchical" || label.scope === "sheet-pin");
      const anchor = sortedUnique(anchors.map((label) => netLabelNameKey(label.name)))[0];
      const candidate = local ?? anchor;
      if (candidate !== undefined) { name = homeSheetId === ROOT_SHEET_ID ? candidate : `${pathOf.get(homeSheetId)}/${candidate}`; kind = "label"; }
      if (local === undefined && anchor !== undefined) {
        // the sheet that owns the naming port: a sheet pin's child sheet, a hierarchical label's own sheet (the first path in order)
        const owners = sortedUnique(anchors.filter((label) => netLabelNameKey(label.name) === anchor).map((label) => (label.scope === "sheet-pin" ? label.childSheetId! : sheetOf(label))));
        anchoredBy = { portSheetId: owners.sort((a, b) => compareCodePoints(pathOf.get(a) ?? "", pathOf.get(b) ?? ""))[0]!, portName: anchor };
      }
    }
    const members = sortedUnique(bucket.pins.map((pin) => pin.key));
    const net: ProjectNet = {
      id: netIdentity(members, labels), name, kind, scope, homeSheetId, sheetIds, members, pins: bucket.pins, labels,
      portIds: sortedUnique(bucket.labels.flatMap((label) => (label.portId !== undefined ? [label.portId] : []))), groundSymbol: bucket.groundSymbol, rootKeys: [root],
    };
    if (anchoredBy) portNamed.set(net, anchoredBy);
    nets.push(net);
    netByRoot.set(root, net);
  }

  // Distinct nets must never share a display / board name (a local label shadowing a global name, for example).
  // [PR-J1 integration, 2026-10-22] review PC-1: when every net of a shared name is named only by a port anchor (two sibling sheets
  // with an "OUT" port each, or two moves' ports), nothing the user wrote collides: each is named by its port's sheet path
  // ("Power/OUT", "Filter/OUT", as KiCad names such nets), and a qualified name that still meets another net's name takes the first
  // free "_2", "_3" suffix in net-identity order. A collision that involves a name the user wrote stays an error.
  const byName = new Map<string, ProjectNet[]>();
  for (const net of nets) if (net.name !== null) byName.set(netLabelNameKey(net.name), [...(byName.get(netLabelNameKey(net.name)) ?? []), net]);
  const qualified: ProjectNet[] = [];
  for (const [name, same] of byName) {
    if (same.length < 2) continue;
    if (same.every((net) => portNamed.has(net))) {
      for (const net of same) { const anchor = portNamed.get(net)!; net.name = `${pathOf.get(anchor.portSheetId) ?? anchor.portSheetId}/${anchor.portName}`; qualified.push(net); }
      continue;
    }
    const where = same.map((net) => `${net.scope} net on ${net.sheetIds.map((id) => pathOf.get(id) || "the overview").join(" + ")}`).join("; ");
    diagnostics.push({ code: "SHEET_NET_NAME_COLLISION", severity: "error", message: `${same.length} different nets are all named ${name} (${where}). Rename one label, or make the labels global if they are meant to be one net.`, refs: same.map((net) => net.id) });
  }
  if (qualified.length > 0) {
    const qualifiedSet = new Set(qualified);
    const taken = new Set(nets.filter((net) => net.name !== null && !qualifiedSet.has(net)).map((net) => netLabelNameKey(net.name!)));
    for (const net of [...qualified].sort((a, b) => compareCodePoints(a.id, b.id))) {
      const base = net.name!;
      let unique = base;
      for (let suffix = 2; taken.has(netLabelNameKey(unique)); suffix += 1) unique = `${base}_${suffix}`;
      net.name = unique;
      taken.add(netLabelNameKey(unique));
    }
  }
  nets.sort(compareNets);

  // [PR-J1 integration, 2026-10-22] review PC-6: a LOCAL label that carries a port anchor's name on the same sheet, on a different net,
  // is never joined by name (J.4: ports connect by identity) and is always flagged - whether or not the port is bound - so the drawing
  // never silently means two nets where KiCad would read one.
  const netOfLabel = new Map<string, ProjectNet>();
  for (const net of nets) for (const label of net.labels) netOfLabel.set(label.id, net);
  const siteKey = (label: NetLabel): string => JSON.stringify([sheetOf(label), netLabelNameKey(label.name)]);
  const anchorsAt = new Map<string, NetLabel[]>();
  for (const anchor of netLabels) if (anchor.scope === "hierarchical" || anchor.scope === "sheet-pin") anchorsAt.set(siteKey(anchor), [...(anchorsAt.get(siteKey(anchor)) ?? []), anchor]);
  const shadows = new Map<string, { sheetId: string; name: string; refs: Set<string> }>();
  for (const local of netLabels) {
    if (local.scope !== undefined || local.kind !== "label") continue;
    for (const anchor of anchorsAt.get(siteKey(local)) ?? []) {
      if (netOfLabel.get(anchor.id) === netOfLabel.get(local.id)) continue;
      const entry = shadows.get(siteKey(local)) ?? { sheetId: sheetOf(local), name: netLabelNameKey(local.name), refs: new Set<string>() };
      entry.refs.add(local.id).add(anchor.id);
      shadows.set(siteKey(local), entry);
    }
  }
  for (const { sheetId, name, refs } of shadows.values()) {
    const where = pathOf.get(sheetId) ? `sheet "${pathOf.get(sheetId)}"` : "the overview";
    diagnostics.push({ code: "SHEET_LOCAL_SHADOWS_PORT", severity: "warning", message: `On ${where}, the local label ${name} and the port label ${name} are different nets: a port connects only through its sheet pin and hierarchical label, never by a same-named label. Wire them together if they are one signal, or rename the local label.`, refs: sortedUnique(refs) });
  }
  return finish({ mode: "multi-sheet", diagnostics, pins, nets, kicadPinsResolved: getPart !== undefined, unresolvedPartIds: unresolved, railJoins, keyOf, uf, netByRoot });
}
