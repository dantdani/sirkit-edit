/**
 * [B18-A] `/api/agent/autonomy` through the canonical wrappers: every member
 * reads (default proposal_only), only a project administrator changes it
 * (policy row + repository prelude), compare-and-set on the revision, closed
 * body (unknown and authority-shaped keys refused by name), the actor is the
 * trusted principal + membership revision, the audit trail is returned, and
 * an unavailable store answers 503 and never widens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { policyFor } from "@/app/lib/auth/route-policy";
import { InMemoryAgentAutonomyRepository, type AgentAutonomyRepository } from "@/app/lib/agent/autonomy-settings";
import { resetAgentAutonomyRepositoryFactory, setAgentAutonomyRepositoryFactory } from "@/app/lib/agent/autonomy-store";
import { GET, POST } from "../autonomy/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const get = (): Request => new Request("http://localhost/api/agent/autonomy", { method: "GET", headers: { ...SEL } });
const post = (body: unknown): Request => new Request("http://localhost/api/agent/autonomy", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
const json = async (res: Response): Promise<Record<string, unknown>> => (await res.json()) as Record<string, unknown>;
const authed = (role: "viewer" | "commenter" | "editor" | "reviewer" | "admin"): void => { resetInjectedIdentity(); injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role }); };

let repository: AgentAutonomyRepository;
beforeEach(() => { repository = new InMemoryAgentAutonomyRepository(); setAgentAutonomyRepositoryFactory(() => repository); });
afterEach(() => { resetInjectedIdentity(); resetAgentAutonomyRepositoryFactory(); vi.unstubAllEnvs(); });

describe("B18-A — /api/agent/autonomy", () => {
  it("the exact policy rows: all-members read without CSRF; admin-only mutation with CSRF; neither is a release row", () => {
    expect(policyFor("/api/agent/autonomy", "GET")).toMatchObject({ authClass: "authenticated-read", requiresAuth: true, requiresCsrf: false, authoritativeWrite: false, releaseOrQualification: false });
    expect(policyFor("/api/agent/autonomy", "GET")?.permittedRoles).toContain("viewer");
    expect(policyFor("/api/agent/autonomy", "POST")).toMatchObject({ authClass: "authenticated-mutation", requiresAuth: true, requiresCsrf: true, authoritativeWrite: true, releaseOrQualification: false, permittedRoles: ["project_admin"] });
  });

  it("every member reads the default and the audit trail; an anonymous production request is refused before the store", async () => {
    // local_dev mints the local principal for an anonymous request; production refuses it (401 unauthenticated, or 403
    // when the production identity provider is not configured, as here) — never 200, never a store read.
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    resetInjectedIdentity();
    const reads: number[] = [];
    setAgentAutonomyRepositoryFactory(() => ({ get: async () => { reads.push(1); return repository.get({ tenantId: "local", projectId: "proj-1" }); }, set: repository.set.bind(repository), changes: repository.changes.bind(repository) }));
    expect([401, 403]).toContain((await GET(get())).status);
    expect(reads).toEqual([]);
    vi.unstubAllEnvs();
    setAgentAutonomyRepositoryFactory(() => repository);
    authed("viewer");
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await json(res)).toMatchObject({ ok: true, setting: { mode: "proposal_only", revision: 0 }, changes: [], modes: ["proposal_only", "execute_explicit_tier1"], viewer: { role: "viewer", canChange: false } });
  });

  it("a project administrator opts in with a compare-and-set; the change carries the trusted principal + membership revision; readers see the new mode and the trail", async () => {
    authed("admin");
    const res = await POST(post({ mode: "execute_explicit_tier1", expectedRevision: 0 }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ ok: true, unchanged: false, setting: { mode: "execute_explicit_tier1", revision: 1, updatedBy: { principalId: "u1", role: "project_admin" } }, change: { fromMode: "proposal_only", toMode: "execute_explicit_tier1", revision: 1 } });
    expect(typeof (body.setting as { updatedBy: { membershipRevision: string } }).updatedBy.membershipRevision).toBe("string");
    authed("editor");
    expect(await json(await GET(get()))).toMatchObject({ setting: { mode: "execute_explicit_tier1", revision: 1 }, changes: [{ toMode: "execute_explicit_tier1", revision: 1 }], viewer: { role: "pcb_editor", canChange: false } });
  });

  it("a non-administrator is refused 403 by the policy row before any store access; a stale revision is 409 with the current setting; the same mode is a no-op", async () => {
    for (const role of ["viewer", "commenter", "editor", "reviewer"] as const) {
      authed(role);
      expect((await POST(post({ mode: "execute_explicit_tier1", expectedRevision: 0 }))).status).toBe(403);
    }
    expect(await repository.get({ tenantId: "local", projectId: "proj-1" })).toMatchObject({ mode: "proposal_only", revision: 0 });
    authed("admin");
    await POST(post({ mode: "execute_explicit_tier1", expectedRevision: 0 }));
    const stale = await POST(post({ mode: "proposal_only", expectedRevision: 0 }));
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ ok: false, code: "AGENT_AUTONOMY_STALE_REVISION", current: { revision: 1, mode: "execute_explicit_tier1" } });
    expect(await json(await POST(post({ mode: "execute_explicit_tier1", expectedRevision: 1 })))).toMatchObject({ ok: true, unchanged: true, change: null });
    expect(await repository.changes({ tenantId: "local", projectId: "proj-1" })).toHaveLength(1);
  });

  it("the body is closed: an undeclared key, an authority-shaped key, an unknown mode or a missing expected revision refuse 400 and change nothing", async () => {
    authed("admin");
    expect(await json(await POST(post({ mode: "execute_explicit_tier1", expectedRevision: 0, evil: true })))).toMatchObject({ ok: false, code: "AGENT_AUTONOMY_UNKNOWN_FIELD", fields: ["evil"] });
    expect(await json(await POST(post({ mode: "execute_explicit_tier1", expectedRevision: 0, role: "project_admin" })))).toMatchObject({ ok: false, code: "AGENT_AUTONOMY_AUTHORITY_CLAIM", fields: ["role"] });
    expect(await json(await POST(post({ mode: "execute_everything", expectedRevision: 0 })))).toMatchObject({ ok: false, code: "AGENT_AUTONOMY_MODE_INVALID" });
    expect(await json(await POST(post({ mode: "execute_explicit_tier1" })))).toMatchObject({ ok: false, code: "AGENT_AUTONOMY_REVISION_REQUIRED" });
    expect((await POST(post({ mode: "execute_explicit_tier1", expectedRevision: 0, actor: { role: "project_admin" } }))).status).toBe(400);
    expect(await repository.get({ tenantId: "local", projectId: "proj-1" })).toMatchObject({ mode: "proposal_only", revision: 0 });
  });

  it("an unavailable store answers 503 for reads and writes and never widens", async () => {
    setAgentAutonomyRepositoryFactory(() => ({
      get: async () => { throw new Error("DATABASE_URL is not set"); },
      set: async () => { throw new Error("DATABASE_URL is not set"); },
      changes: async () => { throw new Error("DATABASE_URL is not set"); },
    }));
    authed("admin");
    expect(await json(await GET(get()))).toMatchObject({ ok: false, code: "AGENT_AUTONOMY_UNAVAILABLE" });
    const res = await POST(post({ mode: "execute_explicit_tier1", expectedRevision: 0 }));
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ ok: false, code: "AGENT_AUTONOMY_UNAVAILABLE" });
  });
});
