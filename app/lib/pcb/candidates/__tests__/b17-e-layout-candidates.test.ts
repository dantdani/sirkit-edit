/**
 * [B17-E] The shared layout-candidate artifact: one options builder for every
 * placement producer; revision-bound placement and routing candidates with a
 * content digest; a bounded store; apply as ONE canonical transaction (exact
 * base re-check, protected copper kept, undoable) that refuses stale,
 * expired, tampered or foreign-generation candidates with zero mutation;
 * explicit clear-nets; the selection → nets scope.
 */
import { describe, expect, it } from "vitest";
import { bindCanonicalEditorSession } from "@/app/lib/engineering/editor-adapter";
import { createHistory } from "@/app/lib/pcb/history";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import type { PcbBoard, Track } from "@/app/lib/pcb/types";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import {
  applyLayoutCandidate, clearNets, LayoutCandidateStore, layoutCandidateIntact, netsOfSelection, placementRunOptions, produceRoutingCandidate, runPlacementCandidate, verifyLayoutCandidate,
  type PlacementLayoutCandidate, type RoutingLayoutCandidate,
} from "../layout-candidate";

const MM = 1_000_000;
const T0 = "2026-09-10T12:00:00.000Z";
const track = (id: string, netId: number, x1: number, y1: number, x2: number, y2: number, extra: Partial<Track> = {}): Track => ({ id, layer: "copperTop", netId, start: { x: x1 * MM, y: y1 * MM }, end: { x: x2 * MM, y: y2 * MM }, width: 250_000, ...extra } as Track);

function board(): PcbBoard {
  const def = makeResistorDef();
  const b = makeBoard(40, 30, [
    makeInstance("r1", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }),
    makeInstance("r2", def, { x: 30, y: 22 }, { "1": 1, "2": 0 }),
    makeInstance("r3", def, { x: 8, y: 24 }, { "1": 2, "2": 0 }),
  ], 2);
  b.tracks = [
    track("t-auto-1", 1, 5, 5, 30, 22, { source: "autorouter" }),
    track("t-locked-1", 1, 5, 5, 5, 10, { source: "human", locked: true }),
    track("t-auto-2", 2, 5, 5, 8, 24, { source: "autorouter" }),
  ];
  return b;
}

async function bound(b: PcbBoard) {
  const session = bindCanonicalEditorSession(createHistory(b), { tenantId: "t", projectId: "b17e", branchId: "main" });
  await session.session.whenIdle();
  return session;
}

