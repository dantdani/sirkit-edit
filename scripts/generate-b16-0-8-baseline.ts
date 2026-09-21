/**
 * B16.0.8 §A — the raw-route MIGRATION RATCHET baseline generator.
 *
 * Maintains `app/lib/auth/__tests__/_raw-route-baseline.json`: the frozen set
 * of legacy raw (non-canonical-wrapper) route methods, each `{ method, route,
 * sha1 }`. The baseline may ONLY SHRINK:
 *   - freeze (file absent): writes the complete current raw set;
 *   - update (file present): removes entries whose methods are now canonical
 *     wrappers, and REFUSES any addition (a raw method not already in the
 *     baseline) unless it appears in the explicit, test-pinned
 *     ALLOWED_BASELINE_ADDITIONS list.
 *
 * Deterministic (sorted, no timestamps). Run:
 *   npx tsx scripts/generate-b16-0-8-baseline.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm, exportedHttpMethods } from "../app/lib/auth/__tests__/_boundary-analysis";
import { listRouteFiles, routePathOf } from "../app/lib/auth/route-tree";

/** Test-pinned migration exceptions. MUST stay empty unless an explicit,
 *  reviewed exception is approved — the ratchet test pins this to []. */
export const ALLOWED_BASELINE_ADDITIONS: readonly string[] = [];

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "app", "lib", "auth", "__tests__", "_raw-route-baseline.json");

interface BaselineEntry { method: string; route: string; sha1: string }

export function currentRawMethods(rootDir: string): BaselineEntry[] {
  const entries: BaselineEntry[] = [];
  // [B20 B2] app/api AND app/.well-known, through the one route-tree helper (OD-66)
  for (const file of listRouteFiles(rootDir)) {
    const route = routePathOf(rootDir, file);
    const src = readFileSync(file, "utf8");
    for (const method of exportedHttpMethods(src, file)) {
      const c = classifyRouteMethodForm(src, method, file, rootDir);
      if (c.form === "canonical-wrapper") continue;
      // factories and raw handlers are both NON-wrapper legacy forms tracked by
      // the baseline until each migrates.
      entries.push({ method, route, sha1: createHash("sha1").update(src).digest("hex") });
    }
  }
  return entries.sort((a, b) => (a.route + "#" + a.method).localeCompare(b.route + "#" + b.method));
}

/** PURE ratchet decision: which of `current` would be REFUSED additions given
 *  the existing baseline keys? (Exported for the ratchet tripwire tests.) */
export function refusedBaselineAdditions(existingKeys: ReadonlySet<string>, current: readonly BaselineEntry[], allowed: readonly string[]): BaselineEntry[] {
  return current.filter((e) => !existingKeys.has(`${e.route}#${e.method}`) && !allowed.includes(`${e.route}#${e.method}`));
}

// Run only as a script (tsx) — importing this module from a test is side-effect free.
const invokedAsScript = Boolean(process.argv[1] && process.argv[1].replace(/\\/g, "/").includes("generate-b16-0-8-baseline"));
if (invokedAsScript) {
const current = currentRawMethods(ROOT);
if (!existsSync(BASELINE_PATH)) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  process.stdout.write(`FROZE raw-route baseline: ${current.length} legacy methods → ${BASELINE_PATH}\n`);
} else {
  const existing = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineEntry[];
  const existingKeys = new Set(existing.map((e) => `${e.route}#${e.method}`));
  const additions = refusedBaselineAdditions(existingKeys, current, ALLOWED_BASELINE_ADDITIONS);
  if (additions.length > 0) {
    process.stderr.write(`REFUSED: the raw-route baseline may only shrink. New raw methods (migrate them to canonical wrappers instead):\n${additions.map((a) => `  ${a.method} ${a.route}`).join("\n")}\n`);
    process.exit(1);
  }
  // removals only: keep the entries that are STILL raw (with refreshed hashes).
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  const removed = existing.length - current.length;
  process.stdout.write(`Updated raw-route baseline: ${existing.length} → ${current.length} legacy methods (${removed} migrated, 0 added)\n`);
}
}
