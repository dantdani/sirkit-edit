/**
 * [PR-L, 2026-10-17] Runbook L.3 / L.7 (increment 3; task-worker-contract.md section 4): the REAL worker process. This suite spawns
 * `scripts/generation-worker.ts` (through tsx, as `pnpm run worker:generation` does) as a separate operating-system process against a
 * migrated PostgreSQL that lives in this test process (PGlite, served on 127.0.0.1 by a small wire-protocol bridge), and proves:
 *
 *  1. `--once` consumes the queued plan slice of a task accepted here, with the durable call-record sink bound and the provider call
 *     recorded under the task's scope and the admitting route (`/api/generation-tasks`), commits the plan and the three block slices,
 *     and exits 0. The model provider is an in-test HTTP endpoint (`OPENAI_BASE_URL` on 127.0.0.1): no paid call, no network;
 *  2. a RESTARTED long-running worker resumes from the durable state alone (it claims the block slices the first process queued),
 *     settles each honestly (the provider key is unset in its environment: `provider_credentials`, with no call), serves `/healthz`, and
 *     shuts down gracefully on request (IPC; SIGINT/SIGTERM run the same path), exiting 0;
 *  3. without `DATABASE_URL` the worker refuses (`GENERATION_TASK_STORE_UNAVAILABLE`, exit 2) and claims nothing.
 *
 * The child's environment is built here from a short allow-list (no variable of this process is inherited, so no developer secret can
 * reach it), and `--no-env-file` keeps it from reading `.env.local`. This file starts PGlite: its CI admission is the database-delivery
 * job's (a separate, line-pinned workflow entry, F20). The spawned processes are awaited and killed on any failure.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import net from "node:net";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../db/schema";
import { loadMigrationManifest } from "../../db/migrations/manifest";
import { migrateDatabase } from "../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../db/client", () => ({ getDb: () => orm }));

import { PostgresDurableWorkflowRepository } from "../../durable-workflow/server-repository";
import { GENERATION_SLICE_TOPIC } from "../contracts";
import { GenerationTaskStore } from "../store";
import { DRONE_BLOCKS, EDITOR, startTask } from "./_l3-worker-fixtures";

const ROOT = process.cwd();
const TSX_CLI = createRequire(`${ROOT}/package.json`).resolve("tsx/cli");
const SCOPE = { tenantId: "tenant-l3-process", projectId: "project-l3-process", branchId: "main" };
const KEY = "l3-offline-placeholder"; // not a key: the in-test endpoint below accepts it, and no real provider is ever addressed

/** A wire-protocol bridge: the child's PostgreSQL client talks to this process's PGlite (one session, messages framed and serialized). */
function pgliteBridge(db: DisposablePostgres["db"]): Promise<{ port: number; close(): Promise<void> }> {
  let queue: Promise<unknown> = Promise.resolve();
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0), started = false;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const messages: Buffer[] = [];
      for (;;) {
        if (!started) {
          if (buffer.length < 8) break;
          const length = buffer.readInt32BE(0);
          if (buffer.length < length) break;
          const message = buffer.subarray(0, length);
          buffer = buffer.subarray(length);
          if (message.readInt32BE(4) === 80877103) { socket.write("N"); continue; } // an SSLRequest: no TLS on loopback
          started = true;
          messages.push(message);
          continue;
        }
        if (buffer.length < 5) break;
        const length = buffer.readInt32BE(1);
        if (buffer.length < 1 + length) break;
        const message = buffer.subarray(0, 1 + length);
        buffer = buffer.subarray(1 + length);
        if (message[0] === 0x58) { socket.end(); continue; } // Terminate: the session stays PGlite's
        messages.push(message);
      }
      if (!messages.length) return;
      const payload = new Uint8Array(Buffer.concat(messages));
      queue = queue.then(async () => {
        const answer = await db.execProtocolRaw(payload);
        if (answer.length && !socket.destroyed) socket.write(Buffer.from(answer));
      }).catch(() => socket.destroy());
    });
    socket.on("error", () => undefined);
    socket.on("close", () => { sockets.delete(socket); queue = queue.then(() => db.exec("ROLLBACK").catch(() => undefined)); });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    port: (server.address() as net.AddressInfo).port,
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((done) => server.close(() => done())); await queue; },
  })));
}

