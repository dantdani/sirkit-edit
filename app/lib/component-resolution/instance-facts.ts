/**
 * [PR-M, 2026-10-17] Section M.2.1: SCHEMATIC-INSTANCE INSPECTION WITHOUT A PCB - the one pure derivation behind
 * `sirkit.schematic.instance-inspect` and the resolution proposal's own reading of the instances it targets.
 *
 * Over the run's VALIDATED schematic snapshot (the gateway's integrity check digest-pins it) and the SERVER catalog facts of the
 * parts the instances were placed from, it reports per instance: the stable instance id (the only durable mutation target - a
 * reference designator is a display label), the displayed reference, the value, the catalog part and exact atomic revision with its
 * catalog status, whether the instance is one the Schematic -> PCB run would refuse (`listUnresolvedInstances`, the editor's own
 * rule) and why, the published exact revision the instance's OWN catalog part links for its value (an exact-asset binding that needs
 * no part change), the symbol's pins with number / name / electrical type / function FROM THE CATALOG SYMBOL, each pin's connected
 * net and its other members, and - for a polar two-terminal part - which net sits on the anode and which on the cathode.
 *
 * Connectivity is the production netlist derivation (`buildNetlist`, app/lib/pcb/netlist-bridge.ts: the editor's union-find over
 * wires, labels and pin sites) over the server catalog's pins; a KiCad instance whose catalog part is not available has no pin
 * sites, so its pins are reported `unavailable` (never guessed) and the derivation says how many such instances there are. No
 * board is read or needed: the editor's own Prepare PCB is board-less, and this inspection exists to repair what blocks it.
 *
 * Pure: no I/O, no clock.
 */
import type { SchematicState, KicadComponentInstance } from "@/lib/schematic-types";
import { normalizeRefDes, schDisplayRef } from "@/lib/schematic-types";
import type { KicadPin } from "../kicad/types";
import type { CatalogPartDetail } from "../atomic/catalog-part-detail";
import type { AtomicRevisionStatus } from "../atomic/revision-status";
import { normalizeValueKey } from "../atomic/value-key";
import { buildNetlist, type NetlistPartData, type PcbNetlist } from "../pcb/netlist-bridge";
import { listUnresolvedInstances, UNRESOLVED_MISSING_LABEL, type UnresolvedInstanceMissing } from "../pcb-sync/unresolved-instances";
import { theoryPinContract } from "../schematic/theory-physicality";
import { functionalClassOf, pinFunctionOf, POLAR_TWO_TERMINAL_CLASSES, type FunctionalClass, type PinFunction } from "./pin-functions";

export const INSTANCE_INSPECTION_SCHEMA = "sirkit.schematic-instance-inspection.v1" as const;
export const MAX_INSPECTED_INSTANCES = 50;
export const MAX_INSPECTED_INSTANCE_PINS = 64;
export const MAX_NET_MEMBERS_LISTED = 12;

/** One catalog part as the server catalog port answered it (the same answer the catalog inspection projects). */
export type CatalogPartLoad =
  | { state: "found"; detail: CatalogPartDetail; revisionStatus: Readonly<Record<string, AtomicRevisionStatus>> }
  | { state: "not_found" }
  | { state: "unavailable"; reason: string };

export interface InstanceNetFact { id: number; name: string; members: string[]; memberCount: number }
export interface InstancePinFact {
  number: string;
  name: string;
  electricalType: string;
  function: PinFunction;
  /** null: the pin is not connected to anything on the sheet (an unnamed single-pin root is no net, as in the netlist). */
  net: InstanceNetFact | null;
}

export interface PublishedLinkFact { valueKey: string; revisionId: string; symbolVersionId: string; footprintVersionId: string; mappingCertificateId: string; footprintFullName: string; status: { state: AtomicRevisionStatus["state"] | "unknown"; selectable: boolean | null; successorRevisionId: string | null } }

export interface SchematicInstanceFacts {
  componentId: string;
  refDes: string;
  family: "kicad" | "theory";
  value: string;
  partId: string | null;
  catalog: { state: "loaded" | "not_found" | "unavailable" | "none"; reason: string | null; part: { id: string; name: string; mpn: string | null; manufacturer: string | null; library: string; mainCategory: string; footprintHint: string | null; packageNormalized: string | null; description: string | null } | null };
  functionalClass: FunctionalClass;
  functionalClassEvidence: string;
  identity: { atomicPartRevisionId: string | null; symbolAssetVersionId: string | null; footprintAssetVersionId: string | null; mappingCertificateId: string | null; selectionRecordId: string | null };
  resolution: {
    state: "resolved" | "unresolved";
    missing: UnresolvedInstanceMissing | null;
    missingLabel: string | null;
    /** The catalog status of the revision the instance names (null: it names none, or the catalog did not answer). */
    revisionStatus: { revisionId: string; state: AtomicRevisionStatus["state"] | "unknown"; selectable: boolean | null; pinnable: boolean | null; successorRevisionId: string | null } | null;
    /** The published exact revision the instance's OWN catalog part links for its value: binding it needs no part change. */
    ownPublishedLink: PublishedLinkFact | { valueKey: string; withdrawn: true } | null;
  };
  pins: { source: "catalog-symbol" | "theory-contract" | "unavailable"; count: number; items: InstancePinFact[]; truncated: number; reason: string | null };
  /** For a polar two-terminal class: the net on the anode and on the cathode (null when that terminal is unconnected). */
  polarity: { anodeNet: string | null; cathodeNet: string | null } | null;
  connectedPins: number;
}

