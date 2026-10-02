/**
 * B16.0.21 §C/§D/§E/§G — confinement + authority gates for the tranche-14
 * migration (firmware-bringup, full-flow, release-engineering).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm } from "./_boundary-analysis";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const scopeOverride = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("@/app/api/full-flow/_scope", async (orig) => {
  const actual = await orig() as { fullFlowScopeFromContext: (c: unknown) => unknown };
  return { ...actual, fullFlowScopeFromContext: (c: unknown) => scopeOverride.value ?? actual.fullFlowScopeFromContext(c) };
});
import { POST as ffTransition } from "../../../api/full-flow/transition/route";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const ROUTES = [
  "app/api/firmware-bringup/problem/route.ts", "app/api/firmware-bringup/propose/route.ts", "app/api/firmware-bringup/resources/route.ts",
  "app/api/full-flow/propose/route.ts", "app/api/full-flow/run/route.ts", "app/api/full-flow/transition/route.ts",
  "app/api/release-engineering/problem/route.ts", "app/api/release-engineering/propose/route.ts",
];
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

describe("B16.0.21 §D — the CORRECTED transition gate (fail-open reproduced pre-edit, now closed)", () => {
  it.each(["ai", "automated_engine", "import_adapter", "system_migration"])("%s actor is now REFUSED 403 (pre-edit only 'ai' was; automated_engine passed — recorded)", async (kind) => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" });
    scopeOverride.value = { tenantId: "local", projectId: "proj-1", branchId: "main", actorId: "agent-1", actorKind: kind, role: "reviewer", sessionId: "s1" };
    const res = await ffTransition(new Request("http://localhost/api/full-flow/transition", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: "{}" }));
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("LLM proposals cannot commit run transitions");
  });
  it("a human actor still passes the gate to typed-input validation", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" });
    const res = await ffTransition(new Request("http://localhost/api/full-flow/transition", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: "{}" }));
    expect(res.status).toBe(400); // past the gate → typed run transition required
  });
});

describe("B16.0.21 §G — canonical adoption + confinement (code only)", () => {
  it("all eight routes classify canonical-wrapper; use authenticatedJsonRoute; no scoped*Json/raw primitives", () => {
    for (const rel of ROUTES) {
      const c = classifyRouteMethodForm(readFileSync(join(ROOT, rel), "utf8"), "POST", join(ROOT, rel), ROOT);
      expect(c.form, rel).toBe("canonical-wrapper");
      const src = code(rel);
      expect(src, rel).toMatch(/authenticatedJsonRoute\s*\(/);
      expect(src, rel).not.toMatch(/scopedCd1[123]Json/);
      expect(src, rel).not.toMatch(/\bauthorizeRequest\s*\(|readBoundedJson(Object|Body)\s*\(|\bscopedTrustedJson\s*\(/);
      expect(src, rel).not.toMatch(/:\s*Request\b|new URL\s*\(|request\.(headers|url|json|text|body|signal)\b|\.headers\.get\s*\(|\.(cookies|origin|host)\b/);
      expect(src, rel).not.toMatch(/\.(json|text|formData|arrayBuffer|blob)\s*\(\s*\)/);
    }
  });
  it("ZERO firmware-device / process / network execution surface in any route", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/child_process|spawnSync|\bspawn\s*\(|execFile|\bexec\s*\(|Worker\s*\(|serialport|jtag|swd|openocd|flash/i);
      expect(src, rel).not.toMatch(/\bfetch\s*\(/);
      expect(src, rel).not.toMatch(/llmRouter|providerErrorResponse/);
    }
  });
  it("no manufacturing-release minting or schematic/PCB mutation authority is reachable", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/releaseManufacturingPackage|manufacturing\.release|DurableManufacturingAuthorityStore/);
      expect(src, rel).not.toMatch(/applySchematicTransaction|publishBoard|runEngineeringPlacement/);
    }
  });
  it("all three family scope projectors are Request-free and used by every route", () => {
    for (const [scope, projector] of [
      ["app/api/firmware-bringup/_scope.ts", "firmwareBringupScopeFromContext"],
      ["app/api/full-flow/_scope.ts", "fullFlowScopeFromContext"],
      ["app/api/release-engineering/_scope.ts", "releaseEngineeringScopeFromContext"],
    ] as const) {
      expect(code(scope), scope).toMatch(new RegExp(`${projector}\\s*\\(\\s*context\\s*:`));
    }
    for (const rel of ROUTES) {
      expect(code(rel), rel).toMatch(/(firmwareBringup|fullFlow|releaseEngineering)ScopeFromContext\s*\(/);
    }
  });
});

describe("B16.0.21 §C/§E — human-truth invariants", () => {
  const raw = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
  it("firmware routes claim no physical validation; problem requires a human compiler", () => {
    expect(raw("app/api/firmware-bringup/problem/route.ts")).toMatch(/AI may propose but cannot compile an authoritative CD-11 problem/);
    expect(raw("app/api/firmware-bringup/propose/route.ts")).toMatch(/requiresHumanReview: true/);
  });
  it("full-flow: run creates NO authoritative artifacts; propose declares its non-authority flags; transitions are server-machine-only", () => {
    expect(raw("app/api/full-flow/run/route.ts")).toMatch(/authoritativeEngineeringArtifactsCreated: false/);
    const propose = raw("app/api/full-flow/propose/route.ts");
    expect(propose).toMatch(/requiresDeterministicPolicy: true/);
    expect(propose).toMatch(/requiresOwningStageForEngineeringCommit: true/);
    expect(propose).toMatch(/externalSideEffects: false/);
    expect(raw("app/api/full-flow/transition/route.ts")).toMatch(/transitionRun\(/); // the ONE server state machine
  });
  it("release-engineering remains proposal/problem-only: human compiler gate + non-certifying flags", () => {
    expect(raw("app/api/release-engineering/problem/route.ts")).toMatch(/AI may propose but cannot compile an authoritative CD-12 release problem/);
    const propose = raw("app/api/release-engineering/propose/route.ts");
    expect(propose).toMatch(/requiresHumanReview: true/);
    expect(propose).toMatch(/hasExternalOrPurchasingSideEffects: false/);
  });
  it("no route is agent-exposed; tools EXACTLY the intentional agent-exposed set (12 when written; the set has since grown by reviewed moves, B22-B's three named computation reads among them, and the assertion counts the set itself); manufacturing release internal-only", () => { // [B22 closeout, 2026-10-02] retitled (D22-16): the derived count, 36 since B22-B (OD-139); assertions unchanged
    const registry = sirkitToolRegistry();
    const exposed = registry.list().filter((d) => d.agentExposed);
    expect(exposed.length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect(JSON.stringify(exposed)).not.toMatch(/firmware-bringup|full-flow|release-engineering/);
    const release = registry.list().find((d) => d.toolId === "sirkit.manufacturing.release");
    expect(release).toMatchObject({ discovery: "internal-only", callability: "not-callable", agentExposed: false });
  });
});
