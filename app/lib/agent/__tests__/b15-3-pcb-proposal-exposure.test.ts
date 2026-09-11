/**
 * B15.3 §H/§K — secure exposure of `sirkit.pcb.propose-bounded-edit`.
 *
 * Pins: exposure equals the intentional id set with NO PCB apply/destructive
 * tool (a mutation only as a reviewed granted execution); OpenAI/Anthropic descriptor parity; the
 * strict {intent, operations} argument surface (authority-shaped provider
 * arguments refuse BY NAME); board/basis prerequisites fail closed;
 * invocation/cancel/timeout mutate NOTHING; the scripted REAL loop emits
 * exactly one `pcb_proposal_ready`; fabricated events refuse.
 */

import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "../../pcb/types";
import type { PcbBoard } from "../../pcb/types";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { pcbRevisionId } from "../../pcb/revision";
import { pcbBoardInstanceId } from "../../pcb/board-identity";
import { PCB_EDIT_PROPOSAL_SCHEMA, PCB_EDIT_PROPOSAL_SCHEMA_V1, verifySealedPcbEditProposalIntegrity } from "../../pcb/proposal/sealed-pcb-edit-proposal";
import { receivePcbProposalReadyEvent } from "../../project/pcb-proposal-events";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { renderProviderParityReport } from "../../engineering/tool-provider-adapters";
import { assembleAgentRunContext } from "../context";
import { createAgentToolGateway } from "../gateway";
import { runAgentLoop } from "../loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../contracts";
import { AGENT_SYSTEM_PROMPT } from "../../prompts";
import { isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const PCB_TOOL = "sirkit.pcb.propose-bounded-edit";

function board(): PcbBoard {
  const source = createEmptyBoard();
  source.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  source.nets.push({ id: 1, name: "NET1" });
  source.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  return source;
}

const BASIS = { historyHeadSequence: 0, historyHeadLabel: null, lineageId: "lin-b15", activeDrcPresetId: DEFAULT_PRESET_ID };

function assemble(input?: { board?: unknown; basis?: unknown }) {
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: "p153", branchId: "main",
    board: input && "board" in input ? input.board : board(),
    ...(input && "basis" in input ? (input.basis !== undefined ? { pcbProposalBasis: input.basis } : {}) : { pcbProposalBasis: BASIS }),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly;
}

const GOOD_ARGS = { intent: "widen NET1", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] };

function invokePcb(args: Record<string, unknown>, context = assemble().context) {
  const gateway = createAgentToolGateway(sirkitToolRegistry(), { now: () => 1_000_000 });
  return gateway.invoke({ runId: "run-b15-3", provider: "anthropic", toolId: PCB_TOOL, version: "1.0.0", args, context, timeoutMs: 5_000 });
}

// ─── K1–K3: exposure count, exact id set, nothing mutating exposed ───────────

describe("B15.3 §K1–3 — exposure", () => {
  it("exactly the intentional agent-exposed tools with the exact id set", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed).map((descriptor) => descriptor.toolId).sort();
    // [B17-F] the exact set is the ONE reviewed intentional list (agent-exposure.ts).
    expect(exposed).toEqual([...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS]);
  });

  it("no exposed tool is destructive/release/apply-class (a mutation only as a reviewed granted execution), and the PCB tool is propose/proposal-artifact only", () => {
    for (const descriptor of sirkitToolRegistry().list().filter((item) => item.agentExposed)) {
      expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
    }
    const pcb = sirkitToolRegistry().get(PCB_TOOL, "1.0.0")!;
    expect(pcb.operationClass).toBe("propose");
    expect(pcb.sideEffects).toBe("proposal-artifact");
    expect(pcb.binding.status).toBe("bound-proposal");
    // SEALING requires no approval (like both schematic propose tools); the
    // topology-or-geometry tier lives on the sealed ARTIFACT + apply action.
    expect(pcb.approvalTier).toBe("none");
  });
});