export interface InstanceInspection {
  schema: typeof INSTANCE_INSPECTION_SCHEMA;
  selection: "unresolved" | "requested";
  instances: SchematicInstanceFacts[];
  notFound: string[];
  counted: { selected: number; listed: number; truncated: number };
  netlistBasis: { kicadInstances: number; withCatalogPins: number; withoutCatalogPins: number; note: string };
}

/** The server catalog's pins for a placed part, as the netlist derivation reads them (null: not loaded - a pin-less instance). */
export function netlistLookupOf(parts: ReadonlyMap<string, CatalogPartLoad>): (partId: string) => NetlistPartData | null {
  return (partId) => {
    const load = parts.get(partId);
    if (!load || load.state !== "found") return null;
    return { pins: load.detail.pins as KicadPin[], footprintHint: load.detail.footprintHint, mpn: load.detail.mpn, name: load.detail.name, description: load.detail.description };
  };
}

function statusView(revisionId: string, status: Readonly<Record<string, AtomicRevisionStatus>>): { revisionId: string; state: AtomicRevisionStatus["state"] | "unknown"; selectable: boolean | null; pinnable: boolean | null; successorRevisionId: string | null } {
  const entry = Object.hasOwn(status, revisionId) ? status[revisionId] : undefined;
  return entry ? { revisionId, state: entry.state, selectable: entry.selectable, pinnable: entry.pinnable, successorRevisionId: entry.successorRevisionId ?? null } : { revisionId, state: "unknown", selectable: null, pinnable: null, successorRevisionId: null };
}

/** The published link of a catalog part for a schematic value: its own value key, else the '' default, never past a withdrawn key. */
export function ownPublishedLinkOf(detail: CatalogPartDetail, value: string, status: Readonly<Record<string, AtomicRevisionStatus>>): PublishedLinkFact | { valueKey: string; withdrawn: true } | null {
  const key = normalizeValueKey(value);
  const links = detail.atomicAssignments ?? {};
  const withdrawn = new Set(detail.withdrawnValueKeys ?? []);
  const pick = (valueKey: string): PublishedLinkFact | null => {
    if (!Object.hasOwn(links, valueKey)) return null;
    const link = links[valueKey]!;
    const view = statusView(link.revisionId, status);
    return { valueKey, revisionId: link.revisionId, symbolVersionId: link.symbolVersionId, footprintVersionId: link.footprintVersionId, mappingCertificateId: link.mappingCertificateId, footprintFullName: link.footprintFullName, status: { state: view.state, selectable: view.selectable, successorRevisionId: view.successorRevisionId } };
  };
  const own = pick(key);
  if (own) return own;
  if (withdrawn.has(key)) return { valueKey: key, withdrawn: true };
  const fallback = pick("");
  if (fallback) return fallback;
  if (withdrawn.has("")) return { valueKey: "", withdrawn: true };
  return null;
}

function netIndex(netlist: PcbNetlist, refById: ReadonlyMap<string, string>): Map<string, InstanceNetFact> {
  const byEndpoint = new Map<string, InstanceNetFact>();
  for (const net of netlist.nets) {
    const members = net.nodes.map((node) => `${refById.get(node.componentId) ?? node.componentId}.${node.pinNumber}`);
    const fact: InstanceNetFact = { id: net.id, name: net.name, members: members.slice(0, MAX_NET_MEMBERS_LISTED), memberCount: members.length };
    for (const node of net.nodes) byEndpoint.set(`${node.componentId}\u0000${node.pinNumber}`, fact);
  }
  return byEndpoint;
}

