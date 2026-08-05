// Interactive routing tool (Stage 7): state machine + live clearance guard.
// Controlled boards give exact geometry; the routed demo covers the real
// fixture. Pure — no Pixi/React.

import { describe, it, expect } from "vitest";
import {
  createRouteTool,
  fortyFiveCorner,
  checkClearance,
  DEFAULT_CLEARANCE,
  type RouteToolState,
  type RouteToolOptions,
} from "../route-tool";
import { applyRouteCommand, type RouteCommand } from "../route-tool.commands";
import { buildRoutedDemo } from "../demo/routed-demo";
import { createEmptyBoard } from "../types";
import type { FootprintDef, FootprintInstance, PcbBoard, Track } from "../types";
import { mmToNm } from "../units";

const EV = { shiftKey: false, altKey: false };
const P = (xMm: number, yMm: number) => ({ x: mmToNm(xMm), y: mmToNm(yMm) });

function padDef(): FootprintDef {
  return {
    libName: "T",
    name: "PAD",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [
      {
        number: "1",
        type: "smd",
        shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1) },
        at: { x: 0, y: 0 },
        rotationDeg: 0,
        layers: ["copperTop", "maskTop"],
      },
    ],
    graphics: [],
    bodyBBox: { minX: -mmToNm(0.5), minY: -mmToNm(0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) },
    models: [],
    rawSexpr: "",
  };
}

function padInst(id: string, ref: string, xMm: number, yMm: number, netId: number): FootprintInstance {
  return {
    id,
    ref,
    footprintId: "T:PAD",
    def: padDef(),
    at: { x: mmToNm(xMm), y: mmToNm(yMm) },
    rotationDeg: 0,
    side: "top",
    padNets: { "1": netId },
  };
}

/** Same as padInst but with explicit pad copper layers (e.g. bottom-only). */
function padInstLayers(
  id: string,
  ref: string,
  xMm: number,
  yMm: number,
  netId: number,
  layers: FootprintInstance["def"]["pads"][number]["layers"],
): FootprintInstance {
  const base = padInst(id, ref, xMm, yMm, netId);
  return { ...base, def: { ...base.def, pads: [{ ...base.def.pads[0], layers }] } };
}

function trk(id: string, netId: number, ax: number, ay: number, bx: number, by: number): Track {
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

function boardWith(
  footprints: FootprintInstance[],
  tracks: Track[] = [],
  nets: number[] = [1, 2],
): PcbBoard {
  return {
    ...createEmptyBoard(),
    identityVersion: 1,
    nets: [
      { id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] },
      ...nets.map((id) => ({ id, name: `N${id}`, stableId: `net:n${id}`, endpointKeys: [] })),
    ],
    footprints,
    tracks,
  };
}

/** Mimics the live wiring: applyCommand → immer-history-style rebuild + undo. */
function harness(initial: PcbBoard, options: RouteToolOptions = {}) {
  let board = initial;
  const commands: RouteCommand[] = [];
  const history: RouteCommand[] = [];
  const rebuild = (): void => {
    board = history.reduce((b, c) => applyRouteCommand(b, c), initial);
  };
  const apply = (cmd: RouteCommand): void => {
    commands.push(cmd);
    history.push(cmd);
    rebuild();
  };
  const undo = (): void => {
    history.pop();
    rebuild();
  };
  const tool = createRouteTool(() => board, apply, { undo, getActiveLayer: () => "copperTop", ...options });
  return { tool, commands, board: () => board };
}

function asRouting(s: RouteToolState): Extract<RouteToolState, { kind: "routing" }> {
  if (s.kind !== "routing") throw new Error(`expected routing, got ${s.kind}`);
  return s;
}
function asStretch(s: RouteToolState): Extract<RouteToolState, { kind: "stretching" }> {
  if (s.kind !== "stretching") throw new Error(`expected stretching, got ${s.kind}`);
  return s;
}

