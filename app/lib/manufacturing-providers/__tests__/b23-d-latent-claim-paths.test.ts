/**
 * [B23-D] The latent claim paths (runbook B23-D :1013 "Only physical evidence may advance an assembled-product claim."; global :147;
 * D23-14; OD-176). Five library functions could advance a production or hardware claim without physical evidence, and none is rewired:
 * this tripwire pins that `evaluateReleaseLevels`, `materializeRelease` (CD-12), `evaluateFactoryMeasurement`, `fitCalibration` (CD-11)
 * and `computeRuntimeVerdict` (CD-13) have no production caller. Two checks, either enough alone:
 *  - the import closure: no production module imports the three defining modules but each one's own barrel, and nothing imports a
 *    barrel, so no name, alias, namespace or computed member can reach them (an opaque dynamic load is held at zero by the B14.4 gate,
 *    b14-4-ast-import-gates case 2);
 *  - the names: no production module but the defining one spells an id, and in its module each id sits only where it is reviewed.
 * Each check is shown to bite on probes. The counterexamples D23-14 records are executed here (the reason none may gain a caller), and
 * `physical-evidence.md` section 6 records the hardening each needs first.
 *
 * Files are read as text; nothing is written and nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { combinedUncertainty, evaluateFactoryMeasurement, fitCalibration } from "@/app/lib/firmware-bringup/factory";
import { finalizeCd11 } from "@/app/lib/firmware-bringup/stable";
import type { CalibrationContract, FactoryMeasurement, FactoryTestDefinition, MeasurementUncertaintyModel, TestLimitPolicy } from "@/app/lib/firmware-bringup/types";
import { createAutonomousRun } from "@/app/lib/full-flow/project";
import { assessRunCapability, defaultStageRegistry } from "@/app/lib/full-flow/registry";
import { createAutonomousRequest, defaultSearchBudget, pinRunContext } from "@/app/lib/full-flow/request";
import type { AutonomousHardwareDesignRun, RequestedOutcome } from "@/app/lib/full-flow/types";
import { computeRuntimeVerdict } from "@/app/lib/full-flow/verdict";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { compileAssemblyVariantMatrix, compileAuthoritativeBom, validateAuthoritativeBom } from "@/app/lib/release-engineering/bom";
import { defaultCd12CapabilityProfile } from "@/app/lib/release-engineering/capability";
import { createExactManufacturerPart } from "@/app/lib/release-engineering/identity";
import { evaluateReleaseLevels } from "@/app/lib/release-engineering/readiness";
import { finalizeCd12 } from "@/app/lib/release-engineering/stable";
import type { ApprovalMatrix, AssemblyVariantDefinition, BomUsage, Cd12UpstreamRef, ReleaseEngineeringProblem, ReleaseRiskRegister } from "@/app/lib/release-engineering/types";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b23/physical-evidence.md";
const NOW = "2026-10-05T12:00:00.000Z";
const yieldOnce = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/** The five by id: the defining module, the declaration line, its barrel, and how often the module itself spells the id (reviewed). */
const LATENT = [
  { id: "evaluateReleaseLevels", module: "app/lib/release-engineering/readiness.ts", line: 11, barrel: "app/lib/release-engineering/index.ts", inModule: [11, 28, 28] },
  { id: "materializeRelease", module: "app/lib/release-engineering/readiness.ts", line: 28, barrel: "app/lib/release-engineering/index.ts", inModule: [28] },
  { id: "evaluateFactoryMeasurement", module: "app/lib/firmware-bringup/factory.ts", line: 5, barrel: "app/lib/firmware-bringup/index.ts", inModule: [5] },
  { id: "fitCalibration", module: "app/lib/firmware-bringup/factory.ts", line: 6, barrel: "app/lib/firmware-bringup/index.ts", inModule: [6] },
  { id: "computeRuntimeVerdict", module: "app/lib/full-flow/verdict.ts", line: 5, barrel: "app/lib/full-flow/index.ts", inModule: [5] },
] as const;
const DEFINING = [...new Set(LATENT.map((entry) => entry.module))];
const BARRELS = [...new Set(LATENT.map((entry) => entry.barrel))];
const extensionless = (path: string): string => path.replace(/\.ts$/, "");
/** A barrel is reached as `<dir>/index` or as the bare directory `<dir>`. */
const identities = (path: string): string[] => (path.endsWith("/index.ts") ? [extensionless(path), path.slice(0, -"/index.ts".length)] : [extensionless(path)]);

