/**
 * B16.1B §D — LIVE production-auth qualification matrix. OPT-IN ONLY.
 *
 * This file refuses to run its live body unless ALL of the following are
 * present in the environment (values are never printed, logged, or asserted
 * into messages):
 *
 *   SIRKIT_LIVE_AUTH_QUALIFICATION=1                    explicit live flag
 *   SIRKIT_AUTH_QUALIFICATION_PROJECT=sirkit-auth-qualification-<label>
 *                                                        isolated-project marker (prefix enforced)
 *   SIRKIT_AUTH_QUALIFICATION_BASE_URL=http://127.0.0.1:<port>
 *                                                        the REAL Next.js app, started in production auth
 *                                                        mode with SIRKIT_EXPECTED_ORIGIN equal to this origin [B24-A1, 2026-10-06] and SIRKIT_DEPLOYMENT_ENV=staging (or production): without it every sensitive route answers 403 AUTH_PRODUCTION_NOT_CONFIGURED
 *   SIRKIT_AUTH_QUALIFICATION_EMAIL / _PASSWORD          a dedicated qualification account (existing)
 *   SIRKIT_AUTH_QUALIFICATION_PROJECT_ID                 a project the account holds an ACTIVE membership in
 *   SIRKIT_AUTH_QUALIFICATION_TENANT_ID                  optional (default "local")
 *   SIRKIT_AUTH_QUALIFICATION_DATABASE_URL               optional: the ISOLATED project's database, for the
 *                                                        membership canary (active → revoked → cleanup)
 *
 * Ordinary CI never sets these, so the live body is skipped there. The
 * always-on test below pins that gating. Everything the live body records is
 * a status, a code, a cookie NAME, or a flag — never a value.
 */
import { afterAll, describe, expect, it } from "vitest"; import { databaseTls } from "../../db/connection-security"; // [B24-A4] D24-3, OD-192: the TLS rule, on this line so no line moves

const FLAG = process.env.SIRKIT_LIVE_AUTH_QUALIFICATION === "1";
const MARKER = process.env.SIRKIT_AUTH_QUALIFICATION_PROJECT ?? "";
const ISOLATED = /^sirkit-auth-qualification-[a-z0-9-]+$/i.test(MARKER);
const BASE = (process.env.SIRKIT_AUTH_QUALIFICATION_BASE_URL ?? "").replace(/\/$/, "");
const EMAIL = process.env.SIRKIT_AUTH_QUALIFICATION_EMAIL ?? "";
const PASSWORD = process.env.SIRKIT_AUTH_QUALIFICATION_PASSWORD ?? "";
const PROJECT_ID = process.env.SIRKIT_AUTH_QUALIFICATION_PROJECT_ID ?? "";
const TENANT_ID = process.env.SIRKIT_AUTH_QUALIFICATION_TENANT_ID ?? "local";
const DB_URL = process.env.SIRKIT_AUTH_QUALIFICATION_DATABASE_URL ?? "";
const LIVE = FLAG && ISOLATED && BASE.length > 0 && EMAIL.length > 0 && PASSWORD.length > 0 && PROJECT_ID.length > 0;
const LIVE_TIMEOUT_MS = 60_000;

describe("B16.1B §D — live qualification is OPT-IN and refuses to run without BOTH markers", () => {
  it("without SIRKIT_LIVE_AUTH_QUALIFICATION=1 AND an isolated-project marker the live body is skipped", () => {
    if (!FLAG || !ISOLATED) {
      expect(LIVE).toBe(false);
      const missing = [
        !FLAG ? "SIRKIT_LIVE_AUTH_QUALIFICATION" : null,
        !ISOLATED ? "SIRKIT_AUTH_QUALIFICATION_PROJECT (must start with sirkit-auth-qualification-)" : null,
        BASE.length === 0 ? "SIRKIT_AUTH_QUALIFICATION_BASE_URL" : null,
        EMAIL.length === 0 ? "SIRKIT_AUTH_QUALIFICATION_EMAIL" : null,
        PASSWORD.length === 0 ? "SIRKIT_AUTH_QUALIFICATION_PASSWORD" : null,
        PROJECT_ID.length === 0 ? "SIRKIT_AUTH_QUALIFICATION_PROJECT_ID" : null,
      ].filter(Boolean);
      console.log(`[b16-1b live] skipped — absent: ${missing.join(", ")}`);
    }
    expect(typeof LIVE).toBe("boolean");
  });
});

