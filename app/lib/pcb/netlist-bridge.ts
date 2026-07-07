/**
 * Schematic → board bridge (PCB Stage 4). Pinned cross-stage contract:
 * Stages 5/6/8/9/10 consume PcbNetlist, SyncReport, syncFromSchematic and the
 * padNets field on FootprintInstance (pad number → net id, absent/0 =
 * unconnected).
 *
 * Sync is FORWARD-ONLY: the schematic is the source of truth; this module
 * never writes schematic state. Net ids are deterministic — the same
 * schematic always produces the same ids (named nets sorted alphabetically
 * get 1..k, then unnamed nets in a stable order) — so Stage 6 connectivity
 * and Stage 9 DSN export don't churn between syncs.
 *
 * Footprint resolution is deterministic-first: (1) the symbol's footprint
 * hint via /api/pcb/footprints/resolve, (2) the package-map heuristic table,
 * (3) the assignment queue (AI suggestions run on-demand there, never during
 * sync). Every tier is verified by pad-count == pin-count.
 */

import type { SchematicState, SchComponent } from "@/lib/schematic-types";
import { netLabelNameKey } from "@/lib/schematic-types";
import type { KicadPin } from "@/app/lib/kicad/types";
import { buildNetUnionFind } from "@/app/lib/connectivity";
import { pinWorldPos, kicadPinWorldPos, pointKey } from "@/app/lib/geometry";
import type { Point } from "@/lib/schematic-types";
import type { FootprintSearchHit } from "./footprint-api-types";
import { parseKicadMod } from "./kicad-mod";
import { heuristicFootprint, guessPackageToken } from "./package-map";
import type { FootprintDef, FootprintInstance, PcbBoard } from "./types";
import { createEmptyBoard } from "./types";
import { mmToNm } from "./units";

// ─── Pinned netlist types ────────────────────────────────────────────────────

export interface NetlistComponent {
  id: string; // stable schematic component id
  ref: string; // 'R1'
  mpn?: string;
  value?: string;
  package?: string;
  footprintHint?: string; // 'Resistor_SMD:R_0603_1608Metric' from ingested symbol data
  pins: { number: string; name?: string }[];
}

export interface NetlistNet {
  id: number;
  name: string;
  nodes: { componentId: string; pinNumber: string }[];
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
  resolvedBy: Record<"hint" | "heuristic" | "manual", number>;
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
}

export type PartLookup = (partId: string) => NetlistPartData | null;

// ─── Netlist derivation ──────────────────────────────────────────────────────

