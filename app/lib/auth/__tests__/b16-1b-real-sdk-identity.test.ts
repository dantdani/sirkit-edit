/**
 * B16.1B §C/§E/§G — the production identity path exercised with the REAL
 * `@supabase/ssr` + `@supabase/auth-js` SDK (not a mocked module), a locally
 * generated ES256 key pair, and a `fetch` spy standing in for the Auth
 * server. Every value here is a synthetic sentinel — no real secret, token,
 * cookie, URL, or email exists in this file, and nothing touches the network.
 *
 * Permanent form of the B16.1B pre-edit counterexamples R2/R3/R7/R8/R9 with
 * the post-edit expectations: a valid token from a REVOKED remote session is
 * now refused after exactly one server confirmation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { resolveTrustedRequestContext } from "../trusted-request-context";
import { SupabaseIdentityProvider, createSupabaseClaimsVerifier, createSupabaseSessionVerifiers } from "../identity-provider";
import { setIdentityProviderFactory } from "../identity-runtime";
import { injectMembership, resetInjectedIdentity } from "../test-support";
import { authenticatedRoute } from "../route-handlers";

// ── synthetic sentinels ───────────────────────────────────────────────────────
const REF = "sirkitauthqualification";
const SUPABASE_URL = `https://${REF}.supabase.co`;
const KEY = "sb_publishable_SIRKIT_AUTH_QUALIFICATION_SENTINEL_00000000";
const COOKIE = `sb-${REF}-auth-token`;
const ORIGIN = "https://sirkit.example";
const USER_ID = "7d1b2a4e-0000-4000-8000-sirkitqual01";
const SESSION_ID = "9e8f7a6b-0000-4000-8000-sirkitsess01";
const REFRESH = "sirkit-auth-qualification-refresh-sentinel";
const PROD_ENV = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY, SIRKIT_EXPECTED_ORIGIN: ORIGIN, SIRKIT_DEPLOYMENT_ENV: "production" } as const; // [B24-A1, 2026-10-06] + the deployment profile (OD-190)
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" } as const;
const nowSec = () => Math.floor(Date.now() / 1000);

// ── JWT / cookie crafting ─────────────────────────────────────────────────────
const subtle = webcrypto.subtle;
function b64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  return Buffer.from(bytes).toString("base64url");
}
async function es256(kid: string): Promise<{ privateKey: CryptoKey; jwk: Record<string, unknown> }> {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", pair.publicKey) as Record<string, unknown>;
  delete jwk.key_ops; delete jwk.ext;
  return { privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: "ES256", use: "sig" } };
}
async function jwt(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: CryptoKey | null): Promise<string> {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = privateKey ? new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, data)) : new Uint8Array(64).fill(7);
  return `${h}.${p}.${b64url(sig)}`;
}
function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const iat = nowSec();
  return { iss: `${SUPABASE_URL}/auth/v1`, sub: USER_ID, aud: "authenticated", role: "authenticated", exp: iat + 3600, iat, session_id: SESSION_ID, aal: "aal1", amr: [{ method: "password", timestamp: iat }], is_anonymous: false, ...overrides };
}
function sessionCookie(accessToken: string, expiresAt = nowSec() + 3600): string {
  const session = { access_token: accessToken, refresh_token: REFRESH, token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user: { id: USER_ID, aud: "authenticated", role: "authenticated" } };
  return `${COOKIE}=base64-${b64url(JSON.stringify(session))}`;
}
async function signedSession(kid: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const { privateKey, jwk } = await es256(kid);
  jwks = { keys: [jwk] };
  const token = await jwt({ alg: "ES256", typ: "JWT", kid }, claims(overrides), privateKey);
  secrets.add(token);
  return token;
}

// ── fetch spy (stands in for the Auth server) ────────────────────────────────
type Call = { method: string; path: string };
const calls: Call[] = [];
let jwks: { keys: unknown[] } = { keys: [] };
let userResponse: () => Response | Promise<Response> = () => json(200, { id: USER_ID, aud: "authenticated", role: "authenticated" });
function json(status: number, body: unknown): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
const userCalls = () => calls.filter((c) => c.path.endsWith("/auth/v1/user")).length;
const refreshCalls = () => calls.filter((c) => c.path.includes("grant_type=refresh_token")).length;
const REVOKED = () => json(403, { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" });

const secrets = new Set<string>([SUPABASE_URL, KEY, REFRESH]);
function req(headers: Record<string, string>, method = "GET"): Request {
  return new Request(`${ORIGIN}/api/pcb-sync`, { method, headers });
}
/** The PRODUCTION composition: signed claims + bounded liveness on ONE client. */
function productionProvider(deadlineMs = 2_000): SupabaseIdentityProvider {
  const verifiers = createSupabaseSessionVerifiers(PROD_ENV, { deadlineMs });
  return new SupabaseIdentityProvider(verifiers.verifyClaims, { verifier: verifiers.liveness, deadlineMs });
}
async function resolve(headers: Record<string, string>) {
  return resolveTrustedRequestContext(req(headers), { environment: PROD_ENV });
}
async function refusal(headers: Record<string, string>): Promise<Response> {
  const resolved = await resolve(headers);
  if (resolved.ok) throw new Error("expected a refusal");
  return resolved.refusal.response;
}

