/**
 * Freerouting subprocess runner (PCB Stage 9). Mirrors the NGSpice pattern in
 * app/api/simulate/route.ts: write input to a temp file, spawn the JAR, capture [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): /api/simulate starts no process since B22-A3; ngspice runs through the diagnostic runner, whose per-run directory, exact environment and tree kill this runner does not share]
 * stderr, race a kill-timer against `close`, read the output file, clean up in a
 * `finally`. Local CLI only: no Docker, hosted REST, or API key.
 *
 * The whole thing is a single pure-ish async function returning a discriminated
 * result (never throws for expected failures), so the API route and tests can
 * consume/mocks it directly.
 */

import { spawn } from "child_process";
import { writeFile, rm, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { createDiagnosticCollector, joinDiagnosticTexts, readBoundedFile } from "@/app/lib/computation/output-bounds";

const SAFE_ENV_KEYS = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOME",
  "LANG",
] as const;

export interface RunFreeroutingInput {
  dsnText: string;
  timeoutMs?: number; // default 300_000 (5 min)
  freeroutingJarPath: string;
  javaPath?: string; // defaults to a system-managed `java` on PATH
  maxPasses?: number; // default 100
  signal?: AbortSignal;
}

export type RunFreeroutingResult =
  | {
      ok: true;
      sesText: string;
      stderr: string;
      elapsedMs: number;
      processStatus: "exit-success";
      outputFileStatus: "nonempty";
      exitCode: 0;
      sesByteLength: number;
    }
  | {
      ok: false;
      error: "timeout" | "cancelled" | "exit-nonzero" | "output-empty" | "jar-missing" | "java-missing" | "io";
      stderr: string;
      elapsedMs: number;
      processStatus: "not-started" | "exit-nonzero" | "timeout" | "cancelled" | "spawn-failed" | "exit-success";
      outputFileStatus: "not-checked" | "missing" | "empty";
      exitCode?: number | null;
    };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Never pass Sirkit's database/AI/distributor secrets to the Java child. */
export function freeroutingEnvironment(env: Partial<NodeJS.ProcessEnv> = process.env): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = { NODE_ENV: env.NODE_ENV ?? "production" };
  for (const key of SAFE_ENV_KEYS) {
    if (env[key] !== undefined) safe[key] = env[key];
  }
  return safe;
}

interface FreeroutingArgumentsInput {
  freeroutingJarPath: string;
  inPath: string;
  outPath: string;
  maxPasses: number;
}

/** The local CLI is always headless, offline, and opted out of analytics. */
export function buildFreeroutingArguments(input: FreeroutingArgumentsInput): string[] {
  return [
    "-Djava.awt.headless=true",
    "-Dlog4j2.disableJndi=true",
    "-jar",
    input.freeroutingJarPath,
    "--gui.enabled=false",
    "--api_server.enabled=false",
    "--logging.file.enabled=false",
    "--logging.console.level=WARN",
    "-da",
    "-de",
    input.inPath,
    "-do",
    input.outPath,
    "-mp",
    String(input.maxPasses),
  ];
}

