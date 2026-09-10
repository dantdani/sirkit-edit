/**
 * [B17-D] The pcb (2D canvas) command set on the view-session bus against a
 * real board: fit/zoom/pan/focus by semantic target, the versioned selection
 * ("this component" refuses stale or absent selection), layers, grid, net
 * highlight, revealing DRC/routing findings, measuring without creating a
 * dimension, editor-only observation, and bounded unavailable results. No
 * command touches the board.
 */
import { describe, expect, it } from "vitest";
import { createViewCommand, ViewSessionBus } from "../bus";
import { fitPxPerMm, pcbCommands, pcbInitialState, pcbViewProbe, PCB_FOCUS_MAX_PX_PER_MM, type PcbViewState } from "../pcb";
import { selectionDigest, validateViewTarget } from "../targets";
import type { TrustedViewActor, ViewCommandEnvelope } from "../types";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { DrcResult } from "@/app/lib/pcb/drc/types";
import type { AutorouteUnresolvedConnection } from "@/app/lib/pcb/autoroute/completion";

const IDENTITY = { sessionId: "vs-pcb", projectId: "proj-1", branchId: "main", editor: "pcb" as const };
const HUMAN: TrustedViewActor = { actorId: "u-1", role: "pcb_editor", actorKind: "human" };
const AGENT: TrustedViewActor = { actorId: "agent-1", role: "pcb_editor", actorKind: "agent" };
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

const DRC = { violations: [{ id: "v1", kind: "clearance", severity: "error", items: [{ kind: "track", id: "t-1" }], location: { x: 10 * MM, y: 5 * MM }, measuredNm: 100_000, thresholdNm: 200_000, summary: "Clearance 0.10 mm < 0.20 mm", detail: "" }] } as unknown as DrcResult;
const ROUTING: AutorouteUnresolvedConnection[] = [{ netId: 1, netName: "/root/GND", from: { footprintId: "fp-j1", reference: "J1", padNumber: "1" }, location: { x: 5 * MM, y: 5 * MM }, failure: "blocked by courtyard", primaryBlockers: [], suggestedRepair: [] }];

function makeBus(current: () => PcbBoard | null, extras: { drc?: DrcResult | null; routing?: AutorouteUnresolvedConnection[] } = {}) {
  return new ViewSessionBus<PcbViewState>({ identity: IDENTITY, initialState: pcbInitialState(), commands: pcbCommands(() => pcbViewProbe({ board: current(), drc: extras.drc ?? null, routingFailures: extras.routing ?? null })), clock: () => T0 });
}
function env(commandId: string, payload: unknown, rev: number, id: string, actor: TrustedViewActor = HUMAN): ViewCommandEnvelope {
  return createViewCommand({ identity: IDENTITY, commandId, payload, actor, expectedViewRevision: rev, issuedAt: T0, invocationId: id });
}
const OBSERVED = { centerNm: { x: 20 * MM, y: 15 * MM }, pxPerMm: 10, viewportPx: { width: 800, height: 600 } };

