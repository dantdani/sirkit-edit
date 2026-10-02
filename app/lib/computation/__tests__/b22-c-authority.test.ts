/**
 * [B22-C] Simulation authority: evidence, never authority; the 501 kept (runbook B22-C :922-934; discovery D22-6, OD-138, 9.5
 * item 17). The CD-10 execute and readiness routes learn the provider and the environment from the server: the provider from the
 * server's own provider set, the environment from the B22-A2 runtime-profile registry, each resolved by id and digest. A body copy
 * that differs, or names an id the server does not hold, is refused 409 with a closed code; the registry holds no `validated`
 * profile, so execute still ends 409/501 and the 501 text never moves. Readiness's other body-taken inputs (problem, registries,
 * denominator, coverage, applicability, campaign) stay body-taken and are recorded: with no server-held authoritative pair, none of
 * them can reach `approve_for_CD11` or `run_authoritative_campaign`. The CD-11 consumer re-derives readiness through the same bound
 * function.
 *
 * Test-first: cases 1, 4 and 6 are the pre-edit counterexamples (a self-declared validated pair reached the 501 and a verified
 * readiness report); the new module is imported inside the cases that need it. No process, no network, no model.
 *
 * [B22-C review] The binding is pure and browser-safe: the server's environment registry (the B22-A2 runtime profiles, which read
 * the file system) is passed in by the server callers (`serverEnvironments`), never imported by the pure evaluators, which the
 * editor's client bundle reaches (regressions-1, case 8, red on the reviewed tree: node:fs reached `app/page.tsx` through
 * readiness.ts). Cases 1 and 4 add each half of the binding alone at both routes (tests-3, coverage-9) and case 7 the checks past the
 * binding (tests-8); those assertions were green on the reviewed tree and each was proved by a deliberate source breakage.
 */
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, posix } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { collectProductionFiles } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { authorizeSimulationExecution, executeAuthoritativeSimulation } from "@/app/lib/model-simulation/safe-execution";
import { evaluateSimulationReadiness } from "@/app/lib/model-simulation/readiness";
import { analyticalReferenceProvider, diagnosticNgspiceProvider } from "@/app/lib/model-simulation/provider";
import { defaultModelSimulationCapabilityProfile } from "@/app/lib/model-simulation/capability";
import { finalizeSimulation } from "@/app/lib/model-simulation/stable";
import type { NetlistLoweringManifest, SimulationExecutionEnvironment, SimulatorProviderDefinition } from "@/app/lib/model-simulation/types";
import { COMPUTATION_CATALOG } from "@/app/lib/computation/catalog";
import { DIAGNOSTIC_RESULT_LABELS } from "@/app/lib/computation/diagnostic-runner";
import { runtimeProfiles } from "@/app/lib/computation/runtime-profile";
import { POST as execute } from "@/app/api/model-simulation/execute/route";
import { POST as readinessRoute } from "@/app/api/model-simulation/readiness/route";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const BLOCKED_501 = "CD-10 authoritative runner is blocked until the sandbox image/executable and environment corpus are independently validated";
const STUB_CODE = "CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const BINDING_CODES = ["CD10_PROVIDER_NOT_SERVER_REGISTERED", "CD10_PROVIDER_BODY_MISMATCH", "CD10_ENVIRONMENT_NOT_SERVER_REGISTERED", "CD10_ENVIRONMENT_BODY_MISMATCH"];

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
}
async function answer(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
afterEach(() => {
  resetInjectedIdentity();
});
function human(): void {
  injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" });
}

/** A provider and an environment that declare themselves validated, digest-bearing and network-deny (B22-A2 case 4's pair). */
function selfDeclared(): { provider: SimulatorProviderDefinition; environment: SimulationExecutionEnvironment } {
  const provider = finalizeSimulation<SimulatorProviderDefinition>({ ...diagnosticNgspiceProvider(), providerId: "provider:self-declared", reviewState: "validated", authoritativeEligible: true, deterministicDigest: "" });
  const environment = finalizeSimulation<SimulationExecutionEnvironment>({ environmentId: "environment:self-declared", providerRevisionId: provider.deterministicDigest, executableOrImageDigest: "sha256:self-declared", simulatorVersion: "ngspice-46", operatingSystemAndArchitecture: "win32-x64", dependencyVersions: [], localeAndTimeZone: "LC_ALL=C;TZ=UTC", floatingPointAndThreadSettings: [], environmentVariablesAllowlist: [], resourceLimits: { timeoutMs: 1_000, memoryMiB: 64, outputBytes: 1_000, processCount: 1, waveformPoints: 10 }, networkPolicy: "deny", sandboxPolicyRevisionId: "self-declared", validationState: "validated", deterministicDigest: "" });
  return { provider, environment };
}
const manifestFor = (provider: SimulatorProviderDefinition): Partial<NetlistLoweringManifest> => ({ providerRevisionId: provider.deterministicDigest, modelIncludeAndDigestMappings: [], structuralValidationResults: [] });
/** A readiness input set whose every body-taken part agrees with every other (the digests are the public FNV ones). */
function consistentReadinessSet(provider: unknown, environment: unknown): Record<string, unknown> {
  const coverage = finalizeSimulation({ problemRevisionId: "problem:forged", denominatorDigest: "denominator:forged", requiredInstanceIds: ["instance:1"], passedAssertionInstanceIds: ["instance:1"], failedAssertionInstanceIds: [], indeterminateAssertionInstanceIds: [], unsupportedModelOrAnalysisInstanceIds: [], notEvaluatedInstanceIds: [], nonconvergedInstanceIds: [], staleInstanceIds: [], notApplicableInstanceIds: [], modelCapabilityCoverage: [], variantAndCornerCoverage: [], requirementCoverage: [], coverageDigest: "coverage:forged", coverageMatrixId: "coverage-matrix:forged", deterministicDigest: "" });
  return {
    problem: { projectId: "proj-1", branchId: "main", lifecycleState: "ready_for_campaign", modelRegistryDigest: "models:forged", testbenchRegistryDigest: "testbenches:forged", semanticGraphDigest: "graph:forged", deterministicDigest: "problem:forged" },
    modelRegistry: { deterministicDigest: "models:forged", lifecycleState: "approved" },
    testbenchRegistry: { deterministicDigest: "testbenches:forged", lifecycleState: "approved" },
    provider,
    environment,
    denominator: { nonVacuous: true, deterministicDigest: "denominator:forged" },
    coverage,
    applicabilityResults: [{ applicabilityResultId: "applicability:1", applicabilityState: "applicable_validated", exactComponentInstanceId: "component:1" }],
  };
}
const readinessOf = (set: Record<string, unknown>) => evaluateSimulationReadiness(set as unknown as Parameters<typeof evaluateSimulationReadiness>[0]);

describe("[B22-C] simulation authority: the server's provider and environment, never the body's (D22-6, OD-138)", () => {
  it("1. a self-declared validated, digest-bearing, network-deny pair is refused 409 with a closed code at execute, never the 501 (pre-edit: authorized authoritative, then the 501)", async () => {
    human();
    const { provider, environment } = selfDeclared();
    const unknown = await answer(await execute(post("/api/model-simulation/execute", { provider, environment, manifest: manifestFor(provider), availableContentDigests: [] })));
    expect(unknown.status).toBe(409);
    expect(unknown.body.error).toBe("authoritative execution denied");
    expect(unknown.body.code).toBe("CD10_PROVIDER_NOT_SERVER_REGISTERED");
    expect((unknown.body.authorization as { mode: string; codes: string[] }).mode).toBe("denied");
    expect((unknown.body.authorization as { codes: string[] }).codes).toEqual(expect.arrayContaining(["CD10_PROVIDER_NOT_SERVER_REGISTERED", "CD10_ENVIRONMENT_NOT_SERVER_REGISTERED"]));
    // the library refuses the same pair the same way
    const direct = authorizeSimulationExecution({ provider, environment, manifest: manifestFor(provider) as NetlistLoweringManifest, availableContentDigests: [], requestedNetwork: false, requestedTimeoutMs: 0, requestedOutputBytes: 0 });
    expect(direct.authorized).toBe(false);
    expect(direct.mode).toBe("denied");
    // a body that keeps the server's provider id but edits its content (validated, eligible) is a mismatch, not the server's copy
    const forgedServerId = finalizeSimulation<SimulatorProviderDefinition>({ ...diagnosticNgspiceProvider(), reviewState: "validated", authoritativeEligible: true, deterministicDigest: "" });
    const profile = runtimeProfiles().find((candidate) => candidate.profileId === "ngspice-local-diagnostic")!;
    const forgedProfile = { ...JSON.parse(JSON.stringify(profile)) as Record<string, unknown>, validationState: "validated", networkPolicy: "deny" };
    const mismatch = await answer(await execute(post("/api/model-simulation/execute", { provider: forgedServerId, environment: forgedProfile, manifest: manifestFor(forgedServerId), availableContentDigests: [] })));
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe("CD10_PROVIDER_BODY_MISMATCH");
    expect((mismatch.body.authorization as { codes: string[] }).codes).toEqual(expect.arrayContaining(["CD10_PROVIDER_BODY_MISMATCH", "CD10_ENVIRONMENT_BODY_MISMATCH"]));
    expect(JSON.stringify(mismatch.body)).not.toContain(BLOCKED_501);
    // [B22-C review] tests-3, coverage-9: the environment half alone - the server's own provider copy with a forged (validated,
    // network-deny) copy of the server's profile, or with an environment the registry does not hold - is refused by its own code
    const serverProvider = JSON.parse(JSON.stringify(diagnosticNgspiceProvider())) as SimulatorProviderDefinition;
    const forgedEnvironment = { ...JSON.parse(JSON.stringify(profile)) as Record<string, unknown>, validationState: "validated", networkPolicy: "deny" };
    for (const [label, environment, code] of [["forged environment", forgedEnvironment, "CD10_ENVIRONMENT_BODY_MISMATCH"], ["unknown environment", selfDeclared().environment, "CD10_ENVIRONMENT_NOT_SERVER_REGISTERED"]] as const) {
      const alone = await answer(await execute(post("/api/model-simulation/execute", { provider: serverProvider, environment, manifest: manifestFor(serverProvider), availableContentDigests: [] })));
      expect(alone.status, label).toBe(409);
      expect(alone.body.error, label).toBe("authoritative execution denied");
      expect(alone.body.code, label).toBe(code);
      expect(alone.body.authorization, label).toEqual({ authorized: false, mode: "denied", codes: [code] });
      expect(authorizeSimulationExecution({ provider: serverProvider, environment: environment as unknown as SimulationExecutionEnvironment, manifest: manifestFor(serverProvider) as NetlistLoweringManifest, availableContentDigests: [], requestedNetwork: false, requestedTimeoutMs: 0, requestedOutputBytes: 0, serverEnvironments: runtimeProfiles() }), label).toEqual({ authorized: false, mode: "denied", codes: [code] });
    }
  });

  it("2. the server's own copies pass the binding and still end 409 - every registry provider with every registry profile, never authoritative, never the 501", async () => {
    const { serverSimulationProviders, bindSimulationAuthority, SIMULATION_AUTHORITY_BINDING_CODES } = await import("@/app/lib/computation/simulation-authority");
    expect([...SIMULATION_AUTHORITY_BINDING_CODES]).toEqual(BINDING_CODES);
    const providers = serverSimulationProviders();
    expect(providers.map((provider) => provider.providerId).sort()).toEqual(["provider:analytical-reference", "provider:ngspice-local-diagnostic"]);
    for (const provider of providers) {
      expect(provider.reviewState, provider.providerId).not.toBe("validated");
      expect(provider.authoritativeEligible, provider.providerId).toBe(false);
      expect(Object.isFrozen(provider), provider.providerId).toBe(true);
    }
    const profiles = runtimeProfiles();
    expect(profiles.every((profile) => profile.validationState !== "validated" && profile.authoritativeEligible === false)).toBe(true);
    human();
    for (const provider of providers) {
      for (const profile of profiles) {
        const label = `${provider.providerId} x ${profile.profileId}`;
        const copies = JSON.parse(JSON.stringify({ provider, environment: profile })) as { provider: unknown; environment: unknown };
        expect(bindSimulationAuthority(copies, profiles).codes, label).toEqual([]);
        // [B22-C review] regressions-1: a caller that passes no registry holds no environment: fail-closed, never the body's
        expect(bindSimulationAuthority(copies, []).codes, label).toEqual(["CD10_ENVIRONMENT_NOT_SERVER_REGISTERED"]);
        const response = await answer(await execute(post("/api/model-simulation/execute", { ...copies, manifest: manifestFor(provider), availableContentDigests: [] })));
        expect(response.status, label).toBe(409);
        expect(response.body.error, label).toBe("authoritative execution denied");
        expect(response.body.code, label).toBeUndefined();
        expect((response.body.authorization as { mode: string }).mode, label).not.toBe("authoritative");
      }
    }
  });

  it("3. the 501 text, the stub and the B16.0.20 pins are unchanged; the 409 keeps its text; the route still starts nothing", async () => {
    const source = read("app/api/model-simulation/execute/route.ts");
    expect(source).toContain(`return Response.json({ ok: false, authorization, error: "${BLOCKED_501}" }, { status: 501 });`);
    expect(source.split(BLOCKED_501).length).toBe(2);
    expect(source).toContain('return Response.json({ ok: false, authorization, error: "authoritative execution denied" }, { status: 409 });');
    expect(source).not.toMatch(/executeAuthoritativeSimulation|child_process|spawn\(/);
    await expect(executeAuthoritativeSimulation()).rejects.toThrow(STUB_CODE);
    const safe = read("app/lib/model-simulation/safe-execution.ts");
    expect(safe).toContain(`export async function executeAuthoritativeSimulation(): Promise<never> { throw new Error("${STUB_CODE}"); }`);
    // the body copies are compared, never trusted: the authorization resolves both through the server binding
    expect(safe).toMatch(/bindSimulationAuthority\(/);
    expect(read("app/lib/model-simulation/readiness.ts")).toMatch(/bindSimulationAuthority\(/);
    // [B22-C review] coverage-4: the A2 verdict and the threat model's T11 row no longer state the body-trusted path as current
    const verdict = read("artifacts/ai-control-plane-b22/isolation-verdict.md");
    const t11 = read("artifacts/ai-control-plane-b22/threat-model.md").split(String.fromCharCode(10)).find((line) => line.startsWith("| T11 |"))!;
    const statements: Array<[string, string, RegExp]> = [
      ["isolation-verdict.md: the self-declared body", verdict, /\[B22-C review, 2026-10-02\] No longer: such a body is refused 409\s+"authoritative execution denied" with a closed code \(`CD10_PROVIDER_NOT_SERVER_REGISTERED`/],
      ["threat-model.md: T11's control", t11, /\[B22-C review, 2026-10-02\][^|]*by id and digest/],
      ["threat-model.md: T11's suite", t11, /`b22-c-authority`/],
    ];
    expect(statements.filter(([, text, pattern]) => !pattern.test(text)).map(([label]) => label)).toEqual([]);
  });

  it("4. readiness: a consistent forged set with a self-declared pair is refused 409 with a closed code (pre-edit: simulation_verified_for_supported_scope with approve_for_CD11 and run_authoritative_campaign)", async () => {
    human();
    const { provider, environment } = selfDeclared();
    const set = consistentReadinessSet(provider, environment);
    const response = await answer(await readinessRoute(post("/api/model-simulation/readiness", set)));
    expect(response.status).toBe(409);
    expect(response.body.ok).toBe(false);
    expect(response.body.code).toBe("CD10_PROVIDER_NOT_SERVER_REGISTERED");
    expect(JSON.stringify(response.body)).not.toMatch(/simulation_verified_for_supported_scope|approve_for_CD11|run_authoritative_campaign/);
    // the library: the binding gap is in the report, which is never verified and permits neither handoff nor campaign
    const report = readinessOf(set);
    expect(report.gapCodes).toEqual(expect.arrayContaining(["CD10_PROVIDER_NOT_SERVER_REGISTERED", "CD10_ENVIRONMENT_NOT_SERVER_REGISTERED", "CD10_PROVIDER_ENVIRONMENT_NOT_AUTHORITATIVE"]));
    expect(report.readinessState).toBe("blocked_model_or_coverage_gap");
    expect(report.permittedActions).not.toContain("approve_for_CD11");
    expect(report.permittedActions).not.toContain("run_authoritative_campaign");
    // [B22-C review] tests-3, coverage-9: each half alone at the route - the server's provider with a forged or an unknown
    // environment, and a forged copy of the server's provider with the server's own environment
    const serverProvider = JSON.parse(JSON.stringify(diagnosticNgspiceProvider())) as Record<string, unknown>;
    const local = JSON.parse(JSON.stringify(runtimeProfiles().find((candidate) => candidate.profileId === "ngspice-local-diagnostic")!)) as Record<string, unknown>;
    const forgedProvider = finalizeSimulation<SimulatorProviderDefinition>({ ...diagnosticNgspiceProvider(), reviewState: "validated", authoritativeEligible: true, deterministicDigest: "" });
    for (const [label, pairProvider, pairEnvironment, code] of [
      ["forged environment", serverProvider, { ...local, validationState: "validated", networkPolicy: "deny" }, "CD10_ENVIRONMENT_BODY_MISMATCH"],
      ["unknown environment", serverProvider, environment, "CD10_ENVIRONMENT_NOT_SERVER_REGISTERED"],
      ["forged provider", forgedProvider, local, "CD10_PROVIDER_BODY_MISMATCH"],
    ] as const) {
      const alone = await answer(await readinessRoute(post("/api/model-simulation/readiness", consistentReadinessSet(pairProvider, pairEnvironment))));
      expect(alone.status, label).toBe(409);
      expect(alone.body.code, label).toBe(code);
      expect(JSON.stringify(alone.body), label).not.toMatch(/approve_for_CD11|run_authoritative_campaign/);
      expect(readinessOf({ ...consistentReadinessSet(pairProvider, pairEnvironment), serverEnvironments: runtimeProfiles() }).gapCodes.filter((gap) => BINDING_CODES.includes(gap)), label).toEqual([code]);
    }
  });

  it("5. readiness with the server's exact copies answers 200, never verified: the other body-taken inputs (problem, registries, denominator, coverage, applicability, campaign) are recorded, and none reaches approve_for_CD11 or run_authoritative_campaign", async () => {
    const { serverSimulationProviders } = await import("@/app/lib/computation/simulation-authority");
    human();
    for (const provider of serverSimulationProviders()) {
      for (const profile of runtimeProfiles()) {
        const label = `${provider.providerId} x ${profile.profileId}`;
        const set = consistentReadinessSet(JSON.parse(JSON.stringify(provider)), JSON.parse(JSON.stringify(profile)));
        const response = await answer(await readinessRoute(post("/api/model-simulation/readiness", { ...set, campaign: { campaignId: "campaign:forged" } })));
        expect(response.status, label).toBe(200);
        const report = response.body.report as { readinessState: string; gapCodes: string[]; permittedActions: string[] };
        expect(report.gapCodes, label).toContain("CD10_PROVIDER_ENVIRONMENT_NOT_AUTHORITATIVE");
        expect(report.gapCodes.filter((code) => BINDING_CODES.includes(code)), label).toEqual([]);
        expect(report.readinessState, label).not.toMatch(/verified/);
        expect(report.permittedActions, label).not.toContain("approve_for_CD11");
        expect(report.permittedActions, label).not.toContain("run_authoritative_campaign");
      }
    }
  });

  it("6. the CD-11 consumer re-derives readiness through the bound function: a forged persisted verified report no longer recomputes to its own digest (pre-edit: it did)", () => {
    const { provider, environment } = selfDeclared();
    const set = consistentReadinessSet(provider, environment);
    const recomputed = readinessOf(set);
    // the report a client would persist as verified: the recomputation with its verdict, gaps and actions overwritten (FNV digests are public)
    const { deterministicDigest: _digest, ...rest } = recomputed;
    void _digest;
    const forged = finalizeSimulation({ ...rest, readinessState: "simulation_verified_for_supported_scope" as const, gapCodes: [], blockingFindingIds: [], permittedActions: ["approve_for_CD11", "run_authoritative_campaign"] as typeof recomputed.permittedActions, deterministicDigest: "" });
    expect(recomputed.deterministicDigest).not.toBe(forged.deterministicDigest);
    expect(recomputed.readinessState).not.toMatch(/verified/);
    // the consumer calls exactly that function and requires the recomputed digest to equal the persisted one
    const consumer = read("app/lib/firmware-bringup/problem.ts");
    expect(consumer).toContain('import { evaluateSimulationReadiness } from "../model-simulation/readiness";');
    expect(consumer).toContain("recomputed.deterministicDigest === report.deterministicDigest");
  });

  it("7. a diagnostic result is never authoritative: the runner's labels, every registry pair's authorization, and no catalog kind or provider analysis names an unsupported domain", async () => {
    expect([...DIAGNOSTIC_RESULT_LABELS]).toEqual(["diagnostic_only", "environment_dependent"]);
    expect(JSON.stringify(DIAGNOSTIC_RESULT_LABELS)).not.toMatch(/authoritative|validated|verified/);
    const { serverSimulationProviders } = await import("@/app/lib/computation/simulation-authority");
    for (const provider of serverSimulationProviders()) {
      for (const profile of runtimeProfiles()) {
        const authorization = authorizeSimulationExecution({ provider, environment: profile, manifest: manifestFor(provider) as NetlistLoweringManifest, availableContentDigests: [], requestedNetwork: false, requestedTimeoutMs: 0, requestedOutputBytes: 0, serverEnvironments: runtimeProfiles() });
        expect(authorization.mode, `${provider.providerId} x ${profile.profileId}`).not.toBe("authoritative");
      }
    }
    // the analytical provider with a human reviewer is a body claim: the server holds only its unreviewed copy
    const reviewer = { actorId: "reviewer-1", actorKind: "human", role: "reviewer", sessionId: "s1" } as unknown as Parameters<typeof analyticalReferenceProvider>[0];
    const reviewed = analyticalReferenceProvider(reviewer);
    expect(reviewed.reviewState).toBe("validated");
    const local = runtimeProfiles().find((profile) => profile.profileId === "ngspice-local-diagnostic")!;
    expect(authorizeSimulationExecution({ provider: reviewed, environment: local, manifest: manifestFor(reviewed) as NetlistLoweringManifest, availableContentDigests: [], requestedNetwork: false, requestedTimeoutMs: 0, requestedOutputBytes: 0, serverEnvironments: runtimeProfiles() }).codes).toContain("CD10_PROVIDER_BODY_MISMATCH");
    // [B22-C review] tests-8: past the binding the request is still checked against the server's copies - the network, the resource
    // bounds and every include - here with the server's diagnostic provider and the network-deny OCI profile
    const ngspice = JSON.parse(JSON.stringify(diagnosticNgspiceProvider())) as SimulatorProviderDefinition;
    const oci = runtimeProfiles().find((profile) => profile.profileId === "ngspice-oci")!;
    const request = (extra: Partial<Parameters<typeof authorizeSimulationExecution>[0]>) => authorizeSimulationExecution({ provider: ngspice, environment: oci, manifest: manifestFor(ngspice) as NetlistLoweringManifest, availableContentDigests: [], requestedNetwork: false, requestedTimeoutMs: 0, requestedOutputBytes: 0, serverEnvironments: runtimeProfiles(), ...extra });
    const base = request({});
    for (const code of ["CD10_EXECUTION_NETWORK_NOT_DENIED", "CD10_EXECUTION_RESOURCE_LIMIT_INVALID", "CD10_EXECUTION_INCLUDE_NOT_SANDBOXED"]) expect(base.codes, code).not.toContain(code);
    expect(base.mode).toBe("diagnostic_only");
    const network = request({ requestedNetwork: true });
    expect(network.codes).toContain("CD10_EXECUTION_NETWORK_NOT_DENIED");
    expect(network.mode).toBe("diagnostic_only");
    for (const [label, extra] of [["timeout", { requestedTimeoutMs: oci.resourceLimits.timeoutMs + 1 }], ["output", { requestedOutputBytes: oci.resourceLimits.outputBytes + 1 }]] as const) {
      const over = request(extra);
      expect(over.codes, label).toContain("CD10_EXECUTION_RESOURCE_LIMIT_INVALID");
      expect(over.mode, label).toBe("denied");
    }
    const escaping = request({ manifest: { ...manifestFor(ngspice), modelIncludeAndDigestMappings: [{ modelAssetRevisionId: "model:1", sandboxRelativePath: "../outside.lib", contentDigest: "sha256:model" }] } as NetlistLoweringManifest, availableContentDigests: ["sha256:model"] });
    expect(escaping.codes).toContain("CD10_EXECUTION_INCLUDE_NOT_SANDBOXED");
    expect(escaping.mode).toBe("denied");
    expect(escaping.authorized).toBe(false);
    // safety-critical claims stay out of scope (runbook :934): the domains are unsupported, and nothing B22 exposes names one
    const domains = defaultModelSimulationCapabilityProfile().unsupportedDomains;
    for (const domain of ["high_energy_fault_signoff", "regulatory_certification", "functional_safety_certification"]) expect(domains).toContain(domain);
    const exposed = JSON.stringify({ catalog: COMPUTATION_CATALOG, analyses: serverSimulationProviders().map((provider) => provider.supportedAnalyses) });
    for (const domain of domains) expect(exposed, domain).not.toContain(domain);
  });

  it("8. [B22-C review] regressions-1: the binding stays browser-safe - no 'use client' graph reaches a node-only module; the server's environment registry is read by the two routes alone", { timeout: 120_000 }, () => {
    const files = collectProductionFiles(ROOT);
    const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
    const kindOf = (path: string): ts.ScriptKind => (path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".jsx") ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
    const parsed = (path: string): ts.SourceFile => ts.createSourceFile(path, files.get(path)!, ts.ScriptTarget.Latest, false, kindOf(path));
    /** The module specifiers a bundler keeps: type-only imports and re-exports are erased, so they are skipped. */
    const valueSpecifiers = (path: string): string[] => {
      const found: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const clause = node.importClause;
          const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined;
          const typeOnly = Boolean(clause && (clause.isTypeOnly || (!clause.name && named && named.length > 0 && named.every((element) => element.isTypeOnly))));
          if (!typeOnly) found.push(node.moduleSpecifier.text);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const named = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : undefined;
          if (!node.isTypeOnly && !(named && named.length > 0 && named.every((element) => element.isTypeOnly))) found.push(node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
          found.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed(path));
      return found;
    };
    const resolve = (from: string, specifier: string): string | null => {
      const base = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(from), specifier)) : null;
      if (base === null) return null;
      for (const candidate of [base, ...EXTENSIONS.map((extension) => `${base}${extension}`), ...EXTENSIONS.map((extension) => `${base}/index${extension}`)]) if (files.has(candidate)) return candidate;
      return null;
    };
    const entries = [...files.keys()].filter((path) => EXTENSIONS.some((extension) => path.endsWith(extension)) && files.get(path)!.includes("use client")).filter((path) => {
      const first = parsed(path).statements[0];
      return Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use client");
    });
    for (const page of ["app/page.tsx", "app/model-simulation/page.tsx", "app/firmware-bringup/page.tsx"]) expect(entries, page).toContain(page);
    const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
    // the client graph's standing node:crypto (app/lib/atomic/stable.ts, app/lib/physical-binding/stable.ts) is polyfilled; nothing else
    const ALLOWED_BUILTINS = new Set(["crypto", "node:crypto"]);
    const parent = new Map<string, string | null>(entries.map((entry) => [entry, null]));
    const queue = [...entries];
    const hits: string[] = [];
    const chain = (path: string): string => { const links = [path]; for (let next = parent.get(path); next; next = parent.get(next)) links.push(next); return links.join(" <- "); };
    while (queue.length) {
      const path = queue.shift()!;
      for (const specifier of valueSpecifiers(path)) {
        if (builtins.has(specifier)) {
          if (!ALLOWED_BUILTINS.has(specifier)) hits.push(`${specifier} :: ${chain(path)}`);
          continue;
        }
        const target = resolve(path, specifier);
        if (target && !parent.has(target)) { parent.set(target, path); queue.push(target); }
      }
    }
    expect(hits).toEqual([]);
    // the pure binding is in the client graph (through readiness.ts); the server's registry and the runner's modules are not
    expect(parent.has("app/lib/computation/simulation-authority.ts")).toBe(true);
    for (const server of ["app/lib/computation/simulation-authority-server.ts", "app/lib/computation/runtime-profile.ts", "app/lib/computation/output-bounds.ts", "app/lib/computation/diagnostic-runner.ts"]) expect(parent.has(server), server).toBe(false);
    // only the two routes read the server's registry
    const readers = [...files].filter(([path, source]) => path !== "app/lib/computation/simulation-authority-server.ts" && /computation\/simulation-authority-server"/.test(source)).map(([path]) => path).sort();
    expect(readers).toEqual(["app/api/model-simulation/execute/route.ts", "app/api/model-simulation/readiness/route.ts"]);
  });
});
