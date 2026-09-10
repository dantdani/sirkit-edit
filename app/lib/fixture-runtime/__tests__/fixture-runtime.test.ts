/**
 * B16-C §5 — the env-gated FIXTURE RUNTIME behind the page-level browser proof.
 *
 * Truth boundary pinned here:
 *  - honoured ONLY when requested AND the runtime allows local-development
 *    identity (non-production + auth mode local_dev); a production runtime
 *    ignores the request and reports a bounded refusal;
 *  - the container is one per process (globalThis-anchored) and unreachable
 *    when the mode is off;
 *  - every production seam routes to the fixture implementation when on and
 *    to its production implementation when off (spied, never a live call);
 *  - the dev-only role cookie yields one distinct principal per role with
 *    exactly that role, and is ignored when the mode is off;
 *  - no production module imports from a `__tests__` directory.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalDevIdentityProvider } from "../../auth/identity-provider";
import { LOCAL_DEV_PRINCIPAL_ID, LocalDevProjectMembershipRepository } from "../../auth/project-membership";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { getDurableWorkflowRepository } from "../../durable-workflow/runtime";
import { fixtureContainer, resetFixtureContainer } from "../container";
import { FIXTURE_ROLE_COOKIE, FIXTURE_RUNTIME_ENV, fixturePrincipalId, fixtureRoleFromCookieHeader, fixtureRuntimeEnabled, fixtureRuntimeRefusal, fixtureRuntimeRequested } from "../mode";
import { fixtureRouterMode, fixtureRouterPath } from "../router";

afterEach(() => { vi.unstubAllEnvs(); resetFixtureContainer(); });

function on(): void { vi.stubEnv(FIXTURE_RUNTIME_ENV, "blinker"); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev"); }

describe("B16-C §5 — fixture runtime mode", () => {
  it("is off by default and off when the profile is anything but 'blinker'", () => {
    vi.stubEnv(FIXTURE_RUNTIME_ENV, "");
    expect(fixtureRuntimeRequested()).toBe(false);
    expect(fixtureRuntimeEnabled()).toBe(false);
    vi.stubEnv(FIXTURE_RUNTIME_ENV, "1");
    expect(fixtureRuntimeEnabled()).toBe(false);
    expect(fixtureRuntimeRefusal()).toBeNull();
  });

  it("is honoured only in a non-production runtime with local_dev auth; production ignores it and reports the refusal", () => {
    on();
    expect(fixtureRuntimeEnabled()).toBe(true);
    expect(fixtureRuntimeRefusal()).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(fixtureRuntimeEnabled()).toBe(false);
    expect(fixtureRuntimeRefusal()).toMatch(/^FIXTURE_RUNTIME_REFUSED: .*NODE_ENV=production/);
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    expect(fixtureRuntimeEnabled()).toBe(false);
    expect(fixtureRuntimeRefusal()).toMatch(/auth mode production/);
  });

  it("the container is one per process, anchored on globalThis, and unreachable when the mode is off", () => {
    expect(() => fixtureContainer()).toThrow("FIXTURE_RUNTIME_DISABLED");
    on();
    const first = fixtureContainer();
    expect(first.durableRepository).toBeInstanceOf(InMemoryDurableWorkflowRepository);
    expect(fixtureContainer()).toBe(first);
    expect((globalThis as Record<string, unknown>).__sirkitFixtureRuntimeContainer__).toBe(first);
    expect(first.catalog.cachedParts.size).toBeGreaterThan(0);
    resetFixtureContainer();
    expect(fixtureContainer()).not.toBe(first);
  });

  it("the durable repository seam routes to the container when on and to a fresh production adapter when off", () => {
    on();
    expect(getDurableWorkflowRepository()).toBe(fixtureContainer().durableRepository);
    vi.stubEnv(FIXTURE_RUNTIME_ENV, "");
    expect(getDurableWorkflowRepository()).not.toBeInstanceOf(InMemoryDurableWorkflowRepository);
  });

  it("the parts route serves a committed catalog part by its stable (non-UUID) id when on, and null when off — no database either way", async () => {
    const { GET } = await import("@/app/api/parts/[id]/route");
    const ctx = { params: Promise.resolve({ id: "b16-1c-part-c" }) };
    const request = () => new Request("http://localhost/api/parts/b16-1c-part-c", { method: "GET" });
    on();
    const served = (await (await GET(request(), ctx)).json()) as { ok: boolean; part: { id: string; pins: unknown[]; atomicAssignments?: unknown } | null };
    expect(served.ok).toBe(true);
    expect(served.part?.id).toBe("b16-1c-part-c"); // the browser proof found this id refused by the UUID shape check first
    expect(served.part?.pins.length).toBeGreaterThan(0);
    expect(served.part?.atomicAssignments).toBeDefined();
    const unknown = (await (await GET(new Request("http://localhost/api/parts/b16-1c-part-none", { method: "GET" }), { params: Promise.resolve({ id: "b16-1c-part-none" }) })).json()) as { ok: boolean; part: unknown };
    expect(unknown).toEqual({ ok: true, part: null });
    vi.stubEnv(FIXTURE_RUNTIME_ENV, "");
    const off = (await (await GET(request(), ctx)).json()) as { ok: boolean; part: unknown };
    expect(off).toEqual({ ok: true, part: null }); // malformed-id path, zero database work
  });

  it("the provider seam answers only the build planner; every other provider request is the bounded provider_unavailable failure (never 500, never a live SDK)", async () => {
    const { LLMRouter } = await import("../../llm/router");
    const { LLMProviderError } = await import("../../llm/errors");
    on();
    const router = new LLMRouter([]); // no provider implementation at all: a live call would throw a different error
    const base = { provider: "openai" as const, maxTokens: 16, system: "s", messages: [{ role: "user" as const, content: "x" }] };
    await expect(router.generate({ ...base, toolChoice: { name: "submit_plan" } })).resolves.toMatchObject({ model: "fixture-provider", toolCalls: [] });
    const review = router.generate({ ...base, toolChoice: { name: "report_findings" } });
    await expect(review).rejects.toBeInstanceOf(LLMProviderError);
    await expect(review).rejects.toMatchObject({ code: "provider_unavailable", reason: "missing_credentials" });
    expect(() => router.stream(base)).toThrow(LLMProviderError);
  });

  it("the frozen clock: installed only when on, idempotent, Date.now()/new Date() answer the fixed instant, explicit dates and parsing are untouched, uninstall restores", async () => {
    const { FIXTURE_CLOCK_DEFAULT, fixtureClockInstalled, fixtureClockInstant, installFixtureClock, uninstallFixtureClock } = await import("../clock");
    uninstallFixtureClock(); // an earlier container test may have installed it
    const realDate = Date;
    try {
      vi.stubEnv(FIXTURE_RUNTIME_ENV, "");
      expect(installFixtureClock()).toBeNull();
      expect(Date).toBe(realDate);
      on();
      expect(fixtureClockInstant({})).toBe(FIXTURE_CLOCK_DEFAULT);
      expect(fixtureClockInstant({ SIRKIT_FIXTURE_CLOCK: "2026-09-10T00:00:00Z" })).toBe("2026-09-10T00:00:00.000Z");
      expect(fixtureClockInstant({ SIRKIT_FIXTURE_CLOCK: "not a date" })).toBe(FIXTURE_CLOCK_DEFAULT);
      expect(installFixtureClock()).toBe(FIXTURE_CLOCK_DEFAULT);
      expect(installFixtureClock()).toBe(FIXTURE_CLOCK_DEFAULT); // idempotent
      expect(fixtureClockInstalled()).toBe(FIXTURE_CLOCK_DEFAULT);
      expect(Date.now()).toBe(realDate.parse(FIXTURE_CLOCK_DEFAULT));
      expect(new Date().toISOString()).toBe(FIXTURE_CLOCK_DEFAULT);
      expect(new Date("2020-01-02T03:04:05.000Z").toISOString()).toBe("2020-01-02T03:04:05.000Z");
      expect(new Date(0).getTime()).toBe(0);
      expect(Date.parse("2020-01-02T03:04:05.000Z")).toBe(1577934245000);
      expect(Date.UTC(2020, 0, 1)).toBe(1577836800000);
      expect(new Date() instanceof Date).toBe(true);
      expect(typeof Date()).toBe("string");
    } finally {
      uninstallFixtureClock();
    }
    expect(Date).toBe(realDate);
    expect(fixtureClockInstalled()).toBeNull();
    expect(Math.abs(Date.now() - realDate.now())).toBeLessThan(1000);
  });

  it("router mode defaults to replay with the committed e2e fixture path; record/live are explicit", () => {
    expect(fixtureRouterMode({})).toBe("replay");
    expect(fixtureRouterMode({ SIRKIT_FIXTURE_ROUTER: "record" })).toBe("record");
    expect(fixtureRouterMode({ SIRKIT_FIXTURE_ROUTER: "live" })).toBe("live");
    expect(fixtureRouterMode({ SIRKIT_FIXTURE_ROUTER: "anything" })).toBe("replay");
    expect(fixtureRouterPath({}).replace(/\\/g, "/")).toMatch(/e2e\/fixtures\/blinker-route-fixture\.json$/);
    expect(statSync(fixtureRouterPath({})).isFile()).toBe(true);
  });
});

describe("B16-C §5 — dev-only role cookie", () => {
  it("parses only the known roles and only from its own cookie", () => {
    expect(fixtureRoleFromCookieHeader(null)).toBeNull();
    expect(fixtureRoleFromCookieHeader(`${FIXTURE_ROLE_COOKIE}=reviewer`)).toBe("reviewer");
    expect(fixtureRoleFromCookieHeader(`other=1; ${FIXTURE_ROLE_COOKIE}=admin; x=y`)).toBe("admin");
    expect(fixtureRoleFromCookieHeader(`${FIXTURE_ROLE_COOKIE}=superuser`)).toBeNull();
    expect(fixtureRoleFromCookieHeader(`sirkit-role=admin`)).toBeNull();
  });

  it("yields one distinct local principal per role with exactly that role — and is ignored when the mode is off", async () => {
    on();
    const provider = new LocalDevIdentityProvider();
    const membership = new LocalDevProjectMembershipRepository();
    const request = (role: string) => new Request("http://localhost/api/x", { headers: { cookie: `${FIXTURE_ROLE_COOKIE}=${role}` } });
    const editor = await provider.verify(request("editor"));
    expect(editor?.userId).toBe(fixturePrincipalId("editor"));
    expect((await membership.loadActiveMembership({ tenantId: "t", projectId: "p", userId: editor!.userId }))?.role).toBe("editor");
    const reviewer = await provider.verify(request("reviewer"));
    expect((await membership.loadActiveMembership({ tenantId: "t", projectId: "p", userId: reviewer!.userId }))?.role).toBe("reviewer");
    expect(reviewer!.userId).not.toBe(editor!.userId);
    const plain = await provider.verify(new Request("http://localhost/api/x"));
    expect(plain?.userId).toBe(LOCAL_DEV_PRINCIPAL_ID);
    expect((await membership.loadActiveMembership({ tenantId: "t", projectId: "p", userId: LOCAL_DEV_PRINCIPAL_ID }))?.role).toBe("admin");
    // Mode off: the cookie is inert and a fixture principal has no membership at all.
    vi.stubEnv(FIXTURE_RUNTIME_ENV, "");
    expect((await provider.verify(request("admin")))?.userId).toBe(LOCAL_DEV_PRINCIPAL_ID);
    expect(await membership.loadActiveMembership({ tenantId: "t", projectId: "p", userId: fixturePrincipalId("admin") })).toBeNull();
  });
});

describe("B16-C §5 — no production module imports from a __tests__ directory", () => {
  it("scans app/ (excluding __tests__) for imports that reach into __tests__", () => {
    const root = join(process.cwd(), "app");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { if (entry !== "__tests__" && entry !== "node_modules") walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const source = readFileSync(full, "utf8");
        if (/from\s+["'][^"']*__tests__[^"']*["']/.test(source)) offenders.push(full.slice(root.length + 1));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
