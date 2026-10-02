// [B22-B] Test fixture: reports what the worker inherited (names counted, never a value) and answers once.
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ ok: true, output: { envKeys: Object.keys(process.env).length, execArgv: process.execArgv.length } });
