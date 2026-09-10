/**
 * [B18-B] `/api/agent/execution-grant` and `/settle` through the canonical
 * wrappers: the exact policy rows (Tier 1 execute roles; CSRF on POST; never a
 * release row), refusal before the store for anonymous production requests
 * and for roles outside the rows, the closed request grammar (authority-shaped
 * and undeclared keys refused by name), the owner-only read that is never an
 * existence oracle, the one-shot burn bound to the SAME principal, session and
 * membership revision (forged handles: 404 with zero writes; a changed session
 * or membership: the exact retirement reason), idempotent replays, settlement
 * bound to the consumed attempt and commitment, and 503 without widening when
 * the store is unavailable. The B18-E negative families for the route surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { policyFor } from "@/app/lib/auth/route-policy";
import { resolveTrustedRequestContext } from "@/app/lib/auth/trusted-request-context";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { InMemoryAgentAutonomyRepository } from "@/app/lib/agent/autonomy-settings";
import { resetAgentAutonomyRepositoryFactory, setAgentAutonomyRepositoryFactory } from "@/app/lib/agent/autonomy-store";
import { ExecutionGrantStore, resetExecutionGrantStoreFactory, setExecutionGrantStoreFactory } from "@/app/lib/execution-grant/store";
import { createExecutionGrantMinter, type MintablePlan } from "@/app/lib/execution-grant/mint";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { mmToNm } from "@/app/lib/pcb/units";
import { buildExecutionOperations } from "@/app/lib/engineering/execution-operations";
import { AGENT_AUTONOMY_SCHEMA, type AgentAutonomySetting } from "@/app/lib/engineering/permission-tiers";
import { attemptIdFor, type PublicExecutionGrant } from "@/app/lib/engineering/execution-grant";
import { GET, POST } from "../execution-grant/route";
import { POST as SETTLE } from "../execution-grant/settle/route";

const SCOPE = { tenantId: "local", projectId: "proj-1", branchId: "main" };
const SEL = { "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId };
const URL_GRANT = "http://localhost/api/agent/execution-grant";
const get = (grantId?: string): Request => new Request(grantId === undefined ? URL_GRANT : `${URL_GRANT}?grantId=${encodeURIComponent(grantId)}`, { method: "GET", headers: { ...SEL } });
const post = (body: unknown, url = URL_GRANT): Request => new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
const settlePost = (body: unknown): Request => post(body, `${URL_GRANT}/settle`);
const json = async (res: Response): Promise<Record<string, unknown>> => (await res.json()) as Record<string, unknown>;
type Role = "viewer" | "commenter" | "editor" | "reviewer" | "admin";
const authed = (role: Role, sessionId = "sess-1"): void => { resetInjectedIdentity(); injectAuthorizedPrincipal({ userId: "u1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role, sessionId }); };

const board = makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
const R3 = board.footprints.find((f) => f.ref === "R3")!;
const built = buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(2), y: R3.at.y }] });
if (!built.ok) throw new Error(built.message);
const PLAN: MintablePlan = { family: "pcb.move-footprint", toolId: "sirkit.pcb.move-footprint", toolVersion: "1.0.0", capability: "edit_placement", operations: built.operations, operationsDigest: built.operationsDigest, operationCount: built.operations.length, targets: built.targets, preview: built.preview, previewDigest: built.previewDigest, expectedPcbRevisionAfter: built.resultRevision };
const LINEAGE = "lin1-0000000000000001";
const BASE = { canonicalRevisionDigest: "eng1-canon", pcb: { pcbRevisionId: "pcb2-abc", boardDigest: "eng1-board", headSequence: 4, lineageId: LINEAGE, validationPolicy: { presetId: "jlcpcb-2l", presetVersion: "2", rulesDigest: "eng1-rules" } }, schematic: null };
const setting = (mode: AgentAutonomySetting["mode"], revision: number): AgentAutonomySetting => ({ schema: AGENT_AUTONOMY_SCHEMA, tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, mode, revision, updatedAt: null, updatedBy: null });
const ATTEMPT = attemptIdFor({ identityKey: "eng1-0000000000000000", preparedAt: "2026-09-10T12:00:00.000Z", attemptNonce: "a".repeat(32) });
const ATTEMPT_2 = attemptIdFor({ identityKey: "eng1-0000000000000000", preparedAt: "2026-09-10T12:00:00.000Z", attemptNonce: "b".repeat(32) });
const COMMITMENT = "eng1-0123456789abcdef";
const SETTLEMENT = { outcome: "committed", transactionId: "tx:1", revisionBefore: "pcb2-abc", revisionAfter: "pcb2-def", headSequenceAfter: 5, changeSetDigest: null, receiptDigest: null, validations: { drc: { ran: true, violations: 0 } }, undoEligible: true };

let workflow: InMemoryDurableWorkflowRepository;
let store: ExecutionGrantStore;
let autonomy: InMemoryAgentAutonomyRepository;
let seed = 0;

/** Mint a grant for the CURRENTLY injected principal exactly as the /api/chat root would: from its trusted context. */
async function mintFor(mode: AgentAutonomySetting["mode"], runId = `run-${(seed += 1)}`): Promise<PublicExecutionGrant> {
  const trusted = await resolveTrustedRequestContext(get());
  if (!trusted.ok) throw new Error(trusted.refusal.message);
  const ctx = trusted.context;
  const minter = createExecutionGrantMinter({
    principalId: ctx.principalId, role: ctx.actor.role, membershipRevision: ctx.membershipRevision, authClass: "local_dev", sessionIdentity: ctx.sessionIdentity, correlationId: ctx.correlationId,
    scope: SCOPE, boardInstanceId: null, autonomy: await autonomy.get({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId }), userMessage: mode === "execute_explicit_tier1" ? "Move R3 2 mm to the right." : "Please move R3 to the right a bit.",
    runId, provider: "openai", store,
  });
  const minted = await minter.mint({ plan: PLAN, board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId, viewSessionId: null }, origin: { callId: "call-1", registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
  if (!minted.ok) throw new Error(minted.diagnostics.join(" "));
  return minted.grant;
}
const tenderOf = (grant: PublicExecutionGrant, over: Record<string, unknown> = {}, attemptId = ATTEMPT) => ({ kind: "tender", grantId: grant.grantId, grantDigest: grant.grantDigest, attemptId, tender: { operationsDigest: grant.binding.proposal.operationsDigest, commitment: COMMITMENT, confirmation: grant.binding.operation.requiresHumanApproval ? { actionId: "confirm-1", previewDigest: grant.binding.proposal.previewDigest } : null, live: null, ...over } });
const settlementOf = (grant: PublicExecutionGrant, over: Record<string, unknown> = {}) => ({ grantId: grant.grantId, grantDigest: grant.grantDigest, attemptId: ATTEMPT, commitment: COMMITMENT, settlement: SETTLEMENT, ...over });
const revisionOf = async (grantId: string): Promise<number> => (await store.load(SCOPE, grantId, Date.now()))!.revision;

beforeEach(async () => {
  workflow = new InMemoryDurableWorkflowRepository();
  store = new ExecutionGrantStore(workflow);
  setExecutionGrantStoreFactory(() => store);
  autonomy = new InMemoryAgentAutonomyRepository();
  setAgentAutonomyRepositoryFactory(() => autonomy);
  await autonomy.set({ scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId }, mode: "execute_explicit_tier1", expectedRevision: 0, actor: { principalId: "admin-1", membershipRevision: "mbr1-x", role: "project_admin" }, at: "2026-09-10T11:00:00.000Z" });
});
afterEach(() => { resetInjectedIdentity(); resetExecutionGrantStoreFactory(); resetAgentAutonomyRepositoryFactory(); vi.unstubAllEnvs(); });

describe("B18-B — /api/agent/execution-grant policy and wrapper boundary", () => {
  it("the exact policy rows: Tier 1 execute roles only (pcb_editor, project_admin); GET is a read without CSRF; the two POSTs are authoritative mutations with CSRF; none is a release row", () => {
    expect(policyFor("/api/agent/execution-grant", "GET")).toMatchObject({ authClass: "authenticated-read", requiresAuth: true, requiresCsrf: false, authoritativeWrite: false, releaseOrQualification: false, permittedRoles: ["pcb_editor", "project_admin"] });
    expect(policyFor("/api/agent/execution-grant", "POST")).toMatchObject({ authClass: "authenticated-mutation", requiresAuth: true, requiresCsrf: true, authoritativeWrite: true, releaseOrQualification: false, permittedRoles: ["pcb_editor", "project_admin"] });
    expect(policyFor("/api/agent/execution-grant/settle", "POST")).toMatchObject({ authClass: "authenticated-mutation", requiresAuth: true, requiresCsrf: true, authoritativeWrite: true, releaseOrQualification: false, permittedRoles: ["pcb_editor", "project_admin"] });
    expect(policyFor("/api/agent/execution-grant/settle", "GET")).toBeNull();
    for (const row of [policyFor("/api/agent/execution-grant", "GET"), policyFor("/api/agent/execution-grant", "POST"), policyFor("/api/agent/execution-grant/settle", "POST")]) expect(row?.requiredCapability).toBeUndefined(); // the capability is a GRANT property (D18-8), never an actor claim
  });

  it("anonymous production requests and roles outside the rows are refused BEFORE the store; workers and agents never reach the burn", async () => {
    const reads: string[] = [];
    setExecutionGrantStoreFactory(() => { reads.push("store"); return store; });
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    resetInjectedIdentity();
    expect([401, 403]).toContain((await GET(get("xg-" + "0".repeat(32)))).status);
    expect([401, 403]).toContain((await POST(post({ kind: "cancel", grantId: "xg-" + "0".repeat(32), grantDigest: "eng1-0000000000000000", reason: "cancelled_by_user" }))).status);
    vi.unstubAllEnvs();
    for (const role of ["viewer", "commenter", "reviewer"] as const) {
      authed(role);
      expect((await GET(get("xg-" + "0".repeat(32)))).status).toBe(403);
      expect((await POST(post({ kind: "cancel", grantId: "xg-" + "0".repeat(32), grantDigest: "eng1-0000000000000000", reason: "cancelled_by_user" }))).status).toBe(403);
      expect((await SETTLE(settlePost({ grantId: "xg-" + "0".repeat(32), grantDigest: "eng1-0000000000000000", attemptId: ATTEMPT, commitment: COMMITMENT, settlement: SETTLEMENT }))).status).toBe(403);
    }
    expect(reads).toEqual([]);
    // Cross-origin POSTs in production are refused by the wrapper before identity, body and store (the exact-origin check is
    // the B16.0.1 wrapper property behind requiresCsrf: true, proven by the B16.0.1 suites; the local-only build does not
    // enforce it, and this unconfigured production environment refuses even earlier — either way: 403, zero store access).
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    const crossOrigin = new Request(URL_GRANT, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", ...SEL }, body: JSON.stringify({ kind: "cancel", grantId: "xg-" + "0".repeat(32), grantDigest: "eng1-0000000000000000", reason: "cancelled_by_user" }) });
    expect((await POST(crossOrigin)).status).toBe(403);
    expect((await SETTLE(new Request(`${URL_GRANT}/settle`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", ...SEL }, body: JSON.stringify(settlementOf({ grantId: "xg-" + "0".repeat(32), grantDigest: "eng1-0000000000000000" } as PublicExecutionGrant)) }))).status).toBe(403);
    vi.unstubAllEnvs();
    expect(reads).toEqual([]);
  });

  it("the closed request grammar: authority-shaped keys, undeclared keys, unknown kinds and malformed handles/tenders/settlements are refused by name with no store access", async () => {
    const reads: string[] = [];
    setExecutionGrantStoreFactory(() => { reads.push("store"); return store; });
    authed("editor");
    const id = "xg-" + "0".repeat(32), digest = "eng1-0000000000000000";
    const cases: Array<[unknown, string, string[] | null]> = [
      [{ kind: "tender", grantId: id, grantDigest: digest, attemptId: ATTEMPT, tender: { operationsDigest: digest, commitment: COMMITMENT }, role: "project_admin" }, "EXECUTION_GRANT_AUTHORITY_CLAIM", ["role"]],
      [{ kind: "cancel", grantId: id, grantDigest: digest, reason: "cancelled_by_user", approval: true, decision: "execute_explicit" }, "EXECUTION_GRANT_AUTHORITY_CLAIM", ["approval", "decision"]],
      [{ kind: "tender", grantId: id, grantDigest: digest, attemptId: ATTEMPT, tender: { operationsDigest: digest, commitment: COMMITMENT, explicit: true } }, "EXECUTION_GRANT_AUTHORITY_CLAIM", ["explicit"]],
      [{ kind: "tender", grantId: id, grantDigest: digest, attemptId: ATTEMPT, tender: { operationsDigest: digest, commitment: COMMITMENT }, extra: 1 }, "EXECUTION_GRANT_UNKNOWN_FIELD", ["extra"]],
      [{ kind: "tender", grantId: id, grantDigest: digest, attemptId: ATTEMPT, tender: { operationsDigest: digest, commitment: COMMITMENT, operations: [] } }, "EXECUTION_GRANT_UNKNOWN_FIELD", ["operations"]],
      [{ kind: "execute", grantId: id, grantDigest: digest }, "EXECUTION_GRANT_BODY_INVALID", null],
      [{ kind: "cancel", grantId: "xg-short", grantDigest: digest, reason: "cancelled_by_user" }, "EXECUTION_GRANT_BODY_INVALID", null],
      [{ kind: "cancel", grantId: id, grantDigest: digest, reason: "because" }, "EXECUTION_GRANT_BODY_INVALID", null],
      [{ kind: "tender", grantId: id, grantDigest: digest, attemptId: "attempt-1", tender: { operationsDigest: digest, commitment: COMMITMENT } }, "EXECUTION_GRANT_BODY_INVALID", null],
      [{ kind: "tender", grantId: id, grantDigest: digest, attemptId: ATTEMPT, tender: { operationsDigest: digest, commitment: COMMITMENT, confirmation: { actionId: "c" } } }, "EXECUTION_GRANT_BODY_INVALID", null],
      [{ kind: "tender", grantId: id, grantDigest: digest, attemptId: ATTEMPT, tender: { operationsDigest: digest, commitment: COMMITMENT, live: { headSequence: -1 } } }, "EXECUTION_GRANT_BODY_INVALID", null],
    ];
    for (const [body, code, fields] of cases) {
      const res = await POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      const payload = await json(res);
      expect(payload.code).toBe(code);
      if (fields) expect(payload.fields).toEqual(fields);
    }
    const settleCases: Array<[unknown, string]> = [
      [{ ...settlementOf({ grantId: id, grantDigest: digest } as PublicExecutionGrant), actor: "u1" }, "EXECUTION_GRANT_AUTHORITY_CLAIM"],
      [{ ...settlementOf({ grantId: id, grantDigest: digest } as PublicExecutionGrant), extra: 1 }, "EXECUTION_GRANT_UNKNOWN_FIELD"],
      [settlementOf({ grantId: id, grantDigest: digest } as PublicExecutionGrant, { settlement: { ...SETTLEMENT, late: true } }), "EXECUTION_GRANT_UNKNOWN_FIELD"],
      [settlementOf({ grantId: id, grantDigest: digest } as PublicExecutionGrant, { settlement: { ...SETTLEMENT, outcome: "applied" } }), "EXECUTION_GRANT_BODY_INVALID"],
      [settlementOf({ grantId: id, grantDigest: digest } as PublicExecutionGrant, { settlement: { ...SETTLEMENT, transactionId: null } }), "EXECUTION_GRANT_BODY_INVALID"],
      [settlementOf({ grantId: id, grantDigest: digest } as PublicExecutionGrant, { settlement: { ...SETTLEMENT, validations: { drc: { ran: true } } } }), "EXECUTION_GRANT_BODY_INVALID"],
    ];
    for (const [body, code] of settleCases) {
      const res = await SETTLE(settlePost(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await json(res)).code).toBe(code);
    }
    expect((await GET(get())).status).toBe(400);
    expect((await GET(get("nope"))).status).toBe(400);
    expect(reads).toEqual([]);
  });
});

describe("B18-B — the grant lifecycle through the routes", () => {
  it("the owner reads its grant (public projection: no nonce, no session identity); a foreign or unknown id is 404 for everyone; the store being unavailable is 503", async () => {
    authed("editor");
    const grant = await mintFor("execute_explicit_tier1");
    const res = await GET(get(grant.grantId));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body).toMatchObject({ ok: true, grant: { grantId: grant.grantId, grantDigest: grant.grantDigest, state: { status: "issued" }, binding: { authorization: { principalId: "u1", role: "pcb_editor" }, operation: { decision: "execute_explicit", tier: 1 } } } });
    const text = JSON.stringify(body);
    expect(text).not.toContain("nonce");
    expect(text).not.toContain("sess-1");
    expect((await GET(get("xg-" + "f".repeat(32)))).status).toBe(404);
    resetInjectedIdentity(); injectAuthorizedPrincipal({ userId: "u2", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor", sessionId: "sess-2" });
    expect((await GET(get(grant.grantId))).status).toBe(404); // not an existence oracle
    expect((await POST(post({ kind: "cancel", grantId: grant.grantId, grantDigest: grant.grantDigest, reason: "cancelled_by_user" }))).status).toBe(404);
    expect((await store.load(SCOPE, grant.grantId, Date.now()))?.record.state.status).toBe("issued"); // zero writes
    setExecutionGrantStoreFactory(() => { throw new Error("DATABASE_URL is not set"); });
    authed("editor");
    expect((await GET(get(grant.grantId))).status).toBe(503);
    expect((await POST(post(tenderOf(grant)))).status).toBe(503);
    expect((await SETTLE(settlePost(settlementOf(grant)))).status).toBe(503);
  });

  it("tender → consumed (one burn, bound to the trusted principal/session/membership), the same attempt replays idempotently, another attempt is 409 REPLAYED, settlement binds the consumed attempt and commitment, and a different outcome afterwards is 409 TERMINAL", async () => {
    authed("editor");
    const grant = await mintFor("execute_explicit_tier1");
    expect((await POST(post(tenderOf(grant, {}, ATTEMPT), URL_GRANT))).status).toBe(200);
    const revision = await revisionOf(grant.grantId);
    const replay = await json(await POST(post(tenderOf(grant))));
    expect(replay).toMatchObject({ ok: true, idempotent: true, consumption: { attemptId: ATTEMPT, commitment: COMMITMENT, live: { principalId: "u1", role: "pcb_editor" } }, grant: { state: { status: "consumed" } } });
    expect(await revisionOf(grant.grantId)).toBe(revision);
    const other = await POST(post(tenderOf(grant, {}, ATTEMPT_2)));
    expect(other.status).toBe(409);
    expect((await json(other)).code).toBe("EXECUTION_GRANT_REPLAYED");
    expect((await json(await POST(post({ kind: "cancel", grantId: grant.grantId, grantDigest: grant.grantDigest, reason: "cancelled_by_user" })))).code).toBe("EXECUTION_GRANT_TERMINAL");
    // Settlement: wrong attempt / commitment refused; the right one settles; replay idempotent; a different outcome is terminal.
    expect((await json(await SETTLE(settlePost(settlementOf(grant, { attemptId: ATTEMPT_2 }))))).code).toBe("EXECUTION_GRANT_WRONG_ATTEMPT");
    expect((await json(await SETTLE(settlePost(settlementOf(grant, { commitment: "eng1-ffffffffffffffff" }))))).code).toBe("EXECUTION_GRANT_WRONG_COMMITMENT");
    const settled = await SETTLE(settlePost(settlementOf(grant)));
    expect(settled.status).toBe(200);
    expect(await json(settled)).toMatchObject({ ok: true, idempotent: false, late: false, grant: { state: { status: "settled", settlement: { outcome: "committed", attestation: "browser-attested", transactionId: "tx:1", validations: { drc: { ran: true, violations: 0 } } } } } });
    expect(await json(await SETTLE(settlePost(settlementOf(grant))))).toMatchObject({ ok: true, idempotent: true });
    const different = await SETTLE(settlePost(settlementOf(grant, { settlement: { ...SETTLEMENT, outcome: "not-committed" } })));
    expect(different.status).toBe(409);
    expect((await json(different)).code).toBe("EXECUTION_GRANT_TERMINAL");
    // Settling an issued (never consumed) grant is refused; a preview grant cancels cleanly.
    const preview = await mintFor("proposal_only");
    expect((await json(await SETTLE(settlePost(settlementOf(preview))))).code).toBe("EXECUTION_GRANT_NOT_CONSUMED");
    expect(await json(await POST(post({ kind: "cancel", grantId: preview.grantId, grantDigest: preview.grantDigest, reason: "cancelled_by_user" })))).toMatchObject({ ok: true, cancelled: true, grant: { state: { status: "retired", retirement: { reason: "cancelled_by_user" } } } });
    expect(await workflow.listOutbox({ topic: "agent.execution-grant-consumed" })).toHaveLength(1);
    expect(await workflow.listOutbox({ topic: "agent.execution-grant-settled" })).toHaveLength(1);
  });

  it("a forged digest is 404 with zero writes; a changed browser session, a changed membership and a missing confirmation each burn the grant with the exact reason (409 RETIRED); afterwards the grant answers retired without further writes", async () => {
    authed("editor");
    const forged = await mintFor("execute_explicit_tier1");
    const before = await revisionOf(forged.grantId);
    expect((await POST(post(tenderOf(forged, {}, ATTEMPT)))).status).toBe(200); // sanity: the real handle burns
    const forgedAgain = await mintFor("execute_explicit_tier1");
    const res = await POST(post({ ...tenderOf(forgedAgain), grantDigest: "eng1-ffffffffffffffff" }));
    expect(res.status).toBe(404);
    expect(await revisionOf(forgedAgain.grantId)).toBe(before); // still revision 1: nothing written
    // Session change: the same principal signs in again with a new session.
    const sessionGrant = await mintFor("execute_explicit_tier1");
    authed("editor", "sess-9");
    const sessionRes = await POST(post(tenderOf(sessionGrant)));
    expect(sessionRes.status).toBe(409);
    expect(await json(sessionRes)).toMatchObject({ code: "EXECUTION_GRANT_RETIRED", reason: "session_changed", grant: { state: { status: "retired", retirement: { reason: "session_changed" } } } });
    const retiredRevision = await revisionOf(sessionGrant.grantId);
    expect(await json(await POST(post(tenderOf(sessionGrant))))).toMatchObject({ code: "EXECUTION_GRANT_RETIRED", reason: "session_changed" });
    expect(await revisionOf(sessionGrant.grantId)).toBe(retiredRevision);
    // Membership change: the principal's membership record changes (here: role editor → admin), the revision moves.
    authed("editor", "sess-9");
    const membershipGrant = await mintFor("execute_explicit_tier1");
    authed("admin", "sess-9");
    const membershipRes = await POST(post(tenderOf(membershipGrant)));
    expect(membershipRes.status).toBe(409);
    expect(await json(membershipRes)).toMatchObject({ code: "EXECUTION_GRANT_RETIRED", reason: "membership_changed" }); // principal and scope agree; project_admin satisfies the apply role; the revision moved
    // Confirmation missing on a preview grant.
    authed("editor", "sess-9");
    const preview = await mintFor("proposal_only");
    const missing = await POST(post(tenderOf(preview, { confirmation: null })));
    expect(await json(missing)).toMatchObject({ code: "EXECUTION_GRANT_RETIRED", reason: "confirmation_missing" });
    // Autonomy withdrawn between mint and tender: an explicit grant burns autonomy_changed (a fresh principal: u1's
    // consumed identical instruction would otherwise re-issue as preview_then_confirm through the retry guard).
    resetInjectedIdentity(); injectAuthorizedPrincipal({ userId: "u3", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor", sessionId: "sess-3" });
    const explicit = await mintFor("execute_explicit_tier1");
    expect(explicit.binding.operation.decision).toBe("execute_explicit");
    const current = await autonomy.get({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId });
    await autonomy.set({ scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId }, mode: "proposal_only", expectedRevision: current.revision, actor: { principalId: "admin-1", membershipRevision: "mbr1-x", role: "project_admin" }, at: "2026-09-10T11:30:00.000Z" });
    expect(await json(await POST(post(tenderOf(explicit))))).toMatchObject({ code: "EXECUTION_GRANT_RETIRED", reason: "autonomy_changed" });
    void setting;
  });
});
