/**
 * B16.0.19 §G/§H — permanent AST-backed confinement gates + human-truth/fail-
 * closed invariants for the tranche-12 circuit-knowledge + circuit-verification
 * migration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm } from "./_boundary-analysis";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const ROUTES = [
  ...["applicability", "compile", "compose", "problem", "propose"].map((r) => `app/api/circuit-knowledge/${r}/route.ts`),
  ...["problem", "propose", "readiness", "run"].map((r) => `app/api/circuit-verification/${r}/route.ts`),
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

describe("B16.0.19 §H — all nine circuit routes are canonical-wrapper adopted", () => {
  it("every route classifies as canonical-wrapper by exact provenance", () => {
    for (const rel of ROUTES) {
      const c = classifyRouteMethodForm(readFileSync(join(ROOT, rel), "utf8"), "POST", join(ROOT, rel), ROOT);
      expect(c.form, rel).toBe("canonical-wrapper");
    }
  });
});

describe("B16.0.19 §H — callback & import confinement (code only)", () => {
  it("every route uses authenticatedJsonRoute; none imports/calls scopedJson; no raw boundary primitives", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).toMatch(/authenticatedJsonRoute\s*\(/);
      expect(src, rel).not.toMatch(/\bscopedJson\b/);
      expect(src, rel).not.toMatch(/\bauthorizeRequest\s*\(/);
      expect(src, rel).not.toMatch(/readBoundedJson(Object|Body)\s*\(/);
      expect(src, rel).not.toMatch(/\bscopedTrustedJson\s*\(/);
      expect(src, rel).not.toMatch(/:\s*Request\b/);
      expect(src, rel).not.toMatch(/\bnew URL\s*\(/);
      expect(src, rel).not.toMatch(/request\.(headers|url|json|text|formData|arrayBuffer|blob|body|signal)\b/);
      expect(src, rel).not.toMatch(/\.headers\.get\s*\(/);
      expect(src, rel).not.toMatch(/\.(cookies|origin|host)\b/);
      expect(src, rel).not.toMatch(/\.(json|text|formData|arrayBuffer|blob)\s*\(\s*\)/);
      expect(src, rel).not.toMatch(/\bfetch\s*\(/);
    }
  });
  it("both scope projectors are Request-free and used by every scope-consuming route", () => {
    expect(code("app/api/circuit-knowledge/_scope.ts")).toMatch(/circuitKnowledgeScopeFromContext\s*\(\s*context\s*:/);
    expect(code("app/api/circuit-verification/_scope.ts")).toMatch(/circuitVerificationScopeFromContext\s*\(\s*context\s*:/);
    for (const rel of ROUTES) {
      const src = code(rel);
      if (/const scope =/.test(src)) expect(src, rel).toMatch(/(circuitKnowledgeScopeFromContext|circuitVerificationScopeFromContext)\s*\(\s*context\s*\)/);
    }
  });
});

describe("B16.0.19 §G — human-truth and fail-closed invariants", () => {
  const raw = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
  it("knowledge proposal stays quarantined: proposal_only, publicationEligible false, low confidence, unknown authority", () => {
    const src = raw("app/api/circuit-knowledge/propose/route.ts");
    expect(src).toMatch(/authority: "proposal_only"/);
    expect(src).toMatch(/publicationEligible: false/);
    expect(src).toMatch(/confidence: "low"/);
    expect(src).toMatch(/authorityAssessment: "unknown"/);
  });
  it("verification remediation cannot mutate anything: all five mutation channels null; proposal-only authority literal", () => {
    const src = raw("app/api/circuit-verification/propose/route.ts");
    for (const channel of ["graphMutation", "schematicMutation", "pcbMutation", "waiverMutation", "readinessMutation"]) {
      expect(src).toMatch(new RegExp(`${channel}: null`));
    }
    // the authority literal lives in the shared agent-tools factory
    expect(raw("app/lib/circuit-verification/agent-tools.ts")).toMatch(/proposal_only_no_design_or_verdict_mutation/);
  });
  it("run remains full-oracle and provider-free; readiness/run/problem never import the provider router", () => {
    for (const r of ["problem", "readiness", "run"]) {
      expect(code(`app/api/circuit-verification/${r}/route.ts`), r).not.toMatch(/llmRouter|generate\s*\(/);
    }
    for (const r of ["applicability", "compile", "compose", "problem"]) {
      expect(code(`app/api/circuit-knowledge/${r}/route.ts`), r).not.toMatch(/llmRouter/);
    }
  });
  it("no circuit route references waiver creation, safety certification, ERC signoff, or manufacturing release", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/releaseManufacturingPackage|manufacturing\.release/);
      expect(src, rel).not.toMatch(/createWaiver|approveWaiver|certifySafety|ercSignoff/);
    }
  });
  it("no circuit route is agent-exposed; total exposed tools remain EXACTLY 12; mfg release internal-only", () => {
    const registry = sirkitToolRegistry();
    const exposed = registry.list().filter((d) => d.agentExposed);
    expect(exposed.length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect(JSON.stringify(exposed)).not.toMatch(/circuit-knowledge|circuit-verification/);
    const release = registry.list().find((d) => d.toolId === "sirkit.manufacturing.release");
    expect(release).toMatchObject({ discovery: "internal-only", callability: "not-callable", agentExposed: false });
  });
});