describe("fortyFiveCorner", () => {
  it("is axis-aligned when one delta is zero (single segment)", () => {
    expect(fortyFiveCorner(P(10, 10), P(30, 10), true)).toEqual(P(30, 10));
    expect(fortyFiveCorner(P(10, 10), P(10, 40), false)).toEqual(P(10, 40));
  });
  it("collapses to a single diagonal when |dx| === |dy|", () => {
    expect(fortyFiveCorner(P(0, 0), P(10, 10), true)).toEqual(P(10, 10));
  });
  it("straight-first vs diagonal-first give distinct valid corners", () => {
    const a = P(20, 30);
    const b = P(50, 45); // dx=30, dy=15
    expect(fortyFiveCorner(a, b, true)).toEqual(P(35, 30)); // H run then 45°
    expect(fortyFiveCorner(a, b, false)).toEqual(P(35, 45)); // 45° then H run
  });
});

describe("route tool — happy path", () => {
  it("click pad, click same-net pad → one L-bend commit, back to idle", () => {
    const { tool, commands } = harness(boardWith([padInst("a", "A", 20, 30, 1), padInst("b", "B", 50, 45, 1)]));
    tool.onPointerDown(P(20, 30), EV);
    expect(tool.state.kind).toBe("routing");
    tool.onPointerMove(P(50, 45));
    tool.onPointerDown(P(50, 45), EV);

    expect(commands).toHaveLength(1);
    const cmd = commands[0];
    expect(cmd.kind).toBe("CommitRouteCandidate");
    if (cmd.kind !== "CommitRouteCandidate") throw new Error("unreachable");
    expect(cmd.candidate.delta.createdTracks.length).toBe(2); // L-bend
    expect(cmd.candidate.delta.createdTracks.some((track) => track.start.x === P(20, 30).x && track.start.y === P(20, 30).y)).toBe(true);
    expect(cmd.candidate.delta.createdTracks.some((track) => track.end.x === P(50, 45).x && track.end.y === P(50, 45).y)).toBe(true);
    expect(new Set(cmd.candidate.delta.createdTracks.map((s) => s.id)).size).toBe(cmd.candidate.delta.createdTracks.length);
    expect(tool.state.kind).toBe("idle"); // completed onto a same-net pad
  });
});

describe("route tool — live guard", () => {
  it("walks around another net without moving the blocker", () => {
    const { tool, commands } = harness(
      boardWith([padInst("a", "A", 20, 30, 1), padInst("b", "B", 60, 30, 1)], [trk("blk", 2, 40, 20, 40, 40)]),
    );
    tool.onPointerDown(P(20, 30), EV);
    tool.onPointerMove(P(60, 30)); // crosses the net-2 blocker at x=40
    const st = asRouting(tool.state);
    expect(st.preview.legal).toBe(true);
    expect(st.preview.smartStatus).toBe("walking-around");
    expect(st.preview.candidates).toHaveLength(2);
    expect(st.preview.points?.length).toBeGreaterThan(2);
    tool.onPointerDown(P(60, 30), EV);
    expect(commands).toHaveLength(1);
    expect(commands[0].kind).toBe("CommitRouteCandidate");
    if (commands[0].kind !== "CommitRouteCandidate") throw new Error("expected route command");
    expect(commands[0].candidate.delta.createdTracks.length).toBeGreaterThan(2);
    expect(commands[0].candidate.request.routeMode).toBe("walk_around");
    expect(tool.state.kind).toBe("idle");
  });

  it("candidate choice is deterministic across identical previews", () => {
    const { tool } = harness(
      boardWith([padInst("a", "A", 20, 30, 1)], [trk("blk", 2, 40, 20, 40, 40)], [1, 2]),
    );
    tool.onPointerDown(P(20, 30), EV);
    tool.onPointerMove(P(60, 30));
    const first = asRouting(tool.state).preview.selectedCandidateId;
    tool.onPointerMove(P(60, 30));
    const second = asRouting(tool.state).preview.selectedCandidateId;
    expect(first).toBeDefined();
    expect(first).toEqual(second);
  });

  it("still hard-blocks commit when no legal one-layer path exists", () => {
    const { tool, commands } = harness(
      boardWith([padInst("a", "A", 20, 30, 1)], [trk("wall", 2, 40, 0, 40, 80)], [1, 2]),
    );
    tool.onPointerDown(P(20, 30), EV);
    tool.onPointerMove(P(60, 30));
    const state = asRouting(tool.state);
    expect(state.preview.legal).toBe(false);
    expect(state.preview.smartStatus).toBe("blocked");
    tool.onPointerDown(P(60, 30), EV);
    expect(commands).toHaveLength(0);
  });
});

