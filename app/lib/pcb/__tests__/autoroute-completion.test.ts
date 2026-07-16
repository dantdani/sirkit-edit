import { describe, expect, it } from "vitest";
import { completeAutoroute, type AutoroutePassExecutor } from "../autoroute/completion";
import { createEmptyBoard, type FootprintDef, type PcbBoard, type Track } from "../types";
import { mmToNm } from "../units";
import { getPreset } from "../drc/presets";

const def: FootprintDef = {
  libName: "Completion",
  name: "P1",
  attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
  pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.3) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "copperBottom"] }],
  graphics: [],
  courtyardBBox: { minX: mmToNm(-0.5), minY: mmToNm(-0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) },
  bodyBBox: { minX: mmToNm(-0.4), minY: mmToNm(-0.4), maxX: mmToNm(0.4), maxY: mmToNm(0.4) },
  models: [],
  rawSexpr: "",
};

function board(): PcbBoard {
  return {
    ...createEmptyBoard(),
    outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(30), height: mmToNm(20) },
    nets: [{ id: 0, name: "" }, { id: 1, name: "SPI_SCK" }],
    footprints: [5, 15, 25].map((x, index) => ({
      id: `p${index}`,
      ref: `P${index + 1}`,
      footprintId: "Completion:P1",
      def,
      at: { x: mmToNm(x), y: mmToNm(10) },
      rotationDeg: 0,
      side: "top" as const,
      padNets: { "1": 1 },
    })),
  };
}

const track = (id: string, from: number, to: number, layer: Track["layer"] = "copperTop"): Track => ({
  id,
  layer,
  width: mmToNm(0.25),
  start: { x: mmToNm(from), y: mmToNm(10) },
  end: { x: mmToNm(to), y: mmToNm(10) },
  netId: 1,
  source: "autorouter",
});

describe("iterative autoroute completion", () => {
  it("accepts monotonic selected-net passes until every schematic connection completes", async () => {
    const source = board();
    const executor: AutoroutePassExecutor = async ({ board: current, passIndex, targetNetIds }) => ({
      ok: true,
      elapsedMs: 10,
      candidate: {
        ...current,
        tracks: passIndex === 1 ? [track("ab", 5, 15)] : [track("ab", 5, 15), track("bc", 15, 25, "copperBottom")],
      },
      layerUsage: passIndex === 1
        ? { copperTop: { segments: 1, trackLengthNm: mmToNm(10) } }
        : { copperTop: { segments: 1, trackLengthNm: mmToNm(10) }, copperBottom: { segments: 1, trackLengthNm: mmToNm(10) } },
      sesText: `(session pass-${passIndex})`,
      dsnText: `(pcb pass-${passIndex})`,
      stderr: "",
      parsed: undefined,
      validation: undefined,
      ...(targetNetIds ? {} : {}),
    });
    const result = await completeAutoroute(source, getPreset("jlcpcb-2l").rules, executor);
    expect(result.status).toBe("complete");
    expect(result.verification).toMatchObject({ requiredConnections: 2, completedConnections: 2, remainingConnections: 0 });
    expect(result.passes).toHaveLength(2);
    expect(result.passes.every((pass) => pass.accepted)).toBe(true);
    expect(result.passes[1].scope).toBe("selected_incomplete");
    expect(result.passes[1].targetNetIds).toEqual([1]);
  });

  it("stops after bounded no-improvement passes and reports exact endpoints/blockers", async () => {
    const source = board();
    const executor: AutoroutePassExecutor = async ({ board: current }) => ({ ok: true, candidate: current, elapsedMs: 5 });
    const result = await completeAutoroute(source, getPreset("jlcpcb-2l").rules, executor);
    expect(result.status).toBe("blocked");
    expect(result.passes).toHaveLength(2);
    expect(result.passes.every((pass) => !pass.accepted)).toBe(true);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toMatchObject({ netId: 1, netName: "SPI_SCK", failure: "No legal path found without regressing existing connectivity or DRC." });
    expect(result.failures[0].from?.reference).toBeTruthy();
    expect(result.failures[0].to?.reference).toBeTruthy();
    expect(result.failures[0].primaryBlockers.length).toBeGreaterThan(0);
  });

  it("rejects a later candidate that loses a previously complete net", async () => {
    const source = board();
    source.nets.push({ id: 2, name: "LOCKED_OK" });
    source.footprints.push(
      { ...source.footprints[0], id: "q0", ref: "Q1", at: { x: mmToNm(5), y: mmToNm(5) }, padNets: { "1": 2 } },
      { ...source.footprints[0], id: "q1", ref: "Q2", at: { x: mmToNm(25), y: mmToNm(5) }, padNets: { "1": 2 } },
    );
    source.tracks.push({ ...track("protected", 5, 25), netId: 2, start: { x: mmToNm(5), y: mmToNm(5) }, end: { x: mmToNm(25), y: mmToNm(5) }, source: "human", locked: true });
    const executor: AutoroutePassExecutor = async ({ board: current }) => ({
      ok: true,
      elapsedMs: 5,
      candidate: { ...current, tracks: [track("ab", 5, 15)] },
    });
    const result = await completeAutoroute(source, getPreset("jlcpcb-2l").rules, executor, { maxNoImprovementPasses: 1 });
    expect(result.passes[0].accepted).toBe(false);
    expect(result.passes[0].lostPreviouslyCompleteNetIds).toEqual([2]);
    expect(result.candidate.tracks.some((candidate) => candidate.id === "protected")).toBe(true);
  });

  it("rejects new DRC errors even when a candidate completes another connection", async () => {
    const source = board();
    const executor: AutoroutePassExecutor = async ({ board: current }) => ({
      ok: true,
      elapsedMs: 5,
      candidate: {
        ...current,
        tracks: [{ ...track("too-thin", 5, 15), width: mmToNm(0.05) }],
      },
    });
    const result = await completeAutoroute(source, getPreset("jlcpcb-2l").rules, executor, { maxNoImprovementPasses: 1 });
    expect(result.passes[0]).toMatchObject({ accepted: false, newDrcErrors: 1 });
    expect(result.passes[0].reason).toContain("new DRC error");
    expect(result.candidate.tracks).toHaveLength(0);
  });
});
