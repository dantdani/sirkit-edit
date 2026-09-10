/**
 * [B17-A] CI gates over the UI control inventory.
 *
 *  1. every actionable control the scanner finds has exactly one classification
 *     (a NEW control without a registry rule fails; a stale rule fails);
 *  2. the committed inventory byte-matches the render (a changed control is
 *     reviewed by regenerating: npx tsx scripts/generate-b17-control-inventory.ts);
 *  3. semantic/dispatcher classifications reach existing registry records, and
 *     every `implemented` record has a REAL entry point (a control or an API
 *     route) — a record without a handler fails;
 *  4. no registry record's sources call a retired route (every `/api/...`
 *     literal in a record's sources is an existing route);
 *  5. a control whose handler does nothing (`noop`) must be classified
 *     internal or unavailable — a silent control fails;
 *  6. unavailable controls carry a visible reason.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE } from "../action-registry";
import { scanApiRoutes } from "../action-surface";
import { classifyControlSites, CONTROL_RULES, renderControlInventoryCsv, summarizeControlInventory, validateControlRules } from "../control-registry";
import { scanControlSites } from "../control-surface";

const ARTIFACT_DIR = "artifacts/ai-control-plane-b17";
const cwd = process.cwd();
const sites = scanControlSites(cwd);
const { classified, unmatched, unusedRules } = classifyControlSites(sites);

describe("B17-A — control inventory gates", () => {
  it("1. the rules are structurally valid; every scanned control matches exactly one rule; no rule is stale", () => {
    expect(validateControlRules()).toEqual([]);
    expect(unmatched.map((site) => `${site.key} (line ${site.line}) — add a rule in app/lib/engineering/control-registry.ts`)).toEqual([]);
    expect(unusedRules.map((rule) => `${rule.id} matches no control — remove or fix the rule`)).toEqual([]);
    expect(sites.length).toBeGreaterThan(400); // the inventory is the whole application, never a sample
  });

  it("2. the committed inventory equals the render (regenerate to review a new or changed control)", () => {
    const committed = resolve(cwd, ARTIFACT_DIR, "ui-control-inventory.csv");
    expect(existsSync(committed), "run: npx tsx scripts/generate-b17-control-inventory.ts").toBe(true);
    expect(readFileSync(committed, "utf8").replaceAll("\r\n", "\n")).toBe(renderControlInventoryCsv(classified));
    const summary = JSON.parse(readFileSync(resolve(cwd, ARTIFACT_DIR, "ui-control-inventory-summary.json"), "utf8")) as ReturnType<typeof summarizeControlInventory>;
    expect(summary).toEqual(summarizeControlInventory(classified));
  });

  it("3. semantic/dispatcher controls reach existing records; every implemented record has a real entry point (control or route)", () => {
    const records = new Map(ACTION_COVERAGE_REGISTRY.map((record) => [record.id, record]));
    const reached = new Set(classified.flatMap((row) => row.recordIds));
    const routed = new Set(API_ROUTE_COVERAGE.map((entry) => entry.recordId));
    for (const id of reached) expect(records.has(id), `control reaches unknown record ${id}`).toBe(true);
    // Records that run as EFFECTS of other operations have a real handler but no control of their own.
    const EFFECT_DRIVEN: Record<string, string> = { "project.autosave": "runs after every committed operation (app/lib/project/autosave.ts); no control by design" };
    const handlerless = ACTION_COVERAGE_REGISTRY
      .filter((record) => record.status === "implemented" && !reached.has(record.id) && !routed.has(record.id) && !(record.id in EFFECT_DRIVEN))
      .map((record) => `${record.id}: implemented but no control and no route reaches it`);
    expect(handlerless).toEqual([]);
    // ui-only records must be reached by at least one view control; api-only by at least one route; missing by neither.
    for (const record of ACTION_COVERAGE_REGISTRY) {
      if (record.status === "ui-only") expect(reached.has(record.id), `${record.id} is ui-only but no control reaches it`).toBe(true);
      if (record.status === "api-only") expect(routed.has(record.id), `${record.id} is api-only but no route reaches it`).toBe(true);
      if (record.status === "missing") expect(reached.has(record.id) || routed.has(record.id), `${record.id} is 'missing' yet reachable`).toBe(false);
    }
  });

  it("4. no registry record's sources call a retired route", () => {
    const routes = new Set(scanApiRoutes(cwd).map((route) => route.path.replace(/\/\[[^\]]+\]/g, "/*")));
    const problems: string[] = [];
    const checked = new Set<string>();
    for (const record of ACTION_COVERAGE_REGISTRY) {
      for (const source of record.sources) {
        if (checked.has(source) || !existsSync(resolve(cwd, source)) || !statSync(resolve(cwd, source)).isFile()) continue;
        checked.add(source);
        const text = readFileSync(resolve(cwd, source), "utf8");
        for (const match of text.matchAll(/["'`](\/api\/[a-z0-9\-/[\]]+?)["'`?]/g)) {
          const path = match[1]!.replace(/\/$/, "").replace(/\/\[[^\]]+\]/g, "/*");
          const known = routes.has(path) || [...routes].some((route) => route.startsWith(path + "/") || (route.includes("/*") && new RegExp("^" + route.replace(/\*/g, "[^/]+") + "$").test(path)));
          if (!known) problems.push(`${source} (record ${record.id}) references ${match[1]} which is not an app/api route`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("5. a control whose handler does nothing is classified internal or unavailable — never silent", () => {
    const silent = classified
      .filter((row) => (row.handler === "noop" || row.handler === "undefined") && row.classification !== "internal" && row.classification !== "unavailable")
      .map((row) => `${row.key}: no handler yet classified ${row.classification}`);
    expect(silent).toEqual([]);
  });

  it("6. unavailable controls carry a visible reason; every rule is reachable by id", () => {
    for (const row of classified) if (row.classification === "unavailable") expect(row.reason.length, row.key).toBeGreaterThan(0);
    expect(new Set(CONTROL_RULES.map((rule) => rule.id)).size).toBe(CONTROL_RULES.length);
  });
});
