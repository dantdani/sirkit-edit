/**
 * B16.0.4 — regenerate the committed byte-pinned artifacts:
 *   artifacts/ai-control-plane-b16-0-4/method-authorization-matrix.csv
 *   artifacts/ai-control-plane-b16-0-4/request-body-boundary-matrix.csv
 *
 * Run after any route / policy / body-reader change:
 *   npx tsx scripts/generate-b16-0-4-artifacts.ts
 *
 * Deterministic: sorted route order, no timestamps — running twice must be
 * byte-identical. The authorization verdict column comes from the SAME
 * method-scoped analyzer the CI gate runs (`analyzeMethodBoundary`), so the
 * CSV can never claim a verdict the gate does not enforce. This is a build
 * script (tsx), never part of the production runtime graph.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { policyFor } from "../app/lib/auth/route-policy";
import {
  analyzeMethodBoundary,
  directBodyReads,
  exportedHttpMethods,
} from "../app/lib/auth/__tests__/_boundary-analysis";

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

/** Resolve a numeric literal or a same-file `const NAME = <number>` reference. */
function resolveNumber(source: string, expr: string): string {
  const cleaned = expr.trim();
  if (/^[\d_]+$/.test(cleaned)) return cleaned.replaceAll("_", "");
  const m = source.match(new RegExp(`const\\s+${cleaned}\\s*=\\s*([\\d_]+)`));
  if (m) return m[1].replaceAll("_", "");
  return cleaned; // honest fallback: emit the expression text
}

interface BodyFacts { parser: string; maxBytes: string; deadlineMs: string; mediaType: string }

/** Extract the bounded-parser facts from a handler source (route.ts, or its
 *  _scope/handler delegate when the route itself reads no body). */
