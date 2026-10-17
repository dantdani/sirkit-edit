/**
 * B09.2 — truthful resource authority, hard-deadline enforcement, and
 * provider-boundary closure. Every pre-edit counterexample (R1–R7) is a
 * permanent regression here, plus the section A–F required coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext, buildAgentResourceBundle } from "../context";
import { createAgentToolGateway, ProposalInvocationService, verifyAgentContextIntegrity, AGENT_PROPOSAL_TOOL_VERSION } from "../gateway";
import { buildRunToolset, runAgentLoop } from "../loop";
import { toStrictSchema } from "../provider-tools";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../contracts";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { ReadToolInvocationService } from "../../engineering/tool-invocation";
import { sealResourceEnvelope, validateReadResourceBundle, buildReadResourceBundle } from "../../engineering/resource-envelopes";
import { isWellFormedProposalScope } from "../../engineering/schematic-proposals";
import { validateSchematicCanonicalMark } from "../../engineering/schematic-projection";
import { createEmptyBoard } from "../../pcb/types";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const INVALID_BOARD = { stackup: 2, nets: [], footprints: [], tracks: [{ id: "" }], vias: [], zones: [] };
const VALID_MARK = { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" };

function contextOf(input?: { board?: unknown; schematic?: unknown; mark?: unknown }) {
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: "p92", branchId: "main",
    schematic: input && "schematic" in input ? input.schematic : SCHEMATIC,
    board: input && "board" in input ? input.board : createEmptyBoard(),
    ...(input?.mark !== undefined ? { schematicHeadMark: input.mark } : {}),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly;
}

describe("B09.2 §A — no synthetic canonical authority (R1/R2)", () => {
  it("R1: a missing or invalid board yields NO canonical resource — nothing verified/current over a substituted empty PCB, no manufactured digest", () => {
    for (const board of [undefined, INVALID_BOARD]) {
      const assembly = contextOf({ board });
      expect(assembly.context.canonicalState).toBeNull();
      expect(assembly.context.canonicalRevisionDigest).toBeNull();
      expect(assembly.warnings.length).toBeGreaterThan(0);
      expect(() => buildAgentResourceBundle(assembly.context)).toThrow(/CANONICAL_RESOURCE_UNAVAILABLE/);
    }
  });

  it("R2: canonical-revision-inspect (and every PCB read) fails closed without a canonical resource; invalid-board warnings can never coexist with a canonical-revision success", async () => {
    const assembly = contextOf({ board: INVALID_BOARD });
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    for (const toolId of ["sirkit.project.canonical-revision-inspect", "sirkit.pcb.board-inspect", "sirkit.pcb.revision-inspect", "sirkit.validation.drc-run"]) {
      const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId, version: "1.0.0", args: {}, context: assembly.context, timeoutMs: 3000 });
      expect(outcome.ok, toolId).toBe(false);
      expect(outcome.kind).toBe("refused");
    }
  });

  it("[superseded by B09.3] boardless schematic inspection REFUSES (the snapshot bypass was removed); a complete valid board restores the full canonical path", async () => {
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const schematicOnly = contextOf({ board: undefined });
    const boardless = await gateway.invoke({ runId: "r", provider: "openai", toolId: "sirkit.schematic.inspect", version: "1.1.0", args: {}, context: schematicOnly.context, timeoutMs: 3000 });
    expect(boardless).toMatchObject({ kind: "refused", ok: false, status: "authority_unavailable" });

    const full = contextOf({});
    expect(full.context.canonicalState).not.toBeNull();
    expect(full.warnings).toEqual([]);
    const canonical = await gateway.invoke({ runId: "r", provider: "openai", toolId: "sirkit.project.canonical-revision-inspect", version: "1.0.0", args: {}, context: full.context, timeoutMs: 3000 });
    expect(canonical.kind).toBe("read");
    expect(canonical.ok).toBe(true);
  });

  it("the runtime toolset excludes resource-unsatisfied tools deterministically; the static registry stays at the exact intentional agent-exposed set (ELEVEN ids since B14 when written; the set has since grown by reviewed moves, B20-A4 among them, and the assertion counts the set itself)", () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): the B20 closeout's wording (8a5637f) for the ELEVEN title it missed; assertions unchanged
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B14: + replacement; B15.3: + pcb.propose-bounded-edit
    const schematicOnly = contextOf({ board: undefined, mark: VALID_MARK });
    const warnings: string[] = [];
    const toolset = buildRunToolset(sirkitToolRegistry(), schematicOnly.context, (message) => warnings.push(message));
    // [B09.3] without canonical authority every read is withheld — only the
    // lineage-sealed proposal remains. [PR-D, 2026-10-17] pin move: every CANONICAL read; the Schematic to PCB preflight read
    // (sirkit.pcb-sync.preflight) is a Tier 0 read over the run's verified schematic snapshot that needs no board (its own binding, not B05's).
    expect(toolset.declarations.map((declaration) => declaration.toolId).sort()).toEqual([
      "sirkit.pcb-sync.preflight",
      "sirkit.schematic.propose-tier1-edit",
    ]);
    const again = buildRunToolset(sirkitToolRegistry(), schematicOnly.context, () => undefined);
    expect(again.declarations.map((declaration) => declaration.toolId)).toEqual(toolset.declarations.map((declaration) => declaration.toolId));
  });
});

describe("B09.2 §B — integrity-pinned resource authority (R3)", () => {
  const scope = { tenantId: "local", projectId: "p92", branchId: "main" };
  function bundleOf() {
    const assembly = contextOf({});
    return buildAgentResourceBundle(assembly.context);
  }

  it("R3: changing authorityStatus after sealing is an INTEGRITY failure (digest + manifest)", () => {
    const bundle = bundleOf();
    const tampered = structuredClone(bundle);
    (tampered.canonicalState as { authorityStatus: string }).authorityStatus = "unverified";
    const failures = validateReadResourceBundle(tampered, scope);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.map((failure) => failure.code)).toContain("corrupt_resource");
    expect(failures.map((failure) => failure.code)).toContain("manifest_mismatch");
  });

  it("only VERIFIED resources may be consumed: unverified and unavailable refuse with explicit codes (canonical AND auxiliary)", async () => {
    const service = new ReadToolInvocationService(sirkitToolRegistry());
    const assembly = contextOf({});
    const base = buildAgentResourceBundle(assembly.context);
    const request = (bundle: typeof base) => service.invoke({
      invocationId: "inv-1", toolId: "sirkit.validation.drc-run", toolVersion: "1.0.0",
      tenantId: "local", projectId: "p92", branchId: "main",
      actorId: assembly.context.actor.actorId, actorRole: assembly.context.actor.actorRole,
      grantedCapabilities: assembly.context.actor.grantedCapabilities,
      channel: "assistant-agent",
      canonicalRevisionDigest: assembly.context.canonicalRevisionDigest!,
      authoritySource: "local-working-copy", currentEditor: "",
      args: {}, traceId: "trace-1", requestTimestamp: 1,
    }, assembly.context.discovery, bundle);

    // verified succeeds
    expect((await request(base)).status).toBe("succeeded");
    // canonical unverified (re-sealed so integrity holds) refuses
    const unverifiedCanonical = buildReadResourceBundle(
      sealResourceEnvelope({ ...base.canonicalState, authorityStatus: "unverified" }),
      base.auxiliary,
    );
    expect((await request(unverifiedCanonical)).status).toBe("resource_unverified");
    // auxiliary unavailable (re-sealed) refuses
    const unavailableAux = buildReadResourceBundle(
      base.canonicalState,
      base.auxiliary.map((envelope) => envelope.kind === "drc-rules" ? sealResourceEnvelope({ ...envelope, authorityStatus: "unavailable" }) : envelope),
    );
    expect((await request(unavailableAux)).status).toBe("resource_unavailable");
  });

  it("superseded v1 envelopes fail EXPLICITLY, never silently", () => {
    const bundle = bundleOf();
    const stale = structuredClone(bundle);
    (stale.canonicalState as { schema: string }).schema = "sirkit.read-authority-resource.v1";
    const failures = validateReadResourceBundle(stale, scope);
    expect(failures.some((failure) => failure.detail.includes("v1 is superseded"))).toBe(true);
  });
});

// ─── §C — hard deadline (R4) ─────────────────────────────────────────────────

type StepScript = (input: { signal?: AbortSignal }) => Promise<Partial<AgentStep>> | Partial<AgentStep>;
class FakeAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  startCalls = 0;
  private index = 0;
  constructor(private readonly script: StepScript[]) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: {}, model: "fake", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(input: { signal?: AbortSignal }): Promise<AgentStep> { this.startCalls += 1; return this.step(await this.script[this.index++]!(input)); }
  async continueWith(input: { signal?: AbortSignal }): Promise<AgentStep> { return this.step(await this.script[this.index++]!(input)); }
}

/** Resolves AFTER `ms` fake-time WITHOUT honoring the abort signal. */
const resolvesLate = (ms: number, partial: Partial<AgentStep>): StepScript => () =>
  new Promise((resolve) => setTimeout(() => resolve(partial), ms));
