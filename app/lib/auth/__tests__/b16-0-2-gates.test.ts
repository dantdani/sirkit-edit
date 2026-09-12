/**
 * B16.0.2 — the permanent authorization gates (R1–R8 closure, kept undoable
 * only by an intentional edit that also updates a gate).
 *
 * Tripwires proving:
 *  - no durable project-data route is public; no SPICE child route lacks
 *    exact-scope authorization; process-spawning engineering routes are
 *    authenticated;
 *  - every non-public exported route method reaches the shared authorization
 *    boundary (authorizeRequest / a statically-resolved approved scope helper)
 *    — a synthetic tripwire proves the scanner sees an unguarded handler;
 *  - protected body routes use the bounded reader, never request.json()/text();
 *  - no BOM predicate rides projectKey / raw id;
 *  - forwarding headers cannot redefine the CSRF origin;
 *  - project_admin-required bindings reject pcb_editor;
 *  - client tier-1 production sealing cannot use a local-dev fallback;
 *  - body actor/project identity cannot enter engineering-export attribution;
 *  - tool exposure stays 12; sirkit.manufacturing.release stays internal-only;
 *  - no provider/model/gateway module imports membership reauthorization /
 *    approval authority.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { allRoutePolicies, policyFor } from "../route-policy";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { collectProductionFiles, moduleImportOffenders } from "../../project/__tests__/_import-gate-helpers";
import { analyzeMethodBoundary, directBodyReads } from "./_boundary-analysis";

const ROOT = process.cwd();
const METHOD_NAMES = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
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
  }
  return [...found];
}

interface RouteFile { path: string; file: string; rel: string; source: string; methods: string[] }

function inventory(): RouteFile[] {
  const results: RouteFile[] = [];
  for (const file of routeFiles(join(ROOT, "app", "api"))) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const source = readFileSync(file, "utf8");
    results.push({ path: "/" + rel.replace(/^app\//, "").replace(/\/route\.ts$/, ""), file, rel, source, methods: exportedMethods(source) });
  }
  return results;
}

const ROUTES = inventory();

// ── §A: durable-data / SPICE-child / process-spawning routes are not public ──

describe("B16.0.2 §A — no durable-project-data or process-spawning route is public", () => {
  it("the reclassified routes are authenticated (were public in B16.0.1)", () => {
    const reclassified: Array<[string, string]> = [
      ["/api/bom/diff", "POST"],
      ["/api/spice/runs/x/bundle", "GET"], ["/api/spice/runs/x/events", "GET"], ["/api/spice/runs/x/waveforms", "GET"],
      ["/api/pcb/export/gerbers", "POST"],
      ["/api/simulate", "POST"], ["/api/spice/models/smoke-test", "POST"], ["/api/pcb/autoroute", "POST"],
    ];
    for (const [path, method] of reclassified) {
      const policy = policyFor(path, method);
      expect(policy, `${method} ${path}`).not.toBeNull();
      expect(policy!.requiresAuth, `${method} ${path}`).toBe(true);
    }
    // and no GET diff exists any more
    expect(policyFor("/api/bom/diff", "GET")).toBeNull();
  });

  it("every SPICE run route (parent AND child) requires trusted-context auth", () => {
    const spice = allRoutePolicies().filter((p) => p.path.startsWith("/api/spice/runs"));
    expect(spice.length).toBeGreaterThanOrEqual(7);
    for (const p of spice) {
      expect(p.requiresAuth, `${p.method} ${p.path}`).toBe(true);
      expect(p.identitySource, `${p.method} ${p.path}`).toBe("trusted-context");
    }
  });

  it("NO public policy row touches durable project data or spawns a process (name/evidence heuristic)", () => {
    const suspicious = allRoutePolicies().filter((p) =>
      !p.requiresAuth && /\b(snapshot|notification|diff|runs\/|autoroute|gerber|simulate|smoke-test)\b/.test(`${p.path} ${p.evidence}`));
    expect(suspicious.map((p) => `${p.method} ${p.path}`)).toEqual([]);
  });

  it("a durable route can never be public with a write (policy invariant restated for the new rows)", () => {
    for (const p of allRoutePolicies()) {
      if (p.authoritativeWrite || p.releaseOrQualification) {
        expect(p.requiresAuth, `${p.method} ${p.path}`).toBe(true);
        expect(p.identitySource, `${p.method} ${p.path}`).not.toBe("none");
      }
    }
  });
});

// ── §A/B16.0.4 §A: every protected HTTP METHOD proves its OWN load-bearing boundary ──

// [B16.0.4 §A] Method-scoped, load-bearing, guard-first (see
// `_boundary-analysis.analyzeMethodBoundary`). A boundary call in a sibling
// method never satisfies another; an ignored or late authorization result
// fails; a body/durable/provider call before the boundary fails. There are NO
// authenticated-route exceptions.

describe("B16.0.4 §A — every protected exported HTTP method proves its OWN load-bearing authorization boundary (method-scoped; zero exceptions)", () => {
  it("each authenticated/worker route method is guard-first, wrapper, or a guarded factory (a sibling method never counts)", { timeout: 60_000 }, () => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      for (const method of route.methods) {
        const policy = policyFor(route.path.replace(/\[[^\]]+\]/g, "x"), method) ?? policyFor(route.path, method);
        if (!policy || !policy.requiresAuth) continue;
        const verdict = analyzeMethodBoundary(route.source, method, route.file, ROOT);
        if (!verdict.ok) offenders.push(`${method} ${route.rel}: ${verdict.reason}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // [B16.0.22] SUPERSEDED FORM: the raw guard-first shape this pin recorded
  // was replaced by canonical-wrapper adoption — a strictly STRONGER,
  // provenance-checked boundary (`authenticatedJsonRoute` from the canonical
  // module runs authorizeRequest FIRST internally; a same-name local decoy is
  // not recognized). The boundary remains method-scoped and load-bearing.
  it("the replacement-authority POST is method-scoped on the canonical wrapper boundary", () => {
    const route = ROUTES.find((r) => r.rel === "app/api/replacement-authority/route.ts");
    expect(route).toBeDefined();
    const v = analyzeMethodBoundary(route!.source, "POST", route!.file, ROOT);
    expect(v.ok && v.via).toBe("wrapper");
    expect(v.ok && v.detail).toContain("authenticatedJsonRoute");
  });

  it("there is NO authenticated-route exception set anywhere in the gate (source-pinned)", () => {
    const gate = readFileSync(join(ROOT, "app", "lib", "auth", "__tests__", "b16-0-2-gates.test.ts"), "utf8");
    const forbiddenMarker = "KNOWN_NON" + "_BOUNDARY_ROUTES";
    expect(gate.includes(forbiddenMarker)).toBe(false);
  });

  it("this gate is CI-only and is described as such (no false runtime claim for UNCLASSIFIED routes)", () => {
    // An unclassified route has no policy → authorizeRequest returns 500 at
    // runtime; THAT is the runtime boundary. Both facts are real.
    expect(policyFor("/api/calculation/evil", "POST")).toBeNull();
  });
});

// ── §D/B16.0.4 §C: AUTOMATIC body-coverage — NO production route directly reads the body ──

describe("B16.0.4 §C — no production API route directly consumes the request body (automatic discovery; zero allowlist)", () => {
  it("EVERY exported route method makes ZERO direct request.json/text/arrayBuffer/blob/formData or request.body reader calls (AST)", () => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      // absolute file + ROOT so the taint engine can follow request flow into
      // imported handler factories / helpers (B16.0.5 §B).
      const uses = directBodyReads(route.source, route.file, ROOT);
      for (const u of uses) offenders.push(`${route.rel}:${u.line} ${u.alias}.${u.api}`);
    }
    expect(offenders).toEqual([]);
  });

  it("EVERY body-consuming route uses a recognized bounded authority (readBoundedJson*/scoped*/route-handlers wrapper)", () => {
    const BOUNDED = /readBoundedJson(Body|Object)|readBoundedStream|scopedTrustedJson|scopedPcbSyncJson|scopedJson|authenticatedJsonRoute|publicJsonRoute|workerJsonRoute|selectorEnvelopeJsonRoute|agentStreamRoute|spiceRunScope|bomScope|pcbSyncScope|scopedCd\d+Json|scopedAssignmentJson|scopedBindingJson|scoped\w*Json/;
    // a route with no body read is fine; a route that reads bounded must name an authority
    for (const route of ROUTES) {
      const hasBoundedAuthority = BOUNDED.test(route.source);
      // routes that never read a body at all are exempt; approximate "reads a
      // body" as: imports/uses a bounded reader OR a wrapper (post-migration all
      // body routes do). This asserts the recognized-authority set is present.
      if (/readBounded|scoped\w*Json|JsonRoute\(/.test(route.source)) expect(hasBoundedAuthority, route.rel).toBe(true);
    }
  });

  it("the shared authorize.ts / route-handlers.ts contain no unbounded request.json/text read", () => {
    for (const rel of ["app/lib/auth/authorize.ts", "app/lib/auth/route-handlers.ts"]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(directBodyReads(src, join(ROOT, rel), ROOT).map((u) => `${u.alias}.${u.api}`), rel).toEqual([]);
    }
  });
});

