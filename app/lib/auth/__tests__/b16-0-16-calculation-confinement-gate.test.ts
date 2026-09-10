/**
 * B16.0.16 §G/§H — permanent AST-backed confinement gates + no-misleading-
 * authority assertions for the tranche-9 calculation migration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm } from "./_boundary-analysis";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const ROUTES = ["corners", "evaluate", "export", "feedback", "problem", "propose", "report", "transaction"].map((r) => `app/api/calculation/${r}/route.ts`);
/** Source with comments AND string literals removed — the gate must inspect
 *  CODE, never prose or a string that could satisfy/defeat it. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

describe("B16.0.16 §H — all eight calculation methods are canonical-wrapper adopted", () => {
  it("every route classifies as canonical-wrapper by exact provenance", () => {
    for (const rel of ROUTES) {
      const c = classifyRouteMethodForm(readFileSync(join(ROOT, rel), "utf8"), "POST", join(ROOT, rel), ROOT);
      expect(c.form, rel).toBe("canonical-wrapper");
    }
  });
});

describe("B16.0.16 §H — callback & import confinement (AST-backed, code only)", () => {
  it("every route uses authenticatedJsonRoute from the sanctioned module and no wrapper alias", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).toMatch(/authenticatedJsonRoute\s*\(/);
      expect(src, rel).toMatch(/from\s+@\/app\/lib\/auth\/route-handlers|from\s+""/); // import path (string stripped → "")
    }
  });
  it("no route imports or calls scopedJson", () => {
    for (const rel of ROUTES) expect(code(rel), rel).not.toMatch(/\bscopedJson\b/);
  });
  it("no route does direct authorizeRequest / bounded-body reads / scopedTrustedJson", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/\bauthorizeRequest\s*\(/);
      expect(src, rel).not.toMatch(/readBoundedJson(Object|Body)\s*\(/);
      expect(src, rel).not.toMatch(/\bscopedTrustedJson\s*\(/);
    }
  });
  it("no route callback receives Request/Headers or touches raw url/host/origin/cookies or a raw body reader", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/:\s*Request\b/);
      expect(src, rel).not.toMatch(/\bnew URL\s*\(/);
      expect(src, rel).not.toMatch(/request\.(headers|url|json|text|formData|arrayBuffer|blob|body|signal)\b/);
      expect(src, rel).not.toMatch(/\.headers\.get\s*\(/);
      expect(src, rel).not.toMatch(/x-forwarded-host/i);
      expect(src, rel).not.toMatch(/\.(cookies|origin|host)\b/);
    }
  });
  it("no request.json/text/formData/arrayBuffer/blob anywhere", () => {
    for (const rel of ROUTES) expect(code(rel), rel).not.toMatch(/\.(json|text|formData|arrayBuffer|blob)\s*\(\s*\)/);
  });
  it("_scope.ts projector is Request-free (no Request param, no reader, no new URL)", () => {
    const src = code("app/api/calculation/_scope.ts");
    expect(src).toMatch(/calculationScopeFromContext/);
    // the projector itself takes a context, not a Request
    expect(src).toMatch(/calculationScopeFromContext\s*\(\s*context\s*:/);
    expect(src).not.toMatch(/\bnew URL\s*\(/);
  });
  it("every scope-consuming route builds its scope from calculationScopeFromContext(context)", () => {
    for (const rel of ["export", "problem", "propose", "report", "transaction"].map((r) => `app/api/calculation/${r}/route.ts`)) {
      expect(code(rel), rel).toMatch(/calculationScopeFromContext\s*\(\s*context\s*\)/);
    }
  });
});

describe("B16.0.16 §G — no misleading authority", () => {
  it("propose returns proposal_only authority with empty numeric/decision outputs (source pins)", () => {
    const raw = readFileSync(join(ROOT, "app/api/calculation/propose/route.ts"), "utf8");
    expect(raw).toMatch(/authority: "proposal_only"/);
    expect(raw).toMatch(/calculatedResults: \[\]/);
    expect(raw).toMatch(/decisions: \[\]/);
  });
  it("export is explicitly a non-release handoff, never schematic/PCB/manufacturing release", () => {
    const raw = readFileSync(join(ROOT, "app/api/calculation/export/route.ts"), "utf8");
    expect(raw).toMatch(/APPROVED_CALCULATION_HANDOFF_NOT_A_SCHEMATIC_OR_PCB_RELEASE/);
    expect(raw).toMatch(/NOT_RELEASED/);
  });
  it("no calculation route can invoke manufacturing release", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/releaseManufacturingPackage|manufacturing\/release|manufacturing\.release/);
    }
  });
  it("no calculation route is agent-exposed and total exposed tools remain EXACTLY 12", () => {
    const exposed = sirkitToolRegistry().list().filter((d) => d.agentExposed);
    expect(exposed.length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect(JSON.stringify(exposed)).not.toMatch(/api\/calculation|calculation\.(propose|evaluate|report|transaction|export)/);
  });
});
