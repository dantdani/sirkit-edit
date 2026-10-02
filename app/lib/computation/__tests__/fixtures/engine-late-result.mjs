// [B22-B] Test fixture: blocks synchronously for `delayMs` (no event loop turn), then posts a result - after its budget.
import { parentPort, workerData } from "node:worker_threads";
const until = Date.now() + Number(workerData?.input?.delayMs ?? 0);
while (Date.now() < until) { /* busy, synchronous */ }
parentPort.postMessage({ ok: true, output: { late: true } });
