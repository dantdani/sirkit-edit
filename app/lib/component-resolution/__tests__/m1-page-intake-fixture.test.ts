/**
 * [PR-M, 2026-10-18] Runbook section M (M1's user-facing half): the page's path for an unresolved-part resolution, end to end over the
 * PRODUCTION modules under the FIXTURE runtime (the committed fixture catalog with its two resolution records, the scripted agent, no
 * database, no provider, no embedding) - the same composition the browser proof (e2e/m1-resolve-missing-parts.spec.ts) drives:
 *
 *  - the chat route's REAL ports bind under the fixture runtime: the catalog inspection, the published revision evidence and the
 *    fixture search seam (recall "fixture-catalog", named in the candidate search's output, no embedding);
 *  - the REAL POST /api/chat with the scripted agent: the chat sentence and the Missing parts list's "Find a replacement in the
 *    library" sentence each run instance-inspect -> candidate-search -> propose-component-resolution and emit ONE
 *    component_resolution_ready; the page's receiver verifies it, the currency check holds and the review projection shows the old and
 *    new identities, the proved mapping, the polarity and what stays unchanged;
 *  - the human's Approve through the page's REAL controller (approveAndApplyResolution): the live membership through the REAL
 *    /api/pcb/apply-authorization handler, the one-shot intent, the PRODUCTION fresh-facts channel posting to the REAL
 *    /api/component-resolution-authority handler (the platform fetch is routed into the handlers, with the Origin and the dev-only role
 *    cookie a same-origin browser sends) - ONE canonical transaction, the real receipt, a new schematic revision; references, values,
 *    placements, nets and polarity kept; Prepare PCB's preflight no longer refuses D1 / D2;
 *  - refusals change nothing: a stale base, a revoked (viewer) membership at the endpoint, and a batch for another project.
 *
 * Fixture-backed: it proves the page's composition and the authority chain, not a live model, a live catalog or a datasheet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KicadPin } from "@/app/lib/kicad/types";
import type { SchematicState } from "@/lib/schematic-types";

const seams = vi.hoisted(() => ({ embedded: [] as string[] }));
vi.mock("@/app/lib/embeddings", async (original) => ({ ...(await original() as object), embedQuery: vi.fn(async (text: string) => { seams.embedded.push(text); throw new Error("the fixture path must not embed"); }) }));

import { POST as CHAT } from "@/app/api/chat/route";
import { POST as FACTS } from "@/app/api/component-resolution-authority/route";
import { POST as APPLY_AUTHORIZATION } from "@/app/api/pcb/apply-authorization/route";
import { resolveCatalogInspectionPort } from "@/app/api/chat/catalog-inspection-runtime";
import { resolveComponentResolutionPorts } from "@/app/api/chat/component-resolution-runtime";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { FIXTURE_ELIGIBLE_DIODE_MPN, FIXTURE_RESOLUTION_PART_IDS, resolutionFixtureParts } from "@/app/lib/fixture-runtime/blinker/catalog";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "@/app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { InMemoryTraceSink, setAgentTraceSinkFactory } from "@/app/lib/agent/trace-recorder";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry } from "@/app/lib/engineering/approved-agent-mutations";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { buildNetlist } from "@/app/lib/pcb/netlist-bridge";
import { buildPcbSyncPreflightReport } from "@/app/lib/pcb-sync/preflight-read";
import { netlistLookupOf } from "../instance-facts";
import { loadCatalogParts } from "../facts-loader";
import { RESOLUTION_RECEIPT_SCHEMA } from "../approved-resolution-mutations";
import type { SealedResolutionProposal } from "../resolution-proposal";
import { approveAndApplyResolution } from "@/app/lib/project/resolution-approval-controller.internal";
import { componentResolutionCurrency, componentResolutionReview, findReplacementSentence, receiveComponentResolutionEvent, resolutionAftermathLines, resolutionLines, resolutionProgressLine } from "@/app/lib/project/component-resolution-events";
import { FIXTURE_RECALL_NOTE } from "@/app/lib/agent/candidate-search-reads";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const SCOPE = { tenantId: "local", projectId: "p-m1-page-intake", branchId: "main" } as const;
const ORIGIN = "http://localhost";
const roleCookie = (role: string): string => `sirkit-fixture-role=${role}`;
const NONCE = "0123456789abcdef0123456789abcdef";

beforeEach(() => {
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
  vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
  vi.stubEnv("SIRKIT_FIXTURE_AGENT", "scripted");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SIRKIT_ORCHESTRATION_ENABLED", "");
  resetFixtureContainer();
  resetAdmissionControl();
  setAgentTraceSinkFactory(() => new InMemoryTraceSink());
  seams.embedded.length = 0;
  vi.stubGlobal("fetch", () => { throw new Error("a server path reached the global fetch"); });
});
afterEach(() => {
  resetInjectedIdentity();
  setAgentTraceSinkFactory(null);
  resetFixtureContainer();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ─── the page's editor composition (the production session, coordinator, history and adoption) ─────────────────────────────────

interface Harness { editor: SchematicEditorSession; coordinator: SchematicGestureCoordinator; history: SchematicHistory<SchematicState>; visible(): SchematicState; executed(): number }
async function harness(state: SchematicState = fixtureDimmerSheet(), scope: { tenantId: string; projectId: string; branchId: string } = SCOPE): Promise<Harness> {
  const editor = new SchematicEditorSession({ ...scope }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(structuredClone(state), null);
  let visible = structuredClone(state);
  const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({ flushPendingRecord: () => {}, history: () => history, applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); }, snapshot: (authoritative) => structuredClone(authoritative), historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {} }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  return { editor, coordinator, history, visible: () => structuredClone(visible), executed: () => editor.events.filter((event) => event.kind === "executed").length };
}

/** The page's chat request, exactly as `send` posts it (scope, the authoritative sheet, the session's head mark), as the editor. */
async function chat(h: Harness, text: string, role = "editor"): Promise<Array<Record<string, unknown>>> {
  const response = await CHAT(new Request(`${ORIGIN}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN, cookie: roleCookie(role) }, body: JSON.stringify({ provider: "anthropic", messages: [{ role: "user", content: text }], scope: SCOPE, schematicState: h.visible(), schematicHeadMark: h.editor.headMark() }) }));
  expect(response.status).toBe(200);
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The platform fetch routed into the REAL handlers the production reauthorizer and channel call (a same-origin browser's headers). */
function routeFetch(role = "editor"): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = new URL(typeof url === "string" ? url : url.toString(), ORIGIN).toString();
    const headers = new Headers(init?.headers);
    headers.set("origin", ORIGIN);
    headers.set("cookie", roleCookie(role));
    const request = new Request(href, { ...init, headers });
    if (href.endsWith("/api/pcb/apply-authorization")) { calls.push("apply-authorization"); return APPLY_AUTHORIZATION(request); }
    if (href.endsWith("/api/component-resolution-authority")) { calls.push("component-resolution-authority"); return FACTS(request); }
    throw new Error(`unexpected fetch: ${href}`);
  });
  return { calls };
}

function approve(h: Harness, proposal: SealedResolutionProposal, scope: { tenantId: string; projectId: string; branchId: string } = SCOPE) {
  return approveAndApplyResolution({
    proposal, session: h.editor, gateway: h.coordinator, interlock: new ProjectCommitInterlock(),
    journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), scope), stillCurrent: () => true,
    currentProjectId: scope.projectId, currentBranchId: scope.branchId, tenantId: scope.tenantId, originRunId: "run-m1-page",
    registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(),
  });
}

/** The sheet's named nets as {name: sorted "REF.pinName"} over the fixture catalog's pins - a polarity-aware view. */
async function netsByFunction(state: SchematicState): Promise<Record<string, string[]>> {
  const ids = [...new Set((state.kicadComponents ?? []).map((instance) => instance.partId))];
  const { parts } = await loadCatalogParts(resolveCatalogInspectionPort()!, ids, { scope: SCOPE, runId: "check", budgetMs: 10_000 });
  const netlist = buildNetlist(state, netlistLookupOf(parts));
  const byId = new Map((state.kicadComponents ?? []).map((instance) => [instance.id, instance] as const));
  const nameOf = (componentId: string, pin: string): string => {
    const instance = byId.get(componentId)!;
    const load = parts.get(instance.partId);
    const name = load?.state === "found" ? (load.detail.pins as KicadPin[]).find((entry) => entry.number === pin)?.name ?? pin : pin;
    return `${instance.refDes}.${name === "~" ? pin : name}`;
  };
  return Object.fromEntries(netlist.nets.filter((net) => !net.name.startsWith("N$")).map((net) => [net.name, net.nodes.map((node) => nameOf(node.componentId, node.pinNumber)).sort()]));
}

const CHAT_SENTENCE = "Replace D1 and D2 with suitable alternatives already in the library.";
const RESOLUTION_TOOLS = ["sirkit.schematic.instance-inspect", "sirkit.parts.candidate-search", "sirkit.schematic.propose-component-resolution"];

describe("[PR-M M.5-8] the fixture runtime binds the resolution's real ports, with the search seam named", () => {
  it("1. catalog, evidence and the fixture search bind; the search's output names the fixture recall and no embedding is made", async () => {
    const ports = resolveComponentResolutionPorts();
    expect(resolveCatalogInspectionPort()).not.toBeNull();
    expect(ports.evidence).toBeDefined();
    expect(ports.search?.recall).toBe("fixture-catalog");
    const h = await harness();
    const assembly = assembleAgentRunContext({ ...SCOPE, schematic: h.visible(), schematicHeadMark: h.editor.headMark(), catalogInspectionAvailable: true, componentResolutionAvailable: true, catalogSearchAvailable: true });
    if (!assembly.ok) throw new Error(assembly.reason);
    const gateway = createAgentToolGateway(sirkitToolRegistry(), { catalogInspection: resolveCatalogInspectionPort()!, componentResolution: ports });
    const outcome = await gateway.invoke({ runId: "run-fixture-search", provider: "anthropic", toolId: "sirkit.parts.candidate-search", version: "1.0.0", args: { componentId: DIMMER_INSTANCE_IDS.D1, query: "1N4148 diode", functionalClass: "diode" }, context: assembly.context, timeoutMs: 15_000 });
    expect(outcome.kind, JSON.stringify(outcome)).toBe("read");
    if (outcome.kind !== "read") return;
    const result = outcome.output.result as { recall?: unknown; buckets: Record<string, Array<{ catalogPartId: string; exactRevision: { revisionId: string } | null }>> };
    expect(result.recall).toEqual(FIXTURE_RECALL_NOTE);
    expect(result.buckets.eligible.map((entry) => entry.catalogPartId)).toEqual([FIXTURE_RESOLUTION_PART_IDS.eligibleDiode]);
    expect(result.buckets.eligible[0]!.exactRevision!.revisionId).toBe(resolutionFixtureParts().eligibleRevisionId);
    expect(result.buckets["missing-asset"].map((entry) => entry.catalogPartId)).toContain(FIXTURE_RESOLUTION_PART_IDS.unresolvedDiode); // its own part: nothing published
    expect(seams.embedded).toEqual([]);
    // outside the fixture runtime, with no catalog database, nothing binds (the production search needs the database)
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    expect(resolveComponentResolutionPorts()).toEqual({});
    expect(resolveCatalogInspectionPort()).toBeNull();
  });
});

describe("[PR-M M.1 / M.5-1/2] the chat request and the Missing parts list's entry point reach the same agent path and the page's intake", { timeout: 120_000 }, () => {
  for (const [name, sentence] of [["the chat sentence", CHAT_SENTENCE], ["Find a replacement in the library", findReplacementSentence([{ componentId: DIMMER_INSTANCE_IDS.D1, refDes: "D1" }, { componentId: DIMMER_INSTANCE_IDS.D2, refDes: "D2" }])]] as const) {
    it(`2. ${name}: inspect -> search -> propose, ONE component_resolution_ready the receiver verifies; nothing changed`, async () => {
      const h = await harness();
      const before = h.visible();
      const events = await chat(h, sentence);
      expect(events.filter((event) => event.type === "tool_started").map((event) => event.toolId)).toEqual(RESOLUTION_TOOLS);
      expect(events.filter((event) => event.type === "tool_started").map((event) => resolutionProgressLine(event))).toEqual(RESOLUTION_TOOLS.map((toolId) => resolutionProgressLine({ type: "tool_started", toolId })));
      expect(events.filter((event) => event.type === "tool_finished").map((event) => event.status)).toEqual(["succeeded", "succeeded", "proposal_sealed"]);
      const ready = events.filter((event) => event.type === "component_resolution_ready");
      expect(ready).toHaveLength(1);
      expect(h.visible()).toEqual(before);
      expect(h.executed()).toBe(0);
      const received = receiveComponentResolutionEvent(ready[0]!);
      expect(received).not.toBeNull();
      expect(componentResolutionCurrency(received!.proposal, { scope: SCOPE, headMark: h.editor.headMark(), baseDigest: schematicStateDigest(h.visible()), now: Date.now() })).toEqual({ ok: true });
      const review = componentResolutionReview(received!.proposal);
      expect(review.items.map((item) => [item.refDes, item.componentInstanceId, item.revision.exactMpn, item.revision.footprint, item.mode])).toEqual([
        ["D1", DIMMER_INSTANCE_IDS.D1, FIXTURE_ELIGIBLE_DIODE_MPN, "Diode_SMD:D_SOD-123", "part-replacement"],
        ["D2", DIMMER_INSTANCE_IDS.D2, FIXTURE_ELIGIBLE_DIODE_MPN, "Diode_SMD:D_SOD-123", "part-replacement"],
      ]);
      expect(review.items[0]!.from).toContain("no published exact revision");
      expect(review.items[0]!.polarity).toEqual(["cathode: pin 1 -> pin 1 (pad 1) stays on TIMING", "anode: pin 2 -> pin 2 (pad 2) stays on RA"]);
      expect(review.items[1]!.polarity).toEqual(["cathode: pin 1 -> pin 1 (pad 1) stays on RB", "anode: pin 2 -> pin 2 (pad 2) stays on TIMING"]);
      expect(review.items[0]!.unchanged.join(" ")).toContain("reference D1");
      expect(review.items.every((item) => item.established.includes("not") && item.established.includes("electrical equivalence proof"))).toBe(true);
      expect(resolutionLines.awaitingReview(received!.proposal)).toContain("Nothing has changed yet");
      expect(seams.embedded).toEqual([]);
    });
  }
});

describe("[PR-M M.2.5-M.2.6] the human's Approve through the page's controller, the production channel and the real endpoint", { timeout: 120_000 }, () => {
  async function sealed(h: Harness): Promise<SealedResolutionProposal> {
    const ready = (await chat(h, CHAT_SENTENCE)).find((event) => event.type === "component_resolution_ready");
    const received = ready ? receiveComponentResolutionEvent(ready) : null;
    if (!received) throw new Error("no sealed batch");
    return received.proposal;
  }

  it("3. ONE canonical transaction, the real receipt and a new revision; refDes, values, placements, nets and polarity kept; Prepare PCB no longer refuses D1 / D2", async () => {
    const h = await harness();
    const before = h.visible();
    const netsBefore = await netsByFunction(before);
    expect(buildPcbSyncPreflightReport(before).unresolved.rows.map((row) => row.refDes)).toEqual(["D1", "D2"]);
    const proposal = await sealed(h);
    const seq = h.editor.headMark()!.headSequence;
    const { calls } = routeFetch();
    const outcome = await approve(h, proposal);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok || outcome.status !== "committed") return;
    expect(calls).toEqual(["apply-authorization", "component-resolution-authority"]); // live membership, then the fresh facts at commit
    expect(outcome.receipt).toMatchObject({ schema: RESOLUTION_RECEIPT_SCHEMA, commandId: "schematic.resolve-components", operationCount: 2, postconditions: "verified", approvalActor: "human:interactive" });
    expect(outcome.receipt.headAfter.headSequence).toBe(seq + 1);
    expect(h.executed()).toBe(1);
    const after = h.visible();
    expect(schematicStateDigest(after)).toBe(outcome.receipt.schematicDigestAfter);
    for (const id of [DIMMER_INSTANCE_IDS.D1, DIMMER_INSTANCE_IDS.D2]) {
      const was = before.kicadComponents!.find((instance) => instance.id === id)!;
      expect(after.kicadComponents!.find((instance) => instance.id === id)).toMatchObject({ partId: FIXTURE_RESOLUTION_PART_IDS.eligibleDiode, atomicPartRevisionId: resolutionFixtureParts().eligibleRevisionId, refDes: was.refDes, value: was.value, x: was.x, y: was.y, rotation: was.rotation });
    }
    for (const id of [DIMMER_INSTANCE_IDS.U1, DIMMER_INSTANCE_IDS.R1, DIMMER_INSTANCE_IDS.C1]) expect(after.kicadComponents!.find((instance) => instance.id === id)).toEqual(before.kicadComponents!.find((instance) => instance.id === id));
    expect(after.wires).toEqual(before.wires);
    expect(after.netLabels).toEqual(before.netLabels);
    expect(await netsByFunction(after)).toEqual(netsBefore); // D1.K / D2.A on TIMING, D1.A on RA, D2.K on RB
    const report = buildPcbSyncPreflightReport(after);
    expect(report).toMatchObject({ status: "ready_for_server_preparation", unresolved: { count: 0 } });
    const [preflightLine] = resolutionAftermathLines(report, []);
    expect(preflightLine).toContain("no instance is refused any more");
    expect(preflightLine).toContain("not checked is not a pass");
    expect(resolutionLines.committed(outcome.receipt, false)).toContain(`new schematic revision ${outcome.receipt.headAfter.headSequence}`);
  });

  it("4. a stale base refuses with its sentence before the endpoint is asked; nothing changed", async () => {
    const h = await harness();
    const proposal = await sealed(h);
    const edited = await h.coordinator.runCanonicalCommand({ label: "edit R1", execute: (authoritative) => h.editor.execute(authoritative, { commandId: "schematic.set-property", label: "edit R1", buildOperations: () => [{ operationId: "op:test:r1", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "kicad", componentId: DIMMER_INSTANCE_IDS.R1, patch: { value: "12k" } }] }) });
    expect(edited.status).toBe("applied");
    const digest = schematicStateDigest(h.visible());
    const head = h.editor.headMark();
    const { calls } = routeFetch();
    const outcome = await approve(h, proposal);
    expect(outcome).toMatchObject({ ok: false, code: "verification-failed" });
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/head moved|schematic changed/);
    expect(resolutionLines.refused(outcome.message)).toContain("was not applied");
    expect(calls).toEqual(["apply-authorization"]); // the fresh-facts endpoint is never asked for a stale batch
    expect(schematicStateDigest(h.visible())).toBe(digest);
    expect(h.editor.headMark()).toEqual(head);
  });

  it("5. a member downgraded to viewer is refused by the live reauthorization, and the endpoint refuses a viewer itself; nothing changed", async () => {
    const h = await harness();
    const proposal = await sealed(h);
    const digest = schematicStateDigest(h.visible());
    routeFetch("viewer");
    const outcome = await approve(h, proposal);
    expect(outcome).toMatchObject({ ok: false });
    if (outcome.ok) return;
    expect(outcome.code).toMatch(/^reauthorization-/);
    expect(schematicStateDigest(h.visible())).toBe(digest);
    expect(h.executed()).toBe(0);
    const response = await FACTS(factsRequest(validFactsBody(proposal), "viewer"));
    expect(response.status).toBe(403);
  });

  it("6. a batch sealed for one project never applies in another", async () => {
    const h = await harness();
    const proposal = await sealed(h);
    const other = { ...SCOPE, projectId: "p-m1-another" };
    const elsewhere = await harness(fixtureDimmerSheet(), other);
    routeFetch();
    const outcome = await approve(elsewhere, proposal, other);
    expect(outcome.ok).toBe(false);
    expect(elsewhere.executed()).toBe(0);
  });
});

// ─── the endpoint itself ───────────────────────────────────────────────────────────────────────────────────────────────────

function validFactsBody(proposal: SealedResolutionProposal, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: SCOPE, proposalId: proposal.proposalId, nonce: NONCE,
    items: proposal.impact.items.map((item) => ({ componentInstanceId: item.componentInstanceId, currentPartId: item.current.partId, candidatePartId: item.target.catalogPartId, atomicPartRevisionId: item.target.atomicPartRevisionId })),
    partIds: [...new Set(proposal.impact.items.flatMap((item) => [item.current.partId, item.target.catalogPartId]))],
    ...over,
  };
}
function factsRequest(body: unknown, role: string | null = "editor", headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/component-resolution-authority`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId, ...(role ? { cookie: roleCookie(role) } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("[PR-M M.2.5] POST /api/component-resolution-authority", { timeout: 120_000 }, () => {
  it("7. an editor gets the fresh catalog facts and the evidence of the asserted revision, echoed with the nonce, the proposal and the TRUSTED scope", async () => {
    const h = await harness();
    const ready = (await chat(h, CHAT_SENTENCE)).find((event) => event.type === "component_resolution_ready")!;
    const proposal = receiveComponentResolutionEvent(ready)!.proposal;
    const response = await FACTS(factsRequest(validFactsBody(proposal)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { ok: boolean; parts: Array<{ partId: string; detail: unknown }>; evidence: Record<string, { atomicPartRevisionId: string } | null>; status: Record<string, { state: string }>; binding: unknown };
    expect(body.ok).toBe(true);
    expect(body.binding).toEqual({ nonce: NONCE, proposalId: proposal.proposalId, scope: SCOPE });
    expect(body.parts.map((entry) => entry.partId).sort()).toEqual([FIXTURE_RESOLUTION_PART_IDS.unresolvedDiode, FIXTURE_RESOLUTION_PART_IDS.eligibleDiode].sort());
    const revision = resolutionFixtureParts().eligibleRevisionId;
    expect(body.evidence[revision]?.atomicPartRevisionId).toBe(revision);
    expect(body.status[revision]?.state).toBe("published");
  });

  it("8. refusals: a viewer or commenter 403, a smuggled scope 403, authority-shaped and unknown keys, a bad nonce, a bad proposal id, empty or oversized lists 400; nothing is read", async () => {
    const h = await harness();
    const ready = (await chat(h, CHAT_SENTENCE)).find((event) => event.type === "component_resolution_ready")!;
    const proposal = receiveComponentResolutionEvent(ready)!.proposal;
    expect((await FACTS(factsRequest(validFactsBody(proposal), "viewer"))).status).toBe(403);
    expect((await FACTS(factsRequest(validFactsBody(proposal), "commenter"))).status).toBe(403);
    expect((await FACTS(factsRequest(validFactsBody(proposal, { scope: { ...SCOPE, projectId: "victim" } })))).status).toBe(403);
    for (const over of [{ pins: [{ number: "1", name: "K" }] }, { atomicPartRevisionId: "rev-x" }, { approval: true }]) expect((await FACTS(factsRequest(validFactsBody(proposal, over)))).status, JSON.stringify(over)).toBe(400);
    expect((await FACTS(factsRequest(validFactsBody(proposal, { nonce: "short" })))).status).toBe(400);
    expect((await FACTS(factsRequest(validFactsBody(proposal, { proposalId: "prop-not-a-resolution" })))).status).toBe(400);
    expect((await FACTS(factsRequest(validFactsBody(proposal, { items: [] })))).status).toBe(400);
    expect((await FACTS(factsRequest(validFactsBody(proposal, { partIds: Array.from({ length: 129 }, (_, index) => `part-${index}`) })))).status).toBe(400);
    expect((await FACTS(factsRequest(validFactsBody(proposal, { items: [{ componentInstanceId: "kc-d1", currentPartId: "x", candidatePartId: "y", atomicPartRevisionId: "z", mapping: [] }] })))).status).toBe(400);
    expect((await FACTS(factsRequest("x".repeat(16_385)))).status).toBe(413);
    expect((await FACTS(factsRequest("{not json"))).status).toBe(400);
  });

  it("10. production authentication: anonymous 401 and a cross-origin member 403 BEFORE the body is read; a revoked membership 403", async () => {
    let pulls = 0;
    const counting = (headers: Record<string, string> = {}) => new Request(`${ORIGIN}/api/component-resolution-authority`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId, ...headers },
      body: new ReadableStream<Uint8Array>({ pull(controller) { pulls += 1; controller.enqueue(new TextEncoder().encode("{}")); controller.close(); } }, { highWaterMark: 0 }),
      duplex: "half",
    } as RequestInit);
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    injectIdentity(null);
    expect((await FACTS(counting())).status).toBe(401);
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", ORIGIN);
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
    expect((await FACTS(counting({ origin: "http://evil.example" }))).status).toBe(403);
    injectIdentity({ userId: "editor-1" });
    injectMembership([{ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, userId: "editor-1", role: "editor", state: "revoked" }]);
    expect((await FACTS(counting())).status).toBe(403);
    expect(pulls).toBe(0);
    resetInjectedIdentity();
  });

  it("9. without a catalog or evidence port (no fixture runtime, no database) the endpoint answers 503 - never a guess", async () => {
    const h = await harness();
    const ready = (await chat(h, CHAT_SENTENCE)).find((event) => event.type === "component_resolution_ready")!;
    const proposal = receiveComponentResolutionEvent(ready)!.proposal;
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    const response = await FACTS(new Request(`${ORIGIN}/api/component-resolution-authority`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId }, body: JSON.stringify(validFactsBody(proposal)) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, code: "RESOLUTION_AUTHORITY_UNAVAILABLE" });
  });
});
