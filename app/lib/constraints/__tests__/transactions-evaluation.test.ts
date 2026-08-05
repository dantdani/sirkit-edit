import { describe, expect, it } from "vitest";
import { createEmptyBoard, type Zone } from "@/app/lib/pcb/types";
import { compileConstraintProgram } from "../compiler";
import { evaluateConstraintProgram } from "../evaluation";
import { migrateBoardConstraintState } from "../legacy";
import { applyConstraintTransaction, previewConstraintTransaction, revertConstraintProgram } from "../transactions";
import { createConstraintWaiver } from "../waiver";
import { constraintReadinessCheck } from "@/app/lib/pcb/readiness/evaluate";
import { constraintProgramIntegrityErrors } from "../compiler";
import { validateConstraintProgramPersistence } from "../server-repository";
import type { ConstraintViolation } from "../types";
import { compilationInput, definition, document, quantity } from "./fixtures";

function boardWithProgram() {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] });
  const zone: Zone = {
    id: "z1",
    layer: "copperTop",
    netId: 1,
    polygon: [{ x: 0, y: 0 }, { x: 10_000_000, y: 0 }, { x: 10_000_000, y: 10_000_000 }],
    appearance: "solid",
    connection: "thermal",
    fill: [],
    dirty: false,
  };
  board.zones.push(zone);
  return migrateBoardConstraintState(board, "fixture").board;
}

