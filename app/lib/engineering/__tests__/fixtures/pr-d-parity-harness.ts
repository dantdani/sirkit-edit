/**
 * [PR-D] The shared composition for the UI/AI parity suites (`pr-d-parity-*`):
 * the SAME in-process composition the B18-C harness proves (a real canonical
 * editor session over a durable in-memory store; the real grant store, minter,
 * consume and settle services; the page's SAFE receiver; the real ritual driven
 * through the real loop and gateway over the production registry) — opened over
 * a CALLER-SUPPLIED board, so a UI path and an AI path can start from
 * byte-identical boards and be compared digest for digest.
 *
 * Nothing here is a second mutation path: every commit on either side goes
 * through `CanonicalEditorSession.commit` (the UI through `applyEditsCanonical`
 * / `commitPcbCandidate`, the AI through the granted-execution ritual).
 */
import { expect } from "vitest";
import { createHistory } from "../../../pcb/history";
import { pcbBoardInstanceId } from "../../../pcb/board-identity";
import { pcbRevisionId } from "../../../pcb/revision";
import { mmToNm } from "../../../pcb/units";
import type { PcbBoard } from "../../../pcb/types";
import type { EditCommand } from "../../../pcb/edit/commands";
import { DEFAULT_SILK_STROKE_NM, DEFAULT_SILK_TEXT_HEIGHT_NM } from "../../../pcb/silk/types";
import { newBoardDimension } from "../../../pcb/dimensions/commands";
import { InMemoryDurableWorkflowRepository } from "../../../durable-workflow/repository";
import { ExecutionGrantStore } from "../../../execution-grant/store";
import { createExecutionGrantMinter } from "../../../execution-grant/mint";
import { tenderConfirmedExecution } from "../../../project/granted-execution-controller.internal";
import { createAgentToolGateway } from "../../../agent/gateway";
import type { AgentExecutionGrantMinter, AgentRunContext, AgentToolInvocationGateway, GatewayInvocationOutcome } from "../../../agent/contracts";
import { AGENT_SYSTEM_PROMPT_VERSION } from "../../../prompts";
import { applyEditsCanonical, bindCanonicalEditorSession, canonicalSessionFor } from "../../editor-adapter";
import { InMemoryAtomicProjectStore } from "../../persistence";
import { ProjectCommitInterlock } from "../../project-commit-interlock";
import { AgentExecutionJournal, InMemoryAgentExecutionJournalStore } from "../../agent-execution-journal";
import { GrantedExecutionRegistry } from "../../granted-executions";
import { buildExecutionOperations } from "../../execution-operations";
import { canonicalLineageDigest } from "../../semantic-board-digest";
import { sirkitToolRegistry } from "../../tool-catalog";
import type { AgentAutonomySetting } from "../../permission-tiers";
import type { PublicExecutionGrant } from "../../execution-grant";
import { MESSAGE, PRINCIPAL, PROJECT, SCOPE, T0, call, fixtureBoard, headOf, ritual, runContext, runScenario, setting, transportOver, type Composed, type Core } from "../b18c-harness";

export const MOVE_TOOL = "sirkit.pcb.move-footprint";
export const ROTATE_TOOL = "sirkit.pcb.rotate-side-footprint";
export const ARRANGE_TOOL = "sirkit.pcb.arrange";
export const SILK_TOOL = "sirkit.pcb.silkscreen-text";
export const DIMENSION_TOOL = "sirkit.pcb.dimension";
export const UNDO_TOOL = "sirkit.pcb.undo-redo-granted";

/** The harness fixture (R3 at 5,5 → moved to 6,5 by the setup commit; R4 at 30,22) plus one silk text and one dimension, so
 *  every family has an existing target to update or remove. */
export function annotatedBoard(): PcbBoard {
  const board = fixtureBoard();
  board.silkItems = [
    { kind: "text", id: "silk-rev", layer: "silkTop", position: { x: mmToNm(30), y: mmToNm(25) }, text: "REV A", heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM, strokeWidthNm: DEFAULT_SILK_STROKE_NM, rotationDeg: 0, mirror: false, anchor: "center" },
  ];
  board.dimensions = [newBoardDimension({ id: "dim-width", kind: "horizontal", a: { x: 0, y: 0 }, b: { x: mmToNm(40), y: 0 }, offsetNm: -mmToNm(3), layer: "fabTop" })];
  return board;
}

/** The B18-C harness composition over a caller-supplied board (the harness's own `composition` builds its board internally). */
export async function composeFrom(board: PcbBoard, mode: AgentAutonomySetting["mode"] = "proposal_only"): Promise<Composed> {
  const durableStore = new InMemoryAtomicProjectStore();
  const bound = bindCanonicalEditorSession(createHistory(board), SCOPE, { durableStore });
  const history = bound.history;
  const session = canonicalSessionFor(history)!;
  const r3 = history.committedPresent.footprints.find((f) => f.ref === "R3")!;
  const setupBuilt = buildExecutionOperations(history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: mmToNm(6), y: mmToNm(5) }] });
  if (!setupBuilt.ok) throw new Error(setupBuilt.message);
  const setup = await session.commit({ commandId: "pcb.move-footprint", label: "setup", buildOperations: () => setupBuilt.operations });
  if (!setup.ok || setup.status !== "executed") throw new Error("setup commit must execute");
  const started = Date.now();
  const core: Core = {
    history, session, durableStore, now: () => T0 + (Date.now() - started), autonomy: setting(mode),
    store: new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()), interlock: new ProjectCommitInterlock(), registry: new GrantedExecutionRegistry(),
    journal: new AgentExecutionJournal(new InMemoryAgentExecutionJournalStore(), { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), editor: "pcb" }),
  };
  return { ...core, transport: transportOver(core) };
}

