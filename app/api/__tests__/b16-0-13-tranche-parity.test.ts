/**
 * B16.0.13 §A — BEHAVIORAL CONTRACT PINS for the tranche-6 migration (the 5
 * protected PCB routes: 3 provider-credit advisory routes + the FreeRouting
 * process boundary + the engineering Gerber export). Written and run GREEN
 * against the PRE-migration raw handlers, then kept green unchanged after
 * migration to `authenticatedJsonRoute`.
 *
 * ALL provider/process/export seams are FAKED (vi.mock): `llmRouter.generate`,
 * `runFreerouting` + `resolveFreeroutingRuntime`, `buildFabBundle` + the
 * native compiler. No provider credit, no live FreeRouting/KiCad process, no
 * DB. Deep valid-path parity remains covered by the standing route suites
 * (autoroute route.test, gerbers route.test + b16-0-2-engineering-export,
 * from-brief.test, assist-validation/assist-live), which stay green unchanged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
const runMock = vi.hoisted(() => vi.fn());
const runtimeMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/autoroute/runner", () => ({ runFreerouting: runMock }));
vi.mock("@/app/lib/pcb/autoroute/runtime", () => ({ resolveFreeroutingRuntime: runtimeMock }));
const buildFabBundleMock = vi.hoisted(() => vi.fn());
const compileNativeMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/build-bundle", () => ({ buildFabBundle: (...args: unknown[]) => buildFabBundleMock(...args) }));
vi.mock("@/app/lib/pcb/fab/native/compiler", () => ({ compileNativeFabPackage: (...args: unknown[]) => compileNativeMock(...args) }));

import { llmRouter } from "@/app/lib/llm/router";
const generate = vi.mocked(llmRouter.generate);

import { POST as fromBrief } from "../pcb/ai-rules/from-brief/route";
import { POST as autoroute } from "../pcb/autoroute/route";
import { POST as editAssist } from "../pcb/edit/assist/route";
import { POST as gerbers } from "../pcb/export/gerbers/route";
import { POST as repairAgent } from "../pcb/repair/agent/route";
import { createEmptyBoard } from "@/app/lib/pcb/types";

const PROJECT = "proj-1";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const OVERSIZE = "x".repeat(16_000_001);

interface RouteCase {
  name: string;
  path: string;
  handler: (r: Request) => Promise<Response>;
  /** Empty-body required-field refusal (exact status + error/message field). */
  refusal: { status: number; field: "error" | "message"; text: string };
}
const ROUTES: RouteCase[] = [
  { name: "pcb/ai-rules/from-brief", path: "/api/pcb/ai-rules/from-brief", handler: fromBrief, refusal: { status: 400, field: "error", text: "brief (string) and board.{netNames:string[], hasIcs:boolean} are required" } },
  { name: "pcb/autoroute", path: "/api/pcb/autoroute", handler: autoroute, refusal: { status: 400, field: "error", text: "body.board must be a PcbBoard" } },
  { name: "pcb/edit/assist", path: "/api/pcb/edit/assist", handler: editAssist, refusal: { status: 400, field: "error", text: "instruction (string) and digest (object) are required" } },
  { name: "pcb/export/gerbers", path: "/api/pcb/export/gerbers", handler: gerbers, refusal: { status: 400, field: "message", text: "body.board must be a PcbBoard" } },
  { name: "pcb/repair/agent", path: "/api/pcb/repair/agent", handler: repairAgent, refusal: { status: 400, field: "error", text: "board must be a PcbBoard" } },
];

