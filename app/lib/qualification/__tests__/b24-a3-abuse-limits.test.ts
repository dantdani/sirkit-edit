/**
 * [B24-A3] The public abuse windows (D24-8, OD-197): per-process fixed windows on the four anonymous rows that spend or block -
 * `POST /api/parts/search`, `GET /api/pcb/footprints/search`, `POST /api/pcb/placement/preview` and `POST /api/auth/signin` -
 * enforced in `authorizeRequest`'s public branch, after the CSRF check and before the media type and the body. Each row has a global
 * window (one bucket shared by every caller) and a per-client window keyed on one IPv4 or IPv6 literal from the configured trusted
 * proxy header (`SIRKIT_TRUSTED_CLIENT_IP_HEADER`, a closed allow-list, unset by default). The per-client window is taken first, then
 * the global one; the limiter has no peek and no refund, so a per-client refusal consumes nothing globally while a global refusal has
 * already used the client's own per-client slot. A refusal is 429 `PUBLIC_RATE_LIMITED` with `Retry-After` and no-store, and pulls no
 * body byte.
 *
 * Failing first on b3b6b05: no window exists, so the request past each limit answers as the route always does (200, or 503 for an
 * unconfigured sign-in) and `app/lib/auth/abuse-limits.ts` does not exist (page section 10). The database and the embedding provider
 * are in-process fakes (the B16.0.12 tranche-parity fakes); the clock is faked per case (Date only), so each case starts in fresh
 * windows. Nothing is written to disk and nothing leaves the process.
 * [B24-A3 review, 2026-10-08] Case 2 now also pins that a refusal reads and embeds nothing (tests-04), case 6 the Retry-After values
 * (tests-03); case 9 the windows' clock under the fixture runtime's frozen clock (regressions-1), case 10 the /64 keying of an IPv6
 * client and the lockout that stands with the header set (security-2), case 11 the fail-closed enforcement site (tests-02). Cases 9
 * and 10 failed first on the reviewed tree (page section 21); cases 2, 6 and 11 were proved sensitive by mutation.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── the B16.0.12 queue-driven chainable drizzle fake (b16-0-12-tranche-parity.test.ts:16-32) and a counted embedding fake ──────────
const fakes = vi.hoisted(() => {
  /** `fallback` answers every query once the queue is empty: an exact footprint row, so the footprint search takes its exact Lib:Name
   *  path and embeds nothing - the embedding meter (240 a minute, b24-a3-embedding-admission) never answers for the windows here. */
  const state = { results: [] as unknown[][], selects: 0, embeds: 0, fallback: [] as unknown[] };
  const makeChain = (): unknown => {
    const target = (): void => {};
    const proxy: unknown = new Proxy(target, {
      get(_t, prop) {
        if (prop === "then") {
          const rows = state.results.length ? state.results.shift()! : state.fallback;
          return (resolve: (v: unknown) => void) => resolve(rows);
        }
        if (prop === "select") state.selects += 1;
        return (...args: unknown[]) => { void args; return proxy; };
      },
      apply: () => proxy,
    });
    return proxy;
  };
  return { state, makeChain };
});
vi.mock("@/app/lib/db/client", () => ({ getDb: () => fakes.makeChain() }));
vi.mock("@/app/lib/embeddings", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, embedQuery: async () => { fakes.state.embeds += 1; return new Array(1536).fill(0.1); } };
});

import { POST as signinPost } from "@/app/api/auth/signin/route";
import { POST as partsSearch } from "@/app/api/parts/search/route";
import { GET as footprintSearch } from "@/app/api/pcb/footprints/search/route";
import { POST as placementPreview } from "@/app/api/pcb/placement/preview/route";
import { createEmptyBoard } from "@/app/lib/pcb/types";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const MODULE = "app/lib/auth/abuse-limits.ts";
const HEADER_ENV = "SIRKIT_TRUSTED_CLIENT_IP_HEADER";