// ── minimal cookie jar (values are held in memory only, never printed) ───────
type SetCookie = { name: string; value: string; attrs: Record<string, string | true> };
function parseSetCookie(header: string): SetCookie {
  const [pair, ...rest] = header.split(";");
  const eq = pair!.indexOf("=");
  const name = pair!.slice(0, eq).trim();
  const value = pair!.slice(eq + 1).trim();
  const attrs: Record<string, string | true> = {};
  for (const part of rest) {
    const [k, v] = part.split("=");
    attrs[k!.trim().toLowerCase()] = v === undefined ? true : v.trim();
  }
  return { name, value, attrs };
}
class Jar {
  readonly cookies = new Map<string, string>();
  absorb(response: Response): SetCookie[] {
    const raw = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const parsed = raw.map(parseSetCookie);
    for (const c of parsed) {
      if (c.attrs["max-age"] === "0" || c.value === "") this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return parsed;
  }
  header(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  clone(): Jar { const j = new Jar(); for (const [k, v] of this.cookies) j.cookies.set(k, v); return j; }
}
const SEL = () => ({ "x-sirkit-tenant-id": TENANT_ID, "x-sirkit-project-id": PROJECT_ID, "x-sirkit-branch-id": "main" });
const isFamily = (name: string) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(name);
async function call(path: string, init: RequestInit & { jar?: Jar } = {}): Promise<{ res: Response; text: string; json: Record<string, unknown> | null }> {
  const headers = new Headers(init.headers);
  if (init.jar && init.jar.cookies.size > 0) headers.set("cookie", init.jar.header());
  const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
  return { res, text, json };
}

describe.runIf(LIVE)("B16.1B §D — LIVE matrix against an ISOLATED Supabase project", () => {
  const jar = new Jar();
  let preSignoutJar: Jar | null = null;
  const canary = { sql: null as null | { end: (o?: { timeout?: number }) => Promise<void>; unsafe: (q: string, p?: unknown[]) => Promise<unknown[]> }, userId: "", projectId: `sirkit-auth-qualification-canary-${Date.now().toString(36)}`, inserted: false };

  afterAll(async () => {
    if (canary.sql) {
      try { if (canary.inserted) await canary.sql.unsafe(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [canary.projectId, canary.userId]); }
      finally { await canary.sql.end({ timeout: 5 }); }
    }
  });

  it("the app is up in production auth mode: an unauthenticated protected read is 401 and a cross-origin write is 403", async () => {
    const home = await call("/");
    expect(home.res.status).toBe(200);
    const anon = await call("/api/pcb-sync", { headers: SEL() });
    expect(anon.res.status).toBe(401);
    expect(anon.json?.code).toBe("AUTH_UNAUTHENTICATED");
    const csrf = await call("/api/pcb-sync", { method: "POST", headers: { ...SEL(), "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
    expect(csrf.res.status).toBe(403);
    expect(csrf.json?.code).toBe("AUTH_CROSS_ORIGIN_DENIED");
  }, LIVE_TIMEOUT_MS);

  it("sign-in returns EXACTLY {ok:true} and writes the SSR cookie family with the server-owned flags (names/flags only)", async () => {
    const signin = await call("/api/auth/signin", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    expect(signin.res.status).toBe(200);
    expect(signin.json).toEqual({ ok: true });
    const set = jar.absorb(signin.res);
    const family = set.filter((c) => isFamily(c.name));
    expect(family.length).toBeGreaterThan(0);
    for (const c of family) {
      expect(c.attrs.httponly, `${c.name} HttpOnly`).toBe(true);
      expect(String(c.attrs.samesite ?? "").toLowerCase(), `${c.name} SameSite`).toBe("lax");
      expect(c.attrs.path, `${c.name} Path`).toBe("/");
      expect(Boolean(c.attrs.secure), `${c.name} Secure`).toBe(BASE.startsWith("https:"));
      expect(Number(c.attrs["max-age"] ?? 0), `${c.name} Max-Age`).toBeGreaterThan(0);
    }
    expect(set.filter((c) => !isFamily(c.name))).toEqual([]);
    expect(signin.text).not.toMatch(/token|cookie|password/i);
  }, LIVE_TIMEOUT_MS);

  it("a real protected read succeeds with real membership; forged authority headers change nothing; no selector → 400; foreign tenant/project → identical 403", async () => {
    const ok = await call("/api/pcb-sync", { headers: SEL(), jar });
    expect(ok.res.status).toBe(200);
    const forged = await call("/api/pcb-sync", { headers: { ...SEL(), "x-sirkit-actor-id": "attacker", "x-sirkit-role": "project_admin", "x-sirkit-actor-kind": "system_migration" }, jar });
    expect(forged.res.status).toBe(200);
    expect(forged.text).toBe(ok.text);
    const noSelector = await call("/api/pcb-sync", { jar });
    expect(noSelector.res.status).toBe(400);
    expect(noSelector.json?.code).toBe("AUTH_PROJECT_SELECTOR_REQUIRED");
    const foreignProject = await call("/api/pcb-sync", { headers: { ...SEL(), "x-sirkit-project-id": "sirkit-auth-qualification-foreign-project" }, jar });
    const foreignTenant = await call("/api/pcb-sync", { headers: { ...SEL(), "x-sirkit-tenant-id": "sirkit-auth-qualification-foreign-tenant" }, jar });
    expect(foreignProject.res.status).toBe(403);
    expect(foreignTenant.res.status).toBe(403);
    expect(foreignProject.text).toBe(foreignTenant.text);
    expect(foreignProject.json?.code).toBe("AUTH_NO_ACTIVE_MEMBERSHIP");
  }, LIVE_TIMEOUT_MS);

  it("an authenticated state-changing route accepts exact same-origin CSRF (refusal payload passes auth+CSRF and fails validation) and refuses cross-origin / missing Origin", async () => {
    const sameOrigin = await call("/api/pcb-sync", { method: "POST", headers: { ...SEL(), "content-type": "application/json", origin: BASE }, body: "{}", jar });
    expect([401, 403]).not.toContain(sameOrigin.res.status);
    expect(sameOrigin.res.status).toBeGreaterThanOrEqual(400);
    const cross = await call("/api/pcb-sync", { method: "POST", headers: { ...SEL(), "content-type": "application/json", origin: "https://evil.example" }, body: "{}", jar });
    expect(cross.res.status).toBe(403);
    const missing = await call("/api/pcb-sync", { method: "POST", headers: { ...SEL(), "content-type": "application/json" }, body: "{}", jar });
    expect(missing.res.status).toBe(403);
    expect(missing.json?.code).toBe("AUTH_ORIGIN_MISSING");
  }, LIVE_TIMEOUT_MS);

  it("wrong-password and unknown-account sign-ins are byte-equivalent 401s (no enumeration)", async () => {
    const wrong = await call("/api/auth/signin", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: EMAIL, password: `${PASSWORD}-wrong` }) });
    const unknown = await call("/api/auth/signin", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: `sirkit-auth-qualification-unknown-${Date.now()}@example.invalid`, password: "sirkit-auth-qualification-wrong" }) });
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(wrong.text).toBe(unknown.text);
    expect(wrong.res.headers.get("set-cookie")).toBeNull();
    expect(unknown.res.headers.get("set-cookie")).toBeNull();
  }, LIVE_TIMEOUT_MS);

  it("a malformed callback code fails with the safe same-origin redirect and writes no cookie", async () => {
    const cb = await call("/api/auth/callback?code=sirkit-auth-qualification-bogus&next=//evil.example/steal");
    expect(cb.res.status).toBe(303);
    const location = new URL(cb.res.headers.get("location")!);
    expect(location.origin).toBe(new URL(BASE).origin);
    expect(location.pathname).toBe("/signin");
    expect(location.search).toBe("?error=auth");
    expect(cb.res.headers.get("set-cookie")).toBeNull();
  }, LIVE_TIMEOUT_MS);

  it("proxy refresh: a fresh session is not rotated; any rotation carries the same family and flags", async () => {
    const home = await call("/", { jar });
    expect(home.res.status).toBe(200);
    const rotated = jar.absorb(home.res);
    for (const c of rotated) {
      expect(isFamily(c.name)).toBe(true);
      expect(c.attrs.httponly).toBe(true);
    }
  }, LIVE_TIMEOUT_MS);

  it("membership canary (isolated DB only): active → revoked takes effect on the immediately following request", async () => {
    if (!DB_URL) { expect(DB_URL).toBe(""); return; } // documented as BLOCKED when absent
    const postgres = (await import("postgres")).default;
    const sql = postgres(DB_URL, { max: 1, prepare: false, ssl: databaseTls(DB_URL), /* [B24-A4] D24-3, OD-192 */ connect_timeout: 15, onnotice: () => {} });
    canary.sql = sql as unknown as typeof canary.sql;
    const users = await sql.unsafe(`SELECT id::text AS id FROM auth.users WHERE email = $1 LIMIT 1`, [EMAIL]) as unknown as Array<{ id: string }>;
    expect(users.length).toBe(1);
    canary.userId = users[0]!.id;
    await sql.unsafe(
      `INSERT INTO project_members (membership_id, tenant_id, project_id, user_id, role, state, version, created_at, updated_at, audit_actor_id) VALUES ($1, $2, $3, $4, 'viewer', 'active', 1, now(), now(), 'sirkit-auth-qualification')`,
      [`sirkit-auth-qualification-canary-${canary.projectId}`, TENANT_ID, canary.projectId, canary.userId],
    );
    canary.inserted = true;
    const sel = { ...SEL(), "x-sirkit-project-id": canary.projectId };
    const active = await call("/api/pcb-sync", { headers: sel, jar });
    expect(active.res.status).toBe(200);
    await sql.unsafe(`UPDATE project_members SET state = 'revoked', version = version + 1, updated_at = now() WHERE project_id = $1 AND user_id = $2`, [canary.projectId, canary.userId]);
    const revoked = await call("/api/pcb-sync", { headers: sel, jar });
    expect(revoked.res.status).toBe(403);
    expect(revoked.json?.code).toBe("AUTH_NO_ACTIVE_MEMBERSHIP");
  }, LIVE_TIMEOUT_MS);

  it("sign-out retires the local family (Max-Age=0), the server confirms revocation, the retired jar is 401, and a REPLAYED pre-signout jar is 401 (liveness)", async () => {
    preSignoutJar = jar.clone();
    const signout = await call("/api/auth/signout", { method: "POST", headers: { origin: BASE }, jar });
    expect(signout.res.status).toBe(200);
    expect(signout.json).toEqual({ ok: true, signedOut: true, remoteRevocation: "confirmed" });
    const retired = jar.absorb(signout.res);
    expect(retired.length).toBeGreaterThan(0);
    for (const c of retired) { expect(isFamily(c.name)).toBe(true); expect(c.attrs["max-age"]).toBe("0"); }
    expect(jar.cookies.size).toBe(0);
    const after = await call("/api/pcb-sync", { headers: SEL(), jar });
    expect(after.res.status).toBe(401);
    const replay = await call("/api/pcb-sync", { headers: SEL(), jar: preSignoutJar });
    expect(replay.res.status).toBe(401); // a still-unexpired token from a revoked session is refused: session liveness, not token validity
  }, LIVE_TIMEOUT_MS);
});
