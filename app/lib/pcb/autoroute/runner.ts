/**
 * Freerouting subprocess runner (PCB Stage 9). Mirrors the NGSpice pattern in
 * app/api/simulate/route.ts: write input to a temp file, spawn the JAR, capture
 * stderr, race a kill-timer against `close`, read the output file, clean up in a
 * `finally`. Local JAR only for MVP (no Docker / hosted REST) — the JAR path and
 * a Java 21+ runtime are the operator's responsibility (env FREEROUTING_JAR).
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

export interface RunFreeroutingInput {
  dsnText: string;
  timeoutMs?: number; // default 300_000 (5 min)
  freeroutingJarPath: string; // from env FREEROUTING_JAR
  javaPath?: string; // default 'java' (assume PATH)
  maxPasses?: number; // default 100
}

export type RunFreeroutingResult =
  | { ok: true; sesText: string; stderr: string; elapsedMs: number }
  | {
      ok: false;
      error: "timeout" | "exit-nonzero" | "jar-missing" | "java-missing" | "io";
      stderr: string;
      elapsedMs: number;
    };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runFreerouting(input: RunFreeroutingInput): Promise<RunFreeroutingResult> {
  const { dsnText, freeroutingJarPath } = input;
  const timeoutMs = input.timeoutMs ?? 300_000;
  const javaPath = input.javaPath ?? "java";
  const maxPasses = input.maxPasses ?? 100;

  const start = Date.now();
  const elapsed = (): number => Date.now() - start;

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
      | { kind: "spawn-error"; err: NodeJS.ErrnoException; stderr: string }
    >((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const done = (v: Parameters<typeof resolve>[0]): void => {
        if (settled) return;
        settled = true;
        resolve(v);
      };

      const child = spawn(
        javaPath,
        ["-jar", freeroutingJarPath, "-de", inPath, "-do", outPath, "-mp", String(maxPasses)],
        { stdio: "pipe" },
      );

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        done({ kind: "timeout", stderr: stderr || stdout });
      }, timeoutMs);

      child.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        done({ kind: "spawn-error", err, stderr: stderr || stdout });
      });
      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ kind: "closed", code, stderr: stderr || stdout });
      });
    });

    if (outcome.kind === "timeout") {
      return { ok: false, error: "timeout", stderr: outcome.stderr, elapsedMs: elapsed() };
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
