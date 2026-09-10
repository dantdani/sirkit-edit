/**
 * [B17-C] The pcb3d command set on the view-session bus, against a real
 * board: open/close, presets, fit, reset, focus by component / selection /
 * net, independent top and bottom silkscreen, every scene layer, finish as
 * the only persisted preference, read-state, and bounded "model/geometry
 * unavailable" results.
 */
import { describe, expect, it } from "vitest";
import { createViewCommand, ViewSessionBus, type ViewPreferenceStore } from "../bus";
import { boardGeometryProbe, pcb3dCommands, pcb3dInitialState, PCB3D_LAYERS, type Pcb3dViewState } from "../pcb3d";
import type { TrustedViewActor, ViewCommandEnvelope } from "../types";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import type { PcbBoard } from "@/app/lib/pcb/types";

const IDENTITY = { sessionId: "vs-3d", projectId: "proj-1", branchId: "main", editor: "pcb3d" as const };
const ACTOR: TrustedViewActor = { actorId: "u-1", role: "pcb_editor", actorKind: "human" };
const T0 = "2026-09-09T12:00:00.000Z";
const MM = 1_000_000;

function board(): PcbBoard {
  const b = createEmptyBoard();
  b.outline = { kind: "rect", origin: { x: 0, y: 0 }, width: 40 * MM, height: 30 * MM };
  b.nets = [{ id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] }, { id: 1, name: "/root/GND", stableId: "net:gnd", endpointKeys: [] }, { id: 2, name: "/root/VCC", stableId: "net:vcc", endpointKeys: [] }];
  const pad = (number: string) => ({ number, type: "smd" as const, shape: "rect" as const, at: { x: 0, y: 0 }, size: { x: 1 * MM, y: 1 * MM }, layers: ["copperTop"] as const, drill: null } as unknown as PcbBoard["footprints"][number]["def"]["pads"][number]);
  const def = { name: "R_0805", pads: [pad("1"), pad("2")], graphics: [], models: [], mountingTechnology: "smd", bodyBBox: { minX: -0.5 * MM, minY: -0.5 * MM, maxX: 0.5 * MM, maxY: 0.5 * MM } } as unknown as PcbBoard["footprints"][number]["def"];
  b.footprints = [
    { id: "fp-j1", ref: "J1", footprintId: "lib:PinHeader", def, at: { x: 5 * MM, y: 5 * MM }, rotationDeg: 0, side: "top", padNets: { "1": 1, "2": 2 } } as unknown as PcbBoard["footprints"][number],
    { id: "fp-r1", ref: "R1", footprintId: "lib:R_0805", def, at: { x: 30 * MM, y: 20 * MM }, rotationDeg: 0, side: "top", padNets: { "1": 2, "2": 0 } } as unknown as PcbBoard["footprints"][number],
  ];
  b.tracks = [{ id: "t-1", layer: "copperTop", netId: 1, start: { x: 5 * MM, y: 5 * MM }, end: { x: 15 * MM, y: 5 * MM }, width: 0.25 * MM } as unknown as PcbBoard["tracks"][number]];
  return b;
}

function makeBus(current: () => PcbBoard | null, preferences?: ViewPreferenceStore) {
  return new ViewSessionBus<Pcb3dViewState>({ identity: IDENTITY, initialState: pcb3dInitialState(), commands: pcb3dCommands(() => (current() ? boardGeometryProbe(current()) : null)), clock: () => T0, preferences });
}
function env(commandId: string, payload: unknown, rev: number, id: string): ViewCommandEnvelope {
  return createViewCommand({ identity: IDENTITY, commandId, payload, actor: ACTOR, expectedViewRevision: rev, issuedAt: T0, invocationId: id });
}

