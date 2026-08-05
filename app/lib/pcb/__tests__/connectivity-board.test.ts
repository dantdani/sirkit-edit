// Board connectivity engine (PCB Stage 6) — the pinned contract tests.
// Boards are built programmatically; the routed demo fixture is asserted too
// so it can't drift from what Stage 7 starts from.

import { describe, expect, it } from "vitest";
import { mmToNm } from "../units";
import type { Vec2 } from "../geometry";
import type { LayerId } from "../layers";
import type {
  FootprintDef,
  FootprintInstance,
  Pad,
  PcbBoard,
  Track,
  Via,
} from "../types";
import { createEmptyBoard } from "../types";
import { computeConnectivity, type CopperItemRef } from "../connectivity-board";
import { buildRoutedDemo } from "../demo/routed-demo";

const mm = (v: number): number => mmToNm(v);
const v = (xMm: number, yMm: number): Vec2 => ({ x: mm(xMm), y: mm(yMm) });

// ── Programmatic board kit ───────────────────────────────────────────────────

function circlePad(number: string, atMm: Vec2, layers: LayerId[] = ["copperTop"]): Pad {
  return {
    number,
    type: "smd",
    shape: { kind: "circle", radius: mm(0.5) },
    at: { x: mm(atMm.x), y: mm(atMm.y) },
    rotationDeg: 0,
    layers,
  };
}

let instN = 0;
function inst(
  atMm: Vec2,
  pads: Pad[],
  padNets: Record<string, number>,
): FootprintInstance {
  const def: FootprintDef = {
    libName: "test",
    name: "fp",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads,
    graphics: [],
    bodyBBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    models: [],
    rawSexpr: "",
  };
  const n = ++instN;
  return {
    id: `inst-${n}`,
    ref: `U${n}`,
    footprintId: "test:fp",
    def,
    at: { x: mm(atMm.x), y: mm(atMm.y) },
    rotationDeg: 0,
    side: "top",
    padNets,
  };
}

let trackN = 0;
function track(netId: number, start: Vec2, end: Vec2, layer: LayerId = "copperTop"): Track {
  return { id: `t-${++trackN}`, layer, width: mm(0.25), start, end, netId };
}

let viaN = 0;
function via(netId: number, at: Vec2): Via {
  return {
    id: `v-${++viaN}`,
    at,
    size: mm(0.6),
    drill: mm(0.3),
    netId,
    layers: ["copperTop", "copperBottom"],
  };
}

function board(parts: {
  footprints?: FootprintInstance[];
  tracks?: Track[];
  vias?: Via[];
  nets?: { id: number; name: string }[];
}): PcbBoard {
  const b = createEmptyBoard();
  b.footprints = parts.footprints ?? [];
  b.tracks = parts.tracks ?? [];
  b.vias = parts.vias ?? [];
  const declaredNets = parts.nets ?? [{ id: 1, name: "N1" }];
  b.nets = [
    { id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] },
    ...declaredNets.map((net) => ({ ...net, stableId: `net:test-${net.id}`, endpointKeys: [] })),
  ];
  return b;
}

/** Order-insensitive key for an airwire's endpoint pair. */
function endpointKey(a: Vec2, b: Vec2): string {
  const k1 = `${a.x},${a.y}`;
  const k2 = `${b.x},${b.y}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

function refKey(r: CopperItemRef): string {
  if (r.kind === "pad") return `pad:${r.instanceId}/${r.padNumber}`;
  if (r.kind === "zone-region") return `zone:${r.zoneId}#${r.regionIndex}`; // Stage 11
  return `${r.kind}:${r.id}`;
}

// ── (a) two pads + joining track → one cluster, complete, no airwires ────────

it("two pads joined by a track form one complete cluster", () => {
  const a = inst({ x: 0, y: 0 }, [circlePad("1", { x: 0, y: 0 })], { "1": 1 });
  const b = inst({ x: 10, y: 0 }, [circlePad("1", { x: 0, y: 0 })], { "1": 1 });
  const conn = computeConnectivity(
    board({ footprints: [a, b], tracks: [track(1, v(0, 0), v(10, 0))] }),
  );
  const net = conn.nets.get(1);
  expect(net).toBeDefined();
  expect(net?.clusters).toHaveLength(1);
  expect(net?.clusters[0]).toHaveLength(3);
  expect(net?.complete).toBe(true);
  expect(conn.airwires).toHaveLength(0);
  expect(conn.shorts).toHaveLength(0);
  expect(conn.orphans).toHaveLength(0);
  expect(conn.completion).toEqual({ routedNets: 1, totalNets: 1, percent: 100 });
});

// ── (b) chain with a gap → two clusters, one airwire at the closest pair ─────

