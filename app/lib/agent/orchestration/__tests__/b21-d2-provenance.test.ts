/**
 * [B21 D2] An artifact's provenance is the gateway's own seal. Over the REAL scheduler, the REAL loop, the production registry
 * and the bare specialist gateway (as the composition root builds it), a proposing role's specialist SEALS a real Tier 1 proposal
 * and a real bounded PCB edit through its own offered tool; the scheduler collects every artifact that run's gateway sealed (the
 * run's own `proposal_ready` / `pcb_proposal_ready` events) and ONLY those become the result's `proposedActions` - wrapped as A's
 * contracts require, `artifactDigest` recomputed - whatever the model listed; an entry the model wrote that is not an artifact its
 * run sealed is refused BEFORE the merge (`proposal_not_sealed_in_run`, dissent `malformed`); the merge accepts the sealed ones
 * with `provenance: sealed-in-run` and never says "provenance not established" of a specialist's action, and refuses on its own
 * an action outside a task's sealed set (`proposal-not-sealed-in-run`). The never-execution sweep through the D2 specialist
 * wrapper, with a real minter under it, still mints nothing. The replacement proposal stays dormant: its sealer needs the pin-facts
 * reads only the coordinator's gateway holds - through the bare specialist gateway it blocks (the evidence for OD-120's option).
 */
