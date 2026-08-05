// Zone fill engine (PCB Stage 11) — the contract tests. Fills must stay inside
// the polygon ∩ outline-inset, clear foreign copper by the effective clearance
// (never less — arcs are circumscribed, so slightly MORE is correct), connect
// same-net pads through thermal spokes, and pour the routed demo in < 300 ms.

import { describe, expect, it } from "vitest";
import { mmToNm } from "../units";
import type { Vec2 } from "../geometry";
import type { LayerId } from "../layers";
import type { PcbBoard, Track, Zone } from "../types";
import { createEmptyBoard } from "../types";
import { regionContainsPoint, regionShapeDistance, outlinePolygon } from "../zones/geometry";
import { trackShape } from "../geometry-copper";
import { buildRoutedDemo } from "../demo/routed-demo";
import { runDrc } from "../drc/run-drc";
import { getPreset, DEFAULT_PRESET_ID } from "../drc/presets";
import { applyZoneFillCandidate, computeZoneFillCandidate } from "../zones/fill-lifecycle";

const mm = (v: number): number => mmToNm(v);
const v2 = (xMm: number, yMm: number): Vec2 => ({ x: mm(xMm), y: mm(yMm) });

let zoneN = 0;
function zone(polygon: Vec2[], opts?: Partial<Pick<Zone, "layer" | "netId" | "connection" | "clearanceOverrideNm">>): Zone {
  return {
    id: `z-${++zoneN}`,
    layer: opts?.layer ?? "copperTop",
    netId: opts?.netId ?? 1,
    polygon,
    appearance: "solid",
    connection: opts?.connection ?? "thermal",
    ...(opts?.clearanceOverrideNm !== undefined ? { clearanceOverrideNm: opts.clearanceOverrideNm } : {}),
    fill: [],
    dirty: true,
  };
}

function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [v2(x0, y0), v2(x1, y0), v2(x1, y1), v2(x0, y1)];
}

function fill(board: PcbBoard, z: Zone) {
  board.zones.push(z);
  const candidate = computeZoneFillCandidate(board, z);
  applyZoneFillCandidate(board, candidate);
  return candidate.result;
}

let trackN = 0;
function track(netId: number, start: Vec2, end: Vec2, layer: LayerId = "copperTop"): Track {
  return { id: `cft-${++trackN}`, layer, width: mm(0.25), start, end, netId };
}

let instN = 0;
/** One-pad footprint (0.5 mm circle SMD on copperTop) on GND (net 1). */
function gndPadInstance(at: Vec2) {
  return {
    id: `cf-inst-${++instN}`,
    ref: `U${instN}`,
    footprintId: "test:fp",
    def: {
      libName: "test",
      name: "fp",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      pads: [
        {
          number: "1",
          type: "smd" as const,
          shape: { kind: "circle" as const, radius: mm(0.5) },
          at: { x: 0, y: 0 },
          rotationDeg: 0,
          layers: ["copperTop" as const],
        },
      ],
      graphics: [],
      bodyBBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      models: [],
      rawSexpr: "",
    },
    at,
    rotationDeg: 0,
    side: "top" as const,
    padNets: { "1": 1 },
  };
}

