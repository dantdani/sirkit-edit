/**
 * [PR-M, 2026-10-18] Runbook section M.2.5: the PRODUCTION fresh-facts channel factory, the page's trusted controller's own refusals and
 * the page receiver module's pure projections.
 *
 *  - `createResolutionReauthorization` posts ONCE to the same-origin endpoint with the selector headers, `no-store`, redirect refusal and
 *    the internal abort signal, and accepts facts only when the response is JSON, ok, within the byte bound and echoes the nonce, the
 *    proposal id and the exact scope; a hung transport settles within the deadline; a consumed or copied channel grants nothing;
 *  - `approveAndApplyResolution` refuses an artifact that does not verify before any membership read, a throwing reauthorizer as
 *    `reauthorization-unavailable`, and a changed membership revision as `reauthorization-membership-changed` - zero mutation each;
 *  - the receiver module's sentences and progress lines are tied to real events and never claim a change before the receipt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { RESOLUTION_REAUTHORIZATION_ENDPOINT, consumeResolutionReauthorization, createResolutionReauthorization, type ResolutionReauthorizationRequest } from "../resolution-reauthorization";
import type { SealedResolutionProposal } from "../resolution-proposal";
import { resolveCatalogInspectionPort } from "@/app/api/chat/catalog-inspection-runtime";
import { resolveComponentResolutionPorts } from "@/app/api/chat/component-resolution-runtime";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { resolutionFixtureParts, FIXTURE_RESOLUTION_PART_IDS } from "@/app/lib/fixture-runtime/blinker/catalog";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "@/app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry } from "@/app/lib/engineering/approved-agent-mutations";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { buildPcbSyncPreflightReport } from "@/app/lib/pcb-sync/preflight-read";
import { approveAndApplyResolution } from "@/app/lib/project/resolution-approval-controller.internal";
import { assessResolutionBoardImpact, resolutionBoardImpactItems } from "../board-impact"; // [PR-L6, 2026-10-19]
import { MAX_FIND_REPLACEMENT_INSTANCES, RESOLUTION_PROGRESS, findReplacementSentence, resolutionAftermathLines, resolutionLines, resolutionProgressLine } from "@/app/lib/project/component-resolution-events";
import { planFixtureResolution } from "@/app/lib/agent/fixture-agent-adapter";

const SCOPE = { tenantId: "local", projectId: "p-m1-channel", branchId: "main" } as const;
const REQUEST: ResolutionReauthorizationRequest = { proposalId: "cprop-0123456789", items: [{ componentInstanceId: "kc-d1", currentPartId: "p-old", candidatePartId: "p-new", atomicPartRevisionId: "rev-new" }], partIds: ["p-old", "p-new"], scope: SCOPE, now: 1_000 };
const FACTS = { ok: true, parts: [{ partId: "p-new", detail: null, revisionStatus: {} }], evidence: { "rev-new": null }, status: {} };

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
}
/** A platform fetch that answers with the request's own nonce echoed (or what `answer` makes of it), recording each call. */
function stubFetch(answer: (request: { url: string; init: RequestInit; body: Record<string, unknown> }) => Response | Promise<Response>): Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
    calls.push(call);
    return answer(call);
  });
  return calls;
}
const echo = ({ body }: { body: Record<string, unknown> }): Response => jsonResponse({ ...FACTS, binding: { nonce: body.nonce, proposalId: body.proposalId, scope: SCOPE } });

