/**
 * [B22-A2] Production simulation authority stays BLOCKED (runbook B22-A :906, pass :942; OD-134): the CD-10 throwing stub
 * `executeAuthoritativeSimulation` still throws `CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX` and nothing outside its
 * module names it; the execute route's 501 text is byte-for-byte unchanged in the source; [B22-C, 2026-10-02] a body that
 * declares itself validated is now refused 409 with a closed code before it (D22-6 closed, OD-138; case 4 moved by review); every
 * B22-A2 runtime profile ends at 409 there and is never authoritative; `isolation-verdict.md` says so. No process, no network, no
 * model.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { collectProductionFiles } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { authorizeSimulationExecution, executeAuthoritativeSimulation } from "@/app/lib/model-simulation/safe-execution";
import { analyticalReferenceProvider, diagnosticNgspiceProvider } from "@/app/lib/model-simulation/provider";
import { finalizeSimulation } from "@/app/lib/model-simulation/stable";
import type { SimulationExecutionEnvironment, SimulatorProviderDefinition } from "@/app/lib/model-simulation/types";
import { POST as execute } from "@/app/api/model-simulation/execute/route";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const STUB_CODE = "CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX";
const BLOCKED_501 = "CD-10 authoritative runner is blocked until the sandbox image/executable and environment corpus are independently validated";
const STUB_LINES = [
  "/** CD-10 deliberately does not spawn a process until an OS/container sandbox implementation is independently validated. */",
  `export async function executeAuthoritativeSimulation(): Promise<never> { throw new Error("${STUB_CODE}"); }`,
];
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function post(body: unknown): Request {
  return new Request("http://localhost/api/model-simulation/execute", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
}
afterEach(() => {
  resetInjectedIdentity();
});
/** Whether a file's code (an identifier or a string, never a comment) refers to `name`. */
function refersTo(path: string, source: string, name: string): boolean {
  if (!source.includes(name)) return false;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === name) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("[B22-A2] the authoritative runner stays blocked", () => {
  it("1. executeAuthoritativeSimulation throws CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX on every call, and its two source lines are unchanged", async () => {
    for (let call = 0; call < 3; call += 1) {
      let caught: unknown = null;
      try {
        await executeAuthoritativeSimulation();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(STUB_CODE);
    }
    const lines = read("app/lib/model-simulation/safe-execution.ts").split(String.fromCharCode(10));
    const at = lines.indexOf(STUB_LINES[1]!);
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toBe(STUB_LINES[0]);
  });

  it("2. no production code outside safe-execution.ts refers to executeAuthoritativeSimulation (an identifier or a string; a comment is not a reference)", { timeout: 120_000 }, () => {
    const referring = [...collectProductionFiles(ROOT)].filter(([path, source]) => refersTo(path, source, "executeAuthoritativeSimulation")).map(([path]) => path);
    expect(referring).toEqual(["app/lib/model-simulation/safe-execution.ts"]);
    // the check sees a call, an import and a string key, and ignores a comment
    expect(refersTo("probe.ts", 'import { executeAuthoritativeSimulation } from "x";', "executeAuthoritativeSimulation")).toBe(true);
    expect(refersTo("probe.ts", 'const run = (m: Record<string, () => void>) => m["executeAuthoritativeSimulation"]();', "executeAuthoritativeSimulation")).toBe(true);
    expect(refersTo("probe.ts", ["// executeAuthoritativeSimulation stays blocked", "export const x = 1;"].join(String.fromCharCode(10)), "executeAuthoritativeSimulation")).toBe(false);
  });

  it("3. the execute route's 501 text, its 409 and its AI 403 are byte-for-byte unchanged in the source", () => {
    const source = read("app/api/model-simulation/execute/route.ts");
    expect(source).toContain(`return Response.json({ ok: false, authorization, error: "${BLOCKED_501}" }, { status: 501 });`);
    expect(source).toContain('return Response.json({ ok: false, authorization, error: "authoritative execution denied" }, { status: 409 });');
    expect(source).toContain('return Response.json({ ok: false, error: "AI cannot execute simulation campaigns" }, { status: 403 });');
    expect(source.split(BLOCKED_501).length).toBe(2);
    expect(source).not.toMatch(/executeAuthoritativeSimulation|child_process|spawn\(/);
  });

  it("4. a body that declares itself validated, digest-bearing and network-deny is refused 409 with a closed code, never the 501 ([B22-C, 2026-10-02] reviewed pin move: D22-6 closed - the provider and environment are the server's copies by id and digest (OD-138); was: the body was trusted and reached the 501, which stays the last line)", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" });
    const provider = finalizeSimulation<SimulatorProviderDefinition>({ ...diagnosticNgspiceProvider(), providerId: "provider:self-declared", reviewState: "validated", authoritativeEligible: true, deterministicDigest: "" });
    const environment = finalizeSimulation<SimulationExecutionEnvironment>({ environmentId: "environment:self-declared", providerRevisionId: provider.deterministicDigest, executableOrImageDigest: "sha256:self-declared", simulatorVersion: "ngspice-46", operatingSystemAndArchitecture: "win32-x64", dependencyVersions: [], localeAndTimeZone: "LC_ALL=C;TZ=UTC", floatingPointAndThreadSettings: [], environmentVariablesAllowlist: [], resourceLimits: { timeoutMs: 1_000, memoryMiB: 64, outputBytes: 1_000, processCount: 1, waveformPoints: 10 }, networkPolicy: "deny", sandboxPolicyRevisionId: "self-declared", validationState: "validated", deterministicDigest: "" });
    const manifest = { providerRevisionId: provider.deterministicDigest, modelIncludeAndDigestMappings: [], structuralValidationResults: [] };
    const body = { provider, environment, manifest, availableContentDigests: [] };
    expect(authorizeSimulationExecution({ ...body, manifest: manifest as never, requestedNetwork: false, requestedTimeoutMs: 0, requestedOutputBytes: 0 })).toEqual({ authorized: false, mode: "denied", codes: ["CD10_ENVIRONMENT_NOT_SERVER_REGISTERED", "CD10_PROVIDER_NOT_SERVER_REGISTERED"] });
    const response = await execute(post(body));
    expect(response.status).toBe(409);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("authoritative execution denied");
    expect(payload.code).toBe("CD10_PROVIDER_NOT_SERVER_REGISTERED");
    expect(JSON.stringify(payload)).not.toContain(BLOCKED_501);
  });

  it("5. every B22-A2 runtime profile, as the execute route's environment, ends at 409 and is never authorized authoritative, whatever the provider", async () => {
    const { runtimeProfiles } = await import("@/app/lib/computation/runtime-profile");
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" });
    const reviewer = { actorId: "reviewer-1", actorKind: "human", role: "reviewer", sessionId: "s1" } as unknown as Parameters<typeof analyticalReferenceProvider>[0];
    const profiles = runtimeProfiles(() => undefined);
    expect(profiles.length).toBe(4);
    for (const profile of profiles) {
      for (const provider of [diagnosticNgspiceProvider(), analyticalReferenceProvider(reviewer)]) {
        const manifest = { providerRevisionId: provider.deterministicDigest, modelIncludeAndDigestMappings: [], structuralValidationResults: [] };
        const authorization = authorizeSimulationExecution({ provider, environment: profile, manifest: manifest as never, availableContentDigests: [], requestedNetwork: false, requestedTimeoutMs: 0, requestedOutputBytes: 0 });
        expect(authorization.mode, `${profile.profileId} ${provider.providerId}`).not.toBe("authoritative");
        const response = await execute(post({ provider, environment: profile, manifest, availableContentDigests: [] }));
        expect(response.status, `${profile.profileId} ${provider.providerId}`).toBe(409);
        expect(((await response.json()) as Record<string, unknown>).error).toBe("authoritative execution denied");
      }
    }
  });

  it("6. isolation-verdict.md says production authority stays BLOCKED, quotes the 501 text and the stub's code, records the lead's dated host probe and names what would unblock it", () => {
    const page = read("artifacts/ai-control-plane-b22/isolation-verdict.md");
    expect(page.startsWith("# B22-A2 - ")).toBe(true);
    for (const text of ["BLOCKED", BLOCKED_501, STUB_CODE, "2026-10-01T09:20:48Z", "npipe:////./pipe/dockerDesktopLinuxEngine", "docker-desktop", "kali-linux", "Ubuntu", "OD-134", "OD-147", "B22-A4", "B24-A", "LB-10", "**RECORDED**", "**CONFIRMED**"]) expect(page, text).toContain(text);
    expect(page).not.toMatch(/\bsandbox(ed)? (is|are) (qualified|validated|proven)\b/i);
  });
});