describe("computeFill", () => {
  it("(a) empty board: one region matching the polygon (well inside the outline)", () => {
    const board = createEmptyBoard(); // 100×80 mm
    board.nets.push({ id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] });
    const z = zone(rect(10, 10, 40, 40));
    const { regions, stats } = fill(board, z);
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(0);
    expect(regions[0].boundingBox).toEqual({
      minX: mm(10),
      minY: mm(10),
      maxX: mm(40),
      maxY: mm(40),
    });
    expect(stats.islandsDropped).toBe(0);
  });

  it("(a2) full-board zone is inset from the outline by the edge clearance", () => {
    const board = createEmptyBoard();
    board.nets.push({ id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] });
    const z = zone(outlinePolygon(board.outline));
    const { regions } = fill(board, z);
    expect(regions).toHaveLength(1);
    const b = regions[0].boundingBox;
    // ≥ 300 µm (never closer to the edge); circumscribed erosion may add ~2%.
    expect(b.minX).toBeGreaterThanOrEqual(300_000);
    expect(b.minX).toBeLessThanOrEqual(320_000);
    expect(b.maxX).toBeLessThanOrEqual(mm(100) - 300_000);
    expect(b.maxY).toBeLessThanOrEqual(mm(80) - 300_000);
  });

  it("(b) a foreign-net track through the middle splits the fill in two, clearance respected", () => {
    const board = createEmptyBoard();
    board.nets.push(
      { id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] },
      { id: 2, name: "SIG", stableId: "net:sig", endpointKeys: [] },
    );
    const t = track(2, v2(5, 25), v2(45, 25));
    board.tracks.push(t);
    const z = zone(rect(10, 10, 40, 40));
    const { regions } = fill(board, z);
    expect(regions).toHaveLength(2);
    for (const region of regions) {
      const d = regionShapeDistance(region, trackShape(t), t.start);
      expect(d).toBeGreaterThanOrEqual(200_000); // Default-class clearance
    }
  });

  it("(c) a same-net pad gets a thermal relief: gap holes + 4 reconnecting spokes", () => {
    const board = createEmptyBoard();
    board.nets.push({ id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] });
    board.footprints.push(gndPadInstance(v2(25, 25)));
    const z = zone(rect(10, 10, 40, 40), { connection: "thermal" });
    const { regions } = fill(board, z);
    expect(regions).toHaveLength(1);
    // The annular gap minus 4 spokes leaves 4 hole fragments.
    expect(regions[0].holes).toHaveLength(4);
    // Copper along a 45° spoke (gap = clearance/2 = 100 µm; probe mid-gap).
    const r = mm(0.5) + 50_000;
    const c = Math.SQRT1_2;
    expect(
      regionContainsPoint(regions[0], {
        x: Math.round(mm(25) + r * c),
        y: Math.round(mm(25) - r * c),
      }),
    ).toBe(true);
    // No copper in the gap at 0° (between spokes).
    expect(regionContainsPoint(regions[0], { x: Math.round(mm(25) + r), y: mm(25) })).toBe(false);
  });

  it("(c2) solid connection pours straight over the same-net pad (no holes)", () => {
    const board = createEmptyBoard();
    board.nets.push({ id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] });
    board.footprints.push(gndPadInstance(v2(25, 25)));
    const z = zone(rect(10, 10, 40, 40), { connection: "solid" });
    const { regions } = fill(board, z);
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(0);
  });

  it("(d) routed demo: GND zones spanning both copper layers pour in < 300 ms, DRC-clean", () => {
    const board = buildRoutedDemo();
    board.zones = []; // replace the small fixture zone with full-board planes
    const outline = outlinePolygon(board.outline);
    const top = zone(outline, { layer: "copperTop", netId: 1 });
    const bottom = zone(outline, { layer: "copperBottom", netId: 1 });

    const rTop = fill(board, top);
    const rBottom = fill(board, bottom);
    const elapsed = rTop.stats.elapsedMs + rBottom.stats.elapsedMs;

    expect(rTop.regions.length).toBeGreaterThanOrEqual(1);
    expect(rBottom.regions.length).toBeGreaterThanOrEqual(1);
    console.log(
      `perf: computeFill routed-demo top ${rTop.stats.elapsedMs.toFixed(1)} ms` +
        ` (${rTop.regions.length} regions), bottom ${rBottom.stats.elapsedMs.toFixed(1)} ms` +
        ` (${rBottom.regions.length} regions)`,
    );
    expect(elapsed).toBeLessThan(300);

    // Stage 12 integration: fills honor the rules — zero zone-related
    // clearance/edge violations on the poured board.
    top.fill = rTop.regions;
    bottom.fill = rBottom.regions;
    const drc = runDrc(board, getPreset(DEFAULT_PRESET_ID).rules);
    const zoneViolations = drc.violations.filter(
      (viol) =>
        (viol.kind === "clearance" || viol.kind === "edgeClearance") &&
        viol.items.some((ref) => ref.kind === "zone-region"),
    );
    expect(zoneViolations).toHaveLength(0);
  });

  it("(d2) an under-rules clearance override makes DRC fire against the zone", () => {
    const board = createEmptyBoard();
    board.nets.push(
      { id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] },
      { id: 2, name: "SIG", stableId: "net:sig", endpointKeys: [] },
    );
    const t = track(2, v2(5, 25), v2(45, 25));
    board.tracks.push(t);
    const z = zone(rect(10, 10, 40, 40), { clearanceOverrideNm: 100_000 }); // rules want ≥ 0.127+ mm
    const { regions } = fill(board, z);
    z.fill = regions;
    const drc = runDrc(board, getPreset(DEFAULT_PRESET_ID).rules);
    const zoneClearance = drc.violations.filter(
      (viol) => viol.kind === "clearance" && viol.items.some((ref) => ref.kind === "zone-region"),
    );
    expect(zoneClearance.length).toBeGreaterThan(0);
  });
});
