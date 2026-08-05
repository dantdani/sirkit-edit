import { describe, expect, it } from "vitest";
import { PCB_AI_TOOLS } from "../ai/pcb-tool-schemas";
import { createEmptyBoard, type FootprintDef, type FootprintInstance, type PcbBoard, type Track } from "../types";
import { mmToNm } from "../units";
import { setBoardStackupProfile } from "../stackup";
import { bestRouteAnchor, resolveRouteAnchors } from "../routing/anchors";
import { buildRouteCandidate, commitRouteCandidate, revertRouteCommit } from "../routing/candidate";
import { REQUIRED_ROUTING_CORPUS } from "../routing/corpus";
import { resolveDifferentialPair } from "../routing/differential";
import { legalViaTransitions } from "../routing/layers";
import { measureRoutePath } from "../routing/measurement";
import { canMutateCopper } from "../routing/protection";
import { ProfessionalRoutingService } from "../routing/service";
import { solveBoundedShove } from "../routing/shove";
import { buildRoutingSnapshot } from "../routing/snapshot";
import { buildRouteTopology } from "../routing/topology";
import { tuneStraightTrack } from "../routing/tuning";
import type { RouteRequest } from "../routing/types";
import { routeSmart } from "../smart-routing/engine";
import { resolveSmartRoutingRules } from "../smart-routing/rules";
import { adaptBoardToRoutingWorld } from "../smart-routing/world";

const p = (x: number, y: number) => ({ x: mmToNm(x), y: mmToNm(y) });

function padDef(): FootprintDef {
  return {
    libName: "R8",
    name: "PAD",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.5) }, at: p(0, 0), rotationDeg: 0, layers: ["copperTop", "maskTop"] }],
    graphics: [], bodyBBox: { minX: -500_000, minY: -500_000, maxX: 500_000, maxY: 500_000 }, models: [], rawSexpr: "",
  };
}

function part(id: string, x: number, y: number, netId: number): FootprintInstance {
  return { id, ref: id.toUpperCase(), footprintId: "R8:PAD", def: padDef(), at: p(x, y), rotationDeg: 0, side: "top", padNets: { "1": netId } };
}

function board(): PcbBoard {
  const value = createEmptyBoard();
  value.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] }, { id: 2, name: "OTHER", stableId: "net:other", endpointKeys: [] });
  return value;
}

function track(id: string, netId: number, start: { x: number; y: number }, end: { x: number; y: number }, source: Track["source"] = "human"): Track {
  return { id, layer: "copperTop", width: 250_000, start, end, netId, source };
}

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    requestId: "request:r8",
    operationKind: "interactive_route",
    targetIds: [], routeMode: "walk_around", posture: "arbitrary", preferredLayer: "copperTop", viaStrategy: "none",
    hardConstraintIds: [], softPreferenceIds: [], mutationScope: { kind: "new_candidate", objectIds: [] },
    preservePolicy: "preserve_manual_imported_unknown",
    searchBudget: { maxNodes: 1000, maxMovedObjects: 8, maxIterations: 16, timeoutMs: 100 },
    deterministicSeed: 8, requestedBy: { actorId: "test", kind: "human" }, ...overrides,
  };
}