// ─── K4: provider parity ─────────────────────────────────────────────────────

describe("B15.3 §K4 — OpenAI and Anthropic descriptor parity", () => {
  it("both providers describe the SAME wire-compatible contract for the PCB proposal tool", () => {
    const report = renderProviderParityReport(sirkitToolRegistry().list());
    const entry = report.tools.find((tool) => tool.toolId === PCB_TOOL);
    expect(entry).toBeDefined();
    expect(entry!.wireCompatible).toBe(true);
    expect(entry!.semanticallyEquivalent).toBe(true);
    expect(entry!.providerName).toBe("sirkit_pcb_propose-bounded-edit");
  });
});

// ─── K5/K6: strict argument surface ──────────────────────────────────────────

describe("B15.3 §K5–6 — strict input and authority-argument refusal", () => {
  it("unknown keys refuse — including every authority-shaped provider attempt", async () => {
    for (const [key, value] of [
      ["board", board()],
      ["candidateBoard", board()],
      ["rules", { default: {} }],
      ["scope", { projectId: "evil" }],
      ["revision", "pcb2-evil"],
      ["boardDigest", "pcb2-evil"],
      ["impact", { drc: {} }],
      ["approvalTier", "none"],
      ["validationPolicy", { presetId: "evil" }],
      ["digest", "eng1-evil"],
      ["approval", { granted: true }],
      ["historyHead", { sequence: 99 }],
      ["lineageId", "lin-evil"],
      // B16.0.1 §E: a provider can never supply or influence the sealed
      // authorization binding — both spellings refuse BY NAME.
      ["authorization", { principalId: "user-mallory", membershipRevision: "membership:rev-999" }],
      ["authorizationBinding", { principalId: "user-mallory", membershipRevision: "membership:rev-999" }],
    ] as Array<[string, unknown]>) {
      const outcome = await invokePcb({ ...GOOD_ARGS, [key]: value });
      expect(outcome.kind, key).toBe("refused");
      if (outcome.kind === "refused") {
        expect(outcome.status, key).toBe("invalid_input");
        expect(outcome.diagnostics.join(" "), key).toContain(key.slice(0, 40));
      }
    }
  });

  it("missing intent or operations refuses", async () => {
    expect((await invokePcb({ operations: GOOD_ARGS.operations })).kind).toBe("refused");
    expect((await invokePcb({ intent: "x" })).kind).toBe("refused");
  });

  it("a valid bounded request seals — with EVERY authority field server-derived", async () => {
    const context = assemble().context;
    const outcome = await invokePcb(GOOD_ARGS, context);
    expect(outcome.kind).toBe("pcb-proposal");
    if (outcome.kind !== "pcb-proposal") return;
    const proposal = outcome.proposal;
    expect(verifySealedPcbEditProposalIntegrity(proposal)).toEqual({ ok: true });
    expect(proposal.scope).toEqual({ tenantId: "local", projectId: "p153", branchId: "main", boardInstanceId: pcbBoardInstanceId("p153") });
    expect(proposal.base.pcbRevisionId).toBe(pcbRevisionId(context.canonicalState!.pcb));
    expect(proposal.base.historyHead).toEqual({ sequence: 0, label: null });
    expect(proposal.base.lineageId).toBe("lin-b15");
    expect(proposal.validationPolicy.presetId).toBe(DEFAULT_PRESET_ID);
    expect(proposal.provenance.provider).toBe("anthropic");
    expect(proposal.provenance.runId).toBe("run-b15-3");
    expect(proposal.effectiveActor.kind).toBe("human");
    expect(proposal.actor.kind).toBe("ai");
  });
});

// ─── K7/K8: prerequisite refusals ────────────────────────────────────────────