/** Every production source (the import gates' whole-root walk), less any test or spec file. */
const production = (): FileMap => new Map([...collectProductionFiles(ROOT)].filter(([path]) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)).map(([path, source]) => [path, source.replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE)] as const));

/** One pass over the module references of every file: who imports each defining module and each barrel (case-insensitive, as the gates detect). */
async function importersOf(files: FileMap): Promise<Record<string, string[]>> {
  const targets = new Map<string, string>();
  for (const path of [...DEFINING, ...BARRELS]) for (const identity of identities(path)) targets.set(identity.toLowerCase(), path);
  const found: Record<string, string[]> = Object.fromEntries([...DEFINING, ...BARRELS].map((path) => [path, [] as string[]]));
  let count = 0;
  for (const [path, source] of files) {
    for (const reference of moduleReferences(path, source)) {
      const resolved = resolveSpecifier(path, reference.specifier);
      const target = resolved.kind === "module" ? targets.get(resolved.module.toLowerCase()) : undefined;
      if (target && !found[target]!.includes(path)) found[target]!.push(path);
    }
    count += 1;
    if (count % 200 === 0) await yieldOnce(); // the worker answers vitest's onTaskUpdate between chunks of the whole-tree walk
  }
  return found;
}

/** The production files, other than its defining module, that spell each id. */
function namers(files: FileMap): Record<string, string[]> {
  return Object.fromEntries(LATENT.map(({ id, module }) => [id, [...files].filter(([path, source]) => path !== module && new RegExp(`\\b${id}\\b`).test(source)).map(([path]) => path)]));
}

let cached: FileMap | null = null;
const productionFiles = (): FileMap => (cached ??= production());

