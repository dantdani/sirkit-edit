/**
 * [B24-D1] D24-41 (OD-204): the CD-9 corpus executor the built-in benchmark executor dispatches the three circuit_verification
 * operations to, beside CD-8's (`app/lib/schematic-compiler/benchmark.ts`). Every value is DERIVED from the CD-9 modules, never typed:
 *  - the manifest from `corpus.ts` and its own digest (`verificationDigest` over each entry's base);
 *  - each authority boolean from a call into the module that decides it: `capability.ts`'s `humanReviewer` refuses an AI approver;
 *    `readiness.ts` never answers READY (never permits approve_for_CD10) over a run holding an `unknown` finding, and names
 *    FULL_ORACLE_REQUIRED over an incremental run; `waiver.ts`'s waiver changes the workflow disposition (the finding leaves
 *    `unwaivedFindingIds`) while the run's physical result stays a violation; `native.ts` classifies a native KiCad ERC report as
 *    `corroborating_only` and `readiness.ts` takes no ERC input at all - its verdict over the same inputs is unchanged by a
 *    corroborating or a disagreeing native report, so neither a legacy ERC nor native KiCad can approve or override;
 *  - the scale figures from `capability.ts`'s approved profile (`limits.maximumRuleInstances`, the exported policy) and `contexts.ts`'s
 *    bounded selectors (a selector past the profile's limit is cut and diagnosed CD9_SELECTOR_RESOURCE_LIMIT), and `oracle.ts`'s
 *    isolated failures (one evaluator that throws fails `failed_isolated` while the rest of the denominator completes).
 * The oracle runs over a two-net benchmark graph built with the CD-8 graph builders (no component: no atomic fixture is needed), a
 * declared rail with no source (an `unknown` finding) and, for the waiver, a successor whose net names a missing endpoint (a
 * `violation` of graph integrity). The problem is a benchmark pin of that graph (CD-8's benchmark casts its problem the same way).
 * Pure and deterministic: no I/O, no clock, no process.
 */
import { addComponentBundle, addRailDefinition, connectPinToNet, createElectricalNet, createEmptySchematicGraph, populationRule } from "../schematic-compiler/graph";
import { schematicDigest } from "../schematic-compiler/stable";
import type { SchematicSemanticGraph } from "../schematic-compiler/types";
import { projectAllSchematicVariants } from "../schematic-compiler/variants";
import type { EngineeringActor } from "../engineering/types";
import { defaultCircuitVerificationCapabilityProfile, humanReviewer } from "./capability";
import { compileRequiredRuleDenominator, compileVerificationContexts } from "./contexts";
import { CD9_CORPUS_MANIFEST } from "./corpus";
import { classifyNativeErcCorroboration } from "./native";
import { runFullCircuitOracle } from "./oracle";
import { evaluateCircuitReadiness } from "./readiness";
import { createFoundationalRuleRegistry } from "./registry";
import { finalizeVerification, verificationDigest, verificationId } from "./stable";
import { CIRCUIT_VERIFICATION_PROBLEM_SCHEMA, type CircuitVerificationCapabilityProfile, type CircuitVerificationProblem, type RuleRegistrySnapshot, type VerificationOracleInput, type VerificationRuleDefinition } from "./types";
import { createCircuitWaiver } from "./waiver";

const NOW = "2026-10-09T00:00:00.000Z";
const LATER = "2026-10-10T00:00:00.000Z";
const REVIEWER: EngineeringActor = { actorId: "benchmark:reviewer", actorKind: "human", sessionId: "benchmark", role: "reviewer" };
const REQUESTER: EngineeringActor = { actorId: "benchmark:engineer", actorKind: "human", sessionId: "benchmark", role: "pcb_editor" };
const AI: EngineeringActor = { actorId: "benchmark:agent", actorKind: "ai", sessionId: "benchmark", role: "reviewer" };

const VARIANT = "variant:default";
const COMPONENT = "component:benchmark-u1";
const UNIT = "unit:benchmark-u1";
const PINS = ["pin:benchmark-u1-1", "pin:benchmark-u1-2"] as const;
const digested = <T extends { deterministicDigest: string }>(value: T): T => ({ ...value, deterministicDigest: schematicDigest({ ...value, deterministicDigest: undefined }) });

/** The benchmark graph: two global nets, a declared VDD rail with no source component (rail_source_presence answers unknown) and one
 *  component whose two push-pull outputs both drive VDD (push_pull_contention answers a violation its rule lets a waiver cover). */
