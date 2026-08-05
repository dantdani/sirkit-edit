import { describe, expect, it } from "vitest";
import { compileConstraintProgram } from "../compiler";
import { mergeConstraintCandidates } from "../merge";
import { resolveSelector } from "../selectors";
import { canonicalConstraintJson } from "../stable";
import { compilationInput, definition, document, quantity, targets } from "./fixtures";

describe("Stage 6 deterministic selectors", () => {
  it("binds stable identity across rename and rejects empty/ambiguous cardinality", () => {
    const exact = { objectType: "net" as const, predicate: { kind: "ids" as const, ids: ["net:gnd"] }, cardinality: { kind: "exactly" as const, count: 1 } };
    const before = resolveSelector({ constraintId: "c:selector", selector: exact, targets, relationships: [], designRevision: "d1" });
    const renamed = targets.map((target) => target.id === "net:gnd" ? { ...target, name: "POWER_RETURN" } : target);
    const after = resolveSelector({ constraintId: "c:selector", selector: exact, targets: renamed, relationships: [], designRevision: "d2" });
    expect(before.snapshot.targetIds).toEqual(["net:gnd"]);
    expect(after.snapshot.targetIds).toEqual(["net:gnd"]);

    const empty = resolveSelector({ constraintId: "c:empty", selector: { ...exact, predicate: { kind: "ids", ids: ["net:missing"] } }, targets, relationships: [], designRevision: "d1" });
    expect(empty.snapshot.state).toBe("unresolved");
    expect(empty.diagnostics).toHaveLength(1);

    const ambiguous = resolveSelector({ constraintId: "c:ambiguous", selector: { objectType: "net", predicate: { kind: "tag", tag: "usb" }, cardinality: { kind: "exactly", count: 1 } }, targets, relationships: [], designRevision: "d1" });
    expect(ambiguous.snapshot.state).toBe("ambiguous");
  });
});

describe("Stage 6 restrictive merge algebra", () => {
  const merge = (...constraints: ReturnType<typeof definition>[]) => mergeConstraintCandidates(constraints.map((item) => ({ definition: item, targetId: "net:gnd", conditionState: "true" })));

  it("combines minima, maxima, ranges, sets, prohibitions, and soft objectives by explicit algebra", () => {
    const minimum = merge(
      definition({ id: "c:min15", kind: "trace_width", requirement: { form: "minimum", value: quantity("length", "0.15", "mm") } }),
      definition({ id: "c:min20", kind: "trace_width", requirement: { form: "minimum", value: quantity("length", "0.20", "mm") } }),
    );
    expect(minimum.conflicts).toEqual([]);
    expect(minimum.rules[0].requirement).toEqual({ form: "minimum", value: quantity("length", "0.20", "mm") });

    const range = merge(
      definition({ id: "c:r1", kind: "voltage_operating_range", domain: "component", requirement: { form: "range", min: quantity("voltage", "2.7", "V"), max: quantity("voltage", "3.6", "V"), minInclusive: true, maxInclusive: true } }),
      definition({ id: "c:r2", kind: "voltage_operating_range", domain: "application", requirement: { form: "range", min: quantity("voltage", "3.0", "V"), max: quantity("voltage", "3.3", "V"), minInclusive: true, maxInclusive: true } }),
    );
    expect(range.rules[0].requirement).toEqual(expect.objectContaining({ form: "range", min: quantity("voltage", "3.0", "V"), max: quantity("voltage", "3.3", "V") }));

    const allowed = merge(
      definition({ id: "c:a1", kind: "allowed_layers", domain: "routing", requirement: { form: "allowed_set", values: ["layer:top", "layer:inner1", "layer:bottom"] } }),
      definition({ id: "c:a2", kind: "allowed_layers", domain: "routing", requirement: { form: "allowed_set", values: ["layer:top", "layer:bottom"] } }),
    );
    expect(allowed.rules[0].requirement).toEqual({ form: "allowed_set", values: ["layer:bottom", "layer:top"] });

    const forbidden = merge(
      definition({ id: "c:f1", kind: "forbidden_layers", domain: "routing", requirement: { form: "forbidden_set", values: ["layer:inner1"] } }),
      definition({ id: "c:f2", kind: "forbidden_layers", domain: "routing", requirement: { form: "forbidden_set", values: ["layer:inner2"] } }),
    );
    expect(forbidden.rules[0].requirement).toEqual({ form: "forbidden_set", values: ["layer:inner1", "layer:inner2"] });

    const soft = merge(
      definition({ id: "c:soft1", kind: "placement_proximity", domain: "placement", strength: "soft", requirement: { form: "objective", direction: "minimize", metric: "distance", weight: "1" } }),
      definition({ id: "c:soft2", kind: "placement_proximity", domain: "placement", strength: "soft", requirement: { form: "objective", direction: "minimize", metric: "ratsnest", weight: "2" } }),
    );
    expect(soft.rules).toHaveLength(2);
  });

  it("reports stable minimal conflicts and is independent of source order", () => {
    const left = definition({ id: "c:left", kind: "trace_width", requirement: { form: "minimum", value: quantity("length", "0.30", "mm") } });
    const right = definition({ id: "c:right", kind: "trace_width", requirement: { form: "maximum", value: quantity("length", "0.20", "mm") } });
    const a = merge(left, right);
    const b = merge(right, left);
    expect(a.conflicts[0].code).toBe("EMPTY_NUMERIC_FEASIBLE_RANGE");
    expect(a.conflicts[0].constraintIds).toEqual(["c:left", "c:right"]);
    expect(canonicalConstraintJson(a)).toBe(canonicalConstraintJson(b));

    const disjoint = merge(
      definition({ id: "c:set1", kind: "allowed_layers", domain: "routing", requirement: { form: "allowed_set", values: ["layer:top"] } }),
      definition({ id: "c:set2", kind: "allowed_layers", domain: "routing", requirement: { form: "allowed_set", values: ["layer:bottom"] } }),
    );
    expect(disjoint.conflicts[0].code).toBe("EMPTY_ALLOWED_SET");
  });
});

