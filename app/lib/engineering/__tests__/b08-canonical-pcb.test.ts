/**
 * B08 — canonical PCB mutation parity and exact replay.
 *
 *  §1  Exact-inverse operations: order-exact middle-element restore for
 *      every ordered collection, absent-field restoration, optional-
 *      collection absence restoration, protection without self-blocking.
 *  §2  Structural/referential validation: annular ring, dangling padstack
 *      references, whole-board integrity — all atomic.
 *  §3  Session-level parity: one gesture/candidate = ONE canonical
 *      transaction; stale candidates refuse with zero mutation; mixed
 *      batches fail closed or compile under a declared command.
 *  §4  Dimensions end-to-end: ops, digest participation, exact undo,
 *      revision participation, truthful KiCad export diagnostic.
 *  §5  Ownership: a disposed (lifecycle-replaced) session refuses late
 *      commits structurally; queue serialization holds.
 *  §6  Persistence: failed persistence rolls back atomically; durable
 *      undo/redo replay is digest-exact.
 *  §7  Tool boundary: mutation execution stays closed to non-UI callers;
 *      release-tier remains categorically refused.
 */

import { describe, expect, it } from "vitest";
import { produce } from "immer";
import type { PcbBoard, Track } from "../../pcb/types";
import { createEmptyBoard } from "../../pcb/types";
import { createHistory } from "../../pcb/history";
import { mutateBoardWithCommand, type RouteCommand } from "../../pcb/route-tool.commands";
import { kicadExportUnsupportedDiagnostics } from "../../pcb/kicad/write-pcb";
import { pcbRevisionId } from "../../pcb/revision";
import { applyEngineeringOperations } from "../operations";
import { computeProjectRevision, semanticStateDigest } from "../revision";
import { compilePcbBoardDelta, PcbDeltaUnsupportedError } from "../pcb-delta";
import { commitPcbCandidate } from "../pcb-commit-gateway";
import { applyEditsCanonical, bindCanonicalEditorSession, type BoundCanonicalEditor } from "../editor-adapter";
import { CanonicalExecutor } from "../executor";
import { EngineeringTransactionService } from "../transaction-service";
import { InMemoryAtomicProjectStore } from "../persistence";
import type { CanonicalProjectState, EngineeringOperation } from "../types";

const NM = { schemaVersion: 1 as const, units: "nm" as const };
let opSeq = 0;
const op = (partial: Record<string, unknown>): EngineeringOperation =>
  ({ ...NM, operationId: `op:t:${opSeq++}`, ...partial }) as unknown as EngineeringOperation;

function track(id: string, x: number, locked?: boolean): Track {
  return { id, layer: "copperTop", width: 200_000, start: { x, y: 0 }, end: { x: x + 1_000_000, y: 0 }, netId: 1, ...(locked ? { locked } : {}) };
}