// ── §C: forwarding headers cannot redefine the CSRF origin ───────────────────

describe("B16.0.2 §C — forwarding headers never define the expected origin (gate)", () => {
  it("neither expected-origin.ts nor request-security.ts reads any host/forwarding header", () => {
    const src = [
      readFileSync(join(ROOT, "app", "lib", "auth", "expected-origin.ts"), "utf8"),
      readFileSync(join(ROOT, "app", "lib", "auth", "request-security.ts"), "utf8"),
    ].join("\n");
    for (const header of ["x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "forwarded", "host"]) {
      expect(src.includes(`get("${header}")`), header).toBe(false);
    }
  });
});

// ── Tool exposure + release internality (unchanged invariants) ───────────────

describe("B16.0.2 — tool exposure unchanged; release internal-only", () => {
  it("agent tool exposure equals the intentional list (derived, never a count)", () => {
    expect(sirkitToolRegistry().list().filter((d) => d.agentExposed).length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
  });

  it("sirkit.manufacturing.release is internal-only, not-callable, not agent-exposed", () => {
    const release = sirkitToolRegistry().list().find((d) => d.toolId === "sirkit.manufacturing.release");
    expect(release).toMatchObject({ discovery: "internal-only", callability: "not-callable", agentExposed: false });
  });
});

// ── Import boundaries: provider/model/gateway ↛ reauthorization/approval ──────

describe("B16.0.2 — no provider/model/gateway module imports reauthorization or approval authority", () => {
  const production = collectProductionFiles(ROOT);

  it("the agent / llm / model-simulation / provider layers import NEITHER reauthorization NOR approval authority", { timeout: 120_000 }, () => {
    const gated = [
      "app/lib/project/membership-reauthorization",
      "app/lib/project/pcb-apply-reauthorization",
      "app/lib/project/pcb-edit-approval-controller.internal",
      "app/lib/project/replacement-approval-controller.internal",
      "app/lib/engineering/pcb-edit-approval.internal",
    ];
    for (const gatedModule of gated) {
      const offenders = moduleImportOffenders(production, gatedModule, new Set());
      const providerLayer = offenders.filter((p) => p.startsWith("app/lib/agent/") || p.startsWith("app/lib/llm/") || p.startsWith("app/lib/model-simulation/") || /provider|gateway/.test(p));
      expect(providerLayer, gatedModule).toEqual([]);
    }
  });

  it("the session-identity module (client seal source) is importable ONLY by the composition root and its own tests (never the agent layer)", { timeout: 120_000 }, () => {
    const offenders = moduleImportOffenders(production, "app/lib/project/session-identity", new Set(["app/page.tsx"]));
    const agentLayer = offenders.filter((p) => p.startsWith("app/lib/agent/") || p.startsWith("app/lib/llm/"));
    expect(agentLayer).toEqual([]);
  });

  it("NEGATIVE tripwire: a synthetic agent-layer reauthorization importer IS detected", () => {
    const injected = new Map(production);
    injected.set("app/lib/agent/evil.ts", 'import { evaluateMembershipReauthorization } from "../project/membership-reauthorization";');
    const offenders = moduleImportOffenders(injected, "app/lib/project/membership-reauthorization", new Set());
    expect(offenders).toContain("app/lib/agent/evil.ts");
  });
});

// ── §A: route data/resource classification bijection + invariants ────────────

import { classificationViolations, renderRouteResourceClassificationCsv, routeResourceClassification } from "../route-resource-classification";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

describe("B16.0.2 §A — route data/resource classification", () => {
  it("classifies EVERY policy row exactly once (bijection with the policy table)", () => {
    const classified = new Set(routeResourceClassification().map((r) => `${r.method} ${r.path}`));
    const policies = allRoutePolicies().map((p) => `${p.method} ${p.path}`);
    expect(classified.size).toBe(policies.length);
    for (const key of policies) expect(classified.has(key), key).toBe(true);
  });

  it("NO public route touches durable project data, spawns a process, or carries credit/write (the R1/R3/R8 closures, restated as classification invariants)", () => {
    const v = classificationViolations();
    expect(v.publicTouchesDurableData).toEqual([]);
    expect(v.publicSpawnsProcess).toEqual([]);
    expect(v.publicHasCreditOrWrite).toEqual([]);
  });

  it("the committed route-data-and-resource-classification.csv is byte-identical to the renderer", () => {
    const artifact = join(ROOT, "artifacts", "ai-control-plane-b16-0-2", "route-data-and-resource-classification.csv");
    expect(existsSync(artifact), "run: npx tsx scripts/generate-b16-0-2-artifacts.ts").toBe(true);
    expect(readFileSync(artifact, "utf8").replaceAll("\r\n", "\n")).toBe(renderRouteResourceClassificationCsv());
  });
});