describe("B17-C — pcb3d view commands", () => {
  it("opens, closes and reads state without geometry; every command is registered", async () => {
    const bus = makeBus(() => null);
    expect(bus.describeCommands().map((c) => c.commandId)).toEqual(["pcb3d.camera-preset", "pcb3d.close", "pcb3d.fit-board", "pcb3d.focus-component", "pcb3d.focus-net", "pcb3d.focus-selection", "pcb3d.open", "pcb3d.read-state", "pcb3d.reset-camera", "pcb3d.set-finish", "pcb3d.set-layer-visible", "pcb3d.toggle-layer"]);
    const opened = await bus.dispatch(env("pcb3d.open", null, 0, "o-1"));
    expect(opened).toMatchObject({ status: "settled", changed: true, viewRevision: 1, state: { open: true } });
    expect(await bus.dispatch(env("pcb3d.open", null, 1, "o-2"))).toMatchObject({ status: "settled", changed: false, viewRevision: 1 });
    expect(await bus.dispatch(env("pcb3d.read-state", null, 0, "r-1"))).toMatchObject({ status: "settled", rebased: true, changed: false, state: { open: true, layers: { silkTop: true, silkBottom: true } } });
    expect(await bus.dispatch(env("pcb3d.close", null, 1, "c-1"))).toMatchObject({ status: "settled", state: { open: false }, viewRevision: 2 });
  });

  it("camera presets, fit and reset frame the board; without a board they are bounded unavailable refusals", async () => {
    let current: PcbBoard | null = null;
    const bus = makeBus(() => current);
    expect(await bus.dispatch(env("pcb3d.camera-preset", { preset: "top" }, 0, "p-0"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "model/geometry unavailable: no board is loaded" } });
    current = board();
    const top = await bus.dispatch(env("pcb3d.camera-preset", { preset: "top" }, 0, "p-1"));
    expect(top).toMatchObject({ status: "settled", state: { camera: { preset: "top", targetMm: { x: 20, y: -15, z: 0 }, distanceMm: 50, seq: 1 } } });
    const iso = await bus.dispatch(env("pcb3d.camera-preset", { preset: "iso" }, 1, "p-2"));
    expect((iso as { state: Pcb3dViewState }).state.camera).toMatchObject({ preset: "iso", seq: 2 });
    expect(await bus.dispatch(env("pcb3d.camera-preset", { preset: "side" }, 2, "p-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    const fit = await bus.dispatch(env("pcb3d.fit-board", null, 2, "f-1"));
    expect((fit as { state: Pcb3dViewState }).state.camera).toMatchObject({ preset: "iso", distanceMm: 50, seq: 3 });
    const reset = await bus.dispatch(env("pcb3d.reset-camera", null, 3, "rs-1"));
    expect((reset as { state: Pcb3dViewState }).state).toMatchObject({ camera: { preset: "iso", seq: 4 }, focus: null });
  });

  it("focuses a component by refdes or id, the current selection, and a net with geometry; unknown targets are unavailable, never a pretend focus", async () => {
    const b = board();
    const bus = makeBus(() => b);
    const j1 = await bus.dispatch(env("pcb3d.focus-component", { ref: "J1" }, 0, "fc-1"));
    expect(j1).toMatchObject({ status: "settled", state: { camera: { preset: "custom", targetMm: { x: 5, y: -5, z: 0 }, seq: 1 }, focus: { kind: "component", ref: "J1" } } });
    expect((j1 as { state: Pcb3dViewState }).state.camera.distanceMm).toBeCloseTo(5, 5); // 1 mm pads → 4 mm minimum span × 1.25
    expect(await bus.dispatch(env("pcb3d.focus-component", { ref: "fp-r1" }, 1, "fc-2"))).toMatchObject({ status: "settled", state: { focus: { kind: "component", ref: "fp-r1" } } });
    expect(await bus.dispatch(env("pcb3d.focus-component", { ref: "U9" }, 2, "fc-3"))).toMatchObject({ status: "refused", viewRevision: 2, refusal: { code: "VS_UNAVAILABLE", message: "model/geometry unavailable: component U9 is not on the board" } });
    expect(await bus.dispatch(env("pcb3d.focus-component", { ref: "" }, 2, "fc-4"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    const selection = await bus.dispatch(env("pcb3d.focus-selection", { refs: [{ kind: "footprint", id: "fp-j1" }, { kind: "footprint", id: "fp-r1" }] }, 2, "fs-1"));
    expect(selection).toMatchObject({ status: "settled", state: { focus: { kind: "selection" }, camera: { preset: "custom", targetMm: { x: 17.5, y: -12.5, z: 0 } } } });
    expect(await bus.dispatch(env("pcb3d.focus-selection", { refs: [] }, 3, "fs-2"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "model/geometry unavailable: nothing is selected" } });
    expect(await bus.dispatch(env("pcb3d.focus-selection", { refs: [{ kind: "via", id: "nope" }] }, 3, "fs-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    const gnd = await bus.dispatch(env("pcb3d.focus-net", { name: "GND" }, 3, "fn-1"));
    expect(gnd).toMatchObject({ status: "settled", state: { focus: { kind: "net", netId: 1, name: "/root/GND" } } });
    expect((gnd as { state: Pcb3dViewState }).state.focus).toMatchObject({ boundsMm: { minX: 4.5, maxX: 15.125 } }); // J1 pad + the GND track
    expect(await bus.dispatch(env("pcb3d.focus-net", { netId: 2 }, 4, "fn-2"))).toMatchObject({ status: "settled", state: { focus: { kind: "net", netId: 2 } } });
    expect(await bus.dispatch(env("pcb3d.focus-net", { name: "NET_NONE" }, 5, "fn-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect(await bus.dispatch(env("pcb3d.focus-net", { netId: 0 }, 5, "fn-4"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    // a preset after a focus keeps the focus framing; fit/reset clear it
    expect(await bus.dispatch(env("pcb3d.camera-preset", { preset: "top" }, 5, "p-after"))).toMatchObject({ status: "settled", state: { camera: { preset: "top", targetMm: { x: 17.5, y: -12.5, z: 0 } }, focus: { kind: "net", netId: 2 } } }); // VCC spans J1 and R1
    expect(await bus.dispatch(env("pcb3d.fit-board", null, 6, "fit-after"))).toMatchObject({ status: "settled", state: { focus: null, camera: { targetMm: { x: 20, y: -15, z: 0 } } } });
  });

  it("shows and hides every scene layer independently — top and bottom silkscreen separately; set-visible rebases, toggle refuses a stale view", async () => {
    const bus = makeBus(() => board());
    for (const layer of PCB3D_LAYERS) expect(pcb3dInitialState().layers[layer]).toBe(true);
    const hideTop = await bus.dispatch(env("pcb3d.set-layer-visible", { layer: "silkTop", visible: false }, 0, "l-1"));
    expect((hideTop as { state: Pcb3dViewState }).state.layers).toMatchObject({ silkTop: false, silkBottom: true });
    expect(await bus.dispatch(env("pcb3d.set-layer-visible", { layer: "silkTop", visible: false }, 1, "l-2"))).toMatchObject({ status: "settled", changed: false, viewRevision: 1 });
    const stale = await bus.dispatch(env("pcb3d.set-layer-visible", { layer: "silkBottom", visible: false }, 0, "l-3"));
    expect(stale).toMatchObject({ status: "settled", rebased: true, state: { layers: { silkTop: false, silkBottom: false } } });
    expect(await bus.dispatch(env("pcb3d.toggle-layer", { layer: "copper" }, 0, "l-4"))).toMatchObject({ status: "refused", refusal: { code: "VS_STALE_REVISION" } });
    expect(await bus.dispatch(env("pcb3d.toggle-layer", { layer: "copper" }, 2, "l-5"))).toMatchObject({ status: "settled", state: { layers: { copper: false } } });
    expect(await bus.dispatch(env("pcb3d.set-layer-visible", { layer: "silk", visible: true }, 3, "l-6"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
  });

  it("the finish is the ONLY persisted preference; it never claims a stackup change", async () => {
    const saved: Record<string, unknown>[] = [];
    const store: ViewPreferenceStore = { load: () => ({ finish: "black-enig" }), save: (values) => { saved.push(values); } };
    const bus = makeBus(() => board(), store);
    expect(bus.getState().finish).toBe("black-enig");
    await bus.dispatch(env("pcb3d.open", null, 0, "pf-1"));
    await bus.dispatch(env("pcb3d.set-layer-visible", { layer: "mask", visible: false }, 1, "pf-2"));
    await bus.dispatch(env("pcb3d.focus-component", { ref: "J1" }, 2, "pf-3"));
    expect(saved).toEqual([]);
    expect(await bus.dispatch(env("pcb3d.set-finish", { finish: "red-hasl" }, 3, "pf-4"))).toMatchObject({ status: "settled", state: { finish: "red-hasl" } });
    expect(saved).toEqual([{ finish: "red-hasl" }]);
    expect(await bus.dispatch(env("pcb3d.set-finish", { finish: "gold-plated-unobtainium" }, 4, "pf-5"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    expect(JSON.stringify(bus.getState())).not.toContain("stackup");
  });

  it("the acceptance phrase — open, hide the top silkscreen, focus J1, isometric — settles through the bus with the exact final state", async () => {
    const bus = makeBus(() => board());
    const steps = [
      env("pcb3d.open", null, 0, "a-1"),
      env("pcb3d.set-layer-visible", { layer: "silkTop", visible: false }, 1, "a-2"),
      env("pcb3d.focus-component", { ref: "J1" }, 2, "a-3"),
      env("pcb3d.camera-preset", { preset: "iso" }, 3, "a-4"),
    ];
    for (const step of steps) expect((await bus.dispatch(step)).status).toBe("settled");
    const state = bus.getState();
    expect(state).toMatchObject({ open: true, layers: { silkTop: false, silkBottom: true }, focus: { kind: "component", ref: "J1" }, camera: { preset: "iso", targetMm: { x: 5, y: -5, z: 0 }, seq: 2 } });
    expect(bus.viewRevision).toBe(4);
  });
});
