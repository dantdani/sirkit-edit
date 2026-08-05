import { describe, expect, it } from "vitest";
import { buildAutorouteCandidate, verifyAutorouteCandidate } from "../autoroute/verification";
import { getPreset } from "../drc/presets";
import { makeBoard, makeDef, makeInstance, makePad, makeResistorDef } from "./autoplace-fixture";
import { mmToNm } from "../units";

describe("autoroute candidate verification", () => {
  it("reports partial until the expected pad connectivity exists", () => {
    const footprint = makeInstance("r1", makeResistorDef(), { x: 10, y: 10 }, { "1": 1, "2": 1 });
    const board = makeBoard(30, 20, [footprint], 1);
    const rules = getPreset("jlcpcb-2l").rules;
    const before = verifyAutorouteCandidate(board, rules);
    expect(before.status).toBe("partial");
    expect(before.remainingConnections).toBe(1);

    const candidate = buildAutorouteCandidate(board, {
      tracks: [{
        id: "routed",
        layer: "copperTop",
        width: mmToNm(0.25),
        start: { x: mmToNm(9.1), y: mmToNm(10) },
        end: { x: mmToNm(10.9), y: mmToNm(10) },
        netId: 1,
      }],
      vias: [],
    });
    const after = verifyAutorouteCandidate(candidate, rules, { copperTop: { segments: 1, trackLengthNm: mmToNm(1.8) } });
    expect(after.status).toBe("complete");
    expect(after.completedConnections).toBe(1);
    expect(after.remainingConnections).toBe(0);
    expect(after.layerUsage.copperTop?.segments).toBe(1);
  });

  it("does not call a connected but fabrication-invalid thin route complete", () => {
    const footprint = makeInstance("r1", makeResistorDef(), { x: 10, y: 10 }, { "1": 1, "2": 1 });
    const board = makeBoard(30, 20, [footprint], 1);
    const candidate = buildAutorouteCandidate(board, {
      tracks: [{
        id: "thin",
        layer: "copperTop",
        width: mmToNm(0.05),
        start: { x: mmToNm(9.1), y: mmToNm(10) },
        end: { x: mmToNm(10.9), y: mmToNm(10) },
        netId: 1,
      }],
      vias: [],
    });
    const result = verifyAutorouteCandidate(candidate, getPreset("jlcpcb-2l").rules);
    expect(result).toMatchObject({ remainingConnections: 0, status: "partial" });
    expect(result.routeBlockingDrcErrors).toBeGreaterThan(0);
    expect(result.violations.some((violation) => violation.kind === "minTrackWidth")).toBe(true);
  });

  it("accepts a forced two-layer crossing only when legal vias complete both nets and DRC passes", () => {
    const onePad = makeDef("ONE_PAD", 1, 1, [makePad("1", 0, 0)]);
    const board = makeBoard(20, 20, [
      makeInstance("a", onePad, { x: 2, y: 10 }, { "1": 1 }),
      makeInstance("b", onePad, { x: 18, y: 10 }, { "1": 1 }),
      makeInstance("c", onePad, { x: 10, y: 2 }, { "1": 2 }),
      makeInstance("d", onePad, { x: 10, y: 18 }, { "1": 2 }),
    ], 2);
    const width = mmToNm(0.25);
    const candidate = buildAutorouteCandidate(board, {
      tracks: [
        { id: "n1-top", layer: "copperTop", width, start: { x: mmToNm(2), y: mmToNm(10) }, end: { x: mmToNm(18), y: mmToNm(10) }, netId: 1, source: "autorouter" },
        { id: "n2-top-a", layer: "copperTop", width, start: { x: mmToNm(10), y: mmToNm(2) }, end: { x: mmToNm(6), y: mmToNm(6) }, netId: 2, source: "autorouter" },
        { id: "n2-bottom", layer: "copperBottom", width, start: { x: mmToNm(6), y: mmToNm(6) }, end: { x: mmToNm(14), y: mmToNm(14) }, netId: 2, source: "autorouter" },
        { id: "n2-top-b", layer: "copperTop", width, start: { x: mmToNm(14), y: mmToNm(14) }, end: { x: mmToNm(10), y: mmToNm(18) }, netId: 2, source: "autorouter" },
      ],
      vias: [
        { id: "via-a", at: { x: mmToNm(6), y: mmToNm(6) }, size: mmToNm(0.8), drill: mmToNm(0.4), netId: 2, layers: ["copperTop", "copperBottom"], source: "autorouter" },
        { id: "via-b", at: { x: mmToNm(14), y: mmToNm(14) }, size: mmToNm(0.8), drill: mmToNm(0.4), netId: 2, layers: ["copperTop", "copperBottom"], source: "autorouter" },
      ],
    });
    const result = verifyAutorouteCandidate(candidate, getPreset("jlcpcb-2l").rules, {
      copperTop: { segments: 3, trackLengthNm: mmToNm(27.31) },
      copperBottom: { segments: 1, trackLengthNm: mmToNm(11.31) },
    });
    expect(result.status).toBe("complete");
    expect(result).toMatchObject({ requiredConnections: 2, completedConnections: 2, remainingConnections: 0, shorts: 0, drcErrors: 0 });
    expect(result.layerUsage.copperTop?.segments).toBe(3);
    expect(result.layerUsage.copperBottom?.segments).toBe(1);
    expect(candidate.vias).toHaveLength(2);
  });
});
