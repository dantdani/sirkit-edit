// Route commands (Stage 7): apply/invert round-trips, unique ids, per-net
// ripup, and via layer spans. Pure — no Pixi/React.

import { describe, it, expect } from "vitest";
import {
  applyRouteCommand,
  invertRouteCommand,
  buildRipupNetCommand,
  routeCommandLabel,
  type RouteCommand,
} from "../route-tool.commands";
import { buildRoutedDemo } from "../demo/routed-demo";
import { createEmptyBoard } from "../types";
import type { PcbBoard, Track, Via } from "../types";
import { mmToNm } from "../units";

function board(nets: number[]): PcbBoard {
  return {
    ...createEmptyBoard(),
    nets: [{ id: 0, name: "" }, ...nets.map((id) => ({ id, name: `N${id}` }))],
  };
}

function track(id: string, netId: number, ax: number, ay: number, bx: number, by: number): Track {
  return {
    id,
    layer: "copperTop",
    width: mmToNm(0.25),
    start: { x: mmToNm(ax), y: mmToNm(ay) },
    end: { x: mmToNm(bx), y: mmToNm(by) },
    netId,
    source: "human",
  };
}

function via(id: string, netId: number, x: number, y: number): Via {
  return {
    id,
    at: { x: mmToNm(x), y: mmToNm(y) },
    size: mmToNm(0.8),
    drill: mmToNm(0.4),
    netId,
    layers: ["copperTop", "copperBottom"],
    source: "human",
  };
}

/** Compare boards as SETS of tracks/vias (RipupNet→re-add loses array order). */
function norm(b: PcbBoard): PcbBoard {
  const byId = (a: { id: string }, c: { id: string }): number => (a.id < c.id ? -1 : a.id > c.id ? 1 : 0);
  return { ...b, tracks: [...b.tracks].sort(byId), vias: [...b.vias].sort(byId) };
}

describe("applyRouteCommand / invertRouteCommand round-trips", () => {
  it("CommitRouteSegment (add then remove-by-net) restores a fresh net", () => {
    const b0 = board([5]); // net 5 has no tracks yet
    const cmd: RouteCommand = {
      kind: "CommitRouteSegment",
      netId: 5,
      segments: [track("s1", 5, 10, 10, 20, 10), track("s2", 5, 20, 10, 30, 20)],
    };
    const b1 = applyRouteCommand(b0, cmd);
    expect(b1.tracks).toHaveLength(2);
    const b2 = applyRouteCommand(b1, invertRouteCommand(cmd));
    expect(norm(b2)).toEqual(norm(b0));
  });

  it("PlaceViaAndFlipLayer round-trips (removes via + segments)", () => {
    const b0 = board([5]);
    const cmd: RouteCommand = {
      kind: "PlaceViaAndFlipLayer",
      via: via("v1", 5, 15, 15),
      segments: [track("s1", 5, 10, 15, 15, 15)],
    };
    const b1 = applyRouteCommand(b0, cmd);
    expect(b1.vias).toHaveLength(1);
    expect(b1.tracks).toHaveLength(1);
    const b2 = applyRouteCommand(b1, invertRouteCommand(cmd));
    expect(norm(b2)).toEqual(norm(b0));
  });

  it("StretchTrack round-trips (self-inverse, order preserved)", () => {
    const b0: PcbBoard = { ...board([5]), tracks: [track("t1", 5, 10, 10, 30, 10), track("t2", 5, 30, 10, 40, 10)] };
    const before = [b0.tracks[0]];
    const after = [{ ...b0.tracks[0], end: { x: mmToNm(35), y: mmToNm(15) } }];
    const cmd: RouteCommand = { kind: "StretchTrack", before, after };
    const b1 = applyRouteCommand(b0, cmd);
    expect(b1.tracks[0].end).toEqual({ x: mmToNm(35), y: mmToNm(15) });
    const b2 = applyRouteCommand(b1, invertRouteCommand(cmd));
    expect(b2).toEqual(b0); // exact — StretchTrack preserves array position
  });

  it("RipupNet on the demo GND net round-trips", () => {
    const demo = buildRoutedDemo();
    const cmd = buildRipupNetCommand(demo, 1); // GND, no vias
    const stripped = applyRouteCommand(demo, cmd);
    const restored = applyRouteCommand(stripped, invertRouteCommand(cmd));
    expect(norm(restored)).toEqual(norm(demo));
  });
});

