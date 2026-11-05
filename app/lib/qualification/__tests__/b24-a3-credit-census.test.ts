/**
 * [B24-A3] The credit declarations and the abuse-limit census (D24-8, OD-197, OD-174's question). The two public routes that embed an
 * anonymous caller's text with OpenAI now declare provider credit (`pub()` takes an optional `{ providerCredit }`, adding no key to
 * `RoutePolicy`), and they and the public placement preview are classified `expensive`. `publicHasCreditOrWrite` excuses a public
 * credit row only when it is a reviewed `PUBLIC_MODEL_EGRESS` path with a valid `ABUSE_LIMITS` entry, so the B16.0.2, B20-B2 and
 * B20-B3 pins stay `[]`. The new gate `abuseLimitViolations(rows, policies, limits)` reports one `<METHOD> <path>: <reason>` line per
 * violation over every public row that is credit, expensive or model egress (sign-in admitted through the registry's key set), from a
 * closed set of reasons, each of which bites on a forged table; the enforcement site is pinned too.
 *
 * Failing first on b3b6b05: the two rows declare `providerCredit: false`, all three rows are `expensive: false`, and no gate refuses a
 * reviewed `PUBLIC_MODEL_EGRESS` path that has no enforced limiter (page section 10). Files are read as text; nothing is written.
 * [B24-A3 review, 2026-10-08] coverage-signin-gate-gap: a table without sign-in's window reported nothing; it is now
 * `public_signin_unlimited` (cases 2, 3, 8; red on the reviewed tree, page section 21).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRouteMethodForm } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { allRoutePolicies, policyFor, type RoutePolicy } from "@/app/lib/auth/route-policy";
import * as classification from "@/app/lib/auth/route-resource-classification";
import { PUBLIC_MODEL_EGRESS, classificationViolations, routeResourceClassification, type RouteResourceRow } from "@/app/lib/auth/route-resource-classification";
import { listRouteFiles, routePathOf } from "@/app/lib/auth/route-tree";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const SEARCHES = ["POST /api/parts/search", "GET /api/pcb/footprints/search"] as const;
const PREVIEW = "POST /api/pcb/placement/preview";
const SIGNIN = "POST /api/auth/signin";
const keyOf = (row: { method: string; path: string }): string => `${row.method} ${row.path}`;
const rowOf = (key: string): RouteResourceRow => routeResourceClassification().find((row) => keyOf(row) === key)!;

type Gate = (rows: readonly RouteResourceRow[], policies: readonly RoutePolicy[], limits: Readonly<Record<string, unknown>>, principalLimits?: Readonly<Record<string, unknown>>) => string[]; // [B24-A3, 2026-10-07] part 2: + the per-principal registry (B24-A3b)
const gate = (): Gate => {
  const candidate = (classification as unknown as { abuseLimitViolations?: Gate }).abuseLimitViolations;
  expect(typeof candidate, "abuseLimitViolations is exported by route-resource-classification.ts").toBe("function");
  return candidate!;
};
/** [B24-A3b] A forged AUTHENTICATED row and its policy (part 2's scope: provider credit or expensive). */
function forgedAuthenticated(path: string, method: string, facts: { providerCredit?: boolean; expensive?: boolean }): { row: RouteResourceRow; policy: RoutePolicy } {
  const row: RouteResourceRow = { path, method, isPublic: false, durableAccess: "none", projectDataSensitivity: "caller-supplied-only", providerCredit: facts.providerCredit ?? false, externalProcess: "", expensive: facts.expensive ?? false, authoritativeWrite: false, releaseOrQualification: false, staticOrCatalog: false, outboundEgress: "none", modelEgress: false };
  const policy: RoutePolicy = { path, method, authClass: "authenticated-read", identitySource: "trusted-context", requiresAuth: true, permittedRoles: ["pcb_editor"], providerCredit: facts.providerCredit ?? false, requiresCsrf: true, authoritativeWrite: false, releaseOrQualification: false, externalTransfer: false, spend: false, evidence: "test: a forged authenticated row" };
  return { row, policy };
}
/** A forged public row and its policy (the classification and policy shapes, nothing else). */
function forged(path: string, method: string, facts: { providerCredit?: boolean; expensive?: boolean; modelEgress?: boolean }): { row: RouteResourceRow; policy: RoutePolicy } {
  const row: RouteResourceRow = { path, method, isPublic: true, durableAccess: "none", projectDataSensitivity: "none", providerCredit: facts.providerCredit ?? false, externalProcess: "", expensive: facts.expensive ?? false, authoritativeWrite: false, releaseOrQualification: false, staticOrCatalog: false, outboundEgress: "none", modelEgress: facts.modelEgress ?? false };
  const policy: RoutePolicy = { path, method, authClass: "public", identitySource: "none", requiresAuth: false, permittedRoles: [], providerCredit: facts.providerCredit ?? false, requiresCsrf: false, authoritativeWrite: false, releaseOrQualification: false, externalTransfer: false, spend: false, evidence: "test: a forged public row" };
  return { row, policy };
}

