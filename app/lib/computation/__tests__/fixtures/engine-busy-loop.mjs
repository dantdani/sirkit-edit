// [B22-B] Test fixture (not production, never in the engine table): a computation that ignores its budget - it never yields.
import { parentPort } from "node:worker_threads";
let spins = 0;
while (spins >= 0) spins += 1;
parentPort.postMessage({ ok: true, output: { spins } });
