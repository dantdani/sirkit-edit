/**
 * [B21 D3] Runbook scenario 17 - "Run a complex lower-power timer replacement through the adaptive specialist DAG with deterministic
 * disagreement resolution" - over the REAL runtime (`runOrchestratedChat`: the coordinator turn, the real scheduler, the real loop,
 * the specialist gateway the runtime builds with the published pin-facts reads and nothing else, the real merge and the presentation
 * rule), the replacement family's REAL sealer and a FIXTURE CATALOG (`_d3-fixtures.ts`). The sentence routes to the
 * `component-replacement` DAG, which since D3 holds TWO proposing roles - circuit-topology (the Tier 1 edit) and schematic (the Tier 1
 * edit and the replacement) - so two SEALED parties can meet in the merge, which never decides by a count. [B21 D3 fix] (review
 * coverage-3, tests-2) stated as the tree decides it:
 *  - ONE PARTY CANNOT SEAL: the circuit specialist's Tier 1 delete of U1 is refused by the agent path's own Tier 1 compiler
 *    (`pins-unavailable`: the gateway compiles every agent proposal with an EMPTY pin map, so any KiCad delete blocks - peer or no
 *    peer, case 7), so it never becomes an artifact and never reaches the merge; the schematic specialist's replacement passes its
 *    family's integrity and currency checks against the pinned scope, the merge's binding (lifetime, principal), the exact-authority
 *    rule (OD-130) and the merge's sealed-in-run check - the one accepted action, presented as the run's own `proposal_ready` and
 *    APPROVED through the replacement family's existing path with the run's principal;
 *  - the replacement cannot seal: a replacement naming a part that is not the exact authority never seals (`expected-mpn-mismatch`:
 *    the model may assert, never choose), nothing is presented;
 *  - BOTH SEAL, ESCALATED: both parties verified by their families and conflicting on U1 - both `contradicted`, ONE escalation
 *    naming what the human decides (the exact authority cited), nothing presented; two sealed parties on U1 ALWAYS escalate, so
 *    whether scenario 17 presents or escalates follows the circuit specialist's op choice (an open OD-122 question);
 *  - OD-130's part review: a replacement the real sealer sealed to the catalog's EARLIER exact target, replayed by a scheduler resume
 *    after the selection moved - `contradicted` and a part review request for `request_atomic_review`, nothing presented (the
 *    runtime's resume; the route never resumes - route case 7);
 *  - the order is a presentation and budget order only: no specialist reads another's result (case 8).
 * Every verdict is read back from the persisted record. The parties' provider is the coordinator's (one adapter, B21-E1 routes by
 * role); the rule is provider-blind (one provider = one source; agreement is never proof). The never-execution sweep through the
 * specialist gateway WITH the pin-facts reader still mints nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { ExecutionGrantStore } from "@/app/lib/execution-grant/store";
import { createExecutionGrantMinter } from "@/app/lib/execution-grant/mint";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { buildRunToolset } from "@/app/lib/agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentExecutionGrantMinter, type AgentRunContext, type AgentRunEvent, type GatewayInvocationOutcome } from "@/app/lib/agent/contracts";
import { REPLACEMENT_PROPOSAL_SCHEMA, type SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";
import { receiveReplacementProposalEvent } from "@/app/lib/project/replacement-proposal-events";
import { DEFAULT_PIN_FACTS_DEADLINE_MS, loadRunReplacementPinFacts, resolveReplacementPinFactsSource } from "@/app/api/chat/replacement-facts-runtime";
import { resetOrchestrationStoreFactory, routerFactsOf, runOrchestratedChat, setOrchestrationStoreFactory, specialistGatewayOptions } from "@/app/api/chat/orchestration-runtime";
import { FIXTURE_EXACT } from "@/app/lib/engineering/__tests__/_authority-fixtures";
import { SPECIALIST_ROLES, type SpecialistRole } from "../contracts";
import { DurableOrchestrationRunStore, type OrchestrationRunEntry } from "../store";
import { DAG_ROLE_LISTS, routeTaskComplexity } from "../router";
import { roleProposalToolIds } from "../role-tools";
import { SPECIALIST_CONTEXT_REFUSAL_STATUS, SPECIALIST_REFUSAL_STATUS, readOnlySpecialistGateway, specialistAllowedToolIds, specialistContextFor, specialistObjective } from "../scheduler";
import { MERGE_TASK_PREFIX } from "../merge";
import { ToolCallingSpecialists, specialistResult, type SpecialistScript } from "./_d2-fixtures";
import { EXPLICIT_AUTONOMY, MOVE_R3_ARGS, ROLE_SCOPE, grantableContext } from "./_role-fixtures";
import { EARLIER, REPLACEMENT, SCENARIO_17, TIER1, TIMER, approveReplacement, earlierAuthority, installCatalog, principalOf, resetCatalog, stubReplacementAuthorityFetch, timerContext, timerEditor, type Catalog } from "./_d3-fixtures";

const REGISTRY = sirkitToolRegistry();
const DELETE_U1 = { ops: [{ op: "delete", target: "U1" }] };
const RELABEL_U1 = { ops: [{ op: "set-value", target: "U1", value: "TLC555" }] };
const REPLACE_U1 = { componentId: TIMER };
const REPLACEMENT_DAG = ["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic", "coordinator"];

/** The coordinator's gateway exactly as the chat route builds it for this request: the prompt version and the published pin-facts
 *  reads from the SAME resolved source, each read under the request's signal and the route's deadline (route.ts). */