export interface Pair { ui: Composed; ai: Composed }
export interface StartMark { digest: string; revision: string; head: number }

/** Two compositions over byte-identical boards: one for the UI path, one for the AI path. */
export async function pair(board: PcbBoard = fixtureBoard()): Promise<Pair & { start: StartMark }> {
  const ui = await composeFrom(structuredClone(board));
  const ai = await composeFrom(structuredClone(board));
  const start = mark(ui);
  expect(mark(ai)).toEqual(start);
  return { ui, ai, start };
}

export const digestOf = (c: Composed): string => canonicalLineageDigest(c.history.committedPresent);
export const revisionOf = (c: Composed): string => pcbRevisionId(c.history.committedPresent);
export const mark = (c: Composed): StartMark => ({ digest: digestOf(c), revision: revisionOf(c), head: headOf(c).headSequence });
export const footprintOf = (c: Composed, ref: string) => c.history.committedPresent.footprints.find((f) => f.ref === ref)!;
/** The canonical state digests (before → after) the editor history entry records for its last applied entry (B03 details) — the
 *  executor's own measure of "the same change": identical when the base and the result are identical, whoever committed. (The
 *  durable record's integrity digest is NOT that measure: it covers the transaction id, the idempotency key, the actor and the
 *  provenance, which legitimately differ between a UI commit and a granted execution.) */
export const lastCanonicalStatesOf = (c: Composed): { revisionBefore?: string; revisionAfter?: string } => {
  const b03 = (c.history.entries.filter((entry) => entry.state === "applied").at(-1)?.metadata.details as { b03?: { revisionBefore?: string; revisionAfter?: string } } | undefined)?.b03;
  return { revisionBefore: b03?.revisionBefore, revisionAfter: b03?.revisionAfter };
};
/** The command id the session recorded for its last executed transaction. */
export const lastExecutedCommandOf = (c: Composed): string | undefined => c.session.events.filter((event) => event.kind === "executed").at(-1)?.detail.split(":")[0];

/** The UI path: an inspector / palette / selection batch through `applyEditsCanonical` → `CanonicalEditorSession.commit`. */
export async function uiCommit(c: Composed, cmds: EditCommand[]): Promise<void> {
  const result = await applyEditsCanonical(c.history, cmds);
  expect(result.ok, result.errors.join("; ")).toBe(true);
  await c.session.whenIdle();
}

/** The AI path in `proposal_only`: the tool call seals the intent, the server mints a PREVIEW grant, the human's Confirm runs the
 *  ritual, which commits through the SAME `CanonicalEditorSession.commit`. */
export async function aiCommit(c: Composed, toolId: string, args: unknown, message: string): Promise<{ grant: PublicExecutionGrant }> {
  const { grants, rituals, adapter } = await runScenario(c, (_move, tool) => [() => ({ toolCalls: [call("c1", tool(toolId), JSON.stringify(args))] }), () => ({ text: "done" })], { message });
  expect(rituals, "proposal_only previews; nothing auto-runs").toEqual([]);
  expect(grants.length, adapter.continueInputs[0]?.[0]?.outputText ?? "(no tool result)").toBe(1);
  const outcome = await tenderConfirmedExecution(ritual(c, grants[0]!));
  expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: true, status: "committed" });
  await c.session.whenIdle();
  return { grant: grants[0]! };
}

/** The harness minter (trusted inputs), wrapped so a suite can prove it was never asked to mint. */
export function spyMinter(c: Composed, message: string = MESSAGE, runId = "run-pr-d"): { minter: AgentExecutionGrantMinter; calls: () => number } {
  let calls = 0;
  const real = createExecutionGrantMinter({
    principalId: PRINCIPAL.principalId, role: "pcb_editor", membershipRevision: PRINCIPAL.membershipRevision, authClass: "local_dev", sessionIdentity: PRINCIPAL.sessionIdentity, correlationId: "corr-pr-d",
    scope: SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), autonomy: c.autonomy, userMessage: message, runId, provider: "openai", store: c.store, now: c.now,
  });
  return {
    minter: { mint: (request) => { calls += 1; return real.mint(request); }, awaitSettlement: (id, options) => real.awaitSettlement(id, options), retireIssued: (reason, explicit) => real.retireIssued(reason, explicit) },
    calls: () => calls,
  };
}

export function gatewayFor(c: Composed, minter: AgentExecutionGrantMinter): AgentToolInvocationGateway {
  return createAgentToolGateway(sirkitToolRegistry(), { executionGrants: minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION, now: c.now });
}

/** One gateway invocation over the run context assembled from the LIVE board (as the page sends it). */
export function invokeTool(c: Composed, gateway: AgentToolInvocationGateway, toolId: string, args: Record<string, unknown>, callId = "call-1", context: AgentRunContext = runContext(c)): Promise<GatewayInvocationOutcome> {
  const version = sirkitToolRegistry().get(toolId)?.version ?? "1.0.0";
  return gateway.invoke({ runId: "run-pr-d", provider: "openai", toolId, version, args, context, timeoutMs: 5_000, callId });
}
