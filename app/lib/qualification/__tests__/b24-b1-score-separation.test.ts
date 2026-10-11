/**
 * [B24-B1] Scores per class, never summed (D24-14, OD-203; runbook `:1070` "Keep scores separate so a fake-backed pass cannot hide a
 * missing live test", `:147` "Missing evidence must remain missing or unknown; never invent a pass").
 *
 *  1. the committed scores: the six classes, in order, and nothing else; deterministic offline incomplete (power and ground missing, [B24-B2, 2026-10-08] failing since B24-B2: power-ground's recorded counterexample),
 *     links outside pull-request CI), model-in-loop and external-provider staging BLOCKED-LIVE-QUALIFICATION, physical-hardware
 *     validation failing, browser E2E and database-backed as the JSON records them;
 *  2. a blocked row never counts as covered, on synthetic valid catalogs; an invalid catalog is never scored;
 *  3. a fake-backed pass cannot hide a missing live test: an offline pass leaves the live classes as they are, and the reverse;
 *  4. by type (pinned by tsc, which CI runs - vitest does not type-check): one class's tally is no other's, a sum of two is no tally,
 *     and the scores have no total;
 *  5. stage-09 never reads a run without evidence as a pass: `evaluateRegressionResults` (regression-policy.ts) over a result with no
 *     correctness gate and only blocked statuses evaluated `pass` on 72c1376 (recorded on eval-catalog.md section 9); it is now
 *     insufficient_evidence with NO_EVIDENCE_STATUS, and every run that has evidence evaluates as before.
 *
 * Failing first on 72c1376: the module does not exist, and case 5's counterexample answers `pass`. Nothing is written to disk and no
 * process is started.
 * [B24-B1 review, 2026-10-08] Case 1 reads the committed eval-catalog.json, not a fresh render (correctness-3); case 2 adds a missing row
 * that never counts as covered (correctness-3) and a malformed LB id that is an invalid catalog, never a thrown pattern error
 * (security-3). eval-catalog.md section 16.
 */
import { describe, expect, it } from "vitest";
import { evaluateRegressionResults } from "../../benchmark/regression-policy";
import { benchmarkDigest } from "../../benchmark/stable";
import type { BenchmarkResult, BenchmarkRunStatus, CorrectnessGateResult } from "../../benchmark/types";
import * as catalogModule from "../../evaluation/golden-catalog";
import {
  EVAL_CLASS_IDS,
  GOLDEN_EVAL_CATALOG,
  scoreGoldenCatalog,
  type CatalogRow,
  type EvalClass,
  type EvalLink,
  type Tally,
} from "../../evaluation/golden-catalog";
import { readRepoText } from "./_ci-admission";

const FORBIDDEN_KEY = /total|overall|aggregate|sum|all/i;
const PAGE = "artifacts/ai-control-plane-b24/eval-catalog.md";
const JSON_FILE = "artifacts/ai-control-plane-b24/eval-catalog.json";

/** The committed catalog with every row of one class replaced (the other classes kept as committed). */
function withClass(evalClass: EvalClass, cell: (row: CatalogRow, index: number) => CatalogRow): CatalogRow[] {
  let index = -1;
  return GOLDEN_EVAL_CATALOG.map((row) => {
    if (row.class !== evalClass) return row;
    index += 1;
    return cell(row, index);
  });
}
const browserSpec = (ciJobs: EvalLink["ciJobs"] = ["page-browser-e2e"]): EvalLink => ({ path: "e2e/synthetic.spec.ts", kind: "spec", refs: ["synthetic"], ciJobs });
const offlineSuite = (ciJobs: EvalLink["ciJobs"] = ["prompt-to-gerber"]): EvalLink => ({ path: "app/lib/x/__tests__/synthetic.test.ts", kind: "suite", refs: ["synthetic"], ciJobs });
const bare = (row: CatalogRow): CatalogRow => ({ area: row.area, class: row.class, state: row.state, links: [], liveBlockers: [], note: "" });
const coveredBy = (entry: EvalLink) => (row: CatalogRow): CatalogRow => ({ ...bare(row), state: "covered", links: [entry] });
const blockedOn = (id: string) => (row: CatalogRow): CatalogRow => ({ ...bare(row), state: "blocked", liveBlockers: [id], note: `No live path: synthetic (${id}).` });
const missingFor = (row: CatalogRow): CatalogRow => ({ ...bare(row), state: "missing", owner: "B24-B2", note: "Missing evaluation: synthetic." });