describe("[B23-D] the latent claim paths have no production caller (D23-14; OD-176)", () => {
  it("1. the five, by id: each is declared where D23-14 cites it, and in its own module each id appears only where reviewed (materializeRelease calls evaluateReleaseLevels twice, and has no caller itself)", () => {
    for (const { id, module, line, inModule } of LATENT) {
      const source = read(module).split(NEWLINE);
      expect(source[line - 1]!.startsWith(`export function ${id}(`), `${module}:${line}`).toBe(true);
      const at = source.flatMap((text, index) => Array.from(text.matchAll(new RegExp(`\\b${id}\\b`, "g")), () => index + 1));
      expect(at, id).toEqual([...inModule]);
    }
    for (const barrel of BARRELS) expect(read(barrel).split(NEWLINE).filter((text) => /^export \* from "\.\/(?:readiness|factory|verdict)";$/.test(text)).length, barrel).toBeGreaterThanOrEqual(1);
  });

  it("2. no production module reaches them: the defining modules are imported only by their own barrels, nothing imports a barrel, and no production module but the defining one spells an id", { timeout: 120_000 }, async () => {
    await yieldOnce();
    const files = productionFiles();
    expect(files.size).toBeGreaterThan(1000);
    expect(["proxy.ts", "instrumentation.ts"].filter((path) => files.has(path)), "the root's own production files are scanned").toEqual(["proxy.ts", "instrumentation.ts"]);
    const importers = await importersOf(files);
    expect(importers).toEqual({
      "app/lib/release-engineering/readiness.ts": ["app/lib/release-engineering/index.ts"],
      "app/lib/firmware-bringup/factory.ts": ["app/lib/firmware-bringup/index.ts"],
      "app/lib/full-flow/verdict.ts": ["app/lib/full-flow/index.ts"],
      "app/lib/release-engineering/index.ts": [],
      "app/lib/firmware-bringup/index.ts": [],
      "app/lib/full-flow/index.ts": [],
    });
    await yieldOnce();
    expect(namers(files)).toEqual(Object.fromEntries(LATENT.map(({ id }) => [id, []])));
  });

  it("3. each check bites: an aliased import through a barrel at the root, a namespace import with a computed member, and an escaped specifier are each found", { timeout: 120_000 }, async () => {
    await yieldOnce();
    const files = productionFiles();
    const backslash = String.fromCharCode(92);
    const probes: Array<[string, string, string]> = [
      ["an aliased barrel import", `import { evaluateFactoryMeasurement as measure } from "@/app/lib/firmware-bringup";${NEWLINE}export const probe = measure;`, "app/lib/firmware-bringup/index.ts"],
      ["a namespace import with a computed member", `import * as cd13 from "@/app/lib/full-flow/verdict";${NEWLINE}export const probe = (cd13 as Record<string, unknown>)["compute" + "RuntimeVerdict"];`, "app/lib/full-flow/verdict.ts"],
      ["an escaped specifier", `import { materializeRelease as m } from "@/app/lib/release${backslash}u002dengineering/readiness";${NEWLINE}export const probe = m;`, "app/lib/release-engineering/readiness.ts"],
    ];
    for (const [label, text, target] of probes) {
      const probed = new Map(files).set("proxy.ts", `${files.get("proxy.ts") ?? ""}${NEWLINE}${text}${NEWLINE}`);
      const importers = await importersOf(probed);
      expect(importers[target], label).toContain("proxy.ts");
    }
    // the name check alone catches a spelled name (the alias's source name), never the computed member: the closure does
    const named = namers(new Map(files).set("proxy.ts", `${files.get("proxy.ts") ?? ""}${NEWLINE}${probes[0]![1]}${NEWLINE}`));
    expect(named.evaluateFactoryMeasurement).toEqual(["proxy.ts"]);
    expect(namers(new Map(files).set("proxy.ts", `${files.get("proxy.ts") ?? ""}${NEWLINE}${probes[1]![1]}${NEWLINE}`)).computeRuntimeVerdict).toEqual([]);
  });

  it("4. why none may gain a caller first: the counterexamples D23-14 records, executed", () => {
    // CD-11: a caller-declared hardware measurement passes with no UUT identity, no station/fixture/instrument and no operator field
    const model: MeasurementUncertaintyModel = finalizeCd11({ uncertaintyModelId: "uncertainty:rail", components: [{ componentId: "instrument", standardUncertainty: 0.01, unit: "V", distribution: "normal" as const, evidenceRef: "cal:dmm" }], combinationPolicyRef: "rss-correlated-groups/1", coverageFactor: 2, deterministicDigest: "" });
    expect(combinedUncertainty(model)).toBeCloseTo(0.02, 6);
    const definition = finalizeCd11<FactoryTestDefinition>({ testId: "test:rail", revision: 1, sourceObligationRefs: ["dft:rail"], applicableVariantsModes: ["default:factory"], prerequisiteRefs: [], requiredLifecycleState: "factory_test", setupActions: [], stimulusActions: [], acquisitionActions: [], computationRef: "identity", uncertaintyModelRef: model.uncertaintyModelId, limitPolicyRef: "limit:rail", timeoutSeconds: 1, retryPolicy: { maximumAttempts: 1, allowedReasonCodes: [], preserveEveryAttempt: true }, cleanupActions: [], failureEvidenceRefs: [], equipmentProviderRefs: [], executionState: "dry_run_validated", deterministicDigest: "" });
    const limit: TestLimitPolicy = finalizeCd11({ limitPolicyId: "limit:rail", requirementLimitRef: "req:rail", lower: 3.2, upper: 3.4, unit: "V", conditionRefs: ["default"], derivationRef: "calculation:rail", uncertaintyModelRef: model.uncertaintyModelId, decisionRule: "indeterminate_at_boundary" as const, typicalValueUsed: false as const, characterizationState: "approved_production" as const, approvalState: "approved" as const, deterministicDigest: "" });
    const measurement: FactoryMeasurement = finalizeCd11({ measurementId: "measurement:rail", testId: definition.testId, rawValue: 3.3, unit: "V", instrumentRange: { minimum: 0, maximum: 5, unit: "V" }, resolution: 0.001, calibrationState: "current" as const, uncertaintyModelRef: model.uncertaintyModelId, rawArtifactRefs: ["artifact:claimed"], measuredAt: NOW, deterministicDigest: "" });
    const hardware = evaluateFactoryMeasurement({ definition, measurement, uncertaintyModel: model, limit, uutIdentityRef: "", stationFixtureInstrumentRefs: [], executionClass: "hardware" });
    expect(hardware).toMatchObject({ finalVerdict: "pass", executionClass: "hardware", uutIdentityRef: "", stationFixtureInstrumentRefs: [] });
    expect(hardware.attempts[0]?.reasonCode).toBe("WITHIN_LIMIT_WITH_UNCERTAINTY");
    expect(Object.keys(hardware).filter((key) => /operator/i.test(key))).toEqual([]);
    expect(evaluateFactoryMeasurement({ definition, measurement, uncertaintyModel: model, limit, uutIdentityRef: "", stationFixtureInstrumentRefs: [], executionClass: "dry_run" }).finalVerdict).toBe("indeterminate"); // the one guard it has
    // CD-11: a calibration fit takes the caller's hardware class and an empty UUT identity
    const contract: CalibrationContract = finalizeCd11({ calibrationContractId: "calibration:sensor", measurandRefs: ["sensor:v"], accuracyRequirementRefs: ["req:accuracy"], modelKind: "gain_offset" as const, pointPlan: [{ pointId: "p1", stimulus: 0, unit: "V", repetitions: 1, independentVerification: false }, { pointId: "p2", stimulus: 10, unit: "V", repetitions: 1, independentVerification: true }], referenceStandardRequirementRefs: ["standard:traceable"], estimatorRef: "least-squares/1", coefficientSchemaRef: "coeff:gain-offset", validityDomain: [{ dimension: "voltage", minimum: 0, maximum: 10, unit: "V" }], uncertaintyModelRef: "uncertainty:cal", verificationTestRefs: ["test:verify"], storageContractRef: "storage:dual", traceabilityPolicyRef: "traceability:1", approvalState: "candidate" as const, deterministicDigest: "" });
    const calibration = fitCalibration({ contract, uutIdentityRef: "", observations: [{ stimulus: 0, observed: 1, rawRef: "raw:1" }, { stimulus: 10, observed: 6, rawRef: "raw:2" }], referenceStandardRefs: ["standard:claimed"], environmentRefs: [], uncertainty: 0.1, executionClass: "hardware" });
    expect(calibration).toMatchObject({ executionClass: "hardware", uutIdentityRef: "" });
    expect(calibration.verificationStates).toEqual(["not_evaluated"]);
    // CD-12: any non-empty ref list passes the physical-process gate, and a caller-supplied "human" passes production release authority
    const stages = Array.from({ length: 11 }, (_, index) => ({ stage: `CD-${index + 1}` as Cd12UpstreamRef["stage"], objectId: `object:${index + 1}`, stateDigest: `state:${index + 1}`, decisionOrReadinessDigest: `decision:${index + 1}` }));
    const caller = { actorId: "anyone", actorKind: "human" as const, sessionId: "claimed", role: "project_admin" as const };
    const part = createExactManufacturerPart({ manufacturerId: "manufacturer:fixture", exactMpn: "FX-100-QFN-IND", atomicPartRevisionId: "atomic:fx100", exactPackageRevisionId: "package:qfn32:1", deviceAttributes: { function: "mcu" }, gradeAttributes: { temperature: "industrial" }, purchasePackagingIds: ["pack:cut-tape"], evidenceRefs: ["evidence:manufacturer-datasheet"], lifecycleEvidenceRefs: ["evidence:lifecycle"], assemblyEvidenceRefs: ["evidence:package"], reviewState: "approved", revision: 1 });
    const variant: AssemblyVariantDefinition = finalizeCd12({ variantId: "variant:base", code: "BASE", populationRules: [{ usageId: "usage:u1", state: "fitted" as const, conditionRefs: [] }], firmwareCompatibilityRefs: ["firmware:base"], testProfileRefs: ["test:base"], identityEncodingRef: "identity:base", approvalState: "approved" as const, revision: 1, deterministicDigest: "" });
    const usage: BomUsage = finalizeCd12({ usageId: "usage:u1", schematicComponentRef: "component:U1", pcbFootprintRef: "footprint:U1", hierarchicalPath: "/main/U1", referenceDesignator: "U1", exactPartRef: part.manufacturerPartId, quantityPerAssembly: 1, stateByVariant: [{ variantId: "variant:base", state: "fitted" }], packageRevisionRef: "package:qfn32:1", criticality: "high" as const, ownership: "purchaser" as const, programmingCalibrationTestRefs: ["test:base"], evidenceRefs: ["graph:usage"], deterministicDigest: "" });
    const matrix = compileAssemblyVariantMatrix({ boardRefs: ["board:1"], variants: [variant], usageIds: ["usage:u1"] });
    const bom = compileAuthoritativeBom({ matrix, sourceGraphDigest: "graph:1", pcbDigests: ["pcb:1"], usages: [usage], exactParts: [part], approvedSupplierMappingRefsByPart: { [part.manufacturerPartId]: ["mapping:fixture"] } });
    const problem: ReleaseEngineeringProblem = finalizeCd12({ schemaVersion: "sirkit.release-engineering-problem.v1" as const, problemId: "problem:cd12", tenantId: "tenant:test", projectId: "project:test", branchId: "branch:test", revision: 1, requestedReleaseLevel: "production-released" as const, upstreamRevisionRefs: stages, firmwareBringUpProjectDigest: "cd11:project", firmwareTestBringUpPackageId: "cd11:package", firmwareTestBringUpPackageDigest: "cd11:package:digest", pcbReleaseInputRefs: [{ projectId: "project:test", boardRevision: "board:1", boardDigest: "pcb:1", readinessReportDigest: "pcb:ready", manufacturingProfileId: "fab:1", manufacturingProfileVersion: "1" }], assemblyVariantIds: ["variant:base"], buildScenarioRef: "build:1", exactPartCatalogDigest: "catalog:1", approvedSourcePolicyRef: "source-policy:1", procurementFreshnessPolicyRef: "freshness:1", releasePolicyRef: "release-policy:1", approvalMatrixPolicyRef: "approval-policy:1", dataClassificationPolicyRef: "classification:1", manufacturingProfileRefs: ["factory:1"], activeChangeRefs: [], activeDeviationRefs: [], activeWaiverRefs: [], capabilityProfileDigest: defaultCd12CapabilityProfile().deterministicDigest, dependencyDigest: "dependency:1", lifecycleState: "ready_for_candidate_compilation" as const, blockingDiagnosticIds: [], createdBy: caller, createdAt: NOW, deterministicDigest: "" });
    const approval: ApprovalMatrix = finalizeCd12({ matrixId: "approval:claimed", releaseLevel: "production-released" as const, requirements: [], approvalRecords: [finalizeCd12({ approvalId: "approval:claimed-1", subjectDigest: "candidate:1", gate: "PRODUCTION_RELEASE_AUTHORITY", role: "production_release_authority", actor: caller, decision: "approved" as const, conditions: [], evidenceReviewedRefs: [], createdAt: NOW, deterministicDigest: "" })], evaluationState: "ready" as const, deterministicDigest: "" });
    const risks: ReleaseRiskRegister = finalizeCd12({ registerId: "risk:1", candidateRef: "candidate:1", risks: [], unresolvedCriticalRiskIds: [], acceptedRiskApprovalRefs: [], deterministicDigest: "" });
    const levels = evaluateReleaseLevels({ candidateRef: "candidate:1", problem, bom, bomCertificate: validateAuthoritativeBom(bom, matrix), procurementScenarios: [], approvalMatrix: approval, riskRegister: risks, physicalProcessEvidenceRefs: ["evidence:claimed-by-the-caller"], now: NOW }, "manifest:1");
    const gate = (name: string) => levels.gates.find((item) => item.gate === name)?.state;
    expect(gate("EXECUTED_PHYSICAL_PROCESS_QUALITY_EVIDENCE")).toBe("pass");
    expect(gate("PRODUCTION_RELEASE_AUTHORITY")).toBe("pass");
    // CD-13: a waived gate counts as passed, for a production-released outcome too
    const run = makeRun("production-released");
    const verdict = computeRuntimeVerdict({ run, gateMatrix: [{ gate: "physical-qualification", requiredFor: "production-released", state: "waived", evidenceRefs: [] }], selectedCandidateRef: "candidate:1", createdAt: NOW });
    expect(verdict).toMatchObject({ verdict: "complete", achievedOutcome: "production-released" });
    expect(verdict.passedGateRefs).toContain("physical-qualification");
  });

  it("5. physical-evidence.md section 6 names each function, where it is, and the hardening it needs before any caller is added (OD-176; factory.ts:5's unchecked refs and missing operator; the seed types)", () => {
    const page = read(PAGE);
    const start = page.indexOf(`${NEWLINE}## 6. The latent claim paths (D23-14, OD-176)${NEWLINE}`);
    const end = page.indexOf(`${NEWLINE}## 7. `, start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = page.slice(start, end);
    const HARDENING: Record<(typeof LATENT)[number]["id"], string[]> = {
      evaluateReleaseLevels: ["resolve refs against stored, reviewed evidence", "a server-derived actor"],
      materializeRelease: ["resolve refs against stored, reviewed evidence", "a server-derived actor"],
      evaluateFactoryMeasurement: ["verified provenance for a hardware class", "unchecked refs and missing operator", "`FactoryTestResult`"],
      fitCalibration: ["verified provenance for a hardware class", "unchecked refs and missing operator", "`CalibrationResult`"],
      computeRuntimeVerdict: ["a waiver never satisfies a physical gate"],
    };
    for (const { id, module, line } of LATENT) {
      const row = section.split(NEWLINE).find((text) => text.startsWith(`| \`${id}\` |`));
      expect(row, id).toBeDefined();
      expect(row, id).toContain(`\`${module}:${line}\``);
      for (const phrase of HARDENING[id]) expect(row, `${id}: ${phrase}`).toContain(phrase);
    }
    expect(section).toContain("`factory.ts:5`");
    expect(section).toContain("b23-d-latent-claim-paths");
  });

  it("6. [B23-D review round, 2026-10-05] the header cites the B14.4 case that holds opaque module loads at zero, which the import closure relies on (coverage-7)", () => {
    const own = read("app/lib/manufacturing-providers/__tests__/b23-d-latent-claim-paths.test.ts");
    const cited = /b14-4-ast-import-gates case (\d+)\)/.exec(own)?.[1];
    const gate = read("app/lib/project/__tests__/b14-4-ast-import-gates.test.ts").split(NEWLINE);
    const opaque = gate.findIndex((text) => text.includes("expect(opaqueModuleLoads(files)).toEqual([]);"));
    expect(opaque).toBeGreaterThan(0);
    const holder = gate.slice(0, opaque + 1).reverse().find((text) => /^\s*it\("\d+\. /.test(text));
    expect(cited).toBeDefined();
    expect(holder).toContain(`it("${cited}. `);
  });
});

/** A CD-13 run for the requested outcome (the shape `app/lib/full-flow/__tests__/foundation.test.ts` builds). */
function makeRun(outcome: RequestedOutcome): AutonomousHardwareDesignRun {
  const human = { actorId: "engineer:system", actorKind: "human" as const, sessionId: "test", role: "project_admin" as const };
  const registry = defaultStageRegistry(NOW);
  const budget = defaultSearchBudget("authority:test");
  const request = createAutonomousRequest({ tenantId: "tenant:test", projectId: "project:test", actor: human, productBriefRefs: [{ artifactRef: "brief:1", mediaType: "text/plain", classification: "internal", contentDigest: "sha256:brief" }], requestedOutcome: outcome, requestedCapabilityProfileId: "low-voltage-embedded-full-flow-v1", autonomyTier: 2, objectivePolicyRef: "objective:1", budgetPolicyRef: "budget:1", providerToolPolicyRef: "tools:1", dataPolicyRef: "data:1", startingBranchRef: "branch:test", priorRunRefs: [], createdAt: NOW });
  const capability = assessRunCapability({ request, registry, selectedProfileRef: "low-voltage-embedded-full-flow-v1", requestedFeatures: ["low_voltage_embedded", "two_to_four_layer_rigid"] });
  const context = pinRunContext({ request, capabilityProfileRef: capability.selectedProfileRef, registrySnapshotDigest: registry.deterministicDigest, autonomyPolicyRef: "tier:2", authorityPolicyRef: "authority:1", budget, environmentLockRef: "env:1" });
  return createAutonomousRun({ request, context, capabilityAssessment: capability, registry, budget });
}
