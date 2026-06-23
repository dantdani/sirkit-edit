import type {
  LogicalNetlist,
  SchematicState,
  SchComponent,
  SchComponentType,
  Wire,
  Point,
} from "./schematic-types";
import { PIN_OFFSETS } from "./schematic-types";
import {
  snap, snapPoint, pointEquals,
  pinWorldPos, pinDirection,
  type Direction,
} from "@/app/lib/geometry";

// ─── Layout constants ─────────────────────────────────────────────────────────

export const GRID       = 10;
export const PIN_PITCH  = 80;
export const STAGGER_Y  = 120;  // vertical row separation; 120 leaves room for shunts
export const ORIGIN_X   = 240;
export const ORIGIN_Y   = 200;
export const GND_DROP_Y = 100;

// ─── Internal types ───────────────────────────────────────────────────────────

type Role = "source" | "ground" | "shunt" | "series";

// ─── Collision-aware routing ──────────────────────────────────────────────────

function compBox(comp: SchComponent): { x1: number; y1: number; x2: number; y2: number } {
  const pad = 24;
  return { x1: comp.x - pad, y1: comp.y - pad, x2: comp.x + pad, y2: comp.y + pad };
}

function segCrossesRect(
  p1: Point, p2: Point,
  x1: number, y1: number, x2: number, y2: number,
): boolean {
  if (p1.y === p2.y) {
    if (p1.y <= y1 || p1.y >= y2) return false;
    const sx1 = Math.min(p1.x, p2.x), sx2 = Math.max(p1.x, p2.x);
    return sx1 < x2 && sx2 > x1;
  } else if (p1.x === p2.x) {
    if (p1.x <= x1 || p1.x >= x2) return false;
    const sy1 = Math.min(p1.y, p2.y), sy2 = Math.max(p1.y, p2.y);
    return sy1 < y2 && sy2 > y1;
  }
  return false;
}

function pathCrossesAny(verts: Point[], obstacles: SchComponent[]): boolean {
  for (let i = 0; i < verts.length - 1; i++) {
    for (const comp of obstacles) {
      const b = compBox(comp);
      if (segCrossesRect(verts[i], verts[i + 1], b.x1, b.y1, b.x2, b.y2)) return true;
    }
  }
  return false;
}

function dedup(pts: Point[]): Point[] {
  return pts.filter((p, i) => i === 0 || !pointEquals(p, pts[i - 1]));
}

function lbend(aPos: Point, aDir: Direction, bPos: Point): Point[] {
  if (pointEquals(aPos, bPos)) return [];
  if (aPos.x === bPos.x || aPos.y === bPos.y) return [aPos, bPos];
  const corner: Point =
    (aDir === "east" || aDir === "west")
      ? snapPoint({ x: bPos.x, y: aPos.y })
      : snapPoint({ x: aPos.x, y: bPos.y });
  const v: Point[] = [aPos];
  if (!pointEquals(corner, aPos) && !pointEquals(corner, bPos)) v.push(corner);
  v.push(bPos);
  return v;
}

function zbend(
  aPos: Point, aDir: Direction, bPos: Point,
  obstacles: SchComponent[],
): Point[] {
  const horiz = aDir === "east" || aDir === "west";
  // Try offsets both above and below, increasing magnitude
  for (const off of [80, -80, 160, -160, 240, -240]) {
    let verts: Point[];
    if (horiz) {
      // VHV: detour via a relay y to get around horizontal obstacle
      const vy = snap(aPos.y + off);
      verts = dedup([aPos, { x: aPos.x, y: vy }, { x: bPos.x, y: vy }, bPos]);
    } else {
      // HVH: detour via a relay x
      const vx = snap(aPos.x + off);
      verts = dedup([aPos, { x: vx, y: aPos.y }, { x: vx, y: bPos.y }, bPos]);
    }
    if (verts.length >= 2 && !pathCrossesAny(verts, obstacles)) return verts;
  }
  return [];
}

function routeWireAvoiding(
  aPos: Point, aDir: Direction, bPos: Point,
  allPlaced: SchComponent[], fromId: string, toId: string,
): Point[] {
  if (pointEquals(aPos, bPos)) return [];
  const obstacles = allPlaced.filter((c) => c.id !== fromId && c.id !== toId);
  const lb = lbend(aPos, aDir, bPos);
  if (!pathCrossesAny(lb, obstacles)) return lb;
  const zb = zbend(aPos, aDir, bPos, obstacles);
  return zb.length >= 2 ? zb : lb;
}