it("a gap in the chain yields exactly one airwire between the closest points", () => {
  const a = inst({ x: 0, y: 0 }, [circlePad("1", { x: 0, y: 0 })], { "1": 1 });
  const b = inst({ x: 10, y: 0 }, [circlePad("1", { x: 0, y: 0 })], { "1": 1 });
  const conn = computeConnectivity(
    board({
      footprints: [a, b],
      tracks: [track(1, v(0, 0), v(4, 0)), track(1, v(6, 0), v(10, 0))],
    }),
  );
  const net = conn.nets.get(1);
  expect(net?.clusters).toHaveLength(2);
  expect(net?.complete).toBe(false);
  expect(conn.airwires).toHaveLength(1);
  expect(conn.airwires[0].netId).toBe(1);
  // Endpoints are the argmin pair: the two facing track ends.
  expect(endpointKey(conn.airwires[0].from, conn.airwires[0].to)).toBe(
    endpointKey(v(4, 0), v(6, 0)),
  );
  expect(conn.completion.routedNets).toBe(0);
});

// ── (c) top track + via + bottom track → one cluster ─────────────────────────

it("copper joins across layers through a via", () => {
  const a = inst({ x: 0, y: 0 }, [circlePad("1", { x: 0, y: 0 }, ["copperTop"])], { "1": 1 });
  const b = inst({ x: 10, y: 0 }, [circlePad("1", { x: 0, y: 0 }, ["copperBottom"])], { "1": 1 });
  const conn = computeConnectivity(
    board({
      footprints: [a, b],
      tracks: [
        track(1, v(0, 0), v(5, 0), "copperTop"),
        track(1, v(5, 0), v(10, 0), "copperBottom"),
      ],
      vias: [via(1, v(5, 0))],
    }),
  );
  const net = conn.nets.get(1);
  expect(net?.clusters).toHaveLength(1);
  expect(net?.clusters[0]).toHaveLength(5);
  expect(net?.complete).toBe(true);
  expect(conn.airwires).toHaveLength(0);
});

// ── (d) cross-net touch → one short; both nets still tracked ─────────────────

it("a cross-net touch is a short, not a join", () => {
  const tA = track(1, v(0, 0), v(10, 0));
  const tB = track(2, v(5, -5), v(5, 5));
  const conn = computeConnectivity(
    board({
      tracks: [tA, tB],
      nets: [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
      ],
    }),
  );
  expect(conn.shorts).toHaveLength(1);
  expect(conn.shorts[0].map(refKey).sort()).toEqual(
    [`track:${tA.id}`, `track:${tB.id}`].sort(),
  );
  expect(conn.nets.get(1)?.clusters).toHaveLength(1);
  expect(conn.nets.get(2)?.clusters).toHaveLength(1);
  // Touching items are not orphans, even across nets.
  expect(conn.orphans).toHaveLength(0);
});

// ── (e) empty copper → airwires degenerate to the pad-MST ────────────────────

it("with no copper, airwires equal the pad-MST", () => {
  // NOTE: the wave plan cross-checks this against Stage 5's computeRatsnest for
  // the same board. Stage 5 hasn't merged yet, so the expected MST is computed
  // by hand here (unique MST for these positions); swap in the ratsnest
  // comparison in the integration window.
  const positionsMm = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 30, y: 0 },
  ];
  const pads = positionsMm.map((p) =>
    inst(p, [circlePad("1", { x: 0, y: 0 })], { "1": 1 }),
  );
  const conn = computeConnectivity(board({ footprints: pads }));
  expect(conn.airwires).toHaveLength(3);
  const got = conn.airwires.map((w) => endpointKey(w.from, w.to)).sort();
  const want = [
    endpointKey(v(0, 0), v(10, 0)),
    endpointKey(v(10, 0), v(10, 10)),
    endpointKey(v(10, 0), v(30, 0)),
  ].sort();
  expect(got).toEqual(want);
  expect(conn.completion).toEqual({ routedNets: 0, totalNets: 1, percent: 0 });
});

// ── (f) netId-0 track touching nothing → orphan ──────────────────────────────

it("a netId-0 track touching nothing is an orphan", () => {
  const conn = computeConnectivity(board({ tracks: [track(0, v(50, 50), v(55, 50))] }));
  expect(conn.orphans).toHaveLength(1);
  expect(refKey(conn.orphans[0])).toMatch(/^track:/);
  expect(conn.nets.size).toBe(0);
  expect(conn.shorts).toHaveLength(0);
});

// ── Routed demo fixture — pinned so ?pcbdemo=routed can't drift ──────────────

