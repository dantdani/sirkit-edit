/**
 * Schematic → board bridge (PCB Stage 4). Pinned cross-stage contract:
 * Stages 5/6/8/9/10 consume PcbNetlist, SyncReport, syncFromSchematic and the
 * padNets field on FootprintInstance (pad number → net id, absent/0 =
 * unconnected).
 *
 * Sync is FORWARD-ONLY: the schematic is the source of truth; this module
 * never writes schematic state. Numeric net ids are rebuilt deterministically
 * for serialization, while persistent stable ids are reconciled from exact
 * schematic endpoint membership so renames and numeric reordering cannot move
 * copper to a different electrical net.
 *
 * Footprint resolution is deterministic-first: (1) the symbol's footprint
 * hint via /api/pcb/footprints/resolve, (2) the package-map heuristic table,
 * (3) the assignment queue (AI suggestions run on-demand there, never during
 * sync). Every tier must pass explicit, lossless pin-to-pad accounting.
 */

import type { SchematicState } from "@/lib/schematic-types";
import { netLabelNameKey, normalizeRefDes, schDisplayRef } from "@/lib/schematic-types";
import type { KicadPin } from "@/app/lib/kicad/types";
import { buildNetUnionFind } from "@/app/lib/connectivity";
import { pinWorldPos, kicadPinWorldPos, pointKey } from "@/app/lib/geometry";
import type { Point } from "@/lib/schematic-types";
import type { FootprintSearchHit } from "./footprint-api-types";
import { parseKicadMod } from "./kicad-mod";
import { heuristicFootprint, guessPackageToken } from "./package-map";
import type { FootprintDef, FootprintInstance, PcbBoard } from "./types";
import { createEmptyBoard } from "./types";
import {
  compareDiagnostics,
  engineeringDiagnostic,
  migrateBoardElectricalIdentities,
  schematicEndpointKey,
  stableNetIdForEndpoints,
  validateReferenceDesignators,
  type EngineeringDiagnostic,
} from "./integrity";
import {
  resolvePinPadMapping,
  type PinPadMappingContract,
  type PinPadMappingResult,
} from "./pin-pad-mapping";
import { reconcileBoardNets, remapNumericNetId, type NetReconciliationResult } from "./net-reconciliation";
import { mmToNm } from "./units";
import {
  bboxesOverlap,
  courtyardFitsOutline,
  localCourtyardBBox,
  outlineBBox as fullOutlineBBox,
  worldCourtyardBBox,
} from "./autoplace/geometry";
import type { BBox, Vec2 } from "./geometry";
import { reclassifyBoard } from "./netclass-rules";
import { pcbSyncDigest, publicationSourceDigest } from "../pcb-sync/stable";
import type { PcbSyncIssue, PcbSyncSchematicComponent, PcbSyncSchematicNet } from "../pcb-sync/types";
import { compareCodePoints, compareNatural } from "@/app/lib/stable-compare";
import { theoryPinContract } from "@/app/lib/schematic/theory-physicality";

// ─── Pinned netlist types ────────────────────────────────────────────────────

export interface NetlistComponent {
  id: string; // stable schematic component id
  ref: string; // 'R1'
  mpn?: string;
  value?: string;
  package?: string;
  footprintHint?: string; // 'Resistor_SMD:R_0603_1608Metric' from ingested symbol data
  pins: { number: string; name?: string }[];
  /** Optional trusted library/user mapping; absent means exact string identity only. */
  pinPadMapping?: PinPadMappingContract;
  atomicPartRevisionId?: string;
  atomicAssignment?: {
    revisionId: string;
    symbolVersionId: string;
    footprintVersionId: string;
    mappingCertificateId: string;
    footprintFullName: string;
    approved: true;
  };
}

export interface NetlistNet {
  id: number;
  name: string;
  nodes: { componentId: string; pinNumber: string }[];
  endpointKeys: string[];
}

export interface PcbNetlist {
  components: NetlistComponent[];
  nets: NetlistNet[];
}

export interface SyncReport {
  added: string[]; // component ids
  removed: string[];
  kept: string[];
  footprintChanged: string[]; // kept position, def replaced
  unresolved: { componentId: string; ref: string; reason: string }[];
  diagnostics: EngineeringDiagnostic[];
  reconciliation: NetReconciliationResult["changes"];
  resolvedBy: Record<"hint" | "heuristic" | "manual", number>;
  placement: {
    mode: "centered" | "preserved-staging";
    spreadOverlaps: boolean;
    allInsideBoard: boolean;
    overlapCount: number;
    warning?: string;
  };
}

// ─── Part lookup (client injects the parts cache; tests inject fixtures) ────

/**
 * Static catalog data for a placed KiCad component. Structurally satisfied by
 * `CachedPart` from app/lib/parts-cache.ts — the schematic state stores only
 * partIds, so buildNetlist needs a resolver for pins/hints. A null return
 * yields a pin-less component that lands in the assignment queue.
 */
export interface NetlistPartData {
  pins: KicadPin[];
  footprintHint?: string | null;
  mpn?: string | null;
  name?: string | null;
  description?: string | null;
  /** Trusted library enrichment. Without it, exact pin-number = pad-number is required. */
  pinPadMapping?: PinPadMappingContract;
  /** Exact Stage 5 bundle. Candidates/hints must not populate this field. */
  atomicAssignment?: NetlistComponent["atomicAssignment"];
}

