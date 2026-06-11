import type { Point, SchComponent, Wire } from "@/lib/schematic-types";
import { PIN_NAMES } from "@/lib/schematic-types";
import { pinWorldPos, pointKey, pointEquals } from "./geometry";

// ─── Union-Find ──────────────────────────────────────────────────────────────

export class UnionFind {
  private readonly parent = new Map<string, string>();

  has(x: string): boolean {
    return this.parent.has(x);
  }

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root); // path compression
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      let bucket = out.get(root);
      if (!bucket) { bucket = []; out.set(root, bucket); }
      bucket.push(key);
    }
    return out;
  }
}

// ─── Rigid-group BFS ─────────────────────────────────────────────────────────

// Pre-resolved KiCad-part pin world positions, supplied by the caller so this
// module stays decoupled from the (client-only) parts cache.
export type KicadPinSite = { id: string; pins: Point[] };

export type ConnectedGroup = {
  componentIds: Set<string>;
  wireIds: Set<string>;
  kicadInstanceIds: Set<string>;
};

// Find every component, KiCad instance, and wire reachable from a seed via
// shared coordinates. Used by the editor's "drag the whole connected group"
// behavior and by Sim view's move mode. KiCad parts participate exactly like
// Theory components: a wire endpoint coincident with one of their pins pulls the
// whole instance into the group.
export function findConnectedGroup(
  seed:
    | { kind: "component"; id: string }
    | { kind: "wire"; id: string }
    | { kind: "kicad"; id: string },
  components: SchComponent[],
  wires: Wire[],
  kicadPinSites: KicadPinSite[] = [],
): ConnectedGroup {
  const componentIds = new Set<string>();
  const wireIds = new Set<string>();
  const kicadInstanceIds = new Set<string>();
  type QItem =
    | { kind: "component"; id: string }
    | { kind: "wire"; id: string }
    | { kind: "kicad"; id: string };
  const queue: QItem[] = [seed];
  if (seed.kind === "component") componentIds.add(seed.id);
  else if (seed.kind === "kicad") kicadInstanceIds.add(seed.id);
  else wireIds.add(seed.id);

  const kicadPinsById = new Map(kicadPinSites.map((k) => [k.id, k.pins]));

  function compPins(comp: SchComponent): Point[] {
    return (PIN_NAMES[comp.type] ?? []).map((pin) => pinWorldPos(comp, pin));
  }

  // Add every wire whose start/end coincides with one of `pins`.
  function enqueueWiresTouching(pins: Point[]): void {
    for (const wire of wires) {
      if (wireIds.has(wire.id)) continue;
      const wStart = wire.vertices[0];
      const wEnd = wire.vertices[wire.vertices.length - 1];
      const hit = pins.some(
        (p) =>
          (p.x === wStart.x && p.y === wStart.y) ||
          (p.x === wEnd.x && p.y === wEnd.y),
      );
      if (hit) { wireIds.add(wire.id); queue.push({ kind: "wire", id: wire.id }); }
    }
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.kind === "component") {
      const comp = components.find((c) => c.id === item.id);
      if (!comp) continue;
      enqueueWiresTouching(compPins(comp));
    } else if (item.kind === "kicad") {
      const pins = kicadPinsById.get(item.id);
      if (!pins) continue;
      enqueueWiresTouching(pins);
    } else {
      const wire = wires.find((w) => w.id === item.id);
      if (!wire) continue;
      const wStart = wire.vertices[0];
      const wEnd   = wire.vertices[wire.vertices.length - 1];
      const eps = [wStart, wEnd];
      for (const other of wires) {
        if (wireIds.has(other.id)) continue;
        const oStart = other.vertices[0];
        const oEnd   = other.vertices[other.vertices.length - 1];
        const hit = eps.some(
          (ep) =>
            (ep.x === oStart.x && ep.y === oStart.y) ||
            (ep.x === oEnd.x   && ep.y === oEnd.y),
        );
        if (hit) { wireIds.add(other.id); queue.push({ kind: "wire", id: other.id }); }
      }
      for (const comp of components) {
        if (componentIds.has(comp.id)) continue;
        const pins = compPins(comp);
        const hit = eps.some((ep) => pins.some((p) => p.x === ep.x && p.y === ep.y));
        if (hit) { componentIds.add(comp.id); queue.push({ kind: "component", id: comp.id }); }
      }
      for (const site of kicadPinSites) {
        if (kicadInstanceIds.has(site.id)) continue;
        const hit = eps.some((ep) => site.pins.some((p) => p.x === ep.x && p.y === ep.y));
        if (hit) { kicadInstanceIds.add(site.id); queue.push({ kind: "kicad", id: site.id }); }
      }
    }
  }
  return { componentIds, wireIds, kicadInstanceIds };
}