describe("buildRoutedDemo", () => {
  const demo = buildRoutedDemo();
  const conn = computeConnectivity(demo);

  it("has the authored shape (8 instances, top+bottom tracks, 2 vias, 1 zone)", () => {
    expect(demo.footprints).toHaveLength(8);
    expect(demo.tracks.filter((t) => t.layer === "copperTop").length).toBeGreaterThanOrEqual(12);
    expect(demo.tracks.filter((t) => t.layer === "copperBottom")).toHaveLength(2);
    expect(demo.vias).toHaveLength(2);
    expect(demo.zones).toHaveLength(1);
    expect(demo.zones[0].netId).toBe(1);
  });

  it("GND and VCC are complete; SIG has exactly one airwire", () => {
    expect(conn.nets.get(1)?.complete).toBe(true);
    expect(conn.nets.get(2)?.complete).toBe(true);
    expect(conn.nets.get(3)?.complete).toBe(false);
    expect(conn.airwires).toHaveLength(1);
    expect(conn.airwires[0].netId).toBe(3);
    expect(conn.completion.routedNets).toBe(2);
    expect(conn.completion.totalNets).toBe(3);
  });

  it("has exactly the one deliberate short and the one deliberate orphan", () => {
    expect(conn.shorts).toHaveLength(1);
    expect(conn.orphans).toHaveLength(1);
  });
});

// ── (g) perf: ~5,000 copper items in < 50 ms ─────────────────────────────────

it("computeConnectivity handles a 200-instance / ~5k-item board in <50 ms", () => {
  // 200 two-pad instances in a 20×10 grid; 100 nets, each routed between an
  // adjacent instance pair as a 44-segment chain (top → via → bottom → via →
  // top). Every 5th net has a segment removed → incomplete, exercising the MST.
  const footprints: FootprintInstance[] = [];
  const tracks: Track[] = [];
  const vias: Via[] = [];
  const nets: { id: number; name: string }[] = [];

  for (let k = 0; k < 200; k++) {
    const col = k % 20;
    const row = Math.floor(k / 20);
    const x = 8 + col * 8;
    const y = 8 + row * 8;
    const netId = Math.floor(k / 2) + 1;
    const padNets: Record<string, number> = k % 2 === 0 ? { "2": netId } : { "1": netId };
    footprints.push(
      inst({ x, y }, [circlePad("1", { x: -1, y: 0 }), circlePad("2", { x: 1, y: 0 })], padNets),
    );
  }
  for (let i = 0; i < 100; i++) {
    const netId = i + 1;
    nets.push({ id: netId, name: `N${netId}` });
    const k = i * 2;
    const x0 = 8 + (k % 20) * 8 + 1; // pad 2 of the left instance
    const y = 8 + Math.floor(k / 20) * 8;
    const SEGS = 44;
    const step = 6 / SEGS; // pad-to-pad span is 6 mm
    for (let s = 0; s < SEGS; s++) {
      // Deliberate gap: 3 consecutive segments (~0.41 mm) — wider than the
      // 0.25 mm track width, so the remaining capsules can't bridge it.
      if (netId % 5 === 0 && s >= 7 && s <= 9) continue;
      const layer: LayerId = s < 15 ? "copperTop" : s < 29 ? "copperBottom" : "copperTop";
      tracks.push(track(netId, v(x0 + s * step, y), v(x0 + (s + 1) * step, y), layer));
    }
    vias.push(via(netId, v(x0 + 15 * step, y)), via(netId, v(x0 + 29 * step, y)));
  }

  const b = board({ footprints, tracks, vias, nets });
  const itemCount = footprints.length * 2 + tracks.length + vias.length;
  expect(itemCount).toBeGreaterThanOrEqual(4900);

  // Steady-state, best of 3: every call is a FULL rebuild from the raw board
  // (the engine keeps no state between calls — that's the pinned design), and
  // steady-state is what the editor sees, since connectivity re-runs on every
  // board edit. One untimed call first so JIT tier-up and OS scheduler noise
  // can't flake the gate.
  const runs: number[] = [];
  let conn = computeConnectivity(b);
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    conn = computeConnectivity(b);
    runs.push(performance.now() - t0);
  }
  const elapsed = Math.min(...runs);

  // eslint-disable-next-line no-console
  console.log(
    `perf: computeConnectivity over ${itemCount} items: best ${elapsed.toFixed(1)} ms` +
      ` (runs: ${runs.map((r) => r.toFixed(1)).join(", ")})`,
  );
  expect(elapsed).toBeLessThan(50);

  expect(conn.completion.totalNets).toBe(100);
  expect(conn.completion.routedNets).toBe(80);
  expect(conn.airwires).toHaveLength(20);
  expect(conn.shorts).toHaveLength(0);
});
