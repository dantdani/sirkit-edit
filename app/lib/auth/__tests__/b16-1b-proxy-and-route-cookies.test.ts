/**
 * B16.1B §D/§E/§G — the proxy refresh helper and the three auth routes with a
 * FAKE `@supabase/ssr` client and a FAKE `next/headers` cookie store:
 * rotation lands on both the forwarded request and the response with the
 * server-owned cookie options and the SDK's anti-caching headers; every
 * writing client receives the option set and a bounded fetch; sign-out
 * reports LOCAL retirement and REMOTE revocation as two separate facts.
 * No network, no secret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  creates: [] as Array<{ url: string; key: string; opts: Record<string, unknown> }>,
  getClaims: vi.fn(),
  signIn: vi.fn(),
  exchange: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, opts: Record<string, unknown>) => {
    fake.creates.push({ url, key, opts });
    return { auth: { getClaims: fake.getClaims, signInWithPassword: fake.signIn, exchangeCodeForSession: fake.exchange, signOut: fake.signOut } };
  },
}));
const jar = vi.hoisted(() => ({ all: [] as Array<{ name: string; value: string }>, sets: [] as Array<{ name: string; value: string; options: Record<string, unknown> }> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => jar.all, set: (name: string, value: string, options: Record<string, unknown>) => { jar.sets.push({ name, value, options: { ...options } }); } }),
}));

import { NextRequest } from "next/server";
import { updateSession } from "../supabase-server";
import { sessionCookieOptions } from "../session-cookies";
import { POST as signinPost } from "@/app/api/auth/signin/route";
import { POST as signoutPost } from "@/app/api/auth/signout/route";
import { GET as callbackGet } from "@/app/api/auth/callback/route";

const SUPABASE_URL = "https://sirkitauthqualification.supabase.co";
const KEY = "sb_publishable_SIRKIT_AUTH_QUALIFICATION_SENTINEL_00000000";
const SENTINEL = "sentinel-secret-DO-NOT-LEAK-b16-1b";
type CookiesAdapter = { getAll: () => Array<{ name: string; value: string }>; setAll: (cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>, headers?: Record<string, string>) => void };
const lastOpts = () => fake.creates.at(-1)!.opts as { cookies: CookiesAdapter; cookieOptions?: Record<string, unknown>; global?: { fetch?: unknown } };
const ANTI_CACHE = { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Expires: "0", Pragma: "no-cache" };

function configured(origin = "https://sirkit.example"): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY);
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", origin);
}

beforeEach(() => {
  fake.creates = []; jar.all = []; jar.sets = [];
  fake.getClaims.mockReset().mockResolvedValue({ data: null, error: null });
  fake.signIn.mockReset().mockResolvedValue({ data: {}, error: null });
  fake.exchange.mockReset().mockResolvedValue({ data: {}, error: null });
  fake.signOut.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("B16.1B §D — proxy refresh (updateSession)", () => {
  it("rotation: cookies from setAll land on the forwarded request AND the response with the server-owned options; anti-caching headers are applied", async () => {
    configured();
    fake.getClaims.mockImplementation(async () => {
      const opts = lastOpts();
      opts.cookies.setAll([{ name: "sb-sirkitauthqualification-auth-token", value: "rotated-sentinel", options: { ...(opts.cookieOptions ?? {}), maxAge: 60 } }], ANTI_CACHE);
      return { data: { claims: { sub: "u" } }, error: null };
    });
    const request = new NextRequest("http://localhost/api/pcb-sync", { headers: { cookie: "sb-sirkitauthqualification-auth-token=old-sentinel" } });
    const response = await updateSession(request);
    expect(request.cookies.get("sb-sirkitauthqualification-auth-token")?.value).toBe("rotated-sentinel"); // downstream handlers see the fresh session
    const set = response.cookies.get("sb-sirkitauthqualification-auth-token");
    expect(set?.value).toBe("rotated-sentinel");
    expect(set).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 60 });
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(lastOpts().cookieOptions).toEqual(sessionCookieOptions());
    expect(typeof lastOpts().global?.fetch).toBe("function"); // bounded fetch
    expect(fake.creates).toHaveLength(1);
  });

  it("no rotation needed → no Set-Cookie; unconfigured → pass-through with ZERO clients; SDK failure → pass-through, never a 500, no cookie writes", async () => {
    configured();
    const quiet = await updateSession(new NextRequest("http://localhost/x"));
    expect(quiet.headers.get("set-cookie")).toBeNull();
    vi.unstubAllEnvs();
    fake.creates = [];
    const passthrough = await updateSession(new NextRequest("http://localhost/x"));
    expect(passthrough.status).toBe(200);
    expect(fake.creates).toEqual([]);
    configured();
    fake.getClaims.mockRejectedValueOnce(new Error(`boom ${SENTINEL}`));
    const failed = await updateSession(new NextRequest("http://localhost/x"));
    expect(failed.status).toBe(200);
    expect(failed.headers.get("set-cookie")).toBeNull();
    expect([...failed.headers.values()].join(" ")).not.toContain(SENTINEL);
  });
});

describe("B16.1B §D — the writing auth routes pass the server-owned cookie options and a bounded fetch", () => {
  it("sign-in: cookieOptions = sessionCookieOptions() (Secure for https, not for loopback http); global.fetch is bounded; success body is {ok:true} only", async () => {
    configured("https://sirkit.example");
    let res = await signinPost(new Request("https://sirkit.example/api/auth/signin", { method: "POST", headers: { "content-type": "application/json", origin: "https://sirkit.example" }, body: JSON.stringify({ email: "sirkit-auth-qualification-user@example.invalid", password: "sirkit-auth-qualification-pw" }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(lastOpts().cookieOptions).toEqual({ path: "/", sameSite: "lax", httpOnly: true, secure: true });
    expect(typeof lastOpts().global?.fetch).toBe("function");
    configured("http://127.0.0.1:3100");
    res = await signinPost(new Request("http://127.0.0.1:3100/api/auth/signin", { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3100" }, body: JSON.stringify({ email: "sirkit-auth-qualification-user@example.invalid", password: "sirkit-auth-qualification-pw" }) }));
    expect(res.status).toBe(200);
    expect(lastOpts().cookieOptions).toEqual({ path: "/", sameSite: "lax", httpOnly: true, secure: false });
  });

  it("callback: the exchange client carries the option set and a bounded fetch; cookie writes go through the store with those options", async () => {
    configured("https://sirkit.example");
    fake.exchange.mockImplementation(async () => {
      const opts = lastOpts();
      opts.cookies.setAll([{ name: "sb-sirkitauthqualification-auth-token", value: "exchanged-sentinel", options: { ...(opts.cookieOptions ?? {}), maxAge: 60 } }]);
      return { data: {}, error: null };
    });
    const res = await callbackGet(new Request("https://sirkit.example/api/auth/callback?code=sirkit-auth-qualification-code&next=/projects/1"));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/projects/1");
    expect(lastOpts().cookieOptions).toEqual({ path: "/", sameSite: "lax", httpOnly: true, secure: true });
    expect(typeof lastOpts().global?.fetch).toBe("function");
    expect(jar.sets).toEqual([{ name: "sb-sirkitauthqualification-auth-token", value: "exchanged-sentinel", options: { path: "/", sameSite: "lax", httpOnly: true, secure: true, maxAge: 60 } }]);
  });

  it("sign-out: LOCAL retirement and REMOTE revocation are reported separately; global scope; SDK throw → bounded 500", async () => {
    configured("https://sirkit.example");
    const post = () => signoutPost(new Request("https://sirkit.example/api/auth/signout", { method: "POST", headers: { origin: "https://sirkit.example" } }));
    fake.signOut.mockResolvedValueOnce({ error: null });
    expect(await (await post()).json()).toEqual({ ok: true, signedOut: true, remoteRevocation: "confirmed" });
    expect(fake.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(lastOpts().cookieOptions).toEqual({ path: "/", sameSite: "lax", httpOnly: true, secure: true });
    fake.signOut.mockResolvedValueOnce({ error: { name: "AuthRetryableFetchError", message: `fetch failed ${SENTINEL}`, status: 0 } });
    const unconfirmed = await post();
    const body = await unconfirmed.json() as Record<string, unknown>;
    expect(body).toEqual({ ok: true, signedOut: true, remoteRevocation: "unconfirmed" });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    fake.signOut.mockRejectedValueOnce(new Error(`boom ${SENTINEL}`));
    const failed = await post();
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain(SENTINEL);
  });
});