describe("B15.3 §K7–8 — missing authority fails closed", () => {
  it("no canonical board resource ⇒ the tool is withheld AND direct invocation refuses", async () => {
    const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p153", branchId: "main", pcbProposalBasis: BASIS });
    if (!assembly.ok) throw new Error(assembly.reason);
    expect(assembly.context.canonicalState).toBeNull();
    expect(assembly.context.pcbProposalBasis).toBeNull(); // withheld without a board
    const outcome = await invokePcb(GOOD_ARGS, assembly.context);
    expect(outcome.kind).toBe("refused");
  });

  it("no PCB history basis ⇒ refused authority_unavailable (never fabricated)", async () => {
    const context = assemble({ basis: undefined }).context;
    expect(context.pcbProposalBasis).toBeNull();
    const outcome = await invokePcb(GOOD_ARGS, context);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.status).toBe("authority_unavailable");
  });

  it("a malformed or unknown-preset basis is withheld at assembly with a truthful warning", () => {
    const malformed = assembleAgentRunContext({ tenantId: "local", projectId: "p153", branchId: "main", board: board(), pcbProposalBasis: { historyHeadSequence: -1, historyHeadLabel: null, lineageId: "lin", activeDrcPresetId: DEFAULT_PRESET_ID } });
    if (!malformed.ok) throw new Error(malformed.reason);
    expect(malformed.context.pcbProposalBasis).toBeNull();
    const unknownPreset = assembleAgentRunContext({ tenantId: "local", projectId: "p153", branchId: "main", board: board(), pcbProposalBasis: { ...BASIS, activeDrcPresetId: "evil-fab-9000" } });
    if (!unknownPreset.ok) throw new Error(unknownPreset.reason);
    expect(unknownPreset.context.pcbProposalBasis).toBeNull();
    expect(unknownPreset.warnings.some((warning) => warning.includes("unknown DRC preset"))).toBe(true);
  });
});

// ─── K10/K12/K13/K43: the scripted REAL loop ─────────────────────────────────

function scriptedAdapter(callArgs: unknown, options?: { neverResolve?: boolean }): ProviderAgentAdapter {
  return {
    provider: "anthropic",
    async start(): Promise<AgentStep> {
      if (options?.neverResolve) return new Promise<AgentStep>(() => undefined);
      return {
        text: "",
        toolCalls: [{ callId: "call-1", providerName: "sirkit_pcb_propose-bounded-edit", argumentsText: JSON.stringify(callArgs) }],
        stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null },
      };
    },
    async continueWith(): Promise<AgentStep> {
      return { text: "done", toolCalls: [], stopReason: "end", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null } };
    },
  };
}

