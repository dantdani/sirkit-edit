/**
 * B08.1 — PCB lifecycle-generation and retired-session hardening.
 *
 * Reproduces and closes the independently confirmed B08 defects:
 *  1/2  Retired histories were mistaken for never-bound histories — the
 *       gateway/edit funnel executed a legacy whole-board mutation on them.
 *  3    An in-flight canonical commit could publish into its detached
 *       history after the session was retired mid-execution.
 *  4    Bare-history legacy mutation had no explicit authority.
 *  5-8  Lifecycle-generation ownership for asynchronous producers (scope
 *       semantics; the PcbEditor wiring is source-asserted).
 *
 * Every zero-mutation claim asserts EXACT board digests, history entry
 * counts, and reference identity — never merely result types.
 */

import { describe, expect, it } from "vitest";

// select-move's editable-target guard references HTMLElement (browser
// global); provide a bare stand-in for the node environment.
(globalThis as { HTMLElement?: unknown }).HTMLElement ??= class {};
import { produce } from "immer";
import type { PcbBoard, Track } from "../../pcb/types";
import { createEmptyBoard } from "../../pcb/types";
import { createHistory } from "../../pcb/history";
import { createSelectMoveTool } from "../../pcb/tools/select-move";
import type { ProjectPersistenceEnvelope } from "../types";
import { semanticStateDigest } from "../revision";
import { commitPcbCandidate } from "../pcb-commit-gateway";
import { authorizeBarePcbHistory } from "../pcb-bare-authority.internal";
import {
  applyEditsCanonical,
  bindCanonicalEditorSession,
  historyBindingState,
} from "../editor-adapter";
import { InMemoryAtomicProjectStore } from "../persistence";
import { divergenceNoticeCurrent, PcbBoardLifecycleOwner, settleServerCommit } from "../../pcb/lifecycle/board-lifecycle";
import type { CanonicalProjectState } from "../types";

function track(id: string, x: number): Track {
  return { id, layer: "copperTop", width: 200_000, start: { x, y: 0 }, end: { x: x + 1_000_000, y: 0 }, netId: 1 };
}

function boardFixture(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "NET1" });
  board.tracks = [track("ta", 0), track("tb", 2_000_000)];
  board.zones = [{ id: "za", layer: "copperTop", netId: 1, polygon: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }, { x: 0, y: 1_000_000 }], appearance: "solid", connection: "thermal", fill: [], dirty: true }];
  return board;
}

const projectOf = (board: PcbBoard): CanonicalProjectState =>
  ({ schemaVersion: "sirkit.engineering.v1", tenantId: "t", projectId: "b081", branchId: "main", pcb: structuredClone(board), pinnedAssets: [] });

const digestOf = (board: PcbBoard): string => semanticStateDigest(projectOf(board));

async function openBound(board = boardFixture(), options?: { durableStore?: InMemoryAtomicProjectStore; store?: InMemoryAtomicProjectStore }) {
  const bound = bindCanonicalEditorSession(createHistory(board), { tenantId: "t", projectId: "b081", branchId: "main" }, options);
  await bound.session.whenIdle();
  return bound;
}

function snapshot(history: { present: PcbBoard; entries: readonly unknown[] }) {
  return { board: history.present, digest: digestOf(history.present), entries: history.entries.length };
}

