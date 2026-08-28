/**
 * B16.0.10 §A/§D/§E — BEHAVIORAL CONTRACT PINS for the tranche-3 migration
 * (the 8 core schematic AI POST routes — all authenticated JSON, 16 MB / 45 s).
 * Written and run GREEN against the PRE-migration handlers, then kept green
 * unchanged after each method moves to `authenticatedJsonRoute`.
 *
 * Pins per route: anonymous 401 with ZERO body pulls; production cross-origin
 * CSRF 403 with ZERO pulls; 415 with ZERO pulls; malformed JSON 400
 * AUTH_INVALID_JSON; oversized (16 MB + 1) 413; the route's own required-field
 * refusal (exact status + error key/string — note /api/schematic uses a bare
 * `{ error }` shape with no `ok` field). Provider-bound paths prove ZERO
 * provider/build-loop calls on every refusal and exactly-once invocation with
 * requested-provider routing on the valid path — via fake adapters (vi.mock),
 * no credits, no DB (parts-search is mocked).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/build-loop", () => ({ runBuildToolLoop: vi.fn() }));
vi.mock("@/app/lib/parts-search", () => ({
  getPartsByIds: vi.fn(async () => []),
  getFullPartsByIds: vi.fn(async () => []),
  searchParts: vi.fn(async () => []),
}));
import { llmRouter } from "@/app/lib/llm/router";
import { runBuildToolLoop } from "@/app/lib/build-loop";
import { getPartsByIds } from "@/app/lib/parts-search";
const generate = vi.mocked(llmRouter.generate);
const buildLoop = vi.mocked(runBuildToolLoop);
const partsByIds = vi.mocked(getPartsByIds);

import { POST as schematicPost } from "../schematic/route";
import { POST as buildPost } from "../schematic/build/route";
import { POST as buildMultiPost } from "../schematic/build-multi/route";
import { POST as crossVerifyPost } from "../schematic/cross-verify/route";
import { POST as editPost } from "../schematic/edit/route";
import { POST as editBuildPost } from "../schematic/edit-build/route";
import { POST as layoutCriticPost } from "../schematic/layout-critic/route";
import { POST as reviewPost } from "../schematic/review/route";

const PROJECT = "proj-1";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const OVERSIZE = "x".repeat(16_000_001); // 16 MB + 1 — over every route's ceiling

interface RouteCase {
  name: string;
  path: string;
  handler: (r: Request) => Promise<Response>;
  /** The route's own required-field refusal: body → status + error key/value. */
  refusal: { body: Record<string, unknown>; status: number; error: string; errorKey?: string };
}
const ROUTES: RouteCase[] = [
  // /api/schematic historically responds `{ error }` (no `ok` field) — pinned exactly.
  { name: "schematic", path: "/api/schematic", handler: schematicPost, refusal: { body: {}, status: 400, error: "prompt is required" } },
  { name: "schematic/build", path: "/api/schematic/build", handler: buildPost, refusal: { body: {}, status: 400, error: "prompt is required" } },
  { name: "schematic/build-multi", path: "/api/schematic/build-multi", handler: buildMultiPost, refusal: { body: {}, status: 400, error: "prompt is required" } },
  { name: "schematic/cross-verify", path: "/api/schematic/cross-verify", handler: crossVerifyPost, refusal: { body: {}, status: 400, error: "Cross-verify needs a prompt and a Build-mode schematic" } },
  { name: "schematic/edit", path: "/api/schematic/edit", handler: editPost, refusal: { body: {}, status: 400, error: "instruction is required" } },
  { name: "schematic/edit-build", path: "/api/schematic/edit-build", handler: editBuildPost, refusal: { body: {}, status: 400, error: "instruction is required" } },
  { name: "schematic/layout-critic", path: "/api/schematic/layout-critic", handler: layoutCriticPost, refusal: { body: {}, status: 400, error: "Layout critic needs a Build-mode schematic with catalog parts" } },
  { name: "schematic/review", path: "/api/schematic/review", handler: reviewPost, refusal: { body: {}, status: 400, error: "no components to review" } },
];

const authed = (): void => { injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: PROJECT, role: "editor" }); };
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
const zeroProviders = (): void => { expect(generate).not.toHaveBeenCalled(); expect(buildLoop).not.toHaveBeenCalled(); };

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); generate.mockReset(); buildLoop.mockReset(); partsByIds.mockClear(); });

