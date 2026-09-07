/**
 * B16-A (review finding F4) — RC01 parity must be certified against the
 * applied schematic snapshot, never against a netlist projected from the
 * board under test.
 *
 * Reproduction: `boardToSourceNetlist(board)` derives components from the
 * board's footprints and nets from the board's nets, so comparing that
 * netlist with the same board is a tautology — a board that LOST a net or
 * GAINED a footprint still "passes". `snapshotToSourceNetlist(snapshot)`
 * derives the intent from the durable synchronization snapshot, so the same
 * tampered boards fail with the exact parity diagnostics.
 */
import { describe, expect, it } from "vitest";
import { boardToSourceNetlist } from "../../board-netlist";
import { schematicEndpointKey, stableNetIdForEndpoints } from "../../integrity";
import { buildSchematicParityCertificate } from "../../readiness/parity";
import { pcbRevisionId } from "../../revision";
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "../../types";
import { mmToNm } from "../../units";
import { snapshotToSourceNetlist } from "../snapshot-netlist";
import type { PcbSyncAuthoritativeSnapshot } from "../../../pcb-sync/types";
import { footprintDef, snapshotBase } from "../../../pcb-sync/__tests__/fixtures";
import { authoritativeSnapshotDigest } from "../../../pcb-sync/stable";

const U1 = "sync-u1", U2 = "sync-u2";
const u1p1 = schematicEndpointKey(U1, "1"), u2p1 = schematicEndpointKey(U2, "1"), u1p2 = schematicEndpointKey(U1, "2"), u2p2 = schematicEndpointKey(U2, "2");

/** Two applicable components, two nets: SIG1 = u1:1–u2:1, SIG2 = u1:2–u2:2; plus one NON-applicable (nonphysical) component that never reaches the board. */
function appliedSnapshot(): PcbSyncAuthoritativeSnapshot {
  const base = snapshotBase([U1, U2]);
  base.components = base.components.map((component) => ({ ...component, pins: component.pins.map((pin) => ({ ...pin, disposition: "connected" as const })) }));
  base.components.push({ componentInstanceId: "sync-flag", componentRevision: "r1", referenceDesignator: "#FLG1", hierarchyPath: ["root"], symbolAssetVersionId: "symbol-flag:r1", applicability: "nonphysical", pins: [] });
  base.nets = [
    { stableNetId: stableNetIdForEndpoints([u1p1, u2p1], "SIG1"), connectivityRevision: "net-r1", canonicalScope: [], displayName: "SIG1", aliases: [], classification: "signal", members: [{ componentInstanceId: U1, pinInstanceId: `${U1}:pin:1`, pinNumber: "1" }, { componentInstanceId: U2, pinInstanceId: `${U2}:pin:1`, pinNumber: "1" }], explicitNoConnectPinIds: [], constraintRefs: [] },
    { stableNetId: stableNetIdForEndpoints([u1p2, u2p2], "SIG2"), connectivityRevision: "net-r2", canonicalScope: [], displayName: "SIG2", aliases: [], classification: "signal", members: [{ componentInstanceId: U1, pinInstanceId: `${U1}:pin:2`, pinNumber: "2" }, { componentInstanceId: U2, pinInstanceId: `${U2}:pin:2`, pinNumber: "2" }], explicitNoConnectPinIds: [], constraintRefs: [] },
  ];
  return { ...base, snapshotDigest: authoritativeSnapshotDigest(base) };
}

function footprint(id: string, ref: string, x: number, nets: { pin1: number; pin2: number }): FootprintInstance {
  return {
    id, ref, footprintId: "Test:TwoPad", def: footprintDef(), at: { x: mmToNm(x), y: 0 }, rotationDeg: 0, side: "top",
    padNets: { "1": nets.pin1, "2": nets.pin2 },
    pinPadMappings: [
      { componentInstanceId: id, endpointKey: schematicEndpointKey(id, "1"), symbolPinNumber: "1", padNumbers: ["1"], mappingKind: "electrical", provenance: "library-explicit" },
      { componentInstanceId: id, endpointKey: schematicEndpointKey(id, "2"), symbolPinNumber: "2", padNumbers: ["2"], mappingKind: "electrical", provenance: "library-explicit" },
    ],
  };
}

/** The board the synchronization would have materialized from `appliedSnapshot()`. */
function syncedBoard(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "SIG1", stableId: stableNetIdForEndpoints([u1p1, u2p1], "SIG1"), endpointKeys: [u1p1, u2p1].sort() });
  board.nets.push({ id: 2, name: "SIG2", stableId: stableNetIdForEndpoints([u1p2, u2p2], "SIG2"), endpointKeys: [u1p2, u2p2].sort() });
  board.footprints = [footprint(U1, "U1", 0, { pin1: 1, pin2: 2 }), footprint(U2, "U2", 10, { pin1: 1, pin2: 2 })];
  return board;
}

const certify = (board: PcbBoard, netlist: ReturnType<typeof snapshotToSourceNetlist>) => buildSchematicParityCertificate(board, pcbRevisionId(board), netlist);

