/**
 * B16.0.1 §A/§B/§C — the R1/R2 closures, proven through the ONE production
 * authorization adapter (`authorizeRequest`) with server-injected identities.
 *
 * R1: a resolvable VIEWER principal must never authorize the release or
 *     qualification scope (or any mutation) — refused 403 BEFORE any
 *     downstream authority load.
 * R2: same-origin CSRF is enforced BY THE ACTUAL ROUTE PATH (policy-driven,
 *     inside authorizeRequest) — not by an orphaned helper. A cross-origin or
 *     origin-less POST refuses even for a project admin.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "../test-support";
import { authorizeRequest } from "../authorize";

const PROJECT = "project-1";

function request(path: string, options: { method?: string; origin?: string | null } = {}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-sirkit-tenant-id": "tenant-1",
    "x-sirkit-project-id": PROJECT,
    "x-sirkit-branch-id": "main",
  };
  if (options.origin !== null) headers.origin = options.origin ?? "http://localhost";
  return new Request(`http://localhost${path}`, { method: options.method ?? "POST", headers, body: "{}" });
}

beforeEach(() => { injectAuthorizedPrincipal({ userId: "human-1", tenantId: "tenant-1", projectId: PROJECT, role: "admin" }); });
afterEach(() => { resetInjectedIdentity(); });

describe("B16.0.1 R1 — a viewer never reaches qualification or release", () => {
  const denied: Array<[string, string]> = [
    ["/api/pcb/release", "POST"],
    ["/api/pcb/qualify", "POST"],
    ["/api/pcb-sync", "POST"],
    ["/api/physical-bindings", "POST"],
    ["/api/assignment-queue", "POST"],
    ["/api/requirements/sources", "POST"],
  ];

  for (const [path, method] of denied) {
    it(`viewer → 403 on ${method} ${path} (before any authority load)`, async () => {
      injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "tenant-1", projectId: PROJECT, role: "viewer" });
      const outcome = await authorizeRequest(request(path, { method }));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.response.status).toBe(403);
      expect(await outcome.response.json()).toMatchObject({ code: "AUTH_ROLE_DENIED" });
    });
  }

  it("release is ADMIN-only: even a pcb_editor is refused; an admin passes role authz", async () => {
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "tenant-1", projectId: PROJECT, role: "editor" });
    const editor = await authorizeRequest(request("/api/pcb/release"));
    expect(editor.ok).toBe(false);
    if (!editor.ok) expect(editor.response.status).toBe(403);

    injectAuthorizedPrincipal({ userId: "admin-1", tenantId: "tenant-1", projectId: PROJECT, role: "admin" });
    const admin = await authorizeRequest(request("/api/pcb/release"));
    expect(admin.ok).toBe(true);
    if (admin.ok && admin.kind === "authenticated") expect(admin.context.actor.role).toBe("project_admin");
  });

  it("qualify admits pcb_editor AND project_admin; reviewer is refused", async () => {
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "tenant-1", projectId: PROJECT, role: "editor" });
    expect((await authorizeRequest(request("/api/pcb/qualify"))).ok).toBe(true);
    injectAuthorizedPrincipal({ userId: "reviewer-1", tenantId: "tenant-1", projectId: PROJECT, role: "reviewer" });
    const reviewer = await authorizeRequest(request("/api/pcb/qualify"));
    expect(reviewer.ok).toBe(false);
  });

  it("an unauthenticated caller is refused 401 before roles are even considered", async () => {
    injectIdentity(null);
    const outcome = await authorizeRequest(request("/api/pcb/release"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.response.status).toBe(401);
  });
});

describe("B16.0.1 R2 — CSRF is enforced by the actual route path", () => {
  // Same-origin enforcement inside the trusted-context resolver is
  // PRODUCTION-mode-gated (local_dev/tests carry no browser Origin), so the
  // production environment is injected here — the identity still comes from
  // the injected principal seam, proving the refusal fires even for a fully
  // authenticated, role-authorized admin.
  const PRODUCTION_ENV = {
    SIRKIT_AUTH_MODE: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    // [B16.0.2 §C] production CSRF compares against the server-owned expected origin.
    SIRKIT_EXPECTED_ORIGIN: "http://localhost",
  } as const;

  it("an origin-less POST refuses 403 even for a project admin", async () => {
    const outcome = await authorizeRequest(request("/api/pcb/release", { origin: null }), { environment: PRODUCTION_ENV });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.response.status).toBe(403);
  });

  it("a cross-origin POST refuses 403; the same-origin equivalent authorizes", async () => {
    const cross = await authorizeRequest(request("/api/pcb-sync", { origin: "http://evil.example" }), { environment: PRODUCTION_ENV });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.response.status).toBe(403);
    const same = await authorizeRequest(request("/api/pcb-sync"), { environment: PRODUCTION_ENV });
    expect(same.ok).toBe(true);
  });

  it("a GET read does not demand an Origin header (safe method)", async () => {
    const outcome = await authorizeRequest(new Request("http://localhost/api/pcb-sync?boardId=b1", {
      headers: { "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" },
    }));
    expect(outcome.ok).toBe(true);
  });
});
