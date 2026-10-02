// [B22-B] Test fixture: allocates without bound until the worker's heap limit stops it.
import { parentPort } from "node:worker_threads";
const kept = [];
while (kept.length >= 0) kept.push(new Array(100_000).fill(kept.length));
parentPort.postMessage({ ok: true, output: { kept: kept.length } });
