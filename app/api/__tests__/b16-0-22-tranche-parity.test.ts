/**
 * B16.0.22 §A — PERMANENT route-level parity suite for the tranche-15
 * migration: the durable engineering-authority routes —
 * assignment-queue (GET+POST, 1 MB), footprint-resolution (POST, 4 MB),
 * passive-policy (GET), pcb-sync (GET), physical-bindings (GET+POST, 2 MB),
 * replacement-authority (POST, 16,384 B / 10 s custom envelopes).
 *
 * Written and run GREEN against the raw handlers FIRST, then kept green
 * unchanged after migration except the three pins explicitly marked
 * [SUPERSEDED B16.0.22] below (envelope/dispatch normalizations documented in
 * artifacts/ai-control-plane-b16-0-22/).
 *
 * ZERO providers/processes/network/DB — durable repos are the in-memory test
 * runtime; Postgres-backed repositories and domain services are intercepted
 * with prototype spies or pass-through module spies; the replacement-authority
 * component-authority loader is a pass-through spy proving ZERO durable
 * authority work before authorization completes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { policyFor } from "@/app/lib/auth/route-policy";

const loadAuthority = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/engineering/component-authority-source", async (orig) => {
  const actual = await orig() as { loadRunComponentAuthority: (s: unknown, o: unknown) => Promise<unknown> };
  loadAuthority.mockImplementation((s: unknown, o: unknown) => actual.loadRunComponentAuthority(s, o));
  return { ...actual, loadRunComponentAuthority: loadAuthority };
});
const createCandidate = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/physical-binding/domain", async (orig) => {
  const actual = await orig() as { createPhysicalBindingCandidate: (i: unknown) => unknown };
  createCandidate.mockImplementation((i: unknown) => actual.createPhysicalBindingCandidate(i));
  return { ...actual, createPhysicalBindingCandidate: createCandidate };
});

import { GET as aqGet, POST as aqPost } from "../assignment-queue/route";
import { POST as frPost } from "../footprint-resolution/route";
import { GET as ppGet } from "../passive-policy/route";
import { GET as psGet } from "../pcb-sync/route";
import { GET as pbGet, POST as pbPost } from "../physical-bindings/route";
import { POST as raPost } from "../replacement-authority/route";
import { AssignmentQueueService } from "@/app/lib/assignment-queue/service";
import { DurableAssignmentQueueRepository } from "@/app/lib/assignment-queue/repository";
import { FootprintResolutionService } from "@/app/lib/footprint-resolver/service";
import { PhysicalBindingService } from "@/app/lib/physical-binding/repository";
import { PostgresPhysicalBindingRepository } from "@/app/lib/physical-binding/server-repository";
import { DurablePcbSyncRepository } from "@/app/lib/pcb-sync/durable";
import { DurableBoardLineageStore } from "@/app/lib/pcb-sync/board-lineage"; // [B17 validation] the B16-C.1 lineage read behind every board GET
import {
  resetComponentAuthoritySourceFactory,
  setComponentAuthoritySourceFactory,
} from "../chat/component-authority-runtime";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const SCOPE = { tenantId: "local", projectId: "proj-1", branchId: "main" };
const NONCE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

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

interface PostCase { name: string; handler: (r: Request) => Promise<Response>; path: string; over: number }
const POSTS: PostCase[] = [
  { name: "assignment-queue", handler: aqPost, path: "/api/assignment-queue", over: 1_000_001 },
  { name: "footprint-resolution", handler: frPost, path: "/api/footprint-resolution", over: 4_000_001 },
  { name: "physical-bindings", handler: pbPost, path: "/api/physical-bindings", over: 2_000_001 },
  { name: "replacement-authority", handler: raPost, path: "/api/replacement-authority", over: 16_385 },
];
interface GetCase { name: string; handler: (r: Request) => Promise<Response>; path: string }
const GETS: GetCase[] = [
  { name: "assignment-queue", handler: aqGet, path: "/api/assignment-queue" },
  { name: "passive-policy", handler: ppGet, path: "/api/passive-policy" },
  { name: "pcb-sync", handler: psGet, path: "/api/pcb-sync" },
  { name: "physical-bindings", handler: pbGet, path: "/api/physical-bindings?setId=set-1" },
];

afterEach(() => {
  resetInjectedIdentity();
  resetComponentAuthoritySourceFactory();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  loadAuthority.mockClear();
  createCandidate.mockClear();
});

// ── Exact route-policy rows (independent of handler internals) ───────────────
describe("B16.0.22 §A — exact policy rows for the eight methods", () => {
  it("GETs are authenticated ALL_MEMBERS reads without CSRF; POSTs require CSRF with the exact role sets", () => {
    for (const path of ["/api/assignment-queue", "/api/passive-policy", "/api/pcb-sync", "/api/physical-bindings"]) {
      const row = policyFor(path, "GET");
      expect(row?.requiresAuth, path).toBe(true);
      expect(row?.requiresCsrf, path).toBe(false);
      expect(row?.permittedRoles, path).toContain("viewer");
    }
    for (const path of ["/api/assignment-queue", "/api/footprint-resolution", "/api/physical-bindings"]) {
      const row = policyFor(path, "POST");
      expect(row?.requiresCsrf, path).toBe(true);
      expect([...(row?.permittedRoles ?? [])].sort(), path).toEqual(["pcb_editor", "project_admin", "reviewer"]);
    }
    const ra = policyFor("/api/replacement-authority", "POST");
    expect(ra?.requiresCsrf).toBe(true);
    expect([...(ra?.permittedRoles ?? [])].sort()).toEqual(["automation", "pcb_editor", "project_admin", "reviewer"]);
  });
});

// ── Shared refusal classes ───────────────────────────────────────────────────
describe("B16.0.22 §A — shared refusal classes (POST routes)", () => {
  it.each(POSTS)("[$name] unauthenticated 401; foreign 403; revoked 403 — zero domain work", async (r) => {
    const listPage = vi.spyOn(AssignmentQueueService.prototype, "listPage");
    const resolve = vi.spyOn(FootprintResolutionService.prototype, "resolve");
    const load = vi.spyOn(PostgresPhysicalBindingRepository.prototype, "load");
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
    expect(listPage).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(loadAuthority).not.toHaveBeenCalled();
  });
  it.each(POSTS)("[$name] viewer 403 and commenter 403 (role floor)", async (r) => {
    authed("viewer");
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    resetInjectedIdentity();
    authed("commenter");
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
  });
  it.each(POSTS)("[$name] production cross-origin → 403 with ZERO body pulls", async (r) => {
    production(); authed("admin");
    const counter = { pulls: 0 };
    expect((await r.handler(counting(r.path, { origin: "http://evil.example" }, counter))).status).toBe(403);
    expect(counter.pulls).toBe(0);
  });
  it.each(POSTS)("[$name] text/plain → 415 AUTH_MEDIA_TYPE_UNSUPPORTED", async (r) => {
    authed("admin");
    const res = await r.handler(post(r.path, "{}", { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect((await payload(res)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
  });
  it.each(POSTS)("[$name] one wire byte over the exact family ceiling → 413", async (r) => {
    authed("admin");
    expect((await r.handler(post(r.path, "x".repeat(r.over)))).status).toBe(413);
  });
});

// ── §C assignment-queue ──────────────────────────────────────────────────────
describe("B16.0.22 §C — assignment-queue authority", () => {
  it("GET default feature state (off) → 503 AQ_STAGE6_DISABLED no-store; POST identical", async () => {
    authed("viewer");
    const res = await aqGet(get("/api/assignment-queue"));
    expect(res.status).toBe(503);
    expect((await payload(res)).code).toBe("AQ_STAGE6_DISABLED");
    expect(res.headers.get("cache-control")).toBe("no-store");
    resetInjectedIdentity(); authed("editor");
    expect((await aqPost(post("/api/assignment-queue", "{}"))).status).toBe(503);
  });
  it("GET observe → durable list page envelope with versions, state header, boardChanged false; limit clamped to 200", async () => {
    vi.stubEnv("SIRKIT_ASSIGNMENT_QUEUE_STAGE6", "observe");
    authed("viewer");
    const page = vi.spyOn(DurableAssignmentQueueRepository.prototype, "listItemsPage").mockResolvedValue({ items: [], nextCursor: null, totalFiltered: 0 });
    const res = await aqGet(get("/api/assignment-queue?limit=999"));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect(body.state).toBe("observe");
    expect(body.authority).toBe("durable_stage1_stage5_owner_orchestration");
    expect(body.boardChanged).toBe(false);
    expect(Object.keys(body.versions as Record<string, unknown>).sort()).toEqual(["item", "plan", "queue", "request"]);
    expect(res.headers.get("x-sirkit-assignment-queue")).toBe("observe");
    expect((page.mock.calls[0]![0] as unknown as Record<string, unknown>).limit).toBe(200);
    expect((page.mock.calls[0]![0] as unknown as Record<string, unknown>).tenantId).toBe("local");
  });
  it("GET observe with unknown itemId → 200 with item null (recorded contract: the read is not a refusal)", async () => {
    vi.stubEnv("SIRKIT_ASSIGNMENT_QUEUE_STAGE6", "observe");
    authed("viewer");
    vi.spyOn(DurableAssignmentQueueRepository.prototype, "getItem").mockResolvedValueOnce(null);
    const res = await aqGet(get("/api/assignment-queue?itemId=missing-item-1"));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect(body.item).toBeNull();
    expect(body.boardChanged).toBe(false);
  });
  it("POST forbidden authoritative key (board) → exact generic 400 AUTH_AUTHORITATIVE_INPUT_FORBIDDEN (no key suffix)", async () => {
    vi.stubEnv("SIRKIT_ASSIGNMENT_QUEUE_STAGE6", "observe");
    authed("editor");
    const res = await aqPost(post("/api/assignment-queue", JSON.stringify({ operation: "preview", request: {}, board: {} })));
    expect(res.status).toBe(400);
    const body = await payload(res);
    expect(body.code).toBe("AUTH_AUTHORITATIVE_INPUT_FORBIDDEN");
    expect(body.error).toBe("The request body carries a forbidden authoritative field.");
  });
  // [SUPERSEDED B16.0.22 — reproduced pre-migration as the family-specific
  // AQ_API_PAYLOAD_TOO_LARGE shortcut; the canonical reader refuses a
  // declared-oversize length with the ONE shared envelope. Status 413 and the
  // ZERO-body-pull guarantee are preserved exactly; only the code label
  // changed. Recorded in artifacts/ai-control-plane-b16-0-22/.]
  it("POST declared content-length over 1 MB → 413 with zero body pulls (canonical envelope)", async () => {
    authed("editor");
    const counter = { pulls: 0 };
    const res = await aqPost(counting("/api/assignment-queue", { origin: "http://localhost", "content-length": "2000000" }, counter));
    expect(res.status).toBe(413);
    expect((await payload(res)).code).toBe("AUTH_PAYLOAD_TOO_LARGE");
    expect(counter.pulls).toBe(0);
  });
  it("POST missing request object → 400 AQ_API_REQUEST_REQUIRED; unsupported operation → 400 AQ_API_OPERATION_UNSUPPORTED", async () => {
    vi.stubEnv("SIRKIT_ASSIGNMENT_QUEUE_STAGE6", "observe");
    authed("editor");
    const missing = await aqPost(post("/api/assignment-queue", JSON.stringify({ operation: "preview" })));
    expect(missing.status).toBe(400);
    expect((await payload(missing)).code).toBe("AQ_API_REQUEST_REQUIRED");
    const bad = await aqPost(post("/api/assignment-queue", JSON.stringify({ operation: "destroy", request: {} })));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AQ_API_OPERATION_UNSUPPORTED");
  });
  it("POST commit without the exact opt-in header, or outside opt_in state → 403 AQ_COMMIT_OPT_IN_REQUIRED; commit never reaches the service", async () => {
    const commit = vi.spyOn(AssignmentQueueService.prototype, "commit");
    vi.stubEnv("SIRKIT_ASSIGNMENT_QUEUE_STAGE6", "opt_in");
    authed("editor");
    const noHeader = await aqPost(post("/api/assignment-queue", JSON.stringify({ operation: "commit", request: {} })));
    expect(noHeader.status).toBe(403);
    expect((await payload(noHeader)).code).toBe("AQ_COMMIT_OPT_IN_REQUIRED");
    vi.stubEnv("SIRKIT_ASSIGNMENT_QUEUE_STAGE6", "observe");
    const wrongState = await aqPost(post("/api/assignment-queue", JSON.stringify({ operation: "commit", request: {} }), { "x-sirkit-assignment-commit": "apply_exact_plan" }));
    expect(wrongState.status).toBe(403);
    expect((await payload(wrongState)).code).toBe("AQ_COMMIT_OPT_IN_REQUIRED");
    expect(commit).not.toHaveBeenCalled();
  });
  it("POST preview forces tenant/project/branch/actor from the trusted scope — browser fields overwritten", async () => {
    vi.stubEnv("SIRKIT_ASSIGNMENT_QUEUE_STAGE6", "observe");
    authed("editor");
    const preview = vi.spyOn(AssignmentQueueService.prototype, "preview").mockResolvedValueOnce({ plan: null } as never);
    const res = await aqPost(post("/api/assignment-queue", JSON.stringify({ operation: "preview", request: { tenantId: "evil", projectId: "evil", branchId: "evil", actorContext: { actorId: "evil", actorKind: "ai", role: "project_admin" }, mode: "commit" } })));
    expect(res.status).toBe(200);
    expect(preview).toHaveBeenCalledTimes(1);
    const sent = preview.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(sent.tenantId).toBe("local");
    expect(sent.projectId).toBe("proj-1");
    expect(sent.branchId).toBe("main");
    expect(sent.mode).toBe("preview");
    expect((sent.actorContext as Record<string, unknown>).actorId).toBe("u1");
    expect((sent.actorContext as Record<string, unknown>).actorKind).toBe("human");
  });
});

// ── §D footprint-resolution ──────────────────────────────────────────────────
describe("B16.0.22 §D — footprint resolution (read-only evaluation)", () => {
  it("POST resolve without request → 400 FR_API_REQUEST_REQUIRED; unsupported op → 400 FR_API_OPERATION_UNSUPPORTED", async () => {
    authed("editor");
    const missing = await frPost(post("/api/footprint-resolution", JSON.stringify({ operation: "resolve" })));
    expect(missing.status).toBe(400);
    expect((await payload(missing)).code).toBe("FR_API_REQUEST_REQUIRED");
    const bad = await frPost(post("/api/footprint-resolution", JSON.stringify({ operation: "destroy" })));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("FR_API_OPERATION_UNSUPPORTED");
  });
  it("POST resolve forces schema version + trusted scope + actor into the service request AND threads the request abort signal", async () => {
    authed("reviewer");
    const resolve = vi.spyOn(FootprintResolutionService.prototype, "resolve").mockResolvedValueOnce({ status: "resolved" } as never);
    const res = await frPost(post("/api/footprint-resolution", JSON.stringify({ operation: "resolve", request: { tenantId: "evil", schemaVersion: "evil", actorContext: { actorId: "evil" } } })));
    expect(res.status).toBe(200);
    expect((await payload(res)).readOnly).toBe(true);
    const [sent, signal] = resolve.mock.calls[0]! as unknown as [Record<string, unknown>, AbortSignal];
    expect(sent.tenantId).toBe("local");
    expect(sent.projectId).toBe("proj-1");
    expect(sent.branchId).toBe("main");
    expect(sent.schemaVersion).toBe("sirkit.footprint-resolution-request.v1");
    expect((sent.actorContext as Record<string, unknown>).actorId).toBe("u1");
    expect(signal).toBeInstanceOf(AbortSignal);
  });
  it("POST batch without requests[] → 400 FR_API_BATCH_REQUIRED; compare with malformed legacy observation → 422 FR_LEGACY_OBSERVATION_INVALID", async () => {
    authed("editor");
    const batch = await frPost(post("/api/footprint-resolution", JSON.stringify({ operation: "batch", batch: {} })));
    expect(batch.status).toBe(400);
    expect((await payload(batch)).code).toBe("FR_API_BATCH_REQUIRED");
    const compare = await frPost(post("/api/footprint-resolution", JSON.stringify({ operation: "compare", request: {}, legacy: { status: "nope", source: "none", footprint: null, guessedOrDefaulted: false } })));
    expect(compare.status).toBe(422);
    expect((await payload(compare)).code).toBe("FR_LEGACY_OBSERVATION_INVALID");
  });
  it("POST service cancellation surfaces as 408 FR_REQUEST_CANCELLED", async () => {
    authed("editor");
    vi.spyOn(FootprintResolutionService.prototype, "resolve").mockRejectedValueOnce(new Error("FR_REQUEST_CANCELLED: aborted"));
    const res = await frPost(post("/api/footprint-resolution", JSON.stringify({ operation: "resolve", request: {} })));
    expect(res.status).toBe(408);
    expect((await payload(res)).code).toBe("FR_REQUEST_CANCELLED");
  });
});

// ── §E passive-policy + pcb-sync GETs ────────────────────────────────────────
describe("B16.0.22 §E — passive-policy and pcb-sync read surfaces", () => {
  it.each(GETS)("[$name] GET unauthenticated 401; foreign membership 403; viewer admitted past authorization", async (r) => {
    injectIdentity(null);
    expect((await r.handler(get(r.path))).status).toBe(401);
    resetInjectedIdentity();
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "other", userId: "u1", role: "admin" }]);
    expect((await r.handler(get(r.path))).status).toBe(403);
    resetInjectedIdentity();
    authed("viewer");
    expect([401, 403]).not.toContain((await r.handler(get(r.path))).status); // viewer is past authorization; family-specific terminal
  });
  it("passive-policy GET (state off) → exact capability doc: no mutation capability, exact versions keys, stage header", async () => {
    authed("viewer");
    const res = await ppGet(get("/api/passive-policy"));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect(body.state).toBe("off");
    expect(body.verdict).toBe("durable_feature_gated");
    expect(body.authority).toBe("durable_owner_repository_with_recoverable_outbox");
    const caps = body.capabilities as Record<string, unknown>;
    expect(caps.mutate).toBe(false);
    expect(caps.selectsExactPart).toBe(false);
    expect(caps.manufacturingReady).toBe(false);
    expect(caps.mutatesSchematic).toBe(false);
    expect(caps.mutatesPcb).toBe(false);
    expect(caps.exceptionLifecycle).toEqual([]);
    expect(Object.keys(body.versions as Record<string, unknown>).sort()).toEqual(["evaluationRequest", "evaluationResult", "evaluator", "exception", "policy", "preview", "profile"]);
    expect(res.headers.get("x-sirkit-passive-policy-stage5")).toBe("off");
  });
  it("passive-policy GET opt_in → mutate true with exact lifecycle verbs (feature-gate parity)", async () => {
    vi.stubEnv("SIRKIT_PASSIVE_POLICY_STAGE5", "opt_in");
    authed("viewer");
    const caps = (await payload(await ppGet(get("/api/passive-policy")))).capabilities as Record<string, unknown>;
    expect(caps.mutate).toBe(true);
    expect(caps.exceptionLifecycle).toEqual(["approve", "revoke", "supersede"]);
  });
  it("pcb-sync GET without boardId → exact capability doc (never a board read); state header present", async () => {
    const getBoard = vi.spyOn(DurablePcbSyncRepository.prototype, "getBoard");
    authed("viewer");
    const res = await psGet(get("/api/pcb-sync"));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect(body.authority).toBe("durable_owner_repository_feature_gated");
    expect(body.boardChanged).toBe(false);
    const caps = body.capabilities as Record<string, unknown>;
    expect(caps.arbitraryKicadPcb).toBe(false);
    expect(caps.routedStructuralChanges).toBe(false);
    expect(caps.authoritativeBoardLoad).toBe(true);
    expect(res.headers.get("x-sirkit-pcb-sync-state")).toBe("off");
    expect(getBoard).not.toHaveBeenCalled();
  });
  it("pcb-sync GET ?boardId unknown board → 404 not_found envelope with ok:true result and the TRUSTED scope", async () => {
    const getBoard = vi.spyOn(DurablePcbSyncRepository.prototype, "getBoard").mockResolvedValueOnce(null);
    // [B16-C.1] the board GET also resolves the board's lineage from the durable workflow store; an unknown board has no
    // stored lineage record (its lineage is implicit) — mocked like the board read, so this stays a repository-free unit.
    const lineage = vi.spyOn(DurableBoardLineageStore.prototype, "get").mockResolvedValueOnce(null);
    authed("viewer");
    const res = await psGet(get("/api/pcb-sync?boardId=board-1"));
    expect(res.status).toBe(404);
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect(body.operation).toBe("load_board");
    const result = body.result as Record<string, unknown>;
    expect(result.status).toBe("not_found");
    expect(result.scope).toEqual({ ...SCOPE, boardId: "board-1" });
    expect(getBoard).toHaveBeenCalledTimes(1);
    expect(getBoard.mock.calls[0]![0]).toEqual({ ...SCOPE, boardId: "board-1" });
    expect(lineage).toHaveBeenCalledTimes(1);
    expect(result.lineage).toMatchObject({ boardId: "board-1", rootBoardId: "board-1", generation: 0, state: "current", currentBoardId: "board-1" });
  });
  it("pcb-sync GET ?boardId with an unknown extra query field → 422 PS_API_UNKNOWN_FIELD; malformed boardId → 422 PS_BOARD_ID_INVALID", async () => {
    authed("viewer");
    const unknown = await psGet(get("/api/pcb-sync?boardId=board-1&evil=1"));
    expect(unknown.status).toBe(422);
    expect((await payload(unknown)).code).toBe("PS_API_UNKNOWN_FIELD");
    const invalid = await psGet(get("/api/pcb-sync?boardId=%21%21"));
    expect(invalid.status).toBe(422);
    expect((await payload(invalid)).code).toBe("PS_BOARD_ID_INVALID");
  });
  // [SUPERSEDED B16.0.22 — reproduced pre-migration as a 422
  // PS_API_UNKNOWN_FIELD refusal of DUPLICATED query keys; the canonical
  // query projection is deterministic FIRST-VALUE-WINS, so a duplicated
  // boardId now resolves to the first value (no parameter-pollution
  // ambiguity remains). The unknown-KEY refusal is fully preserved above.
  // Recorded in artifacts/ai-control-plane-b16-0-22/.]
  it("pcb-sync GET duplicated boardId query key → deterministic first-value-wins board read", async () => {
    const getBoard = vi.spyOn(DurablePcbSyncRepository.prototype, "getBoard").mockResolvedValueOnce(null);
    vi.spyOn(DurableBoardLineageStore.prototype, "get").mockResolvedValueOnce(null);
    authed("viewer");
    const res = await psGet(get("/api/pcb-sync?boardId=board-a&boardId=board-b"));
    expect(res.status).toBe(404);
    expect(getBoard.mock.calls[0]![0]).toEqual({ ...SCOPE, boardId: "board-a" });
  });
});

// ── §F physical bindings ─────────────────────────────────────────────────────
describe("B16.0.22 §F — physical bindings", () => {
  const SET_STATE = {
    set: { setId: "set-1", scope: SCOPE, effectiveSelectedRevisionId: "rev-none" },
    bindings: [{ revisionId: "rev-9", legacySource: { schemaVersion: "legacy.v0", rawFields: { footprint: "0603", secret: "raw" } } }],
    assessments: [], auditEvents: [],
    migrationRecords: [{ recordId: "mig-1", rawFields: { secret: "raw" } }],
  } as never;
  it("GET without setId → 400 PB_API_SET_ID_REQUIRED before any repository read", async () => {
    const load = vi.spyOn(PostgresPhysicalBindingRepository.prototype, "load");
    authed("viewer");
    const res = await pbGet(get("/api/physical-bindings"));
    expect(res.status).toBe(400);
    const body = await payload(res);
    expect(body.code).toBe("PB_API_SET_ID_REQUIRED");
    expect(body.error).toBe("setId query parameter is required.");
    expect(load).not.toHaveBeenCalled();
  });
  it("GET unknown set → 404 PB_BINDING_SET_NOT_FOUND; foreign-scope set → 403 PB_API_SCOPE_FORBIDDEN", async () => {
    const load = vi.spyOn(PostgresPhysicalBindingRepository.prototype, "load").mockResolvedValueOnce(null);
    authed("viewer");
    const missing = await pbGet(get("/api/physical-bindings?setId=set-1"));
    expect(missing.status).toBe(404);
    expect((await payload(missing)).code).toBe("PB_BINDING_SET_NOT_FOUND");
    load.mockResolvedValueOnce({ ...SET_STATE as Record<string, unknown>, set: { setId: "set-1", scope: { tenantId: "other", projectId: "p", branchId: "b" } } } as never);
    const foreign = await pbGet(get("/api/physical-bindings?setId=set-1"));
    expect(foreign.status).toBe(403);
    expect((await payload(foreign)).code).toBe("PB_API_SCOPE_FORBIDDEN");
  });
  it("GET redacts legacy raw fields for non-admin roles even when includeLegacyRaw=true; project_admin sees raw; migration rawFields always stripped", async () => {
    vi.spyOn(PostgresPhysicalBindingRepository.prototype, "load").mockResolvedValue(SET_STATE);
    authed("editor");
    const editorView = await payload(await pbGet(get("/api/physical-bindings?setId=set-1&includeLegacyRaw=true")));
    expect(((editorView.bindings as Array<Record<string, unknown>>)[0]!.legacySource as Record<string, unknown>).rawFields).toEqual({ redacted: true });
    expect((editorView.migrationRecords as Array<Record<string, unknown>>)[0]!.rawFields).toBeUndefined();
    resetInjectedIdentity(); authed("admin");
    const adminView = await payload(await pbGet(get("/api/physical-bindings?setId=set-1&includeLegacyRaw=true")));
    expect(((adminView.bindings as Array<Record<string, unknown>>)[0]!.legacySource as Record<string, unknown>).rawFields).toEqual({ footprint: "0603", secret: "raw" });
    expect(adminView.legacyCompatibilityView).toBeNull();
  });
  it("POST create_candidate without candidate+idempotencyKey → 403 PB_API_CREATE_FORBIDDEN; candidate scope mismatch → 403 PB_API_SCOPE_FORBIDDEN", async () => {
    authed("editor");
    const missing = await pbPost(post("/api/physical-bindings", JSON.stringify({ operation: "create_candidate", candidate: {} })));
    expect(missing.status).toBe(403);
    expect((await payload(missing)).code).toBe("PB_API_CREATE_FORBIDDEN");
    const mismatch = await pbPost(post("/api/physical-bindings", JSON.stringify({ operation: "create_candidate", idempotencyKey: "k1", candidate: { scope: { tenantId: "other", projectId: "p", branchId: "b" } } })));
    expect(mismatch.status).toBe(403);
    expect((await payload(mismatch)).code).toBe("PB_API_SCOPE_FORBIDDEN");
  });
  it("POST create_candidate forces origin actor + createdBy from the trusted scope and passes the idempotency key; 201", async () => {
    authed("editor");
    createCandidate.mockImplementationOnce((input: unknown) => ({ token: "binding-1", input }));
    const svc = vi.spyOn(PhysicalBindingService.prototype, "createCandidate").mockResolvedValueOnce({ set: { setId: "set-1" } } as never);
    const res = await pbPost(post("/api/physical-bindings", JSON.stringify({ operation: "create_candidate", idempotencyKey: "idem-1", candidate: { scope: SCOPE, origin: { actor: { actorId: "evil", actorKind: "ai" } } } })));
    expect(res.status).toBe(201);
    const built = createCandidate.mock.calls[0]![0] as Record<string, unknown>;
    expect((built.origin as Record<string, unknown>).actor).toMatchObject({ actorId: "u1", actorKind: "human", role: "pcb_editor" });
    expect(built.createdBy).toMatchObject({ actorId: "u1", actorKind: "human" });
    expect(svc.mock.calls[0]![1]).toBe("idem-1");
  });
  it("POST transition/assess/bind/validate input floors → exact 400 codes; unsupported operation → 400", async () => {
    authed("editor");
    const cases: Array<[string, string]> = [
      [JSON.stringify({ operation: "transition" }), "PB_API_TRANSITION_INVALID"],
      [JSON.stringify({ operation: "assess" }), "PB_API_SET_ID_REQUIRED"],
      [JSON.stringify({ operation: "bind_atomic_selection", componentInstanceId: "c1" }), "PB_API_BIND_INPUT_INVALID"],
      [JSON.stringify({ operation: "validate" }), "PB_API_BINDING_REQUIRED"],
      [JSON.stringify({ operation: "explode" }), "PB_API_OPERATION_UNSUPPORTED"],
    ];
    for (const [body, code] of cases) {
      const res = await pbPost(post("/api/physical-bindings", body));
      expect(res.status).toBe(400);
      expect((await payload(res)).code, code).toBe(code);
    }
  });
  it("POST migrate_legacy as editor → 403 PB_API_MIGRATION_FORBIDDEN (admin-only gate holds)", async () => {
    authed("editor");
    const res = await pbPost(post("/api/physical-bindings", JSON.stringify({ operation: "migrate_legacy", scope: SCOPE, rawComponent: {}, sourceSchemaVersion: "v0" })));
    expect(res.status).toBe(403);
    expect((await payload(res)).code).toBe("PB_API_MIGRATION_FORBIDDEN");
  });
  it("POST transition on a foreign-scope set → 403 before the service runs", async () => {
    vi.spyOn(PostgresPhysicalBindingRepository.prototype, "load").mockResolvedValueOnce({ set: { setId: "set-1", scope: { tenantId: "other", projectId: "p", branchId: "b" } } } as never);
    const svc = vi.spyOn(PhysicalBindingService.prototype, "transition");
    authed("editor");
    const res = await pbPost(post("/api/physical-bindings", JSON.stringify({ operation: "transition", setId: "set-1", transition: { kind: "select" } })));
    expect(res.status).toBe(403);
    expect((await payload(res)).code).toBe("PB_API_SCOPE_FORBIDDEN");
    expect(svc).not.toHaveBeenCalled();
  });
});

// ── §G replacement-authority (highest risk) ──────────────────────────────────
describe("B16.0.22 §G — replacement-authority custom boundary", () => {
  function valid(): Record<string, unknown> {
    return { scope: SCOPE, componentInstanceId: "u1-id", currentAtomicPartRevisionId: null, nonce: NONCE };
  }
  it("over-limit body → EXACT historical 413 envelope (plain error, no code)", async () => {
    authed("editor");
    const res = await raPost(post("/api/replacement-authority", "x".repeat(16_385)));
    expect(res.status).toBe(413);
    expect(await payload(res)).toEqual({ ok: false, error: "request body exceeds the bounded limit" });
  });
  it("pre-aborted request → EXACT historical 408 envelope; zero authority loads", async () => {
    authed("editor");
    const ac = new AbortController(); ac.abort();
    const res = await raPost(new Request("http://localhost/api/replacement-authority", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: "{}", signal: ac.signal }));
    expect(res.status).toBe(408);
    expect(await payload(res)).toEqual({ ok: false, error: "request aborted before the body completed" });
    expect(loadAuthority).not.toHaveBeenCalled();
  });
  it("invalid UTF-8 → 400 exact; invalid JSON → 400 exact; JSON array → 400 exact", async () => {
    authed("editor");
    const utf8 = await raPost(post("/api/replacement-authority", new Uint8Array([0xff, 0xfe, 0xfd])));
    expect(utf8.status).toBe(400);
    expect(await payload(utf8)).toEqual({ ok: false, error: "request body is not valid UTF-8" });
    const json = await raPost(post("/api/replacement-authority", "{not json"));
    expect(json.status).toBe(400);
    expect(await payload(json)).toEqual({ ok: false, error: "request body is not valid JSON" });
    const arr = await raPost(post("/api/replacement-authority", "[]"));
    expect(arr.status).toBe(400);
    expect(await payload(arr)).toEqual({ ok: false, error: "request body must be an object" });
  });
  it("unexpected top-level key and unexpected scope key → exact refusal text; smuggled scope → 403 exact", async () => {
    authed("editor");
    const key = await raPost(post("/api/replacement-authority", JSON.stringify({ ...valid(), targetAtomicPartRevisionId: "rev-x" })));
    expect(key.status).toBe(400);
    expect((await payload(key)).error).toBe('unexpected request key "targetAtomicPartRevisionId" — browser-supplied authority and asset identities are refused');
    const scopeKey = await raPost(post("/api/replacement-authority", JSON.stringify({ ...valid(), scope: { tenantId: "local", evil: "x" } })));
    expect(scopeKey.status).toBe(400);
    expect((await payload(scopeKey)).error).toBe('unexpected scope key "evil"');
    const smuggled = await raPost(post("/api/replacement-authority", JSON.stringify({ ...valid(), scope: { tenantId: "local", projectId: "other-project", branchId: "main" } })));
    expect(smuggled.status).toBe(403);
    expect((await payload(smuggled)).error).toBe("the request scope does not match the authenticated project scope");
    expect(loadAuthority).not.toHaveBeenCalled();
  });
  it("missing/short/symbol nonces → 400 'a well-formed request nonce is required'; malformed component/revision ids → 400", async () => {
    authed("editor");
    for (const nonce of [undefined, "short", "has spaces here yes but sixteen chars!", 42]) {
      const res = await raPost(post("/api/replacement-authority", JSON.stringify({ ...valid(), nonce })));
      expect(res.status, String(nonce)).toBe(400);
      expect((await payload(res)).error).toBe("a well-formed request nonce is required");
    }
    const badComponent = await raPost(post("/api/replacement-authority", JSON.stringify({ ...valid(), componentInstanceId: "!bad" })));
    expect((await payload(badComponent)).error).toBe("componentInstanceId must be a well-formed identifier");
    const badRevision = await raPost(post("/api/replacement-authority", JSON.stringify({ ...valid(), currentAtomicPartRevisionId: "" })));
    expect((await payload(badRevision)).error).toBe("currentAtomicPartRevisionId must be null or a bounded identifier");
  });
  it("valid body, no configured authority source → 503 'no durable authority source is configured'; loader never ran", async () => {
    authed("editor");
    const res = await raPost(post("/api/replacement-authority", JSON.stringify(valid())));
    expect(res.status).toBe(503);
    expect((await payload(res)).error).toBe("no durable authority source is configured");
    expect(loadAuthority).not.toHaveBeenCalled();
  });
  it("happy path echoes the EXACT nonce + component + TRUSTED scope; loader receives the trusted scope and the component id — never body authority", async () => {
    authed("reviewer");
    setComponentAuthoritySourceFactory(() => ({}) as never);
    loadAuthority.mockResolvedValueOnce({ records: [{ componentId: "u1-id", exactAuthority: null }], candidates: [] });
    const res = await raPost(post("/api/replacement-authority", JSON.stringify(valid())));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.binding).toEqual({ nonce: NONCE, componentInstanceId: "u1-id", scope: SCOPE });
    expect(body.currentPinFacts).toBeNull();
    expect(body.targetPinFacts).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const opts = loadAuthority.mock.calls[0]![1] as Record<string, unknown>;
    expect(opts.componentInstanceIds).toEqual(["u1-id"]);
    expect((opts.scope as Record<string, unknown>).projectId).toBe("proj-1");
    expect((opts.scope as Record<string, unknown>).tenantId).toBe("local");
  });
  it("scope omitted entirely is accepted (optional cross-check): terminal is the 503 source refusal, not a scope refusal", async () => {
    authed("editor");
    const res = await raPost(post("/api/replacement-authority", JSON.stringify({ componentInstanceId: "u1-id", currentAtomicPartRevisionId: null, nonce: NONCE })));
    expect(res.status).toBe(503);
  });
});