beforeEach(() => {
  calls.length = 0;
  jwks = { keys: [] };
  userResponse = () => json(200, { id: USER_ID, aud: "authenticated", role: "authenticated" });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname + (url.searchParams.has("grant_type") ? `?grant_type=${url.searchParams.get("grant_type")}` : "") });
    if (url.pathname.endsWith("/.well-known/jwks.json")) return json(200, jwks);
    if (url.pathname.endsWith("/auth/v1/user")) return userResponse();
    if (url.pathname.endsWith("/auth/v1/token")) return json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
    if (url.pathname.endsWith("/auth/v1/logout")) return new Response(null, { status: 204 });
    return json(404, { msg: "not found" });
  });
  vi.spyOn(console, "warn").mockImplementation(() => {}); // the SDK warns on corrupt cookies; keep the run quiet
  injectMembership([{ projectId: "proj-1", userId: USER_ID, role: "editor" }]);
  setIdentityProviderFactory(() => productionProvider());
});
afterEach(() => { vi.restoreAllMocks(); resetInjectedIdentity(); });

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B — missing, malformed, expired and tampered cookies → 401 (real SDK)", () => {
  it("missing cookie → 401 with zero network calls", async () => {
    const r = await refusal({ ...SEL });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ ok: false, code: "AUTH_UNAUTHENTICATED" });
    expect(calls).toEqual([]);
  });

  it("malformed cookie values (garbage / bad base64 / non-JSON / no tokens / raw JSON) → 401, never a crash, zero /user calls", async () => {
    for (const value of [
      `${COOKIE}=garbage`,
      `${COOKIE}=base64-%%%not-base64%%%`,
      `${COOKIE}=base64-${b64url("not json at all")}`,
      `${COOKIE}=base64-${b64url(JSON.stringify({ hello: "world" }))}`,
      `${COOKIE}=base64-${b64url(JSON.stringify({ access_token: "a.b", refresh_token: REFRESH, expires_at: nowSec() + 3600 }))}`,
      `${COOKIE}=${JSON.stringify({ access_token: "not-a-jwt", refresh_token: REFRESH, expires_at: nowSec() + 3600 })}`,
    ]) {
      expect((await refusal({ ...SEL, cookie: value })).status, value.slice(0, 40)).toBe(401);
    }
    expect(userCalls()).toBe(0);
  });

  it("expired access token whose refresh the server rejects → 401 after exactly one refresh attempt and no /user", async () => {
    const token = await signedSession("kid-expired", { exp: nowSec() - 120, iat: nowSec() - 3720 });
    expect((await refusal({ ...SEL, cookie: sessionCookie(token, nowSec() - 120) })).status).toBe(401);
    expect(refreshCalls()).toBe(1);
    expect(userCalls()).toBe(0);
  });

  it("forged signature / tampered payload / alg=none / unknown kid → 401 before any liveness confirmation", async () => {
    const { privateKey, jwk } = await es256("kid-tamper");
    jwks = { keys: [jwk] };
    userResponse = REVOKED;
    const forged = await jwt({ alg: "ES256", typ: "JWT", kid: "kid-tamper" }, claims(), null);
    expect((await refusal({ ...SEL, cookie: sessionCookie(forged) })).status).toBe(401);
    const genuine = await jwt({ alg: "ES256", typ: "JWT", kid: "kid-tamper" }, claims(), privateKey);
    const [h, , s] = genuine.split(".");
    const escalated = `${h}.${b64url(JSON.stringify(claims({ sub: "someone-else" })))}.${s}`;
    expect((await refusal({ ...SEL, cookie: sessionCookie(escalated) })).status).toBe(401);
    const none = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify(claims()))}.`;
    expect((await refusal({ ...SEL, cookie: sessionCookie(none) })).status).toBe(401);
    jwks = { keys: [] };
    const unknownKid = await jwt({ alg: "ES256", typ: "JWT", kid: "kid-unknown" }, claims(), privateKey);
    expect((await refusal({ ...SEL, cookie: sessionCookie(unknownKid) })).status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B — a VALID token from a REVOKED remote session (the reproduced R8 fail-open)", () => {
  it("claims-only composition (pre-B16.1B) ACCEPTS it without ever asking the server — why the liveness boundary exists", async () => {
    const token = await signedSession("kid-r8-contrast");
    userResponse = REVOKED;
    setIdentityProviderFactory(() => new SupabaseIdentityProvider(createSupabaseClaimsVerifier(PROD_ENV)));
    const resolved = await resolve({ ...SEL, cookie: sessionCookie(token) });
    expect(resolved.ok).toBe(true);
    expect(userCalls()).toBe(0);
  });

  it("the PRODUCTION composition REFUSES it (401) after EXACTLY one /user confirmation", async () => {
    const token = await signedSession("kid-r8");
    userResponse = REVOKED;
    const r = await refusal({ ...SEL, cookie: sessionCookie(token) });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, code: "AUTH_UNAUTHENTICATED", error: "Missing, expired, or invalid authentication." });
    expect(userCalls()).toBe(1);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("a LIVE session whose server-confirmed id differs from claims.sub is refused (mismatch), exactly one /user call", async () => {
    const token = await signedSession("kid-mismatch");
    userResponse = () => json(200, { id: "someone-else", aud: "authenticated", role: "authenticated" });
    expect((await refusal({ ...SEL, cookie: sessionCookie(token) })).status).toBe(401);
    expect(userCalls()).toBe(1);
  });

  it("a /user call that never answers settles as a refusal within the deadline — never a hang", async () => {
    const token = await signedSession("kid-hang");
    userResponse = () => new Promise<Response>(() => { /* never settles */ });
    setIdentityProviderFactory(() => productionProvider(300));
    const t0 = Date.now();
    expect((await refusal({ ...SEL, cookie: sessionCookie(token) })).status).toBe(401);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(userCalls()).toBe(1);
  });

  it("HS256 (legacy symmetric secret): the SDK's own /user fallback already refuses the revoked session; a live one is confirmed", async () => {
    const token = await jwt({ alg: "HS256", typ: "JWT" }, claims(), null);
    userResponse = REVOKED;
    expect((await refusal({ ...SEL, cookie: sessionCookie(token) })).status).toBe(401);
    expect(userCalls()).toBe(1); // getClaims' internal fallback; liveness never reached
    calls.length = 0;
    userResponse = () => json(200, { id: USER_ID });
    const resolved = await resolve({ ...SEL, cookie: sessionCookie(token) });
    expect(resolved.ok).toBe(true);
    expect(userCalls()).toBe(2); // SDK fallback + the explicit liveness confirmation (documented cost for HS256 projects)
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B — a LIVE session resolves server-derived identity; headers are inert; membership is re-read every request", () => {
  it("actor id = verified JWT sub (confirmed live), role = project_members, kind = human — forged x-sirkit-* headers change nothing", async () => {
    const token = await signedSession("kid-live");
    injectMembership([{ projectId: "proj-1", userId: USER_ID, role: "viewer" }]);
    const resolved = await resolve({ ...SEL, cookie: sessionCookie(token), "x-sirkit-actor-id": "attacker", "x-sirkit-role": "project_admin", "x-sirkit-actor-kind": "system_migration", "x-sirkit-user-id": "attacker" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.context.actor).toMatchObject({ actorId: USER_ID, role: "viewer", actorKind: "human" });
    expect(resolved.context.sessionIdentity).toBe(SESSION_ID);
    expect(resolved.context.authMethod).toBe("supabase_cookie");
    expect(userCalls()).toBe(1);
    expect(JSON.stringify(resolved.context)).not.toContain(token);
  });

  it("through the canonical wrapper: GET /api/pcb-sync runs the handler once with the server-derived actor", async () => {
    const token = await signedSession("kid-wrapper");
    const handler = vi.fn(async ({ context }: { context: { actor: { actorId: string; role: string } } }) => Response.json({ ok: true, actorId: context.actor.actorId, role: context.actor.role }));
    const route = authenticatedRoute({ environment: PROD_ENV }, handler as never);
    const r = await route(req({ ...SEL, cookie: sessionCookie(token), "x-sirkit-role": "project_admin" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, actorId: USER_ID, role: "pcb_editor" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("membership revocation is observed on the IMMEDIATELY following request (same session, no token refresh); a role change changes the revision", async () => {
    const token = await signedSession("kid-r9");
    const repo = injectMembership([{ projectId: "proj-1", userId: USER_ID, role: "editor" }]);
    const first = await resolve({ ...SEL, cookie: sessionCookie(token) });
    expect(first.ok).toBe(true);
    repo.set({ tenantId: "local", projectId: "proj-1", userId: USER_ID, role: "editor", state: "revoked", version: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", auditActorId: "op" });
    const second = await refusal({ ...SEL, cookie: sessionCookie(token) });
    expect(second.status).toBe(403);
    expect(await second.json()).toMatchObject({ code: "AUTH_NO_ACTIVE_MEMBERSHIP" });
    expect(refreshCalls()).toBe(0);
    repo.set({ tenantId: "local", projectId: "proj-1", userId: USER_ID, role: "viewer", state: "active", version: 3, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", auditActorId: "op" });
    const third = await resolve({ ...SEL, cookie: sessionCookie(token) });
    expect(third.ok && third.context.actor.role).toBe("viewer");
    expect(first.ok && third.ok && first.context.membershipRevision !== third.context.membershipRevision).toBe(true);
  });

  it("foreign tenant / foreign project selectors never resolve another project's membership (identical 403)", async () => {
    const token = await signedSession("kid-isolation");
    const bodies: string[] = [];
    for (const sel of [{ ...SEL, "x-sirkit-project-id": "proj-other" }, { ...SEL, "x-sirkit-tenant-id": "tenant-other" }]) {
      const r = await refusal({ ...sel, cookie: sessionCookie(token) });
      expect(r.status).toBe(403);
      bodies.push(await r.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });
});
