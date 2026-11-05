/**
 * [PR-J3, 2026-10-22] Runbook J.3 / J.8.1 / J.9 (OD-255 item 7): the undo / redo target carries the SHEET TREE from the snapshot (PR-L6
 * class - a target that dropped it would make every undo on a multi-sheet project a lineage rebase onto a flattened document).
 *
 *  1. pure: `historyStepState` carries `sheets` from the SNAPSHOT and the sheet size from `current`; an absent tree stays absent (the
 *     single-sheet target is digest-identical to the pre-J3 one); a tree on `current` is never read;
 *  2. a REAL session + coordinator + SchematicHistory of the page's snapshots (app/page.tsx's composition): creating the first sheet is
 *     one canonical transaction, Undo restores the document WITHOUT `sheets` (digest-identical to the opened flat drone) and is REPLAYED
 *     on the same lineage (`undo-reconciled`, never a rebase), Redo replays the creation (`redo-reconciled`);
 *  3. the multi-sheet fixture's step target is the document itself (same digest), so a step on an organised project replays too;
 *  4. [PR-J3 integration, 2026-10-23] J3N-4: the two-transaction delete of a populated sheet (Move contents to parent, then Delete
 *     sheet) undoes twice and redoes twice by REPLAY, digest-identical at every step with the hierarchy valid.
 * No network, no database (an in-memory atomic store).
 */
