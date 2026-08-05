import { describe, expect, it } from "vitest";
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "../types";
import { mmToNm } from "../units";
import {
  migrateBoardElectricalIdentities,
  schematicEndpointKey,
  validateReferenceDesignators,
} from "../integrity";
import { pcbRevisionId } from "../ai/snapshot";
import { stackupProfile } from "../stackup";

function footprint(id: string, ref: string, netId: number): FootprintInstance {
  return {
    id,
    ref,
    footprintId: "Audit:OnePad",
    def: {
      libName: "Audit",
      name: "OnePad",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      pads: [{
        number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.5) },
        at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "maskTop", "pasteTop"],
      }],
      graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(1), maxY: mmToNm(1) }, models: [], rawSexpr: "",
    },
    at: { x: 0, y: 0 }, rotationDeg: 0, side: "top", padNets: { "1": netId },
  };
}

describe("persistent electrical identity migration", () => {
  it("preserves legacy numeric associations and persists deterministic stable IDs", () => {
    const legacy = createEmptyBoard() as PcbBoard;
    delete legacy.identityVersion;
    legacy.nets = [{ id: 0, name: "" }, { id: 7, name: "SIG" }];
    legacy.footprints = [footprint("u1", "U1", 7)];
    legacy.tracks = [{
      id: "t1", layer: "copperTop", width: mmToNm(0.25),
      start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 7,
    }];
    legacy.vias = [{
      id: "v1", at: { x: 1, y: 0 }, size: mmToNm(0.8), drill: mmToNm(0.4),
      netId: 7, layers: ["copperTop", "copperBottom"],
    }];
    legacy.zones = [{
      id: "z1", layer: "copperTop", netId: 7,
      polygon: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }],
      appearance: "solid", connection: "thermal", fill: [], dirty: true,
    }];
    legacy.stackup = 4;
    legacy.stackupConfig = stackupProfile("signal-plane-4");
    legacy.stackupConfig.copperLayers.find((layer) => layer.id === "in1")!.planeNetId = 7;
    legacy.routingHistory = [{
      schemaVersion: 1, id: "route-1", tool: "smart-route", baseWorldRevision: "before",
      netId: 7, layer: "copperTop", candidateId: "candidate-1", mode: "direct",
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], segmentIds: ["t1"],
      rules: { trackWidthNm: 250_000, clearanceNm: 200_000, edgeClearanceNm: 200_000, gridNm: 50_000 },
      score: 1, explanation: "legacy route",
    }];
    legacy.netClassing = {
      version: 1, assignments: {}, ruleDeltas: [{
        id: "delta-1", createdAt: "2026-07-16T00:00:00.000Z", source: "manual",
        explanation: "legacy direct-net rule",
        changes: [{ appliesTo: { kind: "nets", netIds: [7] }, trackWidthNm: 300_000 }],
      }],
    };
    const migrated = migrateBoardElectricalIdentities(legacy, "project-123");
    expect(migrated.diagnostics).toEqual([]);
    expect(migrated.board.identityVersion).toBe(1);
    expect(migrated.board.tracks[0].netId).toBe(7);
    expect(migrated.board.vias[0].netId).toBe(7);
    expect(migrated.board.zones[0].netId).toBe(7);
    expect(migrated.board.stackupConfig?.copperLayers.find((layer) => layer.id === "in1")?.planeNetId).toBe(7);
    expect(migrated.board.routingHistory?.[0].netId).toBe(7);
    expect(migrated.board.netClassing?.ruleDeltas[0].changes[0].appliesTo).toEqual({ kind: "nets", netIds: [7] });
    expect(migrated.board.nets[1].endpointKeys).toEqual([schematicEndpointKey("u1", "1")]);
    expect(migrated.board.nets[1].stableId).toMatch(/^legacy-net:/);
    expect(migrated.board.footprints[0].pinPadMappings?.[0].provenance).toBe("legacy-inferred");

    const reopened = JSON.parse(JSON.stringify(migrated.board)) as PcbBoard;
    const second = migrateBoardElectricalIdentities(reopened, "project-123");
    expect(second.board).toEqual(migrated.board);
    expect(second.migrated).toBe(false);
  });

  it("reports invalid duplicate legacy net IDs instead of normalizing silently", () => {
    const legacy = createEmptyBoard();
    legacy.nets.push({ id: 1, name: "A" }, { id: 1, name: "B" });
    const result = migrateBoardElectricalIdentities(legacy, "invalid-project");
    expect(result.board).toBe(legacy);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "DUPLICATE_NUMERIC_NET_ID")).toBe(true);
  });
});

describe("board-global exported references", () => {
  it("accepts unique annotated references", () => {
    expect(validateReferenceDesignators([
      { id: "a", ref: "R1" }, { id: "b", ref: "R2" }, { id: "c", ref: "U1" },
    ])).toEqual([]);
  });

  it.each([
    [[{ id: "a", ref: "R1" }, { id: "b", ref: "R1" }], "DUPLICATE_REFERENCE_DESIGNATOR"],
    [[{ id: "a", ref: "R1" }, { id: "b", ref: "r1" }], "DUPLICATE_REFERENCE_DESIGNATOR"],
    [[{ id: "a", ref: "R1" }, { id: "b", ref: " R1 " }], "DUPLICATE_REFERENCE_DESIGNATOR"],
    [[{ id: "a", ref: "" }], "UNANNOTATED_COMPONENT"],
    [[{ id: "a", ref: "R?" }], "UNANNOTATED_COMPONENT"],
  ] as const)("rejects ambiguous or invalid reference case %#", (components, code) => {
    expect(validateReferenceDesignators(components).some((diagnostic) => diagnostic.code === code)).toBe(true);
  });
});

describe("stale-candidate identity coverage", () => {
  it("changes revision for stable net, pin-pad, reference, and lock changes", () => {
    const board = createEmptyBoard();
    board.nets.push({ id: 1, name: "SIG", stableId: "net:one", endpointKeys: ["u1::1"] });
    board.footprints = [footprint("u1", "U1", 1)];
    board.footprints[0].pinPadMappings = [{
      componentInstanceId: "u1", endpointKey: "u1::1", symbolPinNumber: "1", padNumbers: ["1"],
      mappingKind: "electrical", provenance: "exact-number",
    }];
    board.tracks = [{
      id: "t", layer: "copperTop", width: 250_000, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 1,
    }];
    const base = pcbRevisionId(board);
    expect(pcbRevisionId({ ...board, nets: board.nets.map((net) => net.id === 1 ? { ...net, stableId: "net:two" } : net) })).not.toBe(base);
    expect(pcbRevisionId({ ...board, footprints: board.footprints.map((item) => ({ ...item, ref: "U2" })) })).not.toBe(base);
    expect(pcbRevisionId({ ...board, footprints: board.footprints.map((item) => ({ ...item, pinPadMappings: [] })) })).not.toBe(base);
    expect(pcbRevisionId({ ...board, tracks: board.tracks.map((item) => ({ ...item, locked: true })) })).not.toBe(base);
  });
});
