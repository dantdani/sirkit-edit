/**
 * B16.0.1 §I — the permanent authorization CI gates (R5/R6/R9 closure).
 *
 * These gates make the exact-policy regime UNDODABLE by accident:
 *  1. every (route.ts, exported HTTP method) has an EXACT policy — a new
 *     route/method fails CI until classified (and `authorizeRequest` already
 *     fails it closed at runtime with AUTH_POLICY_MISSING);
 *  2. every policy row names a route file that actually exists (no stale or
 *     typo'd rows silently matching nothing);
 *  3. ZERO production `app/api` files read a caller-identity header
 *     (x-sirkit-actor-id / -role / -actor-kind / -session-id) — the
 *     legacy-header-scope count is pinned at ZERO, with a synthetic-injection
 *     tripwire proving the scanner sees such a read;
 *  4. policy invariants: provider-credit routes are never public; mutation/
 *     release rows never ride identity_source=none; authenticated writes
 *     require same-origin CSRF; public rows carry no credit/write/release;
 *     the release perimeter is role-exact (release=project_admin only,
 *     qualify=pcb_editor|project_admin);
 *  5. negative tripwires: an unclassified sub-path under a classified family
 *     (e.g. /api/calculation/evil) has NO policy and refuses 500;
 *  6. agent tool exposure equals the intentional list and `sirkit.manufacturing.release`
 *     stays internal-only and not-callable;
 *  7. AST import gates: browser-reachable code can never import the server
 *     auth modules, and the provider/agent/gateway layer can never import the
 *     apply-time reauthorization or approval authority.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { allRoutePolicies, policyFor, renderExactRoutePolicyCsv } from "../route-policy";
import { authorizeRequest } from "../authorize";
import { buildAuthRouteCoverage, LEGACY_HEADER_SCOPE_PATH_PREFIXES } from "../route-coverage";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import {
  collectProductionFiles,
  moduleImportOffenders,
} from "../../project/__tests__/_import-gate-helpers";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();

// ─── 1+2: route inventory ↔ exact policy bijection ──────────────────────────

interface RouteMethod { path: string; method: string; file: string }

const METHOD_NAMES = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Hidden directories (.git, .next, .claude — which hosts agent worktrees with full copies of the tree) are not source.
    if (entry === "__tests__" || entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function exportedMethods(source: string): string[] {
  const found = new Set<string>();
  for (const name of METHOD_NAMES) {
    if (new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(source)) found.add(name);
    if (new RegExp(`export\\s+const\\s+${name}\\b`).test(source)) found.add(name);
    if (new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source)) found.add(name);
  }
  return [...found];
}

function inventory(): RouteMethod[] {
  const results: RouteMethod[] = [];
  for (const file of routeFiles(join(ROOT, "app", "api"))) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const path = "/" + rel.replace(/^app\//, "").replace(/\/route\.ts$/, "");
    for (const method of exportedMethods(readFileSync(file, "utf8"))) {
      results.push({ path, method, file: rel });
    }
  }
  return results;
}

describe("B16.0.1 §I — exact route policy coverage", () => {
  const routes = inventory();

  it("scans a non-trivial route inventory (sanity)", () => {
    expect(routes.length).toBeGreaterThan(140);
  });

  it("EVERY exported route method has an exact policy (a new route fails until classified)", () => {
    const missing = routes.filter((route) => policyFor(route.path, route.method) === null);
    expect(missing.map((route) => `${route.method} ${route.path}`)).toEqual([]);
  });

  it("EVERY policy row names a route file that exists with that method exported (no stale rows)", () => {
    const byKey = new Set(routes.map((route) => `${route.method} ${route.path}`));
    const stale = allRoutePolicies().filter((policy) => !byKey.has(`${policy.method} ${policy.path}`));
    expect(stale.map((policy) => `${policy.method} ${policy.path}`)).toEqual([]);
  });

  it("the legacy-header-scope count is ZERO and the backlog is EMPTY (R5/R6 closed, may never grow)", () => {
    expect(LEGACY_HEADER_SCOPE_PATH_PREFIXES).toEqual([]);
    const legacy = buildAuthRouteCoverage().filter((entry) => entry.identitySource === "legacy-header-scope");
    expect(legacy.map((entry) => entry.path)).toEqual([]);
  });

  it("policy (path, method) pairs are unique — no ambiguous duplicate rows", () => {
    const seen = new Set<string>();
    for (const policy of allRoutePolicies()) {
      const key = `${policy.method} ${policy.path}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("the committed exact-route-authorization-policy.csv is byte-identical to the renderer", () => {
    const artifact = join(ROOT, "artifacts", "ai-control-plane-b16-0-1", "exact-route-authorization-policy.csv");
    expect(existsSync(artifact), "run: npx tsx scripts/generate-b16-0-1-artifacts.ts").toBe(true);
    expect(readFileSync(artifact, "utf8").replaceAll("\r\n", "\n")).toBe(renderExactRoutePolicyCsv());
  });
});

// ─── 3: zero caller-identity header reads (legacy-header-scope = 0) ─────────

const FORBIDDEN_IDENTITY_HEADERS = ["x-sirkit-actor-id", "x-sirkit-role", "x-sirkit-actor-kind", "x-sirkit-session-id"] as const;

function identityHeaderReads(files: Map<string, string>): Array<{ file: string; header: string }> {
  const reads: Array<{ file: string; header: string }> = [];
  for (const [file, source] of files) {
    for (const header of FORBIDDEN_IDENTITY_HEADERS) {
      if (source.toLowerCase().includes(header)) reads.push({ file, header });
    }
  }
  return reads;
}

describe("B16.0.1 §I — zero caller-identity header reads in production app/api", () => {
  const production = collectProductionFiles(ROOT);
  const apiFiles = new Map([...production].filter(([path]) => path.startsWith("app/api/")));

  it("the production app/api tree references NO identity header (pinned at ZERO)", () => {
    expect(identityHeaderReads(apiFiles)).toEqual([]);
  });

  it("NEGATIVE tripwire: an injected identity-header read IS detected", () => {
    const injected = new Map(apiFiles);
    injected.set("app/api/evil/route.ts", 'const role = request.headers.get("x-sirkit-role");');
    expect(identityHeaderReads(injected)).toEqual([{ file: "app/api/evil/route.ts", header: "x-sirkit-role" }]);
  });
});

// ─── 4: policy invariants ───────────────────────────────────────────────────

describe("B16.0.1 §I — policy invariants", () => {
  const policies = allRoutePolicies();

  it("provider-credit routes are NEVER public", () => {
    const offending = policies.filter((policy) => policy.providerCredit && !policy.requiresAuth);
    expect(offending.map((policy) => `${policy.method} ${policy.path}`)).toEqual([]);
  });

  it("mutation/release rows never ride identity_source=none", () => {
    const offending = policies.filter(
      (policy) => (policy.authoritativeWrite || policy.releaseOrQualification) && (policy.identitySource === "none" || !policy.requiresAuth),
    );
    expect(offending.map((policy) => `${policy.method} ${policy.path}`)).toEqual([]);
  });

  it("every authenticated non-GET/HEAD human route requires same-origin CSRF", () => {
    const offending = policies.filter(
      (policy) => policy.requiresAuth && policy.identitySource !== "worker-secret"
        && policy.method !== "GET" && policy.method !== "HEAD" && !policy.requiresCsrf,
    );
    expect(offending.map((policy) => `${policy.method} ${policy.path}`)).toEqual([]);
  });

  it("public rows carry no credit, no authoritative write, no release", () => {
    const offending = policies.filter(
      (policy) => !policy.requiresAuth && (policy.providerCredit || policy.authoritativeWrite || policy.releaseOrQualification),
    );
    expect(offending.map((policy) => `${policy.method} ${policy.path}`)).toEqual([]);
  });

  it("the release perimeter is role-exact: release=project_admin ONLY; qualify=pcb_editor|project_admin", () => {
    expect(policyFor("/api/pcb/release", "POST")).toMatchObject({
      releaseOrQualification: true, requiresCsrf: true, permittedRoles: ["project_admin"],
    });
    expect(policyFor("/api/pcb/qualify", "POST")).toMatchObject({
      releaseOrQualification: true, requiresCsrf: true, permittedRoles: ["pcb_editor", "project_admin"],
    });
    // No OTHER row claims release/qualification authority.
    const releaseRows = policies.filter((policy) => policy.releaseOrQualification);
    expect(releaseRows.map((policy) => policy.path).sort()).toEqual(["/api/pcb/qualify", "/api/pcb/release"]);
  });

  it("viewer/commenter can never appear in a release or mutation role set", () => {
    const offending = policies.filter(
      (policy) => (policy.authClass === "authenticated-mutation" || policy.authClass === "authenticated-release")
        && policy.permittedRoles.some((role) => role === "viewer" || role === "commenter"),
    );
    expect(offending.map((policy) => `${policy.method} ${policy.path}`)).toEqual([]);
  });
});

// ─── 5: negative tripwires — unclassified paths refuse ──────────────────────

describe("B16.0.1 §I — unclassified routes fail closed", () => {
  it("an unclassified sub-path under a classified family has NO policy", () => {
    expect(policyFor("/api/calculation/evil", "POST")).toBeNull();
    expect(policyFor("/api/pcb/release/evil", "POST")).toBeNull();
    expect(policyFor("/api/pcb/release", "GET")).toBeNull(); // method-exact
  });

  it("authorizeRequest refuses an unclassified route with 500 AUTH_POLICY_MISSING", async () => {
    const outcome = await authorizeRequest(new Request("http://localhost/api/calculation/evil", { method: "POST", headers: { origin: "http://localhost" } }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.response.status).toBe(500);
    expect(await outcome.response.json()).toMatchObject({ code: "AUTH_POLICY_MISSING" });
  });
});

// ─── 6: agent exposure stays 12; release stays internal-only ────────────────

describe("B16.0.1 §I — tool exposure unchanged", () => {
  it("agent tool exposure equals the intentional list (derived, never a count)", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(exposed.length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
  });

  it("sirkit.manufacturing.release is internal-only and not-callable", () => {
    const release = sirkitToolRegistry().list().find((descriptor) => descriptor.toolId === "sirkit.manufacturing.release");
    expect(release).toBeDefined();
    expect(release!.discovery).toBe("internal-only");
    expect(release!.callability).toBe("not-callable");
    expect(release!.agentExposed).toBe(false);
  });
});

// ─── 7: AST import gates ────────────────────────────────────────────────────

describe("B16.0.1 §I — auth import boundaries (AST-resolved)", () => {
  const production = collectProductionFiles(ROOT);

  const SERVER_AUTH_MODULES = [
    "app/lib/auth/supabase-server",
    "app/lib/auth/postgres-membership",
    "app/lib/auth/worker-principal",
    "app/lib/auth/identity-provider",
  ] as const;

  it("server auth modules are importable ONLY from app/api, app/lib/auth, or the root proxy — never browser-reachable code", { timeout: 120_000 }, () => {
    for (const authModule of SERVER_AUTH_MODULES) {
      const offenders = moduleImportOffenders(production, authModule, new Set());
      const outside = offenders.filter(
        (path) => !path.startsWith("app/api/") && !path.startsWith("app/lib/auth/") && path !== "proxy.ts" && path !== "middleware.ts",
      );
      expect(outside, authModule).toEqual([]);
      // In particular: NOTHING under components/ or a client page.
      expect(offenders.filter((path) => path.includes("components/") || path.endsWith("page.tsx")), authModule).toEqual([]);
    }
  });

  it("the apply-time reauthorization authority is importable ONLY by the approval controller and the PCB composition root", () => {
    const offenders = moduleImportOffenders(
      production,
      "app/lib/project/pcb-apply-reauthorization",
      new Set(["app/components/pcb/PcbEditor.tsx", "app/lib/project/pcb-edit-approval-controller.internal.ts"]),
    );
    expect(offenders).toEqual([]);
  });

  it("the provider/agent/gateway layer imports NEITHER reauthorization NOR approval authority", () => {
    for (const gatedModule of [
      "app/lib/project/pcb-apply-reauthorization",
      "app/lib/project/pcb-edit-approval-controller.internal",
      "app/lib/engineering/pcb-edit-approval.internal",
    ]) {
      const offenders = moduleImportOffenders(production, gatedModule, new Set());
      const agentLayer = offenders.filter((path) => path.startsWith("app/lib/agent/") || path.startsWith("app/lib/llm/"));
      expect(agentLayer, gatedModule).toEqual([]);
    }
  });

  it("NEGATIVE tripwire: a synthetic agent-layer reauthorization importer IS detected", () => {
    const injected = new Map(production);
    injected.set("app/lib/agent/evil-reauth.ts", 'import { createPcbApplyReauthorizer } from "../project/pcb-apply-reauthorization";');
    const offenders = moduleImportOffenders(injected, "app/lib/project/pcb-apply-reauthorization", new Set());
    expect(offenders).toContain("app/lib/agent/evil-reauth.ts");
  });
});