describe("route tool — via + layer flip", () => {
  it("V drops a via, flips the active layer, next segment lands on the new layer", () => {
    const { tool, commands } = harness(boardWith([padInst("a", "A", 20, 30, 1)], [], [1]));
    tool.onPointerDown(P(20, 30), EV);
    tool.onPointerMove(P(40, 30));
    tool.onKey("V");

    expect(commands).toHaveLength(0);
    const staged = asRouting(tool.state);
    expect(staged.stagedVias).toHaveLength(1);
    expect(staged.stagedVias[0].layers).toEqual(["copperTop", "copperBottom"]);
    expect(staged.stagedVias[0].at).toEqual(P(20, 30));
    expect(staged.activeLayer).toBe("copperBottom");

    tool.onPointerMove(P(40, 30));
    tool.onPointerDown(P(40, 30), EV);
    expect(commands).toHaveLength(0);
    expect(asRouting(tool.state).stagedTracks[0].layer).toBe("copperBottom");
  });
});

describe("route tool — resolved route profile", () => {
  it("captures a chosen copper width and via preset when the route starts", () => {
    const value = boardWith([padInst("a", "A", 20, 30, 1)], [], [1]);
    value.padstacks = [{
      id: "via-chosen",
      name: "Chosen",
      kind: "via",
      outerNm: 1_000_000,
      drillNm: 500_000,
      tented: true,
      zoneConnect: "solid",
    }];
    const { tool, commands } = harness(value, {
      routingProfile: () => ({
        trackWidth: 750_000,
        clearance: 250_000,
        viaSize: 1_000_000,
        viaDrill: 500_000,
        viaPadstackId: "via-chosen",
      }),
    });
    tool.onPointerDown(P(20, 30), EV);
    expect(asRouting(tool.state).trackWidth).toBe(750_000);
    tool.onKey("V");
    expect(commands).toHaveLength(0);
    const via = asRouting(tool.state).stagedVias[0];
    expect(via.padstackId).toBe("via-chosen");
    expect([via.size, via.drill]).toEqual([1_000_000, 500_000]);
  });
});

describe("route tool — Tab posture", () => {
  it("toggles the L-bend orientation; both corners legal and distinct", () => {
    const { tool } = harness(boardWith([padInst("a", "A", 20, 30, 1)], [], [1]));
    tool.onPointerDown(P(20, 30), EV);
    tool.onPointerMove(P(50, 45));
    const c1 = asRouting(tool.state).preview.corner;
    expect(asRouting(tool.state).preview.legal).toBe(true);
    tool.onKey("Tab");
    const c2 = asRouting(tool.state).preview.corner;
    expect(asRouting(tool.state).preview.legal).toBe(true);
    expect(c2).not.toEqual(c1);
  });
});

describe("route tool — stretch", () => {
  it("drags a track endpoint to a legal spot → one StretchTrack, count unchanged", () => {
    const { tool, commands, board } = harness(boardWith([], [trk("seg1", 1, 20, 30, 50, 30)], [1]));
    tool.onPointerDown(P(50, 30), EV); // grab endpoint b
    expect(tool.state.kind).toBe("idle"); // pending (click vs drag undecided)
    tool.onPointerMove(P(55, 35)); // exceeds threshold → stretching
    expect(tool.state.kind).toBe("stretching");
    tool.onPointerUp(P(55, 35));

    expect(commands).toHaveLength(1);
    expect(commands[0].kind).toBe("StretchTrack");
    expect(board().tracks).toHaveLength(1);
    expect(board().tracks[0].end).toEqual(P(55, 35));
  });

  it("dragging into an illegal spot cancels with no command", () => {
    const { tool, commands, board } = harness(
      boardWith([], [trk("seg1", 1, 20, 30, 50, 30), trk("blk", 2, 55, 20, 55, 40)], [1, 2]),
    );
    tool.onPointerDown(P(50, 30), EV);
    tool.onPointerMove(P(55, 30)); // onto the net-2 blocker
    expect(asStretch(tool.state).preview.legal).toBe(false);
    tool.onPointerUp(P(55, 30));
    expect(commands).toHaveLength(0);
    expect(board().tracks).toHaveLength(2);
  });
});