import { describe, expect, it } from "vitest";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { fromCanonicalSchematic, schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { historyStepState, type HistoryStepSnapshot } from "@/app/lib/project/history-step-state";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { deleteSheetOperations, movableContents } from "@/app/lib/schematic/sheet-lens";
import { createSheetOperation, planMoveToSheet, type MoveToSheetInput } from "@/app/lib/schematic/sheet-operations";
import { validateSheetHierarchy } from "@/app/lib/schematic/sheets";
import { droneFixtureState, fixturePartLookup } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import { ROOT_SHEET_ID, type SchematicState } from "@/lib/schematic-types";

const SCOPE = { tenantId: "local", projectId: "p-j3-history-sheets", branchId: "main" } as const;

/** app/page.tsx's `SchematicSnapshot`: the four arrays plus the tree iff present (never the sheet size). */
const snapshotOf = (state: SchematicState): HistoryStepSnapshot => ({
  components: state.components, wires: state.wires, kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [],
  ...(state.sheets !== undefined ? { sheets: state.sheets } : {}),
});

describe("[PR-J3] 1. historyStepState carries the tree from the snapshot and the size from the authoritative state", () => {
  it("a snapshot with a tree yields a target with the same tree; without one the key is absent and the digest is the single-sheet one", () => {
    const flat = droneFixtureState();
    const organised = multiSheetDroneFixtureState();
    const withTree = historyStepState(snapshotOf(organised), organised);
    expect(withTree.sheets).toEqual(organised.sheets);
    expect(schematicStateDigest(withTree)).toBe(schematicStateDigest(organised));
    const withoutTree = historyStepState(snapshotOf(flat), flat);
    expect("sheets" in withoutTree).toBe(false);
    expect(schematicStateDigest(withoutTree)).toBe(schematicStateDigest(flat));
    expect(withoutTree).toEqual({ components: flat.components, wires: flat.wires, kicadComponents: flat.kicadComponents, netLabels: flat.netLabels, ...(flat.pageSize ? { pageSize: flat.pageSize } : {}) });
  });

  it("the tree comes from the SNAPSHOT only: a tree on `current` is never read, the size comes from `current` only", () => {
    const flat = droneFixtureState();
    const organised = multiSheetDroneFixtureState();
    // the authoritative state still has a tree, the step target (an older snapshot) has none: the target is flat
    const undoneToFlat = historyStepState(snapshotOf(flat), organised);
    expect("sheets" in undoneToFlat).toBe(false);
    expect(undoneToFlat.pageSize).toBe(organised.pageSize);
    // the snapshot has a tree, `current` is null or sizeless: the tree is kept, no size
    expect(historyStepState(snapshotOf(organised), null).sheets).toEqual(organised.sheets);
    expect("pageSize" in historyStepState(snapshotOf(organised), {})).toBe(false);
    expect(historyStepState(snapshotOf(organised), { pageSize: "A3" }).pageSize).toBe("A3");
  });
});

/** The page's composition (app/page.tsx): a real session, the production coordinator, a history of page snapshots. */
async function openEditor(initial: SchematicState) {
  const editor = new SchematicEditorSession({ ...SCOPE }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(structuredClone(initial), null);
  let visible = structuredClone(initial);
  const history = new SchematicHistory<HistoryStepSnapshot>(snapshotOf(initial), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<HistoryStepSnapshot>({
        flushPendingRecord: () => {},
        history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => snapshotOf(authoritative),
        historyRecorded: () => {},
        suppressEffectRecord: () => {},
        scheduleAutosave: () => {},
      }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); coordinator.notifyAuthoritativeProjection(next); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  /** app/page.tsx runHistoryStep: the target is `historyStepState(snapshot, authoritative)`. */
  const step = (direction: "undo" | "redo") => coordinator.runHistoryStep({
    direction,
    peek: () => { const snap = direction === "undo" ? history.peekUndo() : history.peekRedo(); return snap ? historyStepState(snap, coordinator.authoritativeState()) : null; },
    reconcile: (target) => editor.reconcileHistoryStep(direction, target),
    commitCursor: () => { if (direction === "undo") history.undo(); else history.redo(); },
    applyUi: () => { const next = historyStepState(history.present, coordinator.authoritativeState()); visible = structuredClone(next); coordinator.notifyAuthoritativeProjection(next); },
  });
  return { editor, coordinator, history, step, visible: () => structuredClone(visible) };
}

describe("[PR-J3] 2. the first sheet's creation undoes to a document without `sheets` by REPLAY on the same lineage, and redoes", () => {
  it("create -> undo -> redo", async () => {
    const drone = droneFixtureState();
    const p = await openEditor(drone);
    const openedDigest = schematicStateDigest(p.coordinator.authoritativeState());
    const lineage = p.editor.headMark()!.lineageId;
    const gate = await p.coordinator.runCanonicalCommand({
      label: "New sheet Power",
      execute: (base) => p.editor.execute(base, {
        commandId: "schematic.sheet-structure",
        label: "New sheet Power",
        buildOperations: (canonical) => [createSheetOperation(fromCanonicalSchematic(canonical), { operationId: "j3-history-create-power", sheet: { id: "sheet-power", name: "Power", parentId: "root", block: { x: 400, y: 1640, width: 500, height: 200 } }, rootName: "Overview" })],
      }),
    });
    expect(gate.status).toBe("applied");
    const created = p.coordinator.authoritativeState();
    expect(created.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", "Power"]);
    expect(p.history.present.sheets).toEqual(created.sheets); // the page's snapshot recorded the tree
    expect(p.visible().sheets).toEqual(created.sheets);
    const createdDigest = schematicStateDigest(created);
    expect(createdDigest).not.toBe(openedDigest);
    expect(p.editor.headMark()!.lineageId).toBe(lineage);

    await p.step("undo");
    const undone = p.coordinator.authoritativeState();
    expect("sheets" in undone).toBe(false);
    expect(schematicStateDigest(undone)).toBe(openedDigest); // the flat drone, byte-identical
    expect("sheets" in p.visible()).toBe(false);
    expect(p.editor.headMark()!.lineageId).toBe(lineage); // replayed canonically, never a lineage rebase
    expect(p.editor.events.some((event) => event.kind === "undo-reconciled")).toBe(true);
    expect(p.editor.events.some((event) => String(event.kind).includes("rebase"))).toBe(false);

    await p.step("redo");
    const redone = p.coordinator.authoritativeState();
    expect(redone.sheets).toEqual(created.sheets);
    expect(schematicStateDigest(redone)).toBe(createdDigest);
    expect(p.editor.headMark()!.lineageId).toBe(lineage);
    expect(p.editor.events.some((event) => event.kind === "redo-reconciled")).toBe(true);
  });
});

describe("[PR-J3 integration, 2026-10-23] 4. the two-transaction delete of a populated sheet undoes twice and redoes twice by replay", () => {
  it("Move contents of IMU to the overview, Delete sheet IMU -> undo, undo -> redo, redo: digest-identical at every step, the hierarchy valid, the lineage kept", async () => {
    const fixture = multiSheetDroneFixtureState();
    const lookup = fixturePartLookup();
    const p = await openEditor(fixture);
    const lineage = p.editor.headMark()!.lineageId;
    const fixtureDigest = schematicStateDigest(p.coordinator.authoritativeState());
    // 1. Move contents to parent (schematic.move-to-sheet): previewed, then re-planned inside buildOperations as the controller does
    const moveInput: MoveToSheetInput = { entities: movableContents(fixture, "sheet-imu"), target: { sheetId: ROOT_SHEET_ID }, rootName: "Overview", operationIdPrefix: "j3-history-move", offset: { dx: 0, dy: 0 } };
    const preview = planMoveToSheet(fixture, moveInput, lookup);
    if (!preview.ok) throw new Error(`${preview.code}: ${preview.message}`);
    const moved = await p.coordinator.runCanonicalCommand({
      label: "Moved contents to Overview",
      execute: (base) => p.editor.execute(base, {
        commandId: "schematic.move-to-sheet",
        label: "Moved contents to Overview",
        buildOperations: (canonical) => {
          const again = planMoveToSheet(fromCanonicalSchematic(canonical), moveInput, lookup);
          if (!again.ok) throw new Error(again.message);
          expect(again.preview.partitionDigest).toBe(preview.preview.partitionDigest);
          return again.operations;
        },
      }),
    });
    expect(moved.status).toBe("applied");
    const afterMove = p.coordinator.authoritativeState();
    const afterMoveDigest = schematicStateDigest(afterMove);
    expect(afterMove.kicadComponents!.find((item) => item.refDes === "U3")!.sheetId).toBeUndefined();
    expect(afterMove.sheets!.sheets.find((sheet) => sheet.id === "sheet-imu")!.ports!.map((port) => port.name)).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1"]);
    expect(validateSheetHierarchy(afterMove)).toEqual([]);
    // 2. Delete sheet IMU (schematic.sheet-structure): the sheet pins, the hierarchical labels, the ports, the sheet - one batch
    const built = deleteSheetOperations(afterMove, "sheet-imu", "j3-history-delete");
    if (!built.ok) throw new Error(built.message);
    expect(built.operations.map((operation) => operation.kind)).toEqual([...Array<string>(3).fill("schematic_remove_sheet_pin"), ...Array<string>(3).fill("schematic_delete_net_label"), ...Array<string>(3).fill("schematic_remove_sheet_port"), "schematic_delete_sheet"]);
    const deleted = await p.coordinator.runCanonicalCommand({ label: "Deleted sheet IMU", execute: (base) => p.editor.execute(base, { commandId: "schematic.sheet-structure", label: "Deleted sheet IMU", buildOperations: () => built.operations }) });
    expect(deleted.status).toBe("applied");
    const afterDelete = p.coordinator.authoritativeState();
    const afterDeleteDigest = schematicStateDigest(afterDelete);
    expect(afterDelete.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", "Power", "Motor drivers"]);
    expect(validateSheetHierarchy(afterDelete)).toEqual([]);
    expect(p.editor.headMark()!.lineageId).toBe(lineage);
    // undo, undo
    await p.step("undo");
    const undoneOnce = p.coordinator.authoritativeState();
    expect(schematicStateDigest(undoneOnce)).toBe(afterMoveDigest);
    expect(undoneOnce.sheets!.sheets.find((sheet) => sheet.id === "sheet-imu")!.ports!.map((port) => port.name)).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1"]); // the ports back in order, their anchors with them
    expect(validateSheetHierarchy(undoneOnce)).toEqual([]);
    await p.step("undo");
    const undoneTwice = p.coordinator.authoritativeState();
    expect(schematicStateDigest(undoneTwice)).toBe(fixtureDigest);
    expect(undoneTwice.kicadComponents!.find((item) => item.refDes === "U3")!.sheetId).toBe("sheet-imu");
    expect(validateSheetHierarchy(undoneTwice)).toEqual([]);
    expect(schematicStateDigest(p.visible())).toBe(fixtureDigest);
    // redo, redo
    await p.step("redo");
    expect(schematicStateDigest(p.coordinator.authoritativeState())).toBe(afterMoveDigest);
    await p.step("redo");
    expect(schematicStateDigest(p.coordinator.authoritativeState())).toBe(afterDeleteDigest);
    expect(validateSheetHierarchy(p.coordinator.authoritativeState())).toEqual([]);
    expect(p.editor.headMark()!.lineageId).toBe(lineage);
    expect(p.editor.events.filter((event) => event.kind === "undo-reconciled")).toHaveLength(2);
    expect(p.editor.events.filter((event) => event.kind === "redo-reconciled")).toHaveLength(2);
    expect(p.editor.events.some((event) => String(event.kind).includes("rebase"))).toBe(false);
  });
});

describe("[PR-J3] 3. an organised project's step target is the document itself", () => {
  it("the fixture's snapshot + its authoritative size reproduce the fixture digest-for-digest", async () => {
    const fixture = multiSheetDroneFixtureState();
    const p = await openEditor(fixture);
    const target = historyStepState(p.history.present, p.coordinator.authoritativeState());
    expect(target.sheets).toEqual(fixture.sheets);
    expect(schematicStateDigest(target)).toBe(schematicStateDigest(fixture));
    expect(schematicStateDigest(p.coordinator.authoritativeState())).toBe(schematicStateDigest(fixture));
  });
});