describe("[PR-M M.2.5] the production fresh-facts channel", () => {
  it("1. one same-origin POST: the endpoint, the selector headers, no-store, redirect refusal, the abort signal; the body names the batch, never authority", async () => {
    const calls = stubFetch(echo);
    const facts = await consumeResolutionReauthorization(createResolutionReauthorization(), REQUEST);
    expect(facts).not.toBeNull();
    expect(facts!.facts.parts.map((entry) => entry.partId)).toEqual(["p-new"]);
    expect(facts!.provenance.expiresAt).toBe(REQUEST.now + 30_000);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe(RESOLUTION_REAUTHORIZATION_ENDPOINT);
    expect(call!.init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(call!.init.signal).toBeInstanceOf(AbortSignal);
    expect(call!.init.headers).toMatchObject({ "Content-Type": "application/json", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": "main" });
    expect(Object.keys(call!.body).sort()).toEqual(["items", "nonce", "partIds", "proposalId", "scope"]);
    expect(call!.body.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("2. a wrong echo, a foreign scope, a non-JSON type, a refusal, an unparsable or oversized body all yield nothing", async () => {
    const cases: Array<(call: { body: Record<string, unknown> }) => Response> = [
      ({ body }) => jsonResponse({ ...FACTS, binding: { nonce: `${String(body.nonce)}x`, proposalId: body.proposalId, scope: SCOPE } }),
      ({ body }) => jsonResponse({ ...FACTS, binding: { nonce: body.nonce, proposalId: "cprop-other", scope: SCOPE } }),
      ({ body }) => jsonResponse({ ...FACTS, binding: { nonce: body.nonce, proposalId: body.proposalId, scope: { ...SCOPE, projectId: "victim" } } }),
      ({ body }) => new Response(JSON.stringify({ ...FACTS, binding: { nonce: body.nonce, proposalId: body.proposalId, scope: SCOPE } }), { headers: { "content-type": "text/plain" } }),
      () => jsonResponse({ ok: false, code: "RESOLUTION_AUTHORITY_UNAVAILABLE" }, { status: 503 }),
      () => new Response("{not json", { headers: { "content-type": "application/json" } }),
      () => new Response("x".repeat(2_000_001), { headers: { "content-type": "application/json" } }),
    ];
    for (const [index, answer] of cases.entries()) {
      stubFetch(answer);
      expect(await consumeResolutionReauthorization(createResolutionReauthorization(), REQUEST), `case ${index}`).toBeNull();
    }
  });

  it("3. one-shot and branded: a consumed channel, a copy, or a pre-aborted consumption grants nothing (the last never calls the transport)", async () => {
    const calls = stubFetch(echo);
    const channel = createResolutionReauthorization();
    expect(await consumeResolutionReauthorization(channel, REQUEST)).not.toBeNull();
    expect(await consumeResolutionReauthorization(channel, REQUEST)).toBeNull();
    expect(await consumeResolutionReauthorization({ ...channel }, REQUEST)).toBeNull();
    expect(await consumeResolutionReauthorization(JSON.parse(JSON.stringify(createResolutionReauthorization())), REQUEST)).toBeNull();
    const aborted = new AbortController();
    aborted.abort();
    expect(await consumeResolutionReauthorization(createResolutionReauthorization(), REQUEST, { signal: aborted.signal })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("4. a transport that never answers settles null at the deadline, and its signal is aborted", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => { seen = init.signal ?? undefined; return new Promise<Response>(() => {}); });
    expect(await consumeResolutionReauthorization(createResolutionReauthorization(), REQUEST, { deadlineMs: 50 })).toBeNull(); // settles (the case's own budget is the hang guard)
    expect(seen?.aborted).toBe(true);
  });
});

// ─── the controller's own refusals (a real sealed batch over the fixture runtime's catalog) ──────────────────────────────────────

describe("[PR-M M.2.5] the page's trusted controller refuses before anything is minted", { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
    vi.stubEnv("DATABASE_URL", "");
    resetFixtureContainer();
  });
  afterEach(() => resetFixtureContainer());

  async function sealedOnSession(): Promise<{ proposal: SealedResolutionProposal; editor: SchematicEditorSession; coordinator: SchematicGestureCoordinator; executed(): number }> {
    const state: SchematicState = fixtureDimmerSheet();
    const editor = new SchematicEditorSession({ ...SCOPE }, { store: new InMemoryAtomicProjectStore() });
    await editor.openForProject(structuredClone(state), null);
    const coordinator = new SchematicGestureCoordinator({ currentState: () => structuredClone(state), applyPreviewFrame: () => {}, applyCanonicalProjection: () => {}, applyRollbackProjection: () => {}, execute: (base, request) => editor.execute(base, request), notify: () => {} });
    const assembly = assembleAgentRunContext({ ...SCOPE, schematic: state, schematicHeadMark: editor.headMark(), catalogInspectionAvailable: true, componentResolutionAvailable: true, catalogSearchAvailable: true, verifiedActor: { principalId: "local-dev-principal:editor", actorRole: "pcb_editor", membershipRevision: "membership:rev-1", authMethod: "local_dev" } });
    if (!assembly.ok) throw new Error(assembly.reason);
    const gateway = createAgentToolGateway(sirkitToolRegistry(), { catalogInspection: resolveCatalogInspectionPort()!, componentResolution: resolveComponentResolutionPorts() });
    const revision = resolutionFixtureParts().eligibleRevisionId;
    const outcome = await gateway.invoke({ runId: "run-m1-controller", provider: "anthropic", toolId: "sirkit.schematic.propose-component-resolution", version: "1.0.0", args: { items: [DIMMER_INSTANCE_IDS.D1, DIMMER_INSTANCE_IDS.D2].map((componentId) => ({ componentId, candidatePartId: FIXTURE_RESOLUTION_PART_IDS.eligibleDiode, atomicPartRevisionId: revision })) }, context: assembly.context, timeoutMs: 15_000 });
    if (outcome.kind !== "resolution-proposal") throw new Error(JSON.stringify(outcome));
    return { proposal: outcome.proposal, editor, coordinator, executed: () => editor.events.filter((event) => event.kind === "executed").length };
  }
  const deps = (sealed: Awaited<ReturnType<typeof sealedOnSession>>, over: Record<string, unknown> = {}) => ({
    proposal: sealed.proposal, session: sealed.editor, gateway: sealed.coordinator, interlock: new ProjectCommitInterlock(),
    journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), SCOPE), stillCurrent: () => true,
    currentProjectId: SCOPE.projectId, currentBranchId: SCOPE.branchId, tenantId: SCOPE.tenantId, originRunId: "run-m1-controller",
    registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(),
    // [PR-L6, 2026-10-19] the controller's REQUIRED deps (OD-253 item 8): the reviewed PCB impact (no board) and its re-read at Approve
    boardImpact: { state: "assessed" as const, impact: assessResolutionBoardImpact({ items: resolutionBoardImpactItems(sealed.proposal), basis: { state: "no-board", boardId: `board:${SCOPE.projectId}` } }) }, readBoardBasis: async () => ({ state: "no-board" as const, boardId: `board:${SCOPE.projectId}` }),
    ...over,
  });

  it("5. an altered batch refuses verification-failed before any membership read; nothing is fetched or executed", async () => {
    const sealed = await sealedOnSession();
    const reauthorize = vi.fn();
    vi.stubGlobal("fetch", () => { throw new Error("no fetch for an unverified batch"); });
    const altered = structuredClone(sealed.proposal);
    altered.impact.items[0]!.target.atomicPartRevisionId = "rev-forged";
    expect(await approveAndApplyResolution(deps(sealed, { proposal: altered, reauthorize }))).toMatchObject({ ok: false, code: "verification-failed" });
    expect(reauthorize).not.toHaveBeenCalled();
    expect(sealed.executed()).toBe(0);
  });

  it("6. a throwing reauthorizer is reauthorization-unavailable; a moved membership revision is reauthorization-membership-changed; the endpoint is never asked", async () => {
    const sealed = await sealedOnSession();
    vi.stubGlobal("fetch", () => { throw new Error("the fresh-facts endpoint must not be asked"); });
    expect(await approveAndApplyResolution(deps(sealed, { reauthorize: async () => { throw new Error("down"); } }))).toMatchObject({ ok: false, code: "reauthorization-unavailable" });
    const live = { ok: true as const, principalId: sealed.proposal.authorization.principalId, role: "pcb_editor" as const, membershipRevision: "membership:rev-2", scope: { ...SCOPE } };
    expect(await approveAndApplyResolution(deps(sealed, { reauthorize: async () => live }))).toMatchObject({ ok: false, code: "reauthorization-membership-changed" });
    expect(sealed.executed()).toBe(0);
  });
});

// ─── the receiver module's sentences ─────────────────────────────────────────────────────────────────────────────────────

describe("[PR-M M.4] the run log's public progress and the page's sentences", () => {
  it("7. a progress line exists only for a resolution tool's real tool_started event; every other event keeps the generic line", () => {
    for (const toolId of Object.keys(RESOLUTION_PROGRESS)) {
      expect(resolutionProgressLine({ type: "tool_started", toolId })).toBe(RESOLUTION_PROGRESS[toolId]);
      expect(resolutionProgressLine({ type: "tool_finished", toolId })).toBeNull();
    }
    expect(resolutionProgressLine({ type: "tool_started", toolId: "sirkit.pcb.board-inspect" })).toBeNull();
    expect(resolutionProgressLine({ type: "tool_started", toolId: "__proto__" })).toBeNull();
  });

  it("8. the Find-a-replacement sentence names the references and their stable ids, is bounded, and is a sentence the scripted agent reads", () => {
    const sentence = findReplacementSentence([{ componentId: "kc-d1", refDes: "D1" }, { componentId: "kc-d2", refDes: "D2" }]);
    expect(sentence).toBe("Find a replacement in the library for D1 and D2 (instances kc-d1, kc-d2).");
    expect(planFixtureResolution(sentence)).toEqual({ targets: ["D1", "D2"] });
    expect(findReplacementSentence([{ componentId: "kc-d1", refDes: "D1" }])).toBe("Find a replacement in the library for D1 (instances kc-d1).");
    const many = findReplacementSentence(Array.from({ length: 30 }, (_, index) => ({ componentId: `kc-${index}`, refDes: `D${index + 1}` })));
    expect(many.match(/kc-\d+/g)).toHaveLength(MAX_FIND_REPLACEMENT_INSTANCES);
    expect(planFixtureResolution("Replace D1 and D2 with suitable alternatives already in the library.")).toEqual({ targets: ["D1", "D2"] });
    expect(planFixtureResolution("Resolve the missing parts and footprints, then continue preparing the PCB.")).toEqual({ targets: null });
    expect(planFixtureResolution("Replace R1 with 4.7k")).toBeNull();
  });

  it("9. the aftermath lines report the preflight as it stands (refused rows named) and never call a check that did not run a pass", () => {
    const report = buildPcbSyncPreflightReport(fixtureDimmerSheet());
    const [preflight, electrical] = resolutionAftermathLines(report, [{ id: "floating-nets", label: "No floating nets", state: "not_run", count: 0, findings: [], reason: "parts still loading" }]);
    expect(preflight).toBe("Prepare PCB preflight updated: 2 instance(s) are still refused — D1 (no published exact revision), D2 (no published exact revision).");
    expect(electrical).toBe("Electrical check on the new revision: No floating nets — not run (parts still loading).");
    expect(resolutionLines.discarded()).toBe("Component resolution discarded — nothing was changed and nothing was recorded.");
    expect(resolutionLines.refused("The schematic changed. Nothing was changed.")).toBe("The component resolution was not applied: The schematic changed. Nothing was changed.");
    expect(schematicStateDigest(fixtureDimmerSheet())).toBe(schematicStateDigest(fixtureDimmerSheet())); // the fixture sheet is deterministic (the browser proof opens the same one)
  });
});
