/**
 * B16.0.17 §H/§I — permanent AST-backed confinement gates + security/human-
 * truth invariants for the tranche-10 schematic-compiler migration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm } from "./_boundary-analysis";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const NAMES = ["compare", "diff", "export", "graph/validate", "kicad/inspect", "layout", "problem", "propose", "transaction", "variants"];
const ROUTES = NAMES.map((r) => `app/api/schematic-compiler/${r}/route.ts`);
/** Source with comments AND string literals removed — gates inspect CODE only. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

describe("B16.0.17 §H — all ten schematic-compiler methods are canonical-wrapper adopted", () => {
  it("every route classifies as canonical-wrapper by exact provenance", () => {
    for (const rel of ROUTES) {
      const c = classifyRouteMethodForm(readFileSync(join(ROOT, rel), "utf8"), "POST", join(ROOT, rel), ROOT);
      expect(c.form, rel).toBe("canonical-wrapper");
    }
  });
});

describe("B16.0.17 §H — callback & import confinement (code only)", () => {
  it("every route uses authenticatedJsonRoute; none imports/calls scopedJson", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).toMatch(/authenticatedJsonRoute\s*\(/);
      expect(src, rel).not.toMatch(/\bscopedJson\b/);
    }
  });
  it("no direct authorizeRequest / bounded reader / scopedTrustedJson", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/\bauthorizeRequest\s*\(/);
      expect(src, rel).not.toMatch(/readBoundedJson(Object|Body)\s*\(/);
      expect(src, rel).not.toMatch(/\bscopedTrustedJson\s*\(/);
    }
  });
  it("no callback receives Request/Headers; no raw URL/origin/host/cookie access; no request body API", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/:\s*Request\b/);
      expect(src, rel).not.toMatch(/\bnew URL\s*\(/);
      expect(src, rel).not.toMatch(/request\.(headers|url|json|text|formData|arrayBuffer|blob|body|signal)\b/);
      expect(src, rel).not.toMatch(/\.headers\.get\s*\(/);
      expect(src, rel).not.toMatch(/x-forwarded-host/i);
      expect(src, rel).not.toMatch(/\.(cookies|origin|host)\b/);
      expect(src, rel).not.toMatch(/\.(json|text|formData|arrayBuffer|blob)\s*\(\s*\)/);
    }
  });
  it("the scope projector is Request-free and every scope-consuming route uses it", () => {
    const scope = code("app/api/schematic-compiler/_scope.ts");
    expect(scope).toMatch(/schematicCompilerScopeFromContext\s*\(\s*context\s*:/);
    for (const rel of ROUTES) {
      const src = code(rel);
      if (/const scope =/.test(src)) expect(src, rel).toMatch(/schematicCompilerScopeFromContext\s*\(\s*context\s*\)/);
    }
  });
});

describe("B16.0.17 §I — security & human-truth invariants", () => {
  const raw = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
  it("proposal is not mutation: propose returns proposal_only with null graph/diagram/pcb mutations", () => {
    const src = raw("app/api/schematic-compiler/propose/route.ts");
    expect(src).toMatch(/authority: "proposal_only"/);
    expect(src).toMatch(/graphMutation: null/);
    expect(src).toMatch(/diagramMutation: null/);
    expect(src).toMatch(/pcbMutation: null/);
  });
  it("layout is view-only; KiCad inspection is quarantine-only with null semanticImport", () => {
    expect(raw("app/api/schematic-compiler/layout/route.ts")).toMatch(/authority: "view_only"/);
    const inspect = raw("app/api/schematic-compiler/kicad/inspect/route.ts");
    expect(inspect).toMatch(/authority: "quarantine_inspection_only"/);
    expect(inspect).toMatch(/semanticImport: null/);
  });
  it("comparison remains diagnostic and uncertified (none-certified + NO_CERTIFIED_KICAD_SEMANTIC_ADAPTER)", () => {
    const src = raw("app/api/schematic-compiler/compare/route.ts");
    expect(src).toMatch(/"none-certified"/);
    expect(src).toMatch(/NO_CERTIFIED_KICAD_SEMANTIC_ADAPTER/);
  });
  it("export requires human approval and is explicitly non-release", () => {
    const src = raw("app/api/schematic-compiler/export/route.ts");
    expect(src).toMatch(/APPROVED_CD8_HANDOFF_NOT_ERC_SIMULATION_OR_PCB_RELEASE/);
    expect(src).toMatch(/NOT_RELEASED/);
    expect(src).toMatch(/approved_for_CD9/);
  });
  it("no schematic-compiler route can invoke manufacturing release", () => {
    for (const rel of ROUTES) {
      expect(code(rel), rel).not.toMatch(/releaseManufacturingPackage|manufacturing\.release/);
    }
  });
  it("no route becomes an agent tool; the exposed tools equal the intentional list; manufacturing release stays internal-only", () => {
    const registry = sirkitToolRegistry();
    const exposed = registry.list().filter((d) => d.agentExposed);
    expect(exposed.length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect(JSON.stringify(exposed)).not.toMatch(/schematic-compiler/);
    const release = registry.list().find((d) => d.toolId === "sirkit.manufacturing.release");
    expect(release).toMatchObject({ discovery: "internal-only", callability: "not-callable", agentExposed: false });
  });
});
