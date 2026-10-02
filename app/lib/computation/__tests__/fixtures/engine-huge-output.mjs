// [B22-B] Test fixture: answers with an output far over any computation's output bound.
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ ok: true, output: { text: "x".repeat(1_000_000) } });
