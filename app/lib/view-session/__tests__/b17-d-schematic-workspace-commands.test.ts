/**
 * [B17-D] The schematic and workspace command sets on the view-session bus:
 * fit/zoom/pan/focus on the sheet, select by reference designator or id,
 * "this component" from the versioned selection, net-label highlight, the
 * honest ERC answer (no findings are produced), editor-only observation,
 * and workspace tab commands.
 */
import { describe, expect, it } from "vitest";
import { createViewCommand, ViewSessionBus } from "../bus";
import { schematicCommands, schematicInitialState, schematicSelection, schematicViewProbe, SCHEMATIC_FOCUS_ZOOM, type SchematicProbeSources, type SchematicViewState } from "../schematic";
import { workspaceCommands, workspaceInitialState, type WorkspaceTab, type WorkspaceViewState } from "../workspace";
import type { TrustedViewActor, ViewCommandEnvelope, ViewSessionIdentity } from "../types";

const HUMAN: TrustedViewActor = { actorId: "u-1", role: "pcb_editor", actorKind: "human" };
const AGENT: TrustedViewActor = { actorId: "agent-1", role: "pcb_editor", actorKind: "agent" };
const T0 = "2026-09-09T12:00:00.000Z";

const SHEET: SchematicProbeSources = {
  components: [{ id: "c-r1", x: 100, y: 200, refDes: "R1" }, { id: "legacy-C1", x: 500, y: 600 }],
  kicadComponents: [{ id: "k-u1", x: 300, y: 400, refDes: "U1" }],
  netLabels: [{ id: "l1", name: "GND", position: { x: 1, y: 2 } }, { id: "l2", name: "gnd", position: { x: 3, y: 4 } }, { id: "l3", name: "VCC", position: { x: 5, y: 6 } }],
  pagePx: { width: 1123, height: 794 },
};

function env(identity: ViewSessionIdentity, commandId: string, payload: unknown, rev: number, id: string, actor: TrustedViewActor = HUMAN): ViewCommandEnvelope {
  return createViewCommand({ identity, commandId, payload, actor, expectedViewRevision: rev, issuedAt: T0, invocationId: id });
}

