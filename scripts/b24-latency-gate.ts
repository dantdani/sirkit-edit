/**
 * [B24-D1] D24-27, D24-28, OD-212 - the latency gate: `pnpm exec tsx scripts/b24-latency-gate.ts [--baseline <results files...>]`.
 *
 * Without arguments it reads only the `*.latency-results.json` files of schema sirkit.latency-results.v1 in SIRKIT_B24_BENCHMARK_DIR
 * (resolved and refused as the writer resolves it; route-bench.json and every other file are ignored), evaluates them against the
 * latest version of artifacts/ai-control-plane-b24/latency-baseline.json (app/lib/qualification/latency-policy.ts), writes the table
 * to $GITHUB_STEP_SUMMARY (when set) and to latency-gate.md and latency-gate.json in the directory, and exits 1 on any blocking state.
 * While the latest version is the declared-without-values v1, `baseline_missing` is written as BLOCKED (OD-212/OD-30: baseline not
 * recorded; Actions minutes not accepted) and does not by itself fail the step (lead decision D3); `unmeasured`, `sample_shortfall`
 * and a regression always do. An empty directory gives `unmeasured` for every catalogued metric.
 *
 * With `--baseline <results files...>` (at least three runs' files, each run's files named as `<runId>=<path>`) it prints the proposed
 * next baseline version to stdout and writes nothing: the lead reviews and appends it.
 */
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { baselineWideningProblems, evaluateLatency, latencyBaselineProblems, latencyResultsProblems, proposeLatencyBaseline, renderLatencyTable, type LatencyBaselineDocument, type LatencyResultsDocument } from "../app/lib/qualification/latency-policy";
import { LATENCY_RESULTS_SCHEMA, RESULTS_FILE_SUFFIX, resolveBenchmarkDirectory } from "../app/lib/qualification/latency-results-writer";

const BASELINE_PATH = "artifacts/ai-control-plane-b24/latency-baseline.json";

/** The committed baseline: its shape, then every consecutive pair's widening rule ([B24-D1 review, 2026-10-09]: a widening or a dropped value committed later fails the gate, never silently). */
function readBaseline(): LatencyBaselineDocument {
  const document = JSON.parse(readFileSync(resolve(process.cwd(), BASELINE_PATH), "utf8")) as unknown;
  const problems = latencyBaselineProblems(document);
  if (problems.length > 0) throw new Error(`LATENCY_BASELINE_INVALID: ${problems.join(", ")}`);
  const widening = baselineWideningProblems(document as LatencyBaselineDocument);
  if (widening.length > 0) throw new Error(`LATENCY_BASELINE_UNREVIEWED_WIDENING: ${widening.join(", ")}`);
  return document as LatencyBaselineDocument;
}

function readResults(path: string): LatencyResultsDocument | null {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { schema?: unknown };
  if (parsed?.schema !== LATENCY_RESULTS_SCHEMA) return null;
  const problems = latencyResultsProblems(parsed);
  if (problems.length > 0) throw new Error(`LATENCY_RESULTS_INVALID: ${path}: ${problems.join(", ")}`);
  return parsed as LatencyResultsDocument;
}

function gate(): number {
  const resolved = resolveBenchmarkDirectory(process.env, process.cwd());
  if (!resolved.ok) {
    process.stderr.write(`LATENCY_RESULTS_DIR_REFUSED: SIRKIT_B24_BENCHMARK_DIR ${resolved.refusal}\n`);
    return 2;
  }
  const files = readdirSync(resolved.directory).filter((name) => name.endsWith(RESULTS_FILE_SUFFIX)).sort();
  const results = files.map((name) => readResults(join(resolved.directory, name))).filter((document): document is LatencyResultsDocument => document !== null);
  const evaluation = evaluateLatency(results, readBaseline());
  const table = renderLatencyTable(evaluation);
  const heading = `## B24-D1 latency gate (${results.length} results file${results.length === 1 ? "" : "s"}: ${files.join(", ") || "none"})\n\n`;
  process.stdout.write(`${heading}${table}`);
  writeFileSync(join(resolved.directory, "latency-gate.md"), `${heading}${table}`, "utf8");
  writeFileSync(join(resolved.directory, "latency-gate.json"), `${JSON.stringify(evaluation, null, 2)}\n`, "utf8");
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${heading}${table}`, "utf8");
  return evaluation.blocking ? 1 : 0;
}

function baseline(arguments_: readonly string[]): number {
  const runs = new Map<string, LatencyResultsDocument[]>();
  for (const argument of arguments_) {
    const at = argument.indexOf("=");
    if (at <= 0) throw new Error(`LATENCY_BASELINE_ARGUMENT: expected <runId>=<path>, got ${argument}`);
    const runId = argument.slice(0, at);
    const document = readResults(resolve(process.cwd(), argument.slice(at + 1)));
    if (!document) throw new Error(`LATENCY_BASELINE_ARGUMENT: not a results document: ${argument}`);
    runs.set(runId, [...(runs.get(runId) ?? []), document]);
  }
  const proposed = proposeLatencyBaseline({ runs: [...runs].map(([runId, results]) => ({ runId, results })), previous: readBaseline(), recordedAt: new Date().toISOString() });
  process.stdout.write(`${JSON.stringify(proposed, null, 2)}\n`);
  return 0;
}

try {
  const at = process.argv.indexOf("--baseline");
  process.exitCode = at >= 0 ? baseline(process.argv.slice(at + 1)) : gate();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
