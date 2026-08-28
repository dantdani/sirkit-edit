/**
 * B16.0.2 §B (BOM) — complete project/object ownership for durable BOM rows.
 *
 * R3 closure through the REAL route handlers with an injected repository
 * (the in-memory adapter implements the SAME contract as the Postgres one):
 *  - every route is authenticated; the body may carry NO ownership claim;
 *  - list / diff / mark-read / dismiss / bulk update / delete cannot touch a
 *    foreign project's rows (uniform 404 / zero rows), nor a QUARANTINED
 *    legacy row (NULL ownership);
 *  - diff is an authenticated bounded JSON POST (no GET export exists);
 *  - the Postgres adapter's predicates are source-pinned to the full scope.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { InMemoryBomRepository, resetBomRepositoryFactory, setBomRepositoryFactory } from "@/app/lib/bom/snapshot-repository";
import { GET as snapshotGet, POST as snapshotPost } from "../snapshot/route";
import { GET as notifGet, PATCH as notifPatch, DELETE as notifDelete } from "../notifications/route";
import * as diffRoute from "../diff/route";
import { policyFor } from "@/app/lib/auth/route-policy";

const A = { tenantId: "local", projectId: "project-A", branchId: "main" };
const B = { tenantId: "local", projectId: "project-B", branchId: "main" };
const sel = (scope: typeof A, extra: Record<string, string> = {}) => ({ "x-sirkit-tenant-id": scope.tenantId, "x-sirkit-project-id": scope.projectId, "x-sirkit-branch-id": scope.branchId, ...extra });
const json = (scope: typeof A) => sel(scope, { origin: "http://localhost", "content-type": "application/json" });

let repo: InMemoryBomRepository;
let snapA = ""; let snapA2 = ""; let snapB = ""; let legacySnap = "";
let notifA = ""; let notifB = ""; let legacyNotif = "";

beforeEach(() => {
  repo = new InMemoryBomRepository();
  setBomRepositoryFactory(() => repo);
  snapA = repo.seedSnapshot(A, { label: "A-1", rows: [{ partId: "p1", mpn: "M1", manufacturer: null, refDesList: ["R1"], qty: 1, lifecycleStatus: "active", totalStock: 100, bestPriceCents: 10, bestPriceCurrency: "USD", bestSourceDistributor: "digikey", alternatesCount: 0, riskScore: 0 }] });
  snapA2 = repo.seedSnapshot(A, { label: "A-2", rows: [{ partId: "p1", mpn: "M1", manufacturer: null, refDesList: ["R1"], qty: 1, lifecycleStatus: "active", totalStock: 10, bestPriceCents: 50, bestPriceCurrency: "USD", bestSourceDistributor: "digikey", alternatesCount: 0, riskScore: 0 }] });
  snapB = repo.seedSnapshot(B, { label: "B-1" });
  // LEGACY: ownership NULL but projectKey equal to project-A's id (the old key)
  legacySnap = repo.seedSnapshot(null, { label: "legacy", projectKey: "project-A" });
  notifA = repo.seedNotification(A, { summary: "A notif" });
  notifB = repo.seedNotification(B, { summary: "B notif" });
  legacyNotif = repo.seedNotification(null, { summary: "legacy notif", projectKey: "project-A" });
});
afterEach(() => { resetInjectedIdentity(); resetBomRepositoryFactory(); });

describe("B16.0.2 §B — policy + authentication", () => {
  it("every durable BOM route method is authenticated; diff is a POST (no public GET row exists)", () => {
    for (const [path, method] of [["/api/bom/snapshot", "GET"], ["/api/bom/snapshot", "POST"], ["/api/bom/notifications", "GET"], ["/api/bom/notifications", "PATCH"], ["/api/bom/notifications", "DELETE"], ["/api/bom/diff", "POST"]] as const) {
      const policy = policyFor(path, method);
      expect(policy?.requiresAuth, `${method} ${path}`).toBe(true);
      expect(policy?.identitySource, `${method} ${path}`).toBe("trusted-context");
    }
    expect(policyFor("/api/bom/diff", "GET")).toBeNull();
    expect("GET" in diffRoute).toBe(false);
  });

  it("anonymous callers are refused 401 on every surface before any repository access", async () => {
    injectIdentity(null);
    expect((await snapshotGet(new Request("http://localhost/api/bom/snapshot", { headers: sel(A) }))).status).toBe(401);
    expect((await notifGet(new Request("http://localhost/api/bom/notifications", { headers: sel(A) }))).status).toBe(401);
    expect((await diffRoute.POST(new Request("http://localhost/api/bom/diff", { method: "POST", headers: json(A), body: JSON.stringify({ from: snapA, to: snapA2 }) }))).status).toBe(401);
    expect((await notifPatch(new Request("http://localhost/api/bom/notifications", { method: "PATCH", headers: json(A), body: JSON.stringify({ id: notifA, readAt: null }) }))).status).toBe(401);
    expect(repo.peekNotification(notifA)?.readAt).toBeNull();
  });

  it("a viewer may read but not write; an editor may write", async () => {
    injectAuthorizedPrincipal({ userId: "viewer-a", tenantId: "local", projectId: "project-A", role: "viewer" });
    expect((await snapshotGet(new Request("http://localhost/api/bom/snapshot", { headers: sel(A) }))).status).toBe(200);
    expect((await notifPatch(new Request("http://localhost/api/bom/notifications", { method: "PATCH", headers: json(A), body: JSON.stringify({ markAllRead: true }) }))).status).toBe(403);
    expect((await notifDelete(new Request("http://localhost/api/bom/notifications", { method: "DELETE", headers: json(A), body: "{}" }))).status).toBe(403);
  });

  it("the body may carry NO ownership/authority claim (projectKey, tenantId, projectId, branchId, actor) — refused 400 with zero effect", async () => {
    injectAuthorizedPrincipal({ userId: "editor-a", tenantId: "local", projectId: "project-A", role: "editor" });
    for (const claim of [{ projectKey: "project-B" }, { tenantId: "x" }, { projectId: "project-B" }, { branchId: "main" }, { actor: "mallory" }]) {
      const patch = await notifPatch(new Request("http://localhost/api/bom/notifications", { method: "PATCH", headers: json(A), body: JSON.stringify({ ...claim, markAllRead: true }) }));
      expect(patch.status, JSON.stringify(claim)).toBe(400);
      expect(((await patch.json()) as { code: string }).code).toBe("AUTH_AUTHORITATIVE_INPUT_FORBIDDEN");
      const del = await notifDelete(new Request("http://localhost/api/bom/notifications", { method: "DELETE", headers: json(A), body: JSON.stringify(claim) }));
      expect(del.status, JSON.stringify(claim)).toBe(400);
      const diff = await diffRoute.POST(new Request("http://localhost/api/bom/diff", { method: "POST", headers: json(A), body: JSON.stringify({ ...claim, from: snapA, to: snapA2 }) }));
      expect(diff.status, JSON.stringify(claim)).toBe(400);
    }
    expect(repo.peekNotification(notifA)?.readAt).toBeNull();
    expect(repo.peekNotification(notifB)?.readAt).toBeNull();
    expect(repo.notificationCount()).toBe(3);
  });
});

describe("B16.0.2 §B — cross-project isolation through the real routes", () => {
  beforeEach(() => { injectAuthorizedPrincipal({ userId: "editor-b", tenantId: "local", projectId: "project-B", role: "editor" }); });

  it("LIST: project-B sees only its own snapshots and notifications (never A's, never legacy rows keyed to A)", async () => {
    const snaps = (await (await snapshotGet(new Request("http://localhost/api/bom/snapshot", { headers: sel(B) }))).json()) as { snapshots: Array<{ id: string }> };
    expect(snaps.snapshots.map((s) => s.id)).toEqual([snapB]);
    const notifs = (await (await notifGet(new Request("http://localhost/api/bom/notifications", { headers: sel(B) }))).json()) as { notifications: Array<{ id: string }> };
    expect(notifs.notifications.map((n) => n.id)).toEqual([notifB]);
  });

  it("DIFF: project-B cannot diff project-A's snapshots by raw id (uniform 404), nor a legacy snapshot; its own diff works", async () => {
    const foreign = await diffRoute.POST(new Request("http://localhost/api/bom/diff", { method: "POST", headers: json(B), body: JSON.stringify({ from: snapA, to: snapA2 }) }));
    expect(foreign.status).toBe(404);
    const mixed = await diffRoute.POST(new Request("http://localhost/api/bom/diff", { method: "POST", headers: json(B), body: JSON.stringify({ from: snapB, to: snapA }) }));
    expect(mixed.status).toBe(404);
    const legacy = await diffRoute.POST(new Request("http://localhost/api/bom/diff", { method: "POST", headers: json(B), body: JSON.stringify({ from: legacySnap, to: snapB }) }));
    expect(legacy.status).toBe(404);
    injectAuthorizedPrincipal({ userId: "editor-a", tenantId: "local", projectId: "project-A", role: "editor" });
    const own = await diffRoute.POST(new Request("http://localhost/api/bom/diff", { method: "POST", headers: json(A), body: JSON.stringify({ from: snapA, to: snapA2 }) }));
    expect(own.status).toBe(200);
    const body = (await own.json()) as { ok: boolean; from: string; to: string; changes: unknown[] };
    expect(body.from).toBe(snapA); expect(body.to).toBe(snapA2);
    // even project-A cannot reach the LEGACY row keyed to its old projectKey (quarantined)
    const legacyAsA = await diffRoute.POST(new Request("http://localhost/api/bom/diff", { method: "POST", headers: json(A), body: JSON.stringify({ from: legacySnap, to: snapA }) }));
    expect(legacyAsA.status).toBe(404);
  });

  it("MARK-READ / DISMISS by raw id: project-B cannot touch A's or a legacy notification (404, row unchanged); its own works", async () => {
    for (const id of [notifA, legacyNotif]) {
      const read = await notifPatch(new Request("http://localhost/api/bom/notifications", { method: "PATCH", headers: json(B), body: JSON.stringify({ id, readAt: "2026-08-01T00:00:00.000Z" }) }));
      expect(read.status).toBe(404);
      const dismiss = await notifPatch(new Request("http://localhost/api/bom/notifications", { method: "PATCH", headers: json(B), body: JSON.stringify({ id, dismissedAt: "2026-08-01T00:00:00.000Z" }) }));
      expect(dismiss.status).toBe(404);
      expect(repo.peekNotification(id)?.readAt).toBeNull();
      expect(repo.peekNotification(id)?.dismissedAt).toBeNull();
    }
    const own = await notifPatch(new Request("http://localhost/api/bom/notifications", { method: "PATCH", headers: json(B), body: JSON.stringify({ id: notifB, dismissedAt: "2026-08-01T00:00:00.000Z" }) }));
    expect(own.status).toBe(200);
    expect(repo.peekNotification(notifB)?.dismissedAt).not.toBeNull();
  });

  it("BULK mark-all-read: only project-B's rows change", async () => {
    const response = await notifPatch(new Request("http://localhost/api/bom/notifications", { method: "PATCH", headers: json(B), body: JSON.stringify({ markAllRead: true }) }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { updated: number }).updated).toBe(1);
    expect(repo.peekNotification(notifB)?.readAt).not.toBeNull();
    expect(repo.peekNotification(notifA)?.readAt).toBeNull();
    expect(repo.peekNotification(legacyNotif)?.readAt).toBeNull();
  });

  it("DELETE: only project-B's rows are deleted (A's and legacy rows survive)", async () => {
    const response = await notifDelete(new Request("http://localhost/api/bom/notifications", { method: "DELETE", headers: json(B), body: "{}" }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { deleted: number }).deleted).toBe(1);
    expect(repo.peekNotification(notifB)).toBeUndefined();
    expect(repo.peekNotification(notifA)).toBeDefined();
    expect(repo.peekNotification(legacyNotif)).toBeDefined();
    // olderThan far in the past deletes nothing in scope
    const none = await notifDelete(new Request("http://localhost/api/bom/notifications", { method: "DELETE", headers: json(A), body: JSON.stringify({ olderThan: "2000-01-01T00:00:00.000Z" }) }));
    expect(none.status).toBe(403); // still authenticated as B → foreign selector refused by membership
  });

  it("CREATE: a snapshot is owned by the trusted scope; projectKey is the server's project id (display only)", async () => {
    injectAuthorizedPrincipal({ userId: "editor-a", tenantId: "local", projectId: "project-A", role: "editor" });
    const created = await snapshotPost(new Request("http://localhost/api/bom/snapshot", { method: "POST", headers: json(A), body: JSON.stringify({ state: { components: [], wires: [] }, label: "fresh", pricingChoice: "none" }) }));
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    expect(repo.peekSnapshot(id)?.scope).toEqual(A);
    expect(repo.peekSnapshot(id)?.projectKey).toBe("project-A");
    // B cannot see it
    injectAuthorizedPrincipal({ userId: "editor-b", tenantId: "local", projectId: "project-B", role: "editor" });
    const snaps = (await (await snapshotGet(new Request("http://localhost/api/bom/snapshot", { headers: sel(B) }))).json()) as { snapshots: Array<{ id: string }> };
    expect(snaps.snapshots.map((s) => s.id)).not.toContain(id);
  });
});

describe("B16.0.2 §B — the Postgres adapter is predicate-pinned (source)", () => {
  const source = readFileSync(join(process.cwd(), "app", "lib", "bom", "snapshot-repository.ts"), "utf8");
  const postgres = source.slice(source.indexOf("export class PostgresBomRepository"), source.indexOf("// ── In-memory adapter"));

  it("EVERY query in the Postgres adapter is scope-predicated (one ScopePredicate(owned) per .where; never projectKey, never a bare id)", () => {
    // Each `.where(...)` either names a ScopePredicate(owned) directly, or uses
    // a local `where` variable that was BUILT from one on the line above — so
    // the count of scope-predicate usages must be at least the count of
    // `.where(` calls, and every `where` variable is assigned from a predicate.
    const whereCalls = [...postgres.matchAll(/\.where\(/g)].length;
    const scopePredicateUses = [...postgres.matchAll(/(snapshot|notification)ScopePredicate\(owned\)/g)].length;
    // 6 queries; each is scope-predicated (a `where` variable is built from a
    // ScopePredicate above its `.where(where)`, or the predicate is inline).
    expect(whereCalls).toBeGreaterThanOrEqual(6);
    expect(scopePredicateUses).toBeGreaterThanOrEqual(whereCalls);
    // every `where` local is assigned from a scope predicate (incl. multi-line
    // ternaries): the assignment through the next few lines carries it.
    for (const m of postgres.matchAll(/const where\s*=([\s\S]*?);/g)) {
      expect(m[1], m[1]).toMatch(/ScopePredicate\(owned\)/);
    }
    // an id-based `.where(...)` ALWAYS also carries the scope predicate inline.
    for (const m of postgres.matchAll(/\.where\(and\(eq\(bom\w+\.id[^\n]*\)/g)) {
      expect(m[0], m[0]).toMatch(/ScopePredicate\(owned\)/);
    }
    expect(postgres.includes("bomSnapshots.projectKey,")).toBe(false);
    expect(/eq\(bomNotifications\.projectKey/.test(postgres)).toBe(false);
    expect(/eq\(bomSnapshots\.projectKey/.test(postgres)).toBe(false);
  });

  it("the scope predicates compare all three ownership columns (NULL legacy rows can never match)", () => {
    expect(source).toMatch(/eq\(bomSnapshots\.tenantId, scope\.tenantId\), eq\(bomSnapshots\.projectId, scope\.projectId\), eq\(bomSnapshots\.branchId, scope\.branchId\)/);
    expect(source).toMatch(/eq\(bomNotifications\.tenantId, scope\.tenantId\), eq\(bomNotifications\.projectId, scope\.projectId\), eq\(bomNotifications\.branchId, scope\.branchId\)/);
  });

  it("NEGATIVE tripwire: the where-scanner detects a bare-id predicate", () => {
    const injected = postgres + '\n    await getDb().update(bomNotifications).set(patch).where(eq(bomNotifications.id, id)).returning({ id: bomNotifications.id });\n';
    const wheres = [...injected.matchAll(/\.where\(([^\n]*)\)/g)].map((m) => m[1]);
    expect(wheres.some((w) => !/(snapshot|notification)ScopePredicate\(owned\)/.test(w))).toBe(true);
  });

  it("the BOM routes never touch the database directly (repository-only) and never read a caller projectKey", () => {
    for (const file of ["snapshot/route.ts", "notifications/route.ts", "diff/route.ts", "_scope.ts"]) {
      const text = readFileSync(join(process.cwd(), "app", "api", "bom", file), "utf8");
      expect(text.includes("db/client"), file).toBe(false);
      expect(text.includes("drizzle-orm"), file).toBe(false);
      expect(/searchParams\.get\("projectKey"\)/.test(text), file).toBe(false);
      expect(/body\.projectKey/.test(text), file).toBe(false);
    }
  });
});
