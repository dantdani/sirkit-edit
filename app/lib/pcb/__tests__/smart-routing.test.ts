import { describe, expect, it } from "vitest";
import type { FootprintDef, FootprintInstance, PcbBoard, RoutingHistoryEvent, Track } from "../types";
import { createEmptyBoard } from "../types";
import { mmToNm } from "../units";
import { checkClearance } from "../route-tool";
import { buildSmartRoutingDemo } from "../demo/smart-routing-demo";
import {
  adaptBoardToRoutingWorld,
  applyAiCandidateRanking,
  beginPreviewTransaction,
  cancelPreviewTransaction,
  createRoutingHistoryEvent,
  replayRoutingHistoryEvent,
  resolveSmartRoutingRules,
  routeSmart,
  stagePreviewCandidates,
  validateSmartRoute,
  type SmartRouteIntent,
} from "../smart-routing";
import { isOctilinearSegment } from "../smart-routing/geometry";

const P = (x: number, y: number) => ({ x: mmToNm(x), y: mmToNm(y) });

function intent(start = P(20, 30), end = P(60, 30)): SmartRouteIntent {
  return {
    schemaVersion: 1,
    netId: 1,
    layer: "copperTop",
    start,
    end,
    movementPolicy: "keep-existing-copper-fixed",
    maxCandidates: 4,
  };
}

function run(board: PcbBoard, value = intent()) {
  const world = adaptBoardToRoutingWorld(board);
  const rules = resolveSmartRoutingRules(board, value.netId, value.layer);
  return { world, rules, result: routeSmart(world, value, rules) };
}

describe("Smart Route Phase 1", () => {
  it("produces deterministic legal CW and CCW walk-around candidates", () => {
    const board = buildSmartRoutingDemo();
    const first = run(board);
    const second = run(structuredClone(board));
    expect(first.result.status).toBe("walking-around");
    expect(first.result.candidates).toHaveLength(2);
    expect(new Set(first.result.candidates.map((candidate) => candidate.direction))).toEqual(new Set(["cw", "ccw"]));
    expect(first.result.candidates.map((candidate) => candidate.id)).toEqual(second.result.candidates.map((candidate) => candidate.id));
    for (const candidate of first.result.candidates) {
      expect(candidate.validation.legal).toBe(true);
      expect(candidate.points[0]).toEqual(P(20, 30));
      expect(candidate.points.at(-1)).toEqual(P(60, 30));
      for (let index = 0; index + 1 < candidate.points.length; index++) {
        expect(isOctilinearSegment(candidate.points[index], candidate.points[index + 1])).toBe(true);
      }
      expect(validateSmartRoute(first.world, intent(), first.rules, candidate.points).legal).toBe(true);
    }
  });

  it("uses a direct candidate when no obstacle blocks either posture", () => {
    const board = buildSmartRoutingDemo();
    board.tracks = [];
    const { result } = run(board);
    expect(result.status).toBe("ready");
    expect(result.candidates.every((candidate) => candidate.mode === "direct")).toBe(true);
    expect(result.candidates[0].points).toEqual([P(20, 30), P(60, 30)]);
  });

  it("preview cancellation leaves the base revision byte-for-byte unchanged", () => {
    const board = buildSmartRoutingDemo();
    const before = JSON.stringify(board);
    const { world, result } = run(board);
    const tx = stagePreviewCandidates(beginPreviewTransaction(world, intent()), result.candidates);
    const cancelled = cancelPreviewTransaction(tx, board);
    expect(cancelled.baseUnchanged).toBe(true);
    expect(cancelled.transaction.state).toBe("cancelled");
    expect(JSON.stringify(board)).toBe(before);
  });

  it("records and independently replays an accepted route event", () => {
    const board = buildSmartRoutingDemo();
    const { world, rules, result } = run(board);
    const candidate = result.candidates[0];
    const tx = stagePreviewCandidates(beginPreviewTransaction(world, intent()), result.candidates, candidate.id);
    const ids = candidate.points.slice(1).map((_, index) => `replay-${index}`);
    const event: RoutingHistoryEvent = createRoutingHistoryEvent(tx, candidate, rules, ids);
    const replay = replayRoutingHistoryEvent(board, event);
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.reason);
    expect(replay.tracks.map((track) => track.id)).toEqual(ids);
    expect(replay.tracks[0].start).toEqual(intent().start);
    expect(replay.tracks.at(-1)?.end).toEqual(intent().end);

    const changed = structuredClone(board);
    changed.tracks.push({
      id: "later-edit",
      layer: "copperTop",
      width: mmToNm(0.25),
      start: P(70, 50),
      end: P(75, 50),
      netId: 2,
    });
    expect(replayRoutingHistoryEvent(changed, event)).toEqual({
      ok: false,
      reason: "Board revision differs from the event's base snapshot.",
    });
  });

  it("treats copper keepouts as hard obstacles", () => {
    const board = buildSmartRoutingDemo();
    board.tracks = [];
    board.routingKeepouts = [{
      id: "quiet-zone",
      name: "RF quiet zone",
      polygon: [P(38, 24), P(42, 24), P(42, 36), P(38, 36)],
      layers: ["copperTop"],
      forbidTracks: true,
      forbidVias: true,
    }];
    const { result } = run(board);
    expect(result.status).toBe("walking-around");
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((candidate) => candidate.validation.legal)).toBe(true);
  });

  it("does not let AI rank an unknown or illegal candidate into authority", () => {
    const { result } = run(buildSmartRoutingDemo());
    const illegal = {
      ...result.candidates[0],
      id: "ai-invented-illegal",
      validation: {
        legal: false,
        violations: [{ code: "CLEARANCE" as const, message: "AI cannot waive this violation." }],
      },
    };
    const ranked = applyAiCandidateRanking([illegal, ...result.candidates], {
      orderedCandidateIds: ["unknown-id", illegal.id, result.candidates[1].id],
      explanation: "Adversarial ranking attempt.",
    });
    expect(ranked.map((candidate) => candidate.id)).toEqual([
      result.candidates[1].id,
      result.candidates[0].id,
    ]);
  });

  it("changes the world revision when geometry changes inside the same bounding box", () => {
    const first = buildSmartRoutingDemo();
    first.tracks = [{
      id: "same-box",
      layer: "copperTop",
      width: mmToNm(0.25),
      start: P(30, 20),
      end: P(50, 40),
      netId: 2,
    }];
    const second = structuredClone(first);
    second.tracks[0].start = P(30, 40);
    second.tracks[0].end = P(50, 20);
    expect(adaptBoardToRoutingWorld(first).items[2].bbox).toEqual(adaptBoardToRoutingWorld(second).items[2].bbox);
    expect(adaptBoardToRoutingWorld(first).revision).not.toBe(adaptBoardToRoutingWorld(second).revision);
  });
});