/** Rejects AFTER `ms` fake-time without honoring the abort signal. */
const rejectsLate = (ms: number): StepScript => () =>
  new Promise((_resolve, reject) => setTimeout(() => reject(new Error("late upstream failure")), ms));

async function runDeadline(script: StepScript[], options?: { deadlineMs?: number; signal?: AbortSignal; gatewayLateMs?: number }) {
  const events: AgentRunEvent[] = [];
  const assembly = contextOf({});
  const adapter = new FakeAdapter(script);
  const gateway = options?.gatewayLateMs !== undefined
    ? { invoke: () => new Promise<never>((resolve) => setTimeout(() => resolve({ kind: "refused", ok: false, toolId: "x", status: "late", diagnostics: [] } as never), options.gatewayLateMs)) }
    : createAgentToolGateway(sirkitToolRegistry());
  const pending = runAgentLoop(
    { runId: "run-dl", provider: "openai", history: [], userMessage: "go", budget: { ...DEFAULT_AGENT_BUDGET, runDeadlineMs: options?.deadlineMs ?? 100 }, signal: options?.signal },
    { adapter, gateway: gateway as never, registry: sirkitToolRegistry(), context: assembly.context, system: "sys", emit: (event) => events.push(event) },
  );
  await vi.advanceTimersByTimeAsync(10_000); // settle everything, including late timers
  const result = await pending;
  return { result, events, adapter };
}

