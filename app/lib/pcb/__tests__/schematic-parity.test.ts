import { describe, expect, it } from "vitest";
import { buildSchematicParityCertificate } from "../readiness/parity";
import { pcbRevisionId } from "../revision";
import { createEmptyBoard, type PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import { mmToNm } from "../units";
import { schematicEndpointKey, stableNetIdForEndpoints } from "../integrity";

const a1 = schematicEndpointKey("a", "1");
const b1 = schematicEndpointKey("b", "1");

function parityFixture(): { board: PcbBoard; netlist: PcbNetlist } {
  const board = createEmptyBoard();
  board.identityVersion = 1;
  board.footprints = [
    { id: "a", ref: "J1", footprintId: "P:1", at: { x: 0, y: 0 }, rotationDeg: 0, side: "top", padNets: { "1": 1 }, pinPadMappings: [{ componentInstanceId: "a", endpointKey: a1, symbolPinNumber: "1", padNumbers: ["1"], mappingKind: "electrical", provenance: "exact-number" }], def: { libName: "P", name: "1", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.2) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop"] }], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "" } },
    { id: "b", ref: "J2", footprintId: "P:1", at: { x: 10, y: 0 }, rotationDeg: 0, side: "top", padNets: { "1": 1 }, pinPadMappings: [{ componentInstanceId: "b", endpointKey: b1, symbolPinNumber: "1", padNumbers: ["1"], mappingKind: "electrical", provenance: "exact-number" }], def: { libName: "P", name: "1", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.2) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop"] }], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "" } },
  ];
  board.nets.push({ id: 1, name: "SIG", stableId: stableNetIdForEndpoints([a1, b1], "SIG"), endpointKeys: [a1, b1].sort() });
  const netlist: PcbNetlist = {
    components: [{ id: "a", ref: "J1", pins: [{ number: "1" }] }, { id: "b", ref: "J2", pins: [{ number: "1" }] }],
    nets: [{ id: 1, name: "SIG", nodes: [{ componentId: "a", pinNumber: "1" }, { componentId: "b", pinNumber: "1" }], endpointKeys: [a1, b1].sort() }],
  };
  return { board, netlist };
}

describe("schematic-to-PCB stable identity parity", () => {
  it("proves exact identity-set parity and ignores a display rename", () => {
    const { board, netlist } = parityFixture();
    expect(buildSchematicParityCertificate(board, pcbRevisionId(board), netlist).state).toBe("pass");
    board.footprints[0].ref = "J10";
    netlist.components[0].ref = "J10";
    expect(buildSchematicParityCertificate(board, pcbRevisionId(board), netlist).state).toBe("pass");
  });

  it("reports missing/extra components, endpoints, ambiguous mappings, and equal-count membership changes", () => {
    const { board, netlist } = parityFixture();
    const missing = structuredClone(board);
    missing.footprints.pop();
    expect(buildSchematicParityCertificate(missing, pcbRevisionId(missing), netlist).missingComponents).toEqual(["b"]);

    const extra = structuredClone(board);
    extra.footprints.push({ ...structuredClone(extra.footprints[0]), id: "c", ref: "J3" });
    expect(buildSchematicParityCertificate(extra, pcbRevisionId(extra), netlist).extraComponents).toEqual(["c"]);

    const endpoint = structuredClone(board);
    endpoint.footprints[1].pinPadMappings = [];
    expect(buildSchematicParityCertificate(endpoint, pcbRevisionId(endpoint), netlist).missingEndpoints).toEqual([b1]);

    const ambiguous = structuredClone(board);
    ambiguous.footprints[0].pinPadMappings!.push(structuredClone(ambiguous.footprints[0].pinPadMappings![0]));
    expect(buildSchematicParityCertificate(ambiguous, pcbRevisionId(ambiguous), netlist).ambiguousMappings).toContain(a1);

    const membership = structuredClone(board);
    membership.nets[1].stableId = "net:wrong-but-same-count";
    expect(buildSchematicParityCertificate(membership, pcbRevisionId(membership), netlist).netMembershipMismatches).toHaveLength(2);
  });

  it("accepts explicit intentional no-connect classification", () => {
    const { board, netlist } = parityFixture();
    const endpoint = schematicEndpointKey("a", "2");
    netlist.components[0].pins.push({ number: "2" });
    board.footprints[0].pinPadMappings!.push({ componentInstanceId: "a", endpointKey: endpoint, symbolPinNumber: "2", padNumbers: [], mappingKind: "intentional-no-connect", provenance: "user-explicit" });
    const report = buildSchematicParityCertificate(board, pcbRevisionId(board), netlist);
    expect(report.state).toBe("pass");
    expect(report.intentionalNoConnects).toContain(endpoint);
  });

  it("keeps missing schematic unknown and revision mismatch stale", () => {
    const { board, netlist } = parityFixture();
    const revision = pcbRevisionId(board);
    expect(buildSchematicParityCertificate(board, revision).state).toBe("unknown");
    expect(buildSchematicParityCertificate(board, revision, netlist, "pcb2-older").state).toBe("stale");
  });
});
