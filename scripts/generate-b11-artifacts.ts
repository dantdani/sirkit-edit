/**
 * B11 — the ONE deterministic evaluation artifact generator:
 *   artifacts/ai-control-plane-b11/replay-trace-pins.json
 *   artifacts/ai-control-plane-b11/evaluation-case-matrix.csv
 *   artifacts/ai-control-plane-b11/evaluation-results.json
 *
 * Everything is computed from the REAL control plane through the
 * provider-free replay engine (no provider, database, or network call).
 * Output is byte-stable across runs: the replay clock is a deterministic
 * counter and every document is canonical JSON.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../app/lib/engineering/stable";
import { buildEvaluationCases } from "../app/lib/agent/evaluation-cases";
import { runEvaluationSuite } from "../app/lib/agent/evaluation";
import { replayCapsule } from "../app/lib/agent/replay-capsule";

const outDir = join(process.cwd(), "artifacts", "ai-control-plane-b11");
mkdirSync(outDir, { recursive: true });

async function main(): Promise<void> {
  // 1. Compute the trace digest for every case (expectations not compared).
  const unpinned = buildEvaluationCases({});
  const pins: Record<string, string> = {};
  for (const evaluationCase of unpinned) {
    const outcome = await replayCapsule(evaluationCase.capsule, { ...evaluationCase.options, computeOnly: true });
    pins[evaluationCase.caseId] = outcome.traceDigest;
  }
  writeFileSync(join(outDir, "replay-trace-pins.json"), canonicalJson({ schema: "sirkit.agent-replay-trace-pins.v1", pins }) + "\n");

  // 2. Score the full suite against the pinned expectations.
  const cases = buildEvaluationCases(pins);
  const report = await runEvaluationSuite(cases);
  writeFileSync(join(outDir, "evaluation-results.json"), canonicalJson(report) + "\n");

  // 3. The human-readable case matrix.
  const csvCell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const header = ["case_id", "category", "title", "provider", "advertised_tools", "tool_outcomes", "terminal_outcome", "terminal_reason", "checks", "passed"];
  const rows = cases.map((evaluationCase) => {
    const result = report.results.find((item) => item.caseId === evaluationCase.caseId)!;
    return [
      evaluationCase.caseId,
      evaluationCase.category,
      evaluationCase.title,
      evaluationCase.capsule.provider,
      result.discoveredTools.join(";") || "(none)",
      result.terminal.outcome === "completed" || result.terminal.outcome === "failed"
        ? evaluationCase.capsule.expected.toolOutcomes.map((outcome) => `${outcome.toolId}=${outcome.status}`).join(";") || "(none)"
        : "(none)",
      result.terminal.outcome,
      result.terminal.failureReason ?? "(none)",
      String(result.checks.length),
      String(result.passed),
    ].map(csvCell).join(",");
  });
  writeFileSync(join(outDir, "evaluation-case-matrix.csv"), [header.join(","), ...rows].join("\n") + "\n");

  const failed = report.results.filter((result) => !result.passed);
  console.log(`B11 evaluation: ${report.totals.passed}/${report.totals.cases} cases, ${report.totals.checksPassed}/${report.totals.checks} checks → ${outDir}`);
  if (failed.length > 0) {
    for (const result of failed) console.log(`  FAILED ${result.caseId}: ${result.checks.filter((check) => !check.pass).map((check) => `${check.id} (${check.detail})`).join(" | ")}`);
    process.exitCode = 1;
  }
}

void main();