import { describe, expect, it } from "vitest";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { ExecutionGrantStore } from "@/app/lib/execution-grant/store";
import { createExecutionGrantMinter } from "@/app/lib/execution-grant/mint";
import { AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { buildRunToolset } from "@/app/lib/agent/loop";
import type { AgentExecutionGrantMinter, AgentRunContext, AgentRunEvent, AgentToolInvocationGateway, GatewayInvocationOutcome } from "@/app/lib/agent/contracts";
import { SPECIALIST_ROLES } from "../contracts";
import { roleProposalToolIds } from "../role-tools";
import { PROPOSAL_NOT_SEALED_IN_RUN, SEALED_PROPOSALS_RULE, SPECIALIST_CONTEXT_REFUSAL_STATUS, SPECIALIST_REFUSAL_STATUS, attachSealedArtifacts, parseSpecialistResult, readOnlySpecialistGateway, specialistAllowedToolIds, specialistContextFor, type SchedulerOutcome, type SpecialistTaskOutcome } from "../scheduler";
import { mergeSpecialistOutcome, specialistApprovalDecision, type MergeOutcome } from "../merge";
import { REGISTRY, action, coordinatorContext, mergeDeps, sealTier1 } from "./_merge-fixtures";
import { pinFacts } from "./_sealed-artifacts";
import { EXPLICIT_AUTONOMY, MOVE_R3_ARGS, ROLE_SCOPE, grantableContext } from "./_role-fixtures";
import { PCB_EDIT_ARGS, TIER1_ARGS, runProposingDag, specialistResult } from "./_d2-fixtures";

const registry = sirkitToolRegistry();
const TIER1 = "sirkit.schematic.propose-tier1-edit";
const PCB_EDIT = "sirkit.pcb.propose-bounded-edit";
const REPLACEMENT = "sirkit.schematic.propose-component-replacement";
type Merged = Extract<MergeOutcome, { kind: "merged" }>;
const merged = (outcome: MergeOutcome): Merged => {
  if (outcome.kind !== "merged") throw new Error(`the merge refused: ${outcome.reason} ${outcome.detail}`);
  return outcome;
};
const sealsOf = (events: readonly AgentRunEvent[]): unknown[] => events.flatMap((event): unknown[] => (event.type === "proposal_ready" || event.type === "pcb_proposal_ready" ? [event.proposal] : event.type === "layout_candidate_ready" ? [event.candidate] : []));
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** A gateway that records every artifact the bare specialist gateway seals (the test reads what a model could only name). */
function recording(): AgentToolInvocationGateway & { sealed: unknown[] } {
  const bare = createAgentToolGateway(REGISTRY);
  const sealed: unknown[] = [];
  return { sealed, async invoke(request) { const outcome = await bare.invoke(request); if (outcome.kind === "proposal" || outcome.kind === "pcb-proposal") sealed.push(outcome.proposal); return outcome; } };
}
const ARTIFACT_KINDS: ReadonlyArray<GatewayInvocationOutcome["kind"]> = ["execution-grant", "view-command", "layout-candidate"];

describe("[B21 D2] provenance is the gateway's own seal", () => {
  it("1. a circuit-topology specialist SEALS a real Tier 1 proposal through its own offered tool (the real loop, the bare specialist gateway): the run's gateway emitted `proposal_ready`; the result's proposedActions are EXACTLY that artifact - kind, verbatim payload, artifactDigest recomputed - although the model listed none; the committed record holds it; the outcome names the sealed digest; nothing of the seal reached the coordinator's stream", async () => {
    const run = await runProposingDag(["circuit-topology"], { "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } } });
    expect(run.adapter.starts[0]!.tools).toContain(TIER1);
    const sealed = sealsOf(run.loops[0]!.events);
    expect(sealed).toHaveLength(1);
    const artifact = plain(sealed[0]) as Record<string, unknown>;
    expect(artifact.schema).toBe("sirkit.schematic-tier1-proposal.v3");
    expect((artifact.authorization as { principalId: string }).principalId).toBe(run.context.actor.actorId);
    const task = run.outcome.tasks[0]!;
    expect([task.status, task.reason]).toEqual(["accepted", null]);
    expect(task.result!.proposedActions).toHaveLength(1);
    const attached = task.result!.proposedActions[0]!;
    expect(attached.kind).toBe("sirkit.schematic-tier1-proposal.v3");
    expect(plain(attached.payload)).toEqual(artifact);
    expect(attached.artifactDigest).toBe(engineeringDigest(artifact));
    expect(task.sealedArtifactDigests).toEqual([attached.artifactDigest]);
    // the model's own final text listed nothing: the scheduler attached what the gateway sealed
    expect(run.adapter.finals.map((entry) => [entry.task, (JSON.parse(entry.text) as { proposedActions: unknown[] }).proposedActions])).toEqual([["task-1-circuit-topology", []]]);
    const committed = (await run.store.history(run.scope)).find((entry) => entry.record.kind === "result")!;
    expect(committed.record.kind === "result" && plain(committed.record.document.proposedActions)).toEqual([plain(attached)]);
    expect(committed.record.kind === "result" && committed.record.digest).toBe(task.resultDigest);
    expect(run.events.filter((event) => event.type !== "warning")).toEqual([]);
  });

  it("2. a pcb-placement-routing specialist SEALS a real bounded PCB edit the same way: `pcb_proposal_ready` in its own run, the result's proposedActions exactly that artifact, its sealed provenance naming the SPECIALIST's own run id (never the coordinator's), its base the coordinator's verified PCB basis", async () => {
    const run = await runProposingDag(["pcb-placement-routing"], { "pcb-placement-routing": { call: { toolId: PCB_EDIT, args: PCB_EDIT_ARGS() } } });
    expect(run.adapter.starts[0]!.tools).toContain(PCB_EDIT);
    expect(run.loops[0]!.events.filter((event) => event.type === "pcb_proposal_ready")).toHaveLength(1);
    const artifact = plain(sealsOf(run.loops[0]!.events)[0]) as { schema: string; provenance: { runId: string }; base: { historyHead: { sequence: number }; lineageId: string } };
    expect(artifact.schema).toBe("sirkit.pcb-bounded-edit-proposal.v2");
    expect(artifact.provenance.runId).toBe(`${run.scope.runId}:task-1-pcb-placement-routing`);
    expect(artifact.base.historyHead.sequence).toBe(run.context.pcbProposalBasis!.historyHeadSequence);
    expect(artifact.base.lineageId).toBe(run.context.pcbProposalBasis!.lineageId);
    const task = run.outcome.tasks[0]!;
    expect(task.status).toBe("accepted");
    expect(task.result!.proposedActions.map((entry) => [entry.kind, entry.artifactDigest])).toEqual([["sirkit.pcb-bounded-edit-proposal.v2", engineeringDigest(artifact)]]);
    expect(plain(task.result!.proposedActions[0]!.payload)).toEqual(artifact);
  });

  it("3. an entry the MODEL wrote that is not an artifact its run sealed is refused BEFORE the merge (`proposal_not_sealed_in_run`, dissent `malformed`): a real, hand-sealed Tier 1 listed by a specialist that sealed nothing, and a specialist that sealed 10k but lists ANOTHER sealed artifact (4k7); listing the very artifact its run sealed is accepted and never duplicated", async () => {
    const forged = action(sealTier1([{ op: "set-value", target: "U1", value: "4k7" }]));
    const copier = recording();
    const run = await runProposingDag(["circuit-topology", "schematic", "circuit-topology"], {
      "task-1-circuit-topology": { text: specialistResult("circuit-topology", { proposedActions: [forged] }) },
      "task-2-schematic": { call: { toolId: TIER1, args: TIER1_ARGS("10k") }, text: specialistResult("schematic", { proposedActions: [forged] }) },
      "task-3-circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("22k") }, text: () => specialistResult("circuit-topology", { proposedActions: [action(copier.sealed.at(-1) as object), action(copier.sealed.at(-1) as object)] }) },
    }, { gateway: copier });
    expect(run.outcome.tasks.map((task) => [task.taskId, task.status])).toEqual([["task-1-circuit-topology", "malformed"], ["task-2-schematic", "malformed"], ["task-3-circuit-topology", "accepted"]]);
    for (const task of run.outcome.tasks.slice(0, 2)) {
      expect(task.reason, task.taskId).toMatch(new RegExp(`^${PROPOSAL_NOT_SEALED_IN_RUN}: `));
      expect(task.result, task.taskId).toBeNull();
    }
    const dissents = (await run.store.history(run.scope)).filter((entry) => entry.record.kind === "dissent");
    expect(dissents.map((entry) => [entry.taskId, (entry.record as { decision: string }).decision, (entry.record as { reason: string }).reason.split(":")[0]])).toEqual([["task-1-circuit-topology", "malformed", PROPOSAL_NOT_SEALED_IN_RUN], ["task-2-schematic", "malformed", PROPOSAL_NOT_SEALED_IN_RUN]]);
    const verbatim = run.outcome.tasks[2]!;
    expect(verbatim.result!.proposedActions).toHaveLength(1);
    expect(verbatim.result!.proposedActions[0]!.artifactDigest).toBe(engineeringDigest(plain(copier.sealed.at(-1))));
    // the merge never sees the refused results: only the usable one is judged
    const outcome = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
    expect(outcome.tasks.map((task) => [task.taskId, task.decision])).toEqual([["task-3-circuit-topology", "accepted"]]);
  });

  it("4. the merge ACCEPTS what the run sealed with `provenance: sealed-in-run` and never says \"provenance not established\" of a specialist's action; an action handed to the merge outside its task's sealed set (a hand-built outcome that bypassed the scheduler, the field emptied or absent) is `malformed` by the merge's own second check (`proposal-not-sealed-in-run`) and never accepted", async () => {
    const run = await runProposingDag(["circuit-topology", "pcb-placement-routing"], {
      "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } },
      "pcb-placement-routing": { call: { toolId: PCB_EDIT, args: PCB_EDIT_ARGS() } },
    });
    const judged = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
    expect(judged.tasks.map((task) => task.decision)).toEqual(["accepted", "accepted"]);
    expect(judged.accepted.map((entry) => [entry.kind, entry.provenance])).toEqual([["sirkit.schematic-tier1-proposal.v3", "sealed-in-run"], ["sirkit.pcb-bounded-edit-proposal.v2", "sealed-in-run"]]);
    for (const task of judged.tasks) {
      expect(task.reason, task.taskId).toMatch(/provenance: sealed-in-run/);
      expect(task.reason, task.taskId).not.toMatch(/provenance not established/);
      for (const entry of task.actions) expect(entry.provenance, task.taskId).toBe("sealed-in-run");
    }
    // the merge's own second check: the same accepted results, their sealed set emptied or absent (a caller that bypassed the scheduler)
    const emptied: Extract<SchedulerOutcome, { kind: "ran" }> = { ...run.outcome, tasks: run.outcome.tasks.map((task): SpecialistTaskOutcome => ({ ...task, sealedArtifactDigests: [] })) };
    const absent: Extract<SchedulerOutcome, { kind: "ran" }> = { ...run.outcome, tasks: run.outcome.tasks.map(({ sealedArtifactDigests: _drop, ...task }): SpecialistTaskOutcome => { void _drop; return task; }) };
    for (const [label, outcome] of [["emptied", emptied], ["absent", absent]] as const) {
      const refused = merged(await mergeSpecialistOutcome({ runId: `${run.scope.runId}-${label}`, context: run.context, outcome }, mergeDeps(run.store, { now: () => Date.now() })));
      expect(refused.tasks.map((task) => [task.decision, task.findings.map((finding) => finding.code)]), label).toEqual([["malformed", ["proposal-not-sealed-in-run"]], ["malformed", ["proposal-not-sealed-in-run"]]]);
      expect(refused.accepted, label).toEqual([]);
      for (const task of refused.tasks) for (const entry of task.actions) expect(entry.provenance, label).toBeNull();
    }
  });

  it("5. the never-execution sweep through the D2 specialist wrapper, for every role over the whole registry, with a REAL minter under it and the proposing context: no descriptor yields an execution grant, a view command or a layout candidate and the minter is never called; a proposal is sealed only through the role's own LIVE proposal ids; the coordinator's grantable context through the same wrapper is refused `role_context_elevated` for every descriptor", async () => {
    const coordinator = grantableContext();
    let calls = 0;
    const real = createExecutionGrantMinter({
      principalId: "u-1", role: "project_admin", membershipRevision: "mbr1-a", authClass: "local_dev", sessionIdentity: "sess-1", correlationId: "corr-b21d2",
      scope: ROLE_SCOPE, boardInstanceId: null, autonomy: EXPLICIT_AUTONOMY, userMessage: "Move R3 2 mm to the right.",
      runId: "run-b21d2-sweep", provider: "openai", store: new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()), now: () => Date.parse("2026-09-26T12:00:00.000Z"),
    });
    const minter: AgentExecutionGrantMinter = { mint: (request) => { calls += 1; return real.mint(request); }, awaitSettlement: (id, options) => real.awaitSettlement(id, options), retireIssued: (reason, explicit) => real.retireIssued(reason, explicit) };
    const withMinter = createAgentToolGateway(registry, { executionGrants: minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION });
    const argsFor = (toolId: string): Record<string, unknown> => (toolId === "sirkit.pcb.move-footprint" ? MOVE_R3_ARGS : toolId === TIER1 ? TIER1_ARGS("10k") : toolId === PCB_EDIT ? PCB_EDIT_ARGS() : {});
    let proposals = 0;
    for (const role of SPECIALIST_ROLES.filter((entry) => entry !== "coordinator")) {
      const context: AgentRunContext = specialistContextFor(coordinator, role);
      const allowed = specialistAllowedToolIds(registry, context, buildRunToolset, role);
      const wrapper = readOnlySpecialistGateway(withMinter, registry, allowed);
      for (const descriptor of registry.list()) {
        const request = { runId: "run-b21d2-sweep", provider: "openai" as const, callId: `call-${role}-${descriptor.toolId}`, toolId: descriptor.toolId, version: descriptor.version, args: argsFor(descriptor.toolId), context, timeoutMs: 5_000 };
        const outcome = await wrapper.invoke(request);
        expect(ARTIFACT_KINDS, `${role}: ${descriptor.toolId}`).not.toContain(outcome.kind);
        if (outcome.kind === "proposal" || outcome.kind === "pcb-proposal") {
          proposals += 1;
          expect(roleProposalToolIds(role), `${role}: ${descriptor.toolId}`).toContain(descriptor.toolId);
        }
        if (!allowed.includes(descriptor.toolId)) expect(outcome, `${role}: ${descriptor.toolId}`).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
        expect(await wrapper.invoke({ ...request, context: coordinator }), `${role}: ${descriptor.toolId} elevated`).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_CONTEXT_REFUSAL_STATUS });
      }
    }
    expect(proposals).toBeGreaterThan(0); // the sweep is not vacuous: the live Tier 1 edit really sealed for the proposing roles
    expect(calls).toBe(0);
  }, 180_000);

  it("6. the replacement proposal stays DORMANT for specialists (OD-120 amended; the D2 stop condition): even with U1's exact authority and the head mark in the coordinator's context the schematic specialist is never offered it and the wrapper refuses it; through the bare specialist gateway its sealer BLOCKS for want of the server's published pin facts, and through a gateway that holds them (the coordinator's composition) the same call seals - the pin-facts reads are the one thing a specialist seal of it would need, and the specialist gateway is never given them", async () => {
    const context = coordinatorContext();
    expect(context.componentAuthority).not.toBeNull();
    const proposing = specialistContextFor(context, "schematic");
    const allowed = specialistAllowedToolIds(registry, proposing, buildRunToolset, "schematic");
    // [B21 D3] pin move (OD-120 amended): the replacement is LIVE for the schematic role since D3 - the runtime hands the specialist gateway the published pin-facts reads (b21-d3-pin-facts); the title's "stays DORMANT" is D2's, kept for the closeout's retitle
    // (OD-113's pattern): the schematic specialist IS offered it and the wrapper passes it; a gateway WITHOUT the reads still blocks it
    expect(allowed).toEqual(["sirkit.schematic.inspect", REPLACEMENT, TIER1]);
    const descriptor = registry.get(REPLACEMENT)!;
    const request = { runId: "run-b21d2-replacement", provider: "openai" as const, callId: "call-replacement", toolId: REPLACEMENT, version: descriptor.version, args: { componentId: "u1-id" }, context: proposing, timeoutMs: 5_000 };
    const wrapped = await readOnlySpecialistGateway(createAgentToolGateway(registry), registry, allowed).invoke(request);
    expect(wrapped.kind === "proposal-blocked" && wrapped.blockers.map((blocker) => blocker.code)).toEqual(["current-pin-authority-unavailable"]);
    expect(SPECIALIST_REFUSAL_STATUS).toBe("role_not_permitted_tool");
    const bare = await createAgentToolGateway(registry).invoke(request);
    expect(bare).toMatchObject({ kind: "proposal-blocked", ok: false });
    expect(bare.kind === "proposal-blocked" && bare.blockers.map((blocker) => blocker.code)).toEqual(["current-pin-authority-unavailable"]);
    const withFacts = createAgentToolGateway(registry, { replacementPinFacts: async (revision, role) => (role === "current" ? pinFacts("rev-old", "sym-old", "cert-old") : revision === "rev-new" ? pinFacts("rev-new", "sym-new") : null) });
    expect((await withFacts.invoke(request)).kind).toBe("proposal");
  });

  it("7. a seal made by an attempt that then FAILED stays with that attempt: the circuit specialist seals a Tier 1 edit and the provider then fails retryably (rate_limit) - attempt 0 is escalated and carries its sealed digest; attempt 1 answers without sealing and its result carries NO proposedActions (the collector is per attempt); had attempt 1 LISTED attempt 0's artifact, its result is refused `proposal_not_sealed_in_run`; and the failed attempt's seal, which no merge judged, withholds the presentation (`incomplete`)", async () => {
    const script = { call: { toolId: TIER1, args: TIER1_ARGS("10k") }, firstAttemptOnly: true, failContinue: { reason: "rate_limit" as const, times: 1 } };
    const run = await runProposingDag(["circuit-topology"], { "circuit-topology": script }, { runId: "run-b21d2-retry" });
    const sealed = sealsOf(run.loops[0]!.events);
    expect(sealed).toHaveLength(1);
    expect(sealsOf(run.loops[1]!.events)).toEqual([]);
    const digest = engineeringDigest(plain(sealed[0]));
    expect(run.outcome.tasks.map((task) => [task.attempt, task.status, task.sealedArtifactDigests])).toEqual([[0, "escalated", [digest]], [1, "accepted", []]]);
    expect(run.outcome.tasks[0]!.reason).toMatch(/^provider_rate_limit: /);
    expect(run.outcome.tasks[1]!.result!.proposedActions).toEqual([]);
    const judged = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
    expect(judged.tasks.map((task) => [task.attempt, task.decision])).toEqual([[1, "accepted"]]);
    expect(specialistApprovalDecision(judged, { coordinatorSealed: false, outcome: run.outcome }).outcome).toBe("incomplete");
    // the same, but attempt 1 LISTS attempt 0's artifact: refused before the merge - a seal never crosses attempts
    const copier = recording();
    const listing = await runProposingDag(["circuit-topology"], { "circuit-topology": { ...script, text: () => specialistResult("circuit-topology", { proposedActions: [action(copier.sealed[0] as object)] }) } }, { gateway: copier, runId: "run-b21d2-retry-listing" });
    expect(copier.sealed).toHaveLength(1);
    expect(listing.outcome.tasks.map((task) => [task.attempt, task.status])).toEqual([[0, "escalated"], [1, "malformed"]]);
    expect(listing.outcome.tasks[1]!.reason).toMatch(new RegExp(`^${PROPOSAL_NOT_SEALED_IN_RUN}: `));
    expect(listing.outcome.tasks[1]!.sealedArtifactDigests).toEqual([]);
  });

  it("8. at most ONE proposal per specialist run, enforced by the loop's own single-flight (the frame's rule says so): a specialist that calls its Tier 1 tool twice seals once - the second call is refused `proposal_exists` (one bounded refusal line on the coordinator's stream) - so its result carries exactly one sealed artifact, the merge accepts one action and the decision presents it", async () => {
    expect(SEALED_PROPOSALS_RULE).toMatch(/At most one proposal per run: a second proposal call is refused \(`proposal_exists`\)\.$/);
    const run = await runProposingDag(["circuit-topology"], { "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") }, more: [{ toolId: TIER1, args: TIER1_ARGS("22k") }] } }, { runId: "run-b21d2-two-calls" });
    expect(run.adapter.continued).toHaveLength(2);
    expect(sealsOf(run.loops[0]!.events)).toHaveLength(1);
    expect(run.loops[0]!.events.flatMap((event) => (event.type === "tool_refused" ? [[event.toolId, event.status]] : []))).toEqual([[TIER1, "proposal_exists"]]);
    expect(run.events.flatMap((event) => (event.type === "warning" ? [event.message] : [])).filter((message) => message.includes(`tool ${TIER1} refused: proposal_exists.`))).toHaveLength(1);
    const task = run.outcome.tasks[0]!;
    expect([task.status, task.result!.proposedActions.length, task.sealedArtifactDigests!.length]).toEqual(["accepted", 1, 1]);
    const judged = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
    expect(judged.accepted).toHaveLength(1);
    expect(specialistApprovalDecision(judged, { coordinatorSealed: false, outcome: run.outcome }).outcome).toBe("presented");
  });

  it("9. attachSealedArtifacts REFUSES, never redacts: a sealed artifact the contracts refuse (a control character in one of its strings) refuses the WHOLE result `result_refused` - never a result with the artifact silently dropped; a result already refused passes through untouched; with nothing sealed the model's own empty list stands, the same object", () => {
    const artifact = plain(sealTier1([{ op: "set-value", target: "U1", value: "10k" }])) as unknown as Record<string, unknown>;
    const tainted: Record<string, unknown> = { ...artifact, proposalId: `${String(artifact.proposalId)}${String.fromCharCode(7)}` };
    const sealedInRun = { toolId: TIER1, kind: String(tainted.schema), payload: tainted, digest: engineeringDigest(tainted) };
    const parsed = parseSpecialistResult(specialistResult("circuit-topology"), "circuit-topology");
    expect(parsed.ok).toBe(true);
    const attached = attachSealedArtifacts(parsed, [sealedInRun]);
    expect(attached.ok).toBe(false);
    expect(!attached.ok && attached.reason).toMatch(/^result_refused: invalid_text at \$\.proposedActions\[0\]\.payload/);
    const refused = { ok: false as const, reason: "result_not_json: the final text is not one JSON document" };
    expect(attachSealedArtifacts(refused, [sealedInRun])).toBe(refused);
    expect(attachSealedArtifacts(parsed, [])).toBe(parsed);
  });
});
