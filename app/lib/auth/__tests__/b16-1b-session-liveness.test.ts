/**
 * B16.1B §E/§G — the provider-neutral session-liveness boundary, the bounded
 * SDK fetch, and the Supabase adapter composition — all with FAKE verifiers /
 * a FAKE `@supabase/ssr` module. No network, no live project, no secret.
 *
 * Pins the closure of the reproduced R8 fail-open (a cryptographically valid
 * token from a remotely revoked session was accepted by the claims-only
 * path): revoked, mismatch, timeout, late resolution, late rejection, abort,
 * unavailable, and EXACTLY-ONCE behaviour of the verification sequence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeSsr = vi.hoisted(() => ({
  creates: [] as Array<{ url: string; key: string; opts: Record<string, unknown> }>,
  getClaims: vi.fn(),
  getUser: vi.fn(),
  order: [] as string[],
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, opts: Record<string, unknown>) => {
    fakeSsr.creates.push({ url, key, opts });
    return {
      auth: {
        getClaims: async () => { fakeSsr.order.push("getClaims"); return fakeSsr.getClaims(); },
        getUser: async () => { fakeSsr.order.push("getUser"); return fakeSsr.getUser(); },
      },
    };
  },
}));

import { confirmSessionLiveness, type SessionLivenessOutcome, type SessionLivenessVerifier } from "../session-liveness";
import { createBoundedFetch, VERIFICATION_DEADLINE_SENTINEL_CODE, SESSION_VERIFICATION_DEADLINE_MS } from "../bounded-fetch";
import { SupabaseIdentityProvider, createSupabaseSessionVerifiers, createSupabaseClaimsVerifier, type SupabaseVerifiedClaims } from "../identity-provider";
import { resolveIdentityProvider } from "../identity-runtime";
import { resolveTrustedRequestContext } from "../trusted-request-context";
import { injectMembership, resetInjectedIdentity } from "../test-support";
import { setIdentityProviderFactory } from "../identity-runtime";

const USER = "user-sirkit-qual-0001";
const now = () => Math.floor(Date.now() / 1000);
const CLAIMS: SupabaseVerifiedClaims = { sub: USER, exp: now() + 3600, aal: "aal1", session_id: "sess-0001", aud: "authenticated" };
const ENV = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://sirkitqualification.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_SIRKIT_QUAL_SENTINEL_000000" } as const;
const req = (headers: Record<string, string> = {}) => new Request("https://sirkit.example/api/pcb-sync", { headers });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function verifier(impl: (request: Request, expected: string, signal: AbortSignal) => Promise<SessionLivenessOutcome> | SessionLivenessOutcome): SessionLivenessVerifier & { calls: number } {
  const v = { calls: 0, async confirm(request: Request, expected: string, signal: AbortSignal) { v.calls += 1; return impl(request, expected, signal); } };
  return v;
}

beforeEach(() => {
  fakeSsr.creates = []; fakeSsr.order = [];
  fakeSsr.getClaims.mockReset().mockResolvedValue({ data: { claims: CLAIMS }, error: null });
  fakeSsr.getUser.mockReset().mockResolvedValue({ data: { user: { id: USER } }, error: null });
});
afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); });

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §E — confirmSessionLiveness settles ONCE, bounded, abort-safe", () => {
  it("live → {live, userId}; revoked → refusal; the verifier runs exactly once", async () => {
    const live = verifier(async () => ({ live: true, userId: USER }));
    expect(await confirmSessionLiveness(live, req(), USER)).toEqual({ live: true, userId: USER });
    expect(live.calls).toBe(1);
    const revoked = verifier(async () => ({ live: false, reason: "revoked" }));
    expect(await confirmSessionLiveness(revoked, req(), USER)).toEqual({ live: false, reason: "revoked" });
  });

  it("timeout: a verifier that never settles yields 'timeout' at the deadline and aborts the verifier's signal", async () => {
    let seen: AbortSignal | null = null;
    const hanging = verifier((_r, _e, signal) => { seen = signal; return new Promise(() => { /* never */ }); });
    const t0 = Date.now();
    const outcome = await confirmSessionLiveness(hanging, req(), USER, { deadlineMs: 40 });
    expect(outcome).toEqual({ live: false, reason: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect((seen as unknown as AbortSignal).aborted).toBe(true);
  });

  it("late RESOLUTION after the deadline is ignored (the timeout outcome stands; no second settlement)", async () => {
    let release: (o: SessionLivenessOutcome) => void = () => {};
    const late = verifier(() => new Promise<SessionLivenessOutcome>((resolve) => { release = resolve; }));
    const outcome = await confirmSessionLiveness(late, req(), USER, { deadlineMs: 30 });
    expect(outcome).toEqual({ live: false, reason: "timeout" });
    release({ live: true, userId: USER });
    await sleep(20);
    expect(outcome).toEqual({ live: false, reason: "timeout" }); // immutable, settled once
  });

  it("late REJECTION after the deadline is swallowed (never an unhandled rejection)", async () => {
    let reject: (e: unknown) => void = () => {};
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const late = verifier(() => new Promise<SessionLivenessOutcome>((_resolve, rej) => { reject = rej; }));
      const outcome = await confirmSessionLiveness(late, req(), USER, { deadlineMs: 30 });
      expect(outcome).toEqual({ live: false, reason: "timeout" });
      reject(new Error("late boom"));
      await sleep(30);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("synchronous throw, rejection, and a malformed outcome all settle as 'error'", async () => {
    expect(await confirmSessionLiveness(verifier(() => { throw new Error("sync"); }), req(), USER)).toEqual({ live: false, reason: "error" });
    expect(await confirmSessionLiveness(verifier(async () => { throw new Error("async"); }), req(), USER)).toEqual({ live: false, reason: "error" });
    expect(await confirmSessionLiveness(verifier(async () => ({ live: true, userId: "" }) as SessionLivenessOutcome), req(), USER)).toEqual({ live: false, reason: "error" });
    expect(await confirmSessionLiveness(verifier(async () => (null as unknown as SessionLivenessOutcome)), req(), USER)).toEqual({ live: false, reason: "error" });
  });

  it("parent abort: already-aborted → 'aborted' without calling the verifier; aborting mid-flight → 'aborted'", async () => {
    const pre = new AbortController(); pre.abort();
    const v = verifier(async () => ({ live: true, userId: USER }));
    expect(await confirmSessionLiveness(v, req(), USER, { parent: pre.signal })).toEqual({ live: false, reason: "aborted" });
    expect(v.calls).toBe(0);
    const mid = new AbortController();
    const hanging = verifier(() => new Promise(() => { /* never */ }));
    const pending = confirmSessionLiveness(hanging, req(), USER, { parent: mid.signal, deadlineMs: 5_000 });
    setTimeout(() => mid.abort(), 10);
    expect(await pending).toEqual({ live: false, reason: "aborted" });
  });

  it("the default deadline is the shared verification budget (bounded, finite)", () => {
    expect(SESSION_VERIFICATION_DEADLINE_MS).toBeGreaterThan(0);
    expect(SESSION_VERIFICATION_DEADLINE_MS).toBeLessThanOrEqual(10_000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §E — SupabaseIdentityProvider enforces liveness AFTER signed claims", () => {
  function provider(claims: SupabaseVerifiedClaims | null, liveness: SessionLivenessVerifier, deadlineMs?: number) {
    const claimsVerifier = vi.fn(async () => claims);
    return { provider: new SupabaseIdentityProvider(claimsVerifier, { verifier: liveness, deadlineMs }), claimsVerifier };
  }

  it("valid claims + live session with the SAME id → principal; exactly one claims call and one liveness call", async () => {
    const live = verifier(async () => ({ live: true, userId: USER }));
    const { provider: p, claimsVerifier } = provider(CLAIMS, live);
    const principal = await p.verify(req());
    expect(principal).toMatchObject({ userId: USER, sessionId: "sess-0001", authMethod: "supabase_cookie", authStrength: "aal1" });
    expect(claimsVerifier).toHaveBeenCalledTimes(1);
    expect(live.calls).toBe(1);
  });

  it("remote revocation → null (uniform 401 upstream)", async () => {
    const { provider: p } = provider(CLAIMS, verifier(async () => ({ live: false, reason: "revoked" })));
    expect(await p.verify(req())).toBeNull();
  });

  it("claims/liveness ID MISMATCH → null even though the session is live", async () => {
    const { provider: p } = provider(CLAIMS, verifier(async () => ({ live: true, userId: "someone-else" })));
    expect(await p.verify(req())).toBeNull();
  });

  it("timeout / error / unavailable → null", async () => {
    for (const v of [
      verifier(() => new Promise<SessionLivenessOutcome>(() => { /* hang */ })),
      verifier(async () => { throw new Error("sdk"); }),
      verifier(async () => ({ live: false, reason: "unavailable" })),
    ]) {
      const { provider: p } = provider(CLAIMS, v, 30);
      expect(await p.verify(req())).toBeNull();
      expect(v.calls).toBe(1);
    }
  });

  it("expired or malformed claims are refused BEFORE liveness (zero liveness calls)", async () => {
    const live = verifier(async () => ({ live: true, userId: USER }));
    for (const claims of [null, { ...CLAIMS, exp: now() - 1 }, { ...CLAIMS, sub: "" }, { sub: 42 } as unknown as SupabaseVerifiedClaims]) {
      const { provider: p } = provider(claims, live);
      expect(await p.verify(req())).toBeNull();
    }
    expect(live.calls).toBe(0);
  });

  it("a claims verifier that throws fails closed with zero liveness calls", async () => {
    const live = verifier(async () => ({ live: true, userId: USER }));
    const p = new SupabaseIdentityProvider(async () => { throw new Error("network"); }, { verifier: live });
    expect(await p.verify(req())).toBeNull();
    expect(live.calls).toBe(0);
  });

  it("the caller's request abort is propagated: an aborted request settles as refused", async () => {
    const controller = new AbortController();
    const request = new Request("https://sirkit.example/api/pcb-sync", { signal: controller.signal });
    const hanging = verifier(() => new Promise<SessionLivenessOutcome>(() => { /* hang */ }));
    const { provider: p } = provider(CLAIMS, hanging, 5_000);
    const pending = p.verify(request);
    setTimeout(() => controller.abort(), 10);
    expect(await pending).toBeNull();
  });

  it("without a liveness policy the adapter is claims-only (kept for explicit composition; production always composes liveness)", async () => {
    const p = new SupabaseIdentityProvider(async () => CLAIMS);
    expect((await p.verify(req()))?.userId).toBe(USER);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §E — createSupabaseSessionVerifiers: ONE bounded client per request (fake SDK)", () => {
  it("claims then liveness on the SAME client, in order, exactly once each; cookies come from the Cookie header; setAll is a no-op", async () => {
    const verifiers = createSupabaseSessionVerifiers(ENV);
    const request = req({ cookie: "sb-sirkitqualification-auth-token=base64-abc; other=1" });
    const claims = await verifiers.verifyClaims(request);
    expect(claims).toEqual(CLAIMS);
    const outcome = await verifiers.liveness.confirm(request, USER, new AbortController().signal);
    expect(outcome).toEqual({ live: true, userId: USER });
    expect(fakeSsr.creates).toHaveLength(1); // ONE client for both steps
    expect(fakeSsr.order).toEqual(["getClaims", "getUser"]);
    const opts = fakeSsr.creates[0]!.opts as { cookies: { getAll: () => Array<{ name: string; value: string }>; setAll: (c: unknown[]) => void }; global?: { fetch?: unknown } };
    expect(opts.cookies.getAll()).toEqual([{ name: "sb-sirkitqualification-auth-token", value: "base64-abc" }, { name: "other", value: "1" }]);
    expect(typeof opts.global?.fetch).toBe("function"); // the bounded fetch
    expect(() => opts.cookies.setAll([{ name: "x", value: "y", options: {} }])).not.toThrow();
  });

  it("a DIFFERENT request gets a different client (no cross-request sharing)", async () => {
    const verifiers = createSupabaseSessionVerifiers(ENV);
    await verifiers.verifyClaims(req({ cookie: "a=1" }));
    await verifiers.verifyClaims(req({ cookie: "a=2" }));
    expect(fakeSsr.creates).toHaveLength(2);
  });

  it("getUser error → revoked; different id → mismatch; getUser throws → error; missing user → revoked", async () => {
    const verifiers = createSupabaseSessionVerifiers(ENV);
    fakeSsr.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "session_not_found", status: 403 } });
    expect(await verifiers.liveness.confirm(req(), USER, new AbortController().signal)).toEqual({ live: false, reason: "revoked" });
    fakeSsr.getUser.mockResolvedValueOnce({ data: { user: { id: "other" } }, error: null });
    expect(await verifiers.liveness.confirm(req(), USER, new AbortController().signal)).toEqual({ live: false, reason: "mismatch" });
    fakeSsr.getUser.mockRejectedValueOnce(new Error("boom"));
    expect(await verifiers.liveness.confirm(req(), USER, new AbortController().signal)).toEqual({ live: false, reason: "error" });
    fakeSsr.getUser.mockResolvedValueOnce({ data: { user: undefined }, error: null });
    expect(await verifiers.liveness.confirm(req(), USER, new AbortController().signal)).toEqual({ live: false, reason: "revoked" });
  });

  it("unconfigured environment → claims null and liveness 'unavailable' with ZERO SDK clients", async () => {
    const verifiers = createSupabaseSessionVerifiers({ NODE_ENV: "production" });
    expect(await verifiers.verifyClaims(req())).toBeNull();
    expect(await verifiers.liveness.confirm(req(), USER, new AbortController().signal)).toEqual({ live: false, reason: "unavailable" });
    expect(fakeSsr.creates).toEqual([]);
    expect(await createSupabaseClaimsVerifier({})(req())).toBeNull();
  });

  it("the boundary's abort signal aborts the per-request bounded fetch (settles as timeout, not as a false 'revoked')", async () => {
    const verifiers = createSupabaseSessionVerifiers(ENV);
    const boundary = new AbortController();
    fakeSsr.getUser.mockImplementationOnce(async () => { boundary.abort(); return { data: { user: null }, error: { message: "aborted" } }; });
    expect(await verifiers.liveness.confirm(req(), USER, boundary.signal)).toEqual({ live: false, reason: "timeout" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §E — the runtime factory composes claims + liveness in production", () => {
  it("resolveIdentityProvider() in a production runtime verifies with getClaims AND getUser exactly once each; revoked → null", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    const p = resolveIdentityProvider();
    expect(p).toBeInstanceOf(SupabaseIdentityProvider);
    const principal = await p!.verify(req({ cookie: "sb-sirkitqualification-auth-token=x" }));
    expect(principal?.userId).toBe(USER);
    expect(fakeSsr.order).toEqual(["getClaims", "getUser"]);
    fakeSsr.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "session_not_found" } });
    expect(await resolveIdentityProvider()!.verify(req({ cookie: "sb-sirkitqualification-auth-token=x" }))).toBeNull();
  });

  it("end to end through the resolver: a revoked remote session is 401; a live one resolves the membership role", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    injectMembership([{ projectId: "p1", userId: USER, role: "editor" }]);
    setIdentityProviderFactory(() => resolveIdentityProviderForTest());
    const headers = { "x-sirkit-project-id": "p1", cookie: "sb-sirkitqualification-auth-token=x" };
    const ok = await resolveTrustedRequestContext(req(headers), { environment: { ...ENV } });
    expect(ok.ok && ok.context.actor).toMatchObject({ actorId: USER, role: "pcb_editor", actorKind: "human" });
    fakeSsr.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "session_not_found" } });
    const revoked = await resolveTrustedRequestContext(req(headers), { environment: { ...ENV } });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      expect(revoked.refusal.response.status).toBe(401);
      expect(await revoked.refusal.response.json()).toEqual({ ok: false, code: "AUTH_UNAUTHENTICATED", error: "Missing, expired, or invalid authentication." });
    }
  });
});

