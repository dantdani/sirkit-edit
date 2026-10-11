/**
 * [B24-D1] D24-28, OD-30 - the CI headroom step: `pnpm exec tsx scripts/ci-job-headroom.ts <workflow> <job> [--report-only]`.
 * Reads the job's `timeout-minutes` off the workflow file, the job's start second from SIRKIT_JOB_STARTED_AT (set by the job's first
 * step: `echo "SIRKIT_JOB_STARTED_AT=$(date +%s)" >> "$GITHUB_ENV"`), computes the elapsed time and the headroom
 * (app/lib/qualification/ci-headroom.ts) and writes one line to $GITHUB_STEP_SUMMARY (when set) and to stdout. Under OD-30's five
 * minutes of headroom it exits 1 with OD30_SPLIT_REQUIRED; with no start recorded it exits 1 with OD30_START_UNKNOWN. With
 * `--report-only` (the benchmark-latency job, which reports only) it always exits 0. It reads two files and appends to the step
 * summary; nothing else is written, no process is started.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { headroom, parseStartedAt, readJobTimeoutMinutes, renderHeadroom } from "../app/lib/qualification/ci-headroom";

/** Set by CI's first step of a job, never a flag: the job's start, seconds since the epoch (A1 kind tooling, A2 class platform). */
export const JOB_STARTED_AT_ENV = "SIRKIT_JOB_STARTED_AT";

function main(): number {
  const positional = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  const reportOnly = process.argv.includes("--report-only");
  const [workflow, job] = positional;
  if (!workflow || !job) {
    process.stderr.write("usage: tsx scripts/ci-job-headroom.ts <workflow> <job> [--report-only]\n");
    return 2;
  }
  const timeoutMinutes = readJobTimeoutMinutes(readFileSync(resolve(process.cwd(), workflow), "utf8"), job);
  if (timeoutMinutes === null) {
    process.stderr.write(`OD30_JOB_UNKNOWN: ${job} has no timeout-minutes in ${workflow}\n`);
    return 2;
  }
  const report = headroom({ timeoutMinutes, startedAtSec: parseStartedAt(process.env[JOB_STARTED_AT_ENV]), nowSec: Math.floor(Date.now() / 1000) });
  const line = renderHeadroom(job, report);
  process.stdout.write(`${line}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${line}\n`, "utf8");
  return report.failing && !reportOnly ? 1 : 0;
}

process.exitCode = main();
