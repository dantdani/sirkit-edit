import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_COVERAGE_REGISTRY,
  API_ROUTE_COVERAGE,
  isCurrentAgentCallable,
  renderActionToolabilityCsv,
  renderApiRouteCoverageCsv,
  validateActionCoverageRegistry,
} from "../action-registry";
import { scanApiRoutes, scanUiControlFingerprint } from "../action-surface";

const ARTIFACT_DIR = "artifacts/ai-control-plane-b01";

describe("B01 action coverage registry", () => {
  it("has valid, unique, policy-consistent records", () => {
    expect(validateActionCoverageRegistry()).toEqual([]);
    expect(ACTION_COVERAGE_REGISTRY.length).toBeGreaterThanOrEqual(25);
  });

  it("references evidence files that exist in the working repository", () => {
    const missing = ACTION_COVERAGE_REGISTRY.flatMap((record) =>
      record.sources
        .filter((source) => !existsSync(resolve(process.cwd(), source)))
        .map((source) => `${record.id}: ${source}`),
    );
    expect(missing).toEqual([]);
  });

  it("does not equate schema declaration with executable agent coverage", () => {
    const schemaOnly = ACTION_COVERAGE_REGISTRY.filter(
      (record) => record.toolExposure === "schema-only",
    );
    expect(schemaOnly.length).toBeGreaterThan(0);
    expect(schemaOnly.every((record) => !isCurrentAgentCallable(record))).toBe(true);
  });

  it("renders a deterministic complete matrix", () => {
    const first = renderActionToolabilityCsv();
    expect(renderActionToolabilityCsv()).toBe(first);
    expect(first.split("\n")).toHaveLength(ACTION_COVERAGE_REGISTRY.length + 2);
    for (const record of ACTION_COVERAGE_REGISTRY) {
      expect(first).toContain(record.id);
    }
  });
});

describe("B01 CI gates — API route coverage", () => {
  const scanned = scanApiRoutes(process.cwd());
  const declaredByPath = new Map(API_ROUTE_COVERAGE.map((entry) => [entry.path, entry]));

  it("every API route file in the repository is claimed by a registry record", () => {
    const uncovered = scanned
      .filter((route) => !declaredByPath.has(route.path))
      .map((route) => `${route.path} (${route.methods.join(",")}) — add an API_ROUTE_COVERAGE entry and, if needed, a registry record`);
    expect(uncovered).toEqual([]);
  });

  it("every declared route still exists (no stale coverage claims)", () => {
    const scannedPaths = new Set(scanned.map((route) => route.path));
    const stale = API_ROUTE_COVERAGE
      .filter((entry) => !scannedPaths.has(entry.path))
      .map((entry) => `${entry.path} — remove or update its API_ROUTE_COVERAGE entry`);
    expect(stale).toEqual([]);
  });

  it("declared methods match the methods each route file actually exports", () => {
    const drift = scanned.flatMap((route) => {
      const declared = declaredByPath.get(route.path);
      if (!declared) return [];
      const want = [...declared.methods].sort().join(",");
      const have = [...route.methods].sort().join(",");
      return want === have ? [] : [`${route.path}: declared [${want}] but route exports [${have}]`];
    });
    expect(drift).toEqual([]);
  });
});

describe("B01 CI gates — UI actionable-control tripwire", () => {
  it("the committed control fingerprint matches the current UI surfaces", () => {
    const committedPath = resolve(process.cwd(), ARTIFACT_DIR, "ui-control-fingerprint.json");
    expect(existsSync(committedPath), "run: npx tsx scripts/generate-action-toolability-matrix.ts").toBe(true);
    const committed = JSON.parse(readFileSync(committedPath, "utf8")) as ReturnType<typeof scanUiControlFingerprint>;
    const current = scanUiControlFingerprint(process.cwd());
    const problems: string[] = [];
    for (const [file, labels] of Object.entries(current.surfaces)) {
      const known = new Set(committed.surfaces[file] ?? []);
      for (const label of labels) if (!known.has(label)) problems.push(`${file}: NEW actionable control "${label}" — cover it in the action registry, then regenerate the fingerprint`);
      for (const label of committed.surfaces[file] ?? []) if (!labels.includes(label)) problems.push(`${file}: control "${label}" disappeared — update registry status and regenerate the fingerprint`);
    }
    expect(problems).toEqual([]);
  });
});

describe("B01 CI gates — generated artifacts match code", () => {
  it("the committed toolability matrix equals the registry render", () => {
    const committed = readFileSync(resolve(process.cwd(), ARTIFACT_DIR, "ui-command-toolability-matrix.csv"), "utf8");
    expect(committed.replaceAll("\r\n", "\n")).toBe(renderActionToolabilityCsv());
  });

  it("the committed route-coverage matrix equals the registry render", () => {
    const committedPath = resolve(process.cwd(), ARTIFACT_DIR, "api-route-coverage.csv");
    expect(existsSync(committedPath), "run: npx tsx scripts/generate-action-toolability-matrix.ts").toBe(true);
    const committed = readFileSync(committedPath, "utf8");
    expect(committed.replaceAll("\r\n", "\n")).toBe(renderApiRouteCoverageCsv());
  });
});
