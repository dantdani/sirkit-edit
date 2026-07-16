/**
 * Freerouting subprocess runner (PCB Stage 9). Mirrors the NGSpice pattern in
 * app/api/simulate/route.ts: write input to a temp file, spawn the JAR, capture
 * stderr, race a kill-timer against `close`, read the output file, clean up in a
 * `finally`. Local CLI only: no Docker, hosted REST, or API key.
 *
 * The whole thing is a single pure-ish async function returning a discriminated
 * result (never throws for expected failures), so the API route and tests can
 * consume/mocks it directly.
 */

import { spawn } from "child_process";
import { writeFile, readFile, rm, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

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
  | { ok: true; sesText: string; stderr: string; elapsedMs: number }
  | {
      ok: false;
      error: "timeout" | "cancelled" | "exit-nonzero" | "jar-missing" | "java-missing" | "io";
      stderr: string;
      elapsedMs: number;
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
  if (input.signal?.aborted) return { ok: false, error: "cancelled", stderr: "", elapsedMs: elapsed() };

  // Fail fast + clean if the JAR isn't there (don't let it surface as a spawn error).
  try {
    await access(freeroutingJarPath);
  } catch {
    return {
      ok: false,
      error: "jar-missing",
      stderr: `Freerouting JAR not found: ${freeroutingJarPath}`,
      elapsedMs: elapsed(),
    };
  }

  const uuid = randomUUID();
  const inPath = join(tmpdir(), `sirkit-fr-${uuid}.dsn`);
  const outPath = join(tmpdir(), `sirkit-fr-${uuid}.ses`);

  try {
    try {
      await writeFile(inPath, dsnText, "utf8");
    } catch (e) {
      return { ok: false, error: "io", stderr: errMsg(e), elapsedMs: elapsed() };
    }

    const outcome = await new Promise<
      | { kind: "closed"; code: number | null; stderr: string }
      | { kind: "timeout"; stderr: string }
      | { kind: "cancelled"; stderr: string }
      | { kind: "spawn-error"; err: NodeJS.ErrnoException; stderr: string }
    >((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const diagnostics = (): string => [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
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
        stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ kind: "closed", code, stderr: diagnostics() });
      });
    });

    if (outcome.kind === "timeout") {
      return { ok: false, error: "timeout", stderr: outcome.stderr, elapsedMs: elapsed() };
    }
    if (outcome.kind === "cancelled") {
      return { ok: false, error: "cancelled", stderr: outcome.stderr, elapsedMs: elapsed() };
    }
    if (outcome.kind === "spawn-error") {
      const error = outcome.err.code === "ENOENT" ? "java-missing" : "io";
      return { ok: false, error, stderr: outcome.stderr || errMsg(outcome.err), elapsedMs: elapsed() };
    }
    if (outcome.code !== 0) {
      return { ok: false, error: "exit-nonzero", stderr: outcome.stderr, elapsedMs: elapsed() };
    }

    let sesText: string;
    try {
      sesText = await readFile(outPath, "utf8");
    } catch {
      return {
        ok: false,
        error: "io",
        stderr: outcome.stderr || "Freerouting produced no .ses output file",
        elapsedMs: elapsed(),
      };
    }
    return { ok: true, sesText, stderr: outcome.stderr, elapsedMs: elapsed() };
  } finally {
    await Promise.all([rm(inPath, { force: true }).catch(() => {}), rm(outPath, { force: true }).catch(() => {})]);
  }
}
