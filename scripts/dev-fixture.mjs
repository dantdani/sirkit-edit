// [B16-C §5] Start the Next.js dev server under the env-gated FIXTURE RUNTIME
// (in-memory stores, committed blinker catalog, recorded provider design,
// recorded router replay, local-development identity with a dev-only role
// cookie). Used by the page-level browser proof and by `pnpm run dev:fixture`.
// Never usable in a production runtime (see app/lib/fixture-runtime/mode.ts).
import { spawn } from "node:child_process";

const port = process.env.SIRKIT_E2E_PORT ?? "3100";
const env = {
  ...process.env,
  NODE_ENV: "development",
  SIRKIT_AUTH_MODE: "local_dev",
  SIRKIT_FIXTURE_RUNTIME: "blinker",
  SIRKIT_FIXTURE_ROUTER: process.env.SIRKIT_FIXTURE_ROUTER ?? "replay",
  SIRKIT_PCB_SYNC_STAGE3: "opt_in",
  DATABASE_URL: "",
};
const child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "next", "dev", "--port", port], { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