describe("B17-D — schematic view commands", () => {
  const IDENTITY: ViewSessionIdentity = { sessionId: "vs-sch", projectId: "proj-1", branchId: "main", editor: "schematic" };
  const makeBus = (current: () => SchematicProbeSources | null) => new ViewSessionBus<SchematicViewState>({ identity: IDENTITY, initialState: schematicInitialState(), commands: schematicCommands(() => schematicViewProbe(current())), clock: () => T0 });
  const e = (commandId: string, payload: unknown, rev: number, id: string, actor?: TrustedViewActor) => env(IDENTITY, commandId, payload, rev, id, actor);
  const OBSERVED = { pan: { x: 0, y: 0 }, zoom: 1, viewportPx: { width: 800, height: 600 } };

  it("fit, zoom and pan/focus by reference designator (case-insensitive), id or sheet point; bounded refusals without a sheet", async () => {
    let current: SchematicProbeSources | null = null;
    const bus = makeBus(() => current);
    expect(bus.describeCommands().map((c) => c.commandId)).toEqual(["schematic.clear-highlight", "schematic.clear-selection", "schematic.fit-page", "schematic.focus", "schematic.highlight-net", "schematic.observe", "schematic.pan-to", "schematic.read-state", "schematic.reveal-finding", "schematic.select", "schematic.zoom", "schematic.zoom-to"]);
    expect(await bus.dispatch(e("schematic.fit-page", null, 0, "f-0"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "sheet unavailable: no sheet is open" } });
    current = SHEET;
    expect(await bus.dispatch(e("schematic.fit-page", null, 0, "f-1"))).toMatchObject({ status: "settled", state: { camera: { kind: "page", seq: 1 } } });
    expect(await bus.dispatch(e("schematic.zoom", { factor: 2 }, 1, "z-0"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    await bus.dispatch(e("schematic.observe", { camera: OBSERVED }, 1, "o-1"));
    expect(await bus.dispatch(e("schematic.zoom", { factor: 2 }, 2, "z-1"))).toMatchObject({ status: "settled", state: { camera: { kind: "custom", centerPx: { x: 400, y: 300 }, zoom: 2, seq: 2 } } });
    expect(await bus.dispatch(e("schematic.zoom", { factor: 2 }, 2, "z-2"))).toMatchObject({ status: "refused", refusal: { code: "VS_STALE_REVISION" } });
    expect(await bus.dispatch(e("schematic.zoom-to", { zoom: 99 }, 3, "z-3"))).toMatchObject({ status: "settled", state: { camera: { zoom: 4, seq: 3 } } });
    expect(await bus.dispatch(e("schematic.pan-to", { target: { kind: "component", ref: "u1" } }, 4, "p-1"))).toMatchObject({ status: "settled", state: { camera: { kind: "custom", centerPx: { x: 300, y: 400 }, zoom: null, seq: 4 } } });
    expect(await bus.dispatch(e("schematic.focus", { target: { kind: "component", ref: "legacy-C1" } }, 5, "p-2"))).toMatchObject({ status: "settled", state: { camera: { centerPx: { x: 500, y: 600 }, zoom: SCHEMATIC_FOCUS_ZOOM, seq: 5 } } });
    expect(await bus.dispatch(e("schematic.focus", { target: { kind: "point", x: 10, y: 20 } }, 6, "p-3"))).toMatchObject({ status: "settled", state: { camera: { centerPx: { x: 10, y: 20 } } } });
    expect(await bus.dispatch(e("schematic.focus", { target: { kind: "component", ref: "Q9" } }, 7, "p-4"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "sheet unavailable: component Q9 is not on the sheet" } });
    expect(await bus.dispatch(e("schematic.focus", { target: { kind: "object", ref: { kind: "track", id: "t" } } }, 7, "p-5"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
  });

  it("selection is versioned: select by refdes, 'this component' refuses stale or absent selection, observe is human-only, highlight by net label, ERC is honestly unavailable", async () => {
    const bus = makeBus(() => SHEET);
    await bus.dispatch(e("schematic.observe", { camera: OBSERVED }, 0, "o-1"));
    expect(await bus.dispatch(e("schematic.focus", { target: { kind: "primary" } }, 1, "th-0"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: expect.stringContaining("'this component' cannot be resolved") } });
    const selected = await bus.dispatch(e("schematic.select", { target: { kind: "component", ref: "R1" } }, 1, "s-1"));
    expect(selected).toMatchObject({ status: "settled", viewRevision: 2, state: { selection: { id: "c-r1", family: "theory", refdes: "R1", digest: schematicSelection("c-r1", "theory", "R1").digest } } });
    expect(await bus.dispatch(e("schematic.focus", { target: { kind: "primary" } }, 2, "th-1"))).toMatchObject({ status: "settled", state: { camera: { centerPx: { x: 100, y: 200 }, zoom: SCHEMATIC_FOCUS_ZOOM } } });
    expect(await bus.dispatch(e("schematic.focus", { target: { kind: "primary" } }, 1, "th-2"))).toMatchObject({ status: "refused", refusal: { code: "VS_STALE_REVISION" } });
    expect(await bus.dispatch(e("schematic.pan-to", { target: { kind: "selection" }, selectionDigest: "stale" }, 3, "th-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_STALE_REVISION" } });
    expect(await bus.dispatch(e("schematic.select", { target: { kind: "primary" } }, 3, "s-2"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    expect(await bus.dispatch(e("schematic.select", { target: { kind: "component", ref: "Q9" } }, 3, "s-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    // The human clicked U1 on the canvas: the editor mirrors it; an agent may not.
    expect(await bus.dispatch(e("schematic.observe", { selection: { id: "k-u1" } }, 3, "o-agent", AGENT))).toMatchObject({ status: "refused", refusal: { code: "VS_ROLE_FORBIDDEN" } });
    expect(await bus.dispatch(e("schematic.observe", { selection: { id: "k-u1" } }, 3, "o-2"))).toMatchObject({ status: "settled", state: { selection: { id: "k-u1", family: "kicad", refdes: "U1" } } });
    expect(await bus.dispatch(e("schematic.clear-selection", null, 4, "c-1"))).toMatchObject({ status: "settled", state: { selection: { id: null, family: null } } });
    expect(await bus.dispatch(e("schematic.highlight-net", { name: "gnd" }, 5, "h-1"))).toMatchObject({ status: "settled", state: { highlight: { name: "GND", labelIds: ["l1", "l2"] } } });
    expect(await bus.dispatch(e("schematic.highlight-net", { name: "MOSI" }, 6, "h-2"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect(await bus.dispatch(e("schematic.clear-highlight", null, 6, "h-3"))).toMatchObject({ status: "settled", state: { highlight: null } });
    expect(await bus.dispatch(e("schematic.reveal-finding", { findingId: "erc-1" }, 7, "rv-1"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "sheet unavailable: no ERC findings are produced by the schematic editor; erc-1 cannot be revealed" } });
    expect(await bus.dispatch(e("schematic.read-state", null, 0, "rs-1", AGENT))).toMatchObject({ status: "settled", rebased: true, state: { selection: { id: null }, observed: OBSERVED } });
  });
});

describe("B17-D — workspace view commands", () => {
  const IDENTITY: ViewSessionIdentity = { sessionId: "vs-ws", projectId: "proj-1", branchId: "main", editor: "workspace" };
  const e = (commandId: string, payload: unknown, rev: number, id: string, actor?: TrustedViewActor) => env(IDENTITY, commandId, payload, rev, id, actor);

  it("opens an available editor tab, reports the state, refuses unknown or unavailable tabs, and observe is human-only", async () => {
    let available: WorkspaceTab[] = ["schematic", "pcb", "3d", "bom", "sim"];
    const bus = new ViewSessionBus<WorkspaceViewState>({ identity: IDENTITY, initialState: workspaceInitialState(), commands: workspaceCommands(() => available), clock: () => T0 });
    expect(bus.describeCommands().map((c) => c.commandId)).toEqual(["workspace.observe", "workspace.open-editor", "workspace.read-state"]);
    expect(await bus.dispatch(e("workspace.open-editor", { editor: "pcb" }, 0, "w-1"))).toMatchObject({ status: "settled", viewRevision: 1, state: { tab: "pcb", seq: 1 } });
    expect(await bus.dispatch(e("workspace.open-editor", { editor: "pcb" }, 1, "w-2"))).toMatchObject({ status: "settled", changed: false });
    expect(await bus.dispatch(e("workspace.open-editor", { editor: "spice" }, 1, "w-3"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    available = ["schematic", "pcb"];
    expect(await bus.dispatch(e("workspace.open-editor", { editor: "sim" }, 1, "w-4"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "the sim editor is not available in this workspace" } });
    expect(await bus.dispatch(e("workspace.observe", { editor: "schematic" }, 1, "w-5", AGENT))).toMatchObject({ status: "refused", refusal: { code: "VS_ROLE_FORBIDDEN" } });
    expect(await bus.dispatch(e("workspace.observe", { editor: "schematic" }, 1, "w-6"))).toMatchObject({ status: "settled", state: { tab: "schematic", seq: 1 } });
    expect(await bus.dispatch(e("workspace.read-state", null, 0, "w-7", AGENT))).toMatchObject({ status: "settled", rebased: true, state: { tab: "schematic" } });
  });
});