function resolveIdentityProviderForTest() {
  const verifiers = createSupabaseSessionVerifiers({ ...ENV });
  return new SupabaseIdentityProvider(verifiers.verifyClaims, { verifier: verifiers.liveness });
}

// ═════════════════════════════════════════════════════════════════════════════
describe("B16.1B §E — createBoundedFetch", () => {
  it("passes an AbortSignal to the base fetch; at the deadline it aborts and answers the SDK with a NON-RETRYABLE sentinel", async () => {
    const seen: AbortSignal[] = [];
    const base: typeof fetch = async (_input, init) => {
      seen.push(init!.signal!);
      return new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); });
    };
    const bounded = createBoundedFetch({ deadlineMs: 30, baseFetch: base });
    const response = await bounded.fetch("https://sirkitqualification.supabase.co/auth/v1/user");
    expect(seen[0]!.aborted).toBe(true);
    expect(response.status).toBe(400);
    expect([500, 501, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530]).not.toContain(response.status);
    const body = await response.json() as { error_code: string; msg: string };
    expect(body.error_code).toBe(VERIFICATION_DEADLINE_SENTINEL_CODE);
    expect(JSON.stringify(body)).not.toMatch(/token|cookie|sb_publishable|Bearer/i);
    // after the deadline, further calls never reach the base fetch
    const again = await bounded.fetch("https://sirkitqualification.supabase.co/auth/v1/.well-known/jwks.json");
    expect(again.status).toBe(400);
    expect(seen).toHaveLength(1);
    bounded.dispose();
  });

  it("parent abort settles the same way; dispose() releases the timer without aborting; transport errors propagate unchanged", async () => {
    const parent = new AbortController();
    const base: typeof fetch = async (_input, init) => new Promise<Response>((_r, reject) => { init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); });
    const bounded = createBoundedFetch({ deadlineMs: 5_000, parent: parent.signal, baseFetch: base });
    const pending = bounded.fetch("https://x.invalid/");
    parent.abort();
    expect((await pending).status).toBe(400);
    bounded.dispose();
    const disposed = createBoundedFetch({ deadlineMs: 20, baseFetch: async () => new Response("ok") });
    disposed.dispose();
    await sleep(40);
    expect(disposed.signal.aborted).toBe(false);
    const failing = createBoundedFetch({ deadlineMs: 5_000, baseFetch: async () => { throw new TypeError("fetch failed"); } });
    await expect(failing.fetch("https://x.invalid/")).rejects.toThrow("fetch failed");
    failing.dispose();
  });
});
