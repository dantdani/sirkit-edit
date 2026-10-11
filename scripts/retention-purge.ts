/**
 * [B24-C2] D24-13, OD-202: the operator's retention purge - the thin wrapper over `runRetentionCli` (app/lib/durable-workflow/retention-cli.ts).
 * [B24-C3] D24-26, OD-211: and its READ mode - `--read` dispatches to `runTraceReadCli` (app/lib/observability/trace-read.ts) before the
 * purge parser sees the arguments; the purge mode's behaviour is unchanged (the same runner, port, clock, writers and production predicate;
 * its invocation now passes the dispatcher below).
 *
 *   pnpm exec tsx scripts/retention-purge.ts                                        dry run (the default): the plan, the cutoffs, the planDigest; nothing is deleted
 *   pnpm exec tsx scripts/retention-purge.ts --as-of <instant> [--limit <1..10000>]  the same, at a stated instant
 *   pnpm exec tsx scripts/retention-purge.ts --apply --confirm <planDigest> --as-of <instant>
 *                                                                                    delete exactly the set the dry run at that instant planned
 *   pnpm exec tsx scripts/retention-purge.ts --read --kind <run-trace|run-trace-attribution|llm-call-record|specialist-trace>
 *                                            --tenant <id> --project <id> --branch <id> [--run <runId>] [--limit <1..100>]
 *                                            [--acknowledge-unaudited-read]           read the kind's records of that scope, each re-verified
 *                                                                                    by its store, as ONE JSON document on stdout; nothing is written
 *
 * The policy is `app/lib/observability/retention-policy.ts` (only a durable aggregate class with a finite day count is ever deleted); the
 * port reaches the database through `getDb()` alone, so the purge's target is the process's database URL as the operator exported it (the
 * client's one variable) - the purge mode loads no `.env.local`, and nothing printed carries that value, a payload or a salt. The read mode
 * follows `scripts/db-migrate.ts`: its arguments parse first, `.env.local` is loaded here and only here, a missing database URL exits 2
 * naming the variable only, the target is printed as host:port/database, and no driver text is ever printed. It constructs the PostgreSQL
 * durable-workflow repository (D11: the one constructor site besides `durable-workflow/runtime.ts`) and hands it to the read core, which
 * reaches it through a read-only adapter; when a repository was opened, the process's database client is ended after the read (a deadline
 * leaves a statement pending on its socket, which would otherwise keep the process alive). No package.json script names this file.
 *
 * NEVER run by the builder against a live database, the dry run and the read mode included (OD-191, OD-202, OD-211, LB-14): its only
 * runs are b24-c2-retention-pglite's and b24-c3-trace-read-pglite's, on a disposable in-process PostgreSQL. The call on the last line runs
 * only when this file is the entry module; the exported dispatcher `main` takes its seams as overrides, so a suite imports and drives it
 * without the real loader, port or client (b24-c3-trace-read-pglite 4).
 */
import { isProductionRuntime } from "../app/lib/auth/mode";
import { SERVING_DEPLOYMENT_PROFILES, resolveDeploymentProfile } from "../app/lib/auth/deployment-profile";
import { getSqlClient } from "../app/lib/db/client";
import { PostgresDurableWorkflowRepository } from "../app/lib/durable-workflow/server-repository";
import { PostgresRetentionPort, type RetentionPort } from "../app/lib/durable-workflow/retention";
import { runRetentionCli } from "../app/lib/durable-workflow/retention-cli";
import type { DurableWorkflowRepository } from "../app/lib/durable-workflow/types";
import { loadEnvLocal } from "../app/lib/load-env-local";
import { runTraceReadCli, selectsTraceRead } from "../app/lib/observability/trace-read";

/** The purge's production predicate (A1's staging or production profile, or NODE_ENV production), shared by both modes. */
const productionRuntime = (): boolean => isProductionRuntime() || (SERVING_DEPLOYMENT_PROFILES as readonly string[]).includes(resolveDeploymentProfile().declared);
const stdout = (text: string): void => { process.stdout.write(`${text}\n`); };
const stderr = (line: string): void => { process.stderr.write(`${line}\n`); };

/**
 * [B24-C3 review fix, 2026-10-09] The dispatcher's seams, each defaulting to the operator's real one: the loader of `.env.local`, the two
 * writers, the read mode's repository, the purge mode's port, the clock, the production predicate, and the close of the process's database
 * client after the read mode (`opened`: a repository was constructed). b24-c3-trace-read-pglite 4 drives the dispatcher with the loader, the
 * writers, the port and the close stubbed and the repository real (PostgreSQL over PGlite).
 */
export interface RetentionPurgeDeps {
  readonly loadEnv: () => void;
  readonly stdout: (text: string) => void;
  readonly stderr: (line: string) => void;
  readonly repositoryFor: (url: string) => DurableWorkflowRepository;
  readonly port: () => RetentionPort;
  readonly now: () => Date;
  readonly productionRuntime: () => boolean;
  readonly close: (opened: boolean) => Promise<void>;
}
const operatorDeps = (): RetentionPurgeDeps => ({
  loadEnv: loadEnvLocal,
  stdout,
  stderr,
  repositoryFor: () => new PostgresDurableWorkflowRepository(),
  port: () => new PostgresRetentionPort(),
  now: () => new Date(),
  productionRuntime,
  close: async (opened) => { if (opened) await getSqlClient().end({ timeout: 5 }); },
});

/** The dispatcher: `--read` anywhere in the arguments selects the read mode; otherwise the purge runs as B24-C2 wrote it. */
export async function main(argv: readonly string[], env: Record<string, string | undefined>, overrides: Partial<RetentionPurgeDeps> = {}): Promise<number> {
  const deps: RetentionPurgeDeps = { ...operatorDeps(), ...overrides };
  if (selectsTraceRead(argv)) {
    let opened = false;
    try {
      return await runTraceReadCli({ argv, env, loadEnv: deps.loadEnv, stdout: deps.stdout, stderr: deps.stderr, repositoryFor: (url) => { const repository = deps.repositoryFor(url); opened = true; return repository; }, now: deps.now, productionRuntime: deps.productionRuntime });
    } finally {
      try { await deps.close(opened); } catch { deps.stderr("trace-read: the database client did not close cleanly; nothing of the driver's message is printed."); }
    }
  }
  return runRetentionCli(argv, { port: deps.port(), now: deps.now, stdout: deps.stdout, stderr: deps.stderr, productionRuntime: deps.productionRuntime() });
}

/** This file is the entry module when argv[1] names it, with or without a suffix (`tsx scripts/retention-purge` resolves none); a suite that imports it never runs the dispatcher. */
const ENTRY_MODULE = /retention-purge(?:\.[cm]?[jt]s)?$/.test(process.argv[1] ?? "");
if (ENTRY_MODULE) void main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; });
