/**
 * B16.0 — trusted request identity, project membership, and the release
 * perimeter. Permanent regressions for R02-B1-011.
 *
 * All identity/membership is driven through the injectable runtime seams
 * (deterministic fakes) — no Supabase Auth contact, no network, no live
 * release.
 */

import { afterEach, describe, expect, it } from "vitest";
import { resolveTrustedRequestContext } from "../trusted-request-context";
import { resolveAuthMode, localDevAllowed, sensitiveOperationsBlocker } from "../mode";
import { verifyWorkerSecret } from "../worker-principal";
import { timingSafeEqualString } from "../constant-time";
import { projectRoleFromMembership } from "../project-membership";
import {
  injectIdentity,
  injectMembership,
  injectAuthorizedPrincipal,
  resetInjectedIdentity,
} from "../test-support";

afterEach(() => resetInjectedIdentity());

function req(headers: Record<string, string> = {}, method = "POST", url = "http://localhost/api/pcb-sync"): Request {
  return new Request(url, { method, headers });
}
const SELECTOR = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "p1", "x-sirkit-branch-id": "main" };

// ─── Forged-header refusals (items 1-3) ──────────────────────────────────────

describe("B16.0 — forged identity headers grant nothing", () => {
  it("1: a forged x-sirkit-role=project_admin is IGNORED; the role is server-derived from membership", async () => {
    injectAuthorizedPrincipal({ userId: "u1", projectId: "p1", role: "viewer" });
    const resolved = await resolveTrustedRequestContext(req({ ...SELECTOR, "x-sirkit-role": "project_admin", "x-sirkit-actor-id": "attacker" }));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.context.actor.role).toBe("viewer"); // membership role, NOT the header
    expect(resolved.context.actor.actorId).toBe("u1"); // verified principal, NOT the header
  });

  it("2: a forged x-sirkit-actor-id cannot become a different apparent human", async () => {
    injectAuthorizedPrincipal({ userId: "real-user", projectId: "p1", role: "editor" });
    const resolved = await resolveTrustedRequestContext(req({ ...SELECTOR, "x-sirkit-actor-id": "someone-else" }));
    expect(resolved.ok && resolved.context.actor.actorId).toBe("real-user");
  });

  it("3: a forged x-sirkit-actor-kind cannot claim a kind; a browser principal is ALWAYS human", async () => {
    injectAuthorizedPrincipal({ userId: "u1", projectId: "p1", role: "editor" });
    const resolved = await resolveTrustedRequestContext(req({ ...SELECTOR, "x-sirkit-actor-kind": "system_migration" }));
    expect(resolved.ok && resolved.context.actor.actorKind).toBe("human");
  });
});

// ─── Authentication failures → 401 (items 4-6) ───────────────────────────────

describe("B16.0 — authentication failures are 401", () => {
  it("4: missing authentication → 401", async () => {
    injectIdentity(null);
    const resolved = await resolveTrustedRequestContext(req(SELECTOR));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal.response.status).toBe(401);
  });

  it("5/6: an expired/invalid supabase claim (verifier returns null) → 401", async () => {
    // The identity provider returning null models expired / bad-signature /
    // malformed claims — all fail closed to 401.
    injectIdentity({ userId: "u1", authenticated: false });
    const resolved = await resolveTrustedRequestContext(req(SELECTOR));
    expect(resolved.ok === false && resolved.refusal.response.status).toBe(401);
  });
});

// ─── Authorization failures → 403 (items 7-11) ───────────────────────────────