describe("B08.1 §1 — retired histories are permanently ineligible for legacy fallback", () => {
  it("T1: disposed session + commitPcbCandidate → structured refusal; EXACT zero mutation", async () => {
    const bound = await openBound();
    bound.session.dispose();
    expect(historyBindingState(bound.history)).toBe("retired");
    const before = snapshot(bound.history);
    const result = await commitPcbCandidate(bound.history, {
      commandId: "pcb.zone", label: "Late edit",
      buildCandidate: (b) => produce(b, (d) => { d.zones[0].priority = 9; }),
    });
    expect(result).toMatchObject({ ok: false, status: "rejected", reasonCode: "session_retired" });
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toContain("HISTORY_RETIRED");
    expect(bound.history.present).toBe(before.board);
    expect(digestOf(bound.history.present)).toBe(before.digest);
    expect(bound.history.entries.length).toBe(before.entries);
  });

  it("T2: disposed session + applyEditsCanonical → structured refusal; EXACT zero mutation", async () => {
    const bound = await openBound();
    bound.session.dispose();
    const before = snapshot(bound.history);
    const result = await applyEditsCanonical(bound.history, [{ op: "set-track-width", ids: ["ta"], widthNm: 400_000 }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("retired");
    expect(bound.history.present).toBe(before.board);
    expect(digestOf(bound.history.present)).toBe(before.digest);
    expect(bound.history.entries.length).toBe(before.entries);
  });

  it("T3: a retired history through the select/move legacy-capable funnel performs NO raw fallback and zero mutation", async () => {
    const bound = await openBound();
    const toasts: string[] = [];
    const store = { get: () => ({ refs: [{ kind: "track" as const, id: "ta" }] }), replace: () => undefined, add: () => undefined, toggle: () => undefined, remove: () => undefined, clear: () => undefined, subscribe: () => () => undefined };
    const scene = {
      onPointer: () => () => undefined, setHover: () => undefined, setSelectionRefs: () => undefined, setSelection: () => undefined,
      setInstanceTransform: () => undefined, setAirwires: () => undefined, getLayerContainer: () => ({ addChild: () => undefined }),
    } as never;
    const tool = createSelectMoveTool({ scene, history: bound.history, selection: store as never, toast: (m) => toasts.push(m) });
    bound.session.dispose(); // lifecycle replacement AFTER the tool captured the history
    const before = snapshot(bound.history);
    // Delete key path: canonicalSessionFor is null AND the history is
    // retired — the legacy applyEdits branch must refuse.
    const consumed = tool.handleKey({ key: "Delete", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, preventDefault: () => undefined } as unknown as KeyboardEvent);
    await Promise.resolve(); // flush any (refused) async funnel work
    expect(consumed).toBe(true);
    expect(bound.history.present).toBe(before.board);
    expect(digestOf(bound.history.present)).toBe(before.digest);
    expect(bound.history.entries.length).toBe(before.entries);
    expect(toasts.some((t) => t.includes("refused") || t.includes("replaced"))).toBe(true);
    tool.destroy();
  });

  it("T10: an EXPLICITLY authorized bare planner/test history still mutates; active/retired histories can never be authorized", async () => {
    const bare = createHistory(boardFixture());
    expect(historyBindingState(bare)).toBe("unbound");
    // Unauthorized bare history refuses first.
    const refused = await commitPcbCandidate(bare, { commandId: "pcb.zone", label: "Unauthorized", buildCandidate: (b) => produce(b, (d) => { d.zones[0].priority = 1; }) });
    // B08.2 taxonomy: never-bound-without-capability is NOT "retired".
    expect(refused).toMatchObject({ ok: false, reasonCode: "canonical_authority_missing" });
    expect(bare.entries.length).toBe(0);
    // Explicit authorization enables the legacy path (planner composition).
    expect(authorizeBarePcbHistory(bare)).toBe(true);
    const allowed = await commitPcbCandidate(bare, { commandId: "pcb.zone", label: "Planner edit", buildCandidate: (b) => produce(b, (d) => { d.zones[0].priority = 2; }) });
    expect(allowed.ok).toBe(true);
    expect(bare.present.zones[0].priority).toBe(2);
    // Active and retired histories can never be downgraded to bare authority.
    const bound = await openBound();
    expect(authorizeBarePcbHistory(bound.history)).toBe(false);
    bound.session.dispose();
    expect(authorizeBarePcbHistory(bound.history)).toBe(false);
  });
});

describe("B08.1 §2 — retirement is linearizable against in-flight commits", () => {
  it("T4: a commit paused IN FLIGHT (awaiting durable persistence), then retirement, then release → old history, replacement history, and durable envelope all unchanged", async () => {
    // Store whose commit blocks until released — the executor is mid-flight.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    class PausedStore extends InMemoryAtomicProjectStore {
      override async commit(input: Parameters<InMemoryAtomicProjectStore["commit"]>[0]): ReturnType<InMemoryAtomicProjectStore["commit"]> {
        await gate;
        return super.commit(input);
      }
    }
    const durableStore = new InMemoryAtomicProjectStore();
    const bound = await openBound(boardFixture(), { store: new PausedStore(), durableStore });
    const before = snapshot(bound.history);
    const envelopeBefore: ProjectPersistenceEnvelope | null = await durableStore.load("b081", "main");
    const pending = commitPcbCandidate(bound.history, {
      commandId: "pcb.zone", label: "In-flight edit",
      buildCandidate: (b) => produce(b, (d) => { d.zones[0].priority = 5; }),
    });
    await new Promise((r) => setTimeout(r, 10)); // the commit is now awaiting the paused store
    // Lifecycle replacement wins: retire the session, bind a replacement.
    bound.session.dispose();
    const replacement = await openBound(boardFixture());
    const replacementBefore = snapshot(replacement.history);
    release();
    const result = await pending;
    // The retired operation must NOT publish anywhere.
    expect(result).toMatchObject({ ok: false, status: "rejected", reasonCode: "session_retired" });
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toContain("SESSION_RETIRED_IN_FLIGHT");
    expect(bound.history.present).toBe(before.board);
    expect(digestOf(bound.history.present)).toBe(before.digest);
    expect(bound.history.entries.length).toBe(before.entries);
    expect(replacement.history.present).toBe(replacementBefore.board);
    expect(replacement.history.entries.length).toBe(replacementBefore.entries);
    const envelopeAfter = await durableStore.load("b081", "main");
    expect(envelopeAfter?.integrityManifest.envelopeDigest).toBe(envelopeBefore?.integrityManifest.envelopeDigest); // no durable mirror from the retired op
  });

  it("T9: a FRESH session after lifecycle adoption commits normally through the canonical executor", async () => {
    const old = await openBound();
    old.session.dispose();
    const fresh = await openBound(boardFixture());
    const result = await commitPcbCandidate(fresh.history, {
      commandId: "pcb.zone", label: "Post-adoption edit",
      buildCandidate: (b) => produce(b, (d) => { d.zones[0].priority = 7; }),
    });
    expect(result).toMatchObject({ ok: true, status: "executed" });
    expect(fresh.history.present.zones[0].priority).toBe(7);
    expect(fresh.history.entries.length).toBe(1);
    expect(fresh.session.events.filter((e) => e.kind === "executed")).toHaveLength(1);
  });
});

describe("B08.1 §3 — lifecycle-generation ownership for asynchronous producers", () => {
  it("T5-8 (mechanism): a generation advance stales captured scopes; older completions/finallys own nothing of the newer generation", () => {
    // [B08.2] the PCB lifecycle owner replaced the partial-identity
    // registry: full identity, and adoption ALWAYS advances the generation.
    const owner = new PcbBoardLifecycleOwner();
    const identity = { tenantId: "t", projectId: "p", branchId: "b", boardId: "board:p" };
    owner.adopt(identity);
    const syncScope = owner.capture();   // e.g. handleApplySync in flight
    const qualifyScope = owner.capture(); // e.g. handleQualify in flight
    expect(syncScope.isCurrent() && qualifyScope.isCurrent()).toBe(true);
    // Checkpoint restore (SAME identity — even the same board digest) →
    // adoptBoardLifecycle advances the generation BEFORE the replacement
    // board is exposed. Generation, never digest, is the authority.
    owner.adopt(identity);
    expect(syncScope.isCurrent()).toBe(false);
    expect(qualifyScope.isCurrent()).toBe(false);
    // The stale request's abort signal fired; a newer request's scope owns
    // the new generation and is untouched by the old completion.
    expect(syncScope.signal.aborted).toBe(true);
    const newer = owner.capture();
    expect(newer.signal.aborted).toBe(false);
    expect(newer.requestId).not.toBe(syncScope.requestId);
    let newerState = "loading";
    syncScope.ifCurrent(() => { newerState = "stale-clobbered"; });
    expect(newerState).toBe("loading");
    newer.ifCurrent(() => { newerState = "done"; });
    expect(newerState).toBe("done");
    // Project switch/unmount: dispose stales everything.
    owner.dispose();
    expect(newer.isCurrent()).toBe(false);
  });

  it("T5/T6 (behavioral, replaces the B08.1 source-string assertion): a stale VERIFIED server commit records ONLY a reconcile notice for the same board and is discarded entirely across an identity change", () => {
    const owner = new PcbBoardLifecycleOwner();
    const identity = { tenantId: "t", projectId: "p", branchId: "main", boardId: "board:p" };
    owner.adopt(identity);
    // Current scope → the caller adopts (normal success path).
    const live = owner.capture();
    expect(settleServerCommit({ scope: live, owner, description: "applied" })).toEqual({ kind: "adopt" });
    // Same-board checkpoint restore raced the apply: the server DID commit,
    // the local board was replaced — the settlement is a reconcile notice
    // (never an adoption, never a stale success), addressed to the ACTIVE
    // generation so it retires with the next adoption.
    const raced = owner.capture();
    owner.adopt(identity); // checkpoint restore — identical identity/digest
    const settled = settleServerCommit({ scope: raced, owner, description: "The durable PCB plan WAS applied on the server — reconcile." });
    if (settled.kind !== "reconcile-required") throw new Error(`expected reconcile-required, got ${settled.kind}`);
    expect(settled.notice.description).toContain("WAS applied on the server");
    expect(settled.notice.requestId).toBe(raced.requestId);
    expect(divergenceNoticeCurrent(settled.notice, owner)).toBe(true);
    // Any later lifecycle adoption retires the recorded notice.
    owner.adopt(identity);
    expect(divergenceNoticeCurrent(settled.notice, owner)).toBe(false);
    // Identity change (project/branch switch) while the commit was in
    // flight: the outcome is discarded ENTIRELY — no notice may leak into
    // the unrelated board's UI.
    const crossProject = owner.capture();
    owner.adopt({ tenantId: "t", projectId: "OTHER", branchId: "main", boardId: "board:OTHER" });
    expect(settleServerCommit({ scope: crossProject, owner, description: "applied" })).toEqual({ kind: "discard" });
    // Disposed owner (unmount): discard as well.
    const preDispose = owner.capture();
    owner.dispose();
    expect(settleServerCommit({ scope: preDispose, owner, description: "applied" })).toEqual({ kind: "discard" });
  });
});