describe("command semantics", () => {
  it("adds and inverts structured Smart Route history with the copper", () => {
    const b0 = board([5]);
    const event = {
      schemaVersion: 1 as const,
      id: "history-1",
      tool: "smart-route" as const,
      baseWorldRevision: "rw1-test",
      netId: 5,
      layer: "copperTop" as const,
      candidateId: "candidate-1",
      mode: "direct" as const,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      segmentIds: ["smart-1"],
      rules: { trackWidthNm: 250_000, clearanceNm: 200_000, edgeClearanceNm: 250_000, gridNm: 25_000 },
      score: 10,
      explanation: "Deterministic direct route.",
    };
    const cmd: RouteCommand = {
      kind: "CommitRouteSegment",
      netId: 5,
      segments: [track("smart-1", 5, 0, 0, 10, 0)],
      historyEvents: [event],
    };
    const applied = applyRouteCommand(b0, cmd);
    expect(applied.routingHistory).toEqual([event]);
    expect(applyRouteCommand(applied, invertRouteCommand(cmd))).toEqual(b0);
  });

  it("CommitRouteSegment with 2 segments keeps both, ids intact and unique", () => {
    const b0 = board([5]);
    const cmd: RouteCommand = {
      kind: "CommitRouteSegment",
      netId: 5,
      segments: [track("aaa", 5, 0, 0, 10, 0), track("bbb", 5, 10, 0, 20, 0)],
    };
    const b1 = applyRouteCommand(b0, cmd);
    const ids = b1.tracks.map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("aaa");
    expect(ids).toContain("bbb");
  });

  it("RipupNet on demo GND removes exactly the GND tracks and no others", () => {
    const demo = buildRoutedDemo();
    const gndBefore = demo.tracks.filter((t) => t.netId === 1).length;
    const otherBefore = demo.tracks.filter((t) => t.netId !== 1).length;
    expect(gndBefore).toBeGreaterThan(0);
    const stripped = applyRouteCommand(demo, buildRipupNetCommand(demo, 1));
    expect(stripped.tracks.filter((t) => t.netId === 1)).toHaveLength(0);
    expect(stripped.tracks.filter((t) => t.netId !== 1)).toHaveLength(otherBefore);
    // GND zone is untouched (zones aren't copper items).
    expect(stripped.zones).toHaveLength(demo.zones.length);
  });

  it("PlaceViaAndFlipLayer adds the via with the anchor's layer and its opposite", () => {
    const b0 = board([2]);
    const cmd: RouteCommand = {
      kind: "PlaceViaAndFlipLayer",
      via: via("v9", 2, 40, 40),
      segments: [],
    };
    const b1 = applyRouteCommand(b0, cmd);
    expect(b1.vias).toHaveLength(1);
    expect(b1.vias[0].layers).toEqual(["copperTop", "copperBottom"]);
    expect(b1.vias[0].netId).toBe(2);
  });

  it("does not mutate the input board (immer purity)", () => {
    const b0 = board([5]);
    const before = b0.tracks.length;
    applyRouteCommand(b0, { kind: "CommitRouteSegment", netId: 5, segments: [track("s1", 5, 0, 0, 10, 0)] });
    expect(b0.tracks).toHaveLength(before);
  });

  it("routeCommandLabel resolves net names", () => {
    const demo = buildRoutedDemo();
    expect(routeCommandLabel(buildRipupNetCommand(demo, 1), demo)).toBe("Rip up GND");
    expect(
      routeCommandLabel({ kind: "CommitRouteSegment", netId: 3, segments: [] }, demo),
    ).toBe("Route SIG");
  });
});