function benchmarkGraph(): SchematicSemanticGraph {
  let graph = createEmptySchematicGraph({ projectId: "project:benchmark", variantIds: [VARIANT], dependencyRefs: ["requirements:benchmark"], namingPolicyRevisionId: "net-policy:benchmark" });
  const root = graph.sheetInstances[0]!.sheetInstanceId;
  for (const name of ["VDD", "GND"]) graph = createElectricalNet(graph, { netId: `net:${name}`, semanticRoleIds: [`role:${name.toLowerCase()}`], canonicalName: name, displayAliases: [], scopeKind: "global", owningHierarchyInstanceId: root, voltageDomainIds: name === "VDD" ? ["domain:3v3"] : ["domain:return"], signalMetadata: [], bundleMembershipIds: [], netClassConstraintRefs: [], provenanceRefs: [`benchmark:net:${name}`], lifecycleState: "active" });
  graph = addRailDefinition(graph, { semanticKind: "power_rail", canonicalNetId: "net:VDD", canonicalName: "VDD", aliases: [], voltageRefs: ["benchmark:voltage:3v3"], sourceRoleIds: ["role:regulator"], loadRoleIds: [], returnPathPolicyRefs: [], symbolViewPolicy: "power_symbol", globalityScope: "project", provenanceRefs: ["benchmark:rail:vdd"] });
  const rule = populationRule({ componentInstanceId: COMPONENT, variants: [{ variantId: VARIANT, state: "populated" }], sourceRefs: ["benchmark:population:u1"] });
  const pins = PINS.map((pinInstanceId, index) => digested({ pinInstanceId, componentInstanceId: COMPONENT, unitInstanceIds: [UNIT], atomicLogicalPinId: `logical-pin:benchmark:${index + 1}`, symbolPinIds: [`symbol-pin:benchmark:${index + 1}`], physicalPadIds: [`pad:benchmark:${index + 1}`], logicalPadNumbers: [String(index + 1)], pinName: `OUT${index + 1}`, pinNumber: String(index + 1), electricalType: "output", terminalRoles: [], terminalClassification: "electrical" as const, voltageDomainRefs: [], hiddenInSymbolView: false, variantDispositionIds: [], provenanceRefs: [`benchmark:pin:${index + 1}`], deterministicDigest: "" }));
  const unit = digested({ unitInstanceId: UNIT, componentInstanceId: COMPONENT, atomicUnitDefinitionId: "unit-definition:benchmark", unitOrdinalOrRole: "A", representedPinInstanceIds: [...PINS], assignedSheetInstanceId: root, viewState: "visible" as const, deterministicDigest: "" });
  const component = digested({ componentInstanceId: COMPONENT, architectureRoleInstanceIds: ["architecture-role:benchmark"], recipeRoleInstanceIds: ["recipe-role:benchmark"], exactAtomicPartRevisionId: "atomic-revision:benchmark", exactManufacturerPartRevisionId: "manufacturer-part:benchmark", exactPackageRevisionId: "package:benchmark", symbolRevisionId: "symbol:benchmark", footprintRevisionId: "footprint:benchmark", mappingCertificateId: "mapping-certificate:benchmark", displayedValue: "BENCH-U1", unitInstanceIds: [UNIT], propertyBindings: [], variantPopulationRuleId: rule.populationRuleId, evidenceAndProvenanceRefs: ["benchmark:component:u1"], lifecycleState: "active" as const, deterministicDigest: "" });
  graph = addComponentBundle(graph, { component, units: [unit], pins, populationRule: rule, initialDispositions: [], provenanceEdges: [] });
  for (const pinInstanceId of PINS) graph = connectPinToNet(graph, { pinInstanceId, netId: "net:VDD", variants: [VARIANT], provenanceRefs: [`benchmark:connection:${pinInstanceId}`] });
  return graph;
}

/** A benchmark problem pinned to `graph` (a pin, as CD-8's benchmark casts its problem; the digests the oracle and readiness compare). */
function benchmarkProblem(graph: SchematicSemanticGraph, registry: RuleRegistrySnapshot, profile: CircuitVerificationCapabilityProfile, contextKinds: string[]): CircuitVerificationProblem {
  const body = {
    schemaVersion: CIRCUIT_VERIFICATION_PROBLEM_SCHEMA,
    tenantId: "tenant:benchmark",
    projectId: graph.projectId,
    branchId: "branch:benchmark",
    revision: 1,
    cd8ProjectDigest: "benchmark:cd8-project",
    cd8CandidateId: "benchmark:candidate",
    cd8CandidateDigest: "benchmark:candidate-digest",
    semanticGraphRevisionId: graph.graphId,
    semanticGraphDigest: graph.deterministicDigest,
    roundTripCertificateId: "benchmark:certificate",
    roundTripCertificateDigest: "benchmark:certificate-digest",
    upstreamRevisionRefs: [] as CircuitVerificationProblem["upstreamRevisionRefs"],
    capabilityProfileDigest: profile.deterministicDigest,
    ruleRegistryDigest: registry.deterministicDigest,
    requiredVariantIds: [...graph.variantIds],
    requiredContextKinds: contextKinds,
    requirementRevisionRefs: [] as CircuitVerificationProblem["requirementRevisionRefs"],
    dependencyDigest: verificationDigest({ graph: graph.deterministicDigest, registry: registry.deterministicDigest }),
    lifecycleState: "ready_for_verification" as const,
    blockingDiagnosticIds: [] as string[],
    createdBy: REQUESTER,
    createdAt: NOW,
  };
  return finalizeVerification<CircuitVerificationProblem>({ ...body, problemId: verificationId("verification-problem", body), deterministicDigest: "" });
}