// ─── Wire post-processing ─────────────────────────────────────────────────────

function pointOnSegInterior(p: Point, s: Point, e: Point): boolean {
  if (s.y === e.y) {
    if (p.y !== s.y) return false;
    const lo = Math.min(s.x, e.x), hi = Math.max(s.x, e.x);
    return p.x > lo && p.x < hi;
  } else {
    if (p.x !== s.x) return false;
    const lo = Math.min(s.y, e.y), hi = Math.max(s.y, e.y);
    return p.y > lo && p.y < hi;
  }
}

function splitWiresAtPoint(wires: Wire[], p: Point): Wire[] {
  const out: Wire[] = [];
  for (const w of wires) {
    let split = false;
    for (let i = 0; i < w.vertices.length - 1; i++) {
      if (pointOnSegInterior(p, w.vertices[i], w.vertices[i + 1])) {
        out.push({ id: crypto.randomUUID(), vertices: [...w.vertices.slice(0, i + 1), p] });
        out.push({ id: crypto.randomUUID(), vertices: [p, ...w.vertices.slice(i + 1)] });
        split = true;
        break;
      }
    }
    if (!split) out.push(w);
  }
  return out;
}

function consolidateWires(wires: Wire[]): Wire[] {
  const seen = new Set<string>();
  const out: Wire[] = [];
  for (const w of wires) {
    const v = w.vertices;
    if (v.length < 2) continue;
    if (pointEquals(v[0], v[v.length - 1])) continue;
    const k1 = v.map((p) => `${p.x},${p.y}`).join("->");
    const k2 = [...v].reverse().map((p) => `${p.x},${p.y}`).join("->");
    if (!seen.has(k1) && !seen.has(k2)) { seen.add(k1); out.push(w); }
  }
  return out;
}

// ─── Rail-source heuristics ───────────────────────────────────────────────────

function isPositiveRail(id: string, value: string): boolean {
  const s = id + " " + value;
  return /vcc|vdd|v\+/i.test(s) || /^\+?\d+\.?\d*\s*v$/i.test(value.trim());
}

function isNegativeRail(id: string, value: string): boolean {
  const s = id + " " + value;
  return /vee|vss|v-/i.test(s) || /^-\d+\.?\d*\s*v$/i.test(value.trim());
}

// ─── Main layout function ─────────────────────────────────────────────────────

