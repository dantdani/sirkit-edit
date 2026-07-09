/**
 * Board connectivity engine (PCB Stage 6) — PINNED: Stages 7 (routing), 9
 * (Freerouting import), 11 (zone fill) and 12 (DRC) consume this API.
 *
 * Answers "what copper is electrically joined": union-find over geometrically
 * touching same-net copper (pads via `padNets`, tracks, vias), cluster-MST
 * airwires for incomplete nets, routing completion, and cross-net shorts.
 *
 * Design decisions (pinned by the wave plan):
 * - FULL REBUILD on every call — no caching, no dirty tracking, fresh objects
 *   out. At ≤ ~5k copper items this is milliseconds; do not add KiCad-style
 *   incremental CN_* machinery.
 * - Zones are NOT conductive until Stage 11 (unfilled outlines only) — they
 *   never appear in the item list.
 * - Touch = Stage 6 distance ≤ 0 (integer nm; exact for on-pad endpoints).
 */

import Flatbush from "flatbush";
import type { Vec2, BBox, PlacedShape } from "./geometry";
import { shapeBBox, shapeDistance } from "./geometry";
import type { PcbBoard, Track, Via, FilledRegion } from "./types";
import { regionShapeDistance } from "./zones/geometry"; // Stage 11: hole-aware zone distance
import type { LayerId } from "./layers";
import {
  padCopperLayers,
  padWorldPosition,
  padWorldShape,
  trackShape,
  viaShape,
  viaSpannedLayers,
} from "./geometry-copper";

// PENDING (Stage 6 integration window): once Stage 5's ratsnest.ts merges,
// replace this local declaration with `import type { Airwire } from "./ratsnest"`.
// The shape below is the pinned cross-stage contract.
export interface Airwire {
  netId: number;
  from: Vec2;
  to: Vec2;
}

export type CopperItemRef =
  | { kind: "pad"; instanceId: string; padNumber: string }
  | { kind: "track"; id: string }
  | { kind: "via"; id: string }
  // Stage 11: one entry per Zone.fill region (zones with an empty fill emit nothing).
  | { kind: "zone-region"; zoneId: string; regionIndex: number };

export interface NetConnectivity {
  netId: number;
  /** Electrically joined groups (same-net items only). */
  clusters: CopperItemRef[][];
  /** Every pad of the net sits in one cluster. */
  complete: boolean;
}

export interface BoardConnectivity {
  nets: Map<number, NetConnectivity>;
  /** Nets with <2 pads are excluded from the totals. */
  completion: { routedNets: number; totalNets: number; percent: number };
  /** Cluster-MST; degenerates to pad-MST when no copper exists. */
  airwires: Airwire[];
  /** Geometric touches between items of DIFFERENT nonzero nets (deduped pairs). */
  shorts: [CopperItemRef, CopperItemRef][];
  /** Tracks/vias with netId 0, or touching nothing. */
  orphans: CopperItemRef[];
}

// ── Internal item model ──────────────────────────────────────────────────────

interface Item {
  ref: CopperItemRef;
  netId: number;
  layers: readonly LayerId[];
  bbox: BBox;
  /** Airwire anchor points: pad world position / track endpoints / via center. */
  positions: Vec2[];
  /**
   * Anchors are guaranteed inside the copper (pad center / track endpoints /
   * via center), so an exact shared anchor is a touch without shape math.
   * False only for polygon pads, whose origin may fall outside a concave hull.
   */
  anchorsInside: boolean;
  /** World-space copper shape, built lazily — most pairs never need it. */
  shape: PlacedShape | null;
  track?: Track;
  via?: Via;
  /** Stage 11: zone fill region — touch tests go through regionShapeDistance. */
  region?: FilledRegion;
}

function shapeOf(item: Item): PlacedShape {
  if (item.shape) return item.shape;
  const s = item.track ? trackShape(item.track) : viaShape(item.via as Via);
  item.shape = s;
  return s;
}