function boardFixture(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "NET1" }, { id: 2, name: "NET2" });
  board.tracks = [track("ta", 0), track("tb", 2_000_000), track("tc", 4_000_000)];
  board.vias = [
    { id: "va", at: { x: 0, y: 0 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] },
    { id: "vb", at: { x: 1_000_000, y: 0 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] },
    { id: "vc", at: { x: 2_000_000, y: 0 }, size: 600_000, drill: 300_000, netId: 2, layers: ["copperTop", "copperBottom"] },
  ];
  board.zones = [
    { id: "za", layer: "copperTop", netId: 1, polygon: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }, { x: 0, y: 1_000_000 }], appearance: "solid", connection: "thermal", fill: [], dirty: true },
    { id: "zb", layer: "copperTop", netId: 2, polygon: [{ x: 0, y: 0 }, { x: 2_000_000, y: 0 }, { x: 0, y: 2_000_000 }], appearance: "solid", connection: "thermal", fill: [], dirty: true },
    { id: "zc", layer: "copperBottom", netId: 1, polygon: [{ x: 0, y: 0 }, { x: 3_000_000, y: 0 }, { x: 0, y: 3_000_000 }], appearance: "solid", connection: "thermal", fill: [], dirty: true },
  ];
  board.texts = [
    { id: "xa", text: "A", at: { x: 0, y: 0 }, rotationDeg: 0, layer: "silkTop", sizeX: 1_000_000, sizeY: 1_000_000, thickness: 150_000 },
    { id: "xb", text: "B", at: { x: 1_000_000, y: 0 }, rotationDeg: 0, layer: "silkTop", sizeX: 1_000_000, sizeY: 1_000_000, thickness: 150_000 },
    { id: "xc", text: "C", at: { x: 2_000_000, y: 0 }, rotationDeg: 0, layer: "silkTop", sizeX: 1_000_000, sizeY: 1_000_000, thickness: 150_000 },
  ];
  delete (board as { silkItems?: unknown }).silkItems; // exercise optional-collection absence
  board.dimensions = [
    { id: "da", kind: "horizontal", a: { x: 0, y: 0 }, b: { x: 10_000_000, y: 0 }, offsetNm: 2_000_000, layer: "silkTop", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 },
    { id: "db", kind: "vertical", a: { x: 0, y: 0 }, b: { x: 0, y: 8_000_000 }, offsetNm: 2_000_000, layer: "fabTop", unit: "mm", precision: 1, textHeightNm: 1_000_000, strokeWidthNm: 150_000 },
    { id: "dc", kind: "aligned", a: { x: 0, y: 0 }, b: { x: 5_000_000, y: 5_000_000 }, offsetNm: -1_000_000, layer: "silkTop", unit: "in", precision: 3, textHeightNm: 1_000_000, strokeWidthNm: 150_000 },
  ];
  return board;
}

function projectFixture(board = boardFixture()): CanonicalProjectState {
  return { schemaVersion: "sirkit.engineering.v1", tenantId: "t", projectId: "b08", branchId: "main", pcb: board, pinnedAssets: [] };
}

/** Apply ops, then apply the recorded inverses; both digests must be exact. */
function roundTrip(project: CanonicalProjectState, operations: EngineeringOperation[]): { after: CanonicalProjectState; restored: CanonicalProjectState } {
  const baseDigest = semanticStateDigest(project);
  const applied = applyEngineeringOperations(project, operations);
  const inverted = applyEngineeringOperations(applied.project, applied.inverseOperations);
  expect(semanticStateDigest(inverted.project), "inverse replay must restore the EXACT semantic state").toBe(baseDigest);
  // Forward replay from the restored state reproduces the result digest.
  const forward = applyEngineeringOperations(inverted.project, operations.map((operation, index) => ({ ...structuredClone(operation), operationId: `fwd:${index}:${operation.operationId}` })));
  expect(semanticStateDigest(forward.project), "forward replay must reproduce the result digest").toBe(semanticStateDigest(applied.project));
  return { after: applied.project, restored: inverted.project };
}

// ─── §1 Exact inverses ───────────────────────────────────────────────────────

