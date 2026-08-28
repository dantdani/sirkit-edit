/**
 * B16.0.24.1 — PERMANENT security-correction suite for the three closed gaps:
 *
 *  §1 the TRULY bounded simulator raw-file read (handle-based, chunked,
 *     explicit over-limit refusal, no allocation from the declared size);
 *  §2 the LEAST-PRIVILEGE auth-runtime projection (frozen three-field object;
 *     a sentinel secret in the environment is structurally unreachable);
 *  §3 the Supabase SSR success branches, proven with FAKE @supabase/ssr
 *     clients and a fake next/headers cookie store — ZERO network calls.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── fake fs `open` (delegates to the real fs unless a fake handle is armed) ──
const fsMock = vi.hoisted(() => ({ handle: null as null | Record<string, unknown> }));
vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig() as Record<string, (...args: unknown[]) => unknown>;
  return {
    ...actual,
    open: (...args: unknown[]) => (fsMock.handle ? Promise.resolve(fsMock.handle) : (actual.open(...args) as Promise<unknown>)),
  };
});

// ── fake @supabase/ssr + next/headers (zero network, zero real cookies) ──────
const ssr = vi.hoisted(() => ({
  creates: [] as Array<{ url: string; key: string }>,
  cookiesAdapter: null as null | { getAll: () => unknown[]; setAll: (cookies: Array<{ name: string; value: string; options?: unknown }>) => void },
  exchange: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, opts: { cookies: NonNullable<typeof ssr.cookiesAdapter> }) => {
    ssr.creates.push({ url, key });
    ssr.cookiesAdapter = opts.cookies;
    return { auth: { exchangeCodeForSession: ssr.exchange, signInWithPassword: ssr.signIn, signOut: ssr.signOut } };
  },
}));
const cookieJar = vi.hoisted(() => ({ sets: [] as Array<{ name: string; value: string }>, all: [] as Array<{ name: string; value: string }> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => cookieJar.all,
    set: (name: string, value: string) => { cookieJar.sets.push({ name, value }); },
  }),
}));

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readBoundedRawFile } from "../simulate/route";
import { projectAuthRuntime } from "@/app/lib/auth/mode";
import { GET as callbackGet } from "../auth/callback/route";
import { POST as signinPost } from "../auth/signin/route";
import { POST as signoutPost } from "../auth/signout/route";

const SENTINEL = "sentinel-secret-DO-NOT-LEAK-8f3a";
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
function stubConfigured(): void {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pk-test-123");
}

afterEach(() => {
  vi.unstubAllEnvs();
  fsMock.handle = null;
  ssr.creates = [];
  ssr.cookiesAdapter = null;
  ssr.exchange.mockReset();
  ssr.signIn.mockReset();
  ssr.signOut.mockReset();
  cookieJar.sets = [];
  cookieJar.all = [];
});

// ═══ §1 — the truly bounded raw-file reader ══════════════════════════════════
describe("B16.0.24.1 §1 — bounded simulator raw-file read", () => {
  async function withTempFile(content: Buffer | string, run: (path: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "sirkit-b16-0-24-1-"));
    const path = join(dir, "result.raw");
    try {
      await writeFile(path, content);
      await run(path);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  it("a file EXACTLY at the ceiling is accepted", async () => {
    await withTempFile(Buffer.from("a".repeat(100), "utf8"), async (path) => {
      const read = await readBoundedRawFile(path, 100);
      expect(read).toEqual({ ok: true, text: "a".repeat(100) });
    });
  });
  it("ceiling + 1 is refused EXPLICITLY (over-limit) — never a truncated success", async () => {
    await withTempFile(Buffer.from("a".repeat(101), "utf8"), async (path) => {
      expect(await readBoundedRawFile(path, 100)).toEqual({ ok: false, reason: "over-limit" });
    });
  });
  it("invalid UTF-8 fails deterministically (fatal decode, never a lossy parse)", async () => {
    await withTempFile(Buffer.from([0x50, 0x6c, 0xff, 0xfe]), async (path) => {
      expect(await readBoundedRawFile(path, 100)).toEqual({ ok: false, reason: "invalid-utf8" });
    });
  });
  it("a missing file is unreadable (maps to the historical no-output-file envelope)", async () => {
    expect(await readBoundedRawFile(join(tmpdir(), "sirkit-nonexistent-8f3a", "missing.raw"), 100)).toEqual({ ok: false, reason: "unreadable" });
  });
  it("an ENORMOUS declared size refuses WITHOUT any content read and WITHOUT proportional allocation; the handle still closes", async () => {
    const read = vi.fn();
    let closes = 0;
    fsMock.handle = {
      stat: async () => ({ size: 1e15 }), // a petabyte-declared artifact
      read,
      close: async () => { closes += 1; },
    };
    expect(await readBoundedRawFile("irrelevant", 1_000)).toEqual({ ok: false, reason: "over-limit" });
    expect(read).not.toHaveBeenCalled(); // zero content reads, zero size-derived allocation
    expect(closes).toBe(1);
  });
  it("a stat/growth RACE is caught by the actual-read cap (stat small, file streams larger)", async () => {
    let offset = 0;
    let closes = 0;
    fsMock.handle = {
      stat: async () => ({ size: 10 }), // lies: claims tiny
      read: async (buffer: Buffer, bufferOffset: number, length: number) => {
        // ...but streams forever: the reader must stop at the cap regardless.
        const slice = Buffer.alloc(Math.min(length, 1024), 0x61);
        slice.copy(buffer, bufferOffset);
        offset += slice.length;
        return { bytesRead: slice.length, buffer };
      },
      close: async () => { closes += 1; },
    };
    expect(await readBoundedRawFile("irrelevant", 2_000)).toEqual({ ok: false, reason: "over-limit" });
    expect(offset).toBeLessThanOrEqual(4_096); // stopped promptly after crossing the cap
    expect(closes).toBe(1);
  });
  it("a read error settles once as unreadable; the handle still closes", async () => {
    let closes = 0;
    fsMock.handle = {
      stat: async () => ({ size: 10 }),
      read: async () => { throw new Error("EIO"); },
      close: async () => { closes += 1; },
    };
    expect(await readBoundedRawFile("irrelevant", 100)).toEqual({ ok: false, reason: "unreadable" });
    expect(closes).toBe(1);
  });
  it("a close error never masks the read outcome (settles once, ok)", async () => {
    const bytes = Buffer.from("hello", "utf8");
    let served = false;
    fsMock.handle = {
      stat: async () => ({ size: bytes.length }),
      read: async (buffer: Buffer, bufferOffset: number) => {
        if (served) return { bytesRead: 0, buffer };
        served = true;
        bytes.copy(buffer, bufferOffset);
        return { bytesRead: bytes.length, buffer };
      },
      close: async () => { throw new Error("close failed"); },
    };
    expect(await readBoundedRawFile("irrelevant", 100)).toEqual({ ok: true, text: "hello" });
  });
  it("SOURCE GATE: the simulate route never calls unbounded readFile and never slices an unbounded buffer", () => {
    const src = readFileSync(join(process.cwd(), "app", "api", "simulate", "route.ts"), "utf8");
    expect(src).not.toMatch(/\breadFile\s*\(/);
    expect(src).not.toMatch(/\.slice\(0,\s*MAX_RAW_BYTES\)/);
    expect(src).toMatch(/readBoundedRawFile\(rawPath, MAX_RAW_BYTES\)/);
    // the over-limit refusal precedes any parse call in the POST callback
    expect(src.indexOf("Simulation output exceeded the bounded size limit")).toBeLessThan(src.indexOf("parsed = parseAsciiRaw(rawText)"));
  });
});

// ═══ §2 — least-privilege auth-runtime projection ════════════════════════════
describe("B16.0.24.1 §2 — auth-runtime projection (least privilege)", () => {
  it("carries EXACTLY the three fields, frozen, with copied values only", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: " https://p.supabase.co ", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk-1", SIRKIT_SENTINEL: SENTINEL, AWS_SECRET_ACCESS_KEY: SENTINEL };
    const projection = projectAuthRuntime(env);
    expect(Object.keys(projection).sort()).toEqual(["mode", "supabaseKey", "supabaseUrl"]);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(projection).toEqual({ mode: "local_dev", supabaseUrl: "https://p.supabase.co", supabaseKey: "pk-1" });
    expect(JSON.stringify(projection)).not.toContain(SENTINEL); // unrelated entries unreachable
  });
  it("never mutates the source environment and holds no reference to it", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://p.supabase.co", SIRKIT_SENTINEL: SENTINEL };
    const snapshot = JSON.stringify(env);
    const projection = projectAuthRuntime(env);
    expect(JSON.stringify(env)).toBe(snapshot); // no mutation
    env.NEXT_PUBLIC_SUPABASE_URL = "https://changed.example"; // later mutation of the source...
    expect(projection.supabaseUrl).toBe("https://p.supabase.co"); // ...cannot reach the projection (copied values)
  });
  it("preserves the EXACT historical key selection (`??`): an explicitly-empty publishable key does NOT fall through to the anon key", () => {
    expect(projectAuthRuntime({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-1" }).supabaseKey).toBeNull();
    expect(projectAuthRuntime({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-1" }).supabaseKey).toBe("anon-1");
    expect(projectAuthRuntime({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk-1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-1" }).supabaseKey).toBe("pk-1");
    expect(projectAuthRuntime({}).supabaseKey).toBeNull();
  });
  it("SENTINEL: an unrelated environment secret reaches neither the sign-out response nor the console across every path", async () => {
    vi.stubEnv("SIRKIT_SENTINEL_DO_NOT_LEAK", SENTINEL);
    const consoleSpies = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")];
    const post = (headers: Record<string, string> = {}) =>
      signoutPost(new Request("http://localhost/api/auth/signout", { method: "POST", headers: { origin: "http://localhost", ...headers } }));
    // local_dev 200; production-unconfigured 503; production cross-origin 403.
    const localDev = await post();
    expect(JSON.stringify(await payload(localDev))).not.toContain(SENTINEL);
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
    const unconfigured = await post();
    expect(unconfigured.status).toBe(503);
    expect(JSON.stringify(await payload(unconfigured))).not.toContain(SENTINEL);
    const cross = await signoutPost(new Request("http://localhost/api/auth/signout", { method: "POST", headers: { origin: "http://evil.example" } }));
    expect(cross.status).toBe(403);
    expect(JSON.stringify(await payload(cross))).not.toContain(SENTINEL);
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(SENTINEL);
      spy.mockRestore();
    }
  });
});

// ═══ §3 — Supabase SSR boundary (fake clients, zero network) ═════════════════
describe("B16.0.24.1 §3 — auth callback PKCE exchange (fake SSR client)", () => {
  it("a successful exchange runs EXACTLY once, writes cookies through the SSR adapter, and redirects to the safe next path", async () => {
    stubConfigured();
    ssr.exchange.mockImplementation(async () => {
      ssr.cookiesAdapter!.setAll([{ name: "sb-session", value: "fake-session-cookie", options: {} }]);
      return { error: null };
    });
    const res = await callbackGet(new Request("http://localhost/api/auth/callback?code=one-time-abc&next=/projects/1"));
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(new URL(location).pathname).toBe("/projects/1");
    expect(new URL(location).host).toBe("localhost");
    expect(ssr.exchange).toHaveBeenCalledTimes(1);
    expect(ssr.exchange).toHaveBeenCalledWith("one-time-abc");
    expect(ssr.creates).toEqual([{ url: "https://project.supabase.co", key: "pk-test-123" }]);
    expect(cookieJar.sets).toEqual([{ name: "sb-session", value: "fake-session-cookie" }]); // cookie writes via the SSR adapter
    // no code, token, session, or provider diagnostic in the redirect URL
    expect(location).not.toMatch(/one-time-abc|token|session|fake-session-cookie/i);
  });
  it("a FAILED exchange redirects to /signin?error=auth without any provider diagnostic or secret", async () => {
    stubConfigured();
    vi.stubEnv("SIRKIT_SENTINEL_DO_NOT_LEAK", SENTINEL);
    ssr.exchange.mockResolvedValueOnce({ error: { message: `provider says: ${SENTINEL}` } });
    const res = await callbackGet(new Request("http://localhost/api/auth/callback?code=bad-code&next=/projects/1"));
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(new URL(location).pathname).toBe("/signin");
    expect(new URL(location).searchParams.get("error")).toBe("auth");
    expect(location).not.toContain(SENTINEL);
    expect(location).not.toContain("bad-code");
    expect(ssr.exchange).toHaveBeenCalledTimes(1);
    expect(cookieJar.sets).toEqual([]); // a failed exchange writes nothing
  });
  it("an SDK exception still yields the bounded /signin?error=auth redirect", async () => {
    stubConfigured();
    ssr.exchange.mockRejectedValueOnce(new Error("sdk exploded"));
    const res = await callbackGet(new Request("http://localhost/api/auth/callback?code=abc"));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/signin");
  });
});

describe("B16.0.24.1 §3 — sign-in credential boundary (fake SSR client)", () => {
  function signin(body: BodyInit, headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/auth/signin", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body });
  }
  it("valid credentials call signInWithPassword EXACTLY once (email trimmed); cookies are written; the body carries NO token/session/user", async () => {
    stubConfigured();
    ssr.signIn.mockImplementation(async () => {
      ssr.cookiesAdapter!.setAll([{ name: "sb-session", value: "fake-session-cookie", options: {} }]);
      return { error: null };
    });
    const res = await signinPost(signin(JSON.stringify({ email: "  a@b.c  ", password: "pw-1" })));
    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ ok: true }); // EXACTLY ok:true — nothing else
    expect(ssr.signIn).toHaveBeenCalledTimes(1);
    expect(ssr.signIn).toHaveBeenCalledWith({ email: "a@b.c", password: "pw-1" });
    expect(cookieJar.sets).toEqual([{ name: "sb-session", value: "fake-session-cookie" }]);
  });
  it("invalid credentials return the UNIFORM 401 — byte-identical for wrong-password and unknown-account (no enumeration)", async () => {
    stubConfigured();
    ssr.signIn.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    const wrongPassword = await payload(await signinPost(signin(JSON.stringify({ email: "a@b.c", password: "wrong" }))));
    ssr.signIn.mockResolvedValueOnce({ error: { message: "user not found" } });
    const unknownAccount = await payload(await signinPost(signin(JSON.stringify({ email: "nobody@b.c", password: "wrong" }))));
    expect(wrongPassword).toEqual({ ok: false, code: "AUTH_SIGNIN_FAILED", error: "Sign-in failed. Check your email and password." });
    expect(unknownAccount).toEqual(wrongPassword); // byte-identical envelopes
  });
  it("every refusal BEFORE credential validation makes ZERO SDK calls (CSRF, media, body, validation, unconfigured)", async () => {
    stubConfigured();
    await signinPost(signin(JSON.stringify({ email: "a@b.c", password: "x" }), { origin: "http://evil.example" })); // CSRF
    await signinPost(signin("{}", { "content-type": "text/plain" })); // media
    await signinPost(signin("not json")); // body
    await signinPost(signin(JSON.stringify({ email: "", password: "" }))); // validation
    vi.unstubAllEnvs();
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) vi.stubEnv(k, "");
    await signinPost(signin(JSON.stringify({ email: "a@b.c", password: "x" }))); // unconfigured 503
    expect(ssr.creates).toEqual([]);
    expect(ssr.signIn).not.toHaveBeenCalled();
  });
});

describe("B16.0.24.1 §3 — sign-out session retirement (fake SSR client)", () => {
  function signoutReq(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/auth/signout", { method: "POST", headers: { origin: "http://localhost", ...headers } });
  }
  function stubProduction(): void {
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
    stubConfigured();
  }
  it("configured production calls signOut EXACTLY once and retires the session cookies through the SSR adapter", async () => {
    stubProduction();
    ssr.signOut.mockImplementation(async () => {
      ssr.cookiesAdapter!.setAll([{ name: "sb-session", value: "", options: {} }]);
      return { error: null };
    });
    const res = await signoutPost(signoutReq());
    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ ok: true, signedOut: true });
    expect(ssr.signOut).toHaveBeenCalledTimes(1);
    expect(ssr.creates).toEqual([{ url: "https://project.supabase.co", key: "pk-test-123" }]);
    expect(cookieJar.sets).toEqual([{ name: "sb-session", value: "" }]); // retirement via the SSR adapter
  });
  it("an SDK failure remains bounded and secret-free (500 AUTH_SIGNOUT_FAILED; the SDK message never leaks)", async () => {
    stubProduction();
    ssr.signOut.mockRejectedValueOnce(new Error(`boom ${SENTINEL}`));
    const res = await signoutPost(signoutReq());
    expect(res.status).toBe(500);
    const body = await payload(res);
    expect(body).toEqual({ ok: false, code: "AUTH_SIGNOUT_FAILED", error: "Sign-out could not be completed." });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
  });
  it("CSRF / unconfigured / local_dev paths make ZERO SDK calls", async () => {
    // local_dev
    await signoutPost(signoutReq());
    // production unconfigured
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) vi.stubEnv(k, "");
    await signoutPost(signoutReq());
    // production cross-origin CSRF
    stubConfigured();
    await signoutPost(signoutReq({ origin: "http://evil.example" }));
    expect(ssr.creates).toEqual([]);
    expect(ssr.signOut).not.toHaveBeenCalled();
  });
});