describe("B17-D — pcb view commands", () => {
  it("registers the full command set; fit/zoom/pan need the board and the observed view, and answer bounded refusals otherwise", async () => {
    let current: PcbBoard | null = null;
    const bus = makeBus(() => current);
    expect(bus.describeCommands().map((c) => c.commandId)).toEqual([
      "pcb.clear-highlight", "pcb.clear-measurement", "pcb.clear-selection", "pcb.fit-board", "pcb.fit-selection", "pcb.focus", "pcb.highlight-net", "pcb.isolate-layer", "pcb.measure", "pcb.observe", "pcb.pan-to", "pcb.read-state", "pcb.reveal-finding",
      "pcb.select", "pcb.select-add", "pcb.select-net", "pcb.select-remove", "pcb.set-active-layer", "pcb.set-grid", "pcb.set-layer-visible", "pcb.show-copper", "pcb.toggle-grid", "pcb.toggle-layer", "pcb.zoom", "pcb.zoom-to",
    ]);
    expect(await bus.dispatch(env("pcb.fit-board", null, 0, "f-0"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "geometry unavailable: no board is loaded" } });
    current = board();
    expect(await bus.dispatch(env("pcb.fit-board", null, 0, "f-1"))).toMatchObject({ status: "settled", viewRevision: 1, state: { camera: { kind: "board", centerNm: null, pxPerMm: null, seq: 1 } } });
    // Relative zoom needs what the renderer shows; the editor observes it first.
    expect(await bus.dispatch(env("pcb.zoom", { factor: 2 }, 1, "z-0"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect(await bus.dispatch(env("pcb.observe", { camera: OBSERVED }, 1, "o-1"))).toMatchObject({ status: "settled", viewRevision: 2, state: { observed: OBSERVED } });
    expect(await bus.dispatch(env("pcb.zoom", { factor: 2 }, 1, "z-stale"))).toMatchObject({ status: "refused", refusal: { code: "VS_STALE_REVISION" } });
    expect(await bus.dispatch(env("pcb.zoom", { factor: 2 }, 2, "z-1"))).toMatchObject({ status: "settled", state: { camera: { kind: "custom", centerNm: OBSERVED.centerNm, pxPerMm: 20, seq: 2 } } });
    expect(await bus.dispatch(env("pcb.zoom", { factor: 8 }, 3, "z-2"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    expect(await bus.dispatch(env("pcb.zoom-to", { pxPerMm: 9999 }, 3, "z-3"))).toMatchObject({ status: "settled", state: { camera: { pxPerMm: 400, seq: 3 } } });
    expect(await bus.dispatch(env("pcb.pan-to", { target: { kind: "component", ref: "R1" } }, 4, "p-1"))).toMatchObject({ status: "settled", state: { camera: { kind: "custom", centerNm: { x: 30 * MM, y: 20 * MM }, pxPerMm: null, seq: 4 } } });
    expect(await bus.dispatch(env("pcb.pan-to", { target: { kind: "point", x: 1.4 * MM, y: 2 * MM } }, 5, "p-2"))).toMatchObject({ status: "settled", state: { camera: { centerNm: { x: 1.4 * MM, y: 2 * MM }, seq: 5 } } });
    expect(await bus.dispatch(env("pcb.pan-to", { target: { kind: "component", ref: "U9" } }, 6, "p-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "geometry unavailable: component U9 is not on the board" } });
    expect(await bus.dispatch(env("pcb.pan-to", { target: { kind: "screen", x: 10, y: 10 } }, 6, "p-4"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
  });

  it("focuses by refdes, object, net and point; framing is bounded and derived from the observed viewport", async () => {
    const bus = makeBus(() => board());
    await bus.dispatch(env("pcb.observe", { camera: OBSERVED }, 0, "o-1"));
    const j1 = await bus.dispatch(env("pcb.focus", { target: { kind: "component", ref: "J1" } }, 1, "f-1"));
    expect(j1).toMatchObject({ status: "settled", state: { camera: { kind: "custom", centerNm: { x: 5 * MM, y: 5 * MM }, pxPerMm: PCB_FOCUS_MAX_PX_PER_MM, seq: 1 } } });
    expect(fitPxPerMm({ minX: 0, minY: 0, maxX: 40 * MM, maxY: 30 * MM }, OBSERVED.viewportPx)).toBe(17);
    const net = await bus.dispatch(env("pcb.focus", { target: { kind: "net", name: "GND" } }, 2, "f-2"));
    expect((net as { state: PcbViewState }).state.camera).toMatchObject({ kind: "custom", pxPerMm: PCB_FOCUS_MAX_PX_PER_MM, seq: 2 });
    expect((net as { state: PcbViewState }).state.camera.centerNm!.x).toBeGreaterThan(5 * MM);
    expect(await bus.dispatch(env("pcb.focus", { target: { kind: "object", ref: { kind: "track", id: "t-1" } } }, 3, "f-3"))).toMatchObject({ status: "settled", state: { camera: { centerNm: { x: 10 * MM, y: 5 * MM } } } });
    expect(await bus.dispatch(env("pcb.focus", { target: { kind: "object", ref: { kind: "via", id: "nope" } } }, 4, "f-4"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect(await bus.dispatch(env("pcb.focus", { target: { kind: "net", name: "NC" } }, 4, "f-5"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
  });

  it("selection is versioned: replace/add/remove/net/clear, relative commands refuse a stale view, 'this component' refuses stale or absent selection", async () => {
    const bus = makeBus(() => board());
    await bus.dispatch(env("pcb.observe", { camera: OBSERVED }, 0, "o-1"));
    // Absent selection: "this component" is unavailable, never guessed.
    expect(await bus.dispatch(env("pcb.focus", { target: { kind: "primary" } }, 1, "th-0"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "no current selection: 'this component' cannot be resolved" } });
    const selected = await bus.dispatch(env("pcb.select", { target: { kind: "component", ref: "J1" } }, 1, "s-1"));
    expect(selected).toMatchObject({ status: "settled", viewRevision: 2, state: { selection: { refs: [{ kind: "footprint", id: "fp-j1" }], primary: { kind: "footprint", id: "fp-j1" } } } });
    const digest = (selected as { state: PcbViewState }).state.selection.digest;
    expect(digest).toBe(selectionDigest([{ kind: "footprint", id: "fp-j1" }], { kind: "footprint", id: "fp-j1" }));
    // The same selection again changes nothing.
    expect(await bus.dispatch(env("pcb.select", { refs: [{ kind: "footprint", id: "fp-j1" }] }, 2, "s-2"))).toMatchObject({ status: "settled", changed: false, viewRevision: 2 });
    // "This component" at the observed revision resolves to J1.
    expect(await bus.dispatch(env("pcb.focus", { target: { kind: "primary" } }, 2, "th-1"))).toMatchObject({ status: "settled", state: { camera: { centerNm: { x: 5 * MM, y: 5 * MM } } } });
    // A stale revision refuses even though focus is otherwise rebase-safe.
    expect(await bus.dispatch(env("pcb.focus", { target: { kind: "primary" } }, 1, "th-2"))).toMatchObject({ status: "refused", refusal: { code: "VS_STALE_REVISION" } });
    // A captured-context digest that no longer matches refuses.
    expect(await bus.dispatch(env("pcb.focus", { target: { kind: "selection" }, selectionDigest: "sha256:stale00000000" }, 3, "th-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_STALE_REVISION", message: expect.stringContaining("changed since the editor context was captured") } });
    expect(await bus.dispatch(env("pcb.fit-selection", { selectionDigest: digest }, 3, "fs-1"))).toMatchObject({ status: "settled", state: { camera: { centerNm: { x: 5 * MM, y: 5 * MM }, pxPerMm: PCB_FOCUS_MAX_PX_PER_MM } } });
    // Relative selection commands refuse a stale view, then merge/remove on the current one.
    expect(await bus.dispatch(env("pcb.select-add", { refs: [{ kind: "track", id: "t-1" }] }, 3, "a-stale"))).toMatchObject({ status: "refused", refusal: { code: "VS_STALE_REVISION" } });
    const added = await bus.dispatch(env("pcb.select-add", { refs: [{ kind: "track", id: "t-1" }] }, 4, "a-1"));
    expect((added as { state: PcbViewState }).state.selection).toMatchObject({ refs: [{ kind: "footprint", id: "fp-j1" }, { kind: "track", id: "t-1" }], primary: { kind: "track", id: "t-1" } });
    const removed = await bus.dispatch(env("pcb.select-remove", { refs: [{ kind: "track", id: "t-1" }] }, 5, "r-1"));
    expect((removed as { state: PcbViewState }).state.selection).toMatchObject({ refs: [{ kind: "footprint", id: "fp-j1" }], primary: { kind: "footprint", id: "fp-j1" } });
    expect(await bus.dispatch(env("pcb.select", { refs: [{ kind: "via", id: "missing" }] }, 6, "s-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect(await bus.dispatch(env("pcb.select", { target: { kind: "selection" } }, 6, "s-4"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    const net = await bus.dispatch(env("pcb.select-net", { name: "GND" }, 6, "n-1"));
    expect((net as { state: PcbViewState }).state.selection.refs).toEqual(expect.arrayContaining([{ kind: "track", id: "t-1" }, { kind: "pad", footprintId: "fp-j1", padNumber: "1" }]));
    expect(await bus.dispatch(env("pcb.clear-selection", null, 7, "c-1"))).toMatchObject({ status: "settled", state: { selection: { refs: [], primary: null } } });
    // Validation of targets is exact.
    expect(validateViewTarget({ kind: "net" })).toMatchObject({ ok: false });
    expect(validateViewTarget({ kind: "component", ref: "  " })).toMatchObject({ ok: false });
    expect(validateViewTarget({ kind: "object", ref: { kind: "pad", footprintId: "fp-j1", padNumber: "1" } })).toMatchObject({ ok: true });
  });

  it("layers and grid: explicit values rebase, toggles refuse a stale view, inner layers need a 4-layer board, only copper can be active", async () => {
    const bus = makeBus(() => board());
    expect(await bus.dispatch(env("pcb.set-layer-visible", { layer: "silkTop", visible: false }, 0, "l-1"))).toMatchObject({ status: "settled", state: { layers: { visible: { silkTop: false, silkBottom: false, copperTop: true } } } });
    expect(await bus.dispatch(env("pcb.set-layer-visible", { layer: "silkTop", visible: false }, 0, "l-2"))).toMatchObject({ status: "settled", rebased: true, changed: false });
    expect(await bus.dispatch(env("pcb.set-layer-visible", { layer: "in1", visible: true }, 1, "l-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "geometry unavailable: layer in1 does not exist on a 2-layer board" } });
    expect(await bus.dispatch(env("pcb.toggle-layer", { layer: "copperBottom" }, 0, "l-4"))).toMatchObject({ status: "refused", refusal: { code: "VS_STALE_REVISION" } });
    expect(await bus.dispatch(env("pcb.toggle-layer", { layer: "copperBottom" }, 1, "l-5"))).toMatchObject({ status: "settled", state: { layers: { visible: { copperBottom: false } } } });
    expect(await bus.dispatch(env("pcb.set-active-layer", { layer: "silkTop" }, 2, "l-6"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    expect(await bus.dispatch(env("pcb.set-active-layer", { layer: "copperBottom" }, 2, "l-7"))).toMatchObject({ status: "settled", state: { layers: { active: "copperBottom" } } });
    const isolated = await bus.dispatch(env("pcb.isolate-layer", { layer: "copperTop" }, 3, "l-8"));
    const visible = (isolated as { state: PcbViewState }).state.layers.visible;
    expect(Object.entries(visible).filter(([, on]) => on).map(([id]) => id)).toEqual(["copperTop"]);
    const copper = await bus.dispatch(env("pcb.show-copper", null, 4, "l-9"));
    expect((copper as { state: PcbViewState }).state.layers.visible).toMatchObject({ copperTop: true, copperBottom: true, in1: false, in2: false, silkTop: false });
    expect(await bus.dispatch(env("pcb.set-grid", { visible: false }, 5, "g-1"))).toMatchObject({ status: "settled", state: { grid: false } });
    expect(await bus.dispatch(env("pcb.toggle-grid", null, 5, "g-2"))).toMatchObject({ status: "refused", refusal: { code: "VS_STALE_REVISION" } });
    expect(await bus.dispatch(env("pcb.toggle-grid", null, 6, "g-3"))).toMatchObject({ status: "settled", state: { grid: true } });
  });

  it("highlights a net, reveals DRC and routing findings with a bounded focus, measures between stable targets, and never touches the board", async () => {
    const b = board();
    const before = JSON.stringify(b);
    const bus = makeBus(() => b, { drc: DRC, routing: ROUTING });
    await bus.dispatch(env("pcb.observe", { camera: OBSERVED }, 0, "o-1"));
    const highlighted = await bus.dispatch(env("pcb.highlight-net", { netId: 1 }, 1, "h-1"));
    expect((highlighted as { state: PcbViewState }).state.highlight).toMatchObject({ netId: 1, name: "/root/GND", refs: expect.arrayContaining([{ kind: "track", id: "t-1" }]) });
    expect(await bus.dispatch(env("pcb.highlight-net", { name: "NOPE" }, 2, "h-2"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect(await bus.dispatch(env("pcb.clear-highlight", null, 2, "h-3"))).toMatchObject({ status: "settled", state: { highlight: null } });
    const drc = await bus.dispatch(env("pcb.reveal-finding", { findingId: "drc:v1" }, 3, "rv-1"));
    expect(drc).toMatchObject({ status: "settled", state: { camera: { centerNm: { x: 10 * MM, y: 5 * MM }, pxPerMm: PCB_FOCUS_MAX_PX_PER_MM }, reveal: { findingId: "drc:v1", source: "drc", itemIds: ["t-1"], summary: "Clearance 0.10 mm < 0.20 mm", seq: 1 } } });
    const routing = await bus.dispatch(env("pcb.reveal-finding", { findingId: "routing:0" }, 4, "rv-2"));
    expect(routing).toMatchObject({ status: "settled", state: { reveal: { source: "routing", itemIds: ["fp-j1"], seq: 2 } } });
    expect(await bus.dispatch(env("pcb.reveal-finding", { findingId: "drc:missing" }, 5, "rv-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect(await bus.dispatch(env("pcb.reveal-finding", { findingId: "v1" }, 5, "rv-4"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    const measured = await bus.dispatch(env("pcb.measure", { a: { kind: "component", ref: "J1" }, b: { kind: "component", ref: "R1" } }, 5, "m-1"));
    expect(measured).toMatchObject({ status: "settled", state: { measurement: { a: { kind: "component", ref: "J1", atNm: { x: 5 * MM, y: 5 * MM } }, b: { kind: "component", ref: "R1" }, dxNm: 25 * MM, dyNm: 15 * MM, distanceNm: 29_154_759, distanceMm: 29.155 } } });
    expect(await bus.dispatch(env("pcb.measure", { a: { kind: "point", x: 0, y: 0 }, b: { kind: "object", ref: { kind: "track", id: "t-1" } } }, 6, "m-2"))).toMatchObject({ status: "settled", state: { measurement: { b: { kind: "object", atNm: { x: 5 * MM, y: 5 * MM } }, distanceMm: 7.071 } } });
    expect(await bus.dispatch(env("pcb.measure", { a: { kind: "net", name: "GND" }, b: { kind: "component", ref: "R1" } }, 7, "m-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    expect(await bus.dispatch(env("pcb.clear-measurement", null, 7, "m-4"))).toMatchObject({ status: "settled", state: { measurement: null } });
    // The board is untouched: no dimension, no selection, nothing.
    expect(JSON.stringify(b)).toBe(before);
    expect(b.dimensions ?? []).toHaveLength(0);
  });

  it("observe mirrors the editor's own changes and is human-only; read-state reports everything", async () => {
    const bus = makeBus(() => board());
    expect(await bus.dispatch(env("pcb.observe", { selection: { refs: [{ kind: "footprint", id: "fp-r1" }], primary: { kind: "footprint", id: "fp-r1" } } }, 0, "o-agent", AGENT))).toMatchObject({ status: "refused", refusal: { code: "VS_ROLE_FORBIDDEN" } });
    const observed = await bus.dispatch(env("pcb.observe", { selection: { refs: [{ kind: "footprint", id: "fp-r1" }], primary: { kind: "footprint", id: "fp-r1" } }, grid: false, layers: { visible: { ...pcbInitialState().layers.visible, silkTop: false }, active: "copperBottom" } }, 0, "o-1"));
    expect(observed).toMatchObject({ status: "settled", viewRevision: 1, state: { selection: { primary: { kind: "footprint", id: "fp-r1" } }, grid: false, layers: { active: "copperBottom", visible: { silkTop: false } } } });
    expect(await bus.dispatch(env("pcb.observe", { selection: { refs: [{ kind: "footprint", id: "fp-r1" }], primary: { kind: "footprint", id: "fp-r1" } } }, 1, "o-2"))).toMatchObject({ status: "settled", changed: false });
    expect(await bus.dispatch(env("pcb.observe", { camera: { centerNm: { x: 1 }, pxPerMm: 1 } }, 1, "o-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    expect(await bus.dispatch(env("pcb.read-state", null, 0, "rs-1", AGENT))).toMatchObject({ status: "settled", rebased: true, changed: false, state: { selection: { refs: [{ kind: "footprint", id: "fp-r1" }] }, grid: false, camera: { kind: "board", seq: 0 } } });
  });
});