function coordinatorGateway(signal: AbortSignal) {
  const source = resolveReplacementPinFactsSource();
  return createAgentToolGateway(REGISTRY, { promptVersion: AGENT_SYSTEM_PROMPT_VERSION, ...(source ? { replacementPinFacts: (atomicPartRevisionId: string, role: "current" | "target") => loadRunReplacementPinFacts(source, atomicPartRevisionId, signal, DEFAULT_PIN_FACTS_DEADLINE_MS, role) } : {}) });
}
interface ScenarioRun { runId: string; events: AgentRunEvent[]; warnings: string[]; history: OrchestrationRunEntry[]; adapter: ToolCallingSpecialists; followUp: string; status: string }
/** One chat run of scenario 17 through the REAL runtime (what the route calls under the flag), its plan from the REAL router. */
async function runScenario(context: AgentRunContext, scripts: Readonly<Record<string, SpecialistScript>>, over: { runId?: string; store?: DurableOrchestrationRunStore } = {}): Promise<ScenarioRun> {
  const store = over.store ?? new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
  setOrchestrationStoreFactory(() => store);
  const plan = routeTaskComplexity(SCENARIO_17, routerFactsOf(context));
  if (plan.kind !== "dag") throw new Error(`scenario 17 must route to a DAG: ${JSON.stringify(plan)}`);
  const runId = over.runId ?? "run-b21d3-s17";
  const controller = new AbortController();
  const adapter = new ToolCallingSpecialists(scripts);
  const events: AgentRunEvent[] = [];
  const result = await runOrchestratedChat({
    request: { runId, provider: "openai", history: [], userMessage: SCENARIO_17, budget: DEFAULT_AGENT_BUDGET, signal: controller.signal },
    deps: { adapter, gateway: coordinatorGateway(controller.signal), registry: REGISTRY, context, system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event) },
    plan, startedAt: Date.now(),
  });
  const history = await store.history({ tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, runId });
  const warnings = events.flatMap((event) => ((event.type === "warning" || event.type === "plan" || event.type === "specialist_finished" || event.type === "degraded") ? [event.message] : [])); // [B21 E2] pin move (OD-126): B's plan, status and stand-down lines are now the plan / specialist_finished / degraded events carrying the same sentence
  return { runId, events, warnings, history, adapter, followUp: adapter.starts.at(-1)!.userMessage, status: result.status };
}
/** The persisted verdicts, readable: `<taskId>[.merge-*]:<kind>:<decision>` (a content key's hex elided; an escalation or part review as `merge`). */
const verdictsOf = (history: readonly OrchestrationRunEntry[]): string[] => history.filter((entry) => entry.record.kind === "decision" || entry.record.kind === "dissent").map((entry) => `${entry.taskId.startsWith(MERGE_TASK_PREFIX) ? "merge" : entry.taskId.replace(/\.merge-[0-9a-f]{16}$/, ".merge-*")}:${entry.record.kind}:${(entry.record as { decision: string }).decision}`);
const reasonOf = (history: readonly OrchestrationRunEntry[], taskId: string): string => {
  const verdict = history.filter((entry) => entry.taskId.startsWith(`${taskId}.merge-`)).at(-1)?.record as { reason?: string } | undefined;
  return verdict?.reason ?? "";
};
const artifactEvents = (events: readonly AgentRunEvent[]): AgentRunEvent[] => events.filter((event) => event.type === "proposal_ready" || event.type === "pcb_proposal_ready" || event.type === "layout_candidate_ready" || event.type === "execution_grant_ready");
const toolResult = (adapter: ToolCallingSpecialists, task: string): { ok: boolean; status: string; blockers?: Array<{ code: string }> } => JSON.parse(adapter.continued.find((entry) => entry.task === task)!.results[0]!.outputText) as { ok: boolean; status: string; blockers?: Array<{ code: string }> };