describe("B08 §1 — exact-inverse PCB operations", () => {
  it("T1: deleting the MIDDLE element of every ordered collection restores exact array order and digest on undo", () => {
    const project = projectFixture();
    const removals: Array<[string, EngineeringOperation]> = [
      ["track", op({ kind: "remove_track", trackId: "tb" })],
      ["via", op({ kind: "remove_via", viaId: "vb" })],
      ["zone", op({ kind: "remove_zone", zoneId: "zb" })],
      ["text", op({ kind: "remove_text", textId: "xb" })],
      ["dimension", op({ kind: "remove_dimension", dimensionId: "db" })],
    ];
    for (const [label, removal] of removals) {
      const { after, restored } = roundTrip(project, [removal]);
      void after;
      const ids = (collection: Array<{ id: string }> | undefined): string[] => (collection ?? []).map((item) => item.id);
      switch (label) {
        case "track": expect(ids(restored.pcb.tracks)).toEqual(["ta", "tb", "tc"]); break;
        case "via": expect(ids(restored.pcb.vias)).toEqual(["va", "vb", "vc"]); break;
        case "zone": expect(ids(restored.pcb.zones)).toEqual(["za", "zb", "zc"]); break;
        case "text": expect(ids(restored.pcb.texts)).toEqual(["xa", "xb", "xc"]); break;
        case "dimension": expect(ids(restored.pcb.dimensions)).toEqual(["da", "db", "dc"]); break;
      }
    }
  });

  it("T2: add-then-undo is digest-exact for every entity type — including restoring optional-collection ABSENCE", () => {
    const project = projectFixture();
    expect(project.pcb.silkItems).toBeUndefined();
    const adds: EngineeringOperation[][] = [
      [op({ kind: "add_track", track: track("tn", 8_000_000), atIndex: 1 })],
      [op({ kind: "add_via", via: { id: "vn", at: { x: 9_000_000, y: 0 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] } })],
      [op({ kind: "add_zone", zone: { id: "zn", layer: "copperTop", netId: 1, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }].map((p) => ({ x: p.x * 1_000_000, y: p.y * 1_000_000 })), appearance: "solid", connection: "thermal", fill: [], dirty: true } })],
      [op({ kind: "add_text", text: { id: "xn", text: "N", at: { x: 0, y: 0 }, rotationDeg: 0, layer: "silkTop", sizeX: 1_000_000, sizeY: 1_000_000, thickness: 150_000 } })],
      // silkItems is ABSENT on the fixture — undo of the first silk add must
      // delete the collection again (digest-exact, not merely empty).
      [op({ kind: "add_silk", item: { kind: "line", id: "sn", layer: "silkTop", from: { x: 0, y: 0 }, to: { x: 1_000_000, y: 0 }, strokeWidthNm: 150_000 } })],
      [op({ kind: "add_dimension", dimension: { id: "dn", kind: "horizontal", a: { x: 0, y: 0 }, b: { x: 4_000_000, y: 0 }, offsetNm: 1_000_000, layer: "silkTop", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 } })],
      [op({ kind: "add_keepout", keepout: { id: "kn", polygon: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }, { x: 0, y: 1_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: false } })],
      [op({ kind: "add_padstack", padstack: { id: "pn", name: "Via 0.6/0.3", kind: "via", outerNm: 600_000, drillNm: 300_000, tented: true, zoneConnect: "solid" } })],
    ];
    for (const operations of adds) {
      const { restored } = roundTrip(project, operations);
      expect(restored.pcb.silkItems, "optional-collection absence must round-trip").toBeUndefined();
    }
    // Indexed add lands at the exact index.
    const applied = applyEngineeringOperations(project, [op({ kind: "add_track", track: track("tn", 8_000_000), atIndex: 1 })]);
    expect(applied.project.pcb.tracks.map((t) => t.id)).toEqual(["ta", "tn", "tb", "tc"]);
  });

  it("T3: a patch that ADDS an optional field undoes to field ABSENCE (padstackId), digest-exact", () => {
    const board = boardFixture();
    board.padstacks = [{ id: "ps1", name: "Via 0.8/0.4", kind: "via", outerNm: 800_000, drillNm: 400_000, tented: true, zoneConnect: "solid" }];
    const project = projectFixture(board);
    const { after, restored } = roundTrip(project, [op({ kind: "update_via", viaId: "vb", patch: { padstackId: "ps1" } })]);
    expect(after.pcb.vias.find((v) => v.id === "vb")!.padstackId).toBe("ps1");
    expect("padstackId" in restored.pcb.vias.find((v) => v.id === "vb")!).toBe(false);
  });

  it("T4: lock → mutate-refused → unlock inverse never self-blocks, and generic updates cannot flip protection", () => {
    const project = projectFixture();
    // Lock the track canonically.
    const locked = applyEngineeringOperations(project, [op({ kind: "set_copper_protection", target: "track", id: "tb", locked: true })]);
    expect(locked.project.pcb.tracks.find((t) => t.id === "tb")!.locked).toBe(true);
    // A generic update on the locked object is refused.
    expect(() => applyEngineeringOperations(locked.project, [op({ kind: "update_track", trackId: "tb", patch: { width: 300_000 } })])).toThrow(/PROTECTED_OBJECT/);
    // The protection INVERSE (unlock) replays without being blocked.
    const unlocked = applyEngineeringOperations(locked.project, locked.inverseOperations);
    expect(semanticStateDigest(unlocked.project)).toBe(semanticStateDigest(project));
    expect("locked" in unlocked.project.pcb.tracks.find((t) => t.id === "tb")!).toBe(false); // absence-exact
    // A replace snapshot that tries to flip locked (on an UNLOCKED object —
    // locked objects refuse ALL generic updates) is structurally refused.
    const unlockedTrack = locked.project.pcb.tracks.find((t) => t.id === "ta")!;
    expect(() => applyEngineeringOperations(locked.project, [op({ kind: "update_track", trackId: "ta", replace: { ...structuredClone(unlockedTrack), locked: true } })])).toThrow(/PROTECTION_VIA_UPDATE/);
    // Footprint protection round-trips too (kernel mints absence-exact inverse).
    const fpBoard = boardFixture();
    fpBoard.footprints.push({ id: "fp1", ref: "R1", footprintId: "lib:R", def: { libName: "lib", name: "R", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "()" }, at: { x: 0, y: 0 }, rotationDeg: 0, side: "top", padNets: {} });
    const fpProject = projectFixture(fpBoard);
    roundTrip(fpProject, [op({ kind: "set_footprint_protection", footprintId: "fp1", locked: true })]);
  });
});