describe("B17-E — shared layout candidates", () => {
  it("one options builder decides the movement mode and scope for every producer", () => {
    const unrouted = { ...board(), tracks: [], vias: [] };
    expect(placementRunOptions(unrouted, { producer: "editor" })).toMatchObject({ projectId: "placement:editor", mode: "initial_unrouted" });
    expect(placementRunOptions(board(), { producer: "agent", candidateCount: 2 })).toMatchObject({ projectId: "placement:agent", mode: "preserve_routed", candidateCount: 2 });
    expect(placementRunOptions(board(), { producer: "route", instanceIds: ["r2", "r1", "r2"], projectId: "p" })).toMatchObject({ projectId: "p", mode: "selected_scope", selectedInstanceIds: ["r1", "r2"] });
  });

  it("produces a revision-bound, digest-sealed placement candidate; applying it is one canonical transaction, stale/expired/tampered/foreign candidates refuse with zero mutation", async () => {
    const b = board();
    const { candidate } = runPlacementCandidate({ board: b, request: { producer: "editor", candidateCount: 2, maxIterations: 40 }, generation: 3, clock: () => T0 });
    expect(candidate).not.toBeNull();
    const placement = candidate as PlacementLayoutCandidate;
    expect(placement).toMatchObject({ schema: "sirkit.layout-candidate.v1", kind: "placement", producer: "editor", scope: { instanceIds: "all" }, base: { revision: pcbRevisionId(b), generation: 3 }, createdAt: T0, expiresAt: "2026-09-10T12:30:00.000Z" });
    expect(placement.candidateId).toMatch(/^lc-[0-9a-f]{16}$/);
    expect(layoutCandidateIntact(placement)).toBe(true);
    expect(placement.candidate.sourceBoardRevision).toBe(pcbRevisionId(b));
    // Verification: generation, expiry, tampering.
    expect(verifyLayoutCandidate(placement, b, { generation: 3, clock: () => T0 })).toEqual({ ok: true });
    expect(verifyLayoutCandidate(placement, b, { generation: 4, clock: () => T0 })).toMatchObject({ ok: false, code: "STALE_GENERATION" });
    expect(verifyLayoutCandidate(placement, b, { clock: () => "2026-09-10T12:31:00.000Z" })).toMatchObject({ ok: false, code: "EXPIRED" });
    expect(verifyLayoutCandidate({ ...placement, producer: "agent" }, b, { clock: () => T0 })).toMatchObject({ ok: false, code: "UNKNOWN_CANDIDATE" });
    expect(verifyLayoutCandidate({ ...placement, legal: false, digest: "" } as PlacementLayoutCandidate, b, { clock: () => T0 })).toMatchObject({ ok: false, code: "UNKNOWN_CANDIDATE" });
    // Apply through the canonical session.
    if (placement.legal) {
      const editor = await bound(b);
      const before = pcbRevisionId(editor.history.present);
      const applied = await applyLayoutCandidate({ history: editor.history, candidate: placement, actorId: "user:test", generation: 3, clock: () => T0 });
      expect(applied).toMatchObject({ ok: true });
      await editor.session.whenIdle();
      expect(editor.history.entries.filter((entry) => entry.state === "applied")).toHaveLength(placement.candidate.moves.length > 0 ? 1 : 0);
      if (placement.candidate.moves.length > 0) {
        expect(pcbRevisionId(editor.history.present)).not.toBe(before);
        expect(editor.history.entries[0]!.metadata).toMatchObject({ operationType: "auto_place_footprints", actor: "human", details: { candidateId: placement.candidateId, producer: "editor" } });
        // The same candidate is now stale: refused, nothing changes.
        const again = await applyLayoutCandidate({ history: editor.history, candidate: placement, actorId: "user:test", clock: () => T0 });
        expect(again).toMatchObject({ ok: false, code: "STALE_REVISION" });
        expect(editor.history.entries.filter((entry) => entry.state === "applied")).toHaveLength(1);
        // Undo is the ordinary canonical undo.
        editor.history.undo();
        await editor.session.whenIdle();
        expect(pcbRevisionId(editor.history.present)).toBe(before);
      }
    }
  });

  it("routing candidates are scoped to the requested nets and pinned to the board revision; apply replaces only unlocked copper on those nets as one reroute transaction", async () => {
    const b = board();
    const response = {
      ok: true,
      sourceRevision: pcbRevisionId(b),
      routeAttemptId: "ra-1",
      routes: { tracks: [track("n1-a", 1, 5, 5, 20, 20, { source: "autorouter" }), track("n1-b", 1, 20, 20, 30, 22, { source: "autorouter" }), track("n2-x", 2, 5, 5, 8, 24, { source: "autorouter" })], vias: [] },
      job: { status: "partial" as const },
      completion: { acceptedPasses: 1, passes: [], failures: [] },
      stats: { elapsedMs: 120, tracksImported: 3, viasImported: 0 },
      engine: { name: "Freerouting", version: "2.1" },
    };
    expect(produceRoutingCandidate({ board: b, response: { ...response, sourceRevision: "eng1-other" }, producer: "editor" })).toMatchObject({ ok: false, code: "REVISION_MISMATCH" });
    expect(produceRoutingCandidate({ board: b, response: { ...response, routes: undefined }, producer: "editor" })).toMatchObject({ ok: false, code: "EMPTY" });
    expect(produceRoutingCandidate({ board: b, response, producer: "editor", netIds: [2, 2] })).toMatchObject({ kind: "routing", scope: { netIds: [2] }, stats: { tracks: 1 } });
    const scoped = produceRoutingCandidate({ board: b, response, producer: "agent", netIds: [1], clock: () => T0 }) as RoutingLayoutCandidate;
    expect(scoped).toMatchObject({ kind: "routing", producer: "agent", scope: { netIds: [1] }, routeAttemptId: "ra-1", candidateRevision: null, completion: { status: "partial", acceptedPasses: 1 }, stats: { tracks: 2, vias: 0, elapsedMs: 120, engine: "Freerouting 2.1" } });
    expect(scoped.routes.tracks.map((item) => item.id)).toEqual(["n1-a", "n1-b"]);
    expect(layoutCandidateIntact(scoped)).toBe(true);
    const whole = produceRoutingCandidate({ board: b, response: { ...response, candidateRevision: "eng1-candidate" }, producer: "editor" }) as RoutingLayoutCandidate;
    expect(whole).toMatchObject({ scope: { netIds: "all" }, candidateRevision: "eng1-candidate", stats: { tracks: 3 } });

    const editor = await bound(b);
    const applied = await applyLayoutCandidate({ history: editor.history, candidate: scoped, actorId: "user:test", clock: () => T0 });
    expect(applied).toMatchObject({ ok: true });
    await editor.session.whenIdle();
    const after = editor.history.present;
    expect(after.tracks.map((item) => item.id).sort()).toEqual(["n1-a", "n1-b", "t-auto-2", "t-locked-1"]); // net 1 unlocked copper replaced, locked kept, net 2 untouched
    expect(editor.history.entries[0]!.metadata).toMatchObject({ operationType: "reroute_nets", actor: "autorouter", details: { candidateId: scoped.candidateId, scope: { netIds: [1] } } });
    // A candidate whose provenance revision does not match the local projection refuses.
    const badProvenance = produceRoutingCandidate({ board: after, response: { ...response, sourceRevision: pcbRevisionId(after), candidateRevision: "eng1-notthis" }, producer: "editor", clock: () => T0 }) as RoutingLayoutCandidate;
    const refused = await applyLayoutCandidate({ history: editor.history, candidate: badProvenance, actorId: "user:test", clock: () => T0 });
    expect(refused).toMatchObject({ ok: false });
    expect(editor.history.entries.filter((entry) => entry.state === "applied")).toHaveLength(1);
  });

  it("clear-nets rips up unlocked copper on the selected nets as one transaction and keeps locked copper; the selection names the nets", async () => {
    const b = board();
    expect(netsOfSelection(b, [{ kind: "track", id: "t-auto-2" }, { kind: "pad", footprintId: "r1", padNumber: "1" }, { kind: "footprint", id: "r3" }, { kind: "via", id: "nope" }])).toEqual([1, 2]);
    expect(netsOfSelection(b, [{ kind: "pad", footprintId: "r2", padNumber: "2" }])).toEqual([]);
    const editor = await bound(b);
    expect(await clearNets({ history: editor.history, netIds: [], actorId: "user:test" })).toMatchObject({ ok: false, code: "EMPTY" });
    expect(await clearNets({ history: editor.history, netIds: [9], actorId: "user:test" })).toMatchObject({ ok: false, code: "EMPTY" });
    const cleared = await clearNets({ history: editor.history, netIds: [1], actorId: "user:test" });
    expect(cleared).toMatchObject({ ok: true });
    await editor.session.whenIdle();
    expect(editor.history.present.tracks.map((item) => item.id).sort()).toEqual(["t-auto-2", "t-locked-1"]);
    expect(editor.history.entries[0]!.metadata).toMatchObject({ operationType: "clear_nets", details: { netIds: [1] } });
    editor.history.undo();
    await editor.session.whenIdle();
    expect(editor.history.present.tracks).toHaveLength(3);
  });

  it("the store is bounded, observable, and retires candidates whose base moved on", () => {
    const b = board();
    const store = new LayoutCandidateStore(2);
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    const make = (seed: number) => runPlacementCandidate({ board: b, request: { producer: "agent", seeds: [seed], candidateCount: 2, maxIterations: 20 }, clock: () => T0 }).candidate!;
    const first = store.register(make(1));
    const second = store.register(make(2));
    expect(store.list("placement").map((item) => item.candidateId)).toEqual([...new Set([first.candidateId, second.candidateId])]);
    if (first.candidateId !== second.candidateId) {
      store.register(make(3));
      expect(store.list()).toHaveLength(2); // bounded: the oldest dropped
    }
    expect(() => store.register({ ...first, producer: "route" })).toThrow(/digest/);
    expect(notified).toBeGreaterThan(0);
    const live = store.list().length;
    expect(store.retireStale({ ...b, tracks: [] })).toBe(live);
    expect(store.list()).toHaveLength(0);
    expect(store.retire("missing", "discarded")).toBe(false);
  });
});