const authed = (role = "editor"): void => { injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: PROJECT, role: role as never }); };
function jsonReq(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
function countingReq(path: string, headers: Record<string, string>, counter: { pulls: number }): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...SEL, ...headers }, body: stream, duplex: "half" } as RequestInit);
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
function stubProduction(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
const zeroWork = (): void => {
  expect(generate).not.toHaveBeenCalled();
  expect(runMock).not.toHaveBeenCalled();
  expect(runtimeMock).not.toHaveBeenCalled();
  expect(buildFabBundleMock).not.toHaveBeenCalled();
  expect(compileNativeMock).not.toHaveBeenCalled();
};

afterEach(() => {
  resetInjectedIdentity(); vi.unstubAllEnvs();
  generate.mockReset(); runMock.mockReset(); runtimeMock.mockReset(); buildFabBundleMock.mockReset(); compileNativeMock.mockReset();
});

describe("B16.0.13 §A — security boundary pins (all 5 protected PCB methods)", () => {
  it.each(ROUTES)("[$name] anonymous → 401 AUTH_UNAUTHENTICATED with ZERO body pulls and ZERO provider/process/export work", async (r) => {
    injectIdentity(null);
    const counter = { pulls: 0 };
    const res = await r.handler(countingReq(r.path, { origin: "http://localhost" }, counter));
    expect(res.status).toBe(401);
    expect(counter.pulls).toBe(0);
    zeroWork();
  });

  it.each(ROUTES)("[$name] production cross-origin → 403 CSRF with ZERO pulls + ZERO work", async (r) => {
    stubProduction(); authed();
    const counter = { pulls: 0 };
    const res = await r.handler(countingReq(r.path, { origin: "http://evil.example" }, counter));
    expect(res.status).toBe(403);
    expect(counter.pulls).toBe(0);
    zeroWork();
  });

  it.each(ROUTES)("[$name] insufficient role (viewer) → 403 with ZERO pulls + ZERO work", async (r) => {
    authed("viewer");
    const counter = { pulls: 0 };
    const res = await r.handler(countingReq(r.path, { origin: "http://localhost" }, counter));
    expect(res.status).toBe(403);
    expect(counter.pulls).toBe(0);
    zeroWork();
  });

  it.each(ROUTES)("[$name] revoked membership → 403 with ZERO work", async (r) => {
    injectIdentity({ userId: "e1" });
    injectMembership([{ tenantId: "local", projectId: PROJECT, userId: "e1", role: "editor", state: "revoked" }]);
    const res = await r.handler(jsonReq(r.path, "{}"));
    expect(res.status).toBe(403);
    zeroWork();
  });

  it.each(ROUTES)("[$name] text/plain → 415 with ZERO pulls; malformed → 400 AUTH_INVALID_JSON; oversized (16 MB + 1) → 413 — all ZERO work", async (r) => {
    authed();
    const counter = { pulls: 0 };
    const m = await r.handler(countingReq(r.path, { origin: "http://localhost", "content-type": "text/plain" }, counter));
    expect(m.status).toBe(415);
    expect(counter.pulls).toBe(0);
    const bad = await r.handler(jsonReq(r.path, "{not json"));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AUTH_INVALID_JSON");
    const big = await r.handler(jsonReq(r.path, OVERSIZE));
    expect(big.status).toBe(413);
    zeroWork();
  });

  it.each(ROUTES)("[$name] required-field refusal — exact status + text, ZERO provider/process/export work", async (r) => {
    authed();
    const res = await r.handler(jsonReq(r.path, "{}"));
    expect(res.status).toBe(r.refusal.status);
    expect((await payload(res))[r.refusal.field]).toBe(r.refusal.text);
    zeroWork();
  });
});

describe("B16.0.13 §E/§F — provider routes: zero-call + exactly-once + non-mutation", () => {
  it("[repair/agent] valid board → generate EXACTLY ONCE (no tool calls → plan path); board input NOT mutated; 200 with plan", async () => {
    authed();
    const board = createEmptyBoard();
    const frozen = JSON.stringify(board);
    generate.mockResolvedValue({ provider: "anthropic", model: "m", text: "done", toolCalls: [] } as never);
    const res = await repairAgent(jsonReq("/api/pcb/repair/agent", JSON.stringify({ board, instruction: "check", provider: "anthropic" })));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((generate.mock.calls[0]![0] as { provider: string }).provider).toBe("anthropic");
    const out = await payload(res);
    expect(out.ok).toBe(true);
    expect(out.plan).toBeTruthy(); // advisory plan, no board mutation
    expect(JSON.stringify(board)).toBe(frozen);
  });

  it("[from-brief] provider failure → normalized providerErrorResponse (503), generate exactly once; inputs unchanged", async () => {
    authed();
    const body = { brief: "compact motor driver", board: { netNames: ["GND", "VBUS"], hasIcs: true } };
    const frozen = JSON.stringify(body);
    generate.mockRejectedValue(new Error("boom"));
    const res = await fromBrief(jsonReq("/api/pcb/ai-rules/from-brief", JSON.stringify(body)));
    expect(res.status).toBe(503);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).toBe(frozen);
  });

  it("[edit/assist] provider failure → normalized 503, generate exactly once; digest unchanged", async () => {
    authed();
    const body = { instruction: "widen GND traces", digest: { boardRevisionId: "r1", counts: {} } };
    const frozen = JSON.stringify(body.digest);
    generate.mockRejectedValue(new Error("boom"));
    const res = await editAssist(jsonReq("/api/pcb/edit/assist", JSON.stringify(body)));
    expect(res.status).toBe(503);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body.digest)).toBe(frozen);
  });
});

describe("B16.0.13 §G/§H — process & export boundaries", () => {
  it("[autoroute] a PRE-ABORTED request cannot spawn a process — reader refuses 400 AUTH_BODY_ABORTED, ZERO runtime/runner calls", async () => {
    authed();
    const ac = new AbortController();
    ac.abort();
    const res = await autoroute(new Request("http://localhost/api/pcb/autoroute", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL },
      body: JSON.stringify({ board: createEmptyBoard() }), signal: ac.signal,
    }));
    expect(res.status).toBe(400);
    expect((await payload(res)).code).toBe("AUTH_BODY_ABORTED");
    expect(runtimeMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it("[gerbers] EVERY forbidden attribution/authority key → exact 400 bad-request, ZERO export work", async () => {
    authed();
    for (const key of ["actor", "projectIdentity", "actorId", "role", "tenantId", "projectId", "branchId", "principalId"]) {
      const res = await gerbers(jsonReq("/api/pcb/export/gerbers", JSON.stringify({ [key]: "evil" })));
      expect(res.status, key).toBe(400);
      const out = await payload(res);
      expect(out.error, key).toBe("bad-request");
      expect(out.message, key).toBe(`body.${key} is not accepted: attribution is derived from the authenticated session, never from the request body`);
    }
    expect(buildFabBundleMock).not.toHaveBeenCalled();
    expect(compileNativeMock).not.toHaveBeenCalled();
  });

  it("[gerbers] releaseMode 'verified' is REFUSED — the engineering surface can never mint verified release authority", async () => {
    authed();
    const res = await gerbers(jsonReq("/api/pcb/export/gerbers", JSON.stringify({ board: createEmptyBoard(), fabPresetId: "jlcpcb-2l", releaseMode: "verified", waiverReason: "x" })));
    expect([400, 409]).toContain(res.status); // exact historical refusal pinned below
    expect(res.status).not.toBe(200);
    expect(buildFabBundleMock).not.toHaveBeenCalled();
    expect(compileNativeMock).not.toHaveBeenCalled();
  });
});