describe("route tool — Escape / cancel", () => {
  it("Escape mid-route discards the preview with no commit", () => {
    const { tool, commands } = harness(boardWith([padInst("a", "A", 20, 30, 1)], [], [1]));
    tool.onPointerDown(P(20, 30), EV);
    tool.onPointerMove(P(40, 40));
    tool.onKey("Escape");
    expect(tool.state.kind).toBe("idle");
    expect(commands).toHaveLength(0);
  });
});

describe("route tool — Stage 8 candidate transaction", () => {
  it("keeps a multi-click route off-board until finish, then emits exactly one command", () => {
    const { tool, commands, board } = harness(boardWith([padInst("a", "A", 10, 10, 1), padInst("b", "B", 40, 30, 1)], [], [1]));
    tool.onPointerDown(P(10, 10), EV);
    tool.onPointerMove(P(20, 10));
    tool.onPointerDown(P(20, 10), EV);
    expect(commands).toHaveLength(0);
    expect(board().tracks).toHaveLength(0);
    expect(asRouting(tool.state).stagedTracks.length).toBeGreaterThan(0);
    tool.onPointerMove(P(40, 30));
    tool.onPointerDown(P(40, 30), EV);
    expect(commands).toHaveLength(1);
    expect(commands[0].kind).toBe("CommitRouteCandidate");
    expect(board().tracks.length).toBeGreaterThan(1);
    expect(tool.state.kind).toBe("idle");
  });

  it("Backspace and cancel modify candidate steps only, including staged vias", () => {
    const { tool, commands, board } = harness(boardWith([padInst("a", "A", 10, 10, 1)], [], [1]));
    tool.onPointerDown(P(10, 10), EV);
    tool.onPointerMove(P(20, 10));
    tool.onPointerDown(P(20, 10), EV);
    tool.onKey("V");
    expect(asRouting(tool.state).stagedVias).toHaveLength(1);
    tool.onKey("Backspace");
    expect(asRouting(tool.state).stagedVias).toHaveLength(0);
    expect(asRouting(tool.state).stagedTracks.length).toBeGreaterThan(0);
    tool.onKey("Escape");
    expect(commands).toHaveLength(0);
    expect(board().tracks).toHaveLength(0);
    expect(board().vias).toHaveLength(0);
  });

  it("starts and finishes at exact arbitrary interior points and splits both source tracks", () => {
    const first = trk("first", 1, 10, 10, 30, 20);
    const second = trk("second", 1, 50, 20, 70, 30);
    const { tool, commands, board } = harness(boardWith([], [first, second], [1]));
    tool.onPointerDown(P(20, 15), EV);
    tool.onPointerUp(P(20, 15));
    expect(asRouting(tool.state).anchor).toEqual(P(20, 15));
    tool.onPointerMove(P(60, 25));
    tool.onPointerDown(P(60, 25), EV);
    expect(commands).toHaveLength(1);
    const command = commands[0];
    if (command.kind !== "CommitRouteCandidate") throw new Error("expected one candidate command");
    expect(command.candidate.delta.removedTracks.map((candidate) => candidate.id).sort()).toEqual(["first", "second"]);
    expect(board().tracks.some((candidate) =>
      candidate.start.x === P(20, 15).x && candidate.start.y === P(20, 15).y
      || candidate.end.x === P(20, 15).x && candidate.end.y === P(20, 15).y,
    )).toBe(true);
  });

  it("uses the persisted arbitrary posture for one straight non-45-degree candidate", () => {
    const { tool, commands } = harness(boardWith([padInst("a", "A", 10, 10, 1), padInst("b", "B", 23, 17, 1)], [], [1]), {
      routingProfile: () => ({ trackWidth: 250_000, clearance: 200_000, viaSize: 800_000, viaDrill: 400_000, routeMode: "highlight_stop", posture: "arbitrary" }),
    });
    tool.onPointerDown(P(10, 10), EV);
    tool.onPointerMove(P(23, 17));
    expect(asRouting(tool.state).preview.points).toHaveLength(2);
    tool.onPointerDown(P(23, 17), EV);
    expect(commands[0].kind).toBe("CommitRouteCandidate");
    if (commands[0].kind === "CommitRouteCandidate") expect(commands[0].candidate.delta.createdTracks).toHaveLength(1);
  });
});