/** Theory pin name → pad number. Diode pad 1 is the cathode (KiCad convention). */
const THEORY_PIN_NUMBERS: Record<string, Record<string, string>> = {
  resistor: { left: "1", right: "2" },
  capacitor: { left: "1", right: "2" },
  inductor: { left: "1", right: "2" },
  diode: { cathode: "1", anode: "2" },
};

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
  const refCounters = new Map<string, number>();
  for (const c of theoryComps) {
    const pinMap = THEORY_PIN_NUMBERS[c.type];
    if (!pinMap) continue;
    const prefix = THEORY_REF_PREFIX[c.type];
    const n = (refCounters.get(prefix) ?? 0) + 1;
    refCounters.set(prefix, n);
    const pins = Object.entries(pinMap).map(([pinName, number]) => {
      pinSites.push({ componentId: c.id, pinNumber: number, point: pinWorldPos(c, pinName) });
      return { number, name: pinName };
    });
    pins.sort((a, b) => a.number.localeCompare(b.number));
    components.push({ id: c.id, ref: `${prefix}${n}`, value: c.value, pins });
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
    a.ref === b.ref ? a.pinNumber.localeCompare(b.pinNumber, undefined, { numeric: true }) : a.ref.localeCompare(b.ref, undefined, { numeric: true });

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
  unnamedNets.sort((a, b) => nodeKey(a).localeCompare(nodeKey(b), undefined, { numeric: true }));

  const nets: NetlistNet[] = [];
  let nextId = 1;
  for (const name of [...namedNets.keys()].sort()) {
    const nodes = namedNets.get(name)!.sort(compareNodes);
    nets.push({
      id: nextId++,
      name,
      nodes: nodes.map(({ componentId, pinNumber }) => ({ componentId, pinNumber })),
    });
  }
  for (const nodes of unnamedNets) {
    const id = nextId++;
    nets.push({
      id,
      name: `N$${id}`,
      nodes: nodes.sort(compareNodes).map(({ componentId, pinNumber }) => ({ componentId, pinNumber })),
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
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
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

/**
 * Append a single new instance (assignment-queue pick), placing it in the
 * staging strip. Returns a new board; the input is not mutated.
 */
export function placeNewFootprint(
  board: PcbBoard,
  inst: Omit<FootprintInstance, "at">,
): PcbBoard {
  const def = inst.def;
  const [at] = layoutStagingStrip(board, [def]);
  const footprints = [...board.footprints, { ...inst, at }].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  return { ...board, footprints };
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export interface SyncOptions {
  /** Parts-cache lookup for placed KiCad components (see PartLookup). */
  getPart?: PartLookup;
  /** Footprint API boundary; defaults to fetch()ing the Stage 2 routes. */
  resolver?: FootprintResolver;
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
    if (hit.padCount !== c.pins.length) {
      return {
        ok: false,
        reason: `${hit.fullName} has ${hit.padCount} pads but ${c.ref} has ${c.pins.length} pins`,
      };
    }
    const detail = await resolver.detail(hit.id);
    if (!detail) return { ok: false, reason: `footprint source unavailable for ${hit.fullName}` };
    return { ok: true, tier, fullName: hit.fullName, def: parseKicadMod(detail.rawSexpr, detail.libName) };
  };

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
): Promise<{ board: PcbBoard; report: SyncReport; netlist: PcbNetlist }> {
  const resolver = opts.resolver ?? createFetchFootprintResolver();
  const netlist = buildNetlist(schematic, opts.getPart);

  const report: SyncReport = {
    added: [],
    removed: [],
    kept: [],
    footprintChanged: [],
    unresolved: [],
    resolvedBy: { hint: 0, heuristic: 0, manual: 0 },
  };

  const base = existing ?? createEmptyBoard();
  const existingById = new Map(base.footprints.map((f) => [f.id, f]));

  // pad number → net id, per component.
  const padNetsById = new Map<string, Record<string, number>>();
  for (const net of netlist.nets) {
    for (const node of net.nodes) {
      const m = padNetsById.get(node.componentId) ?? {};
      m[node.pinNumber] = net.id;
      padNetsById.set(node.componentId, m);
    }
  }

  const keptInstances: FootprintInstance[] = [];
  const newcomers: { c: NetlistComponent; fullName: string; def: FootprintDef }[] = [];

  for (const c of netlist.components) {
    const padNets = padNetsById.get(c.id) ?? {};
    const prev = existingById.get(c.id);

    if (prev) {
      report.kept.push(c.id);
      let def = prev.def;
      let footprintId = prev.footprintId;
      // Footprint change detection is hint-string compare (MVP carve-out). On
      // resolution failure the placed def wins — never strand placed copper.
      if (c.footprintHint && c.footprintHint !== prev.footprintId) {
        const hit = await resolver.resolve(c.footprintHint);
        if (hit && hit.padCount === c.pins.length) {
          const detail = await resolver.detail(hit.id);
          if (detail) {
            def = parseKicadMod(detail.rawSexpr, detail.libName);
            footprintId = hit.fullName;
            report.footprintChanged.push(c.id);
            report.resolvedBy.hint++;
          }
        }
      }
      keptInstances.push({
        id: c.id,
        ref: c.ref,
        footprintId,
        def,
        at: prev.at,
        rotationDeg: prev.rotationDeg,
        side: prev.side,
        padNets,
      });
      continue;
    }

    report.added.push(c.id);
    const res = await resolveFootprint(c, resolver);
    if (!res.ok) {
      report.unresolved.push({ componentId: c.id, ref: c.ref, reason: res.reason });
      continue;
    }
    report.resolvedBy[res.tier]++;
    newcomers.push({ c, fullName: res.fullName, def: res.def });
  }

  for (const f of base.footprints) {
    if (!netlist.components.some((c) => c.id === f.id)) report.removed.push(f.id);
  }

  // New parts land in the staging strip, sorted by ref for readable rows.
  newcomers.sort((a, b) => compareRefs(a.c.ref, b.c.ref));
  const interim: PcbBoard = { ...base, footprints: keptInstances };
  const positions = layoutStagingStrip(interim, newcomers.map((n) => n.def));
  const newInstances = newcomers.map(({ c, fullName, def }, i): FootprintInstance => ({
    id: c.id,
    ref: c.ref,
    footprintId: fullName,
    def,
    at: positions[i],
    rotationDeg: 0,
    side: "top",
    padNets: padNetsById.get(c.id) ?? {},
  }));

  // board.nets is rebuilt wholesale; net 0 stays the reserved unconnected net.
  const nets = [{ id: 0, name: "" }, ...netlist.nets.map((n) => ({ id: n.id, name: n.name }))];
  const validNetIds = new Set(nets.map((n) => n.id));
  const remapNet = (netId: number): number => (validNetIds.has(netId) ? netId : 0);

  const board: PcbBoard = {
    formatVersion: 1,
    stackup: base.stackup,
    outline: base.outline,
    nets,
    // Sorted by id so the array order is a pure function of the schematic —
    // required for the sync-twice deep-equal invariant.
    footprints: [...keptInstances, ...newInstances].sort((a, b) => a.id.localeCompare(b.id)),
    // Copper whose net vanished is orphaned to net 0, never deleted (flagging
    // orphans is Stage 12's job).
    tracks: base.tracks.map((t) => ({ ...t, netId: remapNet(t.netId) })),
    vias: base.vias.map((v) => ({ ...v, netId: remapNet(v.netId) })),
    zones: base.zones.map((z) => ({ ...z, netId: remapNet(z.netId) })),
    texts: base.texts,
  };

  return { board, report, netlist };
}
