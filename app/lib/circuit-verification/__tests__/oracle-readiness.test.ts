import { describe, expect, it } from "vitest";
import { compileRequirementCoverage } from "../coverage";
import { compareFullAndIncrementalOracle, runIncrementalCircuitVerification } from "../incremental";
import { runFullCircuitOracle } from "../oracle";
import { evaluateCircuitReadiness } from "../readiness";
import { verificationDigest } from "../stable";
import type { SchematicSemanticDiff } from "../../schematic-compiler/types";
import { NOW, verificationFixture } from "./fixtures";

describe("CD-9 independent oracle, identity, parity, and readiness", () => {
  it("executes the complete denominator and isolates no foundational evaluator failures", () => {
    const fixture = verificationFixture();
    const run = runFullCircuitOracle({ ...fixture, startedAt: NOW });
    expect(run.runKind).toBe("full");
    expect(run.executionState).toBe("completed");
    expect(run.results).toHaveLength(fixture.denominator.instances.length);
    expect(run.executions).toHaveLength(fixture.denominator.instances.length);
  });

  it("does not turn not-applicable selectors into missing results", () => {
    const fixture = verificationFixture(), run = runFullCircuitOracle({ ...fixture, startedAt: NOW });
    const naInstances = fixture.denominator.applicability.filter((item) => item.state === "not_applicable").map((item) => item.applicabilityId);
    const resultIds = run.results.filter((item) => item.engineeringResult === "not_applicable").map((item) => item.ruleInstanceId);
    expect(resultIds.length).toBe(naInstances.length);
  });

  it("recomputes the full denominator instead of trusting a supplied cache", () => {
    const fixture = verificationFixture(), tampered = structuredClone(fixture.denominator);
    tampered.instances = tampered.instances.slice(1);
    const run = runFullCircuitOracle({ ...fixture, denominator: tampered, startedAt: NOW });
    expect(run.results).toHaveLength(fixture.denominator.instances.length);
    expect(run.diagnostics.map((item) => item.code)).toContain("CD9_DENOMINATOR_RECOMPUTE_MISMATCH");
    expect(run.executionState).toBe("completed_with_isolated_errors");
  });

  it("keeps semantic finding identity independent from display messages", () => {
    const fixture = verificationFixture([{ requirementId: "requirement:identity", revisionDigest: "req:identity:1", safetyCritical: false }]), coverage = compileRequirementCoverage({ problem: fixture.problem }), run = runFullCircuitOracle({ ...fixture, requirementCoverage: coverage, startedAt: NOW });
    const finding = run.findings[0];
    expect(finding).toBeDefined();
    const changed = structuredClone(finding);
    changed.summary = "Presentation wording changed";
    expect(changed.stableIdentity).toBe(finding.stableIdentity);
  });

  it("marks readiness incomplete when required rule categories or evidence are absent", () => {
    const fixture = verificationFixture([{ requirementId: "requirement:test", revisionDigest: "req:1", safetyCritical: true }]);
    const requirementCoverage = compileRequirementCoverage({ problem: fixture.problem });
    const run = runFullCircuitOracle({ ...fixture, requirementCoverage, startedAt: NOW });
    const report = evaluateCircuitReadiness({ problem: fixture.problem, graphDigest: fixture.graph.deterministicDigest, registry: fixture.registry, capabilityProfile: fixture.capabilityProfile, denominator: fixture.denominator, fullRun: run, requirementCoverage, now: NOW });
    expect(report.verdict).toBe("VERIFICATION_INCOMPLETE");
    expect(report.permittedActions).not.toContain("approve_for_CD10");
    expect(report.coverageGapCodes.some((item) => item.includes("APPLICATION_SUPPORT"))).toBe(true);
  });

  it("requires a full oracle even after incremental evaluation", () => {
    const fixture = verificationFixture();
    const body = { baseGraphRevisionId: fixture.graph.graphId, candidateGraphRevisionId: fixture.graph.graphId, addedRemovedChangedObjects: [{ objectKind: "component", objectId: fixture.graph.components[0].componentInstanceId, change: "changed" as const }], connectivityChanges: [], hierarchyChanges: [], identityAnnotationChanges: [], variantPopulationChanges: [], valuePartFootprintChanges: [], diagramOnlyChanges: [], affectedRequirementRecipeIds: [], downstreamInvalidationImpact: [], conflictIds: [] };
    const diff: SchematicSemanticDiff = { ...body, diffId: "diff:test", deterministicDigest: verificationDigest(body) };
    const incremental = runIncrementalCircuitVerification({ ...fixture, diff, startedAt: NOW });
    const full = runFullCircuitOracle({ ...fixture, startedAt: NOW });
    const expected = fixture.denominator.instances.filter((item) => incremental.impact.affectedRuleIds.includes(item.ruleId) && incremental.impact.affectedContextIds.includes(item.contextId)).map((item) => item.instanceId);
    const parity = compareFullAndIncrementalOracle({ full, incremental: incremental.run, expectedInstanceIds: expected });
    expect(incremental.run.runKind).toBe("incremental_provisional");
    expect(parity.state).toBe("equivalent");
  });

  it("makes a parity mismatch blocking", () => {
    const fixture = verificationFixture(), full = runFullCircuitOracle({ ...fixture, startedAt: NOW });
    const incremental = structuredClone(full);
    incremental.runKind = "incremental_provisional";
    incremental.results = incremental.results.slice(1);
    const parity = compareFullAndIncrementalOracle({ full, incremental, expectedInstanceIds: full.results.map((item) => item.ruleInstanceId) });
    const report = evaluateCircuitReadiness({ problem: fixture.problem, graphDigest: fixture.graph.deterministicDigest, registry: fixture.registry, capabilityProfile: fixture.capabilityProfile, denominator: fixture.denominator, fullRun: full, parity, now: NOW });
    expect(parity.state).toBe("mismatch");
    expect(report.verdict).toBe("BLOCKED");
  });
});