function kicadFacts(instance: KicadComponentInstance, load: CatalogPartLoad | undefined, unresolved: Map<string, UnresolvedInstanceMissing>, nets: Map<string, InstanceNetFact>): SchematicInstanceFacts {
  const detail = load?.state === "found" ? load.detail : null;
  const status = load?.state === "found" ? load.revisionStatus : {};
  const classification = detail ? functionalClassOf({ libraryName: detail.libraryName, name: detail.name, description: detail.description, keywords: detail.keywords, properties: detail.properties }) : { functionalClass: "unknown" as FunctionalClass, evidence: "no catalog part record" };
  const pins = detail ? (detail.pins as KicadPin[]) : [];
  const items: InstancePinFact[] = pins.slice(0, MAX_INSPECTED_INSTANCE_PINS).map((pin) => {
    const net = nets.get(`${instance.id}\u0000${pin.number}`) ?? null;
    return { number: pin.number, name: pin.name, electricalType: pin.type, function: pinFunctionOf(pin, classification.functionalClass), net };
  });
  const missing = unresolved.get(instance.id) ?? null;
  const polar = (POLAR_TWO_TERMINAL_CLASSES as readonly string[]).includes(classification.functionalClass);
  return {
    componentId: instance.id,
    refDes: instance.refDes,
    family: "kicad",
    value: instance.value,
    partId: instance.partId,
    catalog: detail
      ? { state: "loaded", reason: null, part: { id: detail.id, name: detail.name, mpn: detail.mpn ?? null, manufacturer: detail.manufacturer ?? null, library: detail.libraryName, mainCategory: detail.mainCategory, footprintHint: detail.footprintHint ?? null, packageNormalized: detail.packageNormalized ?? null, description: detail.description ?? null } }
      : { state: load?.state === "not_found" ? "not_found" : "unavailable", reason: load === undefined ? "the catalog was not asked (no catalog port is bound to this run)" : load.state === "not_found" ? "no catalog part has the placed part id" : load.state === "unavailable" ? load.reason : null, part: null },
    functionalClass: classification.functionalClass,
    functionalClassEvidence: classification.evidence,
    identity: { atomicPartRevisionId: instance.atomicPartRevisionId ?? null, symbolAssetVersionId: instance.symbolAssetVersionId ?? null, footprintAssetVersionId: instance.footprintAssetVersionId ?? null, mappingCertificateId: instance.mappingCertificateId ?? null, selectionRecordId: instance.selectionRecordId ?? null },
    resolution: {
      state: missing ? "unresolved" : "resolved",
      missing,
      missingLabel: missing ? UNRESOLVED_MISSING_LABEL[missing] : null,
      revisionStatus: instance.atomicPartRevisionId ? statusView(instance.atomicPartRevisionId, status) : null,
      ownPublishedLink: detail ? ownPublishedLinkOf(detail, instance.value, status) : null,
    },
    pins: detail
      ? { source: "catalog-symbol", count: pins.length, items, truncated: Math.max(0, pins.length - items.length), reason: null }
      : { source: "unavailable", count: 0, items: [], truncated: 0, reason: "the symbol's pins are known only from the server catalog part the instance was placed from, which is not available to this run - never from a browser pin list" },
    polarity: polar ? { anodeNet: items.find((pin) => pin.function.kind === "anode")?.net?.name ?? null, cathodeNet: items.find((pin) => pin.function.kind === "cathode")?.net?.name ?? null } : null,
    connectedPins: items.filter((pin) => pin.net !== null).length,
  };
}

function theoryFacts(component: SchematicState["components"][number], nets: Map<string, InstanceNetFact>): SchematicInstanceFacts {
  const contract = theoryPinContract(component.type);
  const functionalClass: FunctionalClass = component.type === "diode" ? "diode" : component.type === "resistor" ? "resistor" : component.type === "capacitor" ? "capacitor" : component.type === "inductor" ? "inductor" : "unknown";
  const items: InstancePinFact[] = Object.entries(contract ?? {}).sort(([, a], [, b]) => a.localeCompare(b)).map(([name, number]) => ({
    number, name, electricalType: "passive",
    function: name === "anode" ? { kind: "anode", key: "anode" } : name === "cathode" ? { kind: "cathode", key: "cathode" } : { kind: "numbered", key: `number:${number}` },
    net: nets.get(`${component.id}\u0000${number}`) ?? null,
  }));
  return {
    componentId: component.id,
    refDes: normalizeRefDes(schDisplayRef(component)),
    family: "theory",
    value: component.value,
    partId: null,
    catalog: { state: "none", reason: "a Theory symbol names no catalog part", part: null },
    functionalClass,
    functionalClassEvidence: `Theory type "${component.type}"`,
    identity: { atomicPartRevisionId: null, symbolAssetVersionId: null, footprintAssetVersionId: null, mappingCertificateId: null, selectionRecordId: null },
    resolution: contract ? { state: "unresolved", missing: "theory_symbol_only", missingLabel: UNRESOLVED_MISSING_LABEL.theory_symbol_only, revisionStatus: null, ownPublishedLink: null } : { state: "resolved", missing: null, missingLabel: null, revisionStatus: null, ownPublishedLink: null },
    pins: contract ? { source: "theory-contract", count: items.length, items, truncated: 0, reason: null } : { source: "unavailable", count: 0, items: [], truncated: 0, reason: "a simulation stimulus has no physical pins" },
    polarity: functionalClass === "diode" ? { anodeNet: items.find((pin) => pin.function.kind === "anode")?.net?.name ?? null, cathodeNet: items.find((pin) => pin.function.kind === "cathode")?.net?.name ?? null } : null,
    connectedPins: items.filter((pin) => pin.net !== null).length,
  };
}