export type PartLookup = (partId: string) => NetlistPartData | null;

// ─── Netlist derivation ──────────────────────────────────────────────────────

/**
 * [B10.2] THE production physical-theory-component rule (`theoryPinContract`: theory pin name → pad number, diode pad 1 the
 * cathode; null for ground symbols and voltage/current sources, which are sim stimuli with no board footprint), re-exported so
 * every consumer of this module keeps reading it here. [PR-G, 2026-10-17] Its one table now lives in
 * app/lib/schematic/theory-physicality.ts (moved verbatim), so the Stage 3 preparation reads in app/lib/pcb-sync/ share it
 * without importing this bridge, which the Stage 3 security property forbids there.
 */
export { theoryPinContract };

const THEORY_REF_PREFIX: Record<string, string> = {
  resistor: "R",
  capacitor: "C",
  inductor: "L",
  diode: "D",
};

/**
 * Derive the netlist from Build-mode schematic state via the same union-find
 * the editor uses. `getPart` resolves placed KiCad components' catalog data
 * (pass the parts cache's getCachedPart after awaiting loads); it defaults to
 * a null lookup so theory-only schematics work without it.
 *
 * Net naming: net labels win; ground-kind labels and ground symbols → GND;
 * power ports keep their port name; everything else N$<id>.
 */
export function buildNetlist(
  schematic: SchematicState,
  getPart: PartLookup = () => null,
): PcbNetlist {
  const theoryComps = schematic.components;
  const kicadComps = schematic.kicadComponents ?? [];
  const netLabels = schematic.netLabels ?? [];
  const wires = schematic.wires;

  // Pin sites: (componentId, pinNumber) → world point, for every physical part.
  type PinSite = { componentId: string; pinNumber: string; point: Point };
  const pinSites: PinSite[] = [];
  const components: NetlistComponent[] = [];

  // Theory passives/diodes are physical parts; ground symbols become the GND
  // net; voltage/current sources are sim stimuli with no board footprint.
  // B07.1 — the netlist reference IS the component's displayed reference
  // (`refDes ?? id`), never a positionally synthesized one: identity stays on
  // `id`, presentation follows the editable display reference everywhere.
  for (const c of theoryComps) {
    const pinMap = theoryPinContract(c.type);
    if (!pinMap) continue;
    const pins = Object.entries(pinMap).map(([pinName, number]) => {
      pinSites.push({ componentId: c.id, pinNumber: number, point: pinWorldPos(c, pinName) });
      return { number, name: pinName };
    });
    pins.sort((a, b) => compareCodePoints(a.number, b.number));
    components.push({ id: c.id, ref: normalizeRefDes(schDisplayRef(c)), value: c.value, pins });
  }

  const kicadPinPoints: Point[] = [];
  for (const inst of kicadComps) {
    const part = getPart(inst.partId);
    const pins: NetlistComponent["pins"] = [];
    for (const pin of part?.pins ?? []) {
      const point = kicadPinWorldPos(inst, pin);
      kicadPinPoints.push(point);
      pinSites.push({ componentId: inst.id, pinNumber: pin.number, point });
      pins.push({
        number: pin.number,
        ...(pin.name && pin.name !== "~" ? { name: pin.name } : {}),
      });
    }
    const pkg = guessPackageToken([part?.footprintHint, inst.value, part?.mpn, part?.name, part?.description]);
    components.push({
      id: inst.id,
      ref: inst.refDes,
      ...(part?.mpn ? { mpn: part.mpn } : {}),
      value: inst.value,
      ...(pkg ? { package: pkg } : {}),
      ...(part?.footprintHint ? { footprintHint: part.footprintHint } : {}),
      ...(part?.pinPadMapping ? { pinPadMapping: part.pinPadMapping } : {}),
      ...(inst.atomicPartRevisionId ? { atomicPartRevisionId: inst.atomicPartRevisionId } : {}),
      ...(part?.atomicAssignment &&
        part.atomicAssignment.revisionId === inst.atomicPartRevisionId &&
        part.atomicAssignment.symbolVersionId === inst.symbolAssetVersionId &&
        part.atomicAssignment.footprintVersionId === inst.footprintAssetVersionId &&
        part.atomicAssignment.mappingCertificateId === inst.mappingCertificateId
        ? { atomicAssignment: part.atomicAssignment }
        : {}),
      pins,
    });
  }

  // Same union-find the editor and SPICE export use.
  const uf = buildNetUnionFind(theoryComps, wires, kicadPinPoints, netLabels);

  // Group component pins by net root.
  const refById = new Map(components.map((c) => [c.id, c.ref]));
  type NodeRec = { componentId: string; pinNumber: string; ref: string };
  const rootNodes = new Map<string, NodeRec[]>();
  for (const site of pinSites) {
    const root = uf.find(pointKey(site.point));
    const bucket = rootNodes.get(root) ?? [];
    bucket.push({
      componentId: site.componentId,
      pinNumber: site.pinNumber,
      ref: refById.get(site.componentId) ?? "",
    });
    rootNodes.set(root, bucket);
  }

  // Name votes per root: ground beats power beats generic label.
  const rootGround = new Set<string>();
  const rootPower = new Map<string, string[]>();
  const rootLabel = new Map<string, string[]>();
  for (const label of netLabels) {
    const key = pointKey(label.position);
    if (!uf.has(key)) continue;
    const root = uf.find(key);
    const name = netLabelNameKey(label.name);
    if (label.kind === "ground") rootGround.add(root);
    else if (label.kind === "power") rootPower.set(root, [...(rootPower.get(root) ?? []), name]);
    else rootLabel.set(root, [...(rootLabel.get(root) ?? []), name]);
  }
  for (const c of theoryComps) {
    if (c.type !== "ground") continue;
    const key = pointKey(pinWorldPos(c, "pin"));
    if (uf.has(key)) rootGround.add(uf.find(key));
  }

  const nameOfRoot = (root: string): string | null => {
    if (rootGround.has(root)) return "GND";
    const power = rootPower.get(root);
    if (power && power.length > 0) return [...power].sort()[0];
    const label = rootLabel.get(root);
    if (label && label.length > 0) return [...label].sort()[0];
    return null;
  };

  // Merge same-named roots (two unwired ground symbols are still one GND net),
  // drop node-less roots, then assign deterministic ids: named nets sorted
  // alphabetically get 1..k, unnamed nets follow in stable node-key order.
  const compareNodes = (a: NodeRec, b: NodeRec): number =>
    a.ref === b.ref ? compareNatural(a.pinNumber, b.pinNumber) : compareNatural(a.ref, b.ref);

  const namedNets = new Map<string, NodeRec[]>();
  const unnamedNets: NodeRec[][] = [];
  for (const [root, nodes] of rootNodes) {
    if (nodes.length === 0) continue;
    const name = nameOfRoot(root);
    if (name !== null) namedNets.set(name, [...(namedNets.get(name) ?? []), ...nodes]);
    // An unnamed single-pin root is just an unconnected pad — no net (its pad
    // stays absent from padNets). A NAMED singleton keeps its net: a labeled
    // pin is a real net waiting for its peers.
    else if (nodes.length >= 2) unnamedNets.push(nodes);
  }

  const nodeKey = (nodes: NodeRec[]): string =>
    nodes.map((n) => `${n.ref}.${n.pinNumber}`).sort()[0] ?? "";
  unnamedNets.sort((a, b) => compareNatural(nodeKey(a), nodeKey(b)));

  const nets: NetlistNet[] = [];
  let nextId = 1;
  for (const name of [...namedNets.keys()].sort()) {
    const nodes = namedNets.get(name)!.sort(compareNodes);
    nets.push({
      id: nextId++,
      name,
      nodes: nodes.map(({ componentId, pinNumber }) => ({ componentId, pinNumber })),
      endpointKeys: nodes.map(({ componentId, pinNumber }) => schematicEndpointKey(componentId, pinNumber)).sort(),
    });
  }
  for (const nodes of unnamedNets) {
    const id = nextId++;
    nets.push({
      id,
      name: `N$${id}`,
      nodes: nodes.sort(compareNodes).map(({ componentId, pinNumber }) => ({ componentId, pinNumber })),
      endpointKeys: nodes.map(({ componentId, pinNumber }) => schematicEndpointKey(componentId, pinNumber)).sort(),
    });
  }

  return { components, nets };
}

