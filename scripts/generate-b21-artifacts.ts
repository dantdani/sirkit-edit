/**
 * [B21 F] The ONE deterministic generator of B21-F's evaluation artifacts:
 *   artifacts/ai-control-plane-b21/evaluation-matrix.csv   (the twelve runbook evaluations; byte-gated)
 *   artifacts/ai-control-plane-b21/evaluation-matrix.json  (the same rows, canonical JSON; byte-gated)
 *   artifacts/ai-control-plane-b21/replay-trace-pins-b21.json (the `orchestration` category's v4 replay digests; pinned)
 *
 * Everything is computed from the REAL runtime through provider-free replays (no provider, database or network call): the case
 * table is `_f-cases.ts`, the capsules and the task-graph runner `_f-capsules.ts`. Output is byte-stable across runs. It extends the
 * B11 pins (artifacts/ai-control-plane-b11/replay-trace-pins.json, written by generate-b11-artifacts.ts) and never rewrites them.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluationMatrixCsv, evaluationMatrixJson } from "../app/lib/agent/orchestration/__tests__/_f-cases";
import { B11_REPLAY_PINS_FILE, B21_REPLAY_PINS_FILE, buildOrchestrationEvaluationCases, replayPinsDocument, runOrchestrationCase, scoreOrchestrationCase } from "../app/lib/agent/orchestration/__tests__/_f-capsules";

const root = process.cwd();
const outDir = join(root, "artifacts", "ai-control-plane-b21");
mkdirSync(outDir, { recursive: true });

async function main(): Promise<void> {
  writeFileSync(join(outDir, "evaluation-matrix.csv"), evaluationMatrixCsv());
  writeFileSync(join(outDir, "evaluation-matrix.json"), evaluationMatrixJson());
  const pins: Record<string, { trace: string; replay: string }> = {};
  const failed: string[] = [];
  for (const entry of buildOrchestrationEvaluationCases()) {
    const replay = await runOrchestrationCase(entry);
    const scored = scoreOrchestrationCase(entry, replay);
    pins[entry.caseId] = { trace: replay.traceDigest, replay: replay.replayDigest };
    if (!scored.passed) failed.push(`${entry.caseId}: ${scored.checks.filter((item) => !item.pass).map((item) => `${item.id} (${item.detail})`).join(" | ")}`);
  }
  const b11 = createHash("sha256").update(readFileSync(join(root, B11_REPLAY_PINS_FILE))).digest("hex");
  writeFileSync(join(root, B21_REPLAY_PINS_FILE), replayPinsDocument(pins, b11));
  console.log(`B21-F evaluation artifacts: 12 matrix rows, ${Object.keys(pins).length} orchestration replays pinned -> ${outDir}`);
  if (failed.length > 0) {
    for (const line of failed) console.log(`  FAILED ${line}`);
    process.exitCode = 1;
  }
}

void main();