/**
 * Inspect the selected instances: every unresolved one (the editor's refusal list) or the requested stable ids / references. A
 * requested target that names no instance is listed in `notFound` (data, never an error). Bounded to MAX_INSPECTED_INSTANCES.
 */
export function inspectSchematicInstances(input: { state: SchematicState; targets: readonly string[] | "unresolved"; parts: ReadonlyMap<string, CatalogPartLoad> }): InstanceInspection {
  const { state } = input;
  const kicad = state.kicadComponents ?? [];
  const netlist = buildNetlist(state, netlistLookupOf(input.parts));
  const refById = new Map(netlist.components.map((component) => [component.id, component.ref] as const));
  const nets = netIndex(netlist, refById);
  const unresolvedList = listUnresolvedInstances(state);
  const unresolvedKicad = new Map<string, UnresolvedInstanceMissing>();
  for (const instance of kicad) {
    const missing = !instance.atomicPartRevisionId ? "published_exact_revision" : !instance.symbolAssetVersionId ? "symbol_asset" : null;
    if (missing) unresolvedKicad.set(instance.id, missing);
  }
  type Selected = { kind: "kicad"; instance: KicadComponentInstance } | { kind: "theory"; component: SchematicState["components"][number] };
  const selected: Selected[] = [];
  const notFound: string[] = [];
  if (input.targets === "unresolved") {
    for (const item of unresolvedList) {
      // one listed row per instance: a reference shared by two instances maps each row to the next unlisted one (by stable id)
      if (item.family === "kicad") {
        const instance = kicad.find((candidate) => candidate.refDes === item.refDes && unresolvedKicad.has(candidate.id) && !selected.some((entry) => entry.kind === "kicad" && entry.instance.id === candidate.id));
        if (instance) selected.push({ kind: "kicad", instance });
      } else {
        const component = state.components.find((candidate) => normalizeRefDes(schDisplayRef(candidate)) === item.refDes && theoryPinContract(candidate.type) !== null && !selected.some((entry) => entry.kind === "theory" && entry.component.id === candidate.id));
        if (component) selected.push({ kind: "theory", component });
      }
    }
  } else {
    for (const target of input.targets) {
      const instance = kicad.find((candidate) => candidate.id === target) ?? kicad.find((candidate) => candidate.refDes === target);
      if (instance) { if (!selected.some((entry) => entry.kind === "kicad" && entry.instance.id === instance.id)) selected.push({ kind: "kicad", instance }); continue; }
      const component = state.components.find((candidate) => candidate.id === target) ?? state.components.find((candidate) => normalizeRefDes(schDisplayRef(candidate)) === target);
      if (component) { if (!selected.some((entry) => entry.kind === "theory" && entry.component.id === component.id)) selected.push({ kind: "theory", component }); continue; }
      notFound.push(target.slice(0, 64));
    }
  }
  const listed = selected.slice(0, MAX_INSPECTED_INSTANCES);
  const instances = listed.map((entry) => (entry.kind === "kicad" ? kicadFacts(entry.instance, input.parts.get(entry.instance.partId), unresolvedKicad, nets) : theoryFacts(entry.component, nets)));
  const withPins = kicad.filter((instance) => input.parts.get(instance.partId)?.state === "found").length;
  return {
    schema: INSTANCE_INSPECTION_SCHEMA,
    selection: input.targets === "unresolved" ? "unresolved" : "requested",
    instances,
    notFound,
    counted: { selected: selected.length, listed: listed.length, truncated: Math.max(0, selected.length - listed.length) },
    netlistBasis: {
      kicadInstances: kicad.length,
      withCatalogPins: withPins,
      withoutCatalogPins: kicad.length - withPins,
      note: kicad.length === withPins
        ? "every KiCad instance's pins come from its server catalog part; nets are the editor's own union-find over wires, labels and pin sites"
        : `${kicad.length - withPins} KiCad instance(s) have no server catalog pins in this run: their pins are unavailable and a net they sit on lists only the members whose pins are known`,
    },
  };
}