describe("Stage 6 atomic constraint transactions", () => {
  it("previews target/effective changes, atomically activates, invalidates derived fill, and restores an exact prior program", () => {
    const board = boardWithProgram();
    const originalHash = board.constraintState!.activeProgram!.programHash;
    const projectRule = definition({ id: "c:project-width", kind: "trace_width", requirement: { form: "minimum", value: quantity("length", "0.45", "mm") } });
    const documents = [...board.constraintState!.documents, document([projectRule], { id: "constraint-set:user" })];
    const preview = previewConstraintTransaction({ board, projectId: "fixture", documents });
    expect(preview.compilation.ok).toBe(true);
    expect(preview.effectiveRuleChanges.length).toBeGreaterThan(0);

    const applied = applyConstraintTransaction({ board, projectId: "fixture", preview, actorId: "user:fixture" });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.board.constraintState?.activeProgram?.programHash).not.toBe(originalHash);
    expect(applied.board.zones[0].dirty).toBe(true);
    expect(applied.board.zones[0].fillState?.sourceRevision).toContain("constraint-program:");

    const reverted = revertConstraintProgram({ board: applied.board, programHash: originalHash, actorId: "user:fixture" });
    expect(reverted.ok).toBe(true);
    if (reverted.ok) expect(reverted.board.constraintState?.activeProgram?.programHash).toBe(originalHash);
  });

  it("rejects invalid and stale previews without changing the active board", () => {
    const board = boardWithProgram();
    const hash = board.constraintState!.activeProgram!.programHash;
    const invalid = definition({ id: "c:missing", kind: "clearance", selector: { objectType: "net", predicate: { kind: "ids", ids: ["net:missing"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "minimum", value: quantity("length", "0.2", "mm") } });
    const invalidPreview = previewConstraintTransaction({ board, projectId: "fixture", documents: [document([invalid])] });
    const rejected = applyConstraintTransaction({ board, projectId: "fixture", preview: invalidPreview, actorId: "user:fixture" });
    expect(rejected).toEqual(expect.objectContaining({ ok: false, code: "INVALID_CANDIDATE" }));
    expect(board.constraintState?.activeProgram?.programHash).toBe(hash);

    const validPreview = previewConstraintTransaction({ board, projectId: "fixture", documents: board.constraintState!.documents });
    const changed = structuredClone(board);
    changed.constraintState!.activeProgram = { ...changed.constraintState!.activeProgram!, programHash: "c6-newer" };
    expect(applyConstraintTransaction({ board: changed, projectId: "fixture", preview: validPreview, actorId: "user:fixture" })).toEqual(expect.objectContaining({ ok: false, code: "STALE_BASE" }));
  });

  it("validates typed source documents inside the compiler boundary before preview or activation", () => {
    const board = boardWithProgram();
    const invalid = document([definition({ id: "c:runtime-invalid", kind: "trace_width", requirement: { form: "minimum", value: quantity("length", "0.2", "mm") } })]);
    invalid.constraints[0].condition = { kind: "eval", source: "globalThis.process" } as never;
    const preview = previewConstraintTransaction({ board, projectId: "fixture", documents: [invalid] });
    expect(preview.compilation.ok).toBe(false);
    if (!preview.compilation.ok) expect(preview.compilation.diagnostics.map((item) => item.code)).toContain("FORBIDDEN_EXPRESSION");
    expect(applyConstraintTransaction({ board, projectId: "fixture", preview, actorId: "user:fixture" })).toEqual(expect.objectContaining({ ok: false, code: "INVALID_CANDIDATE" }));
  });
});

describe("Stage 6 evaluation and waiver separation", () => {
  const trace = definition({ id: "c:trace", kind: "trace_width", waiverPolicy: { eligible: true, authorizationPolicyId: "policy:engineering" }, requirement: { form: "minimum", value: quantity("length", "0.2", "mm") } });
  const impedance = definition({ id: "c:impedance", kind: "target_impedance", domain: "routing", requirement: { form: "target", value: quantity("impedance", "90", "Ohm"), toleranceMinus: quantity("impedance", "9", "Ohm"), tolerancePlus: quantity("impedance", "9", "Ohm") } });

  function program() {
    const result = compileConstraintProgram(compilationInput([document([trace, impedance])]));
    if (!result.ok) throw new Error("fixture compilation failed");
    return result.program;
  }

  it("keeps unsupported/not-run distinct and blocks false readiness", () => {
    const compiled = program();
    const report = evaluateConstraintProgram({ program: compiled, designRevision: compiled.designRevision, results: [] });
    expect(report.states.find((item) => item.constraintId === "c:impedance")?.state).toBe("unsupported");
    expect(report.states.find((item) => item.constraintId === "c:trace")?.state).toBe("not_run");
    expect(report.readinessState).toBe("verification_incomplete");
    const fabrication = constraintReadinessCheck({ evaluation: report, revision: "pcb:1", program: compiled });
    expect(fabrication.state).toBe("not_run");
  });

  it("does not require an unrelated impedance solver for the fabrication-only readiness claim", () => {
    const compiled = program();
    const pass: ConstraintViolation = { id: "v:trace-pass", constraintId: "c:trace", targetIds: ["net:gnd"], state: "pass", consumerId: "pcb-physical-rule-resolver", checkerVersion: "stage6/1", required: trace.requirement, evidenceIds: [], message: "Width passed", nextAction: "None" };
    const report = evaluateConstraintProgram({ program: compiled, designRevision: compiled.designRevision, results: [pass] });
    expect(report.readinessState).toBe("verification_incomplete");
    expect(constraintReadinessCheck({ evaluation: report, revision: "pcb:1", program: compiled }).state).toBe("pass");
  });

  it("verifies immutable program/source identity before database persistence", () => {
    const compiled = program();
    expect(constraintProgramIntegrityErrors(compiled)).toEqual([]);
    expect(() => validateConstraintProgramPersistence(compiled, [document([trace, impedance])])).not.toThrow();
    const tampered = { ...compiled, programHash: "c6-tampered" };
    expect(constraintProgramIntegrityErrors(tampered)).toContain("program semantic hash mismatch");
    expect(() => validateConstraintProgramPersistence(tampered, [document([trace, impedance])])).toThrow(/integrity failed/);
  });

  it("keeps the underlying violation failed after an independently authorized waiver", () => {
    const compiled = program();
    const violation: ConstraintViolation = {
      id: "violation:trace",
      constraintId: "c:trace",
      targetIds: ["net:gnd"],
      state: "fail",
      consumerId: "pcb-physical-rule-resolver",
      checkerVersion: "stage6/1",
      actual: quantity("length", "0.1", "mm"),
      required: trace.requirement,
      evidenceIds: [],
      message: "Track is below the compiled minimum.",
      nextAction: "Increase trace width.",
    };
    const waiver = createConstraintWaiver({ program: compiled, designRevision: compiled.designRevision, violations: [violation], targetIds: ["net:gnd"], releaseProfileId: "prototype", reason: "Prototype exception approved", actorId: "user:requester", authorizedBy: "user:reviewer", createdAt: "2026-07-17T00:00:00.000Z" });
    const report = evaluateConstraintProgram({ program: compiled, designRevision: compiled.designRevision, results: [violation], waivers: [waiver] });
    expect(report.states.find((item) => item.constraintId === "c:trace")?.state).toBe("fail");
    expect(report.readinessState).toBe("blocked");
    expect(report.waivers.map((item) => item.id)).toEqual([waiver.id]);
  });

  it("rejects self-authorized or non-waivable release exceptions", () => {
    const compiled = program();
    const violation: ConstraintViolation = { id: "v:impedance", constraintId: "c:impedance", targetIds: ["net:gnd"], state: "fail", consumerId: "signal-integrity-solver", checkerVersion: "none", evidenceIds: [], message: "Not proven", nextAction: "Run solver" };
    expect(() => createConstraintWaiver({ program: compiled, designRevision: compiled.designRevision, violations: [violation], targetIds: ["net:gnd"], releaseProfileId: "prototype", reason: "Review required", actorId: "same", authorizedBy: "same", createdAt: "2026-07-17T00:00:00.000Z" })).toThrow(/independent/);
    expect(() => createConstraintWaiver({ program: compiled, designRevision: compiled.designRevision, violations: [violation], targetIds: ["net:gnd"], releaseProfileId: "prototype", reason: "Review required", actorId: "requester", authorizedBy: "reviewer", createdAt: "2026-07-17T00:00:00.000Z" })).toThrow(/non-waivable/);
  });
});