describe("B16.0 — membership failures are 403", () => {
  it("7: no membership → 403", async () => {
    injectIdentity({ userId: "u1" });
    injectMembership([]); // no memberships at all
    const resolved = await resolveTrustedRequestContext(req(SELECTOR));
    expect(resolved.ok === false && resolved.refusal.response.status).toBe(403);
  });

  it("8: revoked membership → 403", async () => {
    injectIdentity({ userId: "u1" });
    injectMembership([{ projectId: "p1", userId: "u1", role: "admin", state: "revoked" }]);
    const resolved = await resolveTrustedRequestContext(req(SELECTOR));
    expect(resolved.ok === false && resolved.refusal.response.status).toBe(403);
  });

  it("9: insufficient role is DERIVED (viewer), never a header claim", async () => {
    injectAuthorizedPrincipal({ userId: "u1", projectId: "p1", role: "viewer" });
    const resolved = await resolveTrustedRequestContext(req({ ...SELECTOR, "x-sirkit-role": "project_admin" }));
    // Resolution succeeds with the DERIVED viewer role — downstream route
    // gates then refuse the write. The header claim is inert.
    expect(resolved.ok && resolved.context.actor.role).toBe("viewer");
  });

  it("10: cross-tenant request → 403 (no membership in the foreign tenant)", async () => {
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "p1", userId: "u1", role: "admin" }]);
    const resolved = await resolveTrustedRequestContext(req({ ...SELECTOR, "x-sirkit-tenant-id": "other-tenant" }));
    expect(resolved.ok === false && resolved.refusal.response.status).toBe(403);
  });

  it("11: cross-project request → 403 (no membership in the foreign project)", async () => {
    injectIdentity({ userId: "u1" });
    injectMembership([{ projectId: "p1", userId: "u1", role: "admin" }]);
    const resolved = await resolveTrustedRequestContext(req({ ...SELECTOR, "x-sirkit-project-id": "p-foreign" }));
    expect(resolved.ok === false && resolved.refusal.response.status).toBe(403);
  });
});

// ─── Role derivation (items 12-13) ───────────────────────────────────────────

describe("B16.0 — role derivation", () => {
  it("12: valid membership derives the exact ProjectRole", async () => {
    for (const [membershipRole, projectRole] of [["viewer", "viewer"], ["commenter", "commenter"], ["editor", "pcb_editor"], ["reviewer", "reviewer"], ["admin", "project_admin"]] as const) {
      injectAuthorizedPrincipal({ userId: "u1", projectId: "p1", role: membershipRole });
      const resolved = await resolveTrustedRequestContext(req(SELECTOR));
      expect(resolved.ok && resolved.context.actor.role, membershipRole).toBe(projectRole);
    }
  });

  it("13: the role NEVER comes from user metadata — only the membership mapping", () => {
    // The mapping is a closed, server-owned table; an unknown/foreign value
    // (e.g. a JWT metadata role) maps to null (fail closed).
    expect(projectRoleFromMembership("admin")).toBe("project_admin");
    expect(projectRoleFromMembership("super-hacker")).toBeNull();
    expect(projectRoleFromMembership("project_admin")).toBeNull(); // not a membership role
  });
});

// ─── CSRF / same-origin (items 14-15) ────────────────────────────────────────

describe("B16.0 — CSRF / same-origin", () => {
  it("14: a cookie-authenticated cross-origin mutation is refused (403)", async () => {
    injectAuthorizedPrincipal({ userId: "u1", projectId: "p1" });
    const resolved = await resolveTrustedRequestContext(
      req({ ...SELECTOR, origin: "https://attacker.example" }, "POST"),
      { enforceSameOrigin: true, environment: { SIRKIT_AUTH_MODE: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SIRKIT_EXPECTED_ORIGIN: "http://localhost" } },
    );
    expect(resolved.ok === false && resolved.refusal.response.status).toBe(403);
  });

  it("15: a valid same-origin request succeeds", async () => {
    injectAuthorizedPrincipal({ userId: "u1", projectId: "p1" });
    const resolved = await resolveTrustedRequestContext(
      req({ ...SELECTOR, origin: "http://localhost", host: "localhost" }, "POST"),
      { enforceSameOrigin: true, environment: { SIRKIT_AUTH_MODE: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SIRKIT_EXPECTED_ORIGIN: "http://localhost" } },
    );
    expect(resolved.ok).toBe(true);
  });
});

// ─── Worker boundary (items 16-17) ───────────────────────────────────────────

