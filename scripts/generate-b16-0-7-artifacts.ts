/**
 * B16.0.7 — regenerate the byte-pinned wrapper-adoption inventory:
 *   artifacts/ai-control-plane-b16-0-7/route-wrapper-matrix.csv
 * Deterministic (sorted; no timestamps). Uses the SAME classifier the adoption
 * gate runs. This is a build script (tsx), never in the production graph.
 * [B20 B2] D20-35: `renderRouteWrapperMatrix` is an exported pure function,
 * byte-pinned by b20-b2-route-matrices-pinned; the file is written only when this
 * module runs as a script. The inventory walks app/api AND app/.well-known (OD-66).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm, exportedHttpMethods } from "../app/lib/auth/__tests__/_boundary-analysis";
import { policyFor } from "../app/lib/auth/route-policy";
import { listRouteFiles, routePathOf } from "../app/lib/auth/route-tree";

const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/** [B20 B2] The wrapper matrix of the route tree under `rootDir` and its counts (pure: reads, never writes). */
function renderWrapperMatrix(rootDir: string): { csv: string; total: number; wrappers: number; factories: number; raw: number } {
  const rows: string[] = [["method", "route", "policy_class", "current_form", "wrapper_or_factory", "target_wrapper", "migration_status"].map(esc).join(",")];
  let total = 0, wrappers = 0, raw = 0, factories = 0;
  for (const file of listRouteFiles(rootDir)) {
    const path = routePathOf(rootDir, file);
    const src = readFileSync(file, "utf8");
    for (const method of exportedHttpMethods(src, file)) {
      total += 1;
      const policy = policyFor(path.replace(/\[[^\]]+\]/g, "x"), method) ?? policyFor(path, method);
      const requiresAuth = Boolean(policy?.requiresAuth);
      const bodyConsuming = method === "POST" || method === "PUT" || method === "PATCH";
      const c = classifyRouteMethodForm(src, method, file, rootDir);
      const form = c.form;
      let detail = "-";
      if (c.form === "canonical-wrapper") { wrappers += 1; detail = c.wrapper; }
      else if (c.form === "factory") { factories += 1; detail = `${c.factory} (${c.specifier})`; }
      else raw += 1;
      const target = form === "canonical-wrapper" ? "(adopted)"
        : requiresAuth && bodyConsuming ? "authenticatedJsonRoute"
          : requiresAuth ? "authenticatedRoute"
            : bodyConsuming ? "publicJsonRoute"
              : "publicRoute/authenticatedRoute";
      const status = form === "canonical-wrapper" ? "adopted" : "PENDING_MIGRATION";
      rows.push([method, path, policy ? `${policy.requiresAuth ? "auth" : "public"}${policy.requiresCsrf ? "+csrf" : ""}` : "(no policy)", form, detail, target, status].map(esc).join(","));
    }
  }
  return { csv: rows.join("\n") + "\n", total, wrappers, factories, raw };
}

/** route-wrapper-matrix.csv, rendered (byte-pinned). */
export function renderRouteWrapperMatrix(rootDir: string): string {
  return renderWrapperMatrix(rootDir).csv;
}

// Run only as a script (tsx) - importing this module from a test is side-effect free (the generate-b16-0-8-baseline precedent).
const invokedAsScript = Boolean(process.argv[1] && process.argv[1].replace(/\\/g, "/").includes("generate-b16-0-7-artifacts"));
if (invokedAsScript) {
  const ROOT = process.cwd();
  const { csv, total, wrappers, factories, raw } = renderWrapperMatrix(ROOT);
  const outDir = join(ROOT, "artifacts", "ai-control-plane-b16-0-7");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "route-wrapper-matrix.csv"), csv);
  process.stdout.write(`Wrote route-wrapper-matrix.csv: ${total} methods — ${wrappers} canonical wrappers, ${factories} factories, ${raw} raw (PENDING_MIGRATION) → ${outDir}\n`);
}
