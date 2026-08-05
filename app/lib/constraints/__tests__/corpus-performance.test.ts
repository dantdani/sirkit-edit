import { describe, expect, it } from "vitest";
import { ConstraintCompilerCache } from "../cache";
import { compileConstraintProgram } from "../compiler";
import { STAGE6_CONSTRAINT_CORPUS } from "../corpus";
import { importKicadDru } from "../kicad-dru";
import type {
  ConstraintCompilationInput,
  ConstraintDefinition,
  ConstraintDocument,
  ConstraintObjectType,
  ConstraintTarget,
} from "../types";
import { definition, document, quantity } from "./fixtures";

function target(id: string, type: ConstraintObjectType): ConstraintTarget {
  return { id, type, revision: `revision:${id}`, name: id, parentIds: ["project:corpus"], tags: [], attributes: {} };
}

function targetsFor(documentValue: ConstraintDocument): ConstraintTarget[] {
  const byId = new Map<string, ConstraintTarget>();
  byId.set("project:corpus", target("project:corpus", "project"));
  for (const constraint of documentValue.constraints) {
    if (constraint.selector.predicate.kind !== "ids") continue;
    for (const id of constraint.selector.predicate.ids) byId.set(id, target(id, constraint.selector.objectType));
  }
  for (const relationship of documentValue.relationships) {
    for (const member of relationship.members) if (!byId.has(member.targetId)) byId.set(member.targetId, target(member.targetId, member.targetType));
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function inputFor(documentValue: ConstraintDocument): ConstraintCompilationInput {
  return {
    documents: [documentValue],
    targets: targetsFor(documentValue),
    facts: [{ id: "variant:population", value: "production", state: "known", evidenceIds: ["evidence:variant"] }],
    designRevision: "design:corpus:1",
    catalogRevision: "catalog:corpus:1",
    variantRevision: "variant:production:1",
    manufacturingProfileRevision: "fab:corpus:1",
    supportRegistry: {},
  };
}

describe("original Stage 6 design corpus", () => {
  it("covers ten distinct designs, compiles the valid fixtures, and diagnoses the deliberate conflict", () => {
    expect(STAGE6_CONSTRAINT_CORPUS).toHaveLength(10);
    expect(new Set(STAGE6_CONSTRAINT_CORPUS.map((item) => item.scenario)).size).toBe(10);

    for (const scenario of STAGE6_CONSTRAINT_CORPUS) {
      if (!("document" in scenario)) continue;
      const compiled = compileConstraintProgram(inputFor(scenario.document));
      if (scenario.scenario === "deliberate-hierarchy-conflict") {
        expect(compiled.ok, scenario.scenario).toBe(false);
        if (!compiled.ok) expect(compiled.conflicts.map((item) => item.code)).toContain("EMPTY_NUMERIC_FEASIBLE_RANGE");
      } else {
        expect(compiled.ok, `${scenario.scenario}: ${compiled.diagnostics.map((item) => item.code).join(", ")}`).toBe(true);
        if (compiled.ok) expect(compiled.program.activeConstraintIds.length).toBeGreaterThan(0);
      }
    }
  });

  it("imports the mixed KiCad fixture without hiding the unsupported rule", () => {
    const scenario = STAGE6_CONSTRAINT_CORPUS.find((item) => item.scenario === "kicad-supported-and-unsupported");
    expect(scenario && "kicadDru" in scenario).toBe(true);
    if (!scenario || !("kicadDru" in scenario)) return;
    const imported = importKicadDru({
      text: scenario.kicadDru,
      sourceId: "corpus.kicad_dru",
      sourceRevision: "sha:corpus",
      netNameToStableIds: { GND: ["net:gnd"] },
    });
    expect(imported.ok).toBe(true);
    expect(imported.document?.constraints).toHaveLength(1);
    expect(imported.losses).toEqual(expect.arrayContaining([expect.objectContaining({ disposition: "unsupported", severity: "error" })]));
  });
});

function largeCompilationInput(count: number): ConstraintCompilationInput {
  const targets: ConstraintTarget[] = [target("project:performance", "project")];
  const constraints: ConstraintDefinition[] = [];
  for (let index = 0; index < count; index += 1) {
    const netId = `net:performance:${index.toString().padStart(4, "0")}`;
    targets.push({ ...target(netId, "net"), parentIds: ["project:performance"] });
    constraints.push(definition({
      id: `constraint:performance:${index.toString().padStart(4, "0")}`,
      kind: index % 2 === 0 ? "trace_width" : "clearance",
      selector: { objectType: "net", predicate: { kind: "ids", ids: [netId] }, cardinality: { kind: "exactly", count: 1 } },
      requirement: { form: "minimum", value: quantity("length", index % 2 === 0 ? "0.2" : "0.15", "mm") },
    }));
  }
  return {
    documents: [document(constraints, { id: "constraint-set:performance" })],
    targets,
    facts: [],
    designRevision: "design:performance:1",
    catalogRevision: "catalog:performance:1",
    variantRevision: "variant:performance:1",
    manufacturingProfileRevision: "fab:performance:1",
    supportRegistry: {},
  };
}

describe("constraint compiler resource behavior", () => {
  it("compiles 1,000 independently targeted hard rules deterministically within a bounded budget", () => {
    const input = largeCompilationInput(1_000);
    const started = performance.now();
    const first = compileConstraintProgram(input);
    const elapsedMs = performance.now() - started;
    expect(first.ok).toBe(true);
    expect(elapsedMs).toBeLessThan(15_000);
    if (!first.ok) return;
    expect(first.program.effectiveRules).toHaveLength(1_000);

    const reordered: ConstraintCompilationInput = {
      ...input,
      documents: [{ ...input.documents[0], constraints: [...input.documents[0].constraints].reverse() }],
      targets: [...input.targets].reverse(),
    };
    const second = compileConstraintProgram(reordered);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.program.programHash).toBe(first.program.programHash);
  }, 20_000);

  it("uses semantic cache keys and invalidates on every authoritative revision input", () => {
    const input = largeCompilationInput(24);
    const cache = new ConstraintCompilerCache(2);
    const first = cache.compile(input);
    const repeated = cache.compile({ ...input });
    expect(repeated).toBe(first);
    expect(cache.stats()).toEqual({ entries: 1, hits: 1, misses: 1 });

    const changed = cache.compile({ ...input, manufacturingProfileRevision: "fab:performance:2" });
    expect(changed.ok).toBe(true);
    expect(cache.stats()).toEqual({ entries: 2, hits: 1, misses: 2 });
    if (first.ok && changed.ok) expect(changed.program.programHash).not.toBe(first.program.programHash);

    cache.compile({ ...input, designRevision: "design:performance:2" });
    expect(cache.stats()).toEqual({ entries: 2, hits: 1, misses: 3 });
  });
});
