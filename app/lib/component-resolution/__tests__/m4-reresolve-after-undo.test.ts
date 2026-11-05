/**
 * [PR-L6, 2026-10-19] Runbook M.5 item 7 (Undo / Redo stay consistent): after an applied component resolution is UNDONE in the page,
 * the same instances can be resolved again from the current schematic - over the page's own history-step shape (the production
 * SchematicGestureCoordinator.runHistoryStep with the page's callbacks, a history of SchematicSnapshot model fields that carries NO
 * sheet size) and the chat route's scripted agent under the fixture runtime.
 *
 * Reproduced (measured in e2e/m4-existing-board-resolution.spec.ts and here): the page's undo target dropped the sheet size, so it never
 * matched the canonical transaction it undoes; the session rebased its lineage onto a sheet WITHOUT a size, and the next "Find a
 * replacement" was refused by the assembler ("does not sit at the claimed canonical head") until a reload. With `historyStepState` (the
 * snapshot's model fields plus the authoritative sheet size) the undo is REPLAYED canonically on the same lineage, the projection keeps
 * the size, a re-resolution seals and applies, and Redo replays too.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";

import { POST as CHAT } from "@/app/api/chat/route";
import { POST as FACTS } from "@/app/api/component-resolution-authority/route";
import { POST as APPLY_AUTHORIZATION } from "@/app/api/pcb/apply-authorization/route";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "@/app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { InMemoryTraceSink, setAgentTraceSinkFactory } from "@/app/lib/agent/trace-recorder";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry } from "@/app/lib/engineering/approved-agent-mutations";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { approveAndApplyResolution } from "@/app/lib/project/resolution-approval-controller.internal";
import { receiveComponentResolutionEvent } from "@/app/lib/project/component-resolution-events";
import { historyStepState, type HistoryStepSnapshot } from "@/app/lib/project/history-step-state";
import { assessResolutionBoardImpact, resolutionBoardImpactItems, type ResolutionBoardBasis } from "../board-impact";
import type { SealedResolutionProposal } from "../resolution-proposal";

const SCOPE = { tenantId: "local", projectId: "p-m4-reresolve", branchId: "main" } as const;
const ORIGIN = "http://localhost";
const NO_BOARD: ResolutionBoardBasis & { state: "no-board" } = { state: "no-board", boardId: "board:p-m4-reresolve" };

beforeEach(() => {
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
  vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
  vi.stubEnv("SIRKIT_FIXTURE_AGENT", "scripted");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SIRKIT_ORCHESTRATION_ENABLED", "");
  resetFixtureContainer();
  resetAdmissionControl();
  setAgentTraceSinkFactory(() => new InMemoryTraceSink());
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = new URL(typeof url === "string" ? url : url.toString(), ORIGIN).toString();
    const headers = new Headers(init?.headers);
    headers.set("origin", ORIGIN);
    headers.set("cookie", "sirkit-fixture-role=editor");
    const request = new Request(href, { ...init, headers });
    if (href.endsWith("/api/pcb/apply-authorization")) return APPLY_AUTHORIZATION(request);
    if (href.endsWith("/api/component-resolution-authority")) return FACTS(request);
    throw new Error(`unexpected fetch: ${href}`);
  });
});
afterEach(() => { setAgentTraceSinkFactory(null); resetFixtureContainer(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const modelOf = (state: SchematicState): HistoryStepSnapshot => ({ components: state.components, wires: state.wires, kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [] });

/** The page's composition: the session, the coordinator, and a history of MODEL snapshots (no sheet size), as app/page.tsx keeps it. */
async function page() {
  const state = fixtureDimmerSheet();
  const editor = new SchematicEditorSession({ ...SCOPE }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(structuredClone(state), null);
  let visible = structuredClone(state);
  const history = new SchematicHistory<HistoryStepSnapshot>(modelOf(state), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible), applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<HistoryStepSnapshot>({ flushPendingRecord: () => {}, history: () => history, applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); }, snapshot: (authoritative) => modelOf(authoritative), historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {} }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); coordinator.notifyAuthoritativeProjection(next); },
    execute: (base, request) => editor.execute(base, request), notify: () => {},
  });
  /** The page's runHistoryStep (app/page.tsx): `withSize` false reproduces the old target (model fields only). */
  const step = (direction: "undo" | "redo", withSize = true) => coordinator.runHistoryStep({
    direction,
    peek: () => { const snap = direction === "undo" ? history.peekUndo() : history.peekRedo(); return snap ? (withSize ? historyStepState(snap, coordinator.authoritativeState()) : { ...modelOf(snap as SchematicState) }) : null; },
    reconcile: (target) => editor.reconcileHistoryStep(direction, target),
    commitCursor: () => { if (direction === "undo") history.undo(); else history.redo(); },
    applyUi: () => { const next = withSize ? historyStepState(history.present, coordinator.authoritativeState()) : { ...modelOf(history.present as SchematicState) }; visible = structuredClone(next); coordinator.notifyAuthoritativeProjection(next); },
  });
  /** The chat request the page sends: its authoritative schematic with the page's sheet size, and the session's head mark. */
  const seal = async (): Promise<{ proposal: SealedResolutionProposal | null; lines: string }> => {
    const schematicState = { ...coordinator.authoritativeState(), pageSize: coordinator.authoritativeState().pageSize ?? "A4" };
    const response = await CHAT(new Request(`${ORIGIN}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN, cookie: "sirkit-fixture-role=editor" }, body: JSON.stringify({ provider: "anthropic", messages: [{ role: "user", content: "Replace D1 and D2 with suitable alternatives already in the library." }], scope: SCOPE, schematicState, schematicHeadMark: editor.headMark() }) }));
    const text = await response.text();
    const ready = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>).find((event) => event.type === "component_resolution_ready");
    return { proposal: ready ? receiveComponentResolutionEvent(ready)?.proposal ?? null : null, lines: text };
  };
  const store = new InMemoryApprovedMutationJournalStore();
  const apply = (proposal: SealedResolutionProposal) => approveAndApplyResolution({ proposal, session: editor, gateway: coordinator, interlock: new ProjectCommitInterlock(), journal: new ApprovedMutationJournal(store, SCOPE), stillCurrent: () => true, currentProjectId: SCOPE.projectId, currentBranchId: SCOPE.branchId, tenantId: SCOPE.tenantId, originRunId: "run-m4-reresolve", registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(), boardImpact: { state: "assessed", impact: assessResolutionBoardImpact({ items: resolutionBoardImpactItems(proposal), basis: NO_BOARD }) }, readBoardBasis: async () => NO_BOARD });
  return { editor, coordinator, step, seal, apply, unresolved: () => (coordinator.authoritativeState().kicadComponents ?? []).filter((instance) => !instance.atomicPartRevisionId).map((instance) => instance.refDes) };
}

describe("[PR-L6 M.5-7] re-resolving after the page's Undo of a resolution", { timeout: 120_000 }, () => {
  it("1. the undo target keeps the sheet size: the undo is replayed on the same lineage, and the same instances resolve again; Redo replays too", async () => {
    const p = await page();
    expect(p.coordinator.authoritativeState().pageSize).toBe("A4");
    const first = await p.seal();
    expect(first.proposal).not.toBeNull();
    expect(await p.apply(first.proposal!)).toMatchObject({ ok: true, status: "committed" });
    const applied = p.editor.headMark()!;
    expect(await p.step("undo")).toEqual({ status: "applied" });
    expect(p.unresolved()).toEqual(["D1", "D2"]);
    const undone = p.editor.headMark()!;
    expect(undone.lineageId).toBe(applied.lineageId); // replayed canonically, never a lineage rebase
    expect(undone.headSequence).toBe(applied.headSequence + 1);
    expect(p.editor.events.some((event) => event.kind === "undo-reconciled")).toBe(true);
    expect(p.coordinator.authoritativeState().pageSize).toBe("A4"); // the projection kept the size
    const again = await p.seal();
    expect(again.proposal, again.lines.slice(0, 600)).not.toBeNull();
    expect(again.proposal!.scope.headMark).toEqual(undone);
    expect(await p.apply(again.proposal!)).toMatchObject({ ok: true, status: "committed" });
    expect(p.unresolved()).toEqual([]);
    // and Undo / Redo of the second resolution replay canonically as well
    expect(await p.step("undo")).toEqual({ status: "applied" });
    expect(p.unresolved()).toEqual(["D1", "D2"]);
    expect(await p.step("redo")).toEqual({ status: "applied" });
    expect(p.unresolved()).toEqual([]);
    expect(p.editor.headMark()!.lineageId).toBe(applied.lineageId);
    expect((p.coordinator.authoritativeState().kicadComponents ?? []).find((instance) => instance.id === DIMMER_INSTANCE_IDS.D1)!.atomicPartRevisionId).toBe(again.proposal!.impact.items[0]!.target.atomicPartRevisionId);
  });

  it("2. the old target (model fields only) is the reproduction: a lineage rebase onto a sheet without a size, and the re-resolution is refused", async () => {
    const p = await page();
    const first = await p.seal();
    expect(await p.apply(first.proposal!)).toMatchObject({ ok: true, status: "committed" });
    const applied = p.editor.headMark()!;
    expect(await p.step("undo", false)).toEqual({ status: "applied" });
    expect(p.editor.headMark()!.lineageId).not.toBe(applied.lineageId);
    expect(p.editor.events.some((event) => event.kind === "reconcile-rebased")).toBe(true);
    const again = await p.seal();
    expect(again.proposal).toBeNull();
    expect(again.lines).toContain("does not sit at the claimed canonical head");
  });

  it("3. the helper and the page: the target is the snapshot's model fields plus the authoritative size (none when there is none); page.tsx uses it in both places", () => {
    const snapshot = modelOf(fixtureDimmerSheet());
    expect(historyStepState(snapshot, { pageSize: "A3" })).toEqual({ ...snapshot, pageSize: "A3" });
    expect(historyStepState(snapshot, {})).toEqual(snapshot);
    expect(historyStepState(snapshot, null)).toEqual(snapshot);
    const source = readFileSync("app/page.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(source).toContain("return snap ? historyStepState(snap, gestureCoordinatorRef.current?.authoritativeState()) : null;");
    expect(source).toContain("applyLifecycleSchematicProjection(historyStepState(snap, gestureCoordinatorRef.current?.authoritativeState()));");
    expect(source).not.toContain("return snap ? { components: snap.components, wires: snap.wires, kicadComponents: snap.kicadComponents, netLabels: snap.netLabels } : null;");
  });
});
