/**
 * B16.0.23 §A — PERMANENT route-level parity suite for the tranche-16 SPICE
 * migration: the public trio (compile / reports / run-plans/estimate, 8 MB /
 * 30 s), model import (4 MB / 20 s) + smoke-test (2 MB / 15 s), the seven
 * run-lifecycle methods (list/start 8 MB / 30 s, get/cancel/bundle/events/
 * waveforms), and the provider-credit AI studio route (8 MB / 30 s).
 *
 * Written and run GREEN against the raw handlers FIRST, then kept green
 * unchanged after migration except the pins explicitly marked
 * [SUPERSEDED B16.0.23] (the §G provider/local error split and the §E/§F
 * late-completion terminal guard — both mandated corrections, reproduced
 * verbatim pre-edit and documented in artifacts/ai-control-plane-b16-0-23/).
 *
 * ZERO providers, processes, network, or DB: the ngspice worker is a
 * controllable fake (no run ever spawns), `node:child_process.spawn` is a
 * scripted fake child (the smoke-test route never starts a real process),
 * and the LLM router is a scripted fake (zero credits). The job store is the
 * real in-memory store, reset per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workerState = vi.hoisted(() => ({
  resolvers: [] as Array<(result: Record<string, unknown>) => void>,
  honorAbort: true,
}));
vi.mock("@/app/lib/spice/server/worker", () => ({
  NGSPICE_EXECUTABLE: "ngspice-stub",
  executeRunPoint: async (input: { signal: AbortSignal }) => {
    return await new Promise<Record<string, unknown>>((resolve) => {
      workerState.resolvers.push(resolve);
      if (workerState.honorAbort) input.signal.addEventListener("abort", () => resolve({ status: "cancelled", progress: 100 }), { once: true });
    });
  },
}));

const spawnState = vi.hoisted(() => ({
  calls: [] as Array<{ cmd: string; args: readonly string[] }>,
  script: { code: 0 as number | null, stdout: "Note: operating point computed", stderr: "" },
}));
vi.mock("node:child_process", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (cmd: string, args: readonly string[]) => {
      spawnState.calls.push({ cmd, args });
      const child = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>; kill: () => void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        if (spawnState.script.stdout) child.stdout.emit("data", Buffer.from(spawnState.script.stdout));
        if (spawnState.script.stderr) child.stderr.emit("data", Buffer.from(spawnState.script.stderr));
        child.emit("close", spawnState.script.code);
      });
      return child;
    },
  };
});

const generate = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate } }));

import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { policyFor } from "@/app/lib/auth/route-policy";
import { __resetJobStoreForTests, getRun, getRuns } from "@/app/lib/spice/server/job-store";
import { createSimulationProject } from "@/app/lib/spice/project";
import { importModelText } from "@/app/lib/spice/models";
import { sha256 } from "@/app/lib/spice/server/manifest";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";
import { LLMProviderError } from "@/app/lib/llm/errors";

import { POST as aiPost } from "../spice/ai/route";
import { POST as compilePost } from "../spice/compile/route";
import { POST as reportsPost } from "../spice/reports/route";
import { POST as estimatePost } from "../spice/run-plans/estimate/route";
import { POST as importPost } from "../spice/models/import/route";
import { POST as smokePost } from "../spice/models/smoke-test/route";
import { GET as runsGet, POST as runsPost } from "../spice/runs/route";
import { GET as runGet, DELETE as runDelete } from "../spice/runs/[id]/route";
import { GET as bundleGet } from "../spice/runs/[id]/bundle/route";
import { GET as eventsGet } from "../spice/runs/[id]/events/route";
import { GET as waveformsGet } from "../spice/runs/[id]/waveforms/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const SCOPE = { tenantId: "local", projectId: "proj-1", branchId: "main" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function post(path: string, body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "GET", headers: { ...SEL, ...headers } });
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
function authed(role: "viewer" | "commenter" | "editor" | "reviewer" | "admin" = "editor"): void {
  injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role });
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
function seedProject() {
  const project = createSimulationProject(dividerSchematic());
  const t = project.tests[0];
  t.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
  t.outputs = [{ id: "vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
  return project;
}
function modelBody(content = ".model DTEST D(IS=1e-14)\n") {
  return importModelText("test.lib", content).candidate;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function llmResponse(toolCalls: Array<{ id: string; name: string; input: unknown }>) {
  return { provider: "openai", model: "test-model", text: "", toolCalls };
}
const SUBMIT = { id: "t1", name: "submit_proposal", input: { summary: "s", rationale: "r", confidence: 0.5, assumptions: [] } };

afterEach(() => {
  resetInjectedIdentity();
  __resetJobStoreForTests();
  vi.unstubAllEnvs();
  generate.mockReset();
  spawnState.calls = [];
  spawnState.script = { code: 0, stdout: "Note: operating point computed", stderr: "" };
  workerState.resolvers = [];
  workerState.honorAbort = true;
});
beforeEach(() => { __resetJobStoreForTests(); });

// ── Exact policy rows ────────────────────────────────────────────────────────
describe("B16.0.23 §A — exact policy rows for the thirteen methods", () => {
  it("public trio is genuinely public; protected methods carry the exact classes, roles, and CSRF flags", () => {
    for (const path of ["/api/spice/compile", "/api/spice/reports", "/api/spice/run-plans/estimate"]) {
      const row = policyFor(path, "POST");
      expect(row?.requiresAuth, path).toBe(false);
      expect(row?.requiresCsrf, path).toBe(false);
    }
    const ai = policyFor("/api/spice/ai", "POST");
    expect(ai?.requiresAuth).toBe(true);
    expect(ai?.providerCredit).toBe(true);
    expect(ai?.requiresCsrf).toBe(true);
    expect([...(ai?.permittedRoles ?? [])].sort()).toEqual(["automation", "pcb_editor", "project_admin", "reviewer"]);
    for (const [path, method] of [["/api/spice/runs", "GET"], ["/api/spice/runs/[id]", "GET"], ["/api/spice/runs/[id]/bundle", "GET"], ["/api/spice/runs/[id]/events", "GET"], ["/api/spice/runs/[id]/waveforms", "GET"]] as const) {
      const row = policyFor(path.replace("[id]", "x"), method);
      expect(row?.requiresAuth, path).toBe(true);
      expect(row?.requiresCsrf, path).toBe(false);
      expect(row?.permittedRoles, path).toContain("viewer");
    }
    for (const [path, method] of [["/api/spice/runs", "POST"], ["/api/spice/runs/x", "DELETE"], ["/api/spice/models/import", "POST"]] as const) {
      const row = policyFor(path, method);
      expect(row?.requiresCsrf, path).toBe(true);
      expect([...(row?.permittedRoles ?? [])].sort(), path).toEqual(["automation", "pcb_editor", "project_admin"]);
    }
    const smoke = policyFor("/api/spice/models/smoke-test", "POST");
    expect(smoke?.requiresCsrf).toBe(true);
    expect([...(smoke?.permittedRoles ?? [])].sort()).toEqual(["automation", "pcb_editor", "project_admin", "reviewer"]);
  });
});

// ── Shared protected-POST refusal classes ────────────────────────────────────
interface PostCase { name: string; handler: (r: Request) => Promise<Response>; path: string; over: number; reviewerAllowed: boolean }
const PROTECTED_POSTS: PostCase[] = [
  { name: "spice/ai", handler: aiPost, path: "/api/spice/ai", over: 8_000_001, reviewerAllowed: true },
  { name: "models/import", handler: importPost, path: "/api/spice/models/import", over: 4_000_001, reviewerAllowed: false },
  { name: "models/smoke-test", handler: smokePost, path: "/api/spice/models/smoke-test", over: 2_000_001, reviewerAllowed: true },
  { name: "runs(start)", handler: runsPost, path: "/api/spice/runs", over: 8_000_001, reviewerAllowed: false },
];

describe("B16.0.23 §A — shared refusal classes (protected POSTs)", () => {
  it.each(PROTECTED_POSTS)("[$name] unauthenticated 401; foreign 403; revoked 403 — zero provider/process/store work", async (r) => {
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
    expect(generate).not.toHaveBeenCalled();
    expect(spawnState.calls).toEqual([]);
    expect(getRuns(SCOPE)).toEqual([]);
  });
  it.each(PROTECTED_POSTS)("[$name] viewer 403; commenter 403; reviewer per exact role set", async (r) => {
    authed("viewer");
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    resetInjectedIdentity();
    authed("commenter");
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    resetInjectedIdentity();
    authed("reviewer");
    const reviewer = await r.handler(post(r.path, "{}"));
    if (r.reviewerAllowed) expect(reviewer.status, "reviewer past authorization").toBe(400);
    else expect(reviewer.status).toBe(403);
  });
  it.each(PROTECTED_POSTS)("[$name] production cross-origin → 403 with ZERO body pulls", async (r) => {
    production(); authed("admin");
    const counter = { pulls: 0 };
    expect((await r.handler(counting(r.path, { origin: "http://evil.example" }, counter))).status).toBe(403);
    expect(counter.pulls).toBe(0);
  });
  it.each(PROTECTED_POSTS)("[$name] 415 media; one byte over the exact ceiling → 413; malformed JSON → 400 AUTH_INVALID_JSON; pre-abort → 400 AUTH_BODY_ABORTED", async (r) => {
    authed("admin");
    const media = await r.handler(post(r.path, "{}", { "content-type": "text/plain" }));
    expect(media.status).toBe(415);
    expect((await payload(media)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    expect((await r.handler(post(r.path, "x".repeat(r.over)))).status).toBe(413);
    const bad = await r.handler(post(r.path, "{not json"));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AUTH_INVALID_JSON");
    const ac = new AbortController(); ac.abort();
    const aborted = await r.handler(new Request(`http://localhost${r.path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: "{}", signal: ac.signal }));
    expect(aborted.status).toBe(400);
    expect((await payload(aborted)).code).toBe("AUTH_BODY_ABORTED");
    expect(generate).not.toHaveBeenCalled();
    expect(spawnState.calls).toEqual([]);
  });
});

// ── §B/§C public trio ────────────────────────────────────────────────────────
interface PublicCase { name: string; handler: (r: Request) => Promise<Response>; path: string; required: string }
const PUBLIC_POSTS: PublicCase[] = [
  { name: "compile", handler: compilePost, path: "/api/spice/compile", required: "project and testId are required" },
  { name: "reports", handler: reportsPost, path: "/api/spice/reports", required: "project and runs are required" },
  { name: "estimate", handler: estimatePost, path: "/api/spice/run-plans/estimate", required: "project and runPlanId are required" },
];

describe("B16.0.23 §B/§C — public stateless trio", () => {
  it.each(PUBLIC_POSTS)("[$name] anonymous callers are served (400 exact required-field envelope, never 401); 415; 413 at 8,000,001; invalid JSON 400", async (r) => {
    injectIdentity(null);
    const missing = await r.handler(post(r.path, "{}"));
    expect(missing.status).toBe(400);
    expect(await payload(missing)).toEqual({ ok: false, error: r.required });
    const media = await r.handler(post(r.path, "{}", { "content-type": "text/plain" }));
    expect(media.status).toBe(415);
    expect((await r.handler(post(r.path, "x".repeat(8_000_001)))).status).toBe(413);
    const bad = await r.handler(post(r.path, "{not json"));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AUTH_INVALID_JSON");
  });
  it("compile: deterministic success envelope; compile success is NOT simulation success; zero durable work", async () => {
    injectIdentity(null);
    const project = seedProject();
    const body = JSON.stringify({ project, testId: project.tests[0].id, parts: [] });
    const first = await compilePost(post("/api/spice/compile", body));
    expect(first.status).toBe(200);
    const a = await payload(first);
    expect(a.ok).toBe(true);
    expect(a.readiness).toBeDefined();
    expect(a.netlist).toBeDefined();
    const summary = a.irSummary as Record<string, unknown>;
    expect(Array.isArray(summary.models)).toBe(true);
    expect(Array.isArray(summary.analyses)).toBe(true);
    // Truth gate: a compile result carries NO run, NO simulation status.
    expect(a.run).toBeUndefined();
    expect(a.status).toBeUndefined();
    const b = await payload(await compilePost(post("/api/spice/compile", body)));
    // Deterministic modulo the readiness audit's wall-clock stamp (the ONLY
    // volatile token — normalized here, documented in the §C artifact).
    delete (a.readiness as Record<string, unknown>).checkedAt;
    delete (b.readiness as Record<string, unknown>).checkedAt;
    expect(b).toEqual(a);
    expect(getRuns(SCOPE)).toEqual([]); // no job-store entry was created
  });
  it("compile: unknown testId → 422 with the raw compiler message (fail-closed, no partial result)", async () => {
    injectIdentity(null);
    const project = seedProject();
    const res = await compilePost(post("/api/spice/compile", JSON.stringify({ project, testId: "nope" })));
    expect(res.status).toBe(422);
    expect((await payload(res)).ok).toBe(false);
  });
  it("reports: JSON attachment by default, HTML attachment on request — a rendered document, never a certification object", async () => {
    injectIdentity(null);
    const project = seedProject();
    const json = await reportsPost(post("/api/spice/reports", JSON.stringify({ project, runs: [] })));
    expect(json.status).toBe(200);
    expect(json.headers.get("content-type")).toContain("application/json");
    expect(json.headers.get("content-disposition")).toBe('attachment; filename="sirkit-spice-report.json"');
    const html = await reportsPost(post("/api/spice/reports", JSON.stringify({ project, runs: [], format: "html" })));
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("content-disposition")).toBe('attachment; filename="sirkit-spice-report.html"');
  });
  it("estimate: deterministic expansion for the fixture plan; unknown plan → 422", async () => {
    injectIdentity(null);
    const project = seedProject();
    const res = await estimatePost(post("/api/spice/run-plans/estimate", JSON.stringify({ project, runPlanId: project.runPlans[0].id })));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect((body.estimate as Record<string, unknown>).totalRuns).toBeGreaterThanOrEqual(1);
    const unknown = await estimatePost(post("/api/spice/run-plans/estimate", JSON.stringify({ project, runPlanId: "nope" })));
    expect(unknown.status).toBe(422);
  });
});

// ── §D model import + smoke test ─────────────────────────────────────────────
describe("B16.0.23 §D — model import and smoke testing", () => {
  it("import: fileName+content required 400 exact; unsupported extension and NUL bytes fail closed 422; checksum is the server-computed sha256", async () => {
    authed("editor");
    const missing = await importPost(post("/api/spice/models/import", "{}"));
    expect(missing.status).toBe(400);
    expect(await payload(missing)).toEqual({ ok: false, error: "fileName and content are required" });
    const badExt = await importPost(post("/api/spice/models/import", JSON.stringify({ fileName: "evil.exe", content: "x" })));
    expect(badExt.status).toBe(422);
    expect(String((await payload(badExt)).error)).toContain("Unsupported model file extension");
    const nul = await importPost(post("/api/spice/models/import", JSON.stringify({ fileName: "m.lib", content: "a b" })));
    expect(nul.status).toBe(422);
    const content = ".model DGOOD D(IS=1e-14)\n";
    const ok = await importPost(post("/api/spice/models/import", JSON.stringify({ fileName: "m.lib", content })));
    expect(ok.status).toBe(200);
    const report = (await payload(ok)).report as { candidate: { checksum: string; validationStatus: string } };
    expect(report.candidate.checksum).toBe(sha256(content));
    // Truth gate: parsing an import NEVER marks the model verified/trusted.
    expect(["unverified", "syntax-checked"]).toContain(report.candidate.validationStatus);
    expect(getRuns(SCOPE)).toEqual([]); // stateless: no durable/store mutation
  });
  it("smoke-test: model required 400; forbidden .control content refused 422 with ZERO process spawns", async () => {
    authed("editor");
    const missing = await smokePost(post("/api/spice/models/smoke-test", "{}"));
    expect(missing.status).toBe(400);
    expect(await payload(missing)).toEqual({ ok: false, error: "model is required" });
    const model = modelBody(".model DTEST D(IS=1e-14)\n.control\nshell rm -rf /\n.endc\n");
    const refused = await smokePost(post("/api/spice/models/smoke-test", JSON.stringify({ model })));
    expect(refused.status).toBe(422);
    expect(String((await payload(refused)).error)).toContain("contains forbidden .control blocks");
    expect(spawnState.calls).toEqual([]);
  });
  it("smoke-test: unresolved include dependencies fail closed before any spawn", async () => {
    authed("editor");
    const model = modelBody();
    (model as { dependencies: unknown[] }).dependencies = [{ fileName: "ext.lib" }];
    const res = await smokePost(post("/api/spice/models/smoke-test", JSON.stringify({ model })));
    expect(res.status).toBe(422);
    expect(String((await payload(res)).error)).toContain("unresolved include dependency");
    expect(spawnState.calls).toEqual([]);
  });
  it("smoke-test pass: exactly one no-shell spawn of the server-owned executable with server-owned args; result is smoke-tested EVIDENCE, never approval", async () => {
    authed("reviewer");
    const model = modelBody();
    const res = await smokePost(post("/api/spice/models/smoke-test", JSON.stringify({ model })));
    expect(res.status).toBe(200);
    const body = await payload(res) as { ok: boolean; model: { validationStatus: string }; check: { kind: string; status: string } };
    expect(body.ok).toBe(true);
    expect(body.check.kind).toBe("smoke");
    expect(body.check.status).toBe("pass");
    expect(body.model.validationStatus).toBe("smoke-tested"); // NEVER "trusted"/"curve-validated"
    expect(spawnState.calls.length).toBe(1);
    expect(spawnState.calls[0]!.cmd).toBe("ngspice-stub"); // server-owned executable
    expect(spawnState.calls[0]!.args[0]).toBe("-b"); // server-owned args; caller injects nothing
    expect(spawnState.calls[0]!.args.length).toBe(2);
  });
  it("smoke-test pass does NOT upgrade an already-governed status; failure returns the rich 422 evidence envelope", async () => {
    authed("editor");
    const trusted = modelBody();
    (trusted as { validationStatus: string }).validationStatus = "trusted";
    const kept = await smokePost(post("/api/spice/models/smoke-test", JSON.stringify({ model: trusted })));
    expect(((await payload(kept)) as { model: { validationStatus: string } }).model.validationStatus).toBe("trusted");
    spawnState.script = { code: 1, stdout: "", stderr: "Error: singular matrix" };
    const failed = await smokePost(post("/api/spice/models/smoke-test", JSON.stringify({ model: modelBody() })));
    expect(failed.status).toBe(422);
    const body = await payload(failed) as { ok: boolean; model: unknown; check: { status: string }; diagnostics: unknown[] };
    expect(body.ok).toBe(false);
    expect(body.check.status).toBe("fail");
    expect(body.model).toBeDefined(); // rich evidence envelope preserved
    expect(Array.isArray(body.diagnostics)).toBe(true);
  });
});

// ── §E run lifecycle ─────────────────────────────────────────────────────────
describe("B16.0.23 §E — run creation and lifecycle", () => {
  it("POST runs: 202 batch bound to the TRUSTED scope; missing fields 400 exact; zero-run plan 422 with the raw store message", async () => {
    authed("editor");
    const project = seedProject();
    const started = await runsPost(post("/api/spice/runs", JSON.stringify({ project, runPlanId: project.runPlans[0].id, parts: [] })));
    expect(started.status).toBe(202);
    const batch = (await payload(started)).batch as { id: string; runIds: string[]; scope: typeof SCOPE };
    expect(batch.scope).toEqual(SCOPE);
    expect(getRun(batch.runIds[0]!, SCOPE)?.scope).toEqual(SCOPE);
    const missing = await runsPost(post("/api/spice/runs", "{}"));
    expect(missing.status).toBe(400);
    expect(await payload(missing)).toEqual({ ok: false, error: "project and runPlanId are required" });
    const empty = seedProject();
    empty.runPlans[0].testIds = [];
    const zero = await runsPost(post("/api/spice/runs", JSON.stringify({ project: empty, runPlanId: empty.runPlans[0].id })));
    expect(zero.status).toBe(422);
    expect((await payload(zero)).error).toBe("Run plan expands to zero runs");
  });
  it("GET runs: exact list envelope; ids filter; header-less QUERY-SELECTOR authorization works and a foreign selector is refused 403", async () => {
    authed("editor");
    const project = seedProject();
    const started = await runsPost(post("/api/spice/runs", JSON.stringify({ project, runPlanId: project.runPlans[0].id })));
    const batch = (await payload(started)).batch as { id: string; runIds: string[] };
    const list = await runsGet(get("/api/spice/runs"));
    expect(list.status).toBe(200);
    const body = await payload(list) as { ok: boolean; runs: Array<{ id: string }>; batch: null };
    expect(body.ok).toBe(true);
    expect(body.runs.map((run) => run.id)).toContain(batch.runIds[0]);
    expect(body.batch).toBeNull();
    const filtered = await payload(await runsGet(get(`/api/spice/runs?ids=${batch.runIds[0]}&batchId=${batch.id}`))) as { runs: unknown[]; batch: { id: string } };
    expect(filtered.runs.length).toBe(1);
    expect(filtered.batch.id).toBe(batch.id);
    // Header-less selector (EventSource/anchor surfaces): NO x-sirkit headers.
    const selector = await runsGet(new Request("http://localhost/api/spice/runs?tenantId=local&projectId=proj-1&branchId=main"));
    expect(selector.status).toBe(200);
    const foreign = await runsGet(new Request("http://localhost/api/spice/runs?tenantId=local&projectId=other-project&branchId=main"));
    expect(foreign.status).toBe(403);
  });
  it("GET/DELETE [id]: uniform byte-exact 404 for missing AND foreign; owner cancel 200→cancelled; second cancel 409 exact; foreign never cancels", async () => {
    authed("editor");
    const project = seedProject();
    const started = await runsPost(post("/api/spice/runs", JSON.stringify({ project, runPlanId: project.runPlans[0].id })));
    const runId = ((await payload(started)).batch as { runIds: string[] }).runIds[0]!;
    const missing = await runGet(get("/api/spice/runs/none"), params("none"));
    expect(missing.status).toBe(404);
    expect(await payload(missing)).toEqual({ ok: false, code: "SPICE_RUN_NOT_FOUND", error: "Run not found" });
    resetInjectedIdentity();
    injectAuthorizedPrincipal({ userId: "intruder", tenantId: "local", projectId: "other-project", role: "admin" });
    const foreignHeaders = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "other-project", "x-sirkit-branch-id": "main" };
    const foreign = await runGet(new Request(`http://localhost/api/spice/runs/${runId}`, { headers: foreignHeaders }), params(runId));
    expect(foreign.status).toBe(404);
    expect(await payload(foreign)).toEqual({ ok: false, code: "SPICE_RUN_NOT_FOUND", error: "Run not found" });
    const foreignCancel = await runDelete(new Request(`http://localhost/api/spice/runs/${runId}`, { method: "DELETE", headers: { ...foreignHeaders, origin: "http://localhost" } }), params(runId));
    expect(foreignCancel.status).toBe(404);
    expect(getRun(runId, SCOPE)?.status).not.toBe("cancelled");
    resetInjectedIdentity();
    authed("editor");
    const cancel = await runDelete(new Request(`http://localhost/api/spice/runs/${runId}`, { method: "DELETE", headers: { ...SEL, origin: "http://localhost" } }), params(runId));
    expect(cancel.status).toBe(200);
    expect(getRun(runId, SCOPE)?.status).toBe("cancelled");
    const again = await runDelete(new Request(`http://localhost/api/spice/runs/${runId}`, { method: "DELETE", headers: { ...SEL, origin: "http://localhost" } }), params(runId));
    expect(again.status).toBe(409);
    expect(await payload(again)).toEqual({ ok: false, error: "Run has already finished" });
  });
  // [SUPERSEDED B16.0.23 §E/§F — HISTORICAL FAIL-OPEN reproduced verbatim
  // pre-edit: executeQueuedRun Object.assign'ed the worker result over a
  // TERMINAL record, so a worker that ignored the abort signal flipped a
  // CANCELLED run to COMPLETED after the fact (asserted as such pre-edit).
  // Unreachable through the real worker (it settles "cancelled" on abort);
  // CORRECTED with a store-level terminal guard. The pin now asserts the
  // corrected invariant. artifacts/ai-control-plane-b16-0-23/]
  it("late worker completion can NEVER overwrite a cancelled run", async () => {
    workerState.honorAbort = false;
    authed("editor");
    const project = seedProject();
    const started = await runsPost(post("/api/spice/runs", JSON.stringify({ project, runPlanId: project.runPlans[0].id })));
    const runId = ((await payload(started)).batch as { runIds: string[] }).runIds[0]!;
    await flush();
    const cancel = await runDelete(new Request(`http://localhost/api/spice/runs/${runId}`, { method: "DELETE", headers: { ...SEL, origin: "http://localhost" } }), params(runId));
    expect(cancel.status).toBe(200);
    expect(getRun(runId, SCOPE)?.status).toBe("cancelled");
    for (const resolve of workerState.resolvers) resolve({ status: "completed", progress: 100, waveforms: [], scalars: [], diagnostics: [], stdout: "", stderr: "" });
    await flush();
    expect(getRun(runId, SCOPE)?.status).toBe("cancelled"); // the terminal record is authoritative
  });
});

// ── §H events / waveforms / bundle ───────────────────────────────────────────
describe("B16.0.23 §H — evidence readers (events, waveforms, bundle)", () => {
  async function completedRun(extra: Record<string, unknown> = {}): Promise<string> {
    authed("editor");
    const project = seedProject();
    const started = await runsPost(post("/api/spice/runs", JSON.stringify({ project, runPlanId: project.runPlans[0].id })));
    const runId = ((await payload(started)).batch as { runIds: string[] }).runIds[0]!;
    await flush();
    for (const resolve of workerState.resolvers) resolve({ status: "completed", progress: 100, waveforms: [], scalars: [], diagnostics: [], stdout: "", stderr: "", ...extra });
    await flush();
    return runId;
  }
  it("events: SSE only for the authorized owner; the first frame is the run snapshot; a terminal run closes the stream", async () => {
    const runId = await completedRun();
    const events = await eventsGet(new Request(`http://localhost/api/spice/runs/${runId}/events?tenantId=local&projectId=proj-1&branchId=main`), params(runId));
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const reader = events.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: run");
    const second = await reader.read();
    expect(second.done).toBe(true); // terminal status closed the stream
  });
  it("waveforms: bounded metadata list; named signal is sliced+downsampled with the 32..20,000 point clamp; unknown signal 404", async () => {
    const x = Array.from({ length: 5000 }, (_, index) => index / 1000);
    const y = x.map((value) => Math.sin(value));
    const runId = await completedRun({ waveforms: [{ id: "w1", name: "v(out)", unit: "V", xName: "time", xUnit: "s", x, y }] });
    const list = await waveformsGet(get(`/api/spice/runs/${runId}/waveforms`), params(runId));
    expect(list.status).toBe(200);
    const signals = (await payload(list)).signals as Array<{ name: string; points: number }>;
    expect(signals).toEqual([{ name: "v(out)", unit: "V", xName: "time", xUnit: "s", points: 5000 }]);
    const capped = await waveformsGet(get(`/api/spice/runs/${runId}/waveforms?signal=${encodeURIComponent("v(out)")}&points=999999`), params(runId));
    const waveform = (await payload(capped)).waveform as { x: number[]; rawPoints: number };
    expect(waveform.x.length).toBeLessThanOrEqual(20_002); // server clamp, caller cannot exceed
    expect(waveform.rawPoints).toBe(5000); // metadata agrees with the artifact
    const missing = await waveformsGet(get(`/api/spice/runs/${runId}/waveforms?signal=nope`), params(runId));
    expect(missing.status).toBe(404);
    expect(await payload(missing)).toEqual({ ok: false, error: "Signal not found" });
  });
  it("bundle: artifact-less run 409 exact; with artifacts, an attachment zip named by the run id (authorized artifacts only)", async () => {
    const bare = await completedRun();
    const refused = await bundleGet(get(`/api/spice/runs/${bare}/bundle`), params(bare));
    expect(refused.status).toBe(409);
    expect(await payload(refused)).toEqual({ ok: false, error: "Run has no reproducibility artifacts" });
    const manifest = { id: "manifest-1", simulator: { name: "ngspice", version: "stub" }, netlistChecksum: "abc123" };
    const netlist = { generated: "* gen", normalized: "* norm", executed: "* exec", sourceMap: [] };
    const runId = await completedRun({ manifest, netlist });
    const bundle = await bundleGet(get(`/api/spice/runs/${runId}/bundle`), params(runId));
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-type")).toBe("application/zip");
    expect(bundle.headers.get("content-disposition")).toBe(`attachment; filename="sirkit-spice-${runId}.zip"`);
    expect(Number(bundle.headers.get("content-length"))).toBeGreaterThan(0);
  });
});

// ── §G AI provider boundary ──────────────────────────────────────────────────
describe("B16.0.23 §G — the AI studio provider boundary", () => {
  function aiBody(extra: Record<string, unknown> = {}): string {
    const project = seedProject();
    return JSON.stringify({ instruction: "set up an operating point test", project, testId: project.tests[0].id, ...extra });
  }
  it("instruction+project required 400 exact; refusals spend ZERO provider calls", async () => {
    authed("editor");
    const missing = await aiPost(post("/api/spice/ai", "{}"));
    expect(missing.status).toBe(400);
    expect(await payload(missing)).toEqual({ ok: false, error: "instruction and project are required" });
    expect(generate).not.toHaveBeenCalled();
  });
  it("a valid request calls the provider EXACTLY once with the pinned parameters and returns the proposal envelope", async () => {
    authed("editor");
    generate.mockResolvedValueOnce(llmResponse([SUBMIT]));
    const res = await aiPost(post("/api/spice/ai", aiBody()));
    expect(res.status).toBe(200);
    const proposal = (await payload(res)).proposal as { summary: string; operations: unknown[]; evidence: unknown[] };
    expect(proposal.summary).toBe("s");
    expect(proposal.operations).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);
    const request = generate.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.provider).toBe("openai");
    expect(request.maxTokens).toBe(4096);
    expect(request.temperature).toBe(0);
    expect(request.toolChoice).toBe("required");
    expect(String(request.system)).toContain("Sirkit SPICE Studio's simulation engineer");
    const tools = request.tools as Array<{ name: string }>;
    expect(tools.length).toBe(20);
    expect(tools.map((tool) => tool.name)).toContain("submit_proposal");
  });
  it("requested-provider routing: anthropic honored; an unrecognized provider falls back to openai (historical default)", async () => {
    authed("editor");
    generate.mockResolvedValue(llmResponse([SUBMIT]));
    await aiPost(post("/api/spice/ai", aiBody({ provider: "anthropic" })));
    expect((generate.mock.calls[0]![0] as Record<string, unknown>).provider).toBe("anthropic");
    await aiPost(post("/api/spice/ai", aiBody({ provider: "grok" })));
    expect((generate.mock.calls[1]![0] as Record<string, unknown>).provider).toBe("openai");
  });
  it("tool loop: read-only tool then submit → two provider calls with tool results threaded; ask_user short-circuits", async () => {
    authed("editor");
    generate.mockResolvedValueOnce(llmResponse([{ id: "t0", name: "inspect_schematic", input: {} }]));
    generate.mockResolvedValueOnce(llmResponse([SUBMIT]));
    const res = await aiPost(post("/api/spice/ai", aiBody()));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    const second = generate.mock.calls[1]![0] as { messages: Array<{ role: string }> };
    expect(second.messages.length).toBe(3); // user + assistant + tool results
    generate.mockReset();
    generate.mockResolvedValueOnce(llmResponse([{ id: "q", name: "ask_user", input: { question: "Which rail?" } }]));
    const ask = await aiPost(post("/api/spice/ai", aiBody()));
    expect(ask.status).toBe(200);
    expect(await payload(ask)).toEqual({ ok: true, question: "Which rail?", proposal: null });
  });
  it("the iteration limit refuses after exactly 18 provider calls with the exact envelope", async () => {
    authed("editor");
    generate.mockResolvedValue(llmResponse([{ id: "t", name: "inspect_schematic", input: {} }]));
    const res = await aiPost(post("/api/spice/ai", aiBody()));
    expect(res.status).toBe(422);
    expect(await payload(res)).toEqual({ ok: false, error: "AI tool loop reached its iteration limit" });
    expect(generate).toHaveBeenCalledTimes(18);
  });
  // [SUPERSEDED B16.0.23 §G — HISTORICAL: every in-loop LOCAL failure (no
  // tool call, unknown tool, malformed tool input) was funnelled into
  // providerErrorResponse and returned 503 BLAMING THE PROVIDER (reason
  // "unknown") though no provider fault occurred — reproduced verbatim
  // pre-edit as 503s. CORRECTED by the provider-invocation-only error split:
  // local failures now carry deterministic local 422 codes; genuine provider
  // failures alone keep the 503 envelope. artifacts/ai-control-plane-b16-0-23/]
  it("LOCAL failures are deterministic local 422s, never provider envelopes: no tool call, unknown tool, malformed tool input", async () => {
    authed("editor");
    generate.mockResolvedValueOnce(llmResponse([]));
    const none = await aiPost(post("/api/spice/ai", aiBody()));
    expect(none.status).toBe(422);
    expect((await payload(none)).code).toBe("SPICE_AI_NO_TOOL_CALL");
    generate.mockReset();
    generate.mockResolvedValueOnce(llmResponse([{ id: "t", name: "explode_lab", input: {} }]));
    const unknown = await aiPost(post("/api/spice/ai", aiBody()));
    expect(unknown.status).toBe(422);
    const unknownBody = await payload(unknown);
    expect(unknownBody.code).toBe("SPICE_AI_REQUEST_INVALID");
    expect(unknownBody.provider ?? null).toBeNull(); // never provider-blamed
    generate.mockReset();
    generate.mockResolvedValueOnce(llmResponse([{ id: "t", name: "search_models", input: { trusted_only: true } }])); // missing required "query"
    const malformed = await aiPost(post("/api/spice/ai", aiBody()));
    expect(malformed.status).toBe(422);
    expect((await payload(malformed)).code).toBe("SPICE_AI_TOOL_INPUT_INVALID");
  });
  it("a GENUINE provider failure returns the 503 provider envelope", async () => {
    authed("editor");
    generate.mockRejectedValueOnce(new LLMProviderError("openai", "overloaded"));
    const res = await aiPost(post("/api/spice/ai", aiBody()));
    expect(res.status).toBe(503);
    const body = await payload(res);
    expect(body.provider).toBe("openai");
    expect(body.reason).toBe("overloaded");
    expect(body.retryable).toBeDefined();
  });
  it("AI cannot execute: run_simulation only RECORDS a proposal operation; the job store stays empty through the whole exchange", async () => {
    authed("editor");
    const project = seedProject();
    generate.mockResolvedValueOnce(llmResponse([{ id: "t0", name: "run_simulation", input: { run_plan_id: project.runPlans[0].id, rationale: "verify" } }]));
    generate.mockResolvedValueOnce(llmResponse([SUBMIT]));
    const res = await aiPost(post("/api/spice/ai", JSON.stringify({ instruction: "run it", project, testId: project.tests[0].id })));
    expect(res.status).toBe(200);
    const proposal = (await payload(res)).proposal as { operations: Array<{ approval: string; operation: { op: string } }> };
    expect(proposal.operations).toEqual([{ approval: "automatic", operation: { op: "request-run", runPlanId: project.runPlans[0].id } }]);
    expect(getRuns(SCOPE)).toEqual([]); // proposal-only: nothing was created or run
  });
});