export async function runFreerouting(input: RunFreeroutingInput): Promise<RunFreeroutingResult> {
  const { dsnText, freeroutingJarPath } = input;
  const timeoutMs = input.timeoutMs ?? 300_000;
  const javaPath = input.javaPath ?? "java";
  const maxPasses = input.maxPasses ?? 100;

  const start = Date.now();
  const elapsed = (): number => Date.now() - start;
  if (input.signal?.aborted) return { ok: false, error: "cancelled", stderr: "", elapsedMs: elapsed(), processStatus: "cancelled", outputFileStatus: "not-checked" };

  // Fail fast + clean if the JAR isn't there (don't let it surface as a spawn error).
  try {
    await access(freeroutingJarPath);
  } catch {
    return {
      ok: false,
      error: "jar-missing",
      stderr: `Freerouting JAR not found: ${freeroutingJarPath}`,
      elapsedMs: elapsed(),
      processStatus: "not-started",
      outputFileStatus: "not-checked",
    };
  }

  const uuid = randomUUID();
  const inPath = join(tmpdir(), `sirkit-fr-${uuid}.dsn`);
  const outPath = join(tmpdir(), `sirkit-fr-${uuid}.ses`);

  try {
    try {
      await writeFile(inPath, dsnText, "utf8");
    } catch (e) {
      return { ok: false, error: "io", stderr: errMsg(e), elapsedMs: elapsed(), processStatus: "not-started", outputFileStatus: "not-checked" };
    }

    const outcome = await new Promise<
      | { kind: "closed"; code: number | null; stderr: string }
      | { kind: "timeout"; stderr: string }
      | { kind: "cancelled"; stderr: string }
      | { kind: "spawn-error"; err: NodeJS.ErrnoException; stderr: string }
    >((resolve) => {
      // [B22-A1] D22-8 (OD-148): each stream is kept to the one diagnostic bound, and the joined diagnostics to it too, stderr keeping its own share ([B22-A1 review] regressions-2)
      const stdout = createDiagnosticCollector();
      const stderr = createDiagnosticCollector();
      let settled = false;
      const diagnostics = (): string => joinDiagnosticTexts(stderr.text().trim(), stdout.text().trim());
      const done = (v: Parameters<typeof resolve>[0]): void => {
        if (settled) return;
        settled = true;
        resolve(v);
      };

      const child = spawn(
        javaPath,
        buildFreeroutingArguments({ freeroutingJarPath, inPath, outPath, maxPasses }),
        {
          stdio: "pipe",
          cwd: tmpdir(),
          env: freeroutingEnvironment(),
          windowsHide: true,
        },
      );
      input.signal?.addEventListener("abort", () => {
        child.kill("SIGKILL");
        done({ kind: "cancelled", stderr: diagnostics() });
      }, { once: true });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        done({ kind: "timeout", stderr: diagnostics() });
      }, timeoutMs);

      child.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        done({ kind: "spawn-error", err, stderr: diagnostics() });
      });
      child.stdout?.on("data", (d: Buffer) => {
        stdout.append(d.toString());
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr.append(d.toString());
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ kind: "closed", code, stderr: diagnostics() });
      });
    });

    if (outcome.kind === "timeout") {
      return { ok: false, error: "timeout", stderr: outcome.stderr, elapsedMs: elapsed(), processStatus: "timeout", outputFileStatus: "not-checked" };
    }
    if (outcome.kind === "cancelled") {
      return { ok: false, error: "cancelled", stderr: outcome.stderr, elapsedMs: elapsed(), processStatus: "cancelled", outputFileStatus: "not-checked" };
    }
    if (outcome.kind === "spawn-error") {
      const error = outcome.err.code === "ENOENT" ? "java-missing" : "io";
      return { ok: false, error, stderr: outcome.stderr || errMsg(outcome.err), elapsedMs: elapsed(), processStatus: "spawn-failed", outputFileStatus: "not-checked" };
    }
    if (outcome.code !== 0) {
      return { ok: false, error: "exit-nonzero", stderr: outcome.stderr, elapsedMs: elapsed(), processStatus: "exit-nonzero", outputFileStatus: "not-checked", exitCode: outcome.code };
    }

    // [B22-A1] D22-8 (OD-148): the .ses is read through the bounded reader; one over the bound is refused unread
    const read = await readBoundedFile(outPath);
    if (!read.ok && read.reason === "over-limit") {
      return {
        ok: false,
        error: "io",
        stderr: "Freerouting's .ses output exceeded the bounded size limit; it was not read",
        elapsedMs: elapsed(),
        processStatus: "exit-success",
        outputFileStatus: "not-checked",
        exitCode: 0,
      };
    }
    if (!read.ok) {
      return {
        ok: false,
        error: "io",
        stderr: outcome.stderr || "Freerouting produced no .ses output file",
        elapsedMs: elapsed(),
        processStatus: "exit-success",
        outputFileStatus: "missing",
        exitCode: 0,
      };
    }
    const sesText = read.bytes.toString("utf8");
    if (!sesText.trim()) {
      return {
        ok: false,
        error: "output-empty",
        stderr: outcome.stderr || "Freerouting produced an empty .ses output file",
        elapsedMs: elapsed(),
        processStatus: "exit-success",
        outputFileStatus: "empty",
        exitCode: 0,
      };
    }
    return {
      ok: true,
      sesText,
      stderr: outcome.stderr,
      elapsedMs: elapsed(),
      processStatus: "exit-success",
      outputFileStatus: "nonempty",
      exitCode: 0,
      sesByteLength: Buffer.byteLength(sesText, "utf8"),
    };
  } finally {
    await Promise.all([rm(inPath, { force: true }).catch(() => {}), rm(outPath, { force: true }).catch(() => {})]);
  }
}
