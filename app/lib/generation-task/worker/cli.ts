/**
 * [PR-L, 2026-10-17] Runbook L.3, increment 3 part 2 (task-worker-contract.md section 4): the generation worker's command line, parsed
 * before anything loads the environment or connects (the `scripts/db-migrate.ts` order). Pure: no environment, no I/O; an unknown or
 * malformed flag refuses instead of falling through to a run.
 */
import { GENERATION_SLICE_POLICY } from "../contracts";

export interface GenerationWorkerArguments {
  /** one tick, settle what it started, exit (tests, cron-style supervision) */
  once: boolean;
  /** slices in flight at once, 1..3 */
  concurrency: number;
  /** 127.0.0.1 `GET /healthz` port, or null for none */
  healthPort: number | null;
  /** the worker's id (claims and leases carry it), or null for `<host>-<pid>` */
  workerId: string | null;
  transport: "direct" | "pump";
  /** the dev server's origin for the pump transport */
  origin: string | null;
  /** read `<cwd>/.env.local` (the operator's default); `--no-env-file` skips it (tests: no developer secret is ever loaded) */
  envFile: boolean;
  /** how long running slices may take to reach a boundary after a shutdown signal */
  graceMs: number;
  help: boolean;
}

export const GENERATION_WORKER_USAGE = [
  "Usage: pnpm run worker:generation [-- options]",
  "  --once                 claim and run one tick of slices, then exit",
  "  --concurrency <1..3>   slices in flight at once (default 3)",
  "  --worker-id <id>       the worker id leases carry (default <host>-<pid>)",
  "  --health-port <port>   serve GET /healthz on 127.0.0.1:<port>",
  "  --transport direct     the durable store through DATABASE_URL (the default; the fixture runtime needs the pump)",
  "  --transport pump --origin <url>   the HTTP pump: POST <url>/api/generation-worker with SIRKIT_WORKFLOW_WORKER_SECRET (the fixture runtime needs it)",
  "  --grace-ms <ms>        on SIGINT/SIGTERM, how long slices may take to reach a turn boundary (default 10000)",
  "  --no-env-file          do not read .env.local",
  "Stop with Ctrl+C (SIGINT) or SIGTERM: running slices yield at a turn boundary, the rest are released for another worker.",
].join("\n");

export function parseGenerationWorkerArguments(argv: readonly string[]): { ok: true; args: GenerationWorkerArguments } | { ok: false; message: string } {
  const args: GenerationWorkerArguments = { once: false, concurrency: GENERATION_SLICE_POLICY.workerConcurrency, healthPort: null, workerId: null, transport: "direct", origin: null, envFile: true, graceMs: 10_000, help: false };
  const integer = (value: string | undefined, min: number, max: number): number | null => (value !== undefined && /^\d{1,7}$/.test(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    const value = (): string | undefined => argv[++index];
    switch (flag) {
      case "--once": args.once = true; break;
      case "--no-env-file": args.envFile = false; break;
      case "--help": case "-h": args.help = true; break;
      case "--concurrency": { const parsed = integer(value(), 1, GENERATION_SLICE_POLICY.workerConcurrency); if (parsed === null) return { ok: false, message: `--concurrency takes 1..${GENERATION_SLICE_POLICY.workerConcurrency}` }; args.concurrency = parsed; break; }
      case "--health-port": { const parsed = integer(value(), 1, 65_535); if (parsed === null) return { ok: false, message: "--health-port takes a port number" }; args.healthPort = parsed; break; }
      case "--grace-ms": { const parsed = integer(value(), 0, 600_000); if (parsed === null) return { ok: false, message: "--grace-ms takes 0..600000" }; args.graceMs = parsed; break; }
      case "--worker-id": { const id = value(); if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) return { ok: false, message: "--worker-id takes 1-128 characters of [A-Za-z0-9._:-]" }; args.workerId = id; break; }
      case "--transport": { const mode = value(); if (mode !== "direct" && mode !== "pump") return { ok: false, message: "--transport takes direct or pump" }; args.transport = mode; break; }
      case "--origin": { const origin = value(); try { const url = new URL(origin ?? ""); if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol"); args.origin = url.origin; } catch { return { ok: false, message: "--origin takes an http(s) origin" }; } break; }
      default: return { ok: false, message: `unknown argument ${JSON.stringify(flag.slice(0, 40))}` };
    }
  }
  if (args.transport === "pump" && !args.origin) return { ok: false, message: "--transport pump needs --origin <url>" };
  return { ok: true, args };
}

/** `<host>-<pid>` reduced to the worker-id alphabet. */
export function defaultGenerationWorkerId(hostname: string, pid: number): string {
  const host = hostname.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 80) || "host";
  return `generation-worker-${host}-${pid}`;
}