describe("B16-A F4 — parity source is the applied snapshot, not the board", () => {
  it("derives the intended netlist from the snapshot: applicable components only, every pin an endpoint, canonical endpoint keys and stable net identities", () => {
    const netlist = snapshotToSourceNetlist(appliedSnapshot());
    expect(netlist.components.map((component) => component.id)).toEqual([U1, U2]);
    expect(netlist.components[0]!.pins.map((pin) => pin.number)).toEqual(["1", "2"]);
    expect(netlist.nets).toHaveLength(2);
    for (const net of netlist.nets) {
      expect(net.endpointKeys).toEqual([...net.endpointKeys].sort());
      expect(net.nodes.map((node) => schematicEndpointKey(node.componentId, node.pinNumber)).sort()).toEqual(net.endpointKeys);
    }
    expect(netlist.nets.map((net) => stableNetIdForEndpoints(net.endpointKeys, net.name)).sort()).toEqual(appliedSnapshot().nets.map((net) => net.stableNetId).sort());
  });

  it("the faithfully synchronized board passes parity against the snapshot-derived netlist", () => {
    const certificate = certify(syncedBoard(), snapshotToSourceNetlist(appliedSnapshot()));
    expect(certificate.state, JSON.stringify(certificate.diagnostics)).toBe("pass");
    expect(certificate.source).toBe("authoritative-netlist");
  });

  it("REPRODUCTION: a board whose two nets were SHORTED into one (a net lost) passes the board-projected (tautological) parity but FAILS snapshot parity", () => {
    const tampered = syncedBoard();
    // SIG2 merged into SIG1; the board's own net records are rewritten consistently, so the board still agrees with itself.
    tampered.nets = tampered.nets.filter((net) => net.id !== 2);
    tampered.nets[1]!.endpointKeys = [u1p1, u2p1, u1p2, u2p2].sort();
    tampered.nets[1]!.stableId = stableNetIdForEndpoints(tampered.nets[1]!.endpointKeys, "SIG1");
    for (const item of tampered.footprints) item.padNets["2"] = 1;
    const tautological = certify(tampered, boardToSourceNetlist(tampered));
    expect(tautological.state).toBe("pass"); // the defect: the board agrees with itself
    const honest = certify(tampered, snapshotToSourceNetlist(appliedSnapshot()));
    expect(honest.state).toBe("fail");
    expect(honest.missingNets).toEqual([stableNetIdForEndpoints([u1p1, u2p1], "SIG1"), stableNetIdForEndpoints([u1p2, u2p2], "SIG2")].sort());
    expect(honest.diagnostics.map((item) => item.code)).toContain("NET_MEMBERSHIP_MISMATCH");
  });

  it("REPRODUCTION: a board that GAINED a footprint passes the board-projected parity but FAILS snapshot parity", () => {
    const tampered = syncedBoard();
    // A third part wired onto the existing nets; the board's own net records are rewritten consistently.
    tampered.footprints.push(footprint("sync-u3", "U3", 20, { pin1: 1, pin2: 2 }));
    const u3p1 = schematicEndpointKey("sync-u3", "1"), u3p2 = schematicEndpointKey("sync-u3", "2");
    tampered.nets[1]!.endpointKeys = [u1p1, u2p1, u3p1].sort(); tampered.nets[1]!.stableId = stableNetIdForEndpoints(tampered.nets[1]!.endpointKeys, "SIG1");
    tampered.nets[2]!.endpointKeys = [u1p2, u2p2, u3p2].sort(); tampered.nets[2]!.stableId = stableNetIdForEndpoints(tampered.nets[2]!.endpointKeys, "SIG2");
    expect(certify(tampered, boardToSourceNetlist(tampered)).state).toBe("pass");
    const honest = certify(tampered, snapshotToSourceNetlist(appliedSnapshot()));
    expect(honest.state).toBe("fail");
    expect(honest.extraComponents).toEqual(["sync-u3"]);
  });

  it("REPRODUCTION: an endpoint moved to another net passes the board-projected parity but FAILS snapshot parity", () => {
    const tampered = syncedBoard();
    // u2:2 rewired onto SIG1 — the board's own net records are rewritten consistently, so the board still agrees with itself.
    tampered.footprints[1]!.padNets["2"] = 1;
    tampered.nets[1]!.endpointKeys = [u1p1, u2p1, u2p2].sort();
    tampered.nets[1]!.stableId = stableNetIdForEndpoints(tampered.nets[1]!.endpointKeys, "SIG1");
    tampered.nets[2]!.endpointKeys = [u1p2];
    tampered.nets[2]!.stableId = stableNetIdForEndpoints([u1p2], "SIG2");
    expect(certify(tampered, boardToSourceNetlist(tampered)).state).toBe("pass");
    const honest = certify(tampered, snapshotToSourceNetlist(appliedSnapshot()));
    expect(honest.state).toBe("fail");
    expect(honest.netMembershipMismatches.map((item) => item.endpointKey)).toContain(u2p2);
  });
});