/** The oracle input over `graph` with the approved foundational registry and the approved profile. */
function oracleInput(graph: SchematicSemanticGraph, options: { registry?: RuleRegistrySnapshot; profile?: CircuitVerificationCapabilityProfile; contextKinds?: string[] } = {}): VerificationOracleInput {
  const registry = options.registry ?? createFoundationalRuleRegistry({ reviewer: REVIEWER, reviewedAt: NOW });
  const profile = options.profile ?? defaultCircuitVerificationCapabilityProfile();
  const contextKinds = options.contextKinds ?? ["static_unpowered", "static_powered"];
  const problem = benchmarkProblem(graph, registry, profile, contextKinds);
  const projections = projectAllSchematicVariants(graph);
  const contexts = compileVerificationContexts({ problem, graph });
  const denominator = compileRequiredRuleDenominator({ problem, graph, projections, registry, capabilityProfile: profile, contexts });
  return { problem, graph, projections, registry, capabilityProfile: profile, contexts, denominator, startedAt: NOW };
}

function readinessOf(input: VerificationOracleInput, extra: Partial<Parameters<typeof evaluateCircuitReadiness>[0]> = {}) {
  return evaluateCircuitReadiness({ problem: input.problem, graphDigest: input.graph.deterministicDigest, registry: input.registry, capabilityProfile: input.capabilityProfile, denominator: input.denominator, now: NOW, ...extra });
}

function manifest(): Record<string, unknown> {
  const invalid = CD9_CORPUS_MANIFEST.filter((item) => item.immutableManifestHash !== verificationDigest({ fixtureId: item.fixtureId, family: item.family, title: item.title, expectedOutcome: item.expectedOutcome, sourceLicenseId: item.sourceLicenseId, provenance: item.provenance, implementationState: item.implementationState })).length;
  return { fixtureCount: CD9_CORPUS_MANIFEST.length, invalidManifestHashes: invalid, fullyImplementedEvidenceFixtures: CD9_CORPUS_MANIFEST.filter((item) => item.implementationState !== "manifest_only").length, manifestOnlyCasesVisible: CD9_CORPUS_MANIFEST.filter((item) => item.implementationState === "manifest_only").length };
}

