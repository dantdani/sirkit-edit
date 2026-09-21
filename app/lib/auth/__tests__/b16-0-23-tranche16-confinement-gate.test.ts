/**
 * B16.0.23 §J — confinement + authority gates for the tranche-16 SPICE
 * migration. Reverting any migrated method to a raw handler, re-introducing
 * raw-Request primitives into a route file, giving the public trio durable or
 * execution access, un-splitting the AI provider/local error boundary,
 * widening the query-selector surface, or dropping the terminal-record guard
 * fails CI here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm } from "./_boundary-analysis";
import { listRouteFiles } from "../route-tree"; // [B20 B2] app/api AND app/.well-known (OD-66); the sole-adopter paths below stay split on /app/api/
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const METHODS: ReadonlyArray<[string, string]> = [
  ["POST", "app/api/spice/ai/route.ts"],
  ["POST", "app/api/spice/compile/route.ts"],
  ["POST", "app/api/spice/models/import/route.ts"],
  ["POST", "app/api/spice/models/smoke-test/route.ts"],
  ["POST", "app/api/spice/reports/route.ts"],
  ["POST", "app/api/spice/run-plans/estimate/route.ts"],
  ["GET", "app/api/spice/runs/route.ts"],
  ["POST", "app/api/spice/runs/route.ts"],
  ["GET", "app/api/spice/runs/[id]/route.ts"],
  ["DELETE", "app/api/spice/runs/[id]/route.ts"],
  ["GET", "app/api/spice/runs/[id]/bundle/route.ts"],
  ["GET", "app/api/spice/runs/[id]/events/route.ts"],
  ["GET", "app/api/spice/runs/[id]/waveforms/route.ts"],
];
const ROUTES = [...new Set(METHODS.map(([, rel]) => rel))];
const PUBLIC_ROUTES = ["app/api/spice/compile/route.ts", "app/api/spice/reports/route.ts", "app/api/spice/run-plans/estimate/route.ts"];

/** Source with comments AND string literals removed — gates inspect CODE only. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}
function raw(rel: string): string { return readFileSync(join(ROOT, rel), "utf8"); }

describe("B16.0.23 §J — canonical adoption (provenance-checked)", () => {
  it("all thirteen tranche-16 methods classify canonical-wrapper", () => {
    for (const [method, rel] of METHODS) {
      const verdict = classifyRouteMethodForm(raw(rel), method, join(ROOT, rel), ROOT);
      expect(verdict.form, `${method} ${rel}`).toBe("canonical-wrapper");
    }
  });
  it("no tranche-16 route file touches raw-Request primitives or the legacy scope/reader helpers", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/new URL\s*\(/);
      expect(src, rel).not.toMatch(/\breq(?:uest)?\s*\.\s*(json|text|body|headers|url|signal)\b/);
      expect(src, rel).not.toMatch(/searchParams/);
      expect(src, rel).not.toMatch(/readBoundedJson|readBoundedStream|boundedJsonRefusalResponse/);
      expect(src, rel).not.toMatch(/\b(spiceRunScope|authorizeRequest)\s*\(/);
    }
  });
});

describe("B16.0.23 §J — public trio is stateless compute only", () => {
  it("compile/reports/estimate import NO durable store, NO worker, NO process/fs/network module, NO auth primitive — publicJsonRoute only", () => {
    for (const rel of PUBLIC_ROUTES) {
      const src = raw(rel);
      expect(src, rel).toMatch(/publicJsonRoute\s*(<|\()/);
      expect(src, rel).not.toMatch(/job-store|server\/worker|child_process|node:fs|node:net|undici|fetch\(/);
      expect(src, rel).not.toMatch(/authorizeRequest|authenticatedJsonRoute|workerJsonRoute/);
    }
  });
  it("the compiler/report/estimator call graph entry modules import no process/network/fs primitive", () => {
    for (const rel of ["app/lib/spice/ir.ts", "app/lib/spice/netlist.ts", "app/lib/spice/readiness.ts", "app/lib/spice/report.ts", "app/lib/spice/run-plan.ts"]) {
      const src = raw(rel);
      expect(src, rel).not.toMatch(/node:child_process|node:fs|node:net|node:http|undici/);
    }
  });
});

describe("B16.0.23 §J — execution boundary (models/smoke-test + worker + store)", () => {
  it("smoke-test: validation dominates execution; the spawn is shell-less, windows-hidden, and server-owned", () => {
    const src = raw("app/api/spice/models/smoke-test/route.ts");
    const safety = src.indexOf("assertModelSafeForExecution(model)");
    const execution = src.indexOf("await execute(path, directory)");
    expect(safety).toBeGreaterThan(0);
    expect(execution).toBeGreaterThan(safety);
    expect(src).toMatch(/spawn\(NGSPICE_EXECUTABLE, \["-b", path\]/); // server-owned exe + args, caller injects nothing
    expect(src).toMatch(/windowsHide: true/);
    expect(src).not.toMatch(/shell\s*:\s*true/);
    expect(raw("app/lib/spice/server/worker.ts")).not.toMatch(/shell\s*:\s*true/);
  });
  it("the job store refuses late terminal overwrites (both settle paths guarded)", () => {
    const src = raw("app/lib/spice/server/job-store.ts");
    const guards = src.match(/if \(TERMINAL\.has\(job\.record\.status\)\) return;/g) ?? [];
    expect(guards.length).toBe(2);
  });
});

describe("B16.0.23 §J — header-less query-selector confinement", () => {
  it("querySelector is declared ONLY by the five run-family GET readers (repo-wide)", () => {
    const adopters = listRouteFiles(ROOT)
      .filter((file) => readFileSync(file, "utf8").includes("querySelector"))
      .map((file) => file.replace(/\\/g, "/").split("/app/api/")[1]!)
      .sort();
    expect(adopters).toEqual([
      "spice/runs/[id]/bundle/route.ts",
      "spice/runs/[id]/events/route.ts",
      "spice/runs/[id]/route.ts",
      "spice/runs/[id]/waveforms/route.ts",
      "spice/runs/route.ts",
    ]);
  });
});

describe("B16.0.23 §J — AI provider boundary structure", () => {
  it("the route ships the _tools module schemas (no inline schema), splits provider vs local errors, and carries the three local codes", () => {
    const src = raw("app/api/spice/ai/route.ts");
    expect(src).toMatch(/import \{ SPICE_TOOL_SCHEMAS, validateSpiceToolInput \} from "\.\/_tools";/);
    expect(src).not.toMatch(/inputSchema:/); // schemas live beside the validator, not inline
    const providerCatches = src.match(/return providerErrorResponse\(error, provider\);/g) ?? [];
    expect(providerCatches.length).toBe(1); // provider-invocation-only
    expect(src.indexOf("llmRouter.generate")).toBeLessThan(src.indexOf("return providerErrorResponse(error, provider);"));
    for (const localCode of ["SPICE_AI_NO_TOOL_CALL", "SPICE_AI_TOOL_INPUT_INVALID", "SPICE_AI_REQUEST_INVALID"]) {
      expect(src).toContain(localCode);
    }
    expect(src).toMatch(/validateSpiceToolInput\(tool\.name, tool\.input\)/);
  });
});

describe("B16.0.23 §J — agent exposure and human-truth wording", () => {
  it("tools remain EXACTLY 12 agent-exposed; no spice route is exposed", () => {
    const registry = sirkitToolRegistry();
    const exposed = registry.list().filter((descriptor) => descriptor.agentExposed);
    expect(exposed.length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect(exposed.some((descriptor) => /spice/i.test(descriptor.toolId))).toBe(false);
  });
  it("no spice route claims signoff, certification, or manufacturing release (comments stripped — the claim surface is code and response strings)", () => {
    for (const rel of ROUTES) {
      const withStrings = raw(rel)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(withStrings, rel).not.toMatch(/signoff|certificat|manufacturing.?release/i);
    }
  });
});
