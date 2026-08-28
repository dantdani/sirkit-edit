/**
 * B16.0.20 §C/§D/§I/§J — execution-authority proofs, zero-process gates, and
 * AST-backed confinement for the tranche-13 model-simulation migration.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm } from "./_boundary-analysis";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const scopeOverride = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("@/app/api/model-simulation/_scope", async (orig) => {
  const actual = await orig() as { modelSimulationScopeFromContext: (c: unknown) => unknown };
  return { ...actual, modelSimulationScopeFromContext: (c: unknown) => scopeOverride.value ?? actual.modelSimulationScopeFromContext(c) };
});
import { POST as execute } from "../../../api/model-simulation/execute/route";

const ROOT = process.cwd();
const NAMES = ["denominator", "execute", "measure", "problem", "propose", "readiness"];
const ROUTES = NAMES.map((r) => `app/api/model-simulation/${r}/route.ts`);
/** Source with comments AND string literals removed — gates inspect CODE only. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };

afterEach(() => { resetInjectedIdentity(); scopeOverride.value = null; });

describe("B16.0.20 §C — the CORRECTED execute actor gate (ambiguity reproduced pre-edit, now closed)", () => {
  it("ai + automation is now REFUSED 403 (pre-edit it passed the gate to the 400 required-field check — recorded)", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" });
    scopeOverride.value = { tenantId: "local", projectId: "proj-1", branchId: "main", actorId: "agent-1", actorKind: "ai", role: "automation", sessionId: "s1" };
    const res = await execute(new Request("http://localhost/api/model-simulation/execute", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: "{}" }));
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("AI cannot execute simulation campaigns");
  });
  it("a human actor (any permitted role, incl. one carrying the automation role) still passes the gate to input validation", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" });
    scopeOverride.value = { tenantId: "local", projectId: "proj-1", branchId: "main", actorId: "u1", actorKind: "human", role: "automation", sessionId: "s1" };
    const res = await execute(new Request("http://localhost/api/model-simulation/execute", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: "{}" }));
    expect(res.status).toBe(400); // past the gate → required-field refusal
  });
});

describe("B16.0.20 §I — canonical adoption + confinement (code only)", () => {
  it("all six routes classify canonical-wrapper; use authenticatedJsonRoute; no scopedJson/raw primitives", () => {
    for (const rel of ROUTES) {
      const c = classifyRouteMethodForm(readFileSync(join(ROOT, rel), "utf8"), "POST", join(ROOT, rel), ROOT);
      expect(c.form, rel).toBe("canonical-wrapper");
      const src = code(rel);
      expect(src, rel).toMatch(/authenticatedJsonRoute\s*\(/);
      expect(src, rel).not.toMatch(/\bscopedJson\b/);
      expect(src, rel).not.toMatch(/\bauthorizeRequest\s*\(/);
      expect(src, rel).not.toMatch(/readBoundedJson(Object|Body)\s*\(/);
      expect(src, rel).not.toMatch(/:\s*Request\b|new URL\s*\(|request\.(headers|url|json|text|body|signal)\b|\.headers\.get\s*\(|\.(cookies|origin|host)\b/);
      expect(src, rel).not.toMatch(/\.(json|text|formData|arrayBuffer|blob)\s*\(\s*\)/);
    }
  });
  it("ZERO process/container/network surface: no child_process/spawn/exec/worker/docker/fetch/provider-router in any route", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/child_process|spawnSync|\bspawn\s*\(|execFile|\bexec\s*\(|Worker\s*\(|docker|container/i);
      expect(src, rel).not.toMatch(/\bfetch\s*\(/);
      expect(src, rel).not.toMatch(/llmRouter|providerErrorResponse/);
    }
  });
  it("the scope projector is Request-free and used by every scope-consuming route", () => {
    expect(code("app/api/model-simulation/_scope.ts")).toMatch(/modelSimulationScopeFromContext\s*\(\s*context\s*:/);
    for (const rel of ROUTES) {
      const src = code(rel);
      if (/const scope =/.test(src)) expect(src, rel).toMatch(/modelSimulationScopeFromContext\s*\(\s*context\s*\)/);
    }
  });
});

describe("B16.0.20 §J — human-truth and tool gates", () => {
  const raw = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
  it("AI cannot compile the authoritative problem (human-actor gate literal) and the compiled actor is forced human", () => {
    const src = raw("app/api/model-simulation/problem/route.ts");
    expect(src).toMatch(/AI may propose CD-10 inputs but may not compile an authoritative problem/);
    expect(src).toMatch(/actorKind: "human"/);
  });
  it("the runner remains BLOCKED: authorization is not execution — 409 denied path + fail-closed 501 with the exact blocked-runner error", () => {
    const src = raw("app/api/model-simulation/execute/route.ts");
    expect(src).toMatch(/authoritative execution denied/);
    expect(src).toMatch(/status: 409/);
    expect(src).toMatch(/CD-10 authoritative runner is blocked until the sandbox image\/executable and environment corpus are independently validated/);
    expect(src).toMatch(/status: 501/);
  });
  it("proposal remains deterministic + human-reviewed (requiresHumanReview: true; no provider import)", () => {
    const src = raw("app/api/model-simulation/propose/route.ts");
    expect(src).toMatch(/requiresHumanReview: true/);
    expect(code("app/api/model-simulation/propose/route.ts")).not.toMatch(/llmRouter/);
  });
  it("no simulation route is agent-exposed; tools EXACTLY 12; manufacturing release internal-only", () => {
    const registry = sirkitToolRegistry();
    const exposed = registry.list().filter((d) => d.agentExposed);
    expect(exposed.length).toBe(12);
    expect(JSON.stringify(exposed)).not.toMatch(/model-simulation/);
    const release = registry.list().find((d) => d.toolId === "sirkit.manufacturing.release");
    expect(release).toMatchObject({ discovery: "internal-only", callability: "not-callable", agentExposed: false });
  });
});
