// kicad-cli subprocess wrapper (PCB Stage 14). Same conventions as Stage 9's
// runFreerouting / the NGSpice route: spawn, capture stdio, race a kill-timer, [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): the NGSpice route starts no process since B22-A3; ngspice runs through the diagnostic runner, whose tree kill and exact environment this wrapper does not share] [B24-D2, 2026-10-09] the tree kill is now app/lib/pcb/process-tree.ts, OD-145's method (taskkill /T on win32, the process group on POSIX), and a killed run settles on its exit or after the confirm wait; the exact environment is still not shared
// return a discriminated result — never throw for expected failures. A missing
// binary (spawn ENOENT) surfaces as 'cli-missing' so the API route can turn it
// into a clean 500 instead of a stack trace.

import { spawn } from "child_process";
import { createDiagnosticCollector } from "@/app/lib/computation/output-bounds";

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
      elapsedMs: number; killConfirmed?: boolean; // [B24-D2, 2026-10-09] present only on a killed run (timeout): true when its exit was observed after the tree kill, false when the confirm wait ran out first
    };

export type KicadCliRunner = (input: RunKicadCliInput) => Promise<RunKicadCliResult>;

/**
 * [B22-A1] D22-5 (OD-148): the ONLY environment kicad-cli gets - what it needs to find its install and its libraries (the
 * search path, the Windows system root), its per-user settings (the profile, application-data, home and XDG directories, an
 * operator's `KICAD_CONFIG_HOME`), a temporary directory and the locale; never Sirkit's provider, database, Supabase or
 * distributor secrets. The FreeRouting runner's `freeroutingEnvironment()` is the precedent. What kicad-cli needs is INFERRED
 * from that precedent and KiCad's documented settings paths: kicad-cli was never run here (the opt-in kicad-cli oracle, with
 * `KICAD_CLI` set, is the live check).
 */
export const KICAD_CLI_ENV_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SystemDrive",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOME",
  "LANG",
  "LD_LIBRARY_PATH",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "KICAD_CONFIG_HOME",
] as const;

/** [B22-A1] The allowlisted keys of `env` (and `NODE_ENV`, as the FreeRouting precedent passes it), never the whole environment. */
export function kicadCliEnvironment(env: Partial<NodeJS.ProcessEnv> = process.env): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = { NODE_ENV: env.NODE_ENV ?? "production" };
  for (const key of KICAD_CLI_ENV_KEYS) {
    if (env[key] !== undefined) safe[key] = env[key];
  }
  return safe;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runKicadCli(input: RunKicadCliInput): Promise<RunKicadCliResult> {
  const timeoutMs = input.timeoutMs ?? 60_000;
  const start = Date.now();
  const elapsed = (): number => Date.now() - start;

  const outcome = await new Promise<
    | { kind: "closed"; code: number | null; stdout: string; stderr: string }
    | { kind: "timeout"; stderr: string; killConfirmed: boolean }
    | { kind: "spawn-error"; err: NodeJS.ErrnoException; stderr: string }
  >((resolve) => {
    // [B22-A1] D22-8 (OD-148): each stream is kept to the one diagnostic bound, the tail kept, the marker first
    const stdout = createDiagnosticCollector();
    const stderr = createDiagnosticCollector();
    let settled = false; let closed = false; let killing = false; let confirm: ReturnType<typeof setTimeout> | undefined; const place = treeKillPlace(process.platform, process.env.SystemRoot); // [B24-D2, 2026-10-09] OD-145: the tree kill's place, its Windows directory read once per run
    const done = (v: Parameters<typeof resolve>[0]): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const child = spawn(input.cliPath, input.args, {
      stdio: "pipe",
      env: kicadCliEnvironment(), // [B22-A1] D22-5: never the inherited server environment
      windowsHide: true, detached: !place.win32, // [B24-D2, 2026-10-09] the child leads its own process group on POSIX, so the group kill reaches its children (not on win32: taskkill /T walks the tree)
      ...(input.cwd ? { cwd: input.cwd } : {}),
    });

    const timer = setTimeout(() => {
      killing = true; killProcessTree(child, place, () => !closed, spawn); // [B24-D2, 2026-10-09] OD-145: the whole tree, never the direct child alone
      const settle = (killConfirmed: boolean): void => done({ kind: "timeout", stderr: stderr.text() || stdout.text(), killConfirmed }); if (child.pid === undefined) settle(false); else confirm = setTimeout(() => settle(false), TREE_KILL_CONFIRM_MS); // [B24-D2, 2026-10-09] a started child settles on its observed exit (close, below) or after the confirm wait; one never started at once, as before
    }, timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done({ kind: "spawn-error", err, stderr: stderr.text() || stdout.text() });
    });
    child.stdout?.on("data", (d: Buffer) => {
      stdout.append(d.toString());
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr.append(d.toString());
    });
    child.on("close", (code) => {
      closed = true; clearTimeout(timer); clearTimeout(confirm);
      done(killing ? { kind: "timeout", stderr: stderr.text() || stdout.text(), killConfirmed: true } : { kind: "closed", code, stdout: stdout.text(), stderr: stderr.text() }); // [B24-D2, 2026-10-09] after the tree kill the observed exit confirms it
    });
  });

  if (outcome.kind === "timeout") {
    return { ok: false, error: "timeout", stderr: outcome.stderr, elapsedMs: elapsed(), killConfirmed: outcome.killConfirmed };
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

// [B24-D2, 2026-10-09] the tree kill (OD-145), imported at the END (imports are hoisted) so no cited line above moves
import { TREE_KILL_CONFIRM_MS, killProcessTree, treeKillPlace } from "@/app/lib/pcb/process-tree";