function bodyFacts(source: string, file: string): BodyFacts | null {
  const bounded = source.match(/readBoundedJson(Object|Body)\(\s*\w+\s*,\s*\{\s*maxBytes:\s*([A-Za-z0-9_]+)\s*(?:,\s*deadlineMs:\s*([A-Za-z0-9_]+))?/);
  if (bounded) {
    return {
      parser: `readBoundedJson${bounded[1]}`,
      maxBytes: resolveNumber(source, bounded[2]),
      deadlineMs: bounded[3] ? resolveNumber(source, bounded[3]) : "30000(default)",
      mediaType: "application/json",
    };
  }
  const stream = source.match(/readBoundedStream\(\s*\w+(?:\.body)?\s*,\s*([A-Za-z0-9_]+)/);
  if (stream) {
    const deadline = source.match(/deadlineMs:\s*([A-Za-z0-9_]+)/);
    return {
      parser: "readBoundedStream+manual-parse",
      maxBytes: resolveNumber(source, stream[1]),
      deadlineMs: deadline ? resolveNumber(source, deadline[1]) : "30000(default)",
      mediaType: "application/json",
    };
  }
  if (/scopedTrustedJson/.test(source)) {
    const max = source.match(/max(?:Body)?Bytes:\s*([A-Za-z0-9_]+)/);
    return {
      parser: "scopedTrustedJson(bounded)",
      maxBytes: max ? resolveNumber(source, max[1]) : "module-default",
      deadlineMs: "30000(default)",
      mediaType: "application/json",
    };
  }
  // follow ONE level of local delegation (_scope.ts / handler.ts) — the
  // B16.0.1 pattern where the route calls its family's scoped helper.
  for (const spec of source.matchAll(/from\s+"(\.\.?\/[^"]+)"/g)) {
    if (!/_scope|handler/.test(spec[1])) continue;
    for (const candidate of [`${spec[1]}.ts`, `${spec[1]}/index.ts`]) {
      const target = join(file, "..", candidate);
      try {
        const delegate = readFileSync(target, "utf8");
        const facts = bodyFacts(delegate, target);
        if (facts) return { ...facts, parser: `${facts.parser} via ${relative(join(file, ".."), target).replaceAll("\\", "/")}` };
      } catch { /* not a resolvable local module — keep looking */ }
    }
  }
  return null;
}

/** Coarse downstream classification from imports (evidence, not proof). */
function downstream(source: string): string {
  const hits: string[] = [];
  if (/llmRouter|runBuildToolLoop|llm\/router/.test(source)) hits.push("provider");
  if (/getDb|db\/client|Repository|authority-source|job-store|assignmentService/.test(source)) hits.push("durable");
  if (/child_process|spawn|execFile|freerouting|ngspice/i.test(source)) hits.push("process");
  return hits.length ? hits.join("+") : "compute";
}

const csvEscape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
const row = (cells: string[]): string => cells.map(csvEscape).join(",");

const authRows: string[] = [row(["method", "route", "policy_class", "access", "handler_symbol", "verdict", "shape", "detail"])];
const bodyRows: string[] = [row(["method", "route", "policy_class", "access", "handler_symbol", "media_type", "max_wire_bytes", "deadline_ms", "authorization_ordering", "parser", "downstream", "evidence_test"])];

for (const file of routeFiles(join(ROOT, "app", "api"))) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  const path = "/" + rel.replace(/^app\//, "").replace(/\/route\.ts$/, "");
  const source = readFileSync(file, "utf8");
  // [B16.0.8] a canonical JSON WRAPPER consumes the body inside route-handlers:
  // extract its declared limits so the matrix reports the true body contract.
  const wrapperJson = source.match(/(authenticatedJsonRoute|publicJsonRoute|workerJsonRoute)\s*(?:<[^>]*>)?\s*\(\s*\{([^}]*)\}/);
  const wrapperFacts = wrapperJson
    ? {
      parser: `canonical-wrapper:${wrapperJson[1]}`,
      maxBytes: resolveNumber(source, /maxBytes:\s*([A-Za-z0-9_]+)/.exec(wrapperJson[2]!)?.[1] ?? "(declared)"),
      deadlineMs: (() => { const d = /deadlineMs:\s*([A-Za-z0-9_]+)/.exec(wrapperJson[2]!); return d ? resolveNumber(source, d[1]!) : "30000(default)"; })(),
      mediaType: "application/json",
    }
    : null;
  const facts = wrapperFacts ?? bodyFacts(source, file);
  const reads = directBodyReads(source, rel);
  for (const method of exportedHttpMethods(source, file)) {
    const policy = policyFor(path.replace(/\[[^\]]+\]/g, "x"), method) ?? policyFor(path, method);
    const worker = /timingSafeEqual|WORKER_SECRET/.test(source);
    const access = policy?.requiresAuth ? (worker ? "worker" : "authenticated") : "public";
    const symbolMatch = source.match(new RegExp(`export\\s+const\\s+${method}\\s*=\\s*([A-Za-z0-9_]+)\\s*\\(`));
    const symbol = symbolMatch ? `${symbolMatch[1]}(…)` : method;
    const policyClass = policy ? `${policy.requiresAuth ? "auth" : "public"}${policy.requiresCsrf ? "+csrf" : ""}` : "(no policy row)";

    if (policy?.requiresAuth) {
      const v = analyzeMethodBoundary(source, method, file, ROOT);
      authRows.push(row([method, path, policyClass, access, symbol, v.ok ? "load-bearing" : "REJECT", v.ok ? v.via : "-", v.ok ? v.detail : v.reason]));
    } else {
      authRows.push(row([method, path, policyClass, access, symbol, "n/a(public)", "-", "-"]));
    }

    const consumesBody = method !== "GET" && method !== "HEAD" && (facts !== null || reads.length > 0);
    const ordering = !consumesBody
      ? "no-body"
      : access === "authenticated" ? "authorize-then-body"
        : access === "worker" ? "worker-secret-then-body"
          : "bounded-body-before-compute";
    bodyRows.push(row([
      method, path, policyClass, access, symbol,
      consumesBody ? (facts?.mediaType ?? "UNBOUNDED") : "-",
      consumesBody ? (facts?.maxBytes ?? "UNBOUNDED") : "-",
      consumesBody ? (facts?.deadlineMs ?? "UNBOUNDED") : "-",
      ordering,
      consumesBody ? (facts?.parser ?? `DIRECT:${reads.map((r) => r.api).join("/")}`) : "-",
      downstream(source),
      policy?.requiresAuth
        ? "b16-0-2-gates §A/§C + b16-0-4-bounded-body-behavior"
        : "b16-0-2-gates §C + b16-0-4-bounded-body-behavior",
    ]));
  }
}

const outDir = join(ROOT, "artifacts", "ai-control-plane-b16-0-4");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "method-authorization-matrix.csv"), authRows.join("\n") + "\n");
writeFileSync(join(outDir, "request-body-boundary-matrix.csv"), bodyRows.join("\n") + "\n");
process.stdout.write(`Wrote method-authorization-matrix.csv (${authRows.length - 1} rows) and request-body-boundary-matrix.csv (${bodyRows.length - 1} rows) to ${outDir}\n`);
