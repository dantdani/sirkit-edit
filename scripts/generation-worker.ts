/**
 * [PR-L, 2026-10-17] Runbook L.3, increment 3 part 2 (task-worker-contract.md section 4; persistent-generation/worker.md): the
 * GENERATION WORKER as its own process. It consumes the queued slices of durable generation tasks whether or not any browser is open,
 * and a restarted worker resumes every task from its durable state.
 *
 *   pnpm run worker:generation                 run until Ctrl+C (SIGINT) or SIGTERM
 *   pnpm run worker:generation -- --once       one tick: claim, run what was claimed to its settlement, exit 0
 *   pnpm run worker:generation -- --help       the options
 *
 * Composition root (the only place these are bound for the worker): `.env.local` is read first (unless `--no-env-file`), then the
 * modules that read the environment at load are imported; the durable LLM call-record sink is bound (`instrumentation.ts` binds it in the
 * Next process; this process needs its own) and every slice runs under `withLlmCallScope` with the route that admits a task
 * (`/api/generation-tasks`), so each provider call is recorded under the task's scope. Shutdown: running slices yield at their next turn
 * boundary with a committed checkpoint; after `--grace-ms` the rest are aborted and their leases released for immediate takeover; the
 * pending call records are drained (bounded); exit 0. A second signal exits at once (the leases then lapse within 45 s).
 *
 * Nothing printed carries a secret: no environment value is printed, and an error's text is redacted and stripped of the database
 * URL's credentials before it is.
 */
import { hostname } from "node:os";
import { createServer, type Server } from "node:http";
import { loadEnvLocal } from "../app/lib/load-env-local";
import { sanitizeTraceText } from "../app/lib/agent/redaction";
import { GENERATION_WORKER_USAGE, defaultGenerationWorkerId, parseGenerationWorkerArguments } from "../app/lib/generation-task/worker/cli";

const out = (line: string): void => { process.stdout.write(`[generation-worker] ${line}\n`); };
const fail = (line: string): void => { process.stderr.write(`[generation-worker] ${line}\n`); };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms).unref(); });

/** An error's text without the database URL's user or password (driver errors may echo them), bounded. */
function safeText(error: unknown): string {
  let text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const url = process.env.DATABASE_URL;
  if (url) {
    text = text.split(url).join("<database-url>");
    try {
      const parsed = new URL(url);
      for (const secret of [parsed.password, parsed.username].filter((value) => value.length > 0)) text = text.split(decodeURIComponent(secret)).join("<redacted>");
    } catch { /* unparseable: nothing more to strip */ }
  }
  return sanitizeTraceText(text.replace(/\s+/g, " "), 300);
}

async function main(): Promise<number> {
  const parsed = parseGenerationWorkerArguments(process.argv.slice(2));
  if (!parsed.ok) { fail(`REFUSED: ${parsed.message}`); fail(GENERATION_WORKER_USAGE); return 2; }
  const args = parsed.args;
  if (args.help) { out(GENERATION_WORKER_USAGE); return 0; }
  if (args.envFile) loadEnvLocal();

  // loaded only now: the LLM router builds its providers from the environment when its module loads
  const [runtime, callRecords, seam, generation] = await Promise.all([
    import("../app/lib/generation-task/worker/runtime"),
    import("../app/lib/observability/llm-call-record-runtime"),
    import("../app/lib/observability/llm-call-record"),
    import("../app/api/chat/schematic-generation-runtime"),
  ]);
  callRecords.bindDurableLlmCallRecordSink();
  const workerId = args.workerId ?? defaultGenerationWorkerId(hostname(), process.pid);
  let transport: import("../app/lib/generation-task/worker/runtime").GenerationWorkerTransport;
  try {
    transport = args.transport === "pump"
      ? runtime.createPumpTransport({ origin: args.origin! })
      : runtime.createDirectTransport({
        workerId, concurrency: args.concurrency,
        providerServable: (provider) => generation.schematicGenerationServable(provider),
        runInScope: (scope, run) => seam.withLlmCallScope({ routeId: runtime.GENERATION_TASK_ROUTE.routeId, method: runtime.GENERATION_TASK_ROUTE.method, scope }, run),
        log: out,
      });
  } catch (error) {
    if (error instanceof runtime.GenerationWorkerSetupError) { fail(`REFUSED ${error.code}: ${error.message}`); return 2; }
    throw error;
  }
  const drainRecords = async (): Promise<void> => { await Promise.race([callRecords.drainLlmCallRecordWrites(), sleep(5_000)]); };
  out(`worker ${workerId} started (${transport.mode} transport, concurrency ${args.concurrency}${args.once ? ", once" : ""})`);

  if (args.once) {
    // a signal during the tick stops it the same way: running slices yield at a boundary, the rest are released after the grace
    let interrupted = 0;
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { interrupted += 1; if (interrupted > 1) process.exit(130); out(`${signal}: stopping the tick`); void transport.stop({ graceMs: args.graceMs }); });
    const { tick, slices } = await transport.runOnce();
    const refused = tick.claims.filter((claim) => claim.outcome !== "claimed");
    out(`once: ${tick.started.length} slice(s) claimed${refused.length ? `, ${refused.length} event(s) settled at the claim (${refused.map((claim) => claim.outcome).join(", ")})` : ""}`);
    for (const slice of slices) out(`  ${slice.kind} ${slice.sliceId}: ${slice.outcome}${slice.state ? ` -> task ${slice.state}` : ""}`);
    await transport.stop({ graceMs: args.graceMs });
    await drainRecords();
    return 0;
  }

  let health: Server | null = null;
  if (args.healthPort !== null) {
    health = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/healthz") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(transport.health()));
        return;
      }
      response.writeHead(404, { "cache-control": "no-store" });
      response.end();
    });
    await new Promise<void>((resolve, reject) => { health!.once("error", reject); health!.listen(args.healthPort!, "127.0.0.1", () => resolve()); });
    out(`health: GET http://127.0.0.1:${args.healthPort}/healthz`);
  }

  let stopping: Promise<void> | null = null;
  let signals = 0;
  const shutdown = (why: string, signal: boolean): Promise<void> => {
    if (signal) signals += 1;
    if (stopping) {
      // a second OS signal forces the exit; a parent's IPC request after the console's own Ctrl+C is the same stop, not a second one
      if (signal && signals > 1) { fail(`second ${why}: exiting now; running slices' leases lapse within 45 s and another worker resumes them`); process.exit(130); }
      return stopping;
    }
    out(`${why}: stopping - running slices yield at their next turn boundary (grace ${args.graceMs} ms)`);
    stopping = (async () => {
      await transport.stop({ graceMs: args.graceMs });
      await new Promise<void>((resolve) => { if (health) health.close(() => resolve()); else resolve(); });
      await drainRecords();
    })();
    return stopping;
  };
  const finished = new Promise<void>((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void shutdown(signal, true).then(resolve); });
    // a supervising parent without POSIX signals (dev-with-worker on Windows) asks over its IPC channel
    process.on("message", (message: unknown) => { if (message && typeof message === "object" && (message as { type?: unknown }).type === "shutdown") void shutdown("shutdown request", false).then(resolve); });
  });
  transport.start();
  await finished;
  out("stopped");
  return 0;
}

main().then((code) => process.exit(code), (error: unknown) => {
  fail(`FAILED: ${safeText(error)}`);
  process.exit(1);
});