/** Capsule bbox is exactly the endpoints inflated by width/2, at any angle. */
function trackBBox(t: Track): BBox {
  const r = t.width / 2;
  return {
    minX: Math.floor(Math.min(t.start.x, t.end.x) - r),
    minY: Math.floor(Math.min(t.start.y, t.end.y) - r),
    maxX: Math.ceil(Math.max(t.start.x, t.end.x) + r),
    maxY: Math.ceil(Math.max(t.start.y, t.end.y) + r),
  };
}

function viaBBox(v: Via): BBox {
  const r = v.size / 2;
  return {
    minX: Math.floor(v.at.x - r),
    minY: Math.floor(v.at.y - r),
    maxX: Math.ceil(v.at.x + r),
    maxY: Math.ceil(v.at.y + r),
  };
}

function collectItems(board: PcbBoard): Item[] {
  const items: Item[] = [];
  for (const inst of board.footprints) {
    for (const pad of inst.def.pads) {
      if (pad.type === "np_thru_hole") continue; // hole, no copper
      const layers = padCopperLayers(inst, pad);
      if (layers.length === 0) continue;
      const shape = padWorldShape(inst, pad); // pads keep an eager shape (rotation-aware bbox needs it anyway)
      items.push({
        ref: { kind: "pad", instanceId: inst.id, padNumber: pad.number },
        netId: inst.padNets[pad.number] ?? 0,
        layers,
        bbox: shapeBBox(shape),
        positions: [padWorldPosition(inst, pad)],
        anchorsInside: pad.shape.kind !== "polygon",
        shape,
      });
    }
  }
  for (const track of board.tracks) {
    items.push({
      ref: { kind: "track", id: track.id },
      netId: track.netId,
      layers: [track.layer],
      bbox: trackBBox(track),
      positions: [track.start, track.end],
      anchorsInside: true,
      shape: null,
      track,
    });
  }
  for (const via of board.vias) {
    items.push({
      ref: { kind: "via", id: via.id },
      netId: via.netId,
      layers: viaSpannedLayers(via),
      bbox: viaBBox(via),
      positions: [via.at],
      anchorsInside: true,
      shape: null,
      via,
    });
  }
  // Stage 11: zone fill regions are conductive copper. Anchors are boundary
  // vertices (fine for airwires); anchorsInside=false keeps them out of the
  // exact-anchor fast path, so every touch runs the hole-aware distance.
  for (const zone of board.zones) {
    zone.fill.forEach((region, regionIndex) => {
      if (region.outer.length < 3) return;
      items.push({
        ref: { kind: "zone-region", zoneId: zone.id, regionIndex },
        netId: zone.netId,
        layers: [zone.layer],
        bbox: region.boundingBox,
        positions: [region.outer[0]],
        anchorsInside: false,
        shape: null,
        region,
      });
    });
  }
  return items;
}

/** Touch distance for pairs where at least one side is a zone region. */
function zoneAwareDistance(a: Item, b: Item): number {
  if (a.region && b.region) {
    // Region–region: outer-ring proximity (same-net overlapping pours union;
    // cross-net region pairs are clearance-separated by construction).
    const ring = b.region.outer;
    return regionShapeDistance(
      a.region,
      { shape: { kind: "polygon", points: ring }, at: { x: 0, y: 0 }, rotationDeg: 0 },
      ring[0],
    );
  }
  const zone = a.region ? a : b;
  const other = a.region ? b : a;
  return regionShapeDistance(zone.region as FilledRegion, shapeOf(other), other.positions[0]);
}

/**
 * Exact shared anchor point (track endpoint on a via center / pad center —
 * how routed copper actually joins) is a guaranteed touch without shape math.
 */
function shareAnchor(a: Item, b: Item): boolean {
  if (!a.anchorsInside || !b.anchorsInside) return false;
  for (const pa of a.positions) {
    for (const pb of b.positions) {
      if (pa.x === pb.x && pa.y === pb.y) return true;
    }
  }
  return false;
}

