import { describe, expect, it } from "vitest";
import { ARCHITECTURE_CORPUS, buildArchitectureCorpusProblem, executeArchitectureBenchmark } from "../corpus";
import { validateArchitectureProblem } from "../problem";

describe("CD-2 governed architecture corpus", () => {
  it("contains twenty unique, stratified fixtures", () => { expect(ARCHITECTURE_CORPUS).toHaveLength(20); expect(new Set(ARCHITECTURE_CORPUS.map((item) => item.fixtureId)).size).toBe(20); expect(new Set(ARCHITECTURE_CORPUS.map((item) => item.partition))).toEqual(new Set(["publicDevelopment", "validation", "hiddenHoldout", "stress"])); });
  it("builds integrity-valid accepted architecture problems", () => { expect(ARCHITECTURE_CORPUS.flatMap((item) => validateArchitectureProblem(buildArchitectureCorpusProblem(item)))).toEqual([]); });
  it("does not use hidden holdouts for tuning", () => { expect(executeArchitectureBenchmark("architecture_problem_corpus")).toMatchObject({ fixtureCount: 20, invalidProblems: 0, hiddenUsedForTuning: false }); });
  it("compiles three structurally distinct alternatives", () => { expect(executeArchitectureBenchmark("architecture_alternatives")).toEqual({ candidateCount: 3, distinctStructures: 3, compileFailures: 0 }); });
  it("covers every hard requirement with non-root allocation", () => { expect(executeArchitectureBenchmark("architecture_coverage")).toEqual({ uncoveredHard: 0, rootOnlyAccepted: false }); });
  it("rejects concrete implementation leakage", () => { expect(executeArchitectureBenchmark("architecture_adversarial_schema")).toEqual({ forbiddenImplementationAccepted: false, diagnostics: 1 }); });
});
