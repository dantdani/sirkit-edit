/**
 * B16.0.7 — regenerate the byte-pinned wrapper-adoption inventory:
 *   artifacts/ai-control-plane-b16-0-7/route-wrapper-matrix.csv
 * Deterministic (sorted; no timestamps). Uses the SAME classifier the adoption
 * gate runs. This is a build script (tsx), never in the production graph.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { classifyRouteMethodForm, exportedHttpMethods } from "../app/lib/auth/__tests__/_boundary-analysis";
import { policyFor } from "../app/lib/auth/route-policy";

const ROOT = process.cwd();
function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out.sort();
}
const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

const rows: string[] = [["method", "route", "policy_class", "current_form", "wrapper_or_factory", "target_wrapper", "migration_status"].map(esc).join(",")];
let total = 0, wrappers = 0, raw = 0, factories = 0;
for (const file of routeFiles(join(ROOT, "app", "api"))) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  const path = "/" + rel.replace(/^app\//, "").replace(/\/route\.ts$/, "");
  const src = readFileSync(file, "utf8");
  for (const method of exportedHttpMethods(src, file)) {
    total += 1;
    const policy = policyFor(path.replace(/\[[^\]]+\]/g, "x"), method) ?? policyFor(path, method);
    const requiresAuth = Boolean(policy?.requiresAuth);
    const bodyConsuming = method === "POST" || method === "PUT" || method === "PATCH";
    const c = classifyRouteMethodForm(src, method, file, ROOT);
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
const outDir = join(ROOT, "artifacts", "ai-control-plane-b16-0-7");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "route-wrapper-matrix.csv"), rows.join("\n") + "\n");
process.stdout.write(`Wrote route-wrapper-matrix.csv: ${total} methods — ${wrappers} canonical wrappers, ${factories} factories, ${raw} raw (PENDING_MIGRATION) → ${outDir}\n`);
