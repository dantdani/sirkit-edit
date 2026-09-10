/**
 * B09 — proposal tests (areas 27–34): the sealed tier-1 proposal path from
 * the agent gateway into the EXISTING review/apply boundary (trusted
 * schematic session + canonical executor). Receiving mutates nothing; only
 * the explicit apply executes; stale/altered/expired/foreign artifacts can
 * never apply; kicad deletes without pin data fail closed.
 */

import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext } from "../context";
import { createAgentToolGateway, ProposalInvocationService } from "../gateway";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { schematicStateDigest } from "../../engineering/schematic-model";
import { TIER1_PROPOSAL_SCHEMA, verifySealedTier1Proposal, type SealedTier1Proposal, type Tier1ProposalHeadMark, type Tier1ProposalScope } from "../../engineering/schematic-proposals";
import { SchematicEditorSession } from "../../engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "../../engineering/persistence";
import type { EngineeringOperation } from "../../engineering/types";
import { createEmptyBoard } from "../../pcb/types";

const SCHEMATIC: SchematicState = {
  components: [
    { id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" },
    { id: "c1", type: "capacitor", x: 200, y: 100, rotation: 0, value: "100n" },
  ],
  wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 180, y: 100 }] }],
  kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU" }],
  netLabels: [],
};

const TEST_MARK: Tier1ProposalHeadMark = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };

function agentContext(schematic: SchematicState = SCHEMATIC, headMark: Tier1ProposalHeadMark | null = TEST_MARK) {
  const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p-props", branchId: "main", schematic, board: createEmptyBoard(), ...(headMark ? { schematicHeadMark: headMark } : {}) });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

async function sealViaGateway(ops: unknown, schematic: SchematicState = SCHEMATIC, headMark: Tier1ProposalHeadMark | null = TEST_MARK) {
  const gateway = createAgentToolGateway(sirkitToolRegistry());
  return gateway.invoke({
    runId: "run-p",
    provider: "openai",
    toolId: "sirkit.schematic.propose-tier1-edit",
    version: "1.1.0",
    args: { ops },
    context: agentContext(schematic, headMark),
    timeoutMs: 5_000,
  });
}

function session(projectId = "p-props"): SchematicEditorSession {
  const editor = new SchematicEditorSession({ tenantId: "local", projectId, branchId: "main" }, { store: new InMemoryAtomicProjectStore() });
  const originalExecute = editor.execute.bind(editor);
  let opening: Promise<unknown> | null = null;
  editor.execute = async (state, request) => {
    if (editor.lifecycle === "unopened") opening ??= editor.openForProject(state, null);
    if (opening) await opening;
    return originalExecute(state, request);
  };
  return editor;
}

function scopeOf(editor: SchematicEditorSession, projectId = "p-props"): Tier1ProposalScope {
  const mark = editor.headMark();
  if (!mark) throw new Error("editor session is not ready (no head mark)");
  return { tenantId: "local", projectId, branchId: "main", headMark: mark };
}

async function readyEditor(state: SchematicState, projectId = "p-props"): Promise<SchematicEditorSession> {
  const editor = session(projectId);
  await editor.openForProject(state, null);
  return editor;
}

async function applyProposal(editor: SchematicEditorSession, state: SchematicState, proposal: SealedTier1Proposal, now = Date.now(), expectedScope?: Tier1ProposalScope) {
  const scope = expectedScope ?? scopeOf(editor);
  const verification = verifySealedTier1Proposal(proposal, { currentSchematicDigest: schematicStateDigest(state), now, expectedScope: scope });
  if (!verification.ok) return { verification, result: null } as const;
  const result = await editor.execute(state, {
    commandId: "schematic.edit-tier1-apply",
    label: "Applied AI edit proposal",
    buildOperations: () => structuredClone(proposal.operations) as EngineeringOperation[],
    expectedBaseDigest: proposal.baseSchematicDigest,
    expectedHeadMark: proposal.scope.headMark,
  });
  return { verification, result } as const;
}

describe("B09 §4 — sealed proposals through the existing apply boundary", () => {
  it("27+31. receiving a proposal (and canceling it) mutates NOTHING", async () => {
    const before = schematicStateDigest(SCHEMATIC);
    const outcome = await sealViaGateway([{ op: "set-value", target: "r1", value: "22k" }]);
    expect(outcome.kind).toBe("proposal");
    expect(schematicStateDigest(SCHEMATIC)).toBe(before); // untouched
    // Cancel = simply discarding the artifact; nothing ever executed.
  });

  it("28+29+30. the EXACT sealed proposal enters the existing review boundary; explicit apply = ONE canonical transaction; undo restores the exact prior digest", async () => {
    const editor = await readyEditor(SCHEMATIC);
    const outcome = await sealViaGateway([{ op: "set-value", target: "r1", value: "22k" }], SCHEMATIC, editor.headMark());
    if (outcome.kind !== "proposal") throw new Error(`expected proposal, got ${outcome.kind}`);
    // [B14] the proposal union is discriminated by schema; this suite exercises Tier-1.
    // B16.0.1: compare against the imported CURRENT schema constant, never a literal.
    if (outcome.proposal.schema !== TIER1_PROPOSAL_SCHEMA) throw new Error("expected a Tier-1 proposal");
    const proposal = outcome.proposal;
    expect(proposal.baseSchematicDigest).toBe(schematicStateDigest(SCHEMATIC));
    expect(proposal.scope.headMark.lineageId).toBe(editor.headMark()!.lineageId);

    const beforeDigest = schematicStateDigest(SCHEMATIC);
    const applied = await applyProposal(editor, SCHEMATIC, proposal);
    expect(applied.verification.ok).toBe(true);
    if (!applied.result || applied.result.status !== "executed") throw new Error(`apply failed: ${JSON.stringify(applied.result)}`);
    const after = applied.result.state as SchematicState;
    expect(after.components.find((component) => component.id === "r1")!.value).toBe("22k");
    // ONE canonical transaction for the whole proposal.
    expect(applied.result.transactionId).toBeTruthy();
    expect(editor.events.filter((event) => event.kind === "executed")).toHaveLength(1);
    // Undo through the trusted session restores the EXACT prior digest.
    const undo = await editor.reconcileHistoryStep("undo", SCHEMATIC);
    expect(undo.ok).toBe(true);
    expect(schematicStateDigest(SCHEMATIC)).toBe(beforeDigest);
  });

  it("32. stale, altered, expired, and foreign proposals can never apply", async () => {
    const editor = await readyEditor(SCHEMATIC);
    const outcome = await sealViaGateway([{ op: "delete", target: "c1" }], SCHEMATIC, editor.headMark());
    if (outcome.kind !== "proposal") throw new Error("expected proposal");
    // B16.0.1: compare against the imported CURRENT schema constant, never a literal.
    if (outcome.proposal.schema !== TIER1_PROPOSAL_SCHEMA) throw new Error("expected a Tier-1 proposal");
    const proposal = outcome.proposal;

    // Stale: the schematic changed after sealing.
    const drifted: SchematicState = structuredClone(SCHEMATIC);
    drifted.components[0]!.value = "47k";
    const stale = await applyProposal(editor, drifted, proposal);
    expect(stale.verification).toMatchObject({ ok: false, code: "stale-base" });
    expect(stale.result).toBeNull();

    // Altered: operations tampered after sealing.
    const altered = structuredClone(proposal) as SealedTier1Proposal;
    (altered.operations as EngineeringOperation[]).pop();
    const alteredOutcome = await applyProposal(editor, SCHEMATIC, altered);
    expect(alteredOutcome.verification).toMatchObject({ ok: false, code: expect.stringMatching(/altered|malformed/) });

    // Expired: past the TTL.
    const expired = await applyProposal(editor, SCHEMATIC, proposal, proposal.expiresAt + 1);
    expect(expired.verification).toMatchObject({ ok: false, code: "expired" });

    // Foreign lineage/project: a different schematic (different digest) —
    // the base pin refuses exactly like stale.
    const foreign: SchematicState = { components: [], wires: [] };
    const foreignOutcome = await applyProposal(editor, foreign, proposal);
    expect(foreignOutcome.verification).toMatchObject({ ok: false, code: expect.stringMatching(/stale-base|foreign-scope|stale-head/) });
  });

  it("33. kicad deletes without pin data (and unknown targets) BLOCK the whole proposal — component authority/pin mapping failure stays closed", async () => {
    const noPins = await sealViaGateway([{ op: "delete", target: "U1" }]);
    expect(noPins.kind).toBe("proposal-blocked");
    if (noPins.kind !== "proposal-blocked") throw new Error("unreachable");
    expect(noPins.blockers.some((blocker) => blocker.code === "pins-unavailable")).toBe(true);

    const unknownTarget = await sealViaGateway([{ op: "set-value", target: "r99", value: "1k" }, { op: "set-value", target: "r1", value: "1k" }]);
    expect(unknownTarget.kind).toBe("proposal-blocked"); // all-or-nothing
  });

  it("33b. malformed op shapes and proposal refusal paths are structured", async () => {
    const malformed = await sealViaGateway([{ op: "explode", target: "r1" }]);
    expect(malformed).toMatchObject({ kind: "refused", status: "invalid_input" });
    const service = new ProposalInvocationService(sirkitToolRegistry());
    const noSchematic = await service.invoke({
      toolId: "sirkit.schematic.propose-tier1-edit",
      version: "1.1.0",
      args: { ops: [{ op: "delete", target: "r1" }] },
      context: { ...agentContext(), schematic: null, schematicDigest: null },
      provenance: { provider: "openai", instruction: "x" },
    });
    expect(noSchematic).toMatchObject({ status: "refused", failure: "authority_unavailable" });
    // [B09.1/B09.3] a run ASSEMBLED without a canonical head mark fails
    // closed at discovery itself: the lineage-sealed proposal descriptor
    // requires an open lineage anchor (lineage_required).
    const noMark = await service.invoke({
      toolId: "sirkit.schematic.propose-tier1-edit",
      version: "1.1.0",
      args: { ops: [{ op: "delete", target: "r1" }] },
      context: agentContext(SCHEMATIC, null),
      provenance: { provider: "openai", instruction: "x" },
    });
    expect(noMark).toMatchObject({ status: "refused", failure: "not_discoverable" });
    if (noMark.status !== "refused") throw new Error("unreachable");
    expect(noMark.diagnostics.join(" ")).toContain("lineage_required");
    // [B09.3] STRIPPING the mark from an assembled context while discovery
    // still carries its lineage is post-assembly tampering → context_integrity.
    const strippedMark = await service.invoke({
      toolId: "sirkit.schematic.propose-tier1-edit",
      version: "1.1.0",
      args: { ops: [{ op: "delete", target: "r1" }] },
      context: { ...agentContext(), schematicHeadMark: null },
      provenance: { provider: "openai", instruction: "x" },
    });
    expect(strippedMark).toMatchObject({ status: "refused", failure: "context_integrity" });
  });

  it("34. no mutation/destructive/release/undo/view-session descriptor is provider-exposed, and the gateway refuses their classes outright", async () => {
    const registry = sirkitToolRegistry();
    for (const descriptor of registry.list()) {
      if (["mutate", "destructive", "release"].includes(descriptor.operationClass)) {
        expect(descriptor.agentExposed, descriptor.toolId).toBe(false);
      }
      // [B17-F] view-session tools are exposed ONLY as bound bus-command tools (never engineering state).
      if (descriptor.operationClass === "view-session" && descriptor.agentExposed) expect(descriptor.binding.status, descriptor.toolId).toBe("bound-view-session");
    }
    const gateway = createAgentToolGateway(registry);
    const outcome = await gateway.invoke({
      runId: "run-x", provider: "openai", toolId: "sirkit.pcb.delete-item", version: "1.0.0",
      args: {}, context: agentContext(), timeoutMs: 1_000,
    });
    expect(outcome).toMatchObject({ kind: "refused", status: "not_callable" });
  });
});