describe("route tool — routed demo integration", () => {
  it("ripupNetAt removes only the explicitly selected GND segment", () => {
    const demo = buildRoutedDemo();
    const { tool, commands, board } = harness(demo);
    const g = demo.tracks.find((t) => t.netId === 1);
    if (!g) throw new Error("demo has no GND track");
    const mid = { x: Math.round((g.start.x + g.end.x) / 2), y: Math.round((g.start.y + g.end.y) / 2) };
    expect(tool.ripupNetAt(mid)).toBe(true);
    expect(commands.at(-1)?.kind).toBe("RipupNet");
    expect(board().tracks.filter((t) => t.netId === 1)).toHaveLength(demo.tracks.filter((t) => t.netId === 1).length - 1);
    expect(board().tracks.length).toBeGreaterThan(0); // other nets survive
  });
});

describe("route tool — review-fix regressions", () => {
  it("straight route into an OFF-GRID same-net pad → one exact segment, no overshoot (F2)", () => {
    // Pad B at 20.015 mm is off the 0.025 mm grid; snapping the corner used to
    // overshoot and emit a doubled-back stub.
    const B = padInstLayers("b", "B", 20.015, 30, 1, ["copperTop", "maskTop"]);
    const { tool, commands } = harness(boardWith([padInst("a", "A", 5, 30, 1), B], [], [1]));
    tool.onPointerDown(P(5, 30), EV);
    tool.onPointerMove(P(20.015, 30));
    tool.onPointerDown(P(20.015, 30), EV);
    expect(commands).toHaveLength(1);
    const cmd = commands[0];
    if (cmd.kind !== "CommitRouteCandidate") throw new Error("expected candidate");
    expect(cmd.candidate.delta.createdTracks).toHaveLength(1); // single exact segment, no doubled-back stub
    expect(cmd.candidate.delta.createdTracks[0].start).toEqual(P(5, 30));
    expect(cmd.candidate.delta.createdTracks[0].end).toEqual({ x: mmToNm(20.015), y: mmToNm(30) });
  });

  it("does NOT auto-finish onto a same-net pad whose copper is on the other layer (F3)", () => {
    // B is net 1 but copper only on copperBottom; routing on copperTop must not
    // complete onto it (it would leave an unconnected stub — needs a via first).
    const B = padInstLayers("b", "B", 30, 30, 1, ["copperBottom", "maskBottom"]);
    const { tool, commands } = harness(boardWith([padInst("a", "A", 5, 30, 1), B], [], [1]));
    tool.onPointerDown(P(5, 30), EV); // routing on copperTop
    tool.onPointerMove(P(30, 30));
    expect(asRouting(tool.state).preview.end).toEqual(P(30, 30)); // grid-snapped, not a pad target
    tool.onPointerDown(P(30, 30), EV);
    expect(commands).toHaveLength(0); // candidate-only; nothing has entered board history
    expect(asRouting(tool.state).stagedTracks).toHaveLength(1);
    expect(tool.state.kind).toBe("routing");
  });

  it("checkClearance flags a candidate that lies entirely off-board (F4)", () => {
    const board = boardWith([], [], [1]); // 100×80 mm rect
    const offBoard = trk("x", 1, 100.5, 10, 100.5, 20); // wholly right of the edge
    const res = checkClearance(board, { candidateSegments: [offBoard], netId: 1, clearance: DEFAULT_CLEARANCE });
    expect(res.legal).toBe(false);
    expect(res.blockedByEdge).toBe(true);
    // sanity: a fully-inside track is legal
    const inside = trk("y", 1, 10, 10, 20, 10);
    expect(checkClearance(board, { candidateSegments: [inside], netId: 1, clearance: DEFAULT_CLEARANCE }).legal).toBe(true);
  });

  it("uses the same proven-net clearance semantics as batch DRC", () => {
    const obstacle = trk("obstacle", 1, 10, 40, 20, 40);
    const closeSameNet = trk("same", 1, 10, 40.3, 20, 40.3); // 0.05 mm edge gap
    const closeOtherNet = trk("other", 2, 10, 40.3, 20, 40.3);
    const proven = boardWith([], [obstacle], [1, 2]);
    expect(checkClearance(proven, { candidateSegments: [closeSameNet], netId: 1, clearance: DEFAULT_CLEARANCE }).legal).toBe(true);
    expect(checkClearance(proven, { candidateSegments: [closeOtherNet], netId: 2, clearance: DEFAULT_CLEARANCE })).toMatchObject({
      legal: false,
      netRelation: "different-proven-nets",
    });

    const orphan = boardWith([], [{ ...obstacle, netId: 0 }], []);
    expect(checkClearance(orphan, { candidateSegments: [{ ...closeSameNet, netId: 0 }], netId: 0, clearance: DEFAULT_CLEARANCE })).toMatchObject({
      legal: false,
      netRelation: "unassigned-to-unassigned",
    });
  });

  it("right-click rip-up clears an in-flight pending track grab (F6)", () => {
    const { tool, commands } = harness(
      boardWith([], [trk("seg1", 1, 20, 30, 50, 30), trk("blk", 2, 60, 10, 60, 40)], [1, 2]),
    );
    tool.onPointerDown(P(50, 30), EV); // pending grab on seg1 (state stays idle)
    expect(tool.state.kind).toBe("idle");
    expect(tool.ripupNetAt(P(60, 25))).toBe(true); // rip net 2 while idle
    expect(commands.at(-1)?.kind).toBe("RipupNet");
    tool.onPointerMove(P(55, 40)); // large move — must NOT resurrect a stretch
    expect(tool.state.kind).toBe("idle");
  });
});