describe("B09.2 §C — the deadline is HARD (fake timers; no wall clock)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const terminalCount = (events: AgentRunEvent[]): number => events.filter((event) => event.type === "run_failed" || event.type === "run_completed").length;

  it("R4: a start that IGNORES the signal and resolves after the deadline is DISCARDED — deadline failure, one terminal event, no late text/completion", async () => {
    const { result, events } = await runDeadline([resolvesLate(500, { text: "late success" })], { deadlineMs: 100 });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("deadline");
    expect(terminalCount(events)).toBe(1);
    expect(events.some((event) => event.type === "text_delta" || event.type === "run_completed")).toBe(false);
  });

  it("a continuation that ignores the signal and resolves after the deadline is discarded", async () => {
    const { result, events } = await runDeadline([
      () => ({ toolCalls: [{ callId: "c1", providerName: "sirkit_schematic_inspect", argumentsText: "{}" }] }),
      resolvesLate(500, { text: "late" }),
    ], { deadlineMs: 100 });
    expect(result.failureReason).toBe("deadline");
    expect(terminalCount(events)).toBe(1);
  });

  it("a gateway that ignores the signal and resolves after the deadline is discarded", async () => {
    const { result, events } = await runDeadline([
      () => ({ toolCalls: [{ callId: "c1", providerName: "sirkit_schematic_inspect", argumentsText: "{}" }] }),
      () => ({ text: "unreachable" }),
    ], { deadlineMs: 100, gatewayLateMs: 500 });
    expect(result.failureReason).toBe("deadline");
    expect(terminalCount(events)).toBe(1);
  });

  it("a provider resolving normally IMMEDIATELY after the deadline timer is still discarded; a late rejection never becomes unhandled", async () => {
    const { result: resolveResult } = await runDeadline([resolvesLate(101, { text: "one tick late" })], { deadlineMs: 100 });
    expect(resolveResult.failureReason).toBe("deadline");
    const { result: rejectResult, events } = await runDeadline([rejectsLate(300)], { deadlineMs: 100 });
    expect(rejectResult.failureReason).toBe("deadline");
    expect(terminalCount(events)).toBe(1);
  });

  it("a PRE-ABORTED request never calls the provider", async () => {
    const controller = new AbortController();
    controller.abort();
    const { result, adapter, events } = await runDeadline([() => ({ text: "never" })], { signal: controller.signal, deadlineMs: 5_000 });
    expect(adapter.startCalls).toBe(0);
    expect(result.status).toBe("cancelled");
    expect(terminalCount(events)).toBe(1);
  });

  it("the toolset-invalid path clears timers/listeners and emits one terminal event; no late events after any exit", async () => {
    // Registry/discovery already refuse every representable defect
    // themselves (e.g. provider_name_length), so the loop's own
    // toolset-cleanup branch is driven by a registry whose enumeration
    // fails outright — the loop must still settle with ONE terminal event
    // and cleared timers.
    const events: AgentRunEvent[] = [];
    const assembly = contextOf({});
    const brokenRegistry = { list: () => { throw new Error("REGISTRY_ENUMERATION_FAILED"); } } as never;
    const pending = runAgentLoop(
      { runId: "run-ti", provider: "openai", history: [], userMessage: "go", budget: { ...DEFAULT_AGENT_BUDGET, runDeadlineMs: 100 } },
      { adapter: new FakeAdapter([() => ({ text: "unreachable" })]), gateway: createAgentToolGateway(sirkitToolRegistry()), registry: brokenRegistry, context: assembly.context, system: "s", emit: (event) => events.push(event) },
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.failureReason).toBe("toolset_invalid");
    const count = events.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events.length).toBe(count); // nothing late — timer/listener cleared
    expect(events.filter((event) => event.type === "run_failed")).toHaveLength(1);
  });
});

