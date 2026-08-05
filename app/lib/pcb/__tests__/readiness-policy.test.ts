import { describe, expect, it } from "vitest";
import { createEmptyBoard, type FootprintInstance, type PcbBoard, type Track } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import { mmToNm } from "../units";
import { schematicEndpointKey, stableNetIdForEndpoints } from "../integrity";
import { evaluatePcbFabricationReadiness, readinessViewModel } from "../readiness/evaluate";
import { createReleaseWaiver } from "../readiness/waiver";
import { getPreset } from "../drc/presets";
import { getFabPreset } from "../fab/presets";
import { runDrc } from "../drc/run-drc";
import { pcbRevisionId } from "../revision";
import { buildAIPcbSnapshot } from "../ai/snapshot";
import { stackupProfile } from "../stackup";
import {
  createManufacturingReleaseManifest,
  ManufacturingReleaseBlockedError,
  prepareManufacturingRelease,
} from "../readiness/release";

const endpointA = schematicEndpointKey("a", "1");
const endpointB = schematicEndpointKey("b", "1");
const stableNetId = stableNetIdForEndpoints([endpointA, endpointB], "SIG");

function footprint(id: string, ref: string, x: number): FootprintInstance {
  const endpointKey = id === "a" ? endpointA : endpointB;
  return {
    id,
    ref,
    footprintId: "Readiness:OnePad",
    def: {
      libName: "Readiness",
      name: "OnePad",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      pads: [{
        number: "1",
        type: "smd",
        shape: { kind: "circle", radius: mmToNm(0.3) },
        at: { x: 0, y: 0 },
        rotationDeg: 0,
        layers: ["copperTop", "maskTop", "pasteTop"],
      }],
      graphics: [],
      bodyBBox: { minX: mmToNm(-0.5), minY: mmToNm(-0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) },
      courtyardBBox: { minX: mmToNm(-0.6), minY: mmToNm(-0.6), maxX: mmToNm(0.6), maxY: mmToNm(0.6) },
      models: [],
      rawSexpr: "",
    },
    at: { x: mmToNm(x), y: mmToNm(10) },
    rotationDeg: 0,
    side: "top",
    padNets: { "1": 1 },
    pinPadMappings: [{
      componentInstanceId: id,
      endpointKey,
      symbolPinNumber: "1",
      padNumbers: ["1"],
      mappingKind: "electrical",
      provenance: "exact-number",
    }],
  };
}

function fixture(): { board: PcbBoard; netlist: PcbNetlist } {
  const board = createEmptyBoard();
  board.identityVersion = 1;
  board.outline = { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(30), height: mmToNm(20) };
  board.footprints = [footprint("a", "J1", 10), footprint("b", "J2", 20)];
  board.nets.push({ id: 1, name: "SIG", stableId: stableNetId, endpointKeys: [endpointA, endpointB].sort() });
  board.tracks = [{
    id: "route",
    layer: "copperTop",
    width: mmToNm(0.25),
    start: { x: mmToNm(10), y: mmToNm(10) },
    end: { x: mmToNm(20), y: mmToNm(10) },
    netId: 1,
  }];
  const netlist: PcbNetlist = {
    components: [
      { id: "a", ref: "J1", pins: [{ number: "1" }] },
      { id: "b", ref: "J2", pins: [{ number: "1" }] },
    ],
    nets: [{
      id: 1,
      name: "SIG",
      nodes: [{ componentId: "a", pinNumber: "1" }, { componentId: "b", pinNumber: "1" }],
      endpointKeys: [endpointA, endpointB].sort(),
    }],
  };
  return { board, netlist };
}

const fab = getFabPreset("jlcpcb-2l");
const drc = getPreset("jlcpcb-2l");

function evaluate(board: PcbBoard, netlist?: PcbNetlist) {
  return evaluatePcbFabricationReadiness({ board, netlist, fabPreset: fab, drcPreset: drc });
}

