import { describe, expect, it } from "vitest";
import { makeFixtureCatalog, TEST_NOW } from "@/app/lib/atomic/__tests__/fixtures";
import { compileAtomicSnapshotConstraints } from "../atomic-guidance";
import { compileConstraintProgram } from "../compiler";
import { runApplicationChecks } from "../application-checker";
import { definition, document, quantity, targets } from "./fixtures";

describe("Stage 5 atomic guidance to Stage 6 application constraints", () => {
  it("binds exact published revision/evidence and keeps recommended operation separate from absolute maximum", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
    const derived = compileAtomicSnapshotConstraints({ snapshot, componentInstanceId: "U1" });
    expect(derived.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(derived.document.constraints.map((item) => item.kind)).toEqual(expect.arrayContaining(["voltage_operating_range", "voltage_absolute_maximum", "decoupling"]));
    expect(derived.document.constraints.every((item) => item.origin.sourceRevision === snapshot.atomicRevision.semanticHash)).toBe(true);
    expect(derived.document.constraints.every((item) => item.evidenceIds.includes("evidence_fixture"))).toBe(true);

    const result = compileConstraintProgram({
      documents: [derived.document],
      targets: [...targets, { id: "component:U1", type: "component", revision: "u1", name: "U1", parentIds: ["project:fixture"], tags: [], attributes: {} }],
      facts: [],
      designRevision: "design:atomic",
      catalogRevision: snapshot.atomicRevision.semanticHash,
      variantRevision: "variant:default",
      manufacturingProfileRevision: "fab:fixture",
      supportRegistry: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const checks = runApplicationChecks(result.program, {
      designRevision: result.program.designRevision,
      voltagesByTarget: { "component:U1": quantity("voltage", "5", "V") },
      railLoadsByTarget: {},
      terminals: [],
      decoupling: [],
      decouplingDataComplete: false,
      satisfiedRelationshipIds: [],
    });
    expect(checks.find((item) => item.constraintId.includes("claim_vdd_recommended"))?.state).toBe("fail");
    expect(checks.find((item) => item.constraintId.includes("claim_vdd_absmax"))?.state).toBe("pass");
    expect(checks.find((item) => item.constraintId.includes("guidance_decoupling"))?.state).toBe("unknown");
  });

  it("does not compile conflicting claims or unsupported prose into hard truth", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
    snapshot.claims[0] = { ...snapshot.claims[0], state: "conflicting" };
    snapshot.guidance.push({ id: "guidance:prose", category: "layout", status: "unsupported_prose", scope: { kind: "part" }, conditions: {}, sourceText: "Keep it nice and close.", evidenceIds: ["evidence_fixture"], executable: false });
    snapshot.atomicRevision.guidanceIds.push("guidance:prose");
    const derived = compileAtomicSnapshotConstraints({ snapshot, componentInstanceId: "U1" });
    expect(derived.document.constraints.some((item) => item.origin.sourceId === snapshot.claims[0].id)).toBe(false);
    expect(derived.document.constraints.some((item) => item.origin.sourceId === "guidance:prose")).toBe(false);
    expect(derived.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["ATOMIC_CLAIM_NOT_COMPILABLE", "ATOMIC_GUIDANCE_UNSUPPORTED"]));
  });
});

describe("representative deterministic application/ERC checks", () => {
  it("checks DNC, exposed pad, decoupling cardinality, and current budget without accepting unknowns", () => {
    const constraints = [
      definition({ id: "c:dnc", kind: "dnc_connection", domain: "application", selector: { objectType: "component", predicate: { kind: "ids", ids: ["component:U1"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "must_exist", cardinality: { kind: "at_least", count: 1 } } }),
      definition({ id: "c:epad", kind: "exposed_pad_connection", domain: "application", selector: { objectType: "component", predicate: { kind: "ids", ids: ["component:U1"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "must_exist", cardinality: { kind: "at_least", count: 1 } } }),
      definition({ id: "c:decouple", kind: "decoupling", domain: "application", selector: { objectType: "component", predicate: { kind: "ids", ids: ["component:U1"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "must_exist", cardinality: { kind: "at_least", count: 2 } } }),
      definition({ id: "c:budget", kind: "current_budget", domain: "application", selector: { objectType: "component", predicate: { kind: "ids", ids: ["component:U1"] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "budget", aggregate: "sum", limit: quantity("current", "100", "mA") } }),
    ];
    const compiled = compileConstraintProgram({
      documents: [document(constraints)],
      targets: [...targets, { id: "component:U1", type: "component", revision: "u1", parentIds: ["project:fixture"], tags: [], attributes: {} }],
      facts: [],
      designRevision: "design:application",
      catalogRevision: "catalog:1",
      variantRevision: "variant:1",
      manufacturingProfileRevision: "fab:1",
      supportRegistry: {},
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const results = runApplicationChecks(compiled.program, {
      designRevision: compiled.program.designRevision,
      voltagesByTarget: {},
      railLoadsByTarget: { "component:U1": { totalLoad: quantity("current", "120", "mA"), sourceCapacity: quantity("current", "500", "mA"), unknownLoads: 0 } },
      terminals: [
        { id: "t:dnc", componentId: "component:U1", classification: "dnc", connected: true, netStableId: "net:gnd" },
        { id: "t:epad", componentId: "component:U1", classification: "exposed_thermal", connected: false },
      ],
      decoupling: [{ id: "C1", protectedTargetId: "component:U1" }],
      decouplingDataComplete: true,
      satisfiedRelationshipIds: [],
    });
    expect(Object.fromEntries(results.map((item) => [item.constraintId, item.state]))).toEqual({ "c:budget": "fail", "c:decouple": "fail", "c:dnc": "fail", "c:epad": "fail" });
  });
});
