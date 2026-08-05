import { describe, expect, it } from "vitest";
import { createEmptyBoard, type FootprintInstance } from "@/app/lib/pcb/types";
import { boardConstraintTargetRevision, boardConstraintTargets } from "../board-model";
import { compileConstraintProgram } from "../compiler";
import { inferDifferentialPairCandidates } from "../inference";
import { runPhysicalConstraintChecks } from "../physical-checker";
import { definition, document, quantity } from "./fixtures";

function routingBoard() {
  const board = createEmptyBoard();
  board.nets.push(
    { id: 1, name: "USB_D_P", stableId: "net:usb-p", endpointKeys: [] },
    { id: 2, name: "USB_D_N", stableId: "net:usb-n", endpointKeys: [] },
  );
  board.tracks.push(
    { id: "p", layer: "copperBottom", width: 200_000, start: { x: 0, y: 0 }, end: { x: 10_000_000, y: 0 }, netId: 1 },
    { id: "n", layer: "copperTop", width: 200_000, start: { x: 0, y: 1_000_000 }, end: { x: 8_000_000, y: 1_000_000 }, netId: 2 },
  );
  board.vias.push({ id: "v1", at: { x: 5_000_000, y: 0 }, size: 800_000, drill: 400_000, netId: 1, layers: ["copperTop", "copperBottom"] });
  return board;
}

describe("Stage 6 routing/high-speed static coverage", () => {
  it("checks per-net layers, via counts/types, route length, and pair skew while leaving impedance unsupported", () => {
    const board = routingBoard();
    const pair = {
      id: "pair:usb",
      revision: 1,
      kind: "differential_pair" as const,
      members: [
        { role: "positive", targetType: "net" as const, targetId: "net:usb-p", order: 0 },
        { role: "negative", targetType: "net" as const, targetId: "net:usb-n", order: 1 },
      ],
      origin: { kind: "user" as const, sourceId: "source:user", sourceRevision: "1" },
      evidenceIds: [],
      lifecycle: "active" as const,
    };
    const constraints = [
      definition({ id: "c:layers", kind: "allowed_layers", domain: "routing", selector: { objectType: "net", predicate: { kind: "ids", ids: ["net:usb-p"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "allowed_set", values: ["layer:copperTop"] } }),
      definition({ id: "c:vias", kind: "via_count", domain: "routing", selector: { objectType: "net", predicate: { kind: "ids", ids: ["net:usb-p"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "maximum", value: quantity("dimensionless", "0", "1") } }),
      definition({ id: "c:via-type", kind: "via_type", domain: "routing", selector: { objectType: "net", predicate: { kind: "ids", ids: ["net:usb-p"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "allowed_set", values: ["through"] } }),
      definition({ id: "c:length", kind: "route_length", domain: "routing", selector: { objectType: "net", predicate: { kind: "ids", ids: ["net:usb-p"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "maximum", value: quantity("length", "5", "mm") } }),
      definition({ id: "c:skew", kind: "pair_skew", domain: "routing", selector: { objectType: "differential_pair", predicate: { kind: "ids", ids: ["pair:usb"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "maximum", value: quantity("length", "1", "mm") } }),
      definition({ id: "c:impedance", kind: "target_impedance", domain: "routing", selector: { objectType: "differential_pair", predicate: { kind: "ids", ids: ["pair:usb"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "target", value: quantity("impedance", "90", "Ohm"), toleranceMinus: quantity("impedance", "9", "Ohm"), tolerancePlus: quantity("impedance", "9", "Ohm") } }),
    ];
    const result = compileConstraintProgram({
      documents: [document(constraints, { relationships: [pair] })],
      targets: boardConstraintTargets(board, "fixture"),
      facts: [],
      designRevision: boardConstraintTargetRevision(board, "fixture"),
      catalogRevision: "catalog:1",
      variantRevision: "variant:1",
      manufacturingProfileRevision: "fab:1",
      supportRegistry: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.coverage.find((item) => item.constraintId === "c:impedance")?.support).toBe("unsupported");
    const checks = runPhysicalConstraintChecks({ program: result.program, board, designRevision: result.program.designRevision });
    const states = Object.fromEntries(checks.map((item) => [item.constraintId, item.state]));
    expect(states).toEqual({ "c:layers": "fail", "c:length": "fail", "c:skew": "fail", "c:via-type": "pass", "c:vias": "fail" });
    expect(checks.some((item) => item.constraintId === "c:impedance")).toBe(false);
  });

  it("keeps name-based differential pair recognition as a review-only proposal", () => {
    const board = routingBoard();
    const proposals = inferDifferentialPairCandidates(board);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toEqual(expect.objectContaining({ status: "proposed", confidence: 0.35 }));
    expect(proposals[0].relationship.lifecycle).toBe("draft");
    board.nets.find((net) => net.id === 2)!.name = "USB_ENABLE";
    expect(inferDifferentialPairCandidates(board)).toEqual([]);
  });
});

describe("Stage 6 placement static coverage", () => {
  it("checks fixed, side, orientation, and region constraints without claiming Stage 7 optimization", () => {
    const board = createEmptyBoard();
    const footprint: FootprintInstance = {
      id: "U1",
      ref: "U1",
      footprintId: "Fixture:QFN",
      def: { libName: "Fixture", name: "QFN", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: -1_000_000, minY: -1_000_000, maxX: 1_000_000, maxY: 1_000_000 }, models: [], rawSexpr: "" },
      at: { x: 20_000_000, y: 20_000_000 },
      rotationDeg: 90,
      side: "bottom",
      padNets: {},
      locked: false,
    };
    board.footprints.push(footprint);
    const selector = { objectType: "component" as const, predicate: { kind: "ids" as const, ids: ["component:U1"] }, cardinality: { kind: "exactly" as const, count: 1 } };
    const constraints = [
      definition({ id: "c:fixed", kind: "placement_fixed", domain: "placement", selector, requirement: { form: "equals", value: true } }),
      definition({ id: "c:side", kind: "placement_side", domain: "placement", selector, requirement: { form: "allowed_set", values: ["top"] } }),
      definition({ id: "c:rotation", kind: "placement_orientation", domain: "placement", selector, requirement: { form: "allowed_set", values: ["0", "180"] } }),
      definition({ id: "c:region", kind: "placement_region", domain: "placement", selector, requirement: { form: "containment", regionIds: ["region:safe"], mode: "inside" } }),
    ];
    const result = compileConstraintProgram({ documents: [document(constraints)], targets: boardConstraintTargets(board, "fixture"), facts: [], designRevision: boardConstraintTargetRevision(board, "fixture"), catalogRevision: "c", variantRevision: "v", manufacturingProfileRevision: "f", supportRegistry: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const checks = runPhysicalConstraintChecks({ program: result.program, board, designRevision: result.program.designRevision, regions: [{ id: "region:safe", polygon: [{ x: 0, y: 0 }, { x: 10_000_000, y: 0 }, { x: 10_000_000, y: 10_000_000 }, { x: 0, y: 10_000_000 }] }] });
    expect(Object.fromEntries(checks.map((item) => [item.constraintId, item.state]))).toEqual({ "c:fixed": "fail", "c:region": "fail", "c:rotation": "fail", "c:side": "fail" });
  });
});