describe("scoped PCB fabrication readiness policy", () => {
  it("is ready only when every required current check passes", () => {
    const { board, netlist } = fixture();
    const report = evaluate(board, netlist);
    expect(report.overallState).toBe("ready");
    expect(report.checks.every((check) => check.state === "pass")).toBe(true);
    expect(report.permittedActions).toContain("verified_manufacturing_release");
  });

  it("fixes the motivating unknown-parity + clean DRC + zero-unrouted regression", () => {
    const { board } = fixture();
    const report = evaluate(board);
    const aiSnapshot = buildAIPcbSnapshot(board, { fabPreset: fab, drcPreset: drc });
    expect(runDrc(board, drc.rules, { presetId: drc.id })).toMatchObject({ ok: true, electrical: { remainingConnections: 0 } });
    expect(report.overallState).toBe("verification_incomplete");
    expect(report.checks.find((check) => check.code === "SCHEMATIC_PARITY")?.state).toBe("unknown");
    expect(report.permittedActions).not.toContain("verified_manufacturing_release");
    expect(report.permittedActions).toContain("interchange_export");
    expect(aiSnapshot.readiness).toMatchObject({
      reportId: report.reportId,
      overallState: "verification_incomplete",
      designRevision: report.designRevision,
    });
  });

  it("distinguishes proven failure, incomplete evaluation, and stale evidence", () => {
    const { board, netlist } = fixture();
    const open = structuredClone(board);
    open.tracks = [];
    expect(evaluate(open, netlist).overallState).toBe("blocked");

    const abort = new AbortController();
    abort.abort();
    const partialDrc = runDrc(board, drc.rules, { presetId: drc.id, abortSignal: abort.signal });
    expect(evaluatePcbFabricationReadiness({ board, netlist, fabPreset: fab, drcPreset: drc, drcResult: partialDrc }).overallState)
      .toBe("verification_incomplete");

    const current = structuredClone(board);
    current.tracks[0].width += 1;
    expect(evaluatePcbFabricationReadiness({
      board,
      netlist,
      fabPreset: fab,
      drcPreset: drc,
      currentDesignRevision: pcbRevisionId(current),
    }).overallState).toBe("stale");
  });

  it("allows nonblocking warnings without rewriting them as pass/fail", () => {
    const { board, netlist } = fixture();
    const orphan: Track = {
      id: "orphan",
      layer: "copperTop",
      width: mmToNm(0.25),
      start: { x: mmToNm(25), y: mmToNm(15) },
      end: { x: mmToNm(26), y: mmToNm(15) },
      netId: 0,
    };
    board.tracks.push(orphan);
    const report = evaluate(board, netlist);
    expect(report.overallState).toBe("ready");
    expect(report.warnings.some((item) => item.code === "ORPHAN_COPPER")).toBe(true);
  });

  it("keeps waived evidence blocked while authorizing only an engineering artifact", () => {
    const { board, netlist } = fixture();
    board.tracks = [];
    const first = evaluate(board, netlist);
    expect(first.overallState).toBe("blocked");
    expect(first.overrideDisposition).toBe("available");
    const checkCodes = first.checks.filter((check) => check.state !== "pass").map((check) => check.code);
    const waiver = createReleaseWaiver({
      checkCodes,
      diagnosticCodes: first.blockers.map((item) => item.code),
      componentIds: first.blockers.flatMap((item) => item.componentIds ?? []),
      netStableIds: first.blockers.flatMap((item) => item.netStableIds ?? []),
      objectIds: first.blockers.flatMap((item) => item.objectIds ?? []),
      reason: "Intentional open-net prototype for bench probing",
      designRevision: first.designRevision,
      manufacturingProfileId: fab.id,
      manufacturingProfileVersion: fab.version,
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    const report = evaluatePcbFabricationReadiness({ board, netlist, fabPreset: fab, drcPreset: drc, waivers: [waiver] });
    expect(report.overallState).toBe("blocked");
    expect(report.overrideDisposition).toBe("authorized");
    expect(report.permittedActions).toContain("engineering_prototype_export");
    expect(report.permittedActions).not.toContain("verified_manufacturing_release");
  });

  it("denies overrides for non-waivable identity/export integrity failures", () => {
    const { board, netlist } = fixture();
    board.footprints[1].ref = "j1";
    const report = evaluate(board, netlist);
    expect(report.overallState).toBe("blocked");
    expect(report.overrideDisposition).toBe("denied");
  });

  it("revalidates and binds a verified release to one immutable snapshot", () => {
    const { board, netlist } = fixture();
    const prepared = prepareManufacturingRelease({
      board,
      disposition: "verified_manufacturing_release",
      evaluate: (snapshot) => evaluate(snapshot, netlist),
    });
    const releaseRevision = prepared.report.designRevision;
    board.tracks[0].width += 100;
    expect(pcbRevisionId(prepared.snapshot)).toBe(releaseRevision);
    expect(pcbRevisionId(board)).not.toBe(releaseRevision);
    const manifest = createManufacturingReleaseManifest({
      prepared,
      projectIdentity: "project:test",
      exporterVersion: "test-exporter/1",
      generatedAt: "2026-07-17T00:00:00.000Z",
      artifacts: [{ path: "board.gbr", kind: "gerber", bytes: 4, sha256: "abcd" }],
    });
    expect(manifest).toMatchObject({
      verified: true,
      designRevision: releaseRevision,
      readinessReportId: prepared.report.reportId,
      artifacts: [{ path: "board.gbr", sha256: "abcd" }],
    });
  });

  it("rejects a stale badge at the release boundary", () => {
    const { board, netlist } = fixture();
    const prior = evaluate(board, netlist);
    board.tracks[0].width += 1;
    expect(() => prepareManufacturingRelease({
      board,
      priorReport: prior,
      disposition: "verified_manufacturing_release",
      evaluate: (snapshot) => evaluate(snapshot, netlist),
    })).toThrow(ManufacturingReleaseBlockedError);
  });

  it("invalidates a revision-bound waiver after any semantic design change", () => {
    const { board, netlist } = fixture();
    board.tracks = [];
    const first = evaluate(board, netlist);
    const waiver = createReleaseWaiver({
      checkCodes: first.checks.filter((check) => check.state !== "pass").map((check) => check.code),
      diagnosticCodes: first.blockers.map((item) => item.code),
      componentIds: first.blockers.flatMap((item) => item.componentIds ?? []),
      netStableIds: first.blockers.flatMap((item) => item.netStableIds ?? []),
      objectIds: first.blockers.flatMap((item) => item.objectIds ?? []),
      reason: "Bench-only open-net prototype",
      designRevision: first.designRevision,
      manufacturingProfileId: fab.id,
      manufacturingProfileVersion: fab.version,
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    board.footprints[0].at.x += 1;
    const changed = evaluatePcbFabricationReadiness({ board, netlist, fabPreset: fab, drcPreset: drc, waivers: [waiver] });
    expect(changed.waivers).toEqual([]);
    expect(changed.overrideDisposition).toBe("available");
    expect(changed.permittedActions).not.toContain("engineering_prototype_export");
  });

  it("never treats configuration-only plane intent as proven conductive geometry", () => {
    const { board, netlist } = fixture();
    board.stackup = 4;
    board.stackupConfig = stackupProfile("signal-plane-4");
    board.stackupConfig.copperLayers.find((layer) => layer.id === "in1")!.planeNetId = 1;
    const fab4 = getFabPreset("jlcpcb-4l");
    const drc4 = getPreset("jlcpcb-4l");
    const report = evaluatePcbFabricationReadiness({ board, netlist, fabPreset: fab4, drcPreset: drc4 });
    expect(report.overallState).not.toBe("ready");
    expect(report.unknowns.map((item) => item.code)).toContain("NATIVE_PLANE_UNRESOLVED");
    expect(report.checks.find((check) => check.code === "MANUFACTURING_REPRESENTATION")?.state).toBe("unknown");
  });

  it("gives UI, AI, and release records the same deterministic report", () => {
    const { board, netlist } = fixture();
    const report = evaluate(board, netlist);
    const repeated = evaluate(structuredClone(board), structuredClone(netlist));
    const ai = buildAIPcbSnapshot(board, { netlist, fabPreset: fab, drcPreset: drc });
    const ui = readinessViewModel(report);
    const prepared = prepareManufacturingRelease({
      board,
      disposition: "verified_manufacturing_release",
      evaluate: (snapshot) => evaluate(snapshot, netlist),
    });
    const manifest = createManufacturingReleaseManifest({
      prepared,
      projectIdentity: "project:consistency",
      exporterVersion: "kicad-assisted/1",
      generatedAt: "2026-07-17T00:00:00.000Z",
      artifacts: [],
    });
    expect(repeated.reportId).toBe(report.reportId);
    expect(ai.readiness.reportId).toBe(report.reportId);
    expect(ai.readiness.checks.map((check) => check.state)).toEqual(report.checks.map((check) => check.state));
    expect(ui).toMatchObject({ state: report.overallState, reportId: report.reportId, designRevision: report.designRevision });
    expect(manifest).toMatchObject({ readinessReportId: report.reportId, designRevision: report.designRevision });
  });
});