function authority(): Record<string, unknown> {
  // one full run over the benchmark graph: an unknown finding (the declared rail has no evidenced source: RAIL_SOURCE_NOT_PROVEN) and a
  // waivable violation (two push-pull outputs on VDD: PUSH_PULL_CONTENTION)
  const input = oracleInput(benchmarkGraph());
  const full = runFullCircuitOracle(input);
  const unknownFindings = full.findings.filter((item) => item.engineeringResult === "unknown");
  const violation = full.findings.find((item) => item.engineeringResult === "violation" && item.ruleId === "cd9.rule.push-pull-contention");
  const withFull = readinessOf(input, { fullRun: full });
  const unknownCanPass = unknownFindings.length === 0 || withFull.verdict === "READY" || withFull.permittedActions.includes("approve_for_CD10");
  // the full oracle is required: an incremental run of the same denominator is a coverage gap, never READY
  const incremental = runFullCircuitOracle(input, { runKind: "incremental_provisional" });
  const withIncremental = readinessOf(input, { fullRun: incremental });
  const fullOracleRequired = withIncremental.coverageGapCodes.includes("FULL_ORACLE_REQUIRED") && withIncremental.verdict !== "READY";
  // a waiver changes the workflow disposition only: the violation leaves unwaivedFindingIds while the run's result and the blocking list keep it
  let waiverChangesPhysicalResult = true;
  if (violation) {
    const waiver = createCircuitWaiver({ findings: [violation], run: full, registry: input.registry, justification: "benchmark: the contention is a fixture artefact", riskStatement: "benchmark: no physical board carries this graph", requestedBy: REQUESTER, approvedBy: REVIEWER, createdAt: NOW, expiresAt: LATER });
    const after = readinessOf(input, { fullRun: full, waivers: [waiver] });
    const dispositionChanged = withFull.unwaivedFindingIds.includes(violation.findingId) && !after.unwaivedFindingIds.includes(violation.findingId) && after.activeWaiverIds.includes(waiver.waiverId);
    const physicalResultKept = full.findings.find((item) => item.findingId === violation.findingId)?.engineeringResult === "violation" && after.blockingFindingIds.includes(violation.findingId);
    waiverChangesPhysicalResult = !(dispositionChanged && physicalResultKept && waiver.physicalResultPreserved);
  }
  // native KiCad ERC corroborates only, and readiness takes no ERC input: the verdict over the same inputs cannot be overridden by a corroborating or a disagreeing native report
  const corroborating = classifyNativeErcCorroboration({ run: full, nativeGraphDigest: full.graphDigest, toolVersion: "benchmark", nativeFindingRefs: [], matchedAuthoritativeFindingIds: full.findings.map((item) => item.findingId) });
  const disagreeing = classifyNativeErcCorroboration({ run: full, nativeGraphDigest: full.graphDigest, toolVersion: "benchmark", nativeFindingRefs: ["native:benchmark:clean"], matchedAuthoritativeFindingIds: [] });
  const kicadNativeCanOverride = corroborating.authority !== "corroborating_only" || disagreeing.authority !== "corroborating_only" || corroborating.state !== "corroborates" || disagreeing.state !== "disagrees" || withFull.verdict === "READY";
  const withoutRun = readinessOf(input);
  const legacyErcCanApprove = kicadNativeCanOverride || withoutRun.verdict === "READY" || withoutRun.permittedActions.includes("approve_for_CD10");
  return { legacyErcCanApprove, aiCanApprove: humanReviewer(AI), kicadNativeCanOverride, unknownCanPass, waiverChangesPhysicalResult, fullOracleRequired };
}

function scale(): Record<string, unknown> {
  const profile = defaultCircuitVerificationCapabilityProfile();
  const graph = benchmarkGraph();
  // bounded selectors: with the selector limit at one, the two-net selection is cut to one target and diagnosed, never scanned whole
  const narrow: CircuitVerificationCapabilityProfile = { ...profile, limits: { ...profile.limits, maximumSelectorResults: 1 } };
  const bounded = oracleInput(graph, { profile: narrow });
  const boundedSelectors = bounded.denominator.diagnostics.some((item) => item.code === "CD9_SELECTOR_RESOURCE_LIMIT") && bounded.denominator.instances.every((item) => item.targetIds.length <= 1) && bounded.denominator.instances.filter((item) => item.ruleId === "cd9.rule.push-pull-contention").length === bounded.contexts.length;
  // isolated failures: one evaluator that throws (an unknown implementation) fails in isolation while the rest of the denominator completes
  const registry = createFoundationalRuleRegistry({ reviewer: REVIEWER, reviewedAt: NOW });
  const sabotaged: RuleRegistrySnapshot = { ...registry, rules: registry.rules.map((rule) => (rule.ruleId === "cd9.rule.graph-integrity" ? { ...rule, implementationRef: "builtin.benchmark_unknown" as VerificationRuleDefinition["implementationRef"] } : rule)) };
  const input = oracleInput(graph, { registry: sabotaged });
  const run = runFullCircuitOracle(input);
  const failed = run.executions.filter((item) => item.state === "failed_isolated");
  const isolatedFailures = failed.length === bounded.contexts.length && run.executionState === "completed_with_isolated_errors" && run.results.length === input.denominator.instances.length && run.diagnostics.some((item) => item.code === "CD9_RULE_EXECUTION_INTERNAL_ERROR") && run.results.filter((item) => item.engineeringResult === "internal_error").length === failed.length;
  const incremental = runFullCircuitOracle(oracleInput(graph), { runKind: "incremental_provisional" });
  const fullOracleRequired = readinessOf(oracleInput(graph), { fullRun: incremental }).coverageGapCodes.includes("FULL_ORACLE_REQUIRED");
  return { maximumRuleInstances: profile.limits.maximumRuleInstances, boundedSelectors, isolatedFailures, fullOracleRequired };
}

export function executeCircuitVerificationBenchmark(operation: string): Record<string, unknown> {
  if (operation === "circuit_verification_manifest") return manifest();
  if (operation === "circuit_verification_authority") return authority();
  if (operation === "circuit_verification_scale") return scale();
  throw new Error(`CIRCUIT_VERIFICATION_BENCHMARK_OPERATION_UNSUPPORTED:${operation}`);
}