describe("route tool — perf", () => {
  it("direct live preview avoids catastrophic slowdown with 500 tracks", () => {
    const tracks: Track[] = [];
    let n = 0;
    for (let gx = 0; gx < 25 && n < 500; gx++) {
      for (let gy = 0; gy < 20 && n < 500; gy++) {
        const x = 8 + gx * 3;
        const y = 8 + gy * 3;
        tracks.push(trk(`bg${n}`, 2, x, y, x + 1.5, y));
        n++;
      }
    }
    expect(tracks).toHaveLength(500);
    const { tool } = harness(boardWith([padInst("a", "A", 5, 5, 1)], tracks, [1, 2]));
    tool.onPointerDown(P(5, 5), EV);
    tool.onPointerMove(P(70, 55)); // warm up

    const N = 200;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      const tx = 10 + (i % 60);
      const ty = 10 + (i % 40);
      const t0 = performance.now();
      tool.onPointerMove(P(tx, ty));
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const avg = samples.reduce((s, v) => s + v, 0) / N;
    const p50 = samples[Math.floor(N * 0.5)];
    const p95 = samples[Math.floor(N * 0.95)];
    const max = samples[N - 1];
    console.log(
      `route onPointerMove (500 tracks): avg ${avg.toFixed(3)} ms, p50 ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, max ${max.toFixed(3)} ms`,
    );
    // Vitest runs this beside CPU-heavy geometry/placement workers, so wall
    // time here is a broad regression sentinel. The isolated, warmed
    // `pnpm pcb:routebench` process owns the specification's strict p50 <16 ms
    // release gate without cross-worker scheduler noise.
    expect(p50).toBeLessThan(50);
  });

  it("walk-around preview stays under the Phase-1 50 ms p95 budget", () => {
    const { tool } = harness(
      boardWith([padInst("a", "A", 20, 30, 1)], [trk("blk", 2, 40, 20, 40, 40)], [1, 2]),
    );
    tool.onPointerDown(P(20, 30), EV);
    tool.onPointerMove(P(60, 30));
    const samples: number[] = [];
    for (let index = 0; index < 100; index++) {
      const t0 = performance.now();
      tool.onPointerMove(P(60, 30));
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    console.log(`smart walk-around onPointerMove: p95 ${p95.toFixed(3)} ms`);
    expect(p95).toBeLessThan(50);
  });
});