describe("B15.3 §K10/12/13/43 — the real loop through the real gateway", () => {
  it("emits EXACTLY ONE pcb_proposal_ready, never proposal_ready, and mutates nothing", async () => {
    const assembly = assemble();
    const sourceBoard = assembly.context.canonicalState!.pcb;
    const revisionBefore = pcbRevisionId(sourceBoard);
    const registry = sirkitToolRegistry();
    const events: AgentRunEvent[] = [];
    const result = await runAgentLoop(
      { runId: "run-k13", provider: "anthropic", history: [], userMessage: "widen the net", budget: DEFAULT_AGENT_BUDGET },
      {
        adapter: scriptedAdapter(GOOD_ARGS),
        gateway: createAgentToolGateway(registry, { now: () => 2_000_000 }),
        registry,
        context: assembly.context,
        system: AGENT_SYSTEM_PROMPT,
        emit: (event) => events.push(event),
        contextWarnings: assembly.warnings,
      },
    );
    expect(result.status).toBe("completed");
    const pcbReady = events.filter((event) => event.type === "pcb_proposal_ready");
    expect(pcbReady).toHaveLength(1);
    expect(events.filter((event) => event.type === "proposal_ready")).toHaveLength(0);
    // The DISTINCT event carries a verifying sealed proposal.
    const received = receivePcbProposalReadyEvent(pcbReady[0] as { type: string; runId: string; proposal: unknown });
    expect(received).not.toBeNull();
    expect(received!.runId).toBe("run-k13");
    // NOTHING mutated: the context board is byte-identical.
    expect(pcbRevisionId(sourceBoard)).toBe(revisionBefore);
  });

  it("K12: timeout/abort produces NO proposal event and NO mutation", async () => {
    const assembly = assemble();
    const revisionBefore = pcbRevisionId(assembly.context.canonicalState!.pcb);
    const registry = sirkitToolRegistry();
    const events: AgentRunEvent[] = [];
    const controller = new AbortController();
    const run = runAgentLoop(
      { runId: "run-k12", provider: "anthropic", history: [], userMessage: "widen", budget: { ...DEFAULT_AGENT_BUDGET, runDeadlineMs: 250 }, signal: controller.signal },
      {
        adapter: scriptedAdapter(GOOD_ARGS, { neverResolve: true }),
        gateway: createAgentToolGateway(registry),
        registry,
        context: assembly.context,
        system: AGENT_SYSTEM_PROMPT,
        emit: (event) => events.push(event),
        contextWarnings: assembly.warnings,
      },
    );
    controller.abort();
    const result = await run;
    expect(result.status).not.toBe("completed");
    expect(events.filter((event) => event.type === "pcb_proposal_ready")).toHaveLength(0);
    expect(pcbRevisionId(assembly.context.canonicalState!.pcb)).toBe(revisionBefore);
  });

  it("a hostile-payload call surfaces a structured proposal-blocked and no event", async () => {
    const assembly = assemble();
    const registry = sirkitToolRegistry();
    const events: AgentRunEvent[] = [];
    await runAgentLoop(
      { runId: "run-blocked", provider: "anthropic", history: [], userMessage: "delete it", budget: DEFAULT_AGENT_BUDGET },
      {
        adapter: scriptedAdapter({ intent: "delete", operations: [{ kind: "delete_track", trackId: "t1" }] }),
        gateway: createAgentToolGateway(registry),
        registry,
        context: assembly.context,
        system: AGENT_SYSTEM_PROMPT,
        emit: (event) => events.push(event),
        contextWarnings: assembly.warnings,
      },
    );
    expect(events.filter((event) => event.type === "pcb_proposal_ready")).toHaveLength(0);
    const finished = events.find((event) => event.type === "tool_finished");
    expect(finished && "ok" in finished ? finished.ok : true).toBe(false);
  });
});

// ─── K14: fabricated events refuse ───────────────────────────────────────────

describe("B15.3 §K14 — fabricated or malformed events grant nothing", () => {
  it("wrong type, wrong schema, malformed body, and forged verifying-shape all yield null", () => {
    // B16.0.1: literals replaced with the CURRENT schema constant so the
    // structural (not version-gate) refusals stay exercised; a legacy v1
    // proposal is additionally proven to grant nothing.
    expect(receivePcbProposalReadyEvent(null)).toBeNull();
    expect(receivePcbProposalReadyEvent({ type: "proposal_ready", proposal: { schema: PCB_EDIT_PROPOSAL_SCHEMA } })).toBeNull();
    expect(receivePcbProposalReadyEvent({ type: "pcb_proposal_ready", proposal: { schema: "sirkit.schematic-replacement-proposal.v1" } })).toBeNull();
    expect(receivePcbProposalReadyEvent({ type: "pcb_proposal_ready", proposal: { schema: PCB_EDIT_PROPOSAL_SCHEMA, evil: true } })).toBeNull();
    expect(receivePcbProposalReadyEvent({ type: "pcb_proposal_ready", proposal: { schema: PCB_EDIT_PROPOSAL_SCHEMA_V1 } })).toBeNull();
    expect(receivePcbProposalReadyEvent({ type: "pcb_proposal_ready", runId: "r", proposal: null })).toBeNull();
  });
});