describe("[B24-A3] credit declarations and the abuse-limit census (D24-8, OD-197)", () => {
  it("1. counterexample (red on b3b6b05): both public embedding rows declare provider credit, all three public rows are expensive; the searches derive static_or_catalog false (route-resource-classification.ts:187 unchanged), model egress is unchanged (both searches true, the preview false), and every row stays public", () => {
    for (const key of SEARCHES) {
      const [method, path] = key.split(" ") as [string, string];
      expect(policyFor(path, method), key).toMatchObject({ authClass: "public", requiresAuth: false, providerCredit: true, requiresCsrf: false, authoritativeWrite: false, releaseOrQualification: false, externalTransfer: false, spend: false });
      expect(rowOf(key), key).toMatchObject({ isPublic: true, providerCredit: true, expensive: true, staticOrCatalog: false, modelEgress: true, outboundEgress: "none", durableAccess: "none", externalProcess: "" });
      expect(policyFor(path, method)!.evidence, key).toMatch(/OD-197/);
    }
    expect(policyFor("/api/pcb/placement/preview", "POST")).toMatchObject({ authClass: "public", requiresAuth: false, providerCredit: false, evidence: "stateless compute" });
    expect(rowOf(PREVIEW)).toMatchObject({ isPublic: true, providerCredit: false, expensive: true, staticOrCatalog: true, modelEgress: false });
    expect(rowOf(SIGNIN)).toMatchObject({ isPublic: true, providerCredit: false, expensive: false, modelEgress: false });
    // pub() adds no key to RoutePolicy: every public row has exactly the keys of every other row
    const keys = (policy: RoutePolicy): string => Object.keys(policy).sort().join(",");
    expect(new Set(allRoutePolicies().filter((policy) => policy.authClass === "public").map(keys)).size).toBe(1);
    expect(keys(policyFor("/api/parts/search", "POST")!)).toBe(keys(policyFor("/api/mcp/token", "POST")!));
    // the two CSVs carry the declarations (byte-pinned elsewhere: b16-0-1-ci-gates, b16-0-2-gates, b23-a-route-vocabulary)
    const policyCsv = read("artifacts/ai-control-plane-b16-0-1/exact-route-authorization-policy.csv").split(NEWLINE);
    for (const prefix of ["/api/parts/search,POST,public,none,false,,,true,", "/api/pcb/footprints/search,GET,public,none,false,,,true,", "/api/pcb/placement/preview,POST,public,none,false,,,false,"]) expect(policyCsv.filter((line) => line.startsWith(prefix)), prefix).toHaveLength(1);
    const classificationCsv = read("artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv").split(NEWLINE);
    for (const line of ["/api/parts/search,POST,true,none,none,true,,true,false,false,false,none,true", "/api/pcb/footprints/search,GET,true,none,none,true,,true,false,false,false,none,true", "/api/pcb/placement/preview,POST,true,none,none,false,,true,false,false,true,none,false"]) expect(classificationCsv, line).toContain(line);
  });

  it("2. counterexample (red on b3b6b05): a reviewed PUBLIC_MODEL_EGRESS path without an enforced limiter is refused - the gate passes on the real table and, with the parts search's entry removed, reports it as unlimited credit, expensive and model egress", async () => {
    const abuseLimitViolations = gate();
    const { ABUSE_LIMITS } = await import("@/app/lib/auth/abuse-limits");
    const rows = routeResourceClassification();
    const policies = allRoutePolicies();
    expect(abuseLimitViolations(rows, policies, ABUSE_LIMITS)).toEqual([]);
    const withoutParts = Object.fromEntries(Object.entries(ABUSE_LIMITS).filter(([key]) => key !== "POST /api/parts/search"));
    expect(abuseLimitViolations(rows, policies, withoutParts)).toEqual(["POST /api/parts/search: public_credit_unlimited", "POST /api/parts/search: public_expensive_unlimited", "POST /api/parts/search: public_model_egress_unlimited"]);
    const withoutPreview = Object.fromEntries(Object.entries(ABUSE_LIMITS).filter(([key]) => key !== PREVIEW));
    expect(abuseLimitViolations(rows, policies, withoutPreview)).toEqual(["POST /api/pcb/placement/preview: public_expensive_unlimited"]);
    // [B24-A3 review, 2026-10-08] coverage-signin-gate-gap: sign-in is in the gate's scope though it is neither credit nor expensive
    const withoutSignin = Object.fromEntries(Object.entries(ABUSE_LIMITS).filter(([key]) => key !== SIGNIN));
    expect(abuseLimitViolations(rows, policies, withoutSignin)).toEqual(["POST /api/auth/signin: public_signin_unlimited"]);
    expect(Object.keys(PUBLIC_MODEL_EGRESS).sort()).toEqual(["/api/parts/search", "/api/pcb/footprints/search"]);
  });

  it("3. every reason bites on a forged table, alone: public_credit_unlimited, public_expensive_unlimited, public_model_egress_unlimited, public_credit_unreviewed, limit_invalid, orphan_limit ([B24-A3 review, 2026-10-08] and public_signin_unlimited, sign-in without its window) - and the set is closed", async () => {
    const abuseLimitViolations = gate();
    const { ABUSE_LIMITS } = await import("@/app/lib/auth/abuse-limits");
    const valid = ABUSE_LIMITS["POST /api/auth/signin"]!;
    const run = (entries: ReadonlyArray<ReturnType<typeof forged>>, limits: Readonly<Record<string, unknown>>): string[] => abuseLimitViolations(entries.map((entry) => entry.row), entries.map((entry) => entry.policy), limits, {}); // [B24-A3, 2026-10-07] part 2: a forged public table meets an empty per-principal registry (the real one's 40 entries would each be an orphan here; case 8)
    const credit = forged("/api/b24-probe/credit", "POST", { providerCredit: true });
    const expensive = forged("/api/b24-probe/expensive", "POST", { expensive: true });
    const egress = forged("/api/b24-probe/egress", "GET", { modelEgress: true });
    const plain = forged("/api/b24-probe/plain", "GET", {});
    expect(run([credit], {})).toEqual(["POST /api/b24-probe/credit: public_credit_unlimited"]);
    expect(run([expensive], {})).toEqual(["POST /api/b24-probe/expensive: public_expensive_unlimited"]);
    expect(run([egress], {})).toEqual(["GET /api/b24-probe/egress: public_model_egress_unlimited"]);
    // a public credit row with a valid limit is still refused unless it is a reviewed PUBLIC_MODEL_EGRESS path
    expect(run([credit], { "POST /api/b24-probe/credit": valid })).toEqual(["POST /api/b24-probe/credit: public_credit_unreviewed"]);
    for (const broken of [{ ...valid, global: { ...valid.global, limit: 0 } }, { ...valid, perClient: { ...valid.perClient, windowMs: Number.NaN } }, { ...valid, reason: "too short" }, null, "a string"]) {
      expect(run([expensive], { "POST /api/b24-probe/expensive": broken }), JSON.stringify(broken)).toEqual(["POST /api/b24-probe/expensive: limit_invalid"]);
    }
    expect(run([plain], { "GET /api/b24-probe/plain": valid })).toEqual(["GET /api/b24-probe/plain: orphan_limit"]);
    expect(run([], { "POST /api/b24-probe/nowhere": valid })).toEqual(["POST /api/b24-probe/nowhere: orphan_limit"]);
    // sign-in is admitted through the registry's key set (it spends no credit and is not expensive)
    const signin = forged("/api/auth/signin", "POST", {});
    expect(run([signin], { [SIGNIN]: valid })).toEqual([]);
    expect(run([signin], {})).toEqual(["POST /api/auth/signin: public_signin_unlimited"]); // [B24-A3 review, 2026-10-08] coverage-signin-gate-gap: was [] (sign-in's missing window went unreported)
    expect(run([signin], { [SIGNIN]: { ...valid, reason: "too short" } })).toEqual(["POST /api/auth/signin: limit_invalid"]);
    const reasons = new Set([credit, expensive, egress, signin].flatMap((entry) => run([entry], {})).concat(run([credit], { "POST /api/b24-probe/credit": valid }), run([plain], { "GET /api/b24-probe/plain": valid }), run([expensive], { "POST /api/b24-probe/expensive": null })).map((line) => line.split(": ")[1]));
    expect([...reasons].sort()).toEqual(["limit_invalid", "orphan_limit", "public_credit_unlimited", "public_credit_unreviewed", "public_expensive_unlimited", "public_model_egress_unlimited", "public_signin_unlimited"]);
  });

  it("4. publicHasCreditOrWrite is narrowed in place, not loosened: the real table still reports [] (the B16.0.2, B20-B2 and B20-B3 pins hold); a public credit row is excused only as a reviewed PUBLIC_MODEL_EGRESS path with a valid limit", async () => {
    expect(classificationViolations()).toEqual({ publicTouchesDurableData: [], publicSpawnsProcess: [], publicHasCreditOrWrite: [] });
    const excuse = (classification as unknown as { reviewedMeteredPublicCredit?: (row: { path: string; method: string; isPublic: boolean; providerCredit: boolean }, limits?: Readonly<Record<string, unknown>>) => boolean }).reviewedMeteredPublicCredit;
    expect(typeof excuse).toBe("function");
    const { ABUSE_LIMITS } = await import("@/app/lib/auth/abuse-limits");
    for (const key of SEARCHES) expect(excuse!(rowOf(key), ABUSE_LIMITS), key).toBe(true);
    expect(excuse!(rowOf("POST /api/parts/search"), {}), "no limit").toBe(false);
    expect(excuse!(rowOf("POST /api/parts/search"), { "POST /api/parts/search": { ...ABUSE_LIMITS["POST /api/parts/search"]!, reason: "short" } }), "an invalid limit").toBe(false);
    expect(excuse!({ path: "/api/b24-probe/credit", method: "POST", isPublic: true, providerCredit: true }, { "POST /api/b24-probe/credit": ABUSE_LIMITS[SIGNIN] }), "not reviewed").toBe(false);
    expect(excuse!(rowOf(PREVIEW), ABUSE_LIMITS), "no credit, nothing to excuse").toBe(false);
    // the public credit rows are exactly the two reviewed metered ones (b16-0-1-ci-gates' two invariants, narrowed in place, pin the same)
    expect(allRoutePolicies().filter((policy) => policy.providerCredit && !policy.requiresAuth).map(keyOf).sort()).toEqual([...SEARCHES].sort());
    const gates = read("app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts").split(NEWLINE);
    expect(gates[147]).toMatch(/^ {2}it\("provider-credit routes are NEVER public/);
    expect(gates[178]).toMatch(/^ {2}it\("public rows carry no credit, no authoritative write, no release/);
    expect(gates.filter((line) => line.includes("[B24-A3, 2026-10-06]")).length).toBeGreaterThanOrEqual(3);
  });

  it("5. the enforcement site: authorizeRequest's public branch takes the window after the CSRF check and before it answers public (so before the media type and the body), and every ABUSE_LIMITS row adopts publicRoute or publicJsonRoute (the B16.0.7 classifier)", { timeout: 60_000 }, async () => { // [B24-A3] the route files through the classifier: an explicit budget for CI
    const authorize = read("app/lib/auth/authorize.ts").split(NEWLINE);
    const start = authorize.findIndex((line) => line.includes("if (!policy.requiresAuth) {"));
    const end = authorize.findIndex((line, index) => index > start && line.includes('return { ok: true, kind: "public", policy };'));
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const branch = authorize.slice(start, end + 1).join(NEWLINE);
    expect(branch.indexOf("requireSameOrigin(")).toBeGreaterThan(0);
    expect(branch.indexOf("takePublicAbuseLimit(")).toBeGreaterThan(branch.indexOf("requireSameOrigin("));
    expect(authorize.join(NEWLINE).split("takePublicAbuseLimit(").length - 1).toBe(1);
    const { ABUSE_LIMITS } = await import("@/app/lib/auth/abuse-limits");
    const files = new Map(listRouteFiles(ROOT).map((file) => [routePathOf(ROOT, file), file] as const));
    for (const key of Object.keys(ABUSE_LIMITS)) {
      const [method, path] = key.split(" ") as [string, string];
      const file = files.get(path)!;
      expect(file, key).toBeTruthy();
      const form = classifyRouteMethodForm(readFileSync(file, "utf8"), method, file, ROOT);
      expect(form.form === "canonical-wrapper" && ["publicRoute", "publicJsonRoute"].includes(form.wrapper), `${key}: ${JSON.stringify(form)}`).toBe(true);
    }
  });

  it("6. the gate's scope at A3a: 43 rows are credit, expensive or public model egress - the three public ones limited here, the 40 authenticated ones listed on the page as unlimited until B24-A3b (OD-197's full scope); A1's health and readiness rows are neither", () => {
    const gated = routeResourceClassification().filter((row) => row.providerCredit || row.expensive || (row.isPublic && row.modelEgress));
    expect(gated).toHaveLength(44); // [PR-L, 2026-10-17] reviewed census move (runbook L.4): + POST /api/generation-tasks, the durable generation task's start (provider credit, its own per-principal window): was 43
    expect(gated.filter((row) => row.isPublic).map(keyOf).sort()).toEqual([...SEARCHES, PREVIEW].sort());
    expect(gated.filter((row) => !row.isPublic)).toHaveLength(41); // [PR-L, 2026-10-17] reviewed census move (runbook L.4): + POST /api/generation-tasks, the durable generation task's start (provider credit, its own per-principal window): was 40
    expect(gated.map((row) => row.path)).not.toEqual(expect.arrayContaining(["/api/health"]));
    expect(gated.map((row) => row.path)).not.toEqual(expect.arrayContaining(["/api/ready"]));
  });

  it("7. the stale statements carry dated notes in place, their text kept: route-resource-classification.ts's header (a public row has no provider credit) and PUBLIC_MODEL_EGRESS's \"Recorded, not changed\"; b16-0-1-ci-gates' header invariant 4", () => {
    const lines = read("app/lib/auth/route-resource-classification.ts").split(NEWLINE);
    expect(lines.slice(13, 16).join(NEWLINE)).toContain("no provider credit");
    expect(lines.slice(13, 16).join(NEWLINE)).toContain("[B24-A3, 2026-10-06]");
    expect(lines.slice(136, 138).join(NEWLINE)).toContain("Recorded, not changed: A2 adds no route change.");
    expect(lines.slice(136, 138).join(NEWLINE)).toContain("[B24-A3, 2026-10-06]");
    const gates = read("app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts").split(NEWLINE);
    expect(gates.slice(13, 16).join(NEWLINE)).toContain("provider-credit routes are never public");
    expect(gates.slice(13, 16).join(NEWLINE)).toContain("[B24-A3, 2026-10-06]");
  });

  it("8. part 2 (red on the A3a tree): the gate at OD-197's full scope - an authenticated provider-credit or expensive row without a per-principal window is credit_unlimited or expensive_unlimited, a malformed window limit_invalid, an entry naming no gated authenticated row orphan_limit; the real table passes with both registries; the reasons are a closed set of eight ([B24-A3 review, 2026-10-08] nine: + public_signin_unlimited); the two registries' key set is exactly the 43 gated rows plus sign-in", async () => {
    const abuseLimitViolations = gate();
    const limits = await import("@/app/lib/auth/abuse-limits") as unknown as Record<string, unknown>;
    const ABUSE_LIMITS = limits.ABUSE_LIMITS as Readonly<Record<string, unknown>>;
    const principal = limits.PRINCIPAL_ABUSE_LIMITS as Readonly<Record<string, { perPrincipal: { limit: number; windowMs: number; maxKeys: number }; kind: string; reason: string }>> | undefined;
    expect(typeof principal, "PRINCIPAL_ABUSE_LIMITS is exported by abuse-limits.ts").toBe("object");
    expect([...classification.ABUSE_LIMIT_REASONS].sort()).toEqual(["credit_unlimited", "expensive_unlimited", "limit_invalid", "orphan_limit", "public_credit_unlimited", "public_credit_unreviewed", "public_expensive_unlimited", "public_model_egress_unlimited", "public_signin_unlimited"]); // [B24-A3 review, 2026-10-08] + public_signin_unlimited
    const rows = routeResourceClassification();
    const policies = allRoutePolicies();
    expect(abuseLimitViolations(rows, policies, ABUSE_LIMITS, principal)).toEqual([]);
    expect(abuseLimitViolations(rows, policies, ABUSE_LIMITS)).toEqual([]);
    const without = Object.fromEntries(Object.entries(principal!).filter(([key]) => key !== "POST /api/chat" && key !== "POST /api/pcb/autoroute"));
    expect(abuseLimitViolations(rows, policies, ABUSE_LIMITS, without).sort()).toEqual(["POST /api/chat: credit_unlimited", "POST /api/pcb/autoroute: expensive_unlimited"]);
    // forged authenticated rows: each reason bites alone
    const valid = principal!["POST /api/architecture/propose"]!;
    const run = (entries: ReadonlyArray<ReturnType<typeof forgedAuthenticated>>, principalLimits: Readonly<Record<string, unknown>>): string[] => abuseLimitViolations(entries.map((entry) => entry.row), entries.map((entry) => entry.policy), {}, principalLimits);
    const credit = forgedAuthenticated("/api/b24-probe/auth-credit", "POST", { providerCredit: true });
    const expensive = forgedAuthenticated("/api/b24-probe/auth-expensive", "POST", { expensive: true });
    const both = forgedAuthenticated("/api/b24-probe/auth-both", "POST", { providerCredit: true, expensive: true });
    const plain = forgedAuthenticated("/api/b24-probe/auth-plain", "POST", {});
    expect(run([credit], {})).toEqual(["POST /api/b24-probe/auth-credit: credit_unlimited"]);
    expect(run([expensive], {})).toEqual(["POST /api/b24-probe/auth-expensive: expensive_unlimited"]);
    expect(run([both], {})).toEqual(["POST /api/b24-probe/auth-both: credit_unlimited", "POST /api/b24-probe/auth-both: expensive_unlimited"]);
    expect(run([credit], { "POST /api/b24-probe/auth-credit": valid })).toEqual([]);
    for (const broken of [{ ...valid, perPrincipal: { ...valid.perPrincipal, limit: 0 } }, { ...valid, perPrincipal: { ...valid.perPrincipal, windowMs: Number.NaN } }, { ...valid, reason: "too short" }, null, "a string"]) {
      expect(run([expensive], { "POST /api/b24-probe/auth-expensive": broken }), JSON.stringify(broken)).toEqual(["POST /api/b24-probe/auth-expensive: limit_invalid"]);
    }
    expect(run([plain], { "POST /api/b24-probe/auth-plain": valid })).toEqual(["POST /api/b24-probe/auth-plain: orphan_limit"]);
    expect(run([], { "POST /api/b24-probe/nowhere": valid })).toEqual(["POST /api/b24-probe/nowhere: orphan_limit"]);
    // the registries never stand in for each other: a public window does not limit an authenticated row, nor a per-principal one a public row
    expect(abuseLimitViolations([credit.row], [credit.policy], { "POST /api/b24-probe/auth-credit": ABUSE_LIMITS["POST /api/auth/signin"] }, {})).toEqual(["POST /api/b24-probe/auth-credit: credit_unlimited", "POST /api/b24-probe/auth-credit: orphan_limit"]);
    const publicExpensive = forged("/api/b24-probe/public-expensive", "POST", { expensive: true });
    expect(abuseLimitViolations([publicExpensive.row], [publicExpensive.policy], {}, { "POST /api/b24-probe/public-expensive": valid })).toEqual(["POST /api/b24-probe/public-expensive: public_expensive_unlimited", "POST /api/b24-probe/public-expensive: orphan_limit"]);
    // the key set, pinned exactly: 43 gated rows plus sign-in
    const gated = routeResourceClassification().filter((row) => row.providerCredit || row.expensive || (row.isPublic && row.modelEgress)).map(keyOf);
    expect(gated).toHaveLength(44); // [PR-L, 2026-10-17] reviewed census move (runbook L.4): + POST /api/generation-tasks, the durable generation task's start (provider credit, its own per-principal window): was 43
    expect([...Object.keys(ABUSE_LIMITS), ...Object.keys(principal!)].sort()).toEqual([...gated, SIGNIN].sort());
  });
});