/** Cheap deterministic hash of a netlist — drives the "schematic changed since last sync" badge. */
export function netlistHash(netlist: PcbNetlist): string {
  const s = JSON.stringify(netlist);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Deterministic, non-mutating graph accepted by the durable PCB-sync publisher. */
export interface PcbSyncPublicationGraph { components: PcbSyncSchematicComponent[]; nets: PcbSyncSchematicNet[]; prerequisiteIssues: PcbSyncIssue[]; sourceDigest: string }

export function buildPcbSyncPublicationGraph(schematic: SchematicState, getPart: PartLookup = () => null): PcbSyncPublicationGraph {
  const netlist = buildNetlist(schematic, getPart), refs = new Set<string>(), componentIds = new Set<string>(), pinIds = new Set<string>(), connected = new Set<string>();
  const instanceById = new Map((schematic.kicadComponents ?? []).map((item) => [item.id, item]));
  const theoryById = new Map(schematic.components.map((item) => [item.id, item]));
  for (const component of netlist.components) {
    if (componentIds.has(component.id) || refs.has(component.ref)) throw new Error("PS_COMPONENT_IDENTITY_DUPLICATE");
    componentIds.add(component.id); refs.add(component.ref);
    const numbers = new Set<string>();
    for (const pin of component.pins) { const pinId = `${component.id}:pin:${pin.number}`; if (numbers.has(pin.number) || pinIds.has(pinId)) throw new Error("PS_PIN_IDENTITY_DUPLICATE"); numbers.add(pin.number); pinIds.add(pinId); }
  }
  for (const net of netlist.nets) for (const node of net.nodes) { const pinId = `${node.componentId}:pin:${node.pinNumber}`; if (!componentIds.has(node.componentId) || !pinIds.has(pinId)) throw new Error("PS_NET_MEMBER_REFERENCE_INVALID"); if (connected.has(pinId)) throw new Error("PS_NET_MEMBER_DUPLICATE"); connected.add(pinId); }
  const components = netlist.components.map((component): PcbSyncSchematicComponent => {
    // B07.1 — the theory symbol identity derives from the component TYPE, not
    // the (renameable) display reference: renaming R3 → RSENSE must not
    // change which symbol asset the component publishes.
    const instance = instanceById.get(component.id), theory = theoryById.get(component.id);
    const symbolAssetVersionId = instance?.symbolAssetVersionId ?? (instance ? "" : theory ? `sirkit.theory-symbol:${(THEORY_REF_PREFIX[theory.type] ?? "x").toLowerCase()}:v1` : "");
    if (!symbolAssetVersionId) throw new Error("PS_SYMBOL_ASSET_REQUIRED");
    const pins = component.pins.map((pin) => ({ pinInstanceId: `${component.id}:pin:${pin.number}`, number: pin.number, ...(pin.name ? { name: pin.name } : {}), disposition: connected.has(`${component.id}:pin:${pin.number}`) ? "connected" as const : "unconnected" as const }));
    return { componentInstanceId: component.id, componentRevision: `schematic-component:${pcbSyncDigest({ id: component.id, ref: component.ref, value: component.value, symbolAssetVersionId, pins })}`, referenceDesignator: component.ref, ...(component.value ? { value: component.value } : {}), hierarchyPath: ["root"], symbolAssetVersionId, applicability: "applicable", pins };
  }).sort((a, b) => compareNatural(a.referenceDesignator, b.referenceDesignator));
  const netIds = new Set<string>(), nets = netlist.nets.map((net): PcbSyncSchematicNet => {
    const members = net.nodes.map((node) => ({ componentInstanceId: node.componentId, pinInstanceId: `${node.componentId}:pin:${node.pinNumber}`, pinNumber: node.pinNumber })).sort((a, b) => compareCodePoints(a.pinInstanceId, b.pinInstanceId));
    if (!members.length) throw new Error("PS_NET_MEMBER_REFERENCE_INVALID");
    // RC01/MFG parity recomputes canonical endpoint-derived identity
    // (integrity.ts stableNetIdForEndpoints) from the source netlist, so the
    // published identity must be the same scheme — not an ad-hoc member digest.
    const stableNetId = stableNetIdForEndpoints(net.endpointKeys, net.name); if (netIds.has(stableNetId)) throw new Error("PS_NET_IDENTITY_DUPLICATE"); netIds.add(stableNetId);
    const name = net.name.trim(), upper = name.toUpperCase(), classification: PcbSyncSchematicNet["classification"] = /^(GND|VSS|AGND|DGND|PGND)/.test(upper) ? "ground" : /^(VCC|VDD|VBUS|VIN|\+)/.test(upper) ? "power" : "signal";
    return { stableNetId, connectivityRevision: `connectivity:${pcbSyncDigest({ stableNetId, members })}`, canonicalScope: ["root"], displayName: name, aliases: [], classification, members, explicitNoConnectPinIds: [], constraintRefs: [] };
  }).sort((a, b) => compareCodePoints(a.stableNetId, b.stableNetId));
  // Digest the SHARED canonical form the publisher recomputes server-side —
  // digesting these arrays as built would disagree with it (different component,
  // pin and member orderings) and publication would reject a valid graph.
  const prerequisiteIssues: PcbSyncIssue[] = [], sourceDigest = publicationSourceDigest({ components, nets, prerequisiteIssues });
  return { components, nets, prerequisiteIssues, sourceDigest };
}

// ─── Footprint resolution ────────────────────────────────────────────────────

/** Thin async boundary over Stage 2's footprint API; tests inject fixtures. */
export interface FootprintResolver {
  /** Exact "Lib:Name" lookup — GET /api/pcb/footprints/resolve. */
  resolve(fullName: string): Promise<FootprintSearchHit | null>;
  /** Source needed to build a FootprintDef — GET /api/pcb/footprints/[id]. */
  detail(id: string): Promise<{ libName: string; rawSexpr: string } | null>;
}

/** Browser-side resolver hitting the Stage 2 routes. */
export function createFetchFootprintResolver(): FootprintResolver {
  return {
    async resolve(fullName) {
      const res = await fetch(`/api/pcb/footprints/resolve?hint=${encodeURIComponent(fullName)}`);
      if (!res.ok) return null;
      const body = (await res.json()) as { hit?: FootprintSearchHit | null };
      return body.hit ?? null;
    },
    async detail(id) {
      const res = await fetch(`/api/pcb/footprints/${id}`);
      if (!res.ok) return null;
      const body = (await res.json()) as { libName?: string; rawSexpr?: string };
      return typeof body.libName === "string" && typeof body.rawSexpr === "string"
        ? { libName: body.libName, rawSexpr: body.rawSexpr }
        : null;
    },
  };
}

// ─── Staging strip placement ─────────────────────────────────────────────────

const STRIP_GAP = mmToNm(2);
const STRIP_ROW_WIDTH = mmToNm(50);

function outlineBBox(board: PcbBoard): { minX: number; minY: number } {
  const o = board.outline;
  if (o.kind === "polygon") {
    return {
      minX: Math.min(...o.points.map((p) => p.x)),
      minY: Math.min(...o.points.map((p) => p.y)),
    };
  }
  return { minX: o.origin.x, minY: o.origin.y };
}

/**
 * First free row-y in the staging strip: below any instance already sitting
 * left of the board outline, so re-syncs never stack new parts on staged ones.
 */
function stagingStartY(board: PcbBoard, outlineMinX: number, outlineMinY: number): number {
  let y = outlineMinY;
  for (const f of board.footprints) {
    if (f.at.x >= outlineMinX) continue;
    y = Math.max(y, f.at.y + f.def.bodyBBox.maxY + STRIP_GAP);
  }
  return y;
}

/** Natural ref compare: R2 before R10. */
export function compareRefs(a: string, b: string): number {
  return compareNatural(a, b, { caseInsensitive: true });
}

/**
 * Lay `defs` out in staging-strip rows left of the board outline (2 mm gaps,
 * rows wrap at 50 mm) starting below existing strip occupants. Returns the
 * center position for each entry, in input order.
 */
function layoutStagingStrip(
  board: PcbBoard,
  defs: FootprintDef[],
): { x: number; y: number }[] {
  const { minX, minY } = outlineBBox(board);
  const stripRight = minX - STRIP_GAP;
  const stripLeft = stripRight - STRIP_ROW_WIDTH;
  let cursorX = stripLeft;
  let cursorY = stagingStartY(board, minX, minY);
  let rowH = 0;
  const out: { x: number; y: number }[] = [];
  for (const def of defs) {
    const w = def.bodyBBox.maxX - def.bodyBBox.minX;
    const h = def.bodyBBox.maxY - def.bodyBBox.minY;
    if (cursorX > stripLeft && cursorX + w > stripRight) {
      cursorX = stripLeft;
      cursorY += rowH + STRIP_GAP;
      rowH = 0;
    }
    out.push({ x: cursorX - def.bodyBBox.minX, y: cursorY - def.bodyBBox.minY });
    cursorX += w + STRIP_GAP;
    rowH = Math.max(rowH, h);
  }
  return out;
}

const IMPORT_SPREAD_STEP = mmToNm(1);
const IMPORT_SPREAD_RINGS = 60;

function unionBoxes(boxes: readonly BBox[]): BBox {
  return boxes.reduce(
    (out, box) => ({
      minX: Math.min(out.minX, box.minX),
      minY: Math.min(out.minY, box.minY),
      maxX: Math.max(out.maxX, box.maxX),
      maxY: Math.max(out.maxY, box.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

function courtyardAt(def: FootprintDef, at: Vec2): BBox {
  return worldCourtyardBBox(localCourtyardBBox(def), at, 0, false);
}

function ringOffsets(ring: number): Vec2[] {
  if (ring === 0) return [{ x: 0, y: 0 }];
  const out: Vec2[] = [];
  for (let x = -ring; x <= ring; x++) out.push({ x, y: -ring });
  for (let y = -ring + 1; y <= ring; y++) out.push({ x: ring, y });
  for (let x = ring - 1; x >= -ring; x--) out.push({ x, y: ring });
  for (let y = ring - 1; y > -ring; y--) out.push({ x: -ring, y });
  return out;
}

function centeredImportPositions(
  board: PcbBoard,
  defs: readonly FootprintDef[],
  kept: readonly FootprintInstance[],
  spreadOverlaps: boolean,
): { positions: Vec2[]; placement: SyncReport["placement"] } {
  if (defs.length === 0) {
    return {
      positions: [],
      placement: {
        mode: "centered",
        spreadOverlaps,
        allInsideBoard: true,
        overlapCount: 0,
      },
    };
  }

  // Start from the established readable shelf layout, then translate the
  // entire cluster as one rigid group onto the board center.
  const staged = layoutStagingStrip({ ...board, footprints: [] }, [...defs]);
  const stagedBoxes = defs.map((def, index) => courtyardAt(def, staged[index]));
  const cluster = unionBoxes(stagedBoxes);
  const boardBox = fullOutlineBBox(board.outline);
  const translation = {
    x: Math.round((boardBox.minX + boardBox.maxX - cluster.minX - cluster.maxX) / 2),
    y: Math.round((boardBox.minY + boardBox.maxY - cluster.minY - cluster.maxY) / 2),
  };
  const centered = staged.map((at) => ({ x: at.x + translation.x, y: at.y + translation.y }));

  const occupied = kept.map((instance) =>
    worldCourtyardBBox(
      localCourtyardBBox(instance.def),
      instance.at,
      instance.rotationDeg,
      instance.side === "bottom",
    ),
  );
  const positions: Vec2[] = [];
  const newBoxes: BBox[] = [];
  for (let index = 0; index < defs.length; index++) {
    const desired = centered[index];
    let selected = desired;
    let selectedBox = courtyardAt(defs[index], selected);
    const blocked = (): boolean =>
      [...occupied, ...newBoxes].some((box) => bboxesOverlap(selectedBox, box));
    if (spreadOverlaps && (blocked() || !courtyardFitsOutline(selectedBox, board.outline))) {
      let found = false;
      for (let ring = 1; ring <= IMPORT_SPREAD_RINGS && !found; ring++) {
        for (const offset of ringOffsets(ring)) {
          const candidate = {
            x: desired.x + offset.x * IMPORT_SPREAD_STEP,
            y: desired.y + offset.y * IMPORT_SPREAD_STEP,
          };
          const candidateBox = courtyardAt(defs[index], candidate);
          if (!courtyardFitsOutline(candidateBox, board.outline)) continue;
          if ([...occupied, ...newBoxes].some((box) => bboxesOverlap(candidateBox, box))) continue;
          selected = candidate;
          selectedBox = candidateBox;
          found = true;
          break;
        }
      }
    }
    positions.push(selected);
    newBoxes.push(selectedBox);
  }

  let overlapCount = 0;
  for (let index = 0; index < newBoxes.length; index++) {
    overlapCount += occupied.filter((box) => bboxesOverlap(newBoxes[index], box)).length;
    for (let other = index + 1; other < newBoxes.length; other++) {
      if (bboxesOverlap(newBoxes[index], newBoxes[other])) overlapCount++;
    }
  }
  const allInsideBoard = newBoxes.every((box) => courtyardFitsOutline(box, board.outline));
  const warning = !allInsideBoard || overlapCount > 0
    ? "Some parts do not fit inside the current board outline. Resize the board or allow Sirkit to arrange parts."
    : undefined;
  return {
    positions,
    placement: {
      mode: "centered",
      spreadOverlaps,
      allInsideBoard,
      overlapCount,
      ...(warning ? { warning } : {}),
    },
  };
}

/**
 * Append a single new instance (assignment-queue pick), placing it in the
 * staging strip. Returns a new board; the input is not mutated.
 */
export function placeNewFootprint(
  board: PcbBoard,
  inst: Omit<FootprintInstance, "at">,
): PcbBoard {
  const def = inst.def;
  const { positions } = centeredImportPositions(board, [def], board.footprints, true);
  const at = positions[0];
  const footprints = [...board.footprints, { ...inst, at }].sort((a, b) =>
    compareCodePoints(a.id, b.id),
  );
  return { ...board, footprints };
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export interface SyncOptions {
  /** Parts-cache lookup for placed KiCad components (see PartLookup). */
  getPart?: PartLookup;
  /** Footprint API boundary; defaults to fetch()ing the Stage 2 routes. */
  resolver?: FootprintResolver;
  placement?: {
    /** Default true: translate the new-part cluster to the board center. */
    centerNewParts?: boolean;
    /** Default true: nudge new parts away from existing/new footprint courtyards. */
    spreadOverlaps?: boolean;
    /** Explicit legacy behavior: leave new parts in the staging strip. */
    preserveAbsoluteCoordinates?: boolean;
  };
}

type Resolution =
  | { ok: true; tier: "hint" | "heuristic"; fullName: string; def: FootprintDef }
  | { ok: false; reason: string };

async function resolveFootprint(
  c: NetlistComponent,
  resolver: FootprintResolver,
): Promise<Resolution> {
  if (c.pins.length === 0) {
    return { ok: false, reason: "no pin data — part catalog entry unavailable" };
  }

  const fetchDef = async (
    hit: FootprintSearchHit,
    tier: "hint" | "heuristic",
  ): Promise<Resolution> => {
    const detail = await resolver.detail(hit.id);
    if (!detail) return { ok: false, reason: `footprint source unavailable for ${hit.fullName}` };
    return { ok: true, tier, fullName: hit.fullName, def: parseKicadMod(detail.rawSexpr, detail.libName) };
  };

  // An exact Stage 5 selection may only reach PCB through its approved,
  // revision-bound bundle. Falling back to a same-name hint would detach the
  // project pin from the physical asset and is therefore rejected atomically.
  if (c.atomicPartRevisionId) {
    if (!c.atomicAssignment || !c.pinPadMapping) {
      return { ok: false, reason: "atomic component is missing an approved revision-bound footprint/mapping certificate" };
    }
    const hit = await resolver.resolve(c.atomicAssignment.footprintFullName);
    if (!hit) return { ok: false, reason: `approved atomic footprint "${c.atomicAssignment.footprintFullName}" is unavailable` };
    return fetchDef(hit, "hint");
  }

  // Tier 1: the symbol's footprint hint. A pad/pin mismatch demotes straight
  // to unresolved (the hint names a specific footprint — silently substituting
  // a different one would be worse than asking). An unknown hint falls through.
  if (c.footprintHint) {
    const hit = await resolver.resolve(c.footprintHint);
    if (hit) return fetchDef(hit, "hint");
  }

  // Tier 2: package-map heuristic, verified the same way.
  const guess = heuristicFootprint({
    ref: c.ref,
    pkg: c.package ?? guessPackageToken([c.value, c.mpn]),
    pinCount: c.pins.length,
  });
  if (guess) {
    const hit = await resolver.resolve(guess);
    if (hit) return fetchDef(hit, "heuristic");
    return { ok: false, reason: `package heuristic "${guess}" not found in footprint library` };
  }

  return {
    ok: false,
    reason: c.footprintHint
      ? `footprint hint "${c.footprintHint}" not in library and no recognizable package`
      : "no footprint hint and no recognizable package",
  };
}

/**
 * Convert the schematic into board state, resolving footprints and preserving
 * placement across re-syncs. Idempotence is a hard invariant: syncing twice
 * with no schematic change produces a deep-equal board.
 *
 * Deviation from the pinned sketch (announced day 1): async, because tiers 1–2
 * hit the footprint API; `opts` injects the parts lookup and the API boundary.
 * The returned `netlist` powers the assignment queue and the sync badge.
 */
export async function syncFromSchematic(
  schematic: SchematicState,
  existing?: PcbBoard,
  opts: SyncOptions = {},
): Promise<{
  ok: boolean;
  board: PcbBoard;
  report: SyncReport;
  netlist: PcbNetlist;
  diagnostics: EngineeringDiagnostic[];
}> {
  const resolver = opts.resolver ?? createFetchFootprintResolver();
  const netlist = buildNetlist(schematic, opts.getPart);

  const report: SyncReport = {
    added: [],
    removed: [],
    kept: [],
    footprintChanged: [],
    unresolved: [],
    diagnostics: [],
    reconciliation: [],
    resolvedBy: { hint: 0, heuristic: 0, manual: 0 },
    placement: {
      mode: "centered",
      spreadOverlaps: opts.placement?.spreadOverlaps !== false,
      allInsideBoard: true,
      overlapCount: 0,
    },
  };

  const original = existing ?? createEmptyBoard();
  const migration = migrateBoardElectricalIdentities(original);
  if (migration.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    report.diagnostics = migration.diagnostics;
    return { ok: false, board: original, report, netlist, diagnostics: report.diagnostics };
  }
  const base = migration.board;
  const existingById = new Map(base.footprints.map((f) => [f.id, f]));

  // pad number → net id, per component.
  report.diagnostics.push(...validateReferenceDesignators(netlist.components));
  const netIdByEndpoint = new Map<string, number>();
  for (const net of netlist.nets) {
    for (const endpointKey of net.endpointKeys) netIdByEndpoint.set(endpointKey, net.id);
  }

  interface PreparedComponent {
    c: NetlistComponent;
    prev?: FootprintInstance;
    fullName: string;
    def: FootprintDef;
    mapping: PinPadMappingResult;
  }
  const prepared: PreparedComponent[] = [];

  for (const c of netlist.components) {
    const prev = existingById.get(c.id);
    let fullName: string;
    let def: FootprintDef;

    if (prev) {
      report.kept.push(c.id);
      def = prev.def;
      fullName = prev.footprintId;
      // Footprint change detection is hint-string compare (MVP carve-out). On
      // resolution failure the placed def wins — never strand placed copper.
      if (c.footprintHint && c.footprintHint !== prev.footprintId) {
        const hit = await resolver.resolve(c.footprintHint);
        if (hit) {
          const detail = await resolver.detail(hit.id);
          if (detail) {
            def = parseKicadMod(detail.rawSexpr, detail.libName);
            fullName = hit.fullName;
            report.footprintChanged.push(c.id);
            report.resolvedBy.hint++;
          } else {
            const reason = `footprint source unavailable for ${hit.fullName}`;
            report.unresolved.push({ componentId: c.id, ref: c.ref, reason });
            report.diagnostics.push(engineeringDiagnostic("FOOTPRINT_RESOLUTION_FAILED", `${c.ref}: ${reason}`, { componentIds: [c.id] }));
          }
        } else {
          const reason = `footprint hint "${c.footprintHint}" not found`;
          report.unresolved.push({ componentId: c.id, ref: c.ref, reason });
          report.diagnostics.push(engineeringDiagnostic("FOOTPRINT_RESOLUTION_FAILED", `${c.ref}: ${reason}`, { componentIds: [c.id] }));
        }
      }
    } else {
      report.added.push(c.id);
      const res = await resolveFootprint(c, resolver);
      if (!res.ok) {
        report.unresolved.push({ componentId: c.id, ref: c.ref, reason: res.reason });
        report.diagnostics.push(engineeringDiagnostic(
          "FOOTPRINT_RESOLUTION_FAILED",
          `${c.ref}: ${res.reason}`,
          { componentIds: [c.id], suggestedActions: ["Assign a valid footprint and retry synchronization."] },
        ));
        continue;
      }
      report.resolvedBy[res.tier]++;
      fullName = res.fullName;
      def = res.def;
    }

    const mapping = resolvePinPadMapping(c, def, netIdByEndpoint);
    report.diagnostics.push(...mapping.diagnostics);
    if (!mapping.ok) {
      report.unresolved.push({
        componentId: c.id,
        ref: c.ref,
        reason: mapping.diagnostics.find((diagnostic) => diagnostic.severity === "error")?.summary
          ?? "pin-to-pad mapping could not be proven",
      });
    }
    prepared.push({ c, ...(prev ? { prev } : {}), fullName, def, mapping });
  }

  for (const f of base.footprints) {
    if (!netlist.components.some((c) => c.id === f.id)) report.removed.push(f.id);
  }

  report.diagnostics.sort(compareDiagnostics);
  if (report.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, board: original, report, netlist, diagnostics: report.diagnostics };
  }

  const reconciliation = reconcileBoardNets(base, netlist.nets);
  report.reconciliation = reconciliation.changes;
  report.diagnostics.push(...reconciliation.diagnostics);
  report.diagnostics.sort(compareDiagnostics);
  if (!reconciliation.ok) {
    return { ok: false, board: original, report, netlist, diagnostics: report.diagnostics };
  }

  const keptInstances: FootprintInstance[] = prepared
    .filter((item): item is PreparedComponent & { prev: FootprintInstance } => item.prev !== undefined)
    .map(({ c, prev, fullName, def, mapping }) => ({
      ...prev,
      id: c.id,
      ref: c.ref,
      footprintId: fullName,
      def,
      at: prev.at,
      rotationDeg: prev.rotationDeg,
      side: prev.side,
      padNets: mapping.padNets,
      pinPadMappings: mapping.mappings,
      footprintPadClassifications: mapping.footprintPadClassifications,
    }));
  const newcomers = prepared
    .filter((item) => item.prev === undefined)
    .sort((a, b) => compareRefs(a.c.ref, b.c.ref));

  // New parts default to a centered, spread cluster. The legacy staging strip
  // remains available only through an explicit preserve-coordinates option.
  const interim: PcbBoard = { ...base, footprints: keptInstances };
  const preserveCoordinates = opts.placement?.preserveAbsoluteCoordinates === true
    || opts.placement?.centerNewParts === false;
  const spreadOverlaps = opts.placement?.spreadOverlaps !== false;
  let positions: Vec2[];
  if (preserveCoordinates) {
    positions = layoutStagingStrip(interim, newcomers.map((n) => n.def));
    report.placement = {
      mode: "preserved-staging",
      spreadOverlaps: false,
      allInsideBoard: newcomers.length === 0,
      overlapCount: 0,
      ...(newcomers.length
        ? { warning: "Imported coordinates were preserved, so new parts remain outside the board staging area." }
        : {}),
    };
  } else {
    const centered = centeredImportPositions(
      interim,
      newcomers.map((newcomer) => newcomer.def),
      keptInstances,
      spreadOverlaps,
    );
    positions = centered.positions;
    report.placement = centered.placement;
  }
  const newInstances = newcomers.map(({ c, fullName, def, mapping }, i): FootprintInstance => ({
    id: c.id,
    ref: c.ref,
    footprintId: fullName,
    def,
    at: positions[i],
    rotationDeg: 0,
    side: "top",
    padNets: mapping.padNets,
    pinPadMappings: mapping.mappings,
    footprintPadClassifications: mapping.footprintPadClassifications,
  }));

  const remapNet = (netId: number): number => remapNumericNetId(reconciliation.oldToNewId, netId);
  const stackupConfig = base.stackupConfig
    ? {
        ...base.stackupConfig,
        routing: { ...base.stackupConfig.routing },
        copperLayers: base.stackupConfig.copperLayers.map((layer) => {
          if (layer.planeNetId === undefined) return { ...layer };
          const mapped = reconciliation.oldToNewId.get(layer.planeNetId);
          if (mapped === undefined || mapped === 0) {
            const withoutNet = { ...layer };
            delete withoutNet.planeNetId;
            return withoutNet;
          }
          return { ...layer, planeNetId: mapped };
        }),
      }
    : undefined;
  const routingHistory = base.routingHistory
    ?.filter((event) => event.netId === 0 || reconciliation.oldToNewId.has(event.netId))
    .map((event) => ({ ...event, netId: remapNet(event.netId) }));
  const netClassing = base.netClassing
    ? {
        ...base.netClassing,
        assignments: {},
        base: {},
        ruleDeltas: base.netClassing.ruleDeltas.map((delta) => ({
          ...delta,
          changes: delta.changes.map((change) => change.appliesTo.kind === "nets"
            ? {
                ...change,
                appliesTo: {
                  kind: "nets" as const,
                  netIds: [...new Set(change.appliesTo.netIds.map(remapNet).filter((id) => id !== 0))].sort((a, b) => a - b),
                },
              }
            : change),
        })),
      }
    : undefined;

  const board: PcbBoard = {
    ...base,
    formatVersion: 1,
    identityVersion: 1,
    stackup: base.stackup,
    outline: base.outline,
    nets: reconciliation.nets,
    // Sorted by id so the array order is a pure function of the schematic —
    // required for the sync-twice deep-equal invariant.
    footprints: [...keptInstances, ...newInstances].sort((a, b) => compareCodePoints(a.id, b.id)),
    // Reconciliation rejects any routed deletion/split/merge before this
    // candidate exists. Safe numeric-id changes are remapped by stable identity.
    tracks: base.tracks.map((t) => ({ ...t, netId: remapNet(t.netId) })),
    vias: base.vias.map((v) => ({ ...v, netId: remapNet(v.netId) })),
    zones: base.zones.map((z) => ({ ...z, netId: remapNet(z.netId) })),
    texts: base.texts,
    ...(stackupConfig ? { stackupConfig } : {}),
    ...(routingHistory ? { routingHistory } : {}),
    ...(netClassing ? { netClassing } : {}),
  };
  // Net names and topology may have changed; retain manual/AI deltas while
  // rebuilding their deterministic assignment base for the synced netlist.
  if (board.netClassing) reclassifyBoard(board);

  return { ok: true, board, report, netlist, diagnostics: report.diagnostics };
}