/** The in-test model endpoint: the OpenAI Responses API's shape, one `submit_plan` answer for the planner. */
interface Recorded { path: string; authorization: string | undefined; tools: string[]; toolChoice: unknown }
function fakeOpenAI(): Promise<{ origin: string; requests: Recorded[]; close(): Promise<void> }> {
  const requests: Recorded[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { tools?: Array<{ name?: string }>; tool_choice?: unknown };
      requests.push({ path: request.url ?? "", authorization: request.headers.authorization, tools: (body.tools ?? []).map((tool) => tool.name ?? ""), toolChoice: body.tool_choice });
      if (request.method !== "POST" || request.url !== "/v1/responses") { response.writeHead(404, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { message: "not found" } })); return; }
      const plan = { rationale: "A flight controller, its power stage and four motor channels.", blocks: DRONE_BLOCKS.map((block) => ({ ...block, sharedNets: [...block.sharedNets] })) };
      response.writeHead(200, { "content-type": "application/json", connection: "close" });
      response.end(JSON.stringify({
        id: "resp_l3_process", object: "response", created_at: Math.floor(Date.now() / 1000), status: "completed", model: "offline-l3-endpoint",
        output: [{ type: "function_call", id: "fc_l3_process", call_id: "call_plan_l3", name: "submit_plan", arguments: JSON.stringify(plan), status: "completed" }],
        usage: { input_tokens: 321, output_tokens: 123, total_tokens: 444 }, output_text: "",
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    origin: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, requests,
    close: () => new Promise<void>((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
  })));
}

/** The child's whole environment: the platform's few required names, then this test's values; nothing else is inherited. */
function childEnvironment(values: Record<string, string>): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "TEMP", "TMP", "TMPDIR", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"];
  const env: Record<string, string> = {};
  for (const name of keep) { const value = process.env[name]; if (value !== undefined) env[name] = value; }
  return { ...env, NODE_ENV: "development", ...values } as NodeJS.ProcessEnv;
}
const children = new Set<ChildProcess>();
/** Run the real script; resolve with its exit code and output (killed after `timeoutMs`). */
function runWorker(args: string[], env: NodeJS.ProcessEnv, options: { timeoutMs?: number; ipc?: boolean; onOutput?: (text: string, child: ChildProcess) => void } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TSX_CLI, "scripts/generation-worker.ts", ...args], { cwd: ROOT, env, stdio: options.ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"] });
    children.add(child);
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 150_000);
    child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); options.onOutput?.(stdout, child); });
    child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("exit", (code) => { clearTimeout(timer); children.delete(child); resolve({ code, stdout, stderr }); });
  });
}

let bridge: Awaited<ReturnType<typeof pgliteBridge>>;
let openai: Awaited<ReturnType<typeof fakeOpenAI>>;
let store: GenerationTaskStore;
let taskId = "";

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const now = new Date().toISOString();
  await pg.db.query("insert into project_members (membership_id, tenant_id, project_id, user_id, role, state, version, created_at, updated_at, audit_actor_id) values ($1, $2, $3, $4, 'editor', 'active', 1, $5, $5, 'l3-process')", ["membership-l3-process", SCOPE.tenantId, SCOPE.projectId, EDITOR, now]);
  store = new GenerationTaskStore({ repository: new PostgresDurableWorkflowRepository() });
  taskId = (await startTask({ store, scope: SCOPE })).taskId;
  bridge = await pgliteBridge(pg.db);
  openai = await fakeOpenAI();
}, 180_000);
afterAll(async () => {
  for (const child of children) child.kill();
  await openai?.close();
  await bridge?.close();
  await pg?.close();
});

const databaseUrl = () => `postgres://l3:l3@127.0.0.1:${bridge.port}/postgres`;

