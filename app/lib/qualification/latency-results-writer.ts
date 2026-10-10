/**
 * [B24-D1] D24-27, OD-212 (lead decision D15) - the ONE place a latency result is written. The two benchmark suites measure and
 * verify; they name no write primitive (`b11-5-capture-exactness` case 12 scans every `*.test.ts(x)`, so a suite that wrote would
 * need a `justified` entry - the alternative D1 does not take). This module is not a `*.test.ts`, so case 12 never reads it; its
 * confinement is asserted by `b24-d1-latency-policy` instead (B22-A3's `_pinned-ngspice.ts` precedent): the directory is resolved
 * from the environment it is given and refused - before any write - when the variable is unset, relative, or inside the repository.
 *
 * The two names (OD-200, D16): `SIRKIT_B24_BENCHMARK` (a live-test-gate kind, exactly "1", measurement only; the benchmark-latency
 * job sets it in its vitest step's env) and `SIRKIT_B24_BENCHMARK_DIR` (tooling; an absolute path outside the repository, the job's
 * `/tmp/sirkit-b24-benchmark`). Neither has a `.env.example` line: both classes are undeclared (qualification-opt-in, platform).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { LATENCY_RESULTS_SCHEMA, latencyResultsProblems, type LatencyEnvironment, type LatencyResultsDocument } from "./latency-policy";

/** Exactly "1" arms the two benchmark suites (B24-B3's `exact-1` kind; `b24-d1-latency*` gate on it alone). */
export const BENCHMARK_FLAG_ENV = "SIRKIT_B24_BENCHMARK";
/** The absolute results directory, outside the repository (as prompt-to-gerber's SIRKIT_B16_1C_EVIDENCE_DIR is). */
export const BENCHMARK_DIR_ENV = "SIRKIT_B24_BENCHMARK_DIR";
export const BENCHMARK_DIR_REFUSALS = Object.freeze(["unset", "relative", "inside_repository"] as const);
export type BenchmarkDirRefusal = (typeof BENCHMARK_DIR_REFUSALS)[number];
export const RESULTS_FILE_SUFFIX = ".latency-results.json";

export type BenchmarkEnvironment = Readonly<Record<string, string | undefined>>;

export function benchmarkRequested(env: BenchmarkEnvironment = process.env): boolean {
  return env[BENCHMARK_FLAG_ENV] === "1";
}

const normalized = (path: string): string => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));

/** The directory, or why it is refused: unset (or blank), relative, or inside the repository root (the root itself included). */
export function resolveBenchmarkDirectory(env: BenchmarkEnvironment = process.env, repositoryRoot: string = process.cwd()): { ok: true; directory: string } | { ok: false; refusal: BenchmarkDirRefusal } {
  const raw = env[BENCHMARK_DIR_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, refusal: "unset" };
  const value = raw.trim();
  if (!isAbsolute(value)) return { ok: false, refusal: "relative" };
  const between = relative(normalized(repositoryRoot), normalized(value));
  // [B24-D1 review, 2026-10-09] outside only when the relative path IS `..`, starts with `../` (either separator) or is on another drive:
  // a repository child whose name begins with dots (`..results`) is inside and refused (review security-1, correctness-3)
  const outside = between === ".." || between.startsWith(`..${sep}`) || between.startsWith("../") || isAbsolute(between);
  if (!outside) return { ok: false, refusal: "inside_repository" };
  return { ok: true, directory: resolve(value) };
}

/** The file a suite's results go to, inside the resolved directory. */
export const latencyResultsFileName = (suite: string): string => `${suite}${RESULTS_FILE_SUFFIX}`;

/** Validate, resolve, refuse before any write; then write `<suite>.latency-results.json` (LF, a final newline). */
export function writeLatencyResults(document: LatencyResultsDocument, env: BenchmarkEnvironment = process.env, repositoryRoot: string = process.cwd()): { path: string } {
  const problems = latencyResultsProblems(document);
  if (problems.length > 0) throw new Error(`LATENCY_RESULTS_INVALID: ${problems.join(", ")}`);
  const resolved = resolveBenchmarkDirectory(env, repositoryRoot);
  if (!resolved.ok) throw new Error(`LATENCY_RESULTS_DIR_REFUSED: ${BENCHMARK_DIR_ENV} ${resolved.refusal}`);
  mkdirSync(resolved.directory, { recursive: true });
  const path = join(resolved.directory, latencyResultsFileName(document.suite));
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { path };
}

/** The environment a results document records, as scripts/stage10-evidence.ts records it, plus the OS image when the runner names one. */
export function latencyEnvironment(env: BenchmarkEnvironment = process.env): LatencyEnvironment {
  return { platform: platform(), architecture: arch(), osRelease: release(), image: env.ImageOS ?? null, node: process.version, cpu: cpus()[0]?.model ?? "unknown", logicalCores: cpus().length };
}

/** The schema the gate script selects on, re-exported so the script names one source. */
export { LATENCY_RESULTS_SCHEMA };