describe("[B21 D3] runbook scenario 17: the timer replacement's disagreement is structural and deterministically resolved", () => {
  let catalog: Catalog;
  let live: Awaited<ReturnType<typeof principalOf>>;
  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", ""); // the shell never decides an outcome (the route suites' rule): the local-dev membership answers
    catalog = await installCatalog();
    live = await principalOf();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetCatalog();
    resetOrchestrationStoreFactory();
  });

  it("1. PRESENTED, one party cannot seal ([B21 D3 fix] retitled - review coverage-3 / tests-2: no verifier judges between two sealed parties here, see case 7): the sentence routes to the replacement DAG (four specialists, two of them proposing); the circuit specialist's Tier 1 delete of U1 is REFUSED by the agent path's own Tier 1 compiler (`pins-unavailable`, naming U1) - no artifact, one bounded line; the schematic specialist SEALS the replacement through the specialist gateway's pin-facts reads (the current and the target revision read once each); the merge accepts it (its family's integrity and currency checks against the pinned scope, the merge's lifetime and principal binding, the exact-authority rule, sealed-in-run) and every task's verdict is persisted; the one accepted action is presented as the run's own `proposal_ready` of the replacement family, which the page's consumer takes", async () => {
    const editor = await timerEditor();
    const context = timerContext(editor, catalog.authority, live);
    expect(routeTaskComplexity(SCENARIO_17, routerFactsOf(context))).toEqual({ kind: "dag", rule: "D-component-replacement", roles: DAG_ROLE_LISTS["component-replacement"] });
    const run = await runScenario(context, { "circuit-topology": { call: { toolId: TIER1, args: DELETE_U1 } }, schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } });
    expect(run.status).toBe("completed");
    expect(run.adapter.starts.map((start) => start.role)).toEqual(REPLACEMENT_DAG);
    // two proposing roles in the DAG: the circuit specialist is offered the Tier 1 edit, the schematic specialist both proposals
    const offered = (role: string): string[] => run.adapter.starts.find((start) => start.role === role)!.tools.filter((toolId) => REGISTRY.get(toolId)?.operationClass === "propose").sort();
    expect(offered("circuit-topology")).toEqual([TIER1]);
    expect(offered("schematic")).toEqual([REPLACEMENT, TIER1]);
    expect(offered("component-sourcing-evidence")).toEqual([]);
    expect(offered("verification-critic")).toEqual([]);
    // the edit that cannot seal: refused by the agent path's Tier 1 compiler before any seal (a KiCad delete needs published pins the
    // gateway never invents - for ANY agent delete, peer or no peer: case 7), the refusal naming U1
    expect(toolResult(run.adapter, "task-1-circuit-topology")).toMatchObject({ ok: false, status: "proposal_blocked", blockers: [{ code: "pins-unavailable", detail: expect.stringContaining("computed for U1.") }] });
    expect(run.warnings).toContain("Orchestration: specialist circuit-topology (task task-1-circuit-topology, attempt 0) tool sirkit.schematic.propose-tier1-edit refused: proposal_blocked.");
    // the winning seal: the replacement sealer read the current and the target revision's published facts through the specialist gateway
    expect(toolResult(run.adapter, "task-3-schematic")).toMatchObject({ ok: true, status: "proposal_sealed" });
    expect(catalog.pinFacts!.reads.map((read) => [read.revision, read.role])).toEqual([["rev-current", "current"], [FIXTURE_EXACT.atomicPartRevisionId, "target"]]);
    // the persisted verdicts: every judged result accepted, no escalation, no part review
    expect(verdictsOf(run.history)).toEqual(["task-1-circuit-topology.merge-*:decision:accepted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:decision:accepted", "task-4-verification-critic.merge-*:decision:accepted"]);
    expect(reasonOf(run.history, "task-3-schematic")).toMatch(/^merge accepted: 1 action\(s\) sealed in the specialist's own run by its gateway \(provenance: sealed-in-run\), each passing its family's integrity and currency checks against scope eng1-[0-9a-f]{16}, bound to this run's principal and family lifetime; via openai/);
    expect(reasonOf(run.history, "task-1-circuit-topology")).toMatch(/^merge accepted: no proposed action; via openai/);
    const committed = run.history.filter((entry) => entry.record.kind === "result").map((entry) => (entry.record as unknown as { document: { role: string; proposedActions: ReadonlyArray<{ kind: string }> } }).document);
    expect(committed.map((document) => [document.role, document.proposedActions.map((action) => action.kind)])).toEqual([["circuit-topology", []], ["component-sourcing-evidence", []], ["schematic", [REPLACEMENT_PROPOSAL_SCHEMA]], ["verification-critic", []]]);
    // presented: exactly ONE artifact event on the coordinator's stream - the replacement family's own `proposal_ready`, under the run id
    const artifacts = artifactEvents(run.events);
    expect(artifacts.map((event) => [event.type, (event as { toolId: string }).toolId, event.runId])).toEqual([["proposal_ready", REPLACEMENT, run.runId]]);
    const received = receiveReplacementProposalEvent(JSON.parse(JSON.stringify(artifacts[0])) as { type: string; runId: string; proposal: unknown });
    expect(received).not.toBeNull();
    expect(received!.proposal.componentInstanceId).toBe(TIMER);
    // the target is the server-owned exact authority - the model named only the component
    expect(received!.proposal.target).toMatchObject({ partId: FIXTURE_EXACT.exactMpn, atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, symbolAssetVersionId: FIXTURE_EXACT.symbolAssetVersionId, mappingCertificateId: FIXTURE_EXACT.mappingCertificateId });
    expect(received!.proposal.impact.droppedConnections).toEqual([]);
    expect(run.warnings).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^Orchestration: presented for approval: task-3-schematic action 0 \\(${REPLACEMENT_PROPOSAL_SCHEMA.replaceAll(".", "\\.")}, artifact ${received!.proposal.proposalId}, digest eng1-[0-9a-f]{16}\\)`))]));
    expect(run.followUp).toContain('"approval":{"outcome":"presented"');
    expect(run.followUp).not.toContain("ESCALATED");
    expect(editor.executed()).toBe(0); // presented, never applied
  }, 180_000);

  it("2. the one accepted replacement is APPROVED through the replacement family's EXISTING path with the run's principal: the page's consumer takes the presented `proposal_ready`, the approval controller reauthorizes the live membership through the real apply-authorization route and fetches fresh authority and pin facts through the production channel into the REAL /api/replacement-authority handler, recompiles and byte-matches - ONE canonical transaction; U1 now carries the exact target; the receipt names the coordinator's run and the run's principal. The artifact sealed under a specialist run id is not refused (the replacement records no run id; originRunId is metadata)", async () => {
    const fetchBoundary = stubReplacementAuthorityFetch();
    const editor = await timerEditor();
    const context = timerContext(editor, catalog.authority, live);
    const run = await runScenario(context, { "circuit-topology": { call: { toolId: TIER1, args: DELETE_U1 } }, schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } }, { runId: "run-b21d3-s17-approve" });
    const presented = artifactEvents(run.events);
    expect(presented).toHaveLength(1);
    const received = receiveReplacementProposalEvent(JSON.parse(JSON.stringify(presented[0])) as { type: string; runId: string; proposal: unknown })!;
    expect(received.runId).toBe(run.runId);
    const proposal: SealedReplacementProposal = received.proposal;
    expect(proposal.authorization.principalId).toBe(live.principalId);
    expect(proposal.scope.headMark).toEqual(editor.editor.headMark());
    const before = editor.editor.headMark()!.headSequence;
    const applied = await approveReplacement(editor, proposal, received.runId!);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, status: "committed" });
    if (!applied.ok || applied.status !== "committed") return;
    expect(fetchBoundary.calls()).toBe(1); // the production reauthorization channel ran exactly once, into the real handler
    expect(editor.executed()).toBe(1);
    expect(editor.editor.headMark()!.headSequence).toBe(before + 1);
    const installed = editor.visible().kicadComponents!.find((component) => component.id === TIMER)!;
    expect(installed).toMatchObject({ partId: FIXTURE_EXACT.exactMpn, atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, symbolAssetVersionId: FIXTURE_EXACT.symbolAssetVersionId, mappingCertificateId: FIXTURE_EXACT.mappingCertificateId });
    expect(applied.receipt.originRunId).toBe(run.runId);
    expect(applied.receipt.authorization.principalId).toBe(live.principalId);
    expect(applied.receipt.approvalActor).toBe("human:interactive");
    // applied once: the same approval again is the family's own idempotent answer, never a second transaction
    const again = await approveReplacement(editor, proposal, received.runId!);
    expect(again.ok === false || again.status !== "committed").toBe(true);
    expect(editor.executed()).toBe(1);
  }, 180_000);

  it("3. the reverse, sealer-decided: a replacement whose MODEL names a part that is not the exact authority never seals - the family's assembler refuses `expected-mpn-mismatch` (the caller may assert an expectation, never choose the target); the circuit specialist proposes nothing; no artifact exists, the merge accepts every result with no action (persisted), and NOTHING is presented (`none_accepted`)", async () => {
    const editor = await timerEditor();
    const context = timerContext(editor, catalog.authority, live);
    const run = await runScenario(context, { schematic: { call: { toolId: REPLACEMENT, args: { componentId: TIMER, expectedMpn: "TLC555CP" } } } }, { runId: "run-b21d3-s17-reverse" });
    expect(toolResult(run.adapter, "task-3-schematic")).toMatchObject({ ok: false, status: "proposal_blocked", blockers: [{ code: "expected-mpn-mismatch" }] });
    expect(run.warnings).toContain("Orchestration: specialist schematic (task task-3-schematic, attempt 0) tool sirkit.schematic.propose-component-replacement refused: proposal_blocked.");
    expect(artifactEvents(run.events)).toEqual([]);
    expect(verdictsOf(run.history)).toEqual(["task-1-circuit-topology.merge-*:decision:accepted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:decision:accepted", "task-4-verification-critic.merge-*:decision:accepted"]);
    expect(run.warnings.some((message) => message.includes("presented for approval"))).toBe(false);
    expect(run.followUp).toContain('"approval":{"outcome":"none_accepted","presented":null}');
    expect(run.followUp).not.toContain("TLC555CP");
  }, 180_000);

  it("4. UNRESOLVABLE, escalated: both parties SEAL and each passes its family's verification - the circuit specialist's Tier 1 relabel of U1 and the schematic specialist's exact replacement of U1 - and they conflict on U1 (`same_field`, part): both are `contradicted`, ONE escalation record names what the human must decide (the exact authority cited, 'Nothing was applied'), and NOTHING is presented; the parties are one source (the coordinator's provider) and agreement or number is never proof", async () => {
    const editor = await timerEditor();
    const context = timerContext(editor, catalog.authority, live);
    const run = await runScenario(context, { "circuit-topology": { call: { toolId: TIER1, args: RELABEL_U1 } }, schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } }, { runId: "run-b21d3-s17-escalated" });
    expect(toolResult(run.adapter, "task-1-circuit-topology")).toMatchObject({ ok: true, status: "proposal_sealed" });
    expect(toolResult(run.adapter, "task-3-schematic")).toMatchObject({ ok: true, status: "proposal_sealed" });
    expect(verdictsOf(run.history)).toEqual(["task-1-circuit-topology.merge-*:dissent:contradicted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:dissent:contradicted", "task-4-verification-critic.merge-*:decision:accepted", "merge:decision:escalated"]);
    for (const task of ["task-1-circuit-topology", "task-3-schematic"]) expect(reasonOf(run.history, task), task).toMatch(/^merge contradicted: conflict:same_field; via openai/);
    const escalation = run.history.find((entry) => entry.taskId.startsWith(MERGE_TASK_PREFIX))!.record as { reason: string };
    expect(escalation.reason).toMatch(/^merge escalated same_field \(part[^)]*\) over [^:]*component:u1-id[^:]*: task-1-circuit-topology#0, task-3-schematic#0; resolutions keep_head, manual_operation, proposal_branch, reject$/);
    expect(artifactEvents(run.events)).toEqual([]);
    expect(run.warnings.filter((message) => message.startsWith("Orchestration: merge: ESCALATED to the human (same_field; part"))).toHaveLength(1);
    expect(run.warnings.filter((message) => message.startsWith("Orchestration: merge: ESCALATED"))[0]).toContain("1 source(s)");
    expect(run.warnings.some((message) => message.includes("presented for approval"))).toBe(false);
    expect(run.followUp).toContain('"approval":{"outcome":"escalated","presented":null}');
    expect(run.followUp).toMatch(/"humanDecision":"The human must decide: 2 proposed actions touch the same part[^"]*Allowed resolutions: keep_head, manual_operation, proposal_branch, reject\. Nothing was applied\. The server-owned exact authority for u1-id is STM32F411CEU6 \(atomic-revision-1\); only it may be a replacement target \(OD-130\)[^"]*agreement or number is never proof\./);
    expect(run.followUp).toContain('"sameSource":true');
    expect(editor.executed()).toBe(0);
  }, 180_000);

  it("5. OD-130's part review, from a REAL seal: the first run of the coordinator ran while the catalog's exact target for U1 was its EARLIER selection - the schematic specialist sealed the replacement to that target from its published facts, the merge accepted it and it was presented; the selection then MOVED, and a resume of the SAME coordinator run (the scheduler's own resume path) replays the committed seal - the merge judges it against the authority as it stands: `contradicted` (`part-not-exact-authority`) and a part review request for `request_atomic_review` naming the earlier part and the exact authority, the schematic task's verdict chained (accepted, then contradicted - the latest stands), NOTHING presented (`review_requested`); and the artifact presented before the move is REFUSED by the family's own approval path, which re-verifies it against fresh authority", async () => {
    stubReplacementAuthorityFetch();
    const editor = await timerEditor();
    const earlier = timerContext(editor, earlierAuthority(catalog.authority), live);
    const current = timerContext(editor, catalog.authority, live);
    const runId = "run-b21d3-s17-review";
    const store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    const first = await runScenario(earlier, { schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } }, { runId, store });
    const before = artifactEvents(first.events);
    expect(before.map((event) => event.type)).toEqual(["proposal_ready"]);
    const stale = receiveReplacementProposalEvent(JSON.parse(JSON.stringify(before[0])) as { type: string; runId: string; proposal: unknown })!.proposal;
    expect(stale.target).toMatchObject({ partId: EARLIER.mpn, atomicPartRevisionId: EARLIER.atomicPartRevisionId });
    expect(catalog.pinFacts!.reads.map((read) => [read.revision, read.role])).toEqual([["rev-current", "current"], [EARLIER.atomicPartRevisionId, "target"]]);
    // the resume through the REAL runtime, under the authority as it stands now: no specialist runs again
    const run = await runScenario(current, {}, { runId, store });
    expect(run.adapter.starts.map((start) => start.role)).toEqual(["coordinator", "coordinator"]);
    expect(run.warnings.filter((message) => message.includes("replayed from the record"))).toHaveLength(4);
    expect(verdictsOf(run.history).filter((verdict) => verdict.startsWith("task-3-schematic"))).toEqual(["task-3-schematic.merge-*:decision:accepted", "task-3-schematic.merge-*:dissent:contradicted"]);
    expect(reasonOf(run.history, "task-3-schematic")).toMatch(/^merge contradicted: part-not-exact-authority; via \(replayed: provenance not recorded\)/);
    const reviews = run.history.filter((entry) => entry.taskId.startsWith(MERGE_TASK_PREFIX)).map((entry) => entry.record as { kind: string; decision: string; reason: string });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ kind: "decision", decision: "escalated" });
    expect(reviews[0]!.reason).toBe(`merge part review (OD-130): task-3-schematic#0 names ${EARLIER.mpn} for ${TIMER}; exact authority ${FIXTURE_EXACT.exactMpn} (${FIXTURE_EXACT.atomicPartRevisionId}); path request_atomic_review`);
    expect(run.warnings).toContain(`Orchestration: merge: PART REVIEW requested (OD-130): task-3-schematic action 0 names ${EARLIER.mpn} for ${TIMER}; the exact authority is ${FIXTURE_EXACT.exactMpn}; request_atomic_review; nothing was applied.`);
    expect(artifactEvents(run.events)).toEqual([]);
    expect(run.followUp).toContain('"approval":{"outcome":"review_requested","presented":null}');
    expect(run.followUp).toContain(`"candidatePartId":"${EARLIER.mpn}","exactAuthority":{"mpn":"${FIXTURE_EXACT.exactMpn}","atomicPartRevisionId":"${FIXTURE_EXACT.atomicPartRevisionId}"},"path":"request_atomic_review"`);
    // the artifact presented before the move: the family's approval re-verifies it against FRESH authority and refuses it
    const refused = await approveReplacement(editor, stale, runId);
    expect(refused, JSON.stringify(refused)).toMatchObject({ ok: false, status: "refused", code: "verification-failed" });
    expect(editor.executed()).toBe(0);
  }, 180_000);

  it("6. the never-execution sweep through the specialist gateway WITH the pin-facts reader (and, as the worst case, a REAL minter and the prompt version under it): for every role over the whole registry and the coordinator's worst context, no descriptor yields an execution grant, a view command or a layout candidate and the minter is never called; a proposal seals only through the role's own LIVE ids - the replacement for the schematic role alone; the coordinator's grantable context through the same wrapper is refused `role_context_elevated`", async () => {
    const coordinator = grantableContext();
    let calls = 0;
    const real = createExecutionGrantMinter({
      principalId: "u-1", role: "project_admin", membershipRevision: "mbr1-a", authClass: "local_dev", sessionIdentity: "sess-1", correlationId: "corr-b21d3",
      scope: ROLE_SCOPE, boardInstanceId: null, autonomy: EXPLICIT_AUTONOMY, userMessage: "Move R3 2 mm to the right.",
      runId: "run-b21d3-sweep", provider: "openai", store: new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()), now: () => Date.parse("2026-09-26T12:00:00.000Z"),
    });
    const minter: AgentExecutionGrantMinter = { mint: (request) => { calls += 1; return real.mint(request); }, awaitSettlement: (id, options) => real.awaitSettlement(id, options), retireIssued: (reason, explicit) => real.retireIssued(reason, explicit) };
    const options = specialistGatewayOptions();
    expect(Object.keys(options ?? {})).toEqual(["replacementPinFacts"]);
    const underlying = createAgentToolGateway(REGISTRY, { ...options, executionGrants: minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION });
    const ARTIFACT_KINDS: ReadonlyArray<GatewayInvocationOutcome["kind"]> = ["execution-grant", "view-command", "layout-candidate"];
    const argsFor = (toolId: string): Record<string, unknown> => (toolId === "sirkit.pcb.move-footprint" ? MOVE_R3_ARGS : toolId === TIER1 ? { ops: [{ op: "set-value", target: "U1", value: "TLC555" }] } : toolId === REPLACEMENT ? REPLACE_U1 : toolId === "sirkit.pcb.propose-bounded-edit" ? { intent: "widen", operations: [] } : {});
    const sealed: string[] = [];
    for (const role of SPECIALIST_ROLES.filter((entry) => entry !== "coordinator")) {
      const context: AgentRunContext = specialistContextFor(coordinator, role);
      const allowed = specialistAllowedToolIds(REGISTRY, context, buildRunToolset, role);
      const wrapper = readOnlySpecialistGateway(underlying, REGISTRY, allowed);
      for (const descriptor of REGISTRY.list()) {
        const request = { runId: "run-b21d3-sweep", provider: "openai" as const, callId: `call-${role}-${descriptor.toolId}`, toolId: descriptor.toolId, version: descriptor.version, args: argsFor(descriptor.toolId), context, timeoutMs: 5_000 };
        const outcome = await wrapper.invoke(request);
        expect(ARTIFACT_KINDS, `${role}: ${descriptor.toolId}`).not.toContain(outcome.kind);
        if (outcome.kind === "proposal" || outcome.kind === "pcb-proposal") {
          sealed.push(`${role}:${descriptor.toolId}`);
          expect(roleProposalToolIds(role), `${role}: ${descriptor.toolId}`).toContain(descriptor.toolId);
        }
        if (!allowed.includes(descriptor.toolId)) expect(outcome, `${role}: ${descriptor.toolId}`).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
        expect(await wrapper.invoke({ ...request, context: coordinator }), `${role}: ${descriptor.toolId} elevated`).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_CONTEXT_REFUSAL_STATUS });
      }
    }
    // not vacuous: the replacement really sealed through the reader - for the schematic role only - and so did the live Tier 1 edit
    expect(sealed.filter((entry) => entry.endsWith(REPLACEMENT))).toEqual([`schematic:${REPLACEMENT}`]);
    expect(sealed.filter((entry) => entry.endsWith(TIER1)).sort()).toEqual([`circuit-topology:${TIER1}`, `schematic:${TIER1}`]);
    expect(calls).toBe(0);
    expect(catalog.pinFacts!.reads.length).toBeGreaterThan(0);
  }, 180_000);

  it("7. [B21 D3 fix] (review coverage-3, tests-2) the control run - case 1 stated honestly, ONE PARTY CANNOT SEAL: with NO peer (the schematic specialist proposes nothing) the circuit specialist's delete of U1 is refused exactly as in case 1 (`pins-unavailable`, naming U1), the persisted verdicts are the same four `accepted` (task 1 with no proposed action - no conflict reaches the merge) and NOTHING is presented (`none_accepted`); the coordinator's own gateway refuses the same delete the same way - the agent path compiles every Tier 1 proposal with an EMPTY pin map, so any KiCad delete through any agent gateway blocks. The refusal does not depend on the replacement: case 1's presentation follows the schematic seal alone, and whether scenario 17 presents (a delete, which cannot seal) or escalates (an edit that seals, case 4) follows the circuit specialist's op choice - two SEALED parties on U1 always escalate", async () => {
    const editor = await timerEditor();
    const context = timerContext(editor, catalog.authority, live);
    const run = await runScenario(context, { "circuit-topology": { call: { toolId: TIER1, args: DELETE_U1 } } }, { runId: "run-b21d3-s17-control" });
    expect(run.adapter.starts.map((start) => start.role)).toEqual(REPLACEMENT_DAG);
    expect(toolResult(run.adapter, "task-1-circuit-topology")).toMatchObject({ ok: false, status: "proposal_blocked", blockers: [{ code: "pins-unavailable", detail: expect.stringContaining("computed for U1.") }] });
    expect(verdictsOf(run.history)).toEqual(["task-1-circuit-topology.merge-*:decision:accepted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:decision:accepted", "task-4-verification-critic.merge-*:decision:accepted"]);
    expect(reasonOf(run.history, "task-1-circuit-topology")).toMatch(/^merge accepted: no proposed action; via openai/);
    expect(run.history.some((entry) => entry.record.kind === "dissent")).toBe(false);
    expect(artifactEvents(run.events)).toEqual([]);
    expect(run.followUp).toContain('"approval":{"outcome":"none_accepted","presented":null}');
    // the same delete through the COORDINATOR's own gateway (the route's options, no specialist anywhere): the same refusal
    const direct = await coordinatorGateway(new AbortController().signal).invoke({ runId: "run-b21d3-s17-direct", provider: "openai", callId: "call-direct-delete", toolId: TIER1, version: REGISTRY.get(TIER1)!.version, args: DELETE_U1, context, timeoutMs: 5_000 });
    expect(direct).toMatchObject({ kind: "proposal-blocked", ok: false, blockers: [{ code: "pins-unavailable", detail: expect.stringContaining("computed for U1.") }] });
    expect(editor.executed()).toBe(0);
  }, 180_000);

  it("8. [B21 D3 fix] (review coverage-5) the DAG's order is a presentation and budget order ONLY - no specialist consumes another's result before B21-E: every specialist starts from an objective built from the coordinator's user message ALONE (specialistObjective; its loop history is empty), so the schematic specialist that runs after the sourcing specialist never sees its evidence and the critic that runs last never sees the sealed replacement; the seal's target is the verified exact authority of the coordinator's context; the sourcing evidence reaches only the record and the follow-up turn", async () => {
    const editor = await timerEditor();
    const context = timerContext(editor, catalog.authority, live);
    const MARK = "sourcing-evidence-mark-d3fix";
    const run = await runScenario(context, { "component-sourcing-evidence": { text: specialistResult("component-sourcing-evidence", { summary: `(scripted) ${MARK}` }) }, schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } }, { runId: "run-b21d3-s17-order" });
    const specialists = run.adapter.starts.filter((start) => start.role !== "coordinator");
    expect(specialists.map((start) => start.role)).toEqual(DAG_ROLE_LISTS["component-replacement"].slice(1));
    for (const start of specialists) {
      const proposing = start.tools.some((toolId) => REGISTRY.get(toolId)?.operationClass === "propose");
      expect(start.userMessage, start.role).toBe(specialistObjective(start.role as SpecialistRole, SCENARIO_17, proposing));
    }
    const presented = artifactEvents(run.events);
    expect(presented.map((event) => event.type)).toEqual(["proposal_ready"]);
    const proposal = receiveReplacementProposalEvent(JSON.parse(JSON.stringify(presented[0])) as { type: string; runId: string; proposal: unknown })!.proposal;
    expect(proposal.target).toMatchObject({ partId: FIXTURE_EXACT.exactMpn, atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId }); // the context's authority, not the evidence
    for (const role of ["schematic", "verification-critic"]) {
      const start = specialists.find((entry) => entry.role === role)!;
      expect(`${start.system}${start.userMessage}`, role).not.toContain(MARK);
    }
    const critic = specialists.find((entry) => entry.role === "verification-critic")!;
    expect(`${critic.system}${critic.userMessage}`).not.toContain(proposal.proposalId);
    expect(run.followUp).toContain(MARK);
  }, 180_000);
});