/** The reviewed values (OD-197 as A3 applies it; the page's table states the same): requests per 60 s. */
const SEARCH = { global: 300, perClient: 60 } as const;
const PREVIEW = { global: 10, perClient: 3 } as const;
const SIGNIN = { global: 30, perClient: 10 } as const;
const ROW_KEYS = ["POST /api/parts/search", "GET /api/pcb/footprints/search", "POST /api/pcb/placement/preview", "POST /api/auth/signin"];
/** [B24-A3 review, 2026-10-08] The environment the browser job's dev server runs (playwright.config.ts): it installs the frozen clock. */
const FIXTURE_ENV = { SIRKIT_FIXTURE_RUNTIME: "blinker", SIRKIT_AUTH_MODE: "local_dev", NODE_ENV: "development" } as const;

const BASE = Date.UTC(2026, 9, 6, 12, 0, 0);
/** Each case runs in its own ten minutes of faked time, so every window it meets is fresh. */
const startCase = (index: number): void => { vi.setSystemTime(BASE + index * 600_000); };
const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };

const EXACT_ROW = { id: "fp-1", libName: "Resistor_SMD", name: "R_0805_2012Metric", description: null, padCount: 2, attrSmd: true, attrTht: false, bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
const footprint = (headers: Record<string, string> = {}): Promise<Response> =>
  footprintSearch(new Request("http://localhost/api/pcb/footprints/search?q=Resistor_SMD:R_0805_2012Metric", { method: "GET", headers }));
const parts = (headers: Record<string, string> = {}): Promise<Response> =>
  partsSearch(new Request("http://localhost/api/parts/search", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ query: "res" }) }));
const preview = (headers: Record<string, string> = {}): Promise<Response> =>
  placementPreview(new Request("http://localhost/api/pcb/placement/preview", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ board: createEmptyBoard(), options: { candidateCount: 2, localRefinementPasses: 0 } }) }));
const signin = (headers: Record<string, string> = {}): Promise<Response> =>
  signinPost(new Request("http://localhost/api/auth/signin", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body: JSON.stringify({ email: "a@b.example", password: "x" }) }));

/** A plain-object request whose body stream counts every byte a reader demands (highWaterMark 0: it never primes itself), the
 *  b16-0-2-bounded-json pattern - undici would pull one chunk when a real Request wraps a stream. */
function countedRequest(url: string, headers: Record<string, string>, counter: { pulled: number }): Request {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      counter.pulled += 2;
      controller.enqueue(new Uint8Array([123, 125]));
      controller.close();
    },
  }, { highWaterMark: 0 });
  return { url, method: "POST", headers: new Headers({ "content-type": "application/json", ...headers }), body, signal: undefined } as unknown as Request;
}

/** Send `count` requests and return their statuses. */
async function burst(count: number, send: () => Promise<Response>): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) statuses.push((await send()).status);
  return statuses;
}

