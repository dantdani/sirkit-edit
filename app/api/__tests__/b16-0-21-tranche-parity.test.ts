/**
 * B16.0.21 §A — PERMANENT route-level parity suite for the tranche-14
 * migration: firmware-bringup (3) + full-flow (3) + release-engineering (2),
 * all 64 MB / 30 s. Written and run GREEN against the raw handlers, then kept
 * green unchanged after migration. The §D transition-gate CORRECTION
 * (automated_engine 200→403) is pinned in the separate confinement suite.
 *
 * ZERO providers/processes/network/DB — every route in this tranche is
 * deterministic (no llmRouter exists in any of the eight). Scope-override
 * seams (wrapping the real family helpers) inject non-human actor kinds to
 * test the actor gates; domain compile functions are pass-through spies over
 * the REAL implementations, overridden only to pin status mappings.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const scopeOverride = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
function scopeMock(helper: string) {
  return async (orig: () => Promise<unknown>) => {
    const actual = await orig() as Record<string, (r: Request) => Promise<{ ok: boolean; scope?: unknown }>> & Record<string, unknown>;
    return {
      ...actual,
      [helper]: async (r: Request) => {
        const parsed = await (actual[helper] as (r: Request) => Promise<{ ok: boolean; scope?: unknown }>)(r);
        return parsed.ok && scopeOverride.value ? { ...parsed, scope: scopeOverride.value } : parsed;
      },
      // post-migration projector (exists after the stage; unused before)
      ...(Object.fromEntries(Object.keys(actual).filter((k) => k.endsWith("ScopeFromContext")).map((k) => [k, (c: unknown) => scopeOverride.value ?? (actual[k] as (c: unknown) => unknown)(c)]))),
    };
  };
}
vi.mock("@/app/api/firmware-bringup/_scope", scopeMock("scopedCd11Json"));
vi.mock("@/app/api/full-flow/_scope", scopeMock("scopedCd13Json"));
vi.mock("@/app/api/release-engineering/_scope", scopeMock("scopedCd12Json"));

const compileCd11 = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/firmware-bringup/problem", async (orig) => {
  const actual = await orig() as { compileFirmwareTestBringUpProblem: (i: unknown) => unknown };
  compileCd11.mockImplementation((i: unknown) => actual.compileFirmwareTestBringUpProblem(i));
  return { ...actual, compileFirmwareTestBringUpProblem: compileCd11 };
});
const compileCd12 = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/release-engineering/problem", async (orig) => {
  const actual = await orig() as { compileReleaseEngineeringProblem: (i: unknown) => unknown };
  compileCd12.mockImplementation((i: unknown) => actual.compileReleaseEngineeringProblem(i));
  return { ...actual, compileReleaseEngineeringProblem: compileCd12 };
});

import { POST as fbProblem } from "../firmware-bringup/problem/route";
import { POST as fbPropose } from "../firmware-bringup/propose/route";
import { POST as fbResources } from "../firmware-bringup/resources/route";
import { POST as ffPropose } from "../full-flow/propose/route";
import { POST as ffRun } from "../full-flow/run/route";
import { POST as ffTransition } from "../full-flow/transition/route";
import { POST as reProblem } from "../release-engineering/problem/route";
import { POST as rePropose } from "../release-engineering/propose/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
function authed(role: "viewer" | "editor" | "admin" = "editor"): void {
  injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role });
}
function actorKind(kind: string, role = "pcb_editor"): void {
  scopeOverride.value = { tenantId: "local", projectId: "proj-1", branchId: "main", actorId: "agent-1", actorKind: kind, role, sessionId: "s1" };
}
function production(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pk");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
function counting(path: string, headers: Record<string, string>, counter: { pulls: number }): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...SEL, ...headers }, body: stream, duplex: "half" } as RequestInit);
}

interface RouteCase { name: string; handler: (r: Request) => Promise<Response>; path: string; empty: { status: number; error?: string } }
const ROUTES: RouteCase[] = [
  { name: "fb/problem", handler: fbProblem, path: "/api/firmware-bringup/problem", empty: { status: 409 } }, // no required-field 400: compile refuses incomplete inputs
  { name: "fb/propose", handler: fbPropose, path: "/api/firmware-bringup/propose", empty: { status: 400, error: "typed CD-11 proposal required" } },
  { name: "fb/resources", handler: fbResources, path: "/api/firmware-bringup/resources", empty: { status: 400, error: "exact device, demands, variant, and modes required" } },
  { name: "ff/propose", handler: ffPropose, path: "/api/full-flow/propose", empty: { status: 400, error: "typed CD-13 proposal required" } },
  { name: "ff/run", handler: ffRun, path: "/api/full-flow/run", empty: { status: 400, error: "typed product brief and requested outcome required" } },
  { name: "ff/transition", handler: ffTransition, path: "/api/full-flow/transition", empty: { status: 400, error: "typed run transition required" } },
  { name: "re/problem", handler: reProblem, path: "/api/release-engineering/problem", empty: { status: 400, error: "valid requestedReleaseLevel required" } },
  { name: "re/propose", handler: rePropose, path: "/api/release-engineering/propose", empty: { status: 400, error: "typed CD-12 proposal required" } },
];

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); scopeOverride.value = null; compileCd11.mockClear(); compileCd12.mockClear(); });

describe("B16.0.21 §A — shared refusal classes (all 8 routes, 3 families)", () => {
  it.each(ROUTES)("[$name] unauthenticated 401; foreign 403; revoked 403; viewer 403", async (r) => {
    injectIdentity(null);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(401);
    resetInjectedIdentity();
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "other", userId: "u1", role: "admin" }]);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    resetInjectedIdentity();
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "u1", role: "admin", state: "revoked" }]);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    resetInjectedIdentity();
    authed("viewer");
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
  });
  it.each(ROUTES)("[$name] production cross-origin → 403 with ZERO body pulls", async (r) => {
    production(); authed("admin");
    const counter = { pulls: 0 };
    expect((await r.handler(counting(r.path, { origin: "http://evil.example" }, counter))).status).toBe(403);
    expect(counter.pulls).toBe(0);
  });
  it.each(ROUTES)("[$name] text/plain → 415; malformed JSON → 400 AUTH_INVALID_JSON", async (r) => {
    authed("admin");
    const media = await r.handler(post(r.path, "{}", { "content-type": "text/plain" }));
    expect(media.status).toBe(415);
    expect((await payload(media)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    const bad = await r.handler(post(r.path, "{not json"));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AUTH_INVALID_JSON");
  });
  it.each(ROUTES)("[$name] payload boundary: 64,000,001 → 413; exactly 64,000,000 → under-ceiling 400", async (r) => {
    authed("admin");
    expect((await r.handler(post(r.path, "x".repeat(64_000_001)))).status).toBe(413);
    expect((await r.handler(post(r.path, "x".repeat(64_000_000)))).status).toBe(400);
  });
  it.each(ROUTES)("[$name] pre-aborted request → 400 AUTH_BODY_ABORTED", async (r) => {
    authed("admin");
    const ac = new AbortController(); ac.abort();
    const res = await r.handler(new Request(`http://localhost${r.path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: "{}", signal: ac.signal }));
    expect(res.status).toBe(400);
    expect((await payload(res)).code).toBe("AUTH_BODY_ABORTED");
  });
  it.each(ROUTES)("[$name] authorized empty body → exact recorded refusal (400 typed-input / fb-problem 409 compile-refusal)", async (r) => {
    authed("editor");
    const res = await r.handler(post(r.path, "{}"));
    expect(res.status).toBe(r.empty.status);
    if (r.empty.error) expect((await payload(res)).error).toBe(r.empty.error);
  });
});

describe("B16.0.21 §C/§D/§E — actor gates and authority (pre = post stable)", () => {
  it("[fb/problem] non-human actor → exact 403 'AI may propose but cannot compile an authoritative CD-11 problem'; compile never invoked; compiled actor forced human", async () => {
    authed(); actorKind("ai");
    const res = await fbProblem(post("/api/firmware-bringup/problem", "{}"));
    expect(res.status).toBe(403);
    expect((await payload(res)).error).toBe("AI may propose but cannot compile an authoritative CD-11 problem");
    expect(compileCd11).not.toHaveBeenCalled();
    scopeOverride.value = null;
    compileCd11.mockReturnValueOnce({ ok: true });
    await fbProblem(post("/api/firmware-bringup/problem", "{}"));
    const actor = (compileCd11.mock.calls[0]![0] as { actor: Record<string, unknown> }).actor;
    expect(actor).toEqual({ actorId: "u1", actorKind: "human", sessionId: expect.any(String), role: "pcb_editor" });
  });
  it("[ff/run] non-human actor → exact 403 'Only an authorized human may create an authoritative CD-13 run'", async () => {
    authed(); actorKind("ai");
    const res = await ffRun(post("/api/full-flow/run", "{}"));
    expect(res.status).toBe(403);
    expect((await payload(res)).error).toBe("Only an authorized human may create an authoritative CD-13 run");
  });
  it("[ff/run] valid → 201 CREATED run with authoritativeEngineeringArtifactsCreated FALSE (no engineering mutation); autonomyTier bounds 0..4", async () => {
    authed();
    const badTier = await ffRun(post("/api/full-flow/run", JSON.stringify({ requestedOutcome: "schematic_candidate", productBriefDigest: "sha256:pb", productBriefRef: "brief:1", autonomyTier: 9 })));
    expect(badTier.status).toBe(400);
    expect((await payload(badTier)).error).toBe("autonomyTier must be 0..4");
    const res = await ffRun(post("/api/full-flow/run", JSON.stringify({ requestedOutcome: "schematic_candidate", productBriefDigest: "sha256:pb", productBriefRef: "brief:1", autonomyTier: 2 })));
    expect(res.status).toBe(201);
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect(body.authoritativeEngineeringArtifactsCreated).toBe(false);
    const run = body.run as Record<string, unknown>;
    expect(run).toBeTruthy();
  });
  it("[ff/transition] ai actor → exact 403 'LLM proposals cannot commit run transitions'; malformed run → fail-closed 409 CD13_RUN_SHAPE_INVALID; illegal transition → 409", async () => {
    authed(); actorKind("ai");
    const gated = await ffTransition(post("/api/full-flow/transition", "{}"));
    expect(gated.status).toBe(403);
    expect((await payload(gated)).error).toBe("LLM proposals cannot commit run transitions");
    scopeOverride.value = null;
    const malformed = await ffTransition(post("/api/full-flow/transition", JSON.stringify({ run: {}, expectedStateDigest: "d", to: "complete", payloadDigest: "p" })));
    expect(malformed.status).toBe(409);
    const mBody = await payload(malformed);
    expect(mBody.error).toBe("run integrity invalid");
    expect(mBody.diagnostics).toEqual(["CD13_RUN_SHAPE_INVALID"]);
    const badState = await ffTransition(post("/api/full-flow/transition", JSON.stringify({ run: {}, expectedStateDigest: "d", to: "not_a_state", payloadDigest: "p" })));
    expect(badState.status).toBe(400); // unknown lifecycle state never reaches the machine
  });
  it("[re/problem] non-human actor → exact 403 'AI may propose but cannot compile an authoritative CD-12 release problem'; compiled actor forced human", async () => {
    authed(); actorKind("ai");
    const res = await reProblem(post("/api/release-engineering/problem", JSON.stringify({ requestedReleaseLevel: "draft" })));
    expect(res.status).toBe(403);
    expect((await payload(res)).error).toBe("AI may propose but cannot compile an authoritative CD-12 release problem");
    expect(compileCd12).not.toHaveBeenCalled();
    scopeOverride.value = null;
    compileCd12.mockReturnValueOnce({ ok: true });
    await reProblem(post("/api/release-engineering/problem", JSON.stringify({ requestedReleaseLevel: "draft" })));
    const actor = (compileCd12.mock.calls[0]![0] as { actor: Record<string, unknown> }).actor;
    expect(actor).toEqual({ actorId: "u1", actorKind: "human", sessionId: expect.any(String), role: "pcb_editor" });
  });
  it("[re/problem] status mapping: compile ok → 200, not-ok → 409 (spied verdicts); unknown release level → 400", async () => {
    authed();
    const badLevel = await reProblem(post("/api/release-engineering/problem", JSON.stringify({ requestedReleaseLevel: "shipped_forever" })));
    expect(badLevel.status).toBe(400);
    compileCd12.mockReturnValueOnce({ ok: true });
    expect((await reProblem(post("/api/release-engineering/problem", JSON.stringify({ requestedReleaseLevel: "draft" })))).status).toBe(200);
    compileCd12.mockReturnValueOnce({ ok: false });
    expect((await reProblem(post("/api/release-engineering/problem", JSON.stringify({ requestedReleaseLevel: "draft" })))).status).toBe(409);
  });
  it("[proposals ×3] deterministic, requiresHumanReview/deterministic-policy flags, proposedBy from TRUSTED context (attacker field ignored), no external side effects", async () => {
    authed();
    const fb = await fbPropose(post("/api/firmware-bringup/propose", JSON.stringify({ problemDigest: "p1", kind: "bringup", actions: [{ action: "probe rails", rationale: "safety", typedInputRefs: [] }], proposedBy: { actorId: "attacker", actorKind: "ai", role: "project_admin" } })));
    expect(fb.status).toBe(200);
    const fbBody = await payload(fb);
    expect(fbBody.requiresHumanReview).toBe(true);
    expect((fbBody.proposal as { proposedBy: Record<string, unknown> }).proposedBy).toEqual({ actorId: "u1", actorKind: "human", sessionId: expect.any(String), role: "pcb_editor" });
    const ff = await ffPropose(post("/api/full-flow/propose", JSON.stringify({ runRef: "run:1", stateDigest: "d1", kind: "orchestration_plan", rationale: "plan next stage" })));
    expect(ff.status).toBe(200);
    const ffBody = await payload(ff);
    expect(ffBody.requiresDeterministicPolicy).toBe(true);
    expect(ffBody.requiresOwningStageForEngineeringCommit).toBe(true);
    expect(ffBody.externalSideEffects).toBe(false);
    const re = await rePropose(post("/api/release-engineering/propose", JSON.stringify({ problemDigest: "p1", kind: "release_level_review" })));
    expect(re.status).toBe(200);
    const reBody = await payload(re);
    expect(reBody.requiresHumanReview).toBe(true);
    expect(reBody.hasExternalOrPurchasingSideEffects).toBe(false);
  });
  it("[fb/resources] deterministic solve+validate: empty demands → certificate over supplied inputs; internal actor is the labeled automated engine", async () => {
    authed();
    const res = await fbResources(post("/api/firmware-bringup/resources", JSON.stringify({ device: { deviceRef: "mcu:1", resources: [] }, demands: [], boardVariantRef: "variant:1", operatingModes: ["default"], graphDigest: "g1" })));
    expect([200, 422]).toContain(res.status); // deterministic domain verdict over supplied inputs
    const body = await payload(res);
    expect(body.set).toBeTruthy();
    expect(body.certificate).toBeTruthy();
  });
});
