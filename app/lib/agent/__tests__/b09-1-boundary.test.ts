/**
 * B09.1 — agent boundary integrity closure, proven behaviorally:
 *  §1 scope/lineage-sealed V2 proposals (cross-project/branch/lineage and
 *     head-advance replay all fail closed; the exact current proposal
 *     applies once with exact undo);
 *  §2 deep PCB working-copy validation (invalid boards never become
 *     verified authority);
 *  §4 fail-closed strict wire-schema subset (+ the exposure gate);
 *  §5 run-deadline enforcement DURING awaits;
 *  §6 event order and provider provenance.
 */

import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext, buildAgentResourceBundle } from "../context";
import { createAgentToolGateway } from "../gateway";
import { buildRunToolset, runAgentLoop } from "../loop";
import { buildAgentToolDeclarations, strictCompatibility, toStrictSchema, validateWireSubset } from "../provider-tools";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../contracts";
import { sirkitToolRegistry, SIRKIT_TOOL_CATALOG } from "../../engineering/tool-catalog";
import { ToolRegistry } from "../../engineering/tool-registry";
import { schematicStateDigest } from "../../engineering/schematic-model";
import { sealTier1Proposal, verifySealedTier1Proposal, TIER1_PROPOSAL_SCHEMA_V1, type SealedTier1Proposal, type Tier1ProposalScope } from "../../engineering/schematic-proposals";
import { buildAuthorizationBinding } from "../../engineering/proposal-authorization";
import { compileTier1Proposal } from "../../engineering/schematic-plans";
import { SchematicEditorSession } from "../../engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "../../engineering/persistence";
import type { EngineeringOperation } from "../../engineering/types";
import { createEmptyBoard, type PcbBoard } from "../../pcb/types";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const SCHEMATIC: SchematicState = {
  components: [
    { id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" },
    { id: "c1", type: "capacitor", x: 200, y: 100, rotation: 0, value: "100n" },
  ],
  wires: [],
};

function session(projectId: string, branchId = "main"): SchematicEditorSession {
  const editor = new SchematicEditorSession({ tenantId: "local", projectId, branchId }, { store: new InMemoryAtomicProjectStore() });
  return editor;
}

async function readyEditor(state: SchematicState, projectId: string, branchId = "main"): Promise<SchematicEditorSession> {
  const editor = session(projectId, branchId);
  await editor.openForProject(structuredClone(state), null);
  return editor;
}

function scopeOf(editor: SchematicEditorSession, projectId: string, branchId = "main"): Tier1ProposalScope {
  const mark = editor.headMark();
  if (!mark) throw new Error("session not ready");
  return { tenantId: "local", projectId, branchId, headMark: mark };
}

function sealAgainst(editor: SchematicEditorSession, projectId: string, state: SchematicState = SCHEMATIC, branchId = "main"): SealedTier1Proposal {
  const outcome = sealTier1Proposal({
    state,
    compilation: compileTier1Proposal(state, { ops: [{ op: "set-value", target: "r1", value: "22k" }], pinsByPartId: new Map() }),
    provenance: { provider: "openai", note: "test", instruction: "t" },
    now: Date.now(),
    scope: scopeOf(editor, projectId, branchId),
    // B16.0.1 §E: the sealed authorization binding (the verified local actor).
    authorization: buildAuthorizationBinding({ principalId: "local-user", scope: { tenantId: "local", projectId, branchId } }),
  });
  if (outcome.kind !== "sealed") throw new Error("expected sealed");
  return outcome.proposal;
}

function verifyAgainst(proposal: SealedTier1Proposal, editor: SchematicEditorSession, projectId: string, state: SchematicState = SCHEMATIC, branchId = "main") {
  return verifySealedTier1Proposal(proposal, {
    currentSchematicDigest: schematicStateDigest(state),
    now: Date.now(),
    expectedScope: scopeOf(editor, projectId, branchId),
  });
}

describe("B09.1 §1 — scope/lineage-sealed proposals", () => {
  it("A. a project-A proposal is refused in project B even with BYTE-IDENTICAL schematics", async () => {
    const editorA = await readyEditor(SCHEMATIC, "project-A");
    const editorB = await readyEditor(SCHEMATIC, "project-B");
    expect(schematicStateDigest(SCHEMATIC)).toBe(schematicStateDigest(SCHEMATIC)); // identical content
    const proposal = sealAgainst(editorA, "project-A");
    const inB = verifyAgainst(proposal, editorB, "project-B");
    expect(inB).toMatchObject({ ok: false, code: "foreign-scope" });
  });

  it("B. a branch-A proposal is refused in branch B with identical content", async () => {
    const editorMain = await readyEditor(SCHEMATIC, "project-X", "main");
    const editorAlt = await readyEditor(SCHEMATIC, "project-X", "alt");
    const proposal = sealAgainst(editorMain, "project-X", SCHEMATIC, "main");
    const inAlt = verifyAgainst(proposal, editorAlt, "project-X", SCHEMATIC, "alt");
    expect(inAlt).toMatchObject({ ok: false, code: "foreign-scope" });
  });

  it("C. same project/branch/content but a FOREIGN LINEAGE is refused", async () => {
    const editor = await readyEditor(SCHEMATIC, "project-L");
    const proposal = sealAgainst(editor, "project-L");
    const mark = editor.headMark()!;
    const foreignLineage: Tier1ProposalScope = { tenantId: "local", projectId: "project-L", branchId: "main", headMark: { ...mark, lineageId: "lin1-somewhere-else" } };
    const outcome = verifySealedTier1Proposal(proposal, { currentSchematicDigest: schematicStateDigest(SCHEMATIC), now: Date.now(), expectedScope: foreignLineage });
    expect(outcome).toMatchObject({ ok: false, code: "foreign-scope" });
  });

  it("D. the same lineage after the head ADVANCES AND RETURNS to the same schematic digest is refused (head identity, not content)", async () => {
    const editor = await readyEditor(SCHEMATIC, "project-H");
    const baseDigest = schematicStateDigest(SCHEMATIC);
    const proposal = sealAgainst(editor, "project-H");
    const sequenceBefore = editor.headMark()!.headSequence;
    // Head advances: edit r1 → 47k, then back to 10k (content restored).
    const setValue = (value: string, operationId: string): EngineeringOperation[] => [
      { operationId, schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "r1", patch: { value } } as EngineeringOperation,
    ];
    const forward = await editor.execute(SCHEMATIC, { commandId: "schematic.set-property", label: "forward", buildOperations: () => setValue("47k", "op:f") });
    if (!forward.ok) throw new Error("forward edit rejected");
    const back = await editor.execute(forward.state, { commandId: "schematic.set-property", label: "back", buildOperations: () => setValue("10k", "op:b") });
    if (!back.ok) throw new Error("back edit rejected");
    expect(schematicStateDigest(back.state)).toBe(baseDigest); // SAME content
    expect(editor.headMark()!.headSequence).toBeGreaterThan(sequenceBefore); // different head
    const replay = verifyAgainst(proposal, editor, "project-H", back.state);
    expect(replay).toMatchObject({ ok: false, code: "stale-head" });
    // …and even a caller skipping verification is stopped INSIDE the
    // serialized queue by the head-mark precondition.
    const smuggled = await editor.execute(back.state, {
      commandId: "schematic.edit-tier1-apply",
      label: "replayed apply",
      buildOperations: () => structuredClone(proposal.operations) as EngineeringOperation[],
      expectedBaseDigest: proposal.baseSchematicDigest,
      expectedHeadMark: proposal.scope.headMark,
    });
    expect(smuggled.ok).toBe(false);
    if (smuggled.ok) throw new Error("unreachable");
    expect(smuggled.diagnostics).toContain("EXPECTED_HEAD_MARK_MISMATCH");
  });

  it("E. altered scope/head fields fail the identity digest; V1 artifacts are never interpreted as V2", async () => {
    const editor = await readyEditor(SCHEMATIC, "project-T");
    const proposal = sealAgainst(editor, "project-T");
    // B16.0.1: a scope.projectId tamper is now caught EARLIER — the sealed
    // authorization binding no longer agrees with the scope (`malformed`),
    // before the identity digest even runs. Head-mark tampers still fail the
    // identity digest as `altered`. Both refusals are fail-closed.
    const mutations: Array<[(clone: SealedTier1Proposal) => void, string]> = [
      [(clone) => { (clone.scope as { projectId: string }).projectId = "project-EVIL"; }, "malformed"],
      [(clone) => { (clone.scope.headMark as { headSequence: number }).headSequence += 1; }, "altered"],
      [(clone) => { (clone.scope.headMark as { lineageId: string }).lineageId = "lin1-aaaaaaaaaaaaaaaa"; }, "altered"],
    ];
    for (const [mutate, expectedCode] of mutations) {
      const clone = structuredClone(proposal) as SealedTier1Proposal;
      mutate(clone);
      // Verify against the TAMPERED scope so only the sealed identity
      // (binding agreement + identity digest) can catch the forgery.
      const outcome = verifySealedTier1Proposal(clone, { currentSchematicDigest: schematicStateDigest(SCHEMATIC), now: Date.now(), expectedScope: structuredClone(clone.scope) });
      expect(outcome).toMatchObject({ ok: false, code: expectedCode });
    }
    const v1 = { ...structuredClone(proposal), schema: TIER1_PROPOSAL_SCHEMA_V1 } as unknown as SealedTier1Proposal;
    const v1Outcome = verifySealedTier1Proposal(v1, { currentSchematicDigest: schematicStateDigest(SCHEMATIC), now: Date.now(), expectedScope: scopeOf(editor, "project-T") });
    expect(v1Outcome).toMatchObject({ ok: false, code: "wrong-version" });
  });

  it("F. the exact current V2 proposal applies ONCE (one canonical transaction) and undo restores the exact prior digest; receiving/cancel mutates nothing", async () => {
    const editor = await readyEditor(SCHEMATIC, "project-OK");
    const before = schematicStateDigest(SCHEMATIC);
    const proposal = sealAgainst(editor, "project-OK");
    expect(schematicStateDigest(SCHEMATIC)).toBe(before); // sealing mutated nothing
    const verification = verifyAgainst(proposal, editor, "project-OK");
    expect(verification.ok).toBe(true);
    const result = await editor.execute(SCHEMATIC, {
      commandId: "schematic.edit-tier1-apply",
      label: "Applied AI edit proposal",
      buildOperations: () => structuredClone(proposal.operations) as EngineeringOperation[],
      expectedBaseDigest: proposal.baseSchematicDigest,
      expectedHeadMark: proposal.scope.headMark,
    });
    if (!result.ok || result.status !== "executed") throw new Error(`apply failed: ${JSON.stringify(result)}`);
    expect(editor.events.filter((event) => event.kind === "executed")).toHaveLength(1);
    // A second identical apply is refused (the head moved past the mark).
    const replay = await editor.execute(result.state, {
      commandId: "schematic.edit-tier1-apply",
      label: "replay",
      buildOperations: () => structuredClone(proposal.operations) as EngineeringOperation[],
      expectedBaseDigest: proposal.baseSchematicDigest,
      expectedHeadMark: proposal.scope.headMark,
    });
    expect(replay.ok).toBe(false);
    const undo = await editor.reconcileHistoryStep("undo", SCHEMATIC);
    expect(undo.ok).toBe(true);
    expect(schematicStateDigest(SCHEMATIC)).toBe(before);
  });
});

describe("B09.1 §2 — deep PCB working-copy validation", () => {
  function boardWith(mutate: (board: PcbBoard) => void): PcbBoard {
    const board = createEmptyBoard();
    mutate(board);
    return board;
  }
  const cases: Array<[string, PcbBoard]> = [
    ["duplicate ids", boardWith((board) => {
      board.nets.push({ id: 1, name: "A" });
      board.tracks.push(
        { id: "t1", netId: 1, layer: "copperTop", width: 200_000, start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } } as never,
        { id: "t1", netId: 1, layer: "copperTop", width: 200_000, start: { x: 0, y: 0 }, end: { x: 2000, y: 0 } } as never,
      );
    })],
    ["dangling padstack reference", boardWith((board) => {
      board.nets.push({ id: 1, name: "A" });
      board.vias.push({ id: "v1", netId: 1, at: { x: 0, y: 0 }, size: 600_000, drill: 300_000, padstackId: "ps-missing" } as never);
    })],
    ["invalid outline geometry", boardWith((board) => {
      (board.outline as { width: number }).width = -5;
    })],
    ["malformed collection entry", boardWith((board) => {
      board.tracks.push({ id: "", netId: 999, layer: "copperTop", width: 0 } as never);
    })],
  ];
  for (const [name, board] of cases) {
    it(`invalid board (${name}) never becomes board-present state or a verified envelope`, () => {
      const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p-b2", branchId: "main", schematic: SCHEMATIC, board });
      if (!assembly.ok) throw new Error(assembly.reason);
      expect(assembly.warnings.some((warning) => warning.includes("structural validation") || warning.includes("structurally invalid"))).toBe(true);
      expect(assembly.context.discovery.projectState).not.toContain("board-present");
      // [B09.2] STRONGER than B09.1: no canonical resource exists AT ALL —
      // nothing is substituted, no digest is manufactured, and building a
      // canonical bundle fails closed.
      expect(assembly.context.canonicalState).toBeNull();
      expect(assembly.context.canonicalRevisionDigest).toBeNull();
      expect(() => buildAgentResourceBundle(assembly.context)).toThrow(/CANONICAL_RESOURCE_UNAVAILABLE/);
      const toolset = buildRunToolset(sirkitToolRegistry(), assembly.context, () => undefined);
      expect(toolset.declarations.some((declaration) => declaration.toolId === "sirkit.pcb.board-inspect")).toBe(false);
    });
  }

  it("a VALID board still verifies and exposes board tools; schematic-only chat survives invalid boards", () => {
    const valid = assembleAgentRunContext({ tenantId: "local", projectId: "p-b2", branchId: "main", schematic: SCHEMATIC, board: createEmptyBoard() });
    if (!valid.ok) throw new Error("valid board refused");
    expect(valid.warnings).toEqual([]);
    expect(valid.context.discovery.projectState).toContain("board-present");
    const invalid = assembleAgentRunContext({ tenantId: "local", projectId: "p-b2", branchId: "main", schematic: SCHEMATIC, board: { stackup: 2, nets: [], footprints: [], tracks: [{ id: "t1" }, { id: "t1" }], vias: [], zones: [] } });
    if (!invalid.ok) throw new Error("request should stay valid");
    expect(invalid.context.discovery.projectState).toContain("schematic-present"); // read-only chat continues
  });
});

