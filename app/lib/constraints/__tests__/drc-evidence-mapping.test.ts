/**
 * R06 follow-up: hole/courtyard/silk constraint evidence must map from the
 * DRC engine's kind-identified geometry checks — supported coverage, honest
 * pass/fail in BOTH directions, and silk stays advisory (matching the DRC's
 * warning-severity policy) rather than overclaiming hard enforcement.
 */
import { describe, expect, it } from "vitest";
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "@/app/lib/pcb/types";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import { compileManufacturingConstraintProgram } from "../manufacturing";
import { constraintResultsFromDrc } from "../drc-adapter";
import { evaluateConstraintProgram } from "../evaluation";
import { constraintReadinessCheck } from "@/app/lib/pcb/readiness/evaluate";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { mmToNm } from "@/app/lib/pcb/units";

function chipFootprint(id: string, ref: string, xNm: number, yNm: number): FootprintInstance {
  return {
    id, ref, footprintId: `fp-${id}`,
    at: { x: xNm, y: yNm }, rotationDeg: 0, side: "top",
    padNets: {},
    def: {
      name: `fp-${id}`,
      pads: [
        { at: { x: -mmToNm(0.9), y: 0 }, type: "smd", shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1.3) }, layers: ["copperTop", "maskTop"], number: "1", rotationDeg: 0 },
        { at: { x: mmToNm(0.9), y: 0 }, type: "smd", shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1.3) }, layers: ["copperTop", "maskTop"], number: "2", rotationDeg: 0 },
      ],
      graphics: [
        { kind: "rect", start: { x: -mmToNm(1.6), y: -mmToNm(0.9) }, end: { x: mmToNm(1.6), y: mmToNm(0.9) }, layer: "courtyardTop", width: mmToNm(0.05), fill: false },
      ],
      models: [],
      bodyBBox: { minX: -mmToNm(1), minY: -mmToNm(0.6), maxX: mmToNm(1), maxY: mmToNm(0.6) },
      courtyardBBox: { minX: -mmToNm(1.6), minY: -mmToNm(0.9), maxX: mmToNm(1.6), maxY: mmToNm(0.9) },
    },
  } as unknown as FootprintInstance;
}

function evaluate(board: PcbBoard) {
  // The manufacturing document's default selector targets stable nets — a
  // board with none materializes no effective rules (matching production
  // boards, which always carry synced stable nets).
  if (!board.nets.some((net) => net.id !== 0 && net.stableId)) {
    board.nets.push({ id: 1, name: "N1", stableId: "net:test1", endpointKeys: [] });
  }
  const preset = getPreset("jlcpcb-2l");
  const compilation = compileManufacturingConstraintProgram({ board, projectId: "test", preset });
  if (!compilation.ok) throw new Error("compilation failed");
  const program = compilation.program;
  const drc = runDrc(board, preset.rules, { presetId: preset.id, constraintProgram: program });
  const evaluation = evaluateConstraintProgram({
    program,
    designRevision: program.designRevision,
    results: constraintResultsFromDrc(program, drc),
  });
  return { program, drc, evaluation, check: constraintReadinessCheck({ evaluation, revision: pcbRevisionId(board), program }) };
}

describe("DRC evidence mapping for hole/courtyard/silk constraints", () => {
  it("registers all three kinds as enforced (no more unassigned-consumer coverage)", () => {
    const board = createEmptyBoard();
    board.footprints.push(chipFootprint("a", "R1", mmToNm(30), mmToNm(30)));
    const { program } = evaluate(board);
    for (const field of ["minHoleToHoleNm", "minCourtyardClearanceNm", "minSilkPadClearanceNm"]) {
      const coverage = program.coverage.find((item) => item.constraintId.endsWith(`default:${field}`));
      expect(coverage?.support, field).toBe("enforced");
      expect(coverage?.consumerId, field).toBe("pcb-physical-rule-resolver");
    }
  });

  it("clean board: formerly-unsupported constraints now PASS with real evidence", () => {
    const board = createEmptyBoard();
    board.footprints.push(chipFootprint("a", "R1", mmToNm(30), mmToNm(30)));
    board.footprints.push(chipFootprint("b", "R2", mmToNm(40), mmToNm(30)));
    const { evaluation, check } = evaluate(board);
    const courtyard = evaluation.states.find((state) => state.constraintId.endsWith("default:minCourtyardClearanceNm"));
    expect(courtyard?.state).toBe("pass");
    expect(check.state).toBe("pass");
  });

  it("STRICT direction: overlapping courtyards FAIL the constraint and block the check", () => {
    const board = createEmptyBoard();
    // 2mm apart — courtyards (3.2mm wide) overlap.
    board.footprints.push(chipFootprint("a", "R1", mmToNm(30), mmToNm(30)));
    board.footprints.push(chipFootprint("b", "R2", mmToNm(32), mmToNm(30)));
    const { drc, evaluation, check } = evaluate(board);
    expect(drc.violations.some((violation) => violation.kind === "courtyardOverlap" && violation.severity === "error")).toBe(true);
    const courtyard = evaluation.states.find((state) => state.constraintId.endsWith("default:minCourtyardClearanceNm"));
    expect(courtyard?.state).toBe("fail");
    expect(check.state).toBe("fail");
  });

  it("silk_clearance is advisory — matching the DRC's warning-severity silk policy", () => {
    const board = createEmptyBoard();
    board.footprints.push(chipFootprint("a", "R1", mmToNm(30), mmToNm(30)));
    const { program } = evaluate(board);
    const silk = program.coverage.find((item) => item.constraintId.endsWith("default:minSilkPadClearanceNm"));
    expect(silk?.readinessImpact).toBe("advisory");
    const definitionStrengths = program.effectiveRules
      .filter((rule) => rule.kind === "silk_clearance")
      .map((rule) => rule.strength);
    for (const strength of definitionStrengths) expect(strength).toBe("advisory");
  });
});