// ─── Wire splitting ──────────────────────────────────────────────────────────

// Replace any wire segment whose interior strictly contains p with two
// halves meeting at p. Wires whose interior does NOT contain p are left
// untouched. Endpoints are never split (the point must be strictly inside).
//
// New sub-wires get fresh ids; the original wire's id disappears. Callers
// that need to preserve wire identity across splits should not rely on ids.
export function splitWiresAtPoint(wires: Wire[], p: Point): Wire[] {
  const out: Wire[] = [];
  for (const w of wires) {
    let didSplit = false;
    for (let i = 0; i < w.vertices.length - 1; i++) {
      const s = w.vertices[i];
      const e = w.vertices[i + 1];
      const onSeg =
        (s.y === e.y && p.y === s.y && p.x > Math.min(s.x, e.x) && p.x < Math.max(s.x, e.x)) ||
        (s.x === e.x && p.x === s.x && p.y > Math.min(s.y, e.y) && p.y < Math.max(s.y, e.y));
      if (onSeg) {
        out.push({ id: crypto.randomUUID(), vertices: [...w.vertices.slice(0, i + 1), p] });
        out.push({ id: crypto.randomUUID(), vertices: [p, ...w.vertices.slice(i + 1)] });
        didSplit = true;
        break;
      }
    }
    if (!didSplit) out.push(w);
  }
  return out;
}

// Drop zero-length wires and exact duplicates (direction-insensitive).
export function consolidateWires(wires: Wire[]): Wire[] {
  const seen = new Set<string>();
  const out: Wire[] = [];
  for (const w of wires) {
    const first = w.vertices[0];
    const last  = w.vertices[w.vertices.length - 1];
    if (!first || !last || pointEquals(first, last)) continue;
    const k1 = w.vertices.map((p) => `${p.x},${p.y}`).join("->");
    const k2 = [...w.vertices].reverse().map((p) => `${p.x},${p.y}`).join("->");
    if (!seen.has(k1) && !seen.has(k2)) { seen.add(k1); out.push(w); }
  }
  return out;
}

// ─── Net Union-Find ──────────────────────────────────────────────────────────

// Wire structure may use either modern { vertices: Point[] } or a legacy
// { start, end } form (older saved JSON). Normalize to a vertex list.
function wirePoints(w: { vertices?: Point[]; start?: Point; end?: Point }): Point[] {
  if (w.vertices && w.vertices.length >= 2) return w.vertices;
  if (w.start && w.end) return [w.start, w.end];
  return [];
}

// Build a Union-Find over wire vertices + pin sites. Two coordinates land in
// the same group iff they are electrically connected (via a wire or by being
// the same point in space, i.e. co-located pins).
export function buildNetUnionFind(
  components: SchComponent[],
  wires: Wire[],
  // World positions of KiCad-part pins (caller-resolved). Defaults to none so
  // server-side callers (SPICE netlist) stay unaffected.
  kicadPinSites: Point[] = [],
): UnionFind {
  const uf = new UnionFind();

  // Union along every wire segment.
  for (const wire of wires) {
    const pts = wirePoints(wire as unknown as { vertices?: Point[]; start?: Point; end?: Point });
    for (let i = 0; i < pts.length - 1; i++) {
      uf.union(pointKey(pts[i]), pointKey(pts[i + 1]));
    }
  }

  // Every pin site (Theory + KiCad) must exist in the structure even if no wire
  // touches it — so its key resolves to a (singleton) root.
  const allPinSites: string[] = [];
  for (const comp of components) {
    for (const pin of PIN_NAMES[comp.type] ?? []) {
      allPinSites.push(pointKey(pinWorldPos(comp, pin)));
    }
  }
  for (const p of kicadPinSites) allPinSites.push(pointKey(p));
  for (const site of allPinSites) uf.find(site);

  // Co-located pins (two pins at the same world position) belong to the same
  // net even without an explicit wire between them.
  const siteFirst = new Map<string, string>();
  for (const site of allPinSites) {
    const existing = siteFirst.get(site);
    if (existing) uf.union(site, existing);
    else siteFirst.set(site, site);
  }

  return uf;
}

// Given a world-coordinate point (typically a wire vertex or pin position),
// return the root of its net group, or null if the point is not part of any
// known wire/pin in the schematic.
export function findNetRoot(
  point: Point,
  components: SchComponent[],
  wires: Wire[],
): string | null {
  const uf = buildNetUnionFind(components, wires);
  const key = pointKey(point);
  if (!uf.has(key)) return null;
  return uf.find(key);
}