// ─── §2 Validation ───────────────────────────────────────────────────────────

describe("B08 §2 — structural and referential validation is atomic", () => {
  it("T5: via diameter/drill (annular ring) and padstack references validate; whole-board integrity gates the batch", () => {
    const project = projectFixture();
    expect(() => applyEngineeringOperations(project, [op({ kind: "update_via", viaId: "vb", patch: { drill: 700_000 } })])).toThrow(/INVALID_VIA/);
    expect(() => applyEngineeringOperations(project, [op({ kind: "update_via", viaId: "vb", patch: { padstackId: "missing" } })])).toThrow(/UNKNOWN_PADSTACK/);
    expect(() => applyEngineeringOperations(project, [op({ kind: "add_track", track: { ...track("dup", 0), id: "va" } })])).toThrow(/BOARD_INTEGRITY.*duplicate object id/);
    expect(() => applyEngineeringOperations(project, [op({ kind: "add_dimension", dimension: { id: "bad", kind: "horizontal", a: { x: 5, y: 0 }, b: { x: 5, y: 9 }, offsetNm: 1, layer: "silkTop", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 } })])).toThrow(/INVALID_DIMENSION/);
  });

  it("T6: padstack deletion with live via references fails atomically — nothing mutates", () => {
    const board = boardFixture();
    board.padstacks = [{ id: "ps1", name: "Via 0.8/0.4", kind: "via", outerNm: 800_000, drillNm: 400_000, tented: true, zoneConnect: "solid" }];
    board.vias[0] = { ...board.vias[0], padstackId: "ps1" };
    const project = projectFixture(board);
    const digest = semanticStateDigest(project);
    expect(() => applyEngineeringOperations(project, [
      op({ kind: "update_track", trackId: "ta", patch: { width: 250_000 } }),
      op({ kind: "remove_padstack", padstackId: "ps1" }),
    ])).toThrow(/PADSTACK_IN_USE:ps1/);
    expect(semanticStateDigest(project)).toBe(digest); // source untouched (clone semantics)
  });
});

