/**
 * B16.1B §D/§G — session-cookie write / retirement semantics with the REAL
 * `@supabase/ssr` 0.12.4 client and a `fetch` spy (no network, no secret):
 * the server-owned option set (HttpOnly, SameSite=Lax, Path=/, Secure per the
 * server-owned expected origin) is honoured on every write, the SDK's
 * anti-caching headers accompany cookie writes, and sign-out rewrites every
 * chunk of the family with `Max-Age=0` — also when the Auth server is
 * unreachable (local retirement without remote confirmation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { sessionCookieOptions } from "../session-cookies";

const REF = "sirkitauthqualification";
const SUPABASE_URL = `https://${REF}.supabase.co`;
const KEY = "sb_publishable_SIRKIT_AUTH_QUALIFICATION_SENTINEL_00000000";
const COOKIE = `sb-${REF}-auth-token`;
const USER_ID = "7d1b2a4e-0000-4000-8000-sirkitqual01";
const REFRESH = "sirkit-auth-qualification-refresh-sentinel";
const HTTPS = { SIRKIT_EXPECTED_ORIGIN: "https://sirkit.example" };
const LOOPBACK = { SIRKIT_EXPECTED_ORIGIN: "http://127.0.0.1:3100" };

const b64url = (s: string) => Buffer.from(s).toString("base64url");
function unsignedJwt(exp = Math.floor(Date.now() / 1000) + 3600): string {
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64url(JSON.stringify({ sub: USER_ID, exp, iat: exp - 3600, aud: "authenticated", role: "authenticated", session_id: "sess-1" }));
  return `${h}.${p}.${b64url("sig")}`;
}
type Written = { name: string; value: string; options: Record<string, unknown> };
let logoutBehaviour: () => Response = () => new Response(null, { status: 204 });

beforeEach(() => {
  logoutBehaviour = () => new Response(null, { status: 204 });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: USER_ID, aud: "authenticated", role: "authenticated" }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/auth/v1/logout")) return logoutBehaviour();
    return new Response(JSON.stringify({ msg: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function client(env: Record<string, string | undefined>, jar: Array<{ name: string; value: string }>, writes: Written[], headers: Array<Record<string, string> | undefined>) {
  return createServerClient(SUPABASE_URL, KEY, {
    cookieOptions: sessionCookieOptions(env),
    cookies: {
      getAll() { return jar; },
      setAll(cookies, h) { for (const c of cookies) writes.push({ name: c.name, value: c.value, options: { ...c.options } }); headers.push(h as Record<string, string> | undefined); },
    },
  });
}

describe("B16.1B §D — sessionCookieOptions (server-owned)", () => {
  it("is always HttpOnly + SameSite=Lax + Path=/ and Secure exactly when the expected origin is https", () => {
    expect(sessionCookieOptions(HTTPS)).toEqual({ path: "/", sameSite: "lax", httpOnly: true, secure: true });
    expect(sessionCookieOptions(LOOPBACK)).toEqual({ path: "/", sameSite: "lax", httpOnly: true, secure: false });
    expect(sessionCookieOptions({})).toEqual({ path: "/", sameSite: "lax", httpOnly: true, secure: false });
    expect(sessionCookieOptions({ SIRKIT_EXPECTED_ORIGIN: "not an origin" }).secure).toBe(false);
    expect(Object.isFrozen(sessionCookieOptions(HTTPS))).toBe(true);
  });
});

describe("B16.1B §D — real @supabase/ssr honours the option set on write and retirement", () => {
  it("a session write emits the sb-<ref>-auth-token family with HttpOnly/Lax/Path=/ + Secure, the SDK max-age, and anti-caching headers", async () => {
    const writes: Written[] = []; const headers: Array<Record<string, string> | undefined> = [];
    const supabase = client(HTTPS, [], writes, headers);
    const { error } = await supabase.auth.setSession({ access_token: unsignedJwt(), refresh_token: REFRESH });
    expect(error).toBeNull();
    const family = writes.filter((w) => w.name === COOKIE || w.name.startsWith(`${COOKIE}.`));
    expect(family.length).toBeGreaterThan(0);
    for (const w of family) {
      expect(w.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 400 * 24 * 60 * 60 });
      expect(w.value.startsWith("base64-")).toBe(true);
    }
    const h = headers.find(Boolean)!;
    const cacheControl = h["Cache-Control"] ?? h["cache-control"];
    expect(cacheControl).toMatch(/no-store/);
  });

  it("a loopback http expected origin writes the family WITHOUT Secure (qualification runs over loopback http)", async () => {
    const writes: Written[] = [];
    await client(LOOPBACK, [], writes, []).auth.setSession({ access_token: unsignedJwt(), refresh_token: REFRESH });
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w.options).toMatchObject({ httpOnly: true, secure: false });
  });

  it("sign-out (server acknowledged) rewrites EVERY chunk of the family with Max-Age=0 and the same flags — local retirement", async () => {
    const writes: Written[] = [];
    await client(HTTPS, [], writes, []).auth.setSession({ access_token: unsignedJwt(), refresh_token: REFRESH });
    const jar = writes.map((w) => ({ name: w.name, value: w.value }));
    const retire: Written[] = [];
    const { error } = await client(HTTPS, jar, retire, []).auth.signOut({ scope: "global" });
    expect(error).toBeNull();
    expect(retire.map((w) => w.name).sort()).toEqual(jar.map((c) => c.name).sort());
    for (const w of retire) {
      expect(w.value).toBe("");
      expect(w.options).toMatchObject({ maxAge: 0, httpOnly: true, secure: true, path: "/", sameSite: "lax" });
    }
  });

  it("sign-out with the Auth server UNREACHABLE still retires the local family but the SDK REPORTS the error (remote revocation unconfirmed)", async () => {
    const writes: Written[] = [];
    await client(HTTPS, [], writes, []).auth.setSession({ access_token: unsignedJwt(), refresh_token: REFRESH });
    const jar = writes.map((w) => ({ name: w.name, value: w.value }));
    logoutBehaviour = () => { throw new TypeError("fetch failed"); };
    const retire: Written[] = [];
    const { error } = await client(HTTPS, jar, retire, []).auth.signOut({ scope: "global" });
    expect(error).not.toBeNull();
    expect(retire.length).toBe(jar.length);
    for (const w of retire) expect(w.options).toMatchObject({ maxAge: 0 });
  });

  it("no cookie value, token, or key ever appears in a cookie NAME or in the headers the SDK asks the app to set", async () => {
    const writes: Written[] = []; const headers: Array<Record<string, string> | undefined> = [];
    const token = unsignedJwt();
    await client(HTTPS, [], writes, headers).auth.setSession({ access_token: token, refresh_token: REFRESH });
    for (const w of writes) { expect(w.name).not.toContain(token); expect(w.name).not.toContain(KEY); expect(w.name).not.toContain(REFRESH); }
    for (const h of headers) for (const v of Object.values(h ?? {})) { expect(v).not.toContain(token); expect(v).not.toContain(REFRESH); }
  });
});
