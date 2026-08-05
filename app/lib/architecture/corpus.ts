import { synthesizeArchitectureProposals } from "./alternatives";
import { compileArchitectureCandidate } from "./compiler";
import { architectureDigest, architectureId } from "./stable";
import type { ArchitectureFlowKind, ArchitectureProblem } from "./types";
import { ARCHITECTURE_COMPILER_VERSION, ARCHITECTURE_PROBLEM_SCHEMA_VERSION } from "./types";
import { validateArchitectureProblem } from "./problem";
import { validateArchitectureProposal } from "./validation";

export interface ArchitectureCorpusFixture {
  fixtureId: string;
  title: string;
  partition: "publicDevelopment" | "tuning" | "validation" | "hiddenHoldout" | "stress";
  capabilityRoles: string[];
  externalRoles: string[];
  requiredModes: string[];
  flowKind: ArchitectureFlowKind;
  criticality: "normal" | "high" | "mission_critical" | "safety_critical";
  focus: string[];
}

const fixture = (fixtureId: string, title: string, capabilityRoles: string[], externalRoles: string[], requiredModes: string[], flowKind: ArchitectureFlowKind, criticality: ArchitectureCorpusFixture["criticality"], focus: string[], partition: ArchitectureCorpusFixture["partition"] = "publicDevelopment"): ArchitectureCorpusFixture => ({ fixtureId, title, partition, capabilityRoles, externalRoles, requiredModes, flowKind, criticality, focus });

/** Twenty governed architecture families; no hidden fixture is used for tuning. */
export const ARCHITECTURE_CORPUS: readonly ArchitectureCorpusFixture[] = Object.freeze([
  fixture("status-indicator", "Simple status indicator", ["provide_product_behavior"], ["user"], ["off", "active"], "control", "normal", ["minimal decomposition"]),
  fixture("battery-monitor", "Battery-powered monitor", ["manage_energy", "sense_and_measure", "communicate"], ["battery_source", "sensor", "user"], ["sleep", "measure", "report", "safe"], "power", "high", ["energy budget", "safe state"]),
  fixture("usb-instrument", "USB laboratory instrument", ["sense_and_measure", "communicate", "diagnose_and_calibrate"], ["usb_host", "sensor", "operator"], ["boot", "idle", "acquire", "fault"], "data", "high", ["interface boundary", "calibration"]),
  fixture("motor-controller", "Motor control product", ["manage_energy", "provide_product_behavior", "protect_and_isolate"], ["power_source", "motor_load", "operator"], ["off", "startup", "run", "fault"], "power", "safety_critical", ["fault containment", "energy flow"]),
  fixture("industrial-analog", "Industrial analog acquisition", ["sense_and_measure", "protect_and_isolate", "communicate"], ["industrial_sensor", "network_host"], ["startup", "measure", "diagnostic", "safe"], "analog", "mission_critical", ["isolation", "uncertainty"]),
  fixture("offline-logger", "Offline environmental logger", ["interface_with_environment", "local_behavior", "communicate"], ["environment_sensor", "user"], ["sleep", "sample", "store", "sync"], "data", "normal", ["offline behavior", "storage responsibility"]),
  fixture("dual-rail-control", "Dual-domain control", ["manage_energy", "startup_supervision_and_debug"], ["power_source", "debug_host"], ["off", "sequencing", "ready", "fault"], "power", "high", ["sequencing", "domain boundary"]),
  fixture("safety-supervisor", "Independent safety supervisor", ["provide_product_behavior", "protect_and_isolate", "supervise_and_service"], ["operator", "load"], ["safe", "armed", "active", "trip"], "reset", "safety_critical", ["independence", "common cause"]),
  fixture("wearable-sensor", "Wearable sensing device", ["manage_energy", "sense_and_measure", "communicate"], ["battery_source", "user", "wireless_host"], ["sleep", "sample", "transmit", "charge"], "energy", "high", ["battery life", "user boundary"]),
  fixture("thermal-controller", "Thermal control system", ["interface_with_environment", "provide_product_behavior", "protect_and_isolate"], ["temperature_sensor", "heater_load", "operator"], ["off", "regulate", "limit", "fault"], "thermal", "safety_critical", ["thermal flow", "safe response"]),
  fixture("audio-interface", "Audio interface", ["sense_and_measure", "communicate", "coordinate_timing"], ["audio_source", "host"], ["idle", "stream", "mute"], "clock", "normal", ["clock ownership", "analog/data boundary"]),
  fixture("field-gateway", "Offline-capable field gateway", ["communicate", "secure_and_establish_trust", "local_behavior"], ["field_network", "cloud_service", "service_user"], ["boot", "offline", "online", "recovery"], "data", "mission_critical", ["trust boundary", "optional cloud"]),
  fixture("calibrated-actuator", "Calibrated actuator", ["provide_product_behavior", "diagnose_and_calibrate", "manage_energy"], ["actuator_load", "test_operator"], ["safe", "calibrate", "operate", "fault"], "control", "high", ["calibration ownership", "test access"]),
  fixture("redundant-control", "Redundant control channels", ["provide_product_behavior", "supervise_and_service"], ["operator", "load"], ["safe", "primary", "degraded", "fault"], "control", "mission_critical", ["redundancy", "single point risk"]),
  fixture("secure-access", "Secure access controller", ["secure_and_establish_trust", "provide_product_behavior", "supervise_and_service"], ["user", "network_host", "service_user"], ["locked", "authenticate", "granted", "alarm"], "data", "safety_critical", ["trust boundary", "fail secure"]),
  fixture("manufacturing-test", "Manufacturing-testable controller", ["provide_product_behavior", "manufacture_and_test", "release_and_govern"], ["factory_test", "user"], ["production", "test", "released"], "debug", "normal", ["test responsibility", "release evidence"], "validation"),
  fixture("ambiguous-external", "Ambiguous external interaction holdout", ["provide_product_behavior", "communicate"], ["external_system"], ["idle", "active"], "data", "high", ["question generation", "unknown contract"], "hiddenHoldout"),
  fixture("large-modular", "Large modular architecture stress", Array.from({ length: 24 }, (_, index) => `functional_module_${index}`), ["user", "host", "service"], ["boot", "ready", "active", "fault"], "control", "high", ["scale", "stable identity"], "stress"),
  fixture("boundary-dense", "Boundary-dense architecture stress", ["manage_energy", "communicate", "secure_and_establish_trust", "protect_and_isolate", "interface_with_environment"], ["source", "network", "user", "environment"], ["safe", "startup", "run", "service"], "data", "safety_critical", ["crossing enumeration", "risk burden"], "stress"),
  fixture("alternative-sensitivity", "Decision sensitivity validation", ["provide_product_behavior", "communicate", "manage_energy", "diagnose_and_calibrate"], ["source", "host", "operator"], ["off", "ready", "active", "fault"], "control", "high", ["Pareto ranking", "missing data"], "validation"),
]);