/** A Stage 9 result (stage-09-benchmark-core.test.ts's shape). */
function result(id: string, gates: CorrectnessGateResult[]): BenchmarkResult {
  return { schemaVersion: "sirkit.benchmark-result.v1", resultId: id, runId: `run:${id}`, correctnessGates: gates, metricValues: [], objectiveVector: [], capabilityStates: [], oracleResults: [], unsupportedEvidence: [], warnings: [], exclusions: [], performanceSamples: [], artifactDigests: [], resultDigest: benchmarkDigest({ id }) };
}
const gate = (metricId: string, state: CorrectnessGateResult["state"]): CorrectnessGateResult => ({ gateId: `gate:${metricId}:v1`, metricId, state, critical: true, evidenceRefs: [], explanation: state });

describe("[B24-B1] scores per class, never summed", () => {
  it("1. the committed scores: the six classes in order and nothing else; offline failing ([B24-B2, 2026-10-08] was incomplete until B24-B2's power-ground evaluation), model-in-loop and staging BLOCKED-LIVE-QUALIFICATION, physical failing, browser and database as the JSON records them", () => {
    const scores = scoreGoldenCatalog(GOLDEN_EVAL_CATALOG);
    expect(Object.keys(scores)).toEqual([...EVAL_CLASS_IDS]);
    expect(Object.keys(scores).filter((key) => FORBIDDEN_KEY.test(key))).toEqual([]);
    for (const evalClass of EVAL_CLASS_IDS) {
      expect(scores[evalClass].class).toBe(evalClass);
      expect(Object.keys(scores[evalClass]).filter((key) => FORBIDDEN_KEY.test(key)), evalClass).toEqual([]);
      const rows = GOLDEN_EVAL_CATALOG.filter((row) => row.class === evalClass);
      const score = scores[evalClass];
      expect(score.covered + score.coveredInPart + score.missing + score.blocked + score.failing + score.notApplicable, evalClass).toBe(rows.length); // one class's own rows, never two classes
    }
    const offline = scores.deterministic_offline;
    expect(offline.verdict).toBe("failing"); // [B24-B2, 2026-10-08] reviewed pin move, was "incomplete" (power-ground missing): B24-B2's power/ground evaluation fails on its recorded counterexample (b24-b2-power-ground case 9; D24-16), and a failing row decides the verdict
    expect(offline.missing).toBe(0); // [B24-B2, 2026-10-08] reviewed pin move, was 1: power-ground is evaluated
    expect(GOLDEN_EVAL_CATALOG.filter((row) => row.class === "deterministic_offline" && row.state === "failing").map((row) => row.area)).toEqual(["power-ground"]); // [B24-B2, 2026-10-08] reviewed pin move, was the missing rows, ["power-ground"]
    expect(offline.outsidePullRequestCi).toBeGreaterThan(0);
    expect(offline.notApplicable).toBe(0);
    expect(scores.model_in_loop.verdict).toBe("BLOCKED-LIVE-QUALIFICATION");
    expect(scores.model_in_loop.blocked).toBe(19);
    expect(scores.external_provider_staging.verdict).toBe("BLOCKED-LIVE-QUALIFICATION");
    expect(scores.external_provider_staging.covered + scores.external_provider_staging.coveredInPart).toBe(0);
    expect(scores.physical_hardware.verdict).toBe("failing");
    expect(scores.physical_hardware.failing).toBe(1);
    // [B24-B1 review, 2026-10-08, correctness-3] the committed JSON, not a fresh render of the same function: its scores are these, class by
    // class, and the browser and database verdicts are incomplete (in-part and missing rows; a missing row never counts as covered)
    const recorded = JSON.parse(readRepoText(JSON_FILE)) as { scores: Record<EvalClass, { verdict: string; liveBlockers: string[] }> };
    expect(recorded.scores).toEqual(JSON.parse(JSON.stringify(scores)));
    expect([scores.browser_e2e.verdict, scores.database_backed.verdict]).toEqual(["incomplete", "incomplete"]);
    expect([recorded.scores.browser_e2e.verdict, recorded.scores.database_backed.verdict]).toEqual(["incomplete", "incomplete"]);
    expect(scores.browser_e2e.liveBlockers).toEqual(expect.arrayContaining(["LB-1", "LB-8", "LB-13"]));
    for (const evalClass of EVAL_CLASS_IDS) expect(scores[evalClass].verdict, evalClass).not.toMatch(/pass/i);
  });

  it("2. a blocked row never counts as covered: 18 covered and 1 blocked is incomplete, all blocked is BLOCKED-LIVE-QUALIFICATION with the LB union, one failing is failing; an invalid catalog throws CATALOG_INVALID", () => {
    const eighteen = withClass("browser_e2e", (row, index) => (index === 7 ? blockedOn("LB-8")(row) : coveredBy(browserSpec())(row)));
    expect(scoreGoldenCatalog(eighteen).browser_e2e).toMatchObject({ verdict: "incomplete", covered: 18, blocked: 1, liveBlockers: ["LB-8"] });
    // [B24-B1 review, 2026-10-08, correctness-3] a missing row never counts as covered either: 18 covered and 1 missing, or every row missing
    const eighteenAndMissing = withClass("browser_e2e", (row, index) => (index === 7 ? missingFor(row) : coveredBy(browserSpec())(row)));
    expect(scoreGoldenCatalog(eighteenAndMissing).browser_e2e).toMatchObject({ verdict: "incomplete", covered: 18, missing: 1 });
    expect(scoreGoldenCatalog(withClass("database_backed", missingFor)).database_backed).toMatchObject({ verdict: "incomplete", covered: 0, missing: 19 });
    const allBlocked = withClass("browser_e2e", (row, index) => blockedOn(index % 2 === 0 ? "LB-13" : "LB-1")(row));
    expect(scoreGoldenCatalog(allBlocked).browser_e2e).toMatchObject({ verdict: "BLOCKED-LIVE-QUALIFICATION", covered: 0, blocked: 19, liveBlockers: ["LB-1", "LB-13"] });
    const oneFailing = withClass("browser_e2e", (row, index) => (index === 3 ? { ...coveredBy(browserSpec())(row), state: "failing", recordedResult: { source: "synthetic.md:1", summary: "a recorded failure" } } : coveredBy(browserSpec())(row)));
    expect(scoreGoldenCatalog(oneFailing).browser_e2e).toMatchObject({ verdict: "failing", covered: 18, failing: 1 });
    // the positive control: every row covered and admitted on pull request
    const allCovered = withClass("browser_e2e", coveredBy(browserSpec()));
    expect(scoreGoldenCatalog(allCovered).browser_e2e).toMatchObject({ verdict: "covered", covered: 19, outsidePullRequestCi: 0 });
    // ... and one of them run only on schedule is no pull-request pass
    const nightly = withClass("deterministic_offline", (row, index) => coveredBy(offlineSuite(index === 0 ? ["benchmark-nightly"] : ["prompt-to-gerber"]))(row));
    expect(scoreGoldenCatalog(nightly).deterministic_offline).toMatchObject({ verdict: "incomplete", covered: 19, outsidePullRequestCi: 1 });
    // a class whose every row is not applicable is incomplete, never covered
    const nothing = withClass("database_backed", (row) => ({ ...bare(row), state: "not_applicable", note: "Not applicable: synthetic." }));
    expect(scoreGoldenCatalog(nothing).database_backed.verdict).toBe("incomplete");
    // an invalid catalog is never scored
    expect(() => scoreGoldenCatalog(GOLDEN_EVAL_CATALOG.slice(1))).toThrow(/^CATALOG_INVALID: CATALOG_SHAPE$/);
    expect(() => scoreGoldenCatalog(withClass("model_in_loop", (row) => ({ ...row, liveBlockers: [] })))).toThrow(/^CATALOG_INVALID: LIVE_CLASS_WITHOUT_LB/);
    expect(() => scoreGoldenCatalog(withClass("external_provider_staging", coveredBy(offlineSuite())))).toThrow(/^CATALOG_INVALID: .*LIVE_CLASS_COVERED/);
    // [B24-B1 review, 2026-10-08, security-3] a malformed LB id on an in-part row is an invalid catalog, never a thrown pattern error
    expect(() => scoreGoldenCatalog(GOLDEN_EVAL_CATALOG.map((row) => (row.area === "vias-tracks-geometry" && row.class === "browser_e2e" ? { ...row, liveBlockers: ["LB-8", "LB-("] } : row)))).toThrow(/^CATALOG_INVALID: BLOCKED_WITHOUT_LB$/);
  });

  it("3. a fake-backed pass cannot hide a missing live test: an area covered offline with its model-in-loop row blocked leaves each class's verdict its own", () => {
    const offlinePass = withClass("deterministic_offline", coveredBy(offlineSuite()));
    const before = scoreGoldenCatalog(offlinePass);
    expect(before.deterministic_offline.verdict).toBe("covered");
    expect(before.model_in_loop.verdict).toBe("BLOCKED-LIVE-QUALIFICATION");
    expect(before.model_in_loop).toEqual(scoreGoldenCatalog(GOLDEN_EVAL_CATALOG).model_in_loop);
    // a live row turning failing moves only its own class
    const failingLive = offlinePass.map((row) => (row.area === "placement-routing" && row.class === "model_in_loop" ? { ...row, state: "failing" as const, recordedResult: { source: "synthetic.md:1", summary: "a recorded live failure" } } : row));
    const after = scoreGoldenCatalog(failingLive);
    expect(after.model_in_loop.verdict).toBe("failing");
    expect(after.deterministic_offline).toEqual(before.deterministic_offline);
    for (const evalClass of ["browser_e2e", "database_backed", "external_provider_staging", "physical_hardware"] as const) expect(after[evalClass], evalClass).toEqual(before[evalClass]);
    // no export of the module adds classes up
    expect(Object.keys(catalogModule).filter((name) => /total|overall|aggregate|sum/i.test(name))).toEqual([]);
  });

  it("4. by type: one class's tally is not another's, a sum of two is no tally, and the scores have no total (tsc enforces the three @ts-expect-error lines)", () => {
    const scores = scoreGoldenCatalog(GOLDEN_EVAL_CATALOG);
    // @ts-expect-error - a model-in-loop tally is not assignable to a deterministic-offline tally
    const offline: Tally<"deterministic_offline"> = scores.model_in_loop.covered;
    // @ts-expect-error - the sum of two classes' tallies is a number, never a tally of either class
    const added: Tally<"model_in_loop"> = scores.model_in_loop.covered + scores.deterministic_offline.covered;
    // @ts-expect-error - the scores have no total
    const total: unknown = scores.total;
    expect(offline).toBe(scores.model_in_loop.covered);
    expect(added).toBe(scores.model_in_loop.covered + scores.deterministic_offline.covered);
    expect(total).toBeUndefined();
    const own: Tally<"model_in_loop"> = scores.model_in_loop.blocked;
    expect(own).toBe(19);
  });

  it("5. stage-09 never reads a run without evidence as a pass (D24-14): no passed or completed_with_unknowns status is insufficient_evidence with NO_EVIDENCE_STATUS; a run with evidence evaluates as before", () => {
    const noGates = result("blocked", []);
    // the counterexample (72c1376: state "pass", reasons [])
    expect(evaluateRegressionResults([noGates], ["blocked_by_prerequisite"], "pull_request_correctness")).toMatchObject({ state: "insufficient_evidence", reasons: ["NO_EVIDENCE_STATUS"], statusDenominators: { blocked_by_prerequisite: 1 } });
    for (const statuses of [["unsupported"], ["license_unavailable"], ["not_comparable"], [], ["blocked_by_prerequisite", "unsupported"]] as BenchmarkRunStatus[][]) {
      expect(evaluateRegressionResults([noGates], statuses, "pull_request_correctness"), statuses.join("+") || "none").toMatchObject({ state: "insufficient_evidence", reasons: ["NO_EVIDENCE_STATUS"] });
    }
    // over a gated profile a blocked run stays a (misreported) correctness block, now with NO_EVIDENCE_STATUS among its reasons
    const unknown = evaluateRegressionResults([result("gated", [gate("correctness.parse_valid", "unknown"), gate("correctness.hard_failures", "unknown")])], ["blocked_by_prerequisite"], "pull_request_correctness");
    expect(unknown.state).toBe("block");
    expect(unknown.reasons).toEqual(["CRITICAL_GATE:correctness.hard_failures:unknown", "CRITICAL_GATE:correctness.parse_valid:unknown", "NO_EVIDENCE_STATUS"]);
    // a run with evidence evaluates on its evidence, every status in the denominators
    expect(evaluateRegressionResults([result("ok", [gate("correctness.hard_failures", "passed")])], ["passed", "blocked_by_prerequisite"], "pull_request_correctness")).toEqual({ state: "pass", reasons: [], statusDenominators: { passed: 1, blocked_by_prerequisite: 1 }, elapsedP95Ms: null });
    expect(evaluateRegressionResults([noGates], ["completed_with_unknowns"], "pull_request_correctness").state).toBe("pass");
    // stage-09's own case (:183) still blocks
    expect(evaluateRegressionResults([result("bad", [gate("correctness.hard_failures", "failed")])], ["failed_correctness"], "pull_request_correctness")).toMatchObject({ state: "block", statusDenominators: { failed_correctness: 1 } });
    // no results at all stays insufficient
    expect(evaluateRegressionResults([], [], "pull_request_correctness")).toMatchObject({ state: "insufficient_evidence", reasons: ["NO_EVIDENCE_STATUS", "NO_RESULTS"] });
    // the page records the counterexample and the limitation
    const page = readRepoText(PAGE);
    for (const fragment of ["NO_EVIDENCE_STATUS", "insufficient_evidence", "CRITICAL_GATE:correctness.parse_valid:unknown", "sirkit.benchmark-regression-policy/1.0.0"]) expect(page, fragment).toContain(fragment);
  });
});
