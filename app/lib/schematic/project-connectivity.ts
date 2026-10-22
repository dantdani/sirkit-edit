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
 * is refused by the canonical executor (OD-255 item 4, `railJoinKeys`).
 *
 * Pure: no I/O, no randomness. KiCad pin positions come from the caller's part lookup (the parts cache in the browser, the committed
 * catalog in tests); without one, KiCad parts contribute no pins (connectivity between labels and wires is unaffected).
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
import { sheetDepth, sheetOf, sheetPathName, validateSheetHierarchy, type SheetDiagnosticCode } from "./sheets";

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

export type ConnectivityDiagnosticCode = SheetDiagnosticCode | "ISOLATION_DOMAIN_JOIN" | "POWER_RAIL_JOIN" | "LEGACY_GROUND_NAME_COLLAPSE" | "SHEET_NET_NAME_COLLISION";

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
    if (ground.length >= 2 || (ground.length >= 1 && power.length >= 1)) {
      const names = sortedUnique([...ground, ...power]);
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
  return state.sheets === undefined ? resolveSingleSheet(state, getPart) : resolveMultiSheet(state, getPart);
}

/** The rail-join keys of a document without part data (labels, wires and Theory symbols decide them): what sheet operations compare. */
export function railJoinKeys(state: SchematicState): string[] {
  return resolveProjectConnectivity(state).railJoins;
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
  const collapsedGroundNames = sortedUnique([...buckets.values()].flatMap((bucket) => railNames(bucket).ground)).filter((name) => name !== "GND");
  if (collapsedGroundNames.length > 0) {
    diagnostics.push({
      code: "LEGACY_GROUND_NAME_COLLAPSE", severity: "warning",
      message: `This single-sheet design's PCB netlist and ERC publish every ground label as one net named GND: ${["GND", ...collapsedGroundNames].join(", ")} are joined (the legacy rule, kept so existing boards keep their nets; OD-255 item 3). A multi-sheet project keeps each ground name separate, so organizing this design into sheets would split that net.`,
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
  for (const [groupKey, roots] of groups) {
    const parts = roots.map((root) => buckets.get(root)!);
    const groupPins = parts.flatMap((bucket) => bucket.pins);
    const labels = netLabels.filter((label) => parts.some((bucket) => bucket.labels.includes(label))).map(labelRef);
    const members = sortedUnique(groupPins.map((pin) => pin.key));
    const named = groupKey.startsWith("name\u0000") ? groupKey.slice(5) : null;
    const groundSymbol = parts.some((bucket) => bucket.groundSymbol);
    const kind: ProjectNetKind = named === null ? "unnamed" : groundSymbol || labels.some((label) => label.kind === "ground") ? "ground" : labels.some((label) => label.kind === "power") ? "power" : "label";
    const net: ProjectNet = {
      id: netIdentity(members, labels), name: named, kind, scope: named === null ? "local" : "global", homeSheetId: ROOT_SHEET_ID, sheetIds: [ROOT_SHEET_ID],
      members, pins: pins.filter((pin) => groupPins.includes(pin)), labels, portIds: [], groundSymbol, rootKeys: sortedUnique(roots),
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
    else {
      const onHome = bucket.labels.filter((label) => sheetOf(label) === homeSheetId);
      const candidate = sortedUnique(onHome.filter((label) => label.scope === undefined).map((label) => netLabelNameKey(label.name)))[0]
        ?? sortedUnique(onHome.filter((label) => label.scope === "hierarchical" || label.scope === "sheet-pin").map((label) => netLabelNameKey(label.name)))[0];
      if (candidate !== undefined) { name = homeSheetId === ROOT_SHEET_ID ? candidate : `${pathOf.get(homeSheetId)}/${candidate}`; kind = "label"; }
    }
    const members = sortedUnique(bucket.pins.map((pin) => pin.key));
    const net: ProjectNet = {
      id: netIdentity(members, labels), name, kind, scope, homeSheetId, sheetIds, members, pins: bucket.pins, labels,
      portIds: sortedUnique(bucket.labels.flatMap((label) => (label.portId !== undefined ? [label.portId] : []))), groundSymbol: bucket.groundSymbol, rootKeys: [root],
    };
    nets.push(net);
    netByRoot.set(root, net);
  }
  nets.sort(compareNets);

  // Distinct nets must never share a display / board name (a local label shadowing a global name, for example).
  const byName = new Map<string, ProjectNet[]>();
  for (const net of nets) if (net.name !== null) byName.set(netLabelNameKey(net.name), [...(byName.get(netLabelNameKey(net.name)) ?? []), net]);
  for (const [name, same] of byName) {
    if (same.length < 2) continue;
    const where = same.map((net) => `${net.scope} net on ${net.sheetIds.map((id) => pathOf.get(id) || "the overview").join(" + ")}`).join("; ");
    diagnostics.push({ code: "SHEET_NET_NAME_COLLISION", severity: "error", message: `${same.length} different nets are all named ${name} (${where}). Rename one label, or make the labels global if they are meant to be one net.`, refs: same.map((net) => net.id) });
  }
  return finish({ mode: "multi-sheet", diagnostics, pins, nets, kicadPinsResolved: getPart !== undefined, unresolvedPartIds: unresolved, railJoins, keyOf, uf, netByRoot });
}