describe("B16.0 — worker/service boundary", () => {
  it("16: a bearer/service identity can never become a human", () => {
    const worker = verifyWorkerSecret(new Request("http://localhost/api/engineering-effects", { headers: { authorization: "Bearer top-secret" } }), { SIRKIT_WORKFLOW_WORKER_SECRET: "top-secret" });
    expect(worker).not.toBeNull();
    expect(worker!.actor.actorKind).not.toBe("human");
    expect(worker!.actor.actorKind).toBe("automated_engine");
  });

  it("17: worker-secret comparison is constant-time and mismatch/absent fails closed", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "abcd")).toBe(false); // length mismatch, no early leak
    // absent secret / wrong token → null
    expect(verifyWorkerSecret(new Request("http://x", { headers: { authorization: "Bearer wrong" } }), { SIRKIT_WORKFLOW_WORKER_SECRET: "right" })).toBeNull();
    expect(verifyWorkerSecret(new Request("http://x", { headers: { authorization: "Bearer any" } }), {})).toBeNull(); // unconfigured
  });
});

// ─── Local-dev mode (items 18-20) ────────────────────────────────────────────

describe("B16.0 — local-dev mode is explicit and non-production", () => {
  it("18: production without configured authentication blocks sensitive operations, and NEVER resolves local_dev (B16.0.1 §G)", () => {
    expect(sensitiveOperationsBlocker({ SIRKIT_AUTH_MODE: "production" })).not.toBeNull();
    // A production runtime ALWAYS resolves production — SIRKIT_AUTH_MODE and
    // host headers can never override it (R7 closure).
    expect(resolveAuthMode({ NODE_ENV: "production" })).toBe("production");
    expect(resolveAuthMode({ NODE_ENV: "production", SIRKIT_AUTH_MODE: "local_dev" })).toBe("production");
    expect(resolveAuthMode({ NODE_ENV: "production", SIRKIT_AUTH_MODE: "local_dev", SIRKIT_DEPLOY_HOST: "localhost" })).toBe("production");
    // local_dev is NEVER allowed in a production runtime, regardless of host.
    expect(localDevAllowed({ NODE_ENV: "production", SIRKIT_AUTH_MODE: "local_dev", SIRKIT_DEPLOY_HOST: "localhost" })).toBe(false);
    expect(localDevAllowed({ NODE_ENV: "production", SIRKIT_AUTH_MODE: "local_dev" })).toBe(false);
  });

  it("19: local_dev works only under its explicit non-production conditions", () => {
    expect(resolveAuthMode({})).toBe("local_dev"); // dev/test default
    expect(resolveAuthMode({ SIRKIT_AUTH_MODE: "local_dev" })).toBe("local_dev");
    expect(resolveAuthMode({ SIRKIT_AUTH_MODE: "production" })).toBe("production");
    // sensitive ops are NOT blocked outside production
    expect(sensitiveOperationsBlocker({})).toBeNull();
  });

  it("20: the local_dev principal resolves without configured auth (frictionless, non-production)", async () => {
    // No injected source: the default local_dev path yields the fixed
    // principal with an admin membership.
    const resolved = await resolveTrustedRequestContext(req(SELECTOR), { environment: {} });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.context.authMethod).toBe("local_dev");
    expect(resolved.context.authStrength).toBe("local_dev");
    expect(resolved.context.actor.actorKind).toBe("human");
    expect(resolved.context.actor.role).toBe("project_admin");
  });
});

// ─── Bounded, secret-free output ─────────────────────────────────────────────

describe("B16.0 — the context leaks no secrets", () => {
  it("carries no token/cookie/secret, and produces a membership revision", async () => {
    injectAuthorizedPrincipal({ userId: "u1", projectId: "p1", role: "reviewer" });
    const resolved = await resolveTrustedRequestContext(req({ ...SELECTOR, cookie: "sb-access-token=SECRET" }));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const serialized = JSON.stringify(resolved.context);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("sb-access-token");
    expect(resolved.context.membershipRevision).toMatch(/^mbr1-/);
    expect(resolved.context.correlationId).toMatch(/^corr-/);
  });
});