/** The 429 every refused public request answers. */
async function expectPublicRefusal(response: Response): Promise<void> {
  expect(response.status).toBe(429);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const retry = response.headers.get("Retry-After");
  expect(retry).toMatch(/^[0-9]+$/);
  expect(Number(retry)).toBeGreaterThanOrEqual(1);
  expect(Number(retry)).toBeLessThanOrEqual(60);
  const body = await response.json() as { ok?: unknown; code?: unknown };
  expect(body).toMatchObject({ ok: false, code: "PUBLIC_RATE_LIMITED" });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv(HEADER_ENV, undefined);
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", undefined);
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) vi.stubEnv(name, "");
  fakes.state.results = [];
  fakes.state.selects = 0;
  fakes.state.embeds = 0;
  fakes.state.fallback = [EXACT_ROW];
  vi.spyOn(console, "warn").mockImplementation(() => undefined); // the parts search's lexical-fallback line, once the embedding meter pauses
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("[B24-A3] the public abuse windows (D24-8, OD-197)", () => {
  it("1. the registry: frozen, keyed `<METHOD> <path>`, exactly the four anonymous rows, each a valid global and per-client FixedWindowLimit and a reason over 40 characters, at the reviewed values (each search 300 and 60 per 60 s, the preview 10 and 3, sign-in 30 and 10; 10,000 keys each); the module is Request-free, opens nothing and does not import the classification", async () => {
    const limits = await import("@/app/lib/auth/abuse-limits");
    const { validateFixedWindowLimit } = await import("@/app/lib/mcp/server/inbound-limits");
    expect(Object.isFrozen(limits.ABUSE_LIMITS)).toBe(true);
    expect(Object.keys(limits.ABUSE_LIMITS).sort()).toEqual([...ROW_KEYS].sort());
    const expected: Record<string, { global: number; perClient: number }> = {
      "POST /api/parts/search": SEARCH, "GET /api/pcb/footprints/search": SEARCH, "POST /api/pcb/placement/preview": PREVIEW, "POST /api/auth/signin": SIGNIN,
    };
    for (const [key, entry] of Object.entries(limits.ABUSE_LIMITS)) {
      expect(Object.isFrozen(entry), key).toBe(true);
      expect(validateFixedWindowLimit(entry.global), key).toEqual([]);
      expect(validateFixedWindowLimit(entry.perClient), key).toEqual([]);
      expect({ global: entry.global.limit, perClient: entry.perClient.limit }, key).toEqual(expected[key]);
      expect([entry.global.windowMs, entry.perClient.windowMs, entry.global.maxKeys, entry.perClient.maxKeys], key).toEqual([60_000, 60_000, 10_000, 10_000]);
      expect(entry.reason.length, key).toBeGreaterThan(40);
      expect(entry.slug, key).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
    expect(new Set(Object.values(limits.ABUSE_LIMITS).map((entry) => entry.slug)).size).toBe(4);
    const source = read(MODULE);
    expect(source).not.toMatch(/\bRequest\b|\bHeaders\b|\bURL\b|node:net|from "net"|route-resource-classification|\bfetch\s*\(/);
    expect([...source.matchAll(/^import [^;]* from "([^"]+)";/gm)].map((match) => match[1])).toEqual(["../mcp/server/inbound-limits"]);
    expect(limits.TRUSTED_CLIENT_IP_HEADER_ENV).toBe(HEADER_ENV);
    expect([...limits.TRUSTED_CLIENT_IP_HEADERS]).toEqual(["x-real-ip", "cf-connecting-ip", "true-client-ip", "fly-client-ip"]);
  });

  it("2. counterexample (red on b3b6b05): with the header unset, one source exhausts each window - the next request to each of the four rows is refused 429 PUBLIC_RATE_LIMITED (Retry-After whole seconds in [1, 60], no-store) before the media type and before any body byte is pulled ([B24-A3 review, 2026-10-08] tests-04: and before any database read or embedding call - the counted spies stand still across every refusal)", { timeout: 120_000 }, async () => {
    startCase(2);
    const spent = (): [number, number] => [fakes.state.selects, fakes.state.embeds];
    const footprints = await burst(SEARCH.global, () => footprint({ "x-real-ip": "203.0.113.7" }));
    expect(footprints.filter((status) => status !== 200)).toEqual([]);
    expect(fakes.state.selects).toBeGreaterThanOrEqual(SEARCH.global); // the admitted lookups did read (the spy counts)
    let before = spent();
    await expectPublicRefusal(await footprint({ "x-real-ip": "198.51.100.9" }));
    expect(spent(), "a refused footprint search reads nothing").toEqual(before);

    const searches = await burst(SEARCH.global, () => parts());
    expect(searches.filter((status) => status !== 200)).toEqual([]);
    before = spent();
    const searchCounter = { pulled: 0 };
    await expectPublicRefusal(await partsSearch(countedRequest("http://localhost/api/parts/search", {}, searchCounter)));
    expect(searchCounter.pulled).toBe(0);
    // the window runs before the media type: a text/plain request to the exhausted row is 429, not 415
    await expectPublicRefusal(await partsSearch(new Request("http://localhost/api/parts/search", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })));
    expect(spent(), "a refused parts search reads and embeds nothing").toEqual(before);

    const previews = await burst(PREVIEW.global, () => preview());
    expect(previews.filter((status) => status !== 200)).toEqual([]);
    before = spent();
    const previewCounter = { pulled: 0 };
    await expectPublicRefusal(await placementPreview(countedRequest("http://localhost/api/pcb/placement/preview", {}, previewCounter)));
    expect(previewCounter.pulled).toBe(0);

    const signins = await burst(SIGNIN.global, () => signin());
    expect(signins.filter((status) => status !== 503)).toEqual([]);
    const signinCounter = { pulled: 0 };
    await expectPublicRefusal(await signinPost(countedRequest("http://localhost/api/auth/signin", { origin: "http://localhost" }, signinCounter)));
    expect(signinCounter.pulled).toBe(0);
    expect(spent()).toEqual(before);
  });

  it("3. a keyed client (x-real-ip configured) sends perClient.limit + 50 requests: the first 60 are admitted and the rest refused per client; afterwards a second client is still admitted, and the global window holds exactly perClient.limit admissions from the first client", { timeout: 120_000 }, async () => {
    startCase(3);
    vi.stubEnv(HEADER_ENV, "x-real-ip");
    const first = await burst(SEARCH.perClient + 50, () => footprint({ "x-real-ip": "203.0.113.7" }));
    expect(first.slice(0, SEARCH.perClient).filter((status) => status !== 200)).toEqual([]);
    expect(first.slice(SEARCH.perClient)).toEqual(new Array(50).fill(429));
    expect((await footprint({ "x-real-ip": "198.51.100.9" })).status).toBe(200);
    // fresh clients, one request each, until the global window refuses: 300 - 60 - 1 admissions remain
    let admitted = 0;
    for (let index = 0; index < SEARCH.global; index += 1) {
      const response = await footprint({ "x-real-ip": `10.0.${Math.floor(index / 250)}.${(index % 250) + 1}` });
      if (response.status === 429) {
        await expectPublicRefusal(response);
        break;
      }
      expect(response.status).toBe(200);
      admitted += 1;
    }
    expect(admitted).toBe(SEARCH.global - SEARCH.perClient - 1);
  });

  it("4. `::1`, `::ffff:203.0.113.7` and a 45-character IPv6 literal are each keyed per client and admitted; a value that is not exactly one literal keys nothing (the global window alone)", { timeout: 120_000 }, async () => {
    startCase(4);
    vi.stubEnv(HEADER_ENV, "x-real-ip");
    const long = "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255";
    expect(long).toHaveLength(45);
    for (const literal of ["::1", "::ffff:203.0.113.7", long]) {
      const statuses = await burst(SEARCH.perClient + 1, () => footprint({ "x-real-ip": literal }));
      expect(statuses.slice(0, SEARCH.perClient).filter((status) => status !== 200), literal).toEqual([]);
      expect(statuses[SEARCH.perClient], literal).toBe(429);
    }
    advance(600_000);
    // an invalid literal is never a key: 61 requests carrying it are all admitted by the global window alone
    const invalid = await burst(SEARCH.perClient + 1, () => footprint({ "x-real-ip": "203.0.113.256" }));
    expect(invalid.filter((status) => status !== 200)).toEqual([]);
    const { clientIpLiteral } = await import("@/app/lib/auth/abuse-limits");
    for (const literal of ["::1", "::ffff:203.0.113.7", long, "203.0.113.7", "2001:DB8::1"]) expect(clientIpLiteral(literal), literal).toBe(literal.toLowerCase());
    for (const value of ["203.0.113.256", "::1, 10.0.0.1", "203.0.113.7, 198.51.100.9", "[::1]", "fe80::1%eth0", "1.2.3", "1:2:3:4:5:6:7:8:9", "not-an-ip", "", `${long}0`, "x".repeat(46), "1.2.3.4 5", null, undefined]) {
      expect(clientIpLiteral(value as string | null | undefined), String(value)).toBeNull();
    }
  });

  it("5. the lockout trade-off, pinned: with the header unset the sign-in window is one bucket shared by every caller - one source exhausts it (30) and a request carrying a different x-real-ip is then refused 429", { timeout: 60_000 }, async () => {
    startCase(5);
    const one = await burst(SIGNIN.global, () => signin({ "x-real-ip": "203.0.113.7" }));
    expect(one.filter((status) => status !== 503)).toEqual([]);
    await expectPublicRefusal(await signin({ "x-real-ip": "198.51.100.9" }));
  });

  it("6. the window order, per client then global: a per-client refusal consumes nothing in the global window; a global refusal has already used that client's own per-client slot", { timeout: 60_000 }, async () => {
    startCase(6);
    vi.stubEnv(HEADER_ENV, "x-real-ip");
    const a = await burst(SIGNIN.perClient + 5, () => signin({ "x-real-ip": "203.0.113.1" }));
    expect(a.slice(0, SIGNIN.perClient).filter((status) => status !== 503)).toEqual([]);
    expect(a.slice(SIGNIN.perClient)).toEqual(new Array(5).fill(429));
    advance(1_000);
    // [B24-A3 review, 2026-10-08] tests-03: Retry-After is what is left of the refusing window, whole seconds - A's per-client window and
    // the global one both opened at the case start, so one second later each answers 59 (never a constant, never capped)
    const perClientRefusal = await signin({ "x-real-ip": "203.0.113.1" });
    expect(perClientRefusal.headers.get("Retry-After")).toBe("59");
    await expectPublicRefusal(perClientRefusal);
    // the five per-client refusals took nothing globally: two more clients still get the remaining 20
    const bc = [...await burst(SIGNIN.perClient, () => signin({ "x-real-ip": "203.0.113.2" })), ...await burst(SIGNIN.perClient, () => signin({ "x-real-ip": "203.0.113.3" }))];
    expect(bc.filter((status) => status !== 503)).toEqual([]);
    // the global window is now full: client D is refused globally, which has already used one of D's own slots
    const globalRefusal = await signin({ "x-real-ip": "203.0.113.4" });
    expect(globalRefusal.headers.get("Retry-After")).toBe("59");
    await expectPublicRefusal(globalRefusal);
    advance(59_500); // past the global window (opened at the case start), inside D's (opened 1 s later)
    const d = await burst(SIGNIN.perClient, () => signin({ "x-real-ip": "203.0.113.4" }));
    expect(d.slice(0, SIGNIN.perClient - 1).filter((status) => status !== 503)).toEqual([]);
    expect(d[SIGNIN.perClient - 1]).toBe(429);
  });

  it("7. the fallback rule: only a per-client `limited` refuses; a per-client full, key_invalid, clock_invalid or misconfigured falls back to the global window alone and never answers 429 by itself; the global window refuses on any reason (fail closed)", async () => {
    const { publicWindowDecision, takePublicAbuseLimit } = await import("@/app/lib/auth/abuse-limits");
    const admitted = Object.freeze({ ok: true as const });
    const refused = (reason: "limited" | "full" | "clock_invalid" | "key_invalid" | "misconfigured") => Object.freeze({ ok: false as const, reason, retryAfterS: 7 });
    let globalTakes = 0;
    const takeGlobal = (decision: ReturnType<typeof refused> | typeof admitted) => () => { globalTakes += 1; return decision; };
    expect(publicWindowDecision(refused("limited"), takeGlobal(admitted))).toMatchObject({ ok: false, window: "per-client", retryAfterS: 7 });
    expect(globalTakes).toBe(0);
    for (const reason of ["full", "key_invalid", "clock_invalid", "misconfigured"] as const) {
      expect(publicWindowDecision(refused(reason), takeGlobal(admitted)), reason).toMatchObject({ ok: true });
      expect(publicWindowDecision(refused(reason), takeGlobal(refused("limited"))), reason).toMatchObject({ ok: false, window: "global" });
    }
    expect(publicWindowDecision(null, takeGlobal(admitted))).toMatchObject({ ok: true });
    for (const reason of ["limited", "full", "key_invalid", "clock_invalid", "misconfigured"] as const) expect(publicWindowDecision(admitted, takeGlobal(refused(reason))), reason).toMatchObject({ ok: false, window: "global" });
    // an invalid clock fails closed on the real global window; a row with no entry is not limited here
    expect(takePublicAbuseLimit("POST /api/parts/search", null, -1)).toMatchObject({ ok: false, window: "global" });
    expect(takePublicAbuseLimit("GET /api/parts/categories", "203.0.113.7", Date.now())).toBeNull();
  });

  it("8. the trusted-header rule: per-client keying only when the variable names one of four allow-listed headers (x-forwarded-for is not one); unset by default; the value keys a window only - never identity and never an origin; the CSRF check runs before the window (a cross-origin sign-in is 403 and consumes nothing)", { timeout: 60_000 }, async () => {
    const { trustedClientIpHeaderName } = await import("@/app/lib/auth/abuse-limits");
    expect(trustedClientIpHeaderName({})).toBeNull();
    for (const name of ["x-real-ip", "cf-connecting-ip", "true-client-ip", "fly-client-ip", " X-Real-IP "]) expect(trustedClientIpHeaderName({ [HEADER_ENV]: name }), name).toBe(name.trim().toLowerCase());
    for (const name of ["x-forwarded-for", "forwarded", "x-client-ip", "", " ", "x-real-ip,cf-connecting-ip"]) expect(trustedClientIpHeaderName({ [HEADER_ENV]: name }), name).toBeNull();
    startCase(8);
    vi.stubEnv(HEADER_ENV, "x-forwarded-for");
    const forwarded = await burst(SIGNIN.perClient + 1, () => signin({ "x-forwarded-for": "203.0.113.7" }));
    expect(forwarded.filter((status) => status !== 503)).toEqual([]);
    advance(600_000);
    vi.stubEnv(HEADER_ENV, undefined);
    const cross = await burst(SIGNIN.global + 10, () => signin({ origin: "http://evil.example" }));
    expect(cross.filter((status) => status !== 403)).toEqual([]);
    const same = await burst(SIGNIN.global, () => signin());
    expect(same.filter((status) => status !== 503)).toEqual([]);
    await expectPublicRefusal(await signin());
    for (const path of ["app/lib/auth/expected-origin.ts", "app/lib/auth/trusted-request-context.ts", "app/lib/auth/request-security.ts"]) expect(read(path), path).not.toContain(HEADER_ENV);
    const authorize = read("app/lib/auth/authorize.ts");
    expect(authorize.split(HEADER_ENV).length - 1).toBe(0);
    expect(authorize).toMatch(/trustedClientIpHeaderName\(/);
  });

  it("9. [B24-A3 review, 2026-10-08] regressions-1 (red on the reviewed tree): the windows read a clock the fixture runtime does not freeze - with the browser job's frozen clock installed, request 31 to sign-in is refused and, once the real clock has moved 61 s (the frozen Date.now() has not), sign-in is admitted again; unfrozenNowMs answers the real clock under the frozen one and Date.now() otherwise", { timeout: 60_000 }, async () => {
    startCase(9);
    advance(300_000); // case 8 ends on this case's start with the sign-in window exhausted: begin five minutes later
    const start = Date.now();
    const clock = await import("@/app/lib/fixture-runtime/clock");
    const unfrozen = (clock as unknown as { unfrozenNowMs?: () => number }).unfrozenNowMs;
    expect(clock.installFixtureClock({ ...FIXTURE_ENV, SIRKIT_FIXTURE_CLOCK: new Date(start).toISOString() })).not.toBeNull(); // frozen at this case's start, so no earlier window is in its future
    try {
      const frozen = Date.now();
      expect(frozen).toBe(start);
      const statuses = await burst(SIGNIN.global, () => signin());
      expect(statuses.filter((status) => status !== 503)).toEqual([]);
      await expectPublicRefusal(await signin());
      vi.setSystemTime(start + 61_000); // the faked real clock moves; the fixture runtime's frozen Date.now() does not
      expect(Date.now()).toBe(frozen);
      expect((await signin()).status, "the window rolled over on the real clock").toBe(503);
      expect(typeof unfrozen, "unfrozenNowMs is exported by app/lib/fixture-runtime/clock.ts").toBe("function");
      expect(unfrozen!()).toBe(start + 61_000);
    } finally {
      clock.uninstallFixtureClock();
    }
    expect(unfrozen!()).toBe(Date.now());
  });

  it("10. [B24-A3 review, 2026-10-08] security-2 (red on the reviewed tree): one IPv6 host rotating addresses inside its /64 shares one per-client window (an IPv6 literal is keyed by its /64 prefix, an IPv4-mapped one as its IPv4 address) and another /64 has its own; and the lockout stands with the header set - the global window is still one bucket, so three keyed clients at their per-client limit (3 x 10 = 30) refuse every other client sign-in", { timeout: 60_000 }, async () => {
    startCase(10);
    vi.stubEnv(HEADER_ENV, "x-real-ip");
    const host = await burst(SIGNIN.perClient, () => signin({ "x-real-ip": "2001:db8:0:1::a" }));
    expect(host.filter((status) => status !== 503)).toEqual([]);
    await expectPublicRefusal(await signin({ "x-real-ip": "2001:db8:0:1:ffff:ffff:ffff:b" }));
    expect((await signin({ "x-real-ip": "2001:db8:0:2::a" })).status).toBe(503);
    const v4 = await burst(SIGNIN.perClient, () => signin({ "x-real-ip": "198.51.100.20" }));
    expect(v4.filter((status) => status !== 503)).toEqual([]);
    await expectPublicRefusal(await signin({ "x-real-ip": "::ffff:198.51.100.20" }));
    const limits = await import("@/app/lib/auth/abuse-limits") as unknown as { clientWindowKeyPart?: (literal: string) => string };
    expect(typeof limits.clientWindowKeyPart, "clientWindowKeyPart is exported by abuse-limits.ts").toBe("function");
    const { ID_PATTERN } = await import("@/app/lib/auth/trusted-request-context");
    for (const [literal, part] of [["203.0.113.7", "ip-203.0.113.7"], ["::ffff:203.0.113.7", "ip-203.0.113.7"], ["::ffff:cb00:7107", "ip-203.0.113.7"], ["2001:db8:0:1::a", "ip-2001:db8:0:1::"], ["2001:0db8:0000:0001:ffff:ffff:ffff:000b", "ip-2001:db8:0:1::"], ["::1", "ip-0:0:0:0::"], ["fe80::1", "ip-fe80:0:0:0::"], ["ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255", "ip-ffff:ffff:ffff:ffff::"]] as const) {
      expect(limits.clientWindowKeyPart!(literal), literal).toBe(part);
      expect(ID_PATTERN.test(part), part).toBe(true);
    }
    advance(600_000);
    for (const client of ["203.0.113.11", "203.0.113.12", "203.0.113.13"]) expect((await burst(SIGNIN.perClient, () => signin({ "x-real-ip": client }))).filter((status) => status !== 503), client).toEqual([]);
    await expectPublicRefusal(await signin({ "x-real-ip": "203.0.113.14" }));
  });

  it("11. [B24-A3 review, 2026-10-08] tests-02: the public enforcement site fails closed on every refusal reason, not only `limited` - with an invalid clock (clock_invalid) each row answers 429 PUBLIC_RATE_LIMITED through its real wrapper, keyed or not, pulling no body byte; with a valid clock the same requests are admitted", { timeout: 60_000 }, async () => {
    vi.setSystemTime(-1);
    expect(Date.now()).toBe(-1);
    await expectPublicRefusal(await footprint());
    const counter = { pulled: 0 };
    await expectPublicRefusal(await partsSearch(countedRequest("http://localhost/api/parts/search", {}, counter)));
    expect(counter.pulled).toBe(0);
    await expectPublicRefusal(await signin());
    vi.stubEnv(HEADER_ENV, "x-real-ip");
    await expectPublicRefusal(await footprint({ "x-real-ip": "203.0.113.7" }));
    startCase(11);
    advance(300_000); // case 10 ends on this case's start with the sign-in window exhausted
    expect((await footprint({ "x-real-ip": "203.0.113.7" })).status).toBe(200);
    expect((await signin()).status).toBe(503);
  });
});
