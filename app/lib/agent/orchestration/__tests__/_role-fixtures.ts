/**
 * [B21 C] Shared run contexts and a scripted per-role adapter for the C suites (not a test file). Every context is ASSEMBLED by
 * the production `assembleAgentRunContext` (never hand-built), so its digests and discovery facts are the server's own:
 *  - `fullContext`: a schematic, a board, a (empty) selection, a head mark and the server-owned component authority production
 *    loads for U1's one durable binding ([B21 C fix]: never an empty record set, which the loader never produces), for a
 *    `pcb_editor` - every specialist role except the cost/latency router has at least one effective read here;
 *  - `grantableContext`: the WORST coordinator context a specialist could be derived from - the minter bound
 *    (`executionGrantsAvailable`), the external and MCP ports bound, a head mark, a PCB basis and a captured view, for a
 *    `project_admin` on a board that holds R3 (a granted move of R3 really mints through the coordinator's gateway).
 * The adapter reads the role from the specialist frame's `Role:` line and answers with one valid result document, or first
 * calls the provider name it is scripted to call for that role.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { mmToNm } from "@/app/lib/pcb/units";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { defaultAutonomySetting, type AgentAutonomySetting } from "@/app/lib/engineering/permission-tiers";
import { assembleAgentRunContext, type AssembleAgentContextInput } from "@/app/lib/agent/context";
import { VIEW_CONTEXT_SCHEMA } from "@/app/lib/agent/view-context";
import type { AgentRunContext, AgentStep, AgentToolResult, ProviderAgentAdapter, ProviderToolDeclaration } from "@/app/lib/agent/contracts";
import { LLMProviderError, type LLMProviderFailureReason } from "@/app/lib/llm/errors";
import { loadRunComponentAuthority } from "@/app/lib/engineering/component-authority-source";
import { FIXTURE_AUTHORITY_VARIANT, matchingAtomicConfirmer, validApprovedAggregate } from "@/app/lib/engineering/__tests__/_authority-fixtures";
import { PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH, pcbBoardInstanceId } from "@/app/lib/pcb/board-identity";
import { SPECIALIST_RESULT_SCHEMA } from "../contracts";

export const ROLE_SCOPE = Object.freeze({ tenantId: "tenant-1", projectId: "project-1", branchId: "main" });
export const T0 = Date.parse("2026-09-26T12:00:00.000Z");
export const ROLE_SCHEMATIC: SchematicState = {
  components: [], wires: [], netLabels: [],
  kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" }],
};
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(ROLE_SCHEMATIC, ROLE_SCOPE) };

/** [B21 C fix] What production loads for a project whose schematic components each hold ONE durable binding: the REAL
 *  physical-binding service writes the aggregate under the route's own board identity, and the route's production loader
 *  (`loadRunComponentAuthority`) projects it - never an empty record set, which that loader never produces (it settles null for
 *  a project with no binding, on a failure and past its deadline). */
export async function loadedAuthority(scope: { tenantId: string; projectId: string; branchId: string }, componentIds: readonly string[] = ["u1-id"]): Promise<NonNullable<Awaited<ReturnType<typeof loadRunComponentAuthority>>>> {
  const boardScope = { ...scope, boardInstanceId: pcbBoardInstanceId(scope.projectId) };
  const aggregates = new Map(await Promise.all(componentIds.map(async (id) => [id, await validApprovedAggregate(id, { scopeOverrides: { ...boardScope, hierarchyPath: [...PCB_BOARD_HIERARCHY_PATH], assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT] } })] as const)));
  const loaded = await loadRunComponentAuthority(
    { bindings: { loadForComponent: async (componentScope) => { const aggregate = aggregates.get(componentScope.componentInstanceId); return aggregate ? [aggregate] : []; } }, atomic: matchingAtomicConfirmer() },
    { scope: boardScope, canonicalRevision: "fixture-revision", componentInstanceIds: componentIds, hierarchyPath: PCB_BOARD_HIERARCHY_PATH, assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID },
  );
  if (!loaded) throw new Error("the component-authority fixture did not load");
  return loaded;
}

/** U1's durable binding, loaded once as the route loads it (the authority of `fullContext` and `grantableContext`). */
export const ROLE_AUTHORITY = await loadedAuthority(ROLE_SCOPE);