describe("B16.0.10 §A — security boundary pins (all 8 schematic methods)", () => {
  it.each(ROUTES)("[$name] anonymous → 401 AUTH_UNAUTHENTICATED with ZERO body pulls and ZERO provider calls", async (route) => {
    injectIdentity(null);
    const counter = { pulls: 0 };
    const res = await route.handler(countingReq(route.path, { origin: "http://localhost" }, counter));
    expect(res.status).toBe(401);
    expect((await payload(res)).code).toBe("AUTH_UNAUTHENTICATED");
    expect(counter.pulls).toBe(0);
    zeroProviders();
  });

  it.each(ROUTES)("[$name] production cross-origin → 403 with ZERO body pulls", async (route) => {
    stubProduction();
    authed();
    const counter = { pulls: 0 };
    const res = await route.handler(countingReq(route.path, { origin: "http://evil.example" }, counter));
    expect(res.status).toBe(403);
    expect(counter.pulls).toBe(0);
    zeroProviders();
  });

  it.each(ROUTES)("[$name] text/plain → 415 AUTH_MEDIA_TYPE_UNSUPPORTED with ZERO body pulls", async (route) => {
    authed();
    const counter = { pulls: 0 };
    const res = await route.handler(countingReq(route.path, { origin: "http://localhost", "content-type": "text/plain" }, counter));
    expect(res.status).toBe(415);
    expect((await payload(res)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    expect(counter.pulls).toBe(0);
    zeroProviders();
  });

  it.each(ROUTES)("[$name] malformed JSON → 400 AUTH_INVALID_JSON", async (route) => {
    authed();
    const res = await route.handler(jsonReq(route.path, "{not json"));
    expect(res.status).toBe(400);
    expect((await payload(res)).code).toBe("AUTH_INVALID_JSON");
    zeroProviders();
  });

  it.each(ROUTES)("[$name] oversized body (16 MB + 1) → 413 AUTH_PAYLOAD_TOO_LARGE", async (route) => {
    authed();
    const res = await route.handler(jsonReq(route.path, OVERSIZE));
    expect(res.status).toBe(413);
    expect((await payload(res)).code).toBe("AUTH_PAYLOAD_TOO_LARGE");
    zeroProviders();
  });

  it.each(ROUTES)("[$name] required-field refusal — exact status + error string, ZERO provider calls", async (route) => {
    authed();
    const res = await route.handler(jsonReq(route.path, JSON.stringify(route.refusal.body)));
    expect(res.status).toBe(route.refusal.status);
    expect((await payload(res)).error).toBe(route.refusal.error);
    zeroProviders();
  });
});

describe("B16.0.10 §D/§E — per-route valid paths (fake adapters; exactly-once; parity)", () => {
  it("[schematic] valid prompt → generate ONCE (requested provider); 200 returns the RAW netlist (no ok envelope); no-tool → 500", async () => {
    authed();
    const netlist = { components: [{ refDes: "R1" }], connections: [] };
    generate.mockResolvedValue({ provider: "anthropic", model: "m", toolCalls: [{ name: "submit_schematic", input: netlist }] } as never);
    const res = await schematicPost(jsonReq("/api/schematic", JSON.stringify({ prompt: "an RC filter", provider: "anthropic" })));
    expect(generate).toHaveBeenCalledTimes(1);
    expect((generate.mock.calls[0]![0] as { provider: string }).provider).toBe("anthropic");
    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual(netlist); // historical: bare netlist body
    // no-tool → 500 { error: "no schematic returned" }
    generate.mockResolvedValue({ provider: "anthropic", model: "m", toolCalls: [] } as never);
    const res2 = await schematicPost(jsonReq("/api/schematic", JSON.stringify({ prompt: "x" })));
    expect(res2.status).toBe(500);
    expect((await payload(res2)).error).toBe("no schematic returned");
  });

  it("[schematic] provider failure → normalized providerErrorResponse (503), generate exactly once", async () => {
    authed();
    generate.mockRejectedValue(new Error("boom"));
    const res = await schematicPost(jsonReq("/api/schematic", JSON.stringify({ prompt: "x" })));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(503);
  });

  it("[schematic/build] valid prompt → runBuildToolLoop ONCE with BUILD prompt + requested provider; ok and failure shapes preserved", async () => {
    authed();
    buildLoop.mockResolvedValue({ ok: true, netlist: { components: [], connections: [], explanation: "e" }, explanation: "e" } as never);
    const res = await buildPost(jsonReq("/api/schematic/build", JSON.stringify({ prompt: "build it", provider: "anthropic" })));
    expect(buildLoop).toHaveBeenCalledTimes(1);
    const arg = buildLoop.mock.calls[0]![0] as { provider: string; userMessage: string };
    expect(arg.provider).toBe("anthropic");
    expect(arg.userMessage).toBe("build it");
    expect(res.status).toBe(200);
    expect((await payload(res)).ok).toBe(true);
    // failure pass-through: status/code/provider preserved
    buildLoop.mockResolvedValue({ ok: false, error: "quota", code: "provider_unavailable", provider: "anthropic", status: 503 } as never);
    const res2 = await buildPost(jsonReq("/api/schematic/build", JSON.stringify({ prompt: "x" })));
    expect(res2.status).toBe(503);
    expect(await payload(res2)).toEqual({ ok: false, error: "quota", code: "provider_unavailable", provider: "anthropic" });
  });

  it("[schematic/build-multi] single-block plan → planner generate ONCE + single build loop; provider routing preserved", async () => {
    authed();
    generate.mockResolvedValue({ provider: "anthropic", model: "m", toolCalls: [{ name: "submit_plan", input: { blocks: [], rationale: "simple" } }] } as never);
    buildLoop.mockResolvedValue({ ok: true, netlist: { components: [], connections: [], explanation: "e" }, explanation: "e" } as never);
    const res = await buildMultiPost(jsonReq("/api/schematic/build-multi", JSON.stringify({ prompt: "small circuit", provider: "anthropic" })));
    expect(generate).toHaveBeenCalledTimes(1); // planner only
    expect(buildLoop).toHaveBeenCalledTimes(1); // complexity gate → single loop
    expect((buildLoop.mock.calls[0]![0] as { provider: string }).provider).toBe("anthropic");
    expect(res.status).toBe(200);
    expect((await payload(res)).ok).toBe(true);
  });

  it("[schematic/cross-verify] valid body with SchGen UNCONFIGURED → 200 available:false, zero provider calls", async () => {
    authed();
    const body = { prompt: "verify", state: { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", refDes: "R1", x: 0, y: 0, rotation: 0, value: "1k" }] } };
    const res = await crossVerifyPost(jsonReq("/api/schematic/cross-verify", JSON.stringify(body)));
    expect(res.status).toBe(200);
    const out = await payload(res);
    expect(out.ok).toBe(true);
    expect(out.available).toBe(false);
    zeroProviders();
  });

  it("[schematic/edit] valid → generate ONCE (apply_edits); unknown-target ops dropped into the note; needsTopology preserved", async () => {
    authed();
    generate.mockResolvedValue({ provider: "anthropic", model: "m", toolCalls: [{ name: "apply_edits", input: { ops: [{ op: "set-value", target: "R1", value: "2k" }, { op: "delete", target: "ZZ" }], note: "n", needsTopology: false } }] } as never);
    const res = await editPost(jsonReq("/api/schematic/edit", JSON.stringify({ instruction: "set R1 to 2k", components: [{ refDes: "R1", kind: "res", value: "1k" }], provider: "anthropic" })));
    expect(generate).toHaveBeenCalledTimes(1);
    expect((generate.mock.calls[0]![0] as { provider: string }).provider).toBe("anthropic");
    expect(res.status).toBe(200);
    const out = await payload(res);
    expect(out.ok).toBe(true);
    expect(out.ops).toEqual([{ op: "set-value", target: "R1", value: "2k" }]);
    expect(out.note).toBe('n (dropped 1: unknown target "ZZ")');
    expect(out.needsTopology).toBe(false);
  });

  it("[schematic/edit-build] valid → seeds parts via getPartsByIds then runBuildToolLoop ONCE with the EDIT_BUILD prompt shape", async () => {
    authed();
    buildLoop.mockResolvedValue({ ok: true, netlist: { components: [], connections: [], explanation: "e" }, explanation: "e" } as never);
    const body = { instruction: "swap R1", netlist: { components: [{ refDes: "R1", partId: "p1" }], connections: [] }, provider: "anthropic" };
    const res = await editBuildPost(jsonReq("/api/schematic/edit-build", JSON.stringify(body)));
    expect(partsByIds).toHaveBeenCalledTimes(1);
    expect(buildLoop).toHaveBeenCalledTimes(1);
    const arg = buildLoop.mock.calls[0]![0] as { provider: string; userMessage: string; seedParts: unknown };
    expect(arg.provider).toBe("anthropic");
    expect(arg.userMessage).toContain("Instruction: swap R1");
    expect(res.status).toBe(200);
    expect((await payload(res)).ok).toBe(true);
  });

  it("[schematic/layout-critic] valid image+state, critique with no verifiable groups → 200 applied:false, original state returned; generate ONCE", async () => {
    authed();
    generate.mockResolvedValue({ provider: "anthropic", model: "m", toolCalls: [{ name: "report_layout_issues", input: { groups: [{ refDes: ["GHOST"], reason: "r", severity: "high" }], summary: "s" } }] } as never);
    const state = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", refDes: "R1", x: 0, y: 0, rotation: 0, value: "1k" }] };
    const body = { state, image: "data:image/png;base64,aGk=", provider: "anthropic" };
    const res = await layoutCriticPost(jsonReq("/api/schematic/layout-critic", JSON.stringify(body)));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const out = await payload(res);
    expect(out.ok).toBe(true);
    expect(out.applied).toBe(false); // hallucinated refDes verified away → nothing actionable
    expect(out.spreadRefDes).toEqual([]);
  });

  it("[schematic/review] valid → generate ONCE; contradicted unconnected-claims DROPPED; dropped count reported", async () => {
    authed();
    generate.mockResolvedValue({ provider: "anthropic", model: "m", toolCalls: [{ name: "report_findings", input: { findings: [{ severity: "warning", category: "conn", title: "floating?", detail: "d", refs: [], unconnectedClaim: ["R1.1"] }, { severity: "info", category: "ok", title: "keep", detail: "d", refs: [] }], summary: "s" } }] } as never);
    const res = await reviewPost(jsonReq("/api/schematic/review", JSON.stringify({ components: [{ refDes: "R1" }], nets: [], floatingPins: [], provider: "anthropic" })));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const out = await payload(res);
    expect(out.ok).toBe(true);
    expect((out.findings as unknown[]).length).toBe(1); // contradicted claim dropped
    expect(out.dropped).toBe(1);
    expect(out.summary).toBe("s");
  });
});