export function autoLayout(netlist: LogicalNetlist): SchematicState {
  // Deterministic input ordering
  const comps = [...netlist.components].sort((a, b) => a.id.localeCompare(b.id));
  const conns = [...netlist.connections].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );

  // ── Adjacency map ──────────────────────────────────────────────────────────

  const nbrs = new Map<string, Set<string>>();
  for (const c of comps) nbrs.set(c.id, new Set());
  for (const conn of conns) {
    const f = conn.from.split(".")[0];
    const t = conn.to.split(".")[0];
    if (!f || !t || f === t || !nbrs.has(f) || !nbrs.has(t)) continue;
    nbrs.get(f)!.add(t);
    nbrs.get(t)!.add(f);
  }

  // ── Categorize ────────────────────────────────────────────────────────────

  const SOURCE_TYPES = new Set<SchComponentType>(["voltage-source", "current-source"]);
  const GROUND_TYPES = new Set<SchComponentType>(["ground"]);
  const NEVER_SHUNT  = new Set<SchComponentType>(["diode"]);

  const roleOf = new Map<string, Role>();
  for (const c of comps) {
    if (SOURCE_TYPES.has(c.type)) { roleOf.set(c.id, "source"); continue; }
    if (GROUND_TYPES.has(c.type)) { roleOf.set(c.id, "ground"); continue; }
    const nbrList = [...(nbrs.get(c.id) ?? [])].sort();
    const gndCnt  = nbrList.filter((n) => {
      const nc = comps.find((x) => x.id === n);
      return nc && GROUND_TYPES.has(nc.type);
    }).length;
    roleOf.set(
      c.id,
      nbrList.length === 2 && gndCnt === 1 && !NEVER_SHUNT.has(c.type) ? "shunt" : "series",
    );
  }

  const sources = comps.filter((c) => roleOf.get(c.id) === "source");
  const grounds = comps.filter((c) => roleOf.get(c.id) === "ground");

  const posSrcs = sources.filter((s) => isPositiveRail(s.id, s.value));
  const negSrcs = sources.filter((s) => isNegativeRail(s.id, s.value));
  const railMode = sources.length >= 2 && posSrcs.length > 0 && negSrcs.length > 0;

  // ── Branch-aware BFS ──────────────────────────────────────────────────────

  const rankOf   = new Map<string, number>();
  const branchOf = new Map<string, number>();
  let nextBranch = 0;

  function bfsFrom(startId: string, startBranch: number, globalSeen: Set<string>): void {
    rankOf.set(startId, 0);
    branchOf.set(startId, startBranch);
    globalSeen.add(startId);
    const queue: { id: string; rank: number; branch: number }[] = [
      { id: startId, rank: 0, branch: startBranch },
    ];
    while (queue.length > 0) {
      const { id, rank, branch } = queue.shift()!;
      const cands = [...(nbrs.get(id) ?? [])]
        .filter((n) => {
          const r = roleOf.get(n);
          return !globalSeen.has(n) && r !== "ground" && r !== "shunt";
        })
        .sort(); // alphabetical = deterministic
      cands.forEach((nid, i) => {
        globalSeen.add(nid);
        // First candidate inherits the current branch; each additional gets a new row
        const b = i === 0 ? branch : nextBranch++;
        rankOf.set(nid, rank + 1);
        branchOf.set(nid, b);
        queue.push({ id: nid, rank: rank + 1, branch: b });
      });
    }
  }

  if (sources.length > 0) {
    nextBranch = 1; // branch 0 is the primary; new branches start at 1
    const globalSeen = new Set<string>();
    bfsFrom(sources[0].id, 0, globalSeen);
    for (let i = 1; i < sources.length; i++) {
      if (!globalSeen.has(sources[i].id)) {
        const b = nextBranch++;
        bfsFrom(sources[i].id, b, globalSeen);
      }
    }
  }

  const maxBranch = nextBranch > 0 ? nextBranch - 1 : 0;
  const gndRailY  = snap(ORIGIN_Y + (maxBranch + 1) * STAGGER_Y + 80);

  // ── Place components ───────────────────────────────────────────────────────

  const pos = new Map<string, SchComponent>();

  // Sources
  if (railMode) {
    posSrcs.forEach((s, i) =>
      pos.set(s.id, {
        id: s.id, type: s.type, value: s.value, rotation: 0,
        x: snap(ORIGIN_X + i * PIN_PITCH),
        y: snap(ORIGIN_Y - STAGGER_Y),
      }),
    );
    negSrcs.forEach((s, i) =>
      pos.set(s.id, {
        id: s.id, type: s.type, value: s.value, rotation: 0,
        x: snap(ORIGIN_X + i * PIN_PITCH),
        y: snap(ORIGIN_Y + (maxBranch + 2) * STAGGER_Y),
      }),
    );
    // Any remaining sources (neither positive nor negative rail)
    for (const s of sources) {
      if (pos.has(s.id)) continue;
      const b = branchOf.get(s.id) ?? 0;
      pos.set(s.id, {
        id: s.id, type: s.type, value: s.value, rotation: 0,
        x: snap(ORIGIN_X),
        y: snap(ORIGIN_Y + b * STAGGER_Y + 40),
      });
    }
  } else {
    for (const s of sources) {
      const b = branchOf.get(s.id) ?? 0;
      pos.set(s.id, {
        id: s.id, type: s.type, value: s.value, rotation: 0,
        x: snap(ORIGIN_X),
        y: snap(ORIGIN_Y + b * STAGGER_Y + 40),
      });
    }
  }

  // Series components on the rank/branch grid
  for (const c of comps) {
    if (pos.has(c.id) || roleOf.get(c.id) !== "series") continue;
    const rank   = rankOf.get(c.id) ?? 0;
    const branch = branchOf.get(c.id) ?? 0;
    pos.set(c.id, {
      id: c.id, type: c.type, value: c.value, rotation: 0,
      x: snap(ORIGIN_X + rank * PIN_PITCH),
      y: snap(ORIGIN_Y + branch * STAGGER_Y),
    });
  }

  // Shunts: vertical, hanging below their non-ground anchor pin
  for (const c of comps) {
    if (roleOf.get(c.id) !== "shunt") continue;
    const nbrList  = [...(nbrs.get(c.id) ?? [])].sort();
    const anchorId = nbrList.find((n) => {
      const nc = comps.find((x) => x.id === n);
      return nc && !GROUND_TYPES.has(nc.type);
    });
    const anchor = anchorId ? pos.get(anchorId) : null;

    let anchorPin: string | undefined;
    for (const conn of conns) {
      const fId = conn.from.split(".")[0], fPin = conn.from.split(".")[1];
      const tId = conn.to.split(".")[0],   tPin = conn.to.split(".")[1];
      if (fId === anchorId && tId === c.id) { anchorPin = fPin; break; }
      if (tId === anchorId && fId === c.id) { anchorPin = tPin; break; }
    }

    const shuntX = anchor && anchorPin
      ? snap(pinWorldPos(anchor, anchorPin).x)
      : snap(ORIGIN_X);
    const anchorBranch = anchorId ? (branchOf.get(anchorId) ?? 0) : 0;
    pos.set(c.id, {
      id: c.id, type: c.type, value: c.value, rotation: 90,
      x: shuntX,
      y: snap(ORIGIN_Y + anchorBranch * STAGGER_Y + GND_DROP_Y),
    });
  }

  // Grounds
  const useGndRail = grounds.length >= 3;

  function groundTargetX(c: { id: string }): number {
    const nbrList = [...(nbrs.get(c.id) ?? [])].sort();
    if (nbrList.length === 0) return ORIGIN_X;
    if (nbrList.length === 1) {
      const nComp = pos.get(nbrList[0]);
      if (!nComp) return ORIGIN_X;
      let nPin: string | undefined;
      for (const conn of conns) {
        const fId = conn.from.split(".")[0], fPin = conn.from.split(".")[1];
        const tId = conn.to.split(".")[0],   tPin = conn.to.split(".")[1];
        if (fId === nbrList[0] && tId === c.id) { nPin = fPin; break; }
        if (tId === nbrList[0] && fId === c.id) { nPin = tPin; break; }
      }
      const pp = nPin ? pinWorldPos(nComp, nPin) : { x: nComp.x, y: nComp.y };
      return snap(pp.x);
    }
    // Multiple neighbors: average x
    let sumX = 0, cnt = 0;
    for (const nid of nbrList) {
      const nc = pos.get(nid);
      if (nc) { sumX += nc.x; cnt++; }
    }
    return cnt > 0 ? snap(sumX / cnt) : ORIGIN_X;
  }

  if (useGndRail) {
    // All grounds go on the horizontal rail; deduplicate by x position
    const seenGndX = new Set<number>();
    for (const c of grounds) {
      const gx = groundTargetX(c);
      seenGndX.add(gx);
      pos.set(c.id, {
        id: c.id, type: c.type, value: c.value, rotation: 0,
        x: gx, y: gndRailY,
      });
    }
  } else {
    for (const c of grounds) {
      const nbrList = [...(nbrs.get(c.id) ?? [])].sort();
      if (nbrList.length === 1) {
        const nId   = nbrList[0];
        const nRole = roleOf.get(nId);
        const nComp = pos.get(nId);
        if (nComp && nRole === "shunt") {
          // Below the shunt's bottom pin (rotation=90: right pin offset {30,0} → {0,30})
          pos.set(c.id, {
            id: c.id, type: c.type, value: c.value, rotation: 0,
            x: nComp.x,
            y: snap(nComp.y + 30 + 30),
          });
        } else if (nComp && nRole === "source") {
          pos.set(c.id, {
            id: c.id, type: c.type, value: c.value, rotation: 0,
            x: nComp.x,
            y: snap(nComp.y + 100),
          });
        } else if (nComp) {
          pos.set(c.id, {
            id: c.id, type: c.type, value: c.value, rotation: 0,
            x: groundTargetX(c),
            y: snap(groundTargetX(c) !== nComp.x
              ? nComp.y + 50
              // If same x as neighbor, go straight down from that pin's y
              : (() => {
                  let nPin: string | undefined;
                  for (const conn of conns) {
                    const fId = conn.from.split(".")[0], fPin = conn.from.split(".")[1];
                    const tId = conn.to.split(".")[0],   tPin = conn.to.split(".")[1];
                    if (fId === nId && tId === c.id) { nPin = fPin; break; }
                    if (tId === nId && fId === c.id) { nPin = tPin; break; }
                  }
                  const pp = nPin ? pinWorldPos(nComp, nPin) : { x: nComp.x, y: nComp.y };
                  return pp.y + 50;
                })()),
          });
        } else {
          pos.set(c.id, {
            id: c.id, type: c.type, value: c.value, rotation: 0,
            x: snap(ORIGIN_X),
            y: snap(ORIGIN_Y + GND_DROP_Y + 80),
          });
        }
      } else {
        // Multi-neighbor ground: average position
        let sumX = 0, cnt = 0;
        for (const nid of nbrList) {
          const nc = pos.get(nid);
          if (nc) { sumX += nc.x; cnt++; }
        }
        pos.set(c.id, {
          id: c.id, type: c.type, value: c.value, rotation: 0,
          x: cnt > 0 ? snap(sumX / cnt) : snap(ORIGIN_X),
          y: snap(ORIGIN_Y + GND_DROP_Y + 60),
        });
      }
    }
  }

  // Defensive: place any still-unpositioned component
  const maxRank = rankOf.size > 0 ? Math.max(...rankOf.values()) : 1;
  let curX = ORIGIN_X + PIN_PITCH * (maxRank + 1);
  for (const c of comps) {
    if (pos.has(c.id)) continue;
    pos.set(c.id, {
      id: c.id, type: c.type, value: c.value, rotation: 0,
      x: snap(curX), y: snap(ORIGIN_Y),
    });
    curX += PIN_PITCH;
  }

  const allPlaced = [...pos.values()];

  // ── Wire generation ────────────────────────────────────────────────────────

  let wires: Wire[] = [];

  for (const conn of conns) {
    const fromId  = conn.from.split(".")[0];
    const fromPin = conn.from.split(".")[1];
    const toId    = conn.to.split(".")[0];
    const toPin   = conn.to.split(".")[1];
    if (!fromId || !fromPin || !toId || !toPin) continue;

    const fromComp = pos.get(fromId);
    const toComp   = pos.get(toId);
    if (!fromComp || !toComp) continue;
    if (!PIN_OFFSETS[fromComp.type]?.[fromPin] || !PIN_OFFSETS[toComp.type]?.[toPin]) continue;

    const aPos = pinWorldPos(fromComp, fromPin);
    const bPos = pinWorldPos(toComp, toPin);
    if (pointEquals(aPos, bPos)) continue;

    const verts = routeWireAvoiding(
      aPos, pinDirection(fromComp, fromPin), bPos, allPlaced, fromId, toId,
    );
    if (verts.length >= 2) wires.push({ id: crypto.randomUUID(), vertices: verts });
  }

  // Ground rail: horizontal bus connecting all ground pin tops
  if (useGndRail) {
    const gndPinXs = grounds
      .map((g) => pos.get(g.id))
      .filter((c): c is SchComponent => !!c)
      .map((c) => pinWorldPos(c, "pin").x)
      .sort((a, b) => a - b);
    if (gndPinXs.length >= 2) {
      const leftX = gndPinXs[0];
      const rightX = gndPinXs[gndPinXs.length - 1];
      if (leftX !== rightX) {
        const railY = snap(gndRailY - 20); // ground pin offset is y=-20
        wires.push({
          id: crypto.randomUUID(),
          vertices: [{ x: leftX, y: railY }, { x: rightX, y: railY }],
        });
      }
    }
  }

  // ── Junction pre-splitting ─────────────────────────────────────────────────

  const endpoints: Point[] = [];
  for (const w of wires) {
    if (w.vertices.length > 0) {
      endpoints.push(w.vertices[0]);
      endpoints.push(w.vertices[w.vertices.length - 1]);
    }
  }
  for (const ep of endpoints) wires = splitWiresAtPoint(wires, ep);
  wires = consolidateWires(wires);

  // Deduplicate ground symbols that land on the same position (rail mode)
  let finalComps = allPlaced;
  if (useGndRail) {
    const seenPos = new Set<string>();
    finalComps = allPlaced.filter((c) => {
      if (c.type !== "ground") return true;
      const key = `${c.x},${c.y}`;
      if (seenPos.has(key)) return false;
      seenPos.add(key);
      return true;
    });
  }

  return { components: finalComps, wires };
}

