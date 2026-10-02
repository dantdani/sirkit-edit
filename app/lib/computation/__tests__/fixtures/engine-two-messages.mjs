// [B22-B] Test fixture: answers twice; only the first answer may count.
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ ok: true, output: { answer: 1 } });
parentPort.postMessage({ ok: true, output: { answer: 2 } });
