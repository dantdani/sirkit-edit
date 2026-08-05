import { describe, expect, it } from "vitest";
import { completeAutoroute, type AutoroutePassExecutor, type AutoroutePassOutput, type AutoroutePassRequest } from "../autoroute/completion";
import { createEmptyBoard, type FootprintDef, type PcbBoard, type Track } from "../types";
import { mmToNm } from "../units";
import { getPreset } from "../drc/presets";
import { pcbRevisionId } from "../revision";

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
    nets: [
      { id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] },
      { id: 1, name: "SPI_SCK", stableId: "net:spi-sck", endpointKeys: [] },
    ],
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

function successfulPass(
  request: AutoroutePassRequest,
  candidate: PcbBoard,
  extra: Partial<AutoroutePassOutput> = {},
): AutoroutePassOutput {
  return {
    ok: true,
    routeAttemptId: request.routeAttemptId,
    authoritativeSourceRevision: request.requestedSourceRevision,
    sourceRevision: request.requestedSourceRevision,
    candidateRevision: pcbRevisionId(candidate),
    candidate,
    elapsedMs: 5,
    evidence: {
      processStatus: "exit-success",
      outputFileStatus: "nonempty",
      parserStatus: "success",
      semanticStatus: "success",
    },
    ...extra,
  };
}

describe("iterative autoroute completion", () => {
  it("accepts monotonic selected-net passes until every schematic connection completes", async () => {
    const source = board();
    const executor: AutoroutePassExecutor = async (request) => {
      const { board: current, passIndex, targetNetIds } = request;
      const candidate = {
        ...current,
        tracks: passIndex === 1 ? [track("ab", 5, 15)] : [track("ab", 5, 15), track("bc", 15, 25, "copperBottom")],
      };
      return successfulPass(request, candidate, {
      elapsedMs: 10,
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
    };
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
    const executor: AutoroutePassExecutor = async (request) => successfulPass(request, request.board);
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
    source.nets.push({ id: 2, name: "LOCKED_OK", stableId: "net:locked-ok", endpointKeys: [] });
    source.footprints.push(
      { ...source.footprints[0], id: "q0", ref: "Q1", at: { x: mmToNm(5), y: mmToNm(5) }, padNets: { "1": 2 } },
      { ...source.footprints[0], id: "q1", ref: "Q2", at: { x: mmToNm(25), y: mmToNm(5) }, padNets: { "1": 2 } },
    );
    source.tracks.push({ ...track("protected", 5, 25), netId: 2, start: { x: mmToNm(5), y: mmToNm(5) }, end: { x: mmToNm(25), y: mmToNm(5) }, source: "human", locked: true });
    const protectedBefore = structuredClone(source.tracks.find((item) => item.id === "protected"));
    const executor: AutoroutePassExecutor = async (request) => {
      const candidate = { ...request.board, tracks: [track("ab", 5, 15)] };
      return successfulPass(request, candidate);
    };
    const result = await completeAutoroute(source, getPreset("jlcpcb-2l").rules, executor, { maxNoImprovementPasses: 1 });
    expect(result.passes[0].accepted).toBe(false);
    expect(result.passes[0].lostPreviouslyCompleteNetIds).toEqual([2]);
    expect(result.candidate.tracks.some((candidate) => candidate.id === "protected")).toBe(true);
    expect(result.candidate.tracks.find((candidate) => candidate.id === "protected")).toEqual(protectedBefore);
  });

  it("fails closed when a completed router result reports a stale authoritative source revision", async () => {
    const source = board();
    const executor: AutoroutePassExecutor = async (request) => {
      const candidate = { ...request.board, tracks: [track("ab", 5, 15)] };
      return {
        ...successfulPass(request, candidate),
        authoritativeSourceRevision: "pcb2-stale",
      };
    };
    const result = await completeAutoroute(source, getPreset("jlcpcb-2l").rules, executor);
    expect(result).toMatchObject({ status: "blocked", acceptedPasses: 0 });
    expect(result.candidate).toEqual(source);
    expect(result.attempts[0]).toMatchObject({ decision: "failed", returnedCandidate: false });
    expect(result.attempts[0].rejectionReasons[0]).toContain("authoritative source revision mismatch");
  });

  it("rejects new DRC errors even when a candidate completes another connection", async () => {
    const source = board();
    const executor: AutoroutePassExecutor = async (request) => {
      const candidate = {
        ...request.board,
        tracks: [{ ...track("too-thin", 5, 15), width: mmToNm(0.05) }],
      };
      return successfulPass(request, candidate);
    };
    const result = await completeAutoroute(source, getPreset("jlcpcb-2l").rules, executor, { maxNoImprovementPasses: 1 });
    expect(result.passes[0]).toMatchObject({ accepted: false, newDrcErrors: 1 });
    expect(result.passes[0].reason).toContain("new DRC error");
    expect(result.candidate.tracks).toHaveLength(0);
  });

  it("keeps the best accepted artifact separate from a later rejected attempt", async () => {
    const source = board();
    const executor: AutoroutePassExecutor = async (request) => {
      const candidate = {
        ...request.board,
        tracks: request.passIndex === 1 ? [track("accepted", 5, 15)] : [...request.board.tracks],
      };
      return successfulPass(request, candidate, {
        dsnText: `(pcb pass-${request.passIndex})`,
        sesText: `(session pass-${request.passIndex})`,
      });
    };
    const result = await completeAutoroute(source, getPreset("jlcpcb-2l").rules, executor, { maxNoImprovementPasses: 1 });
    expect(result.attempts).toHaveLength(2);
    expect(result.bestAcceptedAttempt?.pass).toBe(1);
    expect(result.bestAcceptedAttempt?.sesText).toContain("pass-1");
    expect(result.lastAttempt?.pass).toBe(2);
    expect(result.lastAttempt?.accepted).toBe(false);
    expect(result.candidate.tracks.map((item) => item.id)).toEqual(["accepted"]);
  });
});