function onePadDef(type: "smd" | "np_thru_hole", layers: FootprintDef["pads"][number]["layers"]): FootprintDef {
  return {
    libName: "Test",
    name: "OnePad",
    attributes: { smd: type === "smd", throughHole: type !== "smd", excludeFromPos: false, excludeFromBom: false },
    pads: [{ number: "1", type, shape: { kind: "circle", radius: mmToNm(0.5) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers }],
    graphics: [],
    bodyBBox: { minX: -mmToNm(0.5), minY: -mmToNm(0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) },
    models: [],
    rawSexpr: "",
  };
}

function padInstance(type: "smd" | "np_thru_hole", layers: FootprintDef["pads"][number]["layers"]): FootprintInstance {
  return {
    id: `fixture-${type}`,
    ref: "X1",
    footprintId: "Test:OnePad",
    def: onePadDef(type, layers),
    at: P(40, 30),
    rotationDeg: 0,
    side: "top",
    padNets: { "1": 2 },
  };
}

function candidateTrack(layer: Track["layer"]): Track {
  return { id: "candidate", layer, width: mmToNm(0.25), start: P(20, 30), end: P(60, 30), netId: 1 };
}

describe("layer and hole authority fixes", () => {
  it("does not block bottom copper on a top-only SMD pad", () => {
    const board = { ...createEmptyBoard(), footprints: [padInstance("smd", ["copperTop", "maskTop"])] };
    expect(checkClearance(board, { candidateSegments: [candidateTrack("copperBottom")], netId: 1, clearance: mmToNm(0.2) }).legal).toBe(true);
    expect(checkClearance(board, { candidateSegments: [candidateTrack("copperTop")], netId: 1, clearance: mmToNm(0.2) }).legal).toBe(false);
  });

  it("blocks copper through an NPTH hole on every copper layer", () => {
    const board = { ...createEmptyBoard(), footprints: [padInstance("np_thru_hole", [])] };
    expect(checkClearance(board, { candidateSegments: [candidateTrack("copperTop")], netId: 1, clearance: mmToNm(0.2) }).legal).toBe(false);
    expect(checkClearance(board, { candidateSegments: [candidateTrack("copperBottom")], netId: 1, clearance: mmToNm(0.2) }).legal).toBe(false);
  });
});

describe("fixed-seed route properties", () => {
  it("never returns an unvalidated candidate across randomized blocker positions", () => {
    let seed = 0x51a71;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 40; sample++) {
      const board = buildSmartRoutingDemo();
      board.tracks = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, index) => {
        const x = 28 + random() * 24;
        const y = 18 + random() * 20;
        return {
          id: `r-${sample}-${index}`,
          layer: "copperTop" as const,
          width: mmToNm(0.15 + random() * 0.3),
          start: P(x, y),
          end: P(x + (random() - 0.5) * 3, y + 8 + random() * 12),
          netId: 2,
        };
      });
      const { world, rules, result } = run(board);
      for (const candidate of result.candidates) {
        expect(candidate.validation.legal).toBe(true);
        expect(validateSmartRoute(world, intent(), rules, candidate.points).legal).toBe(true);
      }
    }
  });
});
