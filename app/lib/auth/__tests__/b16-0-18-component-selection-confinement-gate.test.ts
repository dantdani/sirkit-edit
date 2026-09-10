/**
 * B16.0.18 §G/§H — permanent AST-backed confinement gates + human-truth/safety
 * invariants for the tranche-11 component-selection migration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm } from "./_boundary-analysis";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const NAMES = ["alternative", "catalog", "evaluate", "export", "feedback", "problem", "propose", "solve", "sourcing", "transaction"];
const ROUTES = NAMES.map((r) => `app/api/component-selection/${r}/route.ts`);
/** Source with comments AND string literals removed — gates inspect CODE only. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

describe("B16.0.18 §H — all ten component-selection methods are canonical-wrapper adopted", () => {
  it("every route classifies as canonical-wrapper by exact provenance", () => {
    for (const rel of ROUTES) {
      const c = classifyRouteMethodForm(readFileSync(join(ROOT, rel), "utf8"), "POST", join(ROOT, rel), ROOT);
      expect(c.form, rel).toBe("canonical-wrapper");
    }
  });
});

describe("B16.0.18 §H — callback & import confinement (code only)", () => {
  it("every route uses authenticatedJsonRoute; none imports/calls scopedJson", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).toMatch(/authenticatedJsonRoute\s*\(/);
      expect(src, rel).not.toMatch(/\bscopedJson\b/);
    }
  });
  it("no direct authorizeRequest / bounded reader / scopedTrustedJson / request body API / raw URL-origin-host-cookie", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/\bauthorizeRequest\s*\(/);
      expect(src, rel).not.toMatch(/readBoundedJson(Object|Body)\s*\(/);
      expect(src, rel).not.toMatch(/\bscopedTrustedJson\s*\(/);
      expect(src, rel).not.toMatch(/:\s*Request\b/);
      expect(src, rel).not.toMatch(/\bnew URL\s*\(/);
      expect(src, rel).not.toMatch(/request\.(headers|url|json|text|formData|arrayBuffer|blob|body|signal)\b/);
      expect(src, rel).not.toMatch(/\.headers\.get\s*\(/);
      expect(src, rel).not.toMatch(/x-forwarded-host/i);
      expect(src, rel).not.toMatch(/\.(cookies|origin|host)\b/);
      expect(src, rel).not.toMatch(/\.(json|text|formData|arrayBuffer|blob)\s*\(\s*\)/);
    }
  });
  it("no fetch/network/distributor call exists in any component-selection route", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/\bfetch\s*\(/);
      expect(src, rel).not.toMatch(/\bhttps?:\b/);
      expect(src, rel).not.toMatch(/digikey|mouser|lcsc|octopart|distributor/i);
    }
  });
  it("the scope projector is Request-free and every scope-consuming route uses it", () => {
    const scope = code("app/api/component-selection/_scope.ts");
    expect(scope).toMatch(/componentSelectionScopeFromContext\s*\(\s*context\s*:/);
    for (const rel of ROUTES) {
      const src = code(rel);
      if (/const scope =/.test(src)) expect(src, rel).toMatch(/componentSelectionScopeFromContext\s*\(\s*context\s*\)/);
    }
  });
});

describe("B16.0.18 §G — human-truth and safety invariants", () => {
  const raw = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
  it("proposal is not selection: propose returns proposal_only with empty hardGateResults and selectedPart null", () => {
    const src = raw("app/api/component-selection/propose/route.ts");
    expect(src).toMatch(/authority: "proposal_only"/);
    expect(src).toMatch(/hardGateResults: \[\]/);
    expect(src).toMatch(/selectedPart: null/);
  });
  it("preliminary export is explicitly unreleased (PRELIMINARY_NOT_RELEASED)", () => {
    expect(raw("app/api/component-selection/export/route.ts")).toMatch(/PRELIMINARY_NOT_RELEASED/);
  });
  it("sourcing refresh remains fail-closed (503 + Retry-After 300, no invented observation)", () => {
    const src = raw("app/api/component-selection/sourcing/route.ts");
    expect(src).toMatch(/503/);
    expect(src).toMatch(/"Retry-After": "300"/);
    expect(src).toMatch(/no live observation was invented/);
  });
  it("feedback preserves the exact consequence mapping", () => {
    const src = raw("app/api/component-selection/feedback/route.ts");
    expect(src).toMatch(/retain_candidate/);
    expect(src).toMatch(/refresh_sourcing_without_rewriting_engineering_history/);
    expect(src).toMatch(/invalidate_affected_assignments_and_rerun_bounded_solver/);
  });
  it("no route purchases components or mutates schematic/PCB state; no manufacturing release reachable", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/purchase|checkout|order|cart/i);
      expect(src, rel).not.toMatch(/releaseManufacturingPackage|manufacturing\.release/);
      expect(src, rel).not.toMatch(/applySchematicTransaction|runEngineeringPlacement|publishBoard/);
    }
  });
  it("no component-selection route is agent-exposed; total exposed tools remain EXACTLY 12; mfg release internal-only", () => {
    const registry = sirkitToolRegistry();
    const exposed = registry.list().filter((d) => d.agentExposed);
    expect(exposed.length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect(JSON.stringify(exposed)).not.toMatch(/component-selection/);
    const release = registry.list().find((d) => d.toolId === "sirkit.manufacturing.release");
    expect(release).toMatchObject({ discovery: "internal-only", callability: "not-callable", agentExposed: false });
  });
});
