import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { getNetClass } from "@/app/lib/pcb/netclass";
import { resolveRoutingProfile } from "@/app/lib/pcb/routing-profile";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { zoneFillInputRevision } from "@/app/lib/pcb/zones/fill-lifecycle";
import { migrateBoardConstraintState } from "../legacy";
import { compileManufacturingConstraintProgram } from "../manufacturing";
import { applyConstraintTransaction, previewConstraintTransaction } from "../transactions";
import { definition, document, quantity } from "./fixtures";

function legacyBoard() {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] });
  board.netClassing = {
    version: 1,
    base: { 1: { classId: "Power", explanation: "Named GND — matches power-net convention" } },
    assignments: { 1: { classId: "Power", explanation: "Explicit project requirement", override: { trackWidth: 600_000, clearance: 250_000 } } },
    ruleDeltas: [{
      id: "delta:manual",
      createdAt: "2026-07-17T00:00:00.000Z",
      source: "manual",
      explanation: "User approved wider ground routing",
      changes: [{ trackWidthNm: 600_000, clearanceNm: 250_000, appliesTo: { kind: "nets", netIds: [1] } }],
    }],
  };
  return board;
}

describe("Stage 6 legacy migration and live consumers", () => {
  it("migrates idempotently, keeps heuristic classes proposed, and compiles explicit values without latest-wins", () => {
    const first = migrateBoardConstraintState(legacyBoard(), "project:fixture");
    expect(first.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(first.board.constraintState?.activeProgram).toBeDefined();
    const compiled = getNetClass(first.board, 1);
    expect(compiled.trackWidth).toBe(600_000);
    expect(compiled.clearance).toBe(250_000);
    expect(compiled.constraintIds).toEqual(expect.arrayContaining(["legacy:delta:delta:manual:0:trace_width", "legacy:assignment:1:trace_width"]));
    expect(first.board.constraintState?.activeProgram?.diagnostics.some((item) => item.code === "INFERENCE_REQUIRES_REVIEW")).toBe(true);

    const historyLength = first.board.constraintState?.history.length;
    const second = migrateBoardConstraintState(first.board, "project:fixture");
    expect(second.board.constraintState?.activeProgram?.programHash).toBe(first.board.constraintState?.activeProgram?.programHash);
    expect(second.board.constraintState?.history.length).toBe(historyLength);
  });

  it("prevents custom route width/via choices from weakening compiled hard minima", () => {
    const { board } = migrateBoardConstraintState(legacyBoard(), "project:fixture");
    board.routingPreferences = { version: 1, trackWidthMode: "custom", customTrackWidthNm: 100_000, viaMode: "net-class" };
    const profile = resolveRoutingProfile(board, 1);
    expect(profile.trackWidth).toBe(600_000);
    expect(profile.widthSource).toBe("net-class");
    expect(profile.explanation).toMatch(/below the compiled/);
  });

  it("binds DRC violations to exact compiled and manufacturing rule lineage", () => {
    const migrated = migrateBoardConstraintState(legacyBoard(), "project:fixture").board;
    migrated.tracks.push({ id: "thin", layer: "copperTop", width: 100_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 });
    const result = runDrc(migrated, getPreset("jlcpcb-2l").rules, { presetId: "jlcpcb-2l" });
    const violation = result.violations.find((item) => item.kind === "minTrackWidth");
    expect(violation).toBeDefined();
    expect(violation?.thresholdNm).toBeGreaterThanOrEqual(600_000);
    expect(violation?.constraintIds).toEqual(expect.arrayContaining([expect.stringMatching(/^manufacturing-rule:/), "legacy:delta:delta:manual:0:trace_width"]));
    expect(violation?.constraintProgramHash).toBe(migrated.constraintState?.activeProgram?.programHash);
    expect(violation?.ruleResolutionHash).toBe(result.ruleResolutionHash);
  });

  it("includes the active program in zone-fill invalidation identity", () => {
    const migrated = migrateBoardConstraintState(legacyBoard(), "project:fixture").board;
    const before = zoneFillInputRevision(migrated);
    migrated.constraintState!.activeProgram = { ...migrated.constraintState!.activeProgram!, programHash: "c6-changed" };
    expect(zoneFillInputRevision(migrated)).not.toBe(before);
  });

  it("compiles the selected manufacturing profile into the same program and never permits a weaker project minimum", () => {
    const board = migrateBoardConstraintState(legacyBoard(), "project:fixture").board;
    const weak = definition({ id: "c:weak-project-min", kind: "trace_width", requirement: { form: "minimum", value: quantity("length", "0.05", "mm") } });
    const documents = [...board.constraintState!.documents, document([weak], { id: "constraint-set:weak" })];
    const preview = previewConstraintTransaction({ board, projectId: "project:fixture", documents });
    const applied = applyConstraintTransaction({ board, projectId: "project:fixture", preview, actorId: "user:fixture" });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const preset = getPreset("jlcpcb-2l");
    const compilation = compileManufacturingConstraintProgram({ board: applied.board, projectId: "project:fixture", preset });
    expect(compilation.ok).toBe(true);
    if (!compilation.ok) return;
    expect(compilation.program.lowerings.physicalByTarget["net:gnd"].minTrackWidthNm).toBeGreaterThanOrEqual(preset.rules.default.minTrackWidthNm);
    expect(compilation.program.manufacturingProfileRevision).not.toBe("manufacturing:unbound");
    expect(compilation.program.effectiveRules.find((rule) => rule.kind === "trace_width" && rule.targetId === "net:gnd")?.contributingConstraintIds).toEqual(expect.arrayContaining(["c:weak-project-min", expect.stringMatching(/^manufacturing:jlcpcb-2l:/)]));
  });

  it("surfaces an impossible project maximum versus manufacturing minimum as a compile conflict", () => {
    const board = migrateBoardConstraintState(legacyBoard(), "project:fixture").board;
    const impossible = definition({ id: "c:impossible-max", kind: "trace_width", requirement: { form: "maximum", value: quantity("length", "0.05", "mm") } });
    board.constraintState!.documents.push(document([impossible], { id: "constraint-set:impossible" }));
    const compilation = compileManufacturingConstraintProgram({ board, projectId: "project:fixture", preset: getPreset("jlcpcb-2l") });
    expect(compilation.ok).toBe(false);
    if (!compilation.ok) expect(compilation.conflicts.some((item) => item.code === "EMPTY_NUMERIC_FEASIBLE_RANGE" && item.constraintIds.includes("c:impossible-max"))).toBe(true);
  });
});
