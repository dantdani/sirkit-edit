// [PR-L, 2026-10-17] Runbook L.3, increment 3 part 2 (task-worker-contract.md section 4; persistent-generation/worker.md):
// `pnpm run dev:with-worker` - the Next dev server AND the generation worker together, for local work on the durable generation tasks.
// `pnpm dev` is unchanged (OD-252 / OWNER-5: the worker stays a separate process by default; run it in a second terminal with
// `pnpm run worker:generation`). Use this INSTEAD of `pnpm dev`, never beside it on the same port.
//
//   pnpm run dev:with-worker                    next dev on :3000 + the worker (direct transport: DATABASE_URL from .env.local)
//   pnpm run dev:with-worker -- --port 3005     another port
//   pnpm run dev:with-worker -- --dry-run       print the two commands and exit
//
// Both children are spawned with node directly (no shell), so a stop reaches them: on SIGINT/SIGTERM (or when either child exits) the
// worker is asked to shut down over its IPC channel (it yields its slices at a turn boundary and releases the rest), next dev gets
// SIGTERM; whatever is still running after the grace is ended (on Windows with `taskkill /T`, which also ends next's own children).
// [PR-L, 2026-10-17] increment 4: under the fixture runtime (SIRKIT_FIXTURE_RUNTIME=blinker) the task store lives inside the dev server's
// process, so the worker runs the HTTP PUMP transport against it (`--transport pump --origin http://localhost:<port> --no-env-file`):
// each tick POSTs /api/generation-worker and the server runs one slice. The two children share a per-launch random worker secret
// (SIRKIT_WORKFLOW_WORKER_SECRET, 32 random bytes, never printed) unless the shell already set one. The Playwright fixture server
// starts through this script, so the browser proofs have a real worker. Outside the fixture nothing changed (the direct transport).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

/** A file of an installed package, by path (pnpm links every direct dependency under node_modules/). */
const installed = (path) => fileURLToPath(new URL(`../node_modules/${path}`, import.meta.url));
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const portIndex = argv.indexOf("--port");
const port = portIndex >= 0 ? argv[portIndex + 1] : "3000";
const GRACE_MS = 15_000;

if (!/^\d{2,5}$/.test(port ?? "")) {
  console.error("[dev-with-worker] REFUSED: --port takes a port number");
  process.exit(2);
}
const fixture = (process.env.SIRKIT_FIXTURE_RUNTIME ?? "").trim() === "blinker";
const env = { ...process.env };
// the fixture's worker reaches the dev server's in-memory store through the pump, authenticated by a secret only these two children hold
if (fixture && !(env.SIRKIT_WORKFLOW_WORKER_SECRET ?? "").trim()) env.SIRKIT_WORKFLOW_WORKER_SECRET = randomBytes(32).toString("hex");
const workerArgv = fixture
  ? [installed("tsx/dist/cli.mjs"), "scripts/generation-worker.ts", "--transport", "pump", "--origin", `http://localhost:${port}`, "--no-env-file", "--concurrency", "1"]
  : [installed("tsx/dist/cli.mjs"), "scripts/generation-worker.ts"];

const children = [
  { name: "next", argv: [installed("next/dist/bin/next"), "dev", "--port", port], ipc: false },
  { name: "worker", argv: workerArgv, ipc: true },
];
if (dryRun) {
  for (const child of children) console.log(`[dev-with-worker] would start ${child.name}: node ${child.argv.map((part) => part.replace(process.cwd(), ".")).join(" ")}`);
  process.exit(0);
}

let exitCode = null;
const running = children.map((child) => {
  const process_ = spawn(process.execPath, child.argv, { stdio: child.ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit", env });
  const entry = { ...child, process: process_, exited: false };
  process_.on("exit", (code, signal) => {
    entry.exited = true;
    console.log(`[dev-with-worker] ${child.name} exited (${code ?? signal})`);
    if (exitCode === null) exitCode = typeof code === "number" ? code : 1;
    stopAll(`${child.name} exited`);
    if (running.every((other) => other.exited)) process.exit(exitCode ?? 0);
  });
  return entry;
});

let stopping = false;
function stopAll(why) {
  if (stopping) return;
  stopping = true;
  console.log(`[dev-with-worker] stopping (${why})`);
  for (const entry of running) {
    if (entry.exited) continue;
    if (entry.ipc && entry.process.connected) entry.process.send({ type: "shutdown" });
    else if (process.platform !== "win32") entry.process.kill("SIGTERM");
  }
  const timer = setTimeout(() => {
    for (const entry of running) {
      if (entry.exited) continue;
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(entry.process.pid), "/T", "/F"], { stdio: "ignore" });
      else entry.process.kill("SIGKILL");
    }
  }, process.platform === "win32" ? 5_000 : GRACE_MS);
  timer.unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { if (exitCode === null) exitCode = 0; stopAll(signal); });