// ── Union-find (plain arrays, path halving + union by size) ──────────────────

class UnionFind {
  private parent: number[];
  private size: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.size = new Array<number>(n).fill(1);
  }

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) {
      this.parent[root] = this.parent[this.parent[root]];
      root = this.parent[root];
    }
    return root;
  }

  union(a: number, b: number): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.size[ra] < this.size[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    this.size[ra] += this.size[rb];
  }
}

// ── Broad phase: one flatbush per copper layer over item bboxes ──────────────

/** Returns flat packed pairs [i0, j0, i1, j1, …], each with i < j, deduped. */
function candidatePairs(items: Item[]): number[] {
  const byLayer = new Map<LayerId, number[]>();
  for (let i = 0; i < items.length; i++) {
    for (const layer of items[i].layers) {
      let list = byLayer.get(layer);
      if (!list) byLayer.set(layer, (list = []));
      list.push(i);
    }
  }

  const pairs: number[] = [];
  const seen = new Set<number>(); // i * n + j, i < j — dedupes multi-layer pairs
  const n = items.length;
  for (const idxs of byLayer.values()) {
    if (idxs.length < 2) continue;
    const tree = new Flatbush(idxs.length);
    for (const i of idxs) {
      const b = items[i].bbox;
      tree.add(b.minX, b.minY, b.maxX, b.maxY);
    }
    tree.finish();
    for (let a = 0; a < idxs.length; a++) {
      const i = idxs[a];
      const b = items[i].bbox;
      for (const hit of tree.search(b.minX, b.minY, b.maxX, b.maxY)) {
        const j = idxs[hit];
        if (j <= i) continue;
        // A pair can repeat only when BOTH items sit on ≥2 layers (pads/vias).
        if (items[i].layers.length > 1 && items[j].layers.length > 1) {
          const key = i * n + j;
          if (seen.has(key)) continue;
          seen.add(key);
        }
        pairs.push(i, j);
      }
    }
  }
  return pairs;
}

// ── Airwires: Prim over clusters, edge = min pairwise item-position distance ─

interface ClusterNode {
  refs: CopperItemRef[];
  positions: Vec2[];
}

function clusterMst(netId: number, clusters: ClusterNode[]): Airwire[] {
  const c = clusters.length;
  if (c < 2) return [];

  // Closest position pair between two clusters (squared metric; ties don't matter).
  const closest = (
    a: ClusterNode,
    b: ClusterNode,
  ): { d2: number; from: Vec2; to: Vec2 } => {
    let best = { d2: Infinity, from: a.positions[0], to: b.positions[0] };
    for (const pa of a.positions) {
      for (const pb of b.positions) {
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best.d2) best = { d2, from: pa, to: pb };
      }
    }
    return best;
  };

  const inTree = new Array<boolean>(c).fill(false);
  const dist = new Array<number>(c).fill(Infinity);
  const edge = new Array<{ from: Vec2; to: Vec2 } | null>(c).fill(null);
  inTree[0] = true;
  for (let j = 1; j < c; j++) {
    const e = closest(clusters[0], clusters[j]);
    dist[j] = e.d2;
    edge[j] = { from: e.from, to: e.to };
  }

  const airwires: Airwire[] = [];
  for (let added = 1; added < c; added++) {
    let next = -1;
    for (let j = 0; j < c; j++) {
      if (!inTree[j] && (next === -1 || dist[j] < dist[next])) next = j;
    }
    const e = edge[next];
    if (e) airwires.push({ netId, from: e.from, to: e.to });
    inTree[next] = true;
    for (let j = 0; j < c; j++) {
      if (inTree[j]) continue;
      const cand = closest(clusters[next], clusters[j]);
      if (cand.d2 < dist[j]) {
        dist[j] = cand.d2;
        edge[j] = { from: cand.from, to: cand.to };
      }
    }
  }
  return airwires;
}

