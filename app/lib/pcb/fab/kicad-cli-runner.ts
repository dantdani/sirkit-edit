// kicad-cli subprocess wrapper (PCB Stage 14). Same conventions as Stage 9's
// runFreerouting / the NGSpice route: spawn, capture stdio, race a kill-timer,
// return a discriminated result — never throw for expected failures. A missing
// binary (spawn ENOENT) surfaces as 'cli-missing' so the API route can turn it
// into a clean 500 instead of a stack trace.

import { spawn } from "child_process";

export interface RunKicadCliInput {
  cliPath: string; // env KICAD_CLI or 'kicad-cli' on PATH
  args: string[]; // e.g. ['pcb', 'export', 'gerbers', ...]
  timeoutMs?: number; // default 60_000
  cwd?: string; // temp dir where the .kicad_pcb sits
}

export type RunKicadCliResult =
  | { ok: true; stdout: string; stderr: string; elapsedMs: number }
  | {
      ok: false;
      error: "timeout" | "exit-nonzero" | "cli-missing" | "io";
      stderr: string;
      elapsedMs: number;
    };

export type KicadCliRunner = (input: RunKicadCliInput) => Promise<RunKicadCliResult>;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runKicadCli(input: RunKicadCliInput): Promise<RunKicadCliResult> {
  const timeoutMs = input.timeoutMs ?? 60_000;
  const start = Date.now();
  const elapsed = (): number => Date.now() - start;

  const outcome = await new Promise<
    | { kind: "closed"; code: number | null; stdout: string; stderr: string }
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

    const child = spawn(input.cliPath, input.args, {
      stdio: "pipe",
      ...(input.cwd ? { cwd: input.cwd } : {}),
    });

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
      done({ kind: "closed", code, stdout, stderr });
    });
  });

  if (outcome.kind === "timeout") {
    return { ok: false, error: "timeout", stderr: outcome.stderr, elapsedMs: elapsed() };
  }
  if (outcome.kind === "spawn-error") {
    const error = outcome.err.code === "ENOENT" ? "cli-missing" : "io";
    return {
      ok: false,
      error,
      stderr: outcome.stderr || errMsg(outcome.err),
      elapsedMs: elapsed(),
    };
  }
  if (outcome.code !== 0) {
    return { ok: false, error: "exit-nonzero", stderr: outcome.stderr || outcome.stdout, elapsedMs: elapsed() };
  }
  return { ok: true, stdout: outcome.stdout, stderr: outcome.stderr, elapsedMs: elapsed() };
}