// ─── §3 Session-level parity ─────────────────────────────────────────────────

async function openBound(board = boardFixture()): Promise<BoundCanonicalEditor> {
  const bound = bindCanonicalEditorSession(createHistory(board), { tenantId: "t", projectId: "b08", branchId: "main" });
  await bound.session.whenIdle();
  return bound;
}

describe("B08 §3 — one action = one canonical transaction; stale candidates refuse", () => {
  it("T7: one route gesture (segment + via + routing history) commits ONE transaction with ONE history entry; undo is digest-exact", async () => {
    const bound = await openBound();
    const cmd: RouteCommand = {
      kind: "PlaceViaAndFlipLayer",
      via: { id: "route-v1", at: { x: 5_000_000, y: 5_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] },
      segments: [track("route-t1", 6_000_000)],
      historyEvents: [{ schemaVersion: 1, id: "evt1", tool: "smart-route", baseWorldRevision: "r", netId: 1, layer: "copperTop", candidateId: "c1", mode: "direct", points: [], segmentIds: ["route-t1"], rules: { trackWidthNm: 200_000, clearanceNm: 150_000, edgeClearanceNm: 150_000, gridNm: 500_000 }, score: 1, explanation: "test" }],
    };
    const baseDigest = semanticStateDigest(projectFixture(structuredClone(bound.history.present)));
    const result = await commitPcbCandidate(bound.history, {
      commandId: "pcb.route-copper",
      label: "Route NET1",
      buildCandidate: (board) => produce(board, (draft) => mutateBoardWithCommand(draft, cmd)),
    });
    expect(result).toMatchObject({ ok: true, status: "executed" });
    expect(bound.history.entries).toHaveLength(1);
    expect(bound.history.present.tracks.some((t) => t.id === "route-t1")).toBe(true);
    expect(bound.history.present.vias.some((v) => v.id === "route-v1")).toBe(true);
    expect(bound.history.present.routingHistory?.map((e) => e.id)).toEqual(["evt1"]);
    expect(bound.session.events.filter((e) => e.kind === "executed")).toHaveLength(1);
    // Exact undo through the wrapped history (canonical verified replay).
    bound.history.undo();
    await bound.session.whenIdle();
    expect(semanticStateDigest(projectFixture(structuredClone(bound.history.present)))).toBe(baseDigest);
    expect(bound.session.events.filter((e) => e.kind === "undo-reconciled")).toHaveLength(1);
    expect(bound.session.events.filter((e) => e.kind === "reconcile-rebased")).toHaveLength(0);
  });

  it("T8: a candidate pinned to a stale base refuses with ZERO board/history mutation", async () => {
    const bound = await openBound();
    const pinnedRevision = pcbRevisionId(bound.history.present);
    // Move the base first (canonical width edit).
    const edit = await applyEditsCanonical(bound.history, [{ op: "set-track-width", ids: ["ta"], widthNm: 350_000 }]);
    expect(edit.ok).toBe(true);
    const before = bound.history.present;
    const result = await commitPcbCandidate(bound.history, {
      commandId: "pcb.autoroute-import",
      label: "Autoroute board",
      buildCandidate: (board) => {
        if (pcbRevisionId(board) !== pinnedRevision) throw new Error("Board changed while autorouting; the stale route candidate was discarded.");
        return produce(board, (draft) => { draft.tracks.push(track("stale-t", 9_000_000)); });
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain("stale route candidate");
    expect(bound.history.present).toBe(before); // literally untouched
    expect(bound.history.entries).toHaveLength(1); // only the width edit
  });

  it("T9: locked copper survives an autoroute-style net replacement (domain mutator filters; delta never touches it)", async () => {
    const board = boardFixture();
    board.tracks[1] = { ...board.tracks[1], locked: true };
    const bound = await openBound(board);
    const cmd: RouteCommand = { kind: "AutorouteImport", tracks: [track("ar-t1", 7_000_000)], vias: [], replacedNetIds: [1], removed: { tracks: [], vias: [] } };
    const result = await commitPcbCandidate(bound.history, {
      commandId: "pcb.autoroute-import",
      label: "Autoroute board",
      buildCandidate: (current) => produce(current, (draft) => mutateBoardWithCommand(draft, cmd)),
    });
    expect(result.ok).toBe(true);
    expect(bound.history.present.tracks.find((t) => t.id === "tb")?.locked).toBe(true); // locked survived
    expect(bound.history.present.tracks.some((t) => t.id === "ta")).toBe(false); // unlocked net-1 copper replaced
    expect(bound.history.present.tracks.some((t) => t.id === "ar-t1")).toBe(true);
  });

  it("T10/T11/T12: zone, silk, rules, stackup-style settings, and keepout edits are canonical transactions with exact undo", async () => {
    const bound = await openBound();
    const commits: Array<{ label: string; build: (board: PcbBoard) => PcbBoard; commandId: string }> = [
      { commandId: "pcb.zone", label: "Edit zone", build: (b) => produce(b, (d) => { d.zones[0].priority = 7; }) },
      { commandId: "pcb.silkscreen-text", label: "Add silk", build: (b) => produce(b, (d) => { (d.silkItems ??= []).push({ kind: "line", id: "s-line", layer: "silkTop", from: { x: 0, y: 0 }, to: { x: 1_000_000, y: 0 }, strokeWidthNm: 150_000 }); }) },
      { commandId: "pcb.rules", label: "Edit routing rules", build: (b) => produce(b, (d) => { d.routingPreferences = { version: 1, trackWidthMode: "custom", customTrackWidthNm: 250_000, viaMode: "net-class" }; }) },
      { commandId: "pcb.board-geometry", label: "Set stackup", build: (b) => produce(b, (d) => { d.stackup = 4; }) },
      { commandId: "pcb.board-geometry", label: "Add keepout", build: (b) => produce(b, (d) => { (d.routingKeepouts ??= []).push({ id: "keep-1", polygon: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }, { x: 0, y: 1_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }); }) },
      { commandId: "pcb.placement-settings", label: "Set auto-placement spacing", build: (b) => produce(b, (d) => { d.placementPreferences = { spacingPreset: "spacious", envelopeScale: 1.4 }; }) },
    ];
    for (const { commandId, label, build } of commits) {
      const digestBefore = semanticStateDigest(projectFixture(structuredClone(bound.history.present)));
      const result = await commitPcbCandidate(bound.history, { commandId, label, buildCandidate: build });
      if (!result.ok) throw new Error(`DEBUG ${label}: ${JSON.stringify(result)}`);
      expect(result, `${label} must commit canonically`).toMatchObject({ ok: true });
      bound.history.undo();
      await bound.session.whenIdle();
      expect(semanticStateDigest(projectFixture(structuredClone(bound.history.present))), `${label} undo must be digest-exact`).toBe(digestBefore);
      expect(bound.session.events.filter((e) => e.kind === "reconcile-rebased"), `${label} undo must use verified replay, not rebase`).toHaveLength(0);
      bound.history.redo();
      await bound.session.whenIdle();
    }
    // Every commit above created exactly one canonical transaction each.
    expect(bound.session.events.filter((e) => e.kind === "rebased")).toHaveLength(0);
  });

  it("T13: an unsupported delta (footprint added by a candidate) fails CLOSED before mutation", async () => {
    const bound = await openBound();
    const before = bound.history.present;
    const result = await commitPcbCandidate(bound.history, {
      commandId: "pcb.board-repair",
      label: "Broken candidate",
      buildCandidate: (board) => produce(board, (draft) => {
        draft.footprints.push({ id: "ghost", ref: "G1", footprintId: "x", def: { libName: "l", name: "n", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "()" }, at: { x: 0, y: 0 }, rotationDeg: 0, side: "top", padNets: {} });
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics[0]).toContain("PCB_DELTA_UNSUPPORTED");
    expect(bound.history.present).toBe(before);
    // Direct compiler contract too:
    const base = boardFixture();
    expect(() => compilePcbBoardDelta(base, produce(base, (d) => { d.nets.push({ id: 9, name: "X" }); }))).toThrow(PcbDeltaUnsupportedError);
  });
});

// ─── §4 Dimensions end-to-end ────────────────────────────────────────────────

describe("B08 §4 — dimensions are first-class semantic board state", () => {
  it("T14: create/update/delete round-trips digest-exactly; revision participates; export diagnoses truthfully", () => {
    const project = projectFixture();
    // update via exact replace
    const target = project.pcb.dimensions![1];
    roundTrip(project, [op({ kind: "update_dimension", dimensionId: "db", replace: { ...structuredClone(target), precision: 3, unit: "in" } })]);
    // revision + digest participation
    const withoutDimensions = boardFixture();
    delete withoutDimensions.dimensions;
    expect(pcbRevisionId(boardFixture())).not.toBe(pcbRevisionId(withoutDimensions));
    expect(computeProjectRevision(projectFixture()).domainRevisions.boardGeometry).not.toBe(computeProjectRevision(projectFixture(withoutDimensions)).domainRevisions.boardGeometry);
    // truthful export diagnostic
    expect(kicadExportUnsupportedDiagnostics(boardFixture())[0]).toContain("dimension annotation(s) are NOT included");
    expect(kicadExportUnsupportedDiagnostics(withoutDimensions)).toEqual([]);
  });
});

// ─── §5 Ownership ────────────────────────────────────────────────────────────

describe("B08 §5 — lifecycle replacement stales late commits", () => {
  it("T15: a commit racing a disposed (replaced) session is REFUSED with EXACT zero mutation (board, history, revision)", async () => {
    const bound = await openBound();
    const before = bound.history.present;
    const beforeDigest = semanticStateDigest(projectFixture(structuredClone(before)));
    const entriesBefore = bound.history.entries.length;
    bound.session.dispose(); // lifecycle replacement retired the old session
    const result = await commitPcbCandidate(bound.history, {
      commandId: "pcb.zone",
      label: "Late zone edit",
      buildCandidate: (board) => produce(board, (draft) => { draft.zones[0].priority = 3; }),
    });
    // B08.1 — a RETIRED history is permanently ineligible for any fallback:
    // structured refusal, and the detached history is byte-for-byte intact.
    expect(result).toMatchObject({ ok: false, status: "rejected", reasonCode: "session_retired" });
    expect(bound.history.present).toBe(before); // reference-identical
    expect(semanticStateDigest(projectFixture(structuredClone(bound.history.present)))).toBe(beforeDigest);
    expect(bound.history.entries.length).toBe(entriesBefore);
  });

  it("T16: queued commits serialize FIFO against successive heads (no lost updates)", async () => {
    const bound = await openBound();
    const first = commitPcbCandidate(bound.history, { commandId: "pcb.zone", label: "A", buildCandidate: (b) => produce(b, (d) => { d.zones[0].priority = 1; }) });
    const second = commitPcbCandidate(bound.history, { commandId: "pcb.zone", label: "B", buildCandidate: (b) => produce(b, (d) => { d.zones[1].priority = 2; }) });
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.ok && r2.ok).toBe(true);
    expect(bound.history.present.zones[0].priority).toBe(1);
    expect(bound.history.present.zones[1].priority).toBe(2);
    expect(bound.history.entries).toHaveLength(2);
  });
});

// ─── §6 Persistence ──────────────────────────────────────────────────────────

describe("B08 §6 — persistence atomicity and durable replay", () => {
  it("T17: a failing persistence store rolls the transaction back — board and history unchanged", async () => {
    class FailingStore extends InMemoryAtomicProjectStore {
      override commit(): Promise<never> { return Promise.reject(new Error("disk full")); }
    }
    const bound = bindCanonicalEditorSession(createHistory(boardFixture()), { tenantId: "t", projectId: "b08", branchId: "main" }, { store: new FailingStore() });
    await bound.session.whenIdle();
    const before = bound.history.present;
    const result = await commitPcbCandidate(bound.history, { commandId: "pcb.zone", label: "Edit zone", buildCandidate: (b) => produce(b, (d) => { d.zones[0].priority = 9; }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reasonCode).toBe("persistence_failed");
    expect(bound.history.present).toBe(before);
    expect(bound.history.entries).toHaveLength(0);
  });

  it("T18: duplicate idempotent submission does not double-apply", async () => {
    const bound = await openBound();
    const build = (b: PcbBoard): PcbBoard => produce(b, (d) => { d.zones[0].priority = 4; });
    const first = await commitPcbCandidate(bound.history, { commandId: "pcb.zone", label: "Edit zone", idempotencyKey: "same-key", buildCandidate: build });
    expect(first.ok && first.status === "executed").toBe(true);
    // Identical duplicate: the delta against the NEW head is empty → noop —
    // and a forced same-key replay never creates a second entry.
    const duplicate = await commitPcbCandidate(bound.history, { commandId: "pcb.zone", label: "Edit zone", idempotencyKey: "same-key", buildCandidate: build });
    expect(duplicate.ok).toBe(true);
    expect(bound.history.entries).toHaveLength(1);
  });
});

// ─── §7 Tool boundary ────────────────────────────────────────────────────────

describe("B08 §7 — mutation execution stays closed to non-UI callers", () => {
  async function bareExecutor(): Promise<CanonicalExecutor> {
    const service = await EngineeringTransactionService.open(projectFixture(), { buildId: "b08-test", store: new InMemoryAtomicProjectStore() });
    return new CanonicalExecutor(service); // NO interactive channel
  }

  it("T19: destructive PCB commands from an api/ai caller without an independent approval are refused; release-tier stays categorically blocked", async () => {
    const executor = await bareExecutor();
    const refused = await executor.execute({
      commandId: "pcb.route-copper",
      actor: { actorId: "agent", actorKind: "ai", sessionId: "s", role: "automation" },
      expectedRevision: executor.currentRevision(),
      idempotencyKey: "k1",
      reason: "attempt",
      operations: [op({ kind: "remove_track", trackId: "tb" })],
      provenance: { source: "ai" },
    });
    expect(refused.status).toBe("rejected");
    if (refused.status !== "rejected") throw new Error("unreachable");
    expect(refused.reasonCode).toBe("approval_required");
    const release = await executor.execute({
      commandId: "manufacturing.release",
      actor: { actorId: "human", actorKind: "human", sessionId: "s", role: "project_admin" },
      expectedRevision: executor.currentRevision(),
      idempotencyKey: "k2",
      reason: "attempt",
      operations: [],
      provenance: { source: "ui" },
    });
    expect(release.status).toBe("rejected");
    if (release.status !== "rejected") throw new Error("unreachable");
    expect(release.reasonCode).toBe("release_tier_blocked");
  });

  it("T20: AI actors are categorically refused protection/stackup mutations regardless of channel", async () => {
    const executor = await bareExecutor();
    const result = await executor.execute({
      commandId: "pcb.protection",
      actor: { actorId: "agent", actorKind: "ai", sessionId: "s", role: "project_admin" },
      expectedRevision: executor.currentRevision(),
      idempotencyKey: "k3",
      reason: "attempt",
      operations: [op({ kind: "set_copper_protection", target: "track", id: "tb", locked: true })],
      provenance: { source: "ai" },
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reasonCode).toBe("unauthorized");
  });
});