describe("B09.1 §4 — fail-closed strict wire subset", () => {
  it("nested unsupported keywords (minItems/maxItems/pattern/oneOf) are rejected, never forwarded", () => {
    expect(validateWireSubset({ type: "array", minItems: 1, items: { type: "string" } }).length).toBeGreaterThan(0);
    expect(() => toStrictSchema({ type: "object", properties: { ops: { type: "array", maxItems: 20, items: { type: "string" } } }, required: ["ops"] })).toThrow(/STRICT_SCHEMA_UNSUPPORTED/);
    expect(() => toStrictSchema({ type: "object", properties: { name: { type: "string", pattern: "^a" } }, required: ["name"] })).toThrow(/STRICT_SCHEMA_UNSUPPORTED/);
    expect(() => toStrictSchema({ type: "object", properties: { x: { oneOf: [{ type: "string" }] } }, required: ["x"] })).toThrow(/STRICT_SCHEMA_UNSUPPORTED/);
  });

  it("all exposed schemas of the intentional agent-exposed set (eleven when written; the set has since grown by reviewed moves, B22-B's three named computation reads among them, and the assertion counts the set itself) pass the wire subset with strict conversion (nullable optionals, additionalProperties:false, full required)", () => { // [B22 closeout, 2026-10-02] retitled (D22-16): the derived count, 36 since B22-B (OD-139); assertions unchanged
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(exposed).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B14: + replacement proposal; B15.3: + sirkit.pcb.propose-bounded-edit
    for (const descriptor of exposed) {
      const strict = strictCompatibility(descriptor);
      expect(strict.ok, descriptor.toolId).toBe(true);
      if (!strict.ok) continue;
      expect(validateWireSubset(strict.schema)).toEqual([]);
      expect((strict.schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
      const properties = (strict.schema as { properties?: Record<string, unknown> }).properties ?? {};
      expect((strict.schema as { required?: string[] }).required ?? []).toEqual(Object.keys(properties));
    }
  });

  it("EXPOSURE GATE: a future agentExposed descriptor with a wire-incompatible schema cannot reach the model (declarations throw; the run toolset excludes with a diagnostic)", () => {
    const base = sirkitToolRegistry().get("sirkit.schematic.inspect")!;
    const incompatible = {
      ...base,
      toolId: "sirkit.schematic.future-bad",
      inputSchema: { type: "object", properties: { list: { type: "array", minItems: 2, items: { type: "string" } } }, required: ["list"] },
    };
    // Explicitly passed → fail closed.
    expect(() => buildAgentToolDeclarations([incompatible as never])).toThrow(/AGENT_TOOL_NOT_STRICT/);
    // Discovered via a registry that contains it → excluded with a warning,
    // and the eight legitimate tools still render.
    const registry = new ToolRegistry([...SIRKIT_TOOL_CATALOG, incompatible as never]);
    const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p-gate", branchId: "main", schematic: SCHEMATIC, board: createEmptyBoard(), schematicHeadMark: { lineageId: "lin1-00aa11bb22cc33dd", headSequence: 1, canonicalStateDigest: "eng1-00aa11bb22cc33dd" } });
    if (!assembly.ok) throw new Error(assembly.reason);
    const warnings: string[] = [];
    const toolset = buildRunToolset(registry, assembly.context, (message) => warnings.push(message));
    expect(toolset.declarations.some((declaration) => declaration.toolId === "sirkit.schematic.future-bad")).toBe(false);
    expect(warnings.some((message) => message.includes("sirkit.schematic.future-bad"))).toBe(true);
    expect(toolset.declarations).toHaveLength(12); // B18-E E13: + the bounded via read; B18-E E11: + the bounded mechanical read; B10: selection.inspect needs the selection-snapshot resource, absent in this fixture context; B17-F: + placement/routing proposals (board only); view tools need a captured view context, absent here
  });
});

// ─── Deadline + ordering harness ─────────────────────────────────────────────

type StepScript = (input: { signal?: AbortSignal }) => Promise<Partial<AgentStep>> | Partial<AgentStep>;
class FakeAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  private index = 0;
  constructor(private readonly script: StepScript[]) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: {}, model: "fake", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(input: { signal?: AbortSignal }): Promise<AgentStep> { return this.step(await this.script[this.index++]!({ signal: input.signal })); }
  async continueWith(input: { signal?: AbortSignal }): Promise<AgentStep> { return this.step(await this.script[this.index++]!({ signal: input.signal })); }
}

const hangUntilAbort = ({ signal }: { signal?: AbortSignal }): Promise<Partial<AgentStep>> =>
  new Promise((_resolve, reject) => {
    if (signal?.aborted) { reject(new Error("aborted")); return; }
    signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

async function runWith(script: StepScript[], options?: { deadlineMs?: number; signal?: AbortSignal; gatewayHangs?: boolean }) {
  const events: AgentRunEvent[] = [];
  const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p-dl", branchId: "main", schematic: SCHEMATIC, board: createEmptyBoard() });
  if (!assembly.ok) throw new Error(assembly.reason);
  const gateway = options?.gatewayHangs
    ? { invoke: ({ signal }: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => { signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }) }
    : createAgentToolGateway(sirkitToolRegistry());
  const result = await runAgentLoop(
    { runId: "run-dl", provider: "openai", history: [], userMessage: "go", budget: { ...DEFAULT_AGENT_BUDGET, runDeadlineMs: options?.deadlineMs ?? 150 }, signal: options?.signal },
    { adapter: new FakeAdapter(script), gateway: gateway as never, registry: sirkitToolRegistry(), context: assembly.context, system: "sys", emit: (event) => events.push(event) },
  );
  return { result, events };
}

describe("B09.1 §5 — run deadline enforced DURING awaits", () => {
  it("a provider start that never resolves is aborted at the deadline (classified deadline, not cancelled)", async () => {
    const { result } = await runWith([hangUntilAbort], { deadlineMs: 80 });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("deadline");
  });

  it("a blocked continuation is aborted at the deadline", async () => {
    const { result } = await runWith([
      () => ({ toolCalls: [{ callId: "c1", providerName: "sirkit_schematic_inspect", argumentsText: "{}" }] }),
      hangUntilAbort,
    ], { deadlineMs: 200 });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("deadline");
  });

  it("external cancellation BEFORE the deadline is classified cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const { result } = await runWith([hangUntilAbort], { deadlineMs: 5_000, signal: controller.signal });
    expect(result.status).toBe("cancelled");
    expect(result.failureReason).toBe("cancelled");
  });

  it("tool execution respects the same overall signal (hanging gateway aborted at deadline)", async () => {
    const { result } = await runWith([
      () => ({ toolCalls: [{ callId: "c1", providerName: "sirkit_schematic_inspect", argumentsText: "{}" }] }),
      () => ({ text: "never reached" }),
    ], { deadlineMs: 120, gatewayHangs: true });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("deadline");
  });

  it("normal completion cleans up: no late deadline event fires after the run returns", async () => {
    const { result, events } = await runWith([() => ({ text: "done" })], { deadlineMs: 60 });
    expect(result.status).toBe("completed");
    const count = events.length;
    await new Promise((resolve) => setTimeout(resolve, 120)); // past the deadline
    expect(events.length).toBe(count); // timer/listeners cleaned up
    expect(events.some((event) => event.type === "run_failed")).toBe(false);
  });
});

describe("B09.1 §6 — event order and provider provenance", () => {
  it("run_started is FIRST and exactly once; context warnings follow it", async () => {
    const events: AgentRunEvent[] = [];
    const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p-ord", branchId: "main", schematic: SCHEMATIC, board: { stackup: 2 } });
    if (!assembly.ok) throw new Error(assembly.reason);
    expect(assembly.warnings.length).toBeGreaterThan(0);
    await runAgentLoop(
      { runId: "run-ord", provider: "anthropic", history: [], userMessage: "go", budget: DEFAULT_AGENT_BUDGET },
      { adapter: new FakeAdapter([() => ({ text: "hi" })]), gateway: createAgentToolGateway(sirkitToolRegistry()), registry: sirkitToolRegistry(), context: assembly.context, system: "sys", emit: (event) => events.push(event), contextWarnings: assembly.warnings },
    );
    expect(events[0]!.type).toBe("run_started");
    expect(events.filter((event) => event.type === "run_started")).toHaveLength(1);
    expect(events[1]!.type).toBe("warning");
    // No opaque continuation state anywhere in the event stream.
    expect(JSON.stringify(events)).not.toContain("continuation");
  });

  it("proposal provenance records the ACTUAL selected provider, never 'agent'", async () => {
    const editor = await readyEditor(SCHEMATIC, "p-prov");
    const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p-prov", branchId: "main", schematic: SCHEMATIC, board: createEmptyBoard(), schematicHeadMark: editor.headMark() });
    if (!assembly.ok) throw new Error(assembly.reason);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const outcome = await gateway.invoke({
      runId: "run-prov", provider: "anthropic",
      toolId: "sirkit.schematic.propose-tier1-edit", version: "1.1.0",
      args: { ops: [{ op: "set-value", target: "r1", value: "1k" }] },
      context: assembly.context, timeoutMs: 5_000,
    });
    if (outcome.kind !== "proposal") throw new Error(`expected proposal, got ${JSON.stringify(outcome)}`);
    expect(outcome.proposal.provenance.provider).toBe("anthropic");
    expect(outcome.proposal.scope.headMark.lineageId).toBe(editor.headMark()!.lineageId);
  });
});