describe("B09.2 §D — malformed schemas fail BEFORE rendering (R5)", () => {
  it("R5: nonsense type, ghost required, non-schema items, and non-array enum all throw (never silently rewritten)", () => {
    const hostile: Array<[string, Record<string, unknown>]> = [
      ["nonsense type", { type: "nonsense" }],
      ["ghost required", { type: "object", properties: { a: { type: "string" } }, required: ["ghost"] }],
      ["non-schema items", { type: "object", properties: { a: { type: "array", items: 42 } }, required: ["a"] }],
      ["non-array enum", { type: "object", properties: { a: { enum: { x: 1 } } }, required: ["a"] }],
      ["non-schema anyOf entry", { type: "object", properties: { a: { anyOf: [7] } }, required: ["a"] }],
      ["array without items", { type: "object", properties: { a: { type: "array" } }, required: ["a"] }],
      ["permissive additionalProperties", { type: "object", properties: {}, additionalProperties: true }],
    ];
    for (const [name, schema] of hostile) {
      expect(() => toStrictSchema(schema), name).toThrow(/STRICT_SCHEMA_UNSUPPORTED/);
    }
    // The source schema is never mutated.
    const source = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
    const frozen = JSON.stringify(source);
    toStrictSchema(source);
    expect(JSON.stringify(source)).toBe(frozen);
  });
});

