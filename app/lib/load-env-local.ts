/**
 * Minimal `.env.local` loader for standalone (non-Next.js) processes.
 *
 * Next.js loads `.env.local` automatically for the dev server and API routes,
 * but the drizzle-kit CLI and the ingestion script run as plain Node processes
 * that do not. This zero-dependency loader fills that gap. It never overrides a
 * variable that is already set in the real environment.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let loaded = false;

/** Parse `<cwd>/.env.local` (if present) into `process.env`. Idempotent. */
export function loadEnvLocal(): void {
  if (loaded) return;
  loaded = true;

  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    if (process.env[key] !== undefined) continue; // never override real env

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