describe("[PR-L L.3] the real generation worker process", () => {
  it("1. --once consumes the queued plan slice, records the provider call under the task's scope and the admitting route, and exits 0", { timeout: 240_000 }, async () => {
    const run = await runWorker(["--once", "--no-env-file", "--worker-id", "l3-process-once"], childEnvironment({
      DATABASE_URL: databaseUrl(), SIRKIT_DB_POOL_MAX: "1", SIRKIT_AUTH_MODE: "production", OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `${openai.origin}/v1`, ANTHROPIC_API_KEY: "",
    }));
    expect(run.stderr).not.toMatch(/FAILED|REFUSED/);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("worker l3-process-once started (direct transport");
    expect(run.stdout).toContain("once: 1 slice(s) claimed");
    expect(run.stdout).toMatch(/plan generation-task:[0-9a-f]{32}:s1: planned -> task queued/);
    expect(run.stdout + run.stderr).not.toContain(KEY); // nothing printed carries the key
    // exactly one model request, to the in-test endpoint, with the key from the child's environment (never .env.local)
    expect(openai.requests).toEqual([{ path: "/v1/responses", authorization: `Bearer ${KEY}`, tools: ["submit_plan"], toolChoice: { type: "function", name: "submit_plan" } }]);
    // the durable state the process left: the plan, three queued block slices, the plan's event completed
    const loaded = await store.load(SCOPE, taskId);
    if (!loaded.ok) throw new Error(loaded.code);
    expect(loaded.task).toMatchObject({ state: "queued", plan: { planner: { state: "planned", blocks: 3 } }, usage: { modelCalls: 1, inputTokens: 321, outputTokens: 123 } });
    expect(Object.values(loaded.task.pending).map((entry) => entry.kind)).toEqual(["block", "block", "block"]);
    const events = await new PostgresDurableWorkflowRepository().listOutbox({ scope: SCOPE, topic: GENERATION_SLICE_TOPIC });
    expect(events.filter((event) => event.state === "completed").map((event) => event.payload.kind)).toEqual(["plan"]);
    expect(events.filter((event) => event.state === "pending")).toHaveLength(3);
    // the call record: written by the child's bound sink, under the task's scope and the admitting route
    const records = await pg.db.query<{ payload: { routeId: string; method: string; provider: string; outcome: string; inputTokens: number } }>("select payload from durable_workflow_records where aggregate_type = 'llm.call-record.v1' and tenant_id = $1 and project_id = $2", [SCOPE.tenantId, SCOPE.projectId]);
    expect(records.rows.map((row) => row.payload)).toEqual([expect.objectContaining({ routeId: "/api/generation-tasks", method: "POST", provider: "openai", outcome: "completed", inputTokens: 321 })]);
  });

  it("2. a restarted long-running worker resumes from the durable state, settles the queued slices honestly, serves /healthz and shuts down gracefully", { timeout: 240_000 }, async () => {
    const healthPort = 41_000 + Math.floor(Math.random() * 2_000);
    let asked = false, health: unknown = null;
    const run = await runWorker(["--no-env-file", "--worker-id", "l3-process-restarted", "--health-port", String(healthPort), "--grace-ms", "2000"], childEnvironment({
      DATABASE_URL: databaseUrl(), SIRKIT_DB_POOL_MAX: "1", SIRKIT_AUTH_MODE: "production", OPENAI_API_KEY: "", OPENAI_BASE_URL: `${openai.origin}/v1`, ANTHROPIC_API_KEY: "",
    }), {
      ipc: true,
      onOutput: (stdout, child) => {
        if (asked || (stdout.match(/: blocked \(provider_credentials\)/g) ?? []).length < 3) return;
        asked = true;
        void fetch(`http://127.0.0.1:${healthPort}/healthz`).then((response) => response.json()).then((body: unknown) => { health = body; }).finally(() => child.send({ type: "shutdown" }));
      },
    });
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("shutdown request: stopping");
    expect(run.stdout).toContain("stopped");
    expect(health).toMatchObject({ mode: "direct", workerId: "l3-process-restarted", running: 0, stopping: false });
    expect(openai.requests).toHaveLength(1); // no call: the claim's re-check found no provider key
    const loaded = await store.load(SCOPE, taskId);
    if (!loaded.ok) throw new Error(loaded.code);
    expect(loaded.task).toMatchObject({ state: "waiting-for-resource", blocker: { code: "provider_credentials" }, pending: {} });
    expect(Object.values(loaded.task.blocks).map((block) => [block?.status, block?.blocker])).toEqual([["blocked", "provider_credentials"], ["blocked", "provider_credentials"], ["blocked", "provider_credentials"]]);
    expect(await new PostgresDurableWorkflowRepository().listOutbox({ scope: SCOPE, topic: GENERATION_SLICE_TOPIC, state: "pending" })).toEqual([]);
  });

  it("3. without DATABASE_URL the worker refuses, claims nothing and exits 2", { timeout: 240_000 }, async () => {
    const run = await runWorker(["--once", "--no-env-file"], childEnvironment({ SIRKIT_AUTH_MODE: "production", OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `${openai.origin}/v1` }));
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("REFUSED GENERATION_TASK_STORE_UNAVAILABLE");
    expect(openai.requests).toHaveLength(1);
  });
});