describe("Stage 8 authoritative routing model", () => {
  it("keeps arbitrary-angle copper native through topology, preview, and measurement", () => {
    const value = board();
    value.tracks = [track("angle", 1, p(10, 10), p(13, 14))];
    const snapshot = buildRoutingSnapshot(value);
    expect(snapshot.topology.edges).toHaveLength(1);
    const [a, b] = snapshot.topology.edges[0].endpointNodeIds;
    const measurement = measureRoutePath({ snapshot, netId: 1, endpointNodeA: a, endpointNodeB: b });
    expect(measurement.status).toBe("measured");
    expect(measurement.totalPhysicalModelLength).toBe(mmToNm(5));
    const rules = resolveSmartRoutingRules(value, 1, "copperTop");
    const routed = routeSmart(adaptBoardToRoutingWorld(value), { schemaVersion: 1, netId: 1, layer: "copperTop", start: p(20, 20), end: p(23, 24), movementPolicy: "keep-existing-copper-fixed", routeMode: "highlight_stop", posture: "arbitrary", maxCandidates: 1 }, rules);
    expect(routed.candidates[0]?.validation.violations.some((violation) => violation.code === "NON_OCTILINEAR")).toBe(false);
  });

  it("resolves deterministic interior anchors and rejects wrong-net/net-0 adoption", () => {
    const value = board();
    value.tracks = [track("source", 1, p(10, 10), p(30, 20)), track("wrong", 2, p(10, 30), p(30, 30)), track("zero", 0, p(10, 40), p(30, 40))];
    const snapshot = buildRoutingSnapshot(value);
    const first = bestRouteAnchor({ snapshot, point: p(20, 15), preferredLayer: "copperTop", requestedNetId: 1 });
    const second = bestRouteAnchor({ snapshot, point: p(20, 15), preferredLayer: "copperTop", requestedNetId: 1 });
    expect(first?.contactKind).toBe("interior_track_junction");
    expect(first?.anchorId).toBe(second?.anchorId);
    expect(resolveRouteAnchors({ snapshot, point: p(20, 30), requestedNetId: 1 }).find((anchor) => anchor.objectId === "track:wrong")?.eligible).toBe(false);
    expect(resolveRouteAnchors({ snapshot, point: p(20, 40) }).find((anchor) => anchor.objectId === "track:zero")?.eligible).toBe(false);
  });

  it("uses the physical four-layer graph rather than a binary front/back flip", () => {
    const value = board();
    setBoardStackupProfile(value, "all-signal-4");
    const transitions = legalViaTransitions(value, 1, "in1");
    expect(transitions.map((choice) => choice.targetLayer)).toEqual(["copperTop", "in2", "copperBottom"]);
    expect(transitions.every((choice) => choice.physicalSpan[0] === "copperTop" && choice.physicalSpan[1] === "copperBottom")).toBe(true);
    expect(transitions[0].connectedLayers).toEqual(["copperTop", "in1", "in2", "copperBottom"]);
  });

  it("commits one immutable candidate, rejects stale input, and exactly reverts", () => {
    const value = board();
    value.footprints = [part("a", 10, 10, 1), part("b", 30, 10, 1)];
    const snapshot = buildRoutingSnapshot(value);
    const start = bestRouteAnchor({ snapshot, point: p(10, 10), requestedNetId: 1 });
    const end = bestRouteAnchor({ snapshot, point: p(30, 10), requestedNetId: 1 });
    if (!start || !end) throw new Error("missing anchors");
    const candidate = buildRouteCandidate({ snapshot, request: request({ startAnchor: start, endAnchor: end, targetIds: [start.objectId, end.objectId] }), tracks: [track("preview", 1, start.point, end.point)], anchors: [start, end] });
    expect(candidate.localValidation.horizon).toBe("interactive_local");
    expect(Object.isFrozen(candidate)).toBe(true);
    const committed = commitRouteCandidate({ board: value, candidate, actorId: "test" });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.transaction.authoritativeValidation.globalState).toBe("evaluated");
    expect(committed.board.tracks).toHaveLength(1);
    const reverted = revertRouteCommit({ board: committed.board, transaction: committed.transaction });
    expect(reverted.ok && reverted.board.tracks).toHaveLength(0);
    const changed = structuredClone(value);
    if (changed.outline.kind !== "rect") throw new Error("expected rectangular test board");
    changed.outline.width += 1;
    expect(commitRouteCandidate({ board: changed, candidate, actorId: "test" })).toMatchObject({ ok: false, code: "STALE" });
  });

  it("preserves locked, imported, out-of-scope manual, and unknown copper centrally", () => {
    const scope = request({ mutationScope: { kind: "selected_objects", objectIds: ["track:x"] }, preservePolicy: "selected_manual_movable" });
    expect(canMutateCopper({ ...track("x", 1, p(0, 0), p(1, 0)), locked: true }, scope).allowed).toBe(false);
    expect(canMutateCopper(track("x", 1, p(0, 0), p(1, 0), "imported"), scope).allowed).toBe(false);
    expect(canMutateCopper(track("y", 1, p(0, 0), p(1, 0), "human"), scope).allowed).toBe(false);
    expect(canMutateCopper({ ...track("x", 1, p(0, 0), p(1, 0)), source: undefined }, scope).allowed).toBe(false);
    expect(canMutateCopper(track("x", 1, p(0, 0), p(1, 0), "human"), scope).allowed).toBe(true);
  });

  it("reports branch loops as ambiguous instead of guessing a shortest path", () => {
    const value = board();
    value.tracks = [track("a", 1, p(10, 10), p(20, 10)), track("b", 1, p(20, 10), p(20, 20)), track("c", 1, p(20, 20), p(10, 20)), track("d", 1, p(10, 20), p(10, 10))];
    const snapshot = buildRoutingSnapshot(value);
    const topology = buildRouteTopology(value);
    const nodeA = topology.nodes.find((node) => node.position.x === p(10, 10).x && node.position.y === p(10, 10).y);
    const nodeB = topology.nodes.find((node) => node.position.x === p(20, 20).x && node.position.y === p(20, 20).y);
    if (!nodeA || !nodeB) throw new Error("missing loop nodes");
    expect(measureRoutePath({ snapshot, netId: 1, endpointNodeA: nodeA.nodeId, endpointNodeB: nodeB.nodeId }).status).toBe("ambiguous_path");
  });

  it("tunes native segments deterministically and reports corridor capacity", () => {
    const source = track("tune", 1, p(10, 10), p(30, 10));
    const input = { track: source, deltaNm: mmToNm(1), corridor: { minX: p(9, 0).x, minY: p(9, 5).y, maxX: p(31, 0).x, maxY: p(31, 15).y }, pitchNm: mmToNm(20), maximumAmplitudeNm: mmToNm(5), selfSpacingNm: mmToNm(0.2), candidateKey: "tune:r8" };
    const a = tuneStraightTrack(input); const b = tuneStraightTrack(input);
    expect(a.status).toBe("feasible");
    expect(a.replacementTracks.map((item) => item.id)).toEqual(b.replacementTracks.map((item) => item.id));
    expect(Math.abs(a.residualNm)).toBeLessThan(5);
    expect(tuneStraightTrack({ ...input, corridor: { minX: p(10, 0).x, minY: p(10, 9.9).y, maxX: p(30, 0).x, maxY: p(30, 10.1).y } }).status).toBe("insufficient_capacity");
  });

  it("fails shove explicitly at protected copper and retains springback evidence", () => {
    const value = board();
    const obstacle = track("protected", 2, p(20, 5), p(20, 15), "imported");
    value.tracks = [obstacle];
    const result = solveBoundedShove({ snapshot: buildRoutingSnapshot(value), request: request({ routeMode: "shove", mutationScope: { kind: "selected_objects", objectIds: ["track:protected"] }, preservePolicy: "selected_manual_movable" }), head: [track("head", 1, p(10, 10), p(30, 10))], clearanceNm: mmToNm(0.2), maximumDisplacementNm: mmToNm(2) });
    expect(result.status).toBe("infeasible");
    expect(result.dependencyChain).toContain("track:protected");
  });

  it("does not infer differential pairs from names", () => {
    const value = board();
    value.nets[1].name = "USB_DP"; value.nets[2].name = "USB_DM";
    expect(resolveDifferentialPair(buildRoutingSnapshot(value), "pair:usb").state).toBe("unresolved");
  });

  it("exposes stable-ID-only provider-neutral AI routing tools", () => {
    const names = PCB_AI_TOOLS.map((tool) => tool.name);
    expect(names).toContain("get_routing_snapshot");
    expect(names).toContain("preview_route_connection");
    const schema = PCB_AI_TOOLS.find((tool) => tool.name === "preview_route_connection")?.inputSchema as { properties?: Record<string, unknown> };
    expect(schema.properties).not.toHaveProperty("start");
    expect(schema.properties).not.toHaveProperty("end");
    expect(schema.properties).not.toHaveProperty("points");
    const value = board(); value.footprints = [part("a", 10, 10, 1), part("b", 30, 10, 1)];
    const service = new ProfessionalRoutingService(() => value);
    const anchors = service.anchors({ netId: 1 }).filter((anchor) => anchor.contactKind === "pad_contact");
    const result = service.previewConnection({ startAnchorId: anchors[0].anchorId, endAnchorId: anchors[1].anchorId, posture: "arbitrary", actorId: "ai-test", actorKind: "ai" });
    expect(result.selectedCandidate?.request.requestedBy.kind).toBe("ai");
    expect(value.tracks).toHaveLength(0);
  });

  it("declares all 18 required corpus contracts with stable unique digests", () => {
    expect(REQUIRED_ROUTING_CORPUS).toHaveLength(18);
    expect(new Set(REQUIRED_ROUTING_CORPUS.map((fixture) => fixture.fixtureId)).size).toBe(18);
    for (const fixture of REQUIRED_ROUTING_CORPUS) {
      expect(fixture.expectedFailures.length).toBeGreaterThan(0);
      expect(fixture.deterministicDigestPolicy).toContain("engine-version");
      expect(fixture.fixtureId).toMatch(/^routing-fixture:[0-9a-f]+$/);
    }
  });
});