describe("Stage 6 immutable compiler", () => {
  it("produces deterministic program identity, target snapshots, physical lowering, and honest unsupported coverage", () => {
    const constraints = [
      definition({ id: "c:fab-width", kind: "trace_width", requirement: { form: "minimum", value: quantity("length", "0.15", "mm") } }),
      definition({ id: "c:net-width", kind: "trace_width", domain: "routing", requirement: { form: "minimum", value: quantity("length", "0.20", "mm") } }),
      definition({ id: "c:impedance", kind: "target_impedance", domain: "routing", requirement: { form: "target", value: quantity("impedance", "90", "Ohm"), toleranceMinus: quantity("impedance", "9", "Ohm"), tolerancePlus: quantity("impedance", "9", "Ohm") } }),
    ];
    const first = compileConstraintProgram(compilationInput([document(constraints)]));
    const second = compileConstraintProgram(compilationInput([document([...constraints].reverse())]));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.program.programHash).toBe(second.program.programHash);
    expect(first.program.lowerings.physicalByTarget["net:gnd"].minTrackWidthNm).toBe(200_000);
    expect(first.program.lowerings.physicalByTarget["net:gnd"].constraintIds).toEqual(["c:fab-width", "c:net-width"]);
    expect(first.program.coverage.find((item) => item.constraintId === "c:impedance")).toEqual(expect.objectContaining({ support: "unsupported", readinessImpact: "verification_incomplete", laterStage: 8 }));
  });

  it("does not silently deactivate unknown hard conditions or partially activate invalid selectors/conflicts", () => {
    const conditional = definition({ id: "c:conditional", kind: "trace_width", condition: { kind: "fact_truth", factId: "fact:mode" }, requirement: { form: "minimum", value: quantity("length", "0.2", "mm") } });
    const unknown = compileConstraintProgram(compilationInput([document([conditional])]));
    expect(unknown.ok).toBe(true);
    if (unknown.ok) {
      expect(unknown.program.coverage[0].support).toBe("unknown");
      expect(unknown.program.diagnostics.some((item) => item.code === "CONSTRAINT_CONDITION_UNKNOWN")).toBe(true);
      expect(unknown.program.lowerings.physicalByTarget).toEqual({});
    }

    const empty = definition({ id: "c:empty", kind: "clearance", selector: { objectType: "net", predicate: { kind: "ids", ids: ["net:missing"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "minimum", value: quantity("length", "0.2", "mm") } });
    const rejected = compileConstraintProgram(compilationInput([document([empty])]));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.diagnostics.some((item) => item.code === "SELECTOR_ID_UNRESOLVED")).toBe(true);
  });

  it("requires explicit differential-pair polarity and stable relationship members", () => {
    const set = document([], { relationships: [{ id: "relation:usb", revision: 1, kind: "differential_pair", members: [{ role: "positive", targetType: "net", targetId: "net:usb-p" }, { role: "positive", targetType: "net", targetId: "net:usb-n" }], origin: { kind: "project", sourceId: "source:fixture", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" }] });
    const result = compileConstraintProgram(compilationInput([set]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some((item) => item.code === "DIFFERENTIAL_PAIR_POLARITY_INVALID")).toBe(true);
  });
});