describe("B09.2 §E — proposal scope + capability closure (R6/R7)", () => {
  it("R6: every mark the canonical validator rejects is rejected by the proposal-scope validator (no weaker duplicate)", () => {
    const invalidMarks = [
      { lineageId: "not-a-lineage-format", headSequence: 3, canonicalStateDigest: "not-a-digest" },
      { lineageId: "lin1-1234567890abcdef", headSequence: -1, canonicalStateDigest: "eng1-1234567890abcdef" },
      { lineageId: "lin1-1234567890abcdef", headSequence: 2 ** 53, canonicalStateDigest: "eng1-1234567890abcdef" },
      { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef", extra: "key" },
    ];
    for (const mark of invalidMarks) {
      expect(validateSchematicCanonicalMark(mark)).toBeNull();
      expect(isWellFormedProposalScope({ tenantId: "local", projectId: "p", branchId: "main", headMark: mark })).toBe(false);
    }
    // Extra SCOPE keys refuse too.
    expect(isWellFormedProposalScope({ tenantId: "local", projectId: "p", branchId: "main", headMark: VALID_MARK, role: "admin" })).toBe(false);
    expect(isWellFormedProposalScope({ tenantId: "local", projectId: "p", branchId: "main", headMark: VALID_MARK })).toBe(true);
  });

  it("R7: a capability missing from the EFFECTIVE ACTOR refuses proposal creation even when discovery grants are unchanged", async () => {
    const assembly = contextOf({ mark: VALID_MARK });
    const stripped = { ...assembly.context, actor: { ...assembly.context.actor, grantedCapabilities: [] as never[] } };
    const service = new ProposalInvocationService(sirkitToolRegistry());
    const outcome = await service.invoke({
      toolId: "sirkit.schematic.propose-tier1-edit", version: AGENT_PROPOSAL_TOOL_VERSION,
      args: { ops: [{ op: "set-value", target: "r1", value: "1k" }] },
      context: stripped as never, provenance: { provider: "openai", instruction: "x" },
    });
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("unreachable");
    expect(["unauthorized", "context_integrity"]).toContain(outcome.failure);
  });

  it("actor/discovery divergence (identity, role, capabilities, scope, revision anchor) fails EVERY gateway invocation closed; a consistent context passes", async () => {
    const assembly = contextOf({ mark: VALID_MARK });
    expect(verifyAgentContextIntegrity(assembly.context)).toEqual([]);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const divergences = [
      (context: typeof assembly.context) => ({ ...context, actor: { ...context.actor, actorId: "someone-else" } }),
      (context: typeof assembly.context) => ({ ...context, actor: { ...context.actor, actorRole: "viewer" as never } }),
      (context: typeof assembly.context) => ({ ...context, discovery: { ...context.discovery, grantedCapabilities: [...context.discovery.grantedCapabilities, "edit_copper" as never] } }),
      (context: typeof assembly.context) => ({ ...context, discovery: { ...context.discovery, projectId: "another-project" } }),
      (context: typeof assembly.context) => ({ ...context, discovery: { ...context.discovery, currentRevisionDigest: "eng1-forgedforgedforged" } }),
    ];
    for (const diverge of divergences) {
      const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId: "sirkit.schematic.inspect", version: "1.1.0", args: {}, context: diverge(assembly.context) as never, timeoutMs: 3000 });
      expect(outcome).toMatchObject({ kind: "refused", status: "context_integrity" });
    }
    // Non-"main" branch works when everything is CONSISTENT.
    const altAssembly = assembleAgentRunContext({ tenantId: "local", projectId: "p92", branchId: "release-b", schematic: SCHEMATIC, board: createEmptyBoard(), schematicHeadMark: VALID_MARK });
    if (!altAssembly.ok) throw new Error(altAssembly.reason);
    const outcome = await gateway.invoke({
      runId: "r", provider: "anthropic", toolId: "sirkit.schematic.propose-tier1-edit", version: AGENT_PROPOSAL_TOOL_VERSION,
      args: { ops: [{ op: "set-value", target: "r1", value: "2k" }] }, context: altAssembly.context, timeoutMs: 3000,
    });
    if (outcome.kind !== "proposal") throw new Error(`expected proposal, got ${JSON.stringify(outcome).slice(0, 160)}`);
    expect(outcome.proposal.scope.branchId).toBe("release-b");
    expect(outcome.proposal.provenance.provider).toBe("anthropic");
  });
});

describe("B09.2 §F — catalog evidence paths exist (CI gate)", () => {
  it("every sourceEvidence repository path in the catalog exists", () => {
    const missing: string[] = [];
    for (const descriptor of sirkitToolRegistry().list()) {
      for (const evidence of descriptor.sourceEvidence) {
        if (!existsSync(join(process.cwd(), evidence))) missing.push(`${descriptor.toolId}: ${evidence}`);
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });
});