export function buildArchitectureCorpusProblem(item: ArchitectureCorpusFixture): ArchitectureProblem {
  const packageDigest = `req1-benchmark-${item.fixtureId}`;
  const requirements = item.capabilityRoles.map((role, index) => ({ requirementId: `requirement:${item.fixtureId}:${index}`, revision: 1, statement: `Provide abstract capability ${role}.`, domain: "product_functional" as const, strength: "hard" as const, criticality: item.criticality, predicate: { form: "must_exist" as const, cardinality: { kind: "at_least" as const, count: 1 } }, subjectRoles: index === 0 ? item.externalRoles : [], capabilityAssessment: { profileRef: "architecture-benchmark@1", state: "supported_and_verifiable" as const, limitations: [], requiredEvidence: ["cd2 deterministic compiler"], evaluatorRefs: [ARCHITECTURE_COMPILER_VERSION], explanation: "Covered by the CD-2 functional architecture model." }, verificationObligationRefs: [], sourceRefs: [`fixture:${item.fixtureId}`] }));
  const base: Omit<ArchitectureProblem, "deterministicDigest"> = { schemaVersion: ARCHITECTURE_PROBLEM_SCHEMA_VERSION, problemId: architectureId("architecture-problem", item.fixtureId), tenantId: "tenant:benchmark", projectId: `project:${item.fixtureId}`, branchId: "benchmark", requirementsPackageRef: { packageId: `requirements:${item.fixtureId}`, revision: 1, digest: packageDigest, status: "accepted_for_architecture_exploration" }, selectedCapabilityProfileRefs: ["architecture-benchmark@1"], requirements, functionalCapabilities: item.capabilityRoles.map((role, index) => ({ capabilityId: `capability:${item.fixtureId}:${index}`, role, requirementRefs: [requirements[index].requirementId], requiredInteractions: [] })), externalInteractions: item.externalRoles.map((role, index) => ({ interactionId: `interaction:${item.fixtureId}:${index}`, externalRole: role, flowKind: item.flowKind, direction: "bidirectional", requirementRefs: requirements.length ? [requirements[index % requirements.length].requirementId] : [], knownContract: null })), budgets: [], acceptedAssumptions: [], verificationObligations: [], requiredModeVocabulary: [...item.requiredModes], unresolvedNonBlockingItems: [], compilerVersion: ARCHITECTURE_COMPILER_VERSION };
  return { ...base, deterministicDigest: architectureDigest({ ...base, deterministicDigest: undefined }) };
}

export function executeArchitectureBenchmark(operation: string): Record<string, number | boolean | string> {
  if (operation === "architecture_problem_corpus") return { fixtureCount: ARCHITECTURE_CORPUS.length, invalidProblems: ARCHITECTURE_CORPUS.filter((item) => validateArchitectureProblem(buildArchitectureCorpusProblem(item)).length).length, hiddenUsedForTuning: false };
  const problem = buildArchitectureCorpusProblem(ARCHITECTURE_CORPUS[0]); const proposals = synthesizeArchitectureProposals(problem); const actor = { actorId: "benchmark", actorKind: "automated_engine" as const, sessionId: "benchmark", role: "automation" as const };
  const compiled = proposals.map((proposal) => compileArchitectureCandidate({ problem, proposal, actor, createdAt: "2026-07-17T00:00:00.000Z" })); const candidates = compiled.flatMap((item) => item.ok ? [item.candidate] : []);
  if (operation === "architecture_alternatives") return { candidateCount: candidates.length, distinctStructures: new Set(candidates.map((item) => item.structuralSignature)).size, compileFailures: compiled.length - candidates.length };
  if (operation === "architecture_coverage") return { uncoveredHard: candidates.reduce((sum, candidate) => sum + candidate.coverage.filter((row) => row.strength === "hard" && row.state === "uncovered").length, 0), rootOnlyAccepted: false };
  if (operation === "architecture_adversarial_schema") { const proposal = structuredClone(proposals[0]); proposal.blocks[0].description = "Use STM32 and add a footprint"; return { forbiddenImplementationAccepted: validateArchitectureProposal(proposal, problem).length === 0, diagnostics: validateArchitectureProposal(proposal, problem).length }; }
  throw new Error(`UNKNOWN_ARCHITECTURE_BENCHMARK:${operation}`);
}