// ── The engine ───────────────────────────────────────────────────────────────

export function computeConnectivity(board: PcbBoard): BoardConnectivity {
  const items = collectItems(board);
  const uf = new UnionFind(items.length);
  const touched = new Array<boolean>(items.length).fill(false);
  const shorts: [CopperItemRef, CopperItemRef][] = [];

  const onTouch = (i: number, j: number): void => {
    const a = items[i];
    const b = items[j];
    touched[i] = true;
    touched[j] = true;
    if (a.netId === b.netId) {
      if (a.netId !== 0) uf.union(i, j);
    } else if (a.netId !== 0 && b.netId !== 0) {
      shorts.push([a.ref, b.ref]); // pair already deduped by the broad phase
    }
  };

  // Candidate pairs share a copper layer by construction (per-layer trees).
  // Pass 1 unions all exactly anchor-joined copper (cheap, exact); pass 2 runs
  // Stage 1's `shapeDistance` on the cached shapes — the same math as the
  // pinned per-pair distance functions Stage 7/12 use — but skips any
  // same-net pair already in one cluster: a touch there cannot change
  // clusters, shorts, or touched flags (both items are already touched), so
  // the skip is output-identical, not an approximation.
  const pairs = candidatePairs(items);
  const deferred: number[] = [];
  for (let k = 0; k < pairs.length; k += 2) {
    const i = pairs[k];
    const j = pairs[k + 1];
    if (shareAnchor(items[i], items[j])) onTouch(i, j);
    else deferred.push(i, j);
  }
  for (let k = 0; k < deferred.length; k += 2) {
    const i = deferred[k];
    const j = deferred[k + 1];
    const a = items[i];
    const b = items[j];
    if (a.netId === b.netId && (a.netId === 0 || uf.find(i) === uf.find(j))) continue;
    const d =
      a.region || b.region ? zoneAwareDistance(a, b) : shapeDistance(shapeOf(a), shapeOf(b));
    if (d <= 0) onTouch(i, j);
  }

  // Group same-net items into clusters by union-find root.
  const netItems = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const netId = items[i].netId;
    if (netId === 0) continue;
    let list = netItems.get(netId);
    if (!list) netItems.set(netId, (list = []));
    list.push(i);
  }

  const nets = new Map<number, NetConnectivity>();
  const airwires: Airwire[] = [];
  let routedNets = 0;
  let totalNets = 0;

  for (const [netId, idxs] of netItems) {
    const byRoot = new Map<number, number[]>();
    for (const i of idxs) {
      const root = uf.find(i);
      let list = byRoot.get(root);
      if (!list) byRoot.set(root, (list = []));
      list.push(i);
    }

    const clusterNodes: ClusterNode[] = [];
    const padRoots = new Set<number>();
    let padCount = 0;
    for (const [root, members] of byRoot) {
      const node: ClusterNode = { refs: [], positions: [] };
      for (const i of members) {
        node.refs.push(items[i].ref);
        node.positions.push(...items[i].positions);
        if (items[i].ref.kind === "pad") {
          padCount++;
          padRoots.add(root);
        }
      }
      clusterNodes.push(node);
    }

    const complete = padRoots.size <= 1;
    nets.set(netId, {
      netId,
      clusters: clusterNodes.map((c) => c.refs),
      complete,
    });

    if (padCount >= 2) {
      totalNets++;
      if (complete) routedNets++;
    }
    if (!complete) airwires.push(...clusterMst(netId, clusterNodes));
  }

  const orphans: CopperItemRef[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].ref.kind === "pad") continue;
    if (items[i].netId === 0 || !touched[i]) orphans.push(items[i].ref);
  }

  return {
    nets,
    completion: {
      routedNets,
      totalNets,
      percent:
        totalNets === 0 ? 100 : Math.round((routedNets / totalNets) * 1000) / 10,
    },
    airwires,
    shorts,
    orphans,
  };
}
