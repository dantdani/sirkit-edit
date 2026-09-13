/**
 * B16.1B §G — permanent composition and invariant coverage:
 * canonical wrapper → identity provider (signed claims + liveness) →
 * membership repository → handler, with fake verifiers; refusal ordering with
 * zero body pulls and zero downstream work; no secret in any body, redirect,
 * or log; production can never resolve local_dev; no unrestricted signup
 * surface; and the exact route / wrapper / factory / raw / tool counts.
 * No network, no live project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { authenticatedJsonRoute, authenticatedRoute } from "../route-handlers";
import { SupabaseIdentityProvider, type SupabaseVerifiedClaims } from "../identity-provider";
import type { SessionLivenessOutcome, SessionLivenessVerifier } from "../session-liveness";
import { setIdentityProviderFactory } from "../identity-runtime";
import { injectMembership, injectMembershipRepository, resetInjectedIdentity } from "../test-support";
import { InMemoryProjectMembershipRepository } from "../project-membership";
import { resolveAuthMode, localDevAllowed, sensitiveOperationsBlocker } from "../mode";
import { allRoutePolicies, policyFor } from "../route-policy";
import { classifyRouteMethodForm, exportedHttpMethods } from "./_boundary-analysis";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const USER = "user-sirkit-qual-0001";
const ORIGIN = "https://sirkit.example";
const PROD = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://sirkitqualification.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_SIRKIT_QUAL_SENTINEL_000000", SIRKIT_EXPECTED_ORIGIN: ORIGIN } as const;
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" } as const;
const SECRET = "sentinel-secret-DO-NOT-LEAK-b16-1b-composition";
const now = () => Math.floor(Date.now() / 1000);
const CLAIMS: SupabaseVerifiedClaims = { sub: USER, exp: now() + 3600, aal: "aal1", session_id: "sess-1" };

function fakeProvider(claims: SupabaseVerifiedClaims | null, outcome: SessionLivenessOutcome) {
  const claimsVerifier = vi.fn(async () => claims);
  const liveness: SessionLivenessVerifier & { confirm: ReturnType<typeof vi.fn> } = { confirm: vi.fn(async () => outcome) };
  setIdentityProviderFactory(() => new SupabaseIdentityProvider(claimsVerifier, { verifier: liveness }));
  return { claimsVerifier, liveness };
}
function counting(url: string, headers: Record<string, string>, counter: { pulls: number }, method = "POST"): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
  return new Request(url, { method, headers, body: stream, duplex: "half" } as RequestInit);
}
const get = (headers: Record<string, string>) => new Request(`${ORIGIN}/api/pcb-sync`, { method: "GET", headers });

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const level of ["log", "warn", "error", "info", "debug"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
});
afterEach(() => { vi.restoreAllMocks(); resetInjectedIdentity(); vi.unstubAllEnvs(); });

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §G — wrapper → identity (claims + liveness) → membership → handler", () => {
  it("a live, member principal reaches the handler once with the server-derived actor; claims and liveness run exactly once", async () => {
    const { claimsVerifier, liveness } = fakeProvider(CLAIMS, { live: true, userId: USER });
    const repo = injectMembership([{ projectId: "proj-1", userId: USER, role: "reviewer" }]);
    const loadSpy = vi.spyOn(repo, "loadActiveMembership");
    const handler = vi.fn(async ({ context }: { context: { actor: { actorId: string; role: string; actorKind: string }; membershipRevision: string } }) => Response.json({ actor: context.actor, revision: context.membershipRevision }));
    const route = authenticatedRoute({ environment: PROD }, handler as never);
    const res = await route(get({ ...SEL, "x-sirkit-role": "project_admin" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { actor: { actorId: string; role: string; actorKind: string }; revision: string };
    expect(body.actor).toEqual({ actorId: USER, role: "reviewer", actorKind: "human", sessionId: "sess-1" });
    expect(claimsVerifier).toHaveBeenCalledTimes(1);
    expect(liveness.confirm).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith({ tenantId: "local", projectId: "proj-1", userId: USER });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("remote revocation → 401; membership is NEVER consulted and the handler NEVER runs", async () => {
    fakeProvider(CLAIMS, { live: false, reason: "revoked" });
    const repo = injectMembership([{ projectId: "proj-1", userId: USER, role: "admin" }]);
    const loadSpy = vi.spyOn(repo, "loadActiveMembership");
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const res = await authenticatedRoute({ environment: PROD }, handler)(get({ ...SEL }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, code: "AUTH_UNAUTHENTICATED", error: "Missing, expired, or invalid authentication." });
    expect(loadSpy).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("claims/liveness id mismatch, expired claims, and malformed claims → 401 with zero downstream work", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    for (const [claims, outcome] of [
      [CLAIMS, { live: true, userId: "someone-else" }],
      [{ ...CLAIMS, exp: now() - 5 }, { live: true, userId: USER }],
      [{ sub: "" } as SupabaseVerifiedClaims, { live: true, userId: USER }],
      [null, { live: true, userId: USER }],
    ] as Array<[SupabaseVerifiedClaims | null, SessionLivenessOutcome]>) {
      fakeProvider(claims, outcome);
      const repo = injectMembership([{ projectId: "proj-1", userId: USER, role: "admin" }]);
      const loadSpy = vi.spyOn(repo, "loadActiveMembership");
      const res = await authenticatedRoute({ environment: PROD }, handler)(get({ ...SEL }));
      expect(res.status).toBe(401);
      expect(loadSpy).not.toHaveBeenCalled();
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("membership role change → different revision; revocation → 403 on the very next request; cross-tenant / cross-project → identical 403", async () => {
    fakeProvider(CLAIMS, { live: true, userId: USER });
    const repo = new InMemoryProjectMembershipRepository();
    const row = (role: "editor" | "viewer", state: "active" | "revoked", version: number) => ({ tenantId: "local", projectId: "proj-1", userId: USER, role, state, version, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "op" });
    repo.set(row("editor", "active", 1));
    injectMembershipRepository(repo);
    const route = authenticatedRoute({ environment: PROD }, async ({ context }) => Response.json({ role: context.actor.role, revision: context.membershipRevision }));
    const first = await (await route(get({ ...SEL }))).json() as { role: string; revision: string };
    repo.set(row("viewer", "active", 2));
    const second = await (await route(get({ ...SEL }))).json() as { role: string; revision: string };
    expect(first.role).toBe("pcb_editor"); expect(second.role).toBe("viewer");
    expect(first.revision).not.toBe(second.revision);
    repo.set(row("viewer", "revoked", 3));
    const revoked = await route(get({ ...SEL }));
    expect(revoked.status).toBe(403);
    const bodies = [await revoked.text()];
    for (const sel of [{ ...SEL, "x-sirkit-project-id": "proj-other" }, { ...SEL, "x-sirkit-tenant-id": "tenant-other" }]) {
      const r = await route(get(sel));
      expect(r.status).toBe(403);
      bodies.push(await r.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!)).toEqual({ ok: false, code: "AUTH_NO_ACTIVE_MEMBERSHIP", error: "You have no active membership for this project." });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §G — refusal ordering: exact-origin CSRF before identity, zero body pulls, zero downstream work", () => {
  it.each([
    ["missing", {}, "AUTH_ORIGIN_MISSING"],
    ["null", { origin: "null" }, "AUTH_ORIGIN_NULL"],
    ["malformed", { origin: "sirkit.example" }, "AUTH_ORIGIN_MALFORMED"],
    ["downgraded", { origin: "http://sirkit.example" }, "AUTH_CROSS_ORIGIN_DENIED"],
    ["foreign", { origin: "https://evil.example" }, "AUTH_CROSS_ORIGIN_DENIED"],
    ["forwarding spoof", { origin: "https://evil.example", "x-forwarded-host": "sirkit.example", host: "sirkit.example" }, "AUTH_CROSS_ORIGIN_DENIED"],
  ] as Array<[string, Record<string, string>, string]>)("Origin %s → 403 %s; identity, liveness, membership, handler untouched; zero pulls", async (_label, headers, code) => {
    const { claimsVerifier, liveness } = fakeProvider(CLAIMS, { live: true, userId: USER });
    const repo = injectMembership([{ projectId: "proj-1", userId: USER, role: "admin" }]);
    const loadSpy = vi.spyOn(repo, "loadActiveMembership");
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const counter = { pulls: 0 };
    const res = await authenticatedJsonRoute({ maxBytes: 10_000, environment: PROD }, handler)(counting(`${ORIGIN}/api/pcb-sync`, { "content-type": "application/json", ...SEL, ...headers }, counter));
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe(code);
    expect(counter.pulls).toBe(0);
    expect(claimsVerifier).not.toHaveBeenCalled();
    expect(liveness.confirm).not.toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("same-origin but revoked → 401 with zero pulls; a viewer on an editor-only route → 403 AUTH_ROLE_DENIED with zero pulls", async () => {
    fakeProvider(CLAIMS, { live: false, reason: "revoked" });
    injectMembership([{ projectId: "proj-1", userId: USER, role: "admin" }]);
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const counter = { pulls: 0 };
    const revoked = await authenticatedJsonRoute({ maxBytes: 10_000, environment: PROD }, handler)(counting(`${ORIGIN}/api/pcb-sync`, { "content-type": "application/json", origin: ORIGIN, ...SEL }, counter));
    expect(revoked.status).toBe(401);
    fakeProvider(CLAIMS, { live: true, userId: USER });
    injectMembership([{ projectId: "proj-1", userId: USER, role: "viewer" }]);
    const viewer = await authenticatedJsonRoute({ maxBytes: 10_000, environment: PROD }, handler)(counting(`${ORIGIN}/api/pcb-sync`, { "content-type": "application/json", origin: ORIGIN, ...SEL }, counter));
    expect(viewer.status).toBe(403);
    expect((await viewer.json() as { code: string }).code).toBe("AUTH_ROLE_DENIED");
    expect(counter.pulls).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §G — no token, cookie, password, or provider diagnostic in bodies, redirects, or logs", () => {
  it("a provider error carrying a secret never reaches the response body, headers, or console; the refusal is the uniform 401", async () => {
    const claimsVerifier = vi.fn(async () => { throw new Error(`provider exploded: ${SECRET}`); });
    setIdentityProviderFactory(() => new SupabaseIdentityProvider(claimsVerifier, { verifier: { confirm: async () => ({ live: false, reason: "error" }) } }));
    injectMembership([{ projectId: "proj-1", userId: USER, role: "admin" }]);
    const res = await authenticatedRoute({ environment: PROD }, async () => Response.json({ ok: true }))(get({ ...SEL, cookie: `sb-x-auth-token=${SECRET}` }));
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("sb-x-auth-token");
    expect(res.headers.get("cache-control")).toBe("no-store");
    for (const [, v] of res.headers) expect(v).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  it("a liveness verifier that rejects with a secret is equally silent", async () => {
    fakeProvider(CLAIMS, { live: true, userId: USER });
    setIdentityProviderFactory(() => new SupabaseIdentityProvider(async () => CLAIMS, { verifier: { confirm: async () => { throw new Error(`user endpoint said ${SECRET}`); } } }));
    injectMembership([{ projectId: "proj-1", userId: USER, role: "admin" }]);
    const res = await authenticatedRoute({ environment: PROD }, async () => Response.json({ ok: true }))(get({ ...SEL }));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain(SECRET);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §G — production can never resolve local_dev", () => {
  it("NODE_ENV=production is production regardless of SIRKIT_AUTH_MODE, host information, or headers", () => {
    for (const env of [
      { NODE_ENV: "production" },
      { NODE_ENV: "production", SIRKIT_AUTH_MODE: "local_dev" },
      { NODE_ENV: "production", SIRKIT_AUTH_MODE: "LOCAL_DEV " },
      { NODE_ENV: "production", SIRKIT_AUTH_MODE: "local_dev", HOST: "", HOSTNAME: "", VERCEL_URL: "" },
      { NODE_ENV: "production", SIRKIT_AUTH_MODE: "local_dev", HOST: "localhost", HOSTNAME: "127.0.0.1" },
    ]) {
      expect(resolveAuthMode(env), JSON.stringify(env)).toBe("production");
      expect(localDevAllowed(env), JSON.stringify(env)).toBe(false);
      expect(sensitiveOperationsBlocker(env), JSON.stringify(env)).toMatch(/not configured/);
    }
    // and a non-production runtime that DECLARES production is production too
    expect(resolveAuthMode({ SIRKIT_AUTH_MODE: "production" })).toBe("production");
  });

  it("the resolver in production refuses BEFORE identity when auth is unconfigured (403 AUTH_PRODUCTION_NOT_CONFIGURED), never a local principal", async () => {
    const { claimsVerifier } = fakeProvider(CLAIMS, { live: true, userId: USER });
    const res = await authenticatedRoute({ environment: { NODE_ENV: "production" } }, async () => Response.json({ ok: true }))(get({ ...SEL, host: "localhost", "x-forwarded-host": "localhost" }));
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe("AUTH_PRODUCTION_NOT_CONFIGURED");
    expect(claimsVerifier).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §G — no unrestricted signup surface", () => {
  it("no signup/register route directory, no signup policy row, and the sign-in page says so", () => {
    const authDir = join(ROOT, "app", "api", "auth");
    for (const forbidden of ["signup", "sign-up", "register", "create-account", "invite"]) expect(existsSync(join(authDir, forbidden)), forbidden).toBe(false);
    expect(readdirSync(authDir).filter((d) => statSync(join(authDir, d)).isDirectory()).sort()).toEqual(["__tests__", "callback", "signin", "signout"]);
    for (const p of allRoutePolicies()) expect(/sign-?up|register|create-account/i.test(p.path), p.path).toBe(false);
    expect(policyFor("/api/auth/signup", "POST")).toBeNull();
    expect(readFileSync(join(ROOT, "app", "signin", "page.tsx"), "utf8")).toMatch(/no self-service sign-up/i);
    // the SDK's signUp API is never referenced by production code
    for (const rel of ["app/api/auth/signin/route.ts", "app/api/auth/callback/route.ts", "app/api/auth/signout/route.ts", "app/lib/auth/identity-provider.ts", "app/lib/auth/supabase-server.ts", "proxy.ts"]) {
      expect(readFileSync(join(ROOT, rel), "utf8"), rel).not.toMatch(/\.signUp\(|signInAnonymously|admin\.createUser/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §G — exact invariants", () => {
  function routeFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { if (entry !== "__tests__") routeFiles(full, out); }
      else if (entry === "route.ts") out.push(full);
    }
    return out;
  }
  it("exactly 161 route methods: 158 canonical wrappers, 3 approved factories, 0 raw handlers (B18-A: + GET/POST /api/agent/autonomy; B19-E E2: + POST /api/parts/external-search; B19-E E4: + GET/POST /api/components/atomic/publication); exactly the intentional agent-exposed tools", () => {
    let total = 0, canonical = 0, factories = 0, raw = 0;
    for (const file of routeFiles(join(ROOT, "app", "api"))) {
      const src = readFileSync(file, "utf8");
      for (const method of exportedHttpMethods(src, file)) {
        total += 1;
        const form = classifyRouteMethodForm(src, method, file, ROOT).form;
        if (form === "canonical-wrapper") canonical += 1;
        else if (form === "factory") factories += 1;
        else raw += 1;
      }
    }
    expect({ total, canonical, factories, raw }).toEqual({ total: 161, canonical: 158, factories: 3, raw: 0 }); // B18-A: + GET/POST /api/agent/autonomy; B18-B: + GET/POST /api/agent/execution-grant, POST /api/agent/execution-grant/settle; B19-E E2: + POST /api/parts/external-search; B19-E E4: + GET/POST /api/components/atomic/publication (reviewed ratchet move: two new canonical wrappers; 0 raw stays 0)
    const exposed = sirkitToolRegistry().list().filter((d) => d.agentExposed);
    expect(exposed).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect(new Set(exposed.map((d) => d.toolId)).size).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    // the auth routes are policy rows, not tools, and none is agent-exposed
    for (const d of exposed) expect(d.toolId).not.toMatch(/^sirkit\.auth\.|sign-?in|sign-?out|callback|session/i);
    void relative;
  });
});