function assembled(input: AssembleAgentContextInput): AgentRunContext {
  const assembly = assembleAgentRunContext(input);
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

export function fullContext(over: Partial<AssembleAgentContextInput> = {}): AgentRunContext {
  return assembled({
    ...ROLE_SCOPE, schematic: ROLE_SCHEMATIC, board: createEmptyBoard(), selection: { refs: [], primary: null }, schematicHeadMark: HEAD_MARK,
    componentAuthority: ROLE_AUTHORITY,
    verifiedActor: { principalId: "u-1", actorRole: "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    ...over,
  });
}

/** The board of the B18-C sweep: R3, so a granted move is real. */
export const R3_BOARD = makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
export const R3 = R3_BOARD.footprints.find((footprint) => footprint.ref === "R3")!;
export const MOVE_R3_ARGS = { moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(2), y: R3.at.y }] };
export const PCB_BASIS = { historyHeadSequence: 4, historyHeadLabel: null, lineageId: "lin1-0000000000000001", activeDrcPresetId: DEFAULT_PRESET_ID };
export const EXPLICIT_AUTONOMY: AgentAutonomySetting = { ...defaultAutonomySetting(ROLE_SCOPE), mode: "execute_explicit_tier1", revision: 1, updatedAt: "2026-09-26T11:00:00.000Z", updatedBy: { principalId: "u-admin", membershipRevision: "mbr1-z", role: "project_admin" } };
/** A captured view with the workspace surface and a project timeline (the view tools and the history read need it). */
export const WORKSPACE_VIEW = {
  schema: VIEW_CONTEXT_SCHEMA,
  surfaces: ["workspace"],
  editors: { workspace: { editor: "workspace", sessionId: "vs-t-ws", viewRevision: 3, state: { tab: "pcb", available: ["schematic", "pcb"] } } },
  timeline: { entries: [{ seq: 1, at: T0, store: "pcb", kind: "commit", label: "Move R3", actor: "human", head: { store: "pcb", historyId: "h1", headSequence: 1, entryCount: 1 } }], eligibleUndo: { ok: true, code: null, operation: { store: "pcb", kind: "commit", label: "Move R3", seq: 1 } } },
};

export function grantableContext(over: Partial<AssembleAgentContextInput> = {}): AgentRunContext {
  return assembled({
    ...ROLE_SCOPE, schematic: ROLE_SCHEMATIC, board: R3_BOARD, schematicHeadMark: HEAD_MARK, pcbProposalBasis: PCB_BASIS, selection: { refs: [], primary: null },
    componentAuthority: ROLE_AUTHORITY, view: WORKSPACE_VIEW, autonomy: EXPLICIT_AUTONOMY,
    verifiedActor: { principalId: "u-1", actorRole: "project_admin", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    executionGrantsAvailable: true, externalAcquisitionAvailable: true, mcpObservationAvailable: true,
    ...over,
  });
}

export function resultText(role: string, summary = `(scripted) ${role}: read what it was offered; nothing changed.`): string {
  return JSON.stringify({ schema: SPECIALIST_RESULT_SCHEMA, role, summary, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low" });
}

/** One adapter for every specialist run: the role from the frame's `Role:` line; per role, optionally one scripted call first,
 *  or (`throw:<reason>`) a provider failure on start. */
export class RoleAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly starts: Array<{ role: string; tools: string[] }> = [];
  readonly continued: Array<{ role: string; results: readonly AgentToolResult[] }> = [];
  private pending: string | null = null;
  constructor(private readonly calls: Readonly<Record<string, string>> = {}) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "scripted", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(input: { system: string; tools: readonly ProviderToolDeclaration[] }): Promise<AgentStep> {
    const role = /^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "(none)";
    this.starts.push({ role, tools: input.tools.map((tool) => tool.toolId) });
    const providerName = this.calls[role];
    if (providerName?.startsWith("throw:")) throw new LLMProviderError("openai", providerName.slice("throw:".length) as LLMProviderFailureReason);
    if (providerName) {
      this.pending = role;
      return this.step({ toolCalls: [{ callId: `call-${role}`, providerName, argumentsText: "{}" }], stopReason: "tool_use" });
    }
    return this.step({ text: resultText(role) });
  }
  async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> {
    const role = this.pending ?? "(none)";
    this.pending = null;
    this.continued.push({ role, results: input.results });
    return this.step({ text: resultText(role) });
  }
}
