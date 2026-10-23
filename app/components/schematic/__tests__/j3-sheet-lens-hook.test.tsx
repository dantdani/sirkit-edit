// @vitest-environment jsdom
/**
 * [PR-J3, 2026-10-22] Runbook J.3 items 2, 5, 8, J.8.4, J.9 (OD-257 item 5): the sheet lens hook (useSchematicSheetLens) and its
 * controller, against a page-mimicking host (_j3-harness.tsx) and the PRODUCTION gesture coordinator.
 *
 *  1. legacy identity: a single-sheet document comes back as the same arrays, the same graph object, no layer, activation 1;
 *  2. SR-2: a graph command queued on sheet A, then a switch to B: the command lands on A (its new wire is stamped A) and is invisible
 *     on B's projection;
 *  3. SR-3: a gesture active during a switch is cancelled with a rollback (the real SchematicGestureCoordinator: the host gets the
 *     exact base back, the preview is released) and the page's switch hook runs;
 *  4. SR-4: a Follow signal to B replays clear-selection, highlight-net and focus on the fresh bus; the same follow during an
 *     A -> B -> A within one commit is refused (nothing reaches the bus for B); Go to elsewhere opens the part's sheet and replays
 *     select + focus;
 *  5. a project switch retires continuations: a late command failure from the old project shows no notice in the new one, and the
 *     command carried the captured project scope;
 *  6. J.8.4: a stored active sheet that no longer exists falls back to the root with a notice and no document write;
 *  7. the store tolerates a throwing localStorage; no `storage` event listener is registered; the per-sheet camera is written after
 *     its delay and comes back as the sheet's initial camera.
 * jsdom, fake timers where noted; no network; nothing on disk.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectAsyncScopeRegistry } from "@/app/lib/engineering/project-async-scope";
import { SchematicGestureCoordinator, type GestureCoordinatorHost } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { sheetViewStorageKey, type StorageLike } from "@/app/lib/project/sheet-navigation-store";
import { ROOT_SHEET_ID, type SchematicState, type Wire } from "@/lib/schematic-types";
import type { SchematicGraphApi } from "@/app/lib/schematic/sheet-lens";
import { droneFixtureState } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { CAMERA_WRITE_DELAY_MS } from "../hooks/sheet-navigation-controller";
import type { SchematicSheetLens } from "../hooks/useSchematicSheetLens";
import { FakePage, Harness, MemoryStorage, fakeSurface, imuSplit, recordingGraph, settle } from "./_j3-harness";

let latest: SchematicSheetLens | null = null;
const lens = (): SchematicSheetLens => { if (!latest) throw new Error("no lens yet"); return latest; };
const onLens = (next: SchematicSheetLens): void => { latest = next; };
const summary = () => screen.getByTestId("lens");

beforeEach(() => { latest = null; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("[PR-J3] the sheet lens hook", () => {
  it("1. legacy identity: a single-sheet document is handed back untouched", async () => {
    const page = new FakePage(droneFixtureState());
    const { graph } = recordingGraph();
    render(<Harness page={page} graph={graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    const state = page.current();
    expect(lens().legacy).toBe(true);
    expect(lens().components).toBe(state.components);
    expect(lens().wires).toBe(state.wires);
    expect(lens().kicadComponents).toBe(state.kicadComponents);
    expect(lens().netLabels).toBe(state.netLabels);
    expect(lens().graph).toBe(graph);
    expect(lens().editorProps.sheetLayer).toBeNull();
    expect(lens().editorProps.initialCamera).toBeUndefined();
    expect(lens().activation).toBe(1);
    expect(lens().activeSheetId).toBe(ROOT_SHEET_ID);
    expect(screen.getByTestId("sheets-chip").textContent).toContain("1 sheet");
  });

  it("2. SR-2: a graph command queued on sheet A lands on A after a switch to B and is invisible on B", async () => {
    const { after } = imuSplit();
    const page = new FakePage(after);
    const recorder = recordingGraph();
    render(<Harness page={page} graph={recorder.graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    expect(lens().legacy).toBe(false);
    expect(lens().graph).not.toBe(recorder.graph);
    // on the IMU sheet (A): queue "add a wire"
    lens().controller.openSheet("sheet-imu");
    await settle();
    expect(summary().dataset.active).toBe("sheet-imu");
    expect(summary().dataset.kicad).toBe("U3");
    lens().graph.run("Added wire", "schematic.connect", (view) => ({ wires: [...view.wires, { id: "w-queued", vertices: [{ x: 10, y: 10 }, { x: 60, y: 10 }] }] }));
    expect(recorder.calls.at(-1)).toEqual({ kind: "run", payload: { label: "Added wire", commandId: "schematic.connect" } });
    // switch to B (the overview) BEFORE the queue runs the command
    lens().controller.openSheet(ROOT_SHEET_ID);
    await settle();
    expect(summary().dataset.active).toBe(ROOT_SHEET_ID);
    const [result] = recorder.flush(page.current()) as [{ wires: Wire[] }];
    const queued = result.wires.find((wire) => wire.id === "w-queued")!;
    expect(queued.sheetId).toBe("sheet-imu"); // landed on A
    expect(result.wires.length).toBe(after.wires.length + 1);
    page.set({ ...page.current(), wires: result.wires });
    await settle();
    expect(lens().wires.some((wire) => wire.id === "w-queued")).toBe(false); // invisible on B
    lens().controller.openSheet("sheet-imu");
    await settle();
    expect(lens().wires.some((wire) => wire.id === "w-queued")).toBe(true);
  });

  it("3. SR-3: a gesture active during a switch is cancelled with a rollback on the real coordinator; the page's switch hook runs", async () => {
    const { after } = imuSplit();
    const page = new FakePage(after);
    const host: GestureCoordinatorHost & { frames: unknown[]; rollbacks: SchematicState[] } = {
      frames: [], rollbacks: [],
      currentState: () => page.current(),
      applyPreviewFrame: (frame) => { host.frames.push(frame); },
      applyCanonicalProjection: () => undefined,
      applyRollbackProjection: (state) => { host.rollbacks.push(state); },
      execute: async () => null,
      notify: () => undefined,
    };
    const coordinator = new SchematicGestureCoordinator(host);
    coordinator.notifyAuthoritativeProjection(after);
    const graph: SchematicGraphApi = {
      run: () => undefined,
      begin: () => coordinator.begin(),
      preview: (frame) => coordinator.preview(frame),
      cancel: () => coordinator.cancel(),
      commit: (label, finalGraph) => { void coordinator.commit(label, finalGraph); },
    };
    const onSheetSwitch = vi.fn();
    render(<Harness page={page} graph={graph} projectId="p1" storage={new MemoryStorage()} onSheetSwitch={onSheetSwitch} onLens={onLens} />);
    await settle();
    lens().controller.openSheet("sheet-imu");
    await settle();
    expect(onSheetSwitch).toHaveBeenCalledTimes(1);
    // a drag on the IMU sheet: begin + a preview frame over the sheet's own arrays
    expect(lens().graph.begin()).toBe(true);
    expect(coordinator.previewActive).toBe(true);
    const moved = lens().kicadComponents.map((item) => ({ ...item, x: item.x + 10 }));
    lens().graph.preview({ kicadComponents: moved });
    const frame = host.frames.at(-1) as { kicadComponents: SchematicState["kicadComponents"] };
    expect(frame.kicadComponents!.length).toBe(after.kicadComponents!.length); // the whole project, U3 moved
    expect(frame.kicadComponents!.find((item) => item.refDes === "U3")!.x).toBe(moved[0]!.x);
    // the switch cancels the gesture: the exact base is rolled back, the preview released, nothing committed
    lens().controller.openSheet(ROOT_SHEET_ID);
    await settle();
    expect(coordinator.previewActive).toBe(false);
    expect(host.rollbacks).toHaveLength(1);
    expect(schematicStateDigest(host.rollbacks[0]!)).toBe(schematicStateDigest(after));
    expect(onSheetSwitch).toHaveBeenCalledTimes(2);
    expect(page.commands).toEqual([]);
    expect(lens().activation).toBe(3);
  });

  it("4. SR-4: Follow signal replays on the fresh bus; an A -> B -> A continuation is refused; Go to elsewhere opens the part's sheet", async () => {
    const { after, u3Id } = imuSplit();
    const page = new FakePage(after);
    const surface = fakeSurface();
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} bridge={surface.bridge} onLens={onLens} />);
    await settle();
    const signals = lens().controller.interfaceSignals();
    const scl = signals.find((signal) => signal.name === "I2C_SCL")!;
    const destination = scl.destinations.find((item) => item.sheetId === "sheet-imu")!;
    lens().controller.followDestination(destination);
    await settle();
    expect(summary().dataset.active).toBe("sheet-imu");
    const commands = surface.dispatched.map((envelope) => [envelope.commandId, envelope.payload]);
    expect(commands).toEqual([
      ["schematic.clear-selection", null],
      ["schematic.highlight-net", { name: "I2C_SCL" }],
      ["schematic.focus", { target: { kind: "point", x: destination.position.x, y: destination.position.y } }],
    ]);
    expect(surface.dispatched.every((envelope) => envelope.actor.actorKind === "human" && envelope.editor === "schematic")).toBe(true);
    // A -> B -> A inside one commit: the continuation captured for B is refused (only A's clear-selection reaches the bus)
    surface.dispatched.length = 0;
    const back = lens().controller.interfaceSignals().find((signal) => signal.name === "I2C_SCL")!.destinations.find((item) => item.sheetId === ROOT_SHEET_ID)!;
    lens().controller.followDestination(back); // -> B (the overview), highlight pending for B
    lens().controller.openSheet("sheet-imu"); // -> A again, before B's commit ran its replay
    await settle();
    expect(summary().dataset.active).toBe("sheet-imu");
    expect(surface.dispatched.map((envelope) => envelope.commandId)).toEqual(["schematic.clear-selection"]);
    expect(surface.dispatched.some((envelope) => envelope.commandId === "schematic.highlight-net")).toBe(false);
    // Go to: a reference the active sheet does not hold opens its sheet and replays select + focus there
    surface.dispatched.length = 0;
    expect(lens().editorProps.onLocateElsewhere("U3")).toBe(false); // already on the IMU sheet
    expect(lens().editorProps.onLocateElsewhere("U99")).toBe(false); // not in the project
    expect(lens().editorProps.onLocateElsewhere("U1")).toBe(true);
    await settle();
    expect(summary().dataset.active).toBe(ROOT_SHEET_ID);
    expect(surface.dispatched.map((envelope) => envelope.commandId)).toEqual(["schematic.clear-selection", "schematic.select", "schematic.focus"]);
    expect(surface.dispatched[1]!.payload).toEqual({ target: { kind: "component", ref: "U1" } });
    // the selection the bus holds is what the move planner reads when the page hands none over
    surface.selection = { id: u3Id, family: "kicad" };
    expect(lens().controller.currentSelection()).toMatchObject({ family: "kicad", id: u3Id, label: "U3", sheetId: "sheet-imu" });
  });

  it("5. a project switch retires continuations: no notice from the old project's late failure; the command carried the captured scope", async () => {
    const { after } = imuSplit();
    const page = new FakePage(after);
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "p1", branchId: "main", session: null });
    const captureScope = () => registry.capture();
    const storage = new MemoryStorage();
    let release: () => void = () => undefined;
    page.gate = new Promise<void>((resolve) => { release = resolve; });
    const view = render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={storage} captureScope={captureScope} onLens={onLens} />);
    await settle();
    const promise = lens().controller.createSheet("Power", ROOT_SHEET_ID);
    await settle();
    expect(page.commands).toHaveLength(1);
    expect(page.commands[0]!.commandId).toBe("schematic.sheet-structure");
    expect(page.commands[0]!.options?.scope?.isCurrent()).toBe(true);
    // the project switches while the command is in flight
    registry.beginProject({ projectId: "p2", branchId: "main", session: null });
    expect(page.commands[0]!.options?.scope?.isCurrent()).toBe(false);
    page.baseForBuild = () => { throw new Error("the old project's command fails late"); };
    view.rerender(<Harness page={page} graph={recordingGraph().graph} projectId="p2" storage={storage} captureScope={captureScope} onLens={onLens} />);
    await settle();
    expect(lens().activation).toBe(2);
    release();
    const outcome = await promise;
    await settle();
    expect(outcome.ok).toBe(false);
    expect(lens().notice).toBeNull(); // the late failure belongs to p1: nothing shown in p2
    expect(screen.queryByTestId("sheets-notice")).toBeNull();
  });

  it("6. J.8.4: a stored active sheet that no longer exists falls back to the root with a notice and no document write", async () => {
    const { after } = imuSplit();
    const page = new FakePage(after);
    const storage = new MemoryStorage();
    storage.setItem(sheetViewStorageKey("p1"), JSON.stringify({ version: 1, activeSheetId: "sheet-ghost", cameras: { "sheet-ghost": { pan: { x: 1, y: 2 }, zoom: 1 } }, history: ["sheet-ghost"] }));
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={storage} onLens={onLens} />);
    await settle();
    expect(lens().activeSheetId).toBe(ROOT_SHEET_ID);
    expect(lens().notice).toMatch(/sheet-ghost.*no longer exists.*overview/);
    expect(screen.getByTestId("sheets-notice").textContent).toContain("no longer exists");
    expect(page.commands).toEqual([]);
    expect(schematicStateDigest(page.current())).toBe(schematicStateDigest(after));
    // a stored sheet that exists opens directly; the ghost's camera was pruned
    cleanup();
    storage.setItem(sheetViewStorageKey("p1"), JSON.stringify({ version: 1, activeSheetId: "sheet-imu", cameras: { "sheet-imu": { pan: { x: 5, y: 6 }, zoom: 2 } }, history: [] }));
    render(<Harness page={new FakePage(after)} graph={recordingGraph().graph} projectId="p1" storage={storage} onLens={onLens} />);
    await settle();
    expect(lens().activeSheetId).toBe("sheet-imu");
    expect(lens().notice).toBeNull();
    expect(lens().editorProps.initialCamera).toEqual({ pan: { x: 5, y: 6 }, zoom: 2 });
    // the sheet the user is on disappears from the document (undo elsewhere): fall back to its parent with a notice
    const stripped: SchematicState = droneFixtureState();
    const pageTwo = new FakePage(after);
    cleanup();
    render(<Harness page={pageTwo} graph={recordingGraph().graph} projectId="p1" storage={storage} onLens={onLens} />);
    await settle();
    expect(lens().activeSheetId).toBe("sheet-imu");
    pageTwo.set(stripped);
    await settle();
    expect(lens().activeSheetId).toBe(ROOT_SHEET_ID);
    expect(lens().legacy).toBe(true);
    expect(lens().notice).toMatch(/no longer exists/);
    expect(pageTwo.commands).toEqual([]);
  });

  it("7. a throwing storage is tolerated, no storage listener is registered, and the per-sheet camera round-trips through the store", async () => {
    const { after } = imuSplit();
    const listener = vi.spyOn(window, "addEventListener");
    const throwing: StorageLike = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    render(<Harness page={new FakePage(after)} graph={recordingGraph().graph} projectId="p1" storage={throwing} onLens={onLens} />);
    await settle();
    lens().controller.openSheet("sheet-imu");
    await settle();
    expect(lens().activeSheetId).toBe("sheet-imu");
    lens().editorProps.onCameraChange({ pan: { x: 1, y: 1 }, zoom: 1 });
    expect(listener.mock.calls.some(([type]) => String(type) === "storage")).toBe(false);
    cleanup();
    // the camera: written after its delay, read back as the sheet's initial camera on the next visit
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const storage = new MemoryStorage();
    const page = new FakePage(after);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={storage} onLens={onLens} />);
    await settle();
    lens().controller.openSheet("sheet-imu");
    await settle();
    lens().editorProps.onCameraChange({ pan: { x: 40, y: 50 }, zoom: 1.25 });
    lens().editorProps.onCameraChange({ pan: { x: 42, y: 52 }, zoom: 1.5 });
    expect(JSON.parse(storage.getItem(sheetViewStorageKey("p1"))!).cameras["sheet-imu"]).toBeUndefined();
    vi.advanceTimersByTime(CAMERA_WRITE_DELAY_MS + 1);
    expect(JSON.parse(storage.getItem(sheetViewStorageKey("p1"))!).cameras["sheet-imu"]).toEqual({ pan: { x: 42, y: 52 }, zoom: 1.5 });
    lens().controller.openSheet(ROOT_SHEET_ID);
    await settle();
    expect(lens().editorProps.initialCamera).toBeUndefined();
    lens().controller.openSheet("sheet-imu");
    await settle();
    expect(lens().editorProps.initialCamera).toEqual({ pan: { x: 42, y: 52 }, zoom: 1.5 });
    expect(JSON.parse(storage.getItem(sheetViewStorageKey("p1"))!)).toMatchObject({ activeSheetId: "sheet-imu", history: ["sheet-imu", ROOT_SHEET_ID, "sheet-imu"] });
  });
});
