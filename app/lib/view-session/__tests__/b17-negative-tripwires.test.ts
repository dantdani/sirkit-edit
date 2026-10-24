/**
 * [B17 validation] UI NEGATIVE TRIPWIRES — the runbook's pass criteria that
 * must hold by construction, proven against every registered view command:
 *
 *  1. NO engineering mutation from a view command: every `pcb.*`, `pcb3d.*`,
 *     `schematic.*` and `workspace.*` command — with a representative payload
 *     AND with garbage — leaves the board (revision + content) and the
 *     schematic sources byte-identical. The payload table is EXHAUSTIVE: a new
 *     command that is not in it fails this test.
 *  2. The editor's own mirror (`*.observe`) is human-only: an agent is refused
 *     `VS_ROLE_FORBIDDEN`, and its dispatch changes nothing.
 *  3. A view-session tool in the registry can never carry engineering side
 *     effects or authority, exposed or not.
 */
import { describe, expect, it } from "vitest";
import { createViewCommand, ViewSessionBus } from "../bus";
import { pcbCommands, pcbInitialState, pcbViewProbe, type PcbViewState } from "../pcb";
import { boardGeometryProbe, pcb3dCommands, pcb3dInitialState, type Pcb3dViewState } from "../pcb3d";
import { schematicCommands, schematicInitialState, schematicViewProbe, type SchematicViewState } from "../schematic";
import { workspaceCommands, workspaceInitialState, type WorkspaceViewState } from "../workspace";
import { selectionDigest } from "../targets";
import type { TrustedViewActor, ViewCommandDescriptor, ViewSessionIdentity } from "../types";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import type { DrcResult } from "@/app/lib/pcb/drc/types";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";

const AGENT: TrustedViewActor = { actorId: "agent-1", role: "project_admin", actorKind: "agent" };
const HUMAN: TrustedViewActor = { actorId: "u-1", role: "pcb_editor", actorKind: "human" };
const T0 = "2026-09-10T12:00:00.000Z";
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
const DRC = { violations: [{ id: "v1", kind: "clearance", severity: "error", items: [{ kind: "track", id: "t-1" }], location: { x: 10 * MM, y: 5 * MM }, measuredNm: 100_000, thresholdNm: 200_000, summary: "Clearance", detail: "" }] } as unknown as DrcResult;
const SCHEMATIC_SOURCES = {
  components: [{ id: "c-r1", x: 120, y: 80, refDes: "R1" }],
  kicadComponents: [{ id: "k-u1", x: 300, y: 200, refDes: "U1" }],
  netLabels: [{ id: "n-1", name: "GND", position: { x: 100, y: 100 } }],
  pagePx: { width: 1123, height: 794 },
};

const J1 = { kind: "footprint" as const, id: "fp-j1" };
const REFS = [J1];
const GARBAGE = { nonsense: true, layer: 42, target: "J1", refs: "all", factor: "big" };
/** VALID mirror payloads per editor, so tripwire 2 isolates the ROLE gate (not payload validation). */
const OBSERVE_PAYLOADS: Record<string, unknown> = { "pcb.observe": { grid: true }, "schematic.observe": { selection: { id: null } }, "workspace.observe": { editor: "pcb" } };

/** Representative payloads — EXHAUSTIVE per editor (the test refuses a command that is missing here). */
const PAYLOADS: Record<string, unknown[]> = {
  "pcb.fit-board": [null], "pcb.fit-selection": [{}, { selectionDigest: selectionDigest(REFS, J1) }],
  "pcb.zoom": [{ factor: 2 }], "pcb.zoom-to": [{ pxPerMm: 20 }],
  "pcb.pan-to": [{ target: { kind: "component", ref: "J1" } }, { target: { kind: "point", x: 1 * MM, y: 1 * MM } }],
  "pcb.focus": [{ target: { kind: "component", ref: "J1" } }, { target: { kind: "net", netId: 1 } }, { target: { kind: "primary" } }],
  "pcb.select": [{ refs: REFS }, { target: { kind: "component", ref: "R1" } }], "pcb.select-add": [{ refs: [{ kind: "track", id: "t-1" }] }], "pcb.select-remove": [{ refs: REFS }],
  "pcb.clear-selection": [null], "pcb.select-net": [{ netId: 1 }, { name: "/root/VCC" }],
  "pcb.set-layer-visible": [{ layer: "silkTop", visible: false }], "pcb.toggle-layer": [{ layer: "silkTop" }], "pcb.set-active-layer": [{ layer: "copperBottom" }], "pcb.isolate-layer": [{ layer: "copperTop" }],
  "pcb.show-copper": [null], "pcb.set-grid": [{ visible: false }], "pcb.toggle-grid": [null],
  "pcb.highlight-net": [{ netId: 1 }], "pcb.clear-highlight": [null], "pcb.reveal-finding": [{ findingId: "drc:v1" }, { findingId: "drc:nope" }],
  "pcb.measure": [{ a: { kind: "component", ref: "J1" }, b: { kind: "component", ref: "R1" } }, { a: { kind: "point", x: 0, y: 0 }, b: { kind: "object", ref: { kind: "track", id: "t-1" } } }],
  "pcb.clear-measurement": [null], "pcb.read-state": [null],
  "pcb3d.open": [null], "pcb3d.close": [null], "pcb3d.camera-preset": [{ preset: "top" }, { preset: "iso" }], "pcb3d.fit-board": [null], "pcb3d.reset-camera": [null],
  "pcb3d.focus-component": [{ ref: "J1" }, { ref: "U9" }], "pcb3d.focus-selection": [{ refs: REFS }, { refs: [] }], "pcb3d.focus-net": [{ netId: 1 }, { name: "/root/VCC" }],
  "pcb3d.set-layer-visible": [{ layer: "silkTop", visible: false }], "pcb3d.toggle-layer": [{ layer: "copper" }], "pcb3d.set-finish": [{ finish: "green-hasl" }], "pcb3d.read-state": [null],
  "schematic.fit-page": [null], "schematic.zoom": [{ factor: 1.5 }], "schematic.zoom-to": [{ zoom: 2 }],
  "schematic.pan-to": [{ target: { kind: "component", ref: "R1" } }], "schematic.focus": [{ target: { kind: "component", ref: "U1" } }, { target: { kind: "net", name: "GND" } }],
  "schematic.select": [{ target: { kind: "component", ref: "R1" } }], "schematic.clear-selection": [null], "schematic.highlight-net": [{ name: "GND" }], "schematic.clear-highlight": [null],
  "schematic.reveal-finding": [{ findingId: "erc:1" }], "schematic.read-state": [null], "schematic.open-sheet": [{ sheet: "root" }, { sheet: "Power" }], // [PR-J5, 2026-10-23] + the open-sheet view command (runbook J.6.5): a sheet by id and by name; with these sources (no navigator wired) it answers VS_UNAVAILABLE and changes nothing
  "workspace.open-editor": [{ editor: "pcb" }, { editor: "schematic" }], "workspace.read-state": [null],
};

interface Surface<State> { identity: ViewSessionIdentity; bus: ViewSessionBus<State>; commands: ViewCommandDescriptor<State, never>[] }
function surfaces(b: PcbBoard) {
  const id = (editor: ViewSessionIdentity["editor"]): ViewSessionIdentity => ({ sessionId: `vs-${editor}`, projectId: "proj-1", branchId: "main", editor });
  const pcb = pcbCommands(() => pcbViewProbe({ board: b, drc: DRC, routingFailures: null }));
  const pcb3d = pcb3dCommands(() => boardGeometryProbe(b));
  const schematic = schematicCommands(() => schematicViewProbe(SCHEMATIC_SOURCES));
  const workspace = workspaceCommands(() => ["schematic", "pcb"]);
  return [
    { identity: id("pcb"), bus: new ViewSessionBus<PcbViewState>({ identity: id("pcb"), initialState: pcbInitialState(), commands: pcb, clock: () => T0 }), commands: pcb } as Surface<PcbViewState>,
    { identity: id("pcb3d"), bus: new ViewSessionBus<Pcb3dViewState>({ identity: id("pcb3d"), initialState: pcb3dInitialState(), commands: pcb3d, clock: () => T0 }), commands: pcb3d } as Surface<Pcb3dViewState>,
    { identity: id("schematic"), bus: new ViewSessionBus<SchematicViewState>({ identity: id("schematic"), initialState: schematicInitialState(), commands: schematic, clock: () => T0 }), commands: schematic } as Surface<SchematicViewState>,
    { identity: id("workspace"), bus: new ViewSessionBus<WorkspaceViewState>({ identity: id("workspace"), initialState: workspaceInitialState("schematic"), commands: workspace, clock: () => T0 }), commands: workspace } as Surface<WorkspaceViewState>,
  ] as Array<Surface<unknown>>;
}

describe("B17 validation — UI negative tripwires", () => {
  it("1. no engineering mutation from ANY view command: every registered command, with representative and garbage payloads, as the agent and as the human, leaves the board and the schematic sources byte-identical", async () => {
    const b = board();
    const boardBefore = JSON.stringify(b);
    const revisionBefore = pcbRevisionId(b);
    const sourcesBefore = JSON.stringify(SCHEMATIC_SOURCES);
    const registered = new Set<string>();
    let dispatched = 0;
    let settled = 0;
    for (const surface of surfaces(b)) {
      for (const command of surface.commands) {
        registered.add(command.commandId);
        if (command.commandId.endsWith(".observe")) continue; // tripwire 2
        const payloads = PAYLOADS[command.commandId];
        expect(payloads, `${command.commandId} has no representative payload — add it to the EXHAUSTIVE table`).toBeDefined();
        for (const actor of [AGENT, HUMAN]) {
          for (const payload of [...payloads!, GARBAGE, null, "string", 7]) {
            const envelope = createViewCommand({ identity: surface.identity, commandId: command.commandId, payload, actor, expectedViewRevision: surface.bus.viewRevision, issuedAt: T0 });
            const result = await surface.bus.dispatch(envelope);
            expect(["settled", "refused"], `${command.commandId} ${JSON.stringify(payload)}`).toContain(result.status);
            if (result.status === "settled") settled += 1;
            // A refusal may only be a payload / unavailable / stale / role verdict — never an infrastructure refusal
            // (expiry, scope, retirement, unknown command, handler failure), which would make this tripwire vacuous.
            else if (result.status === "refused") expect(["VS_PAYLOAD_INVALID", "VS_UNAVAILABLE", "VS_STALE_REVISION", "VS_ROLE_FORBIDDEN"], `${command.commandId} ${JSON.stringify(payload)}`).toContain(result.refusal.code);
            dispatched += 1;
          }
        }
      }
    }
    // Derived from the SAME table: every non-observe command × (its representative payloads + 4 garbage variants) × 2 actors.
    const expectedDispatches = [...registered].filter((id) => !id.endsWith(".observe")).reduce((sum, id) => sum + (PAYLOADS[id]!.length + 4) * 2, 0);
    expect(dispatched).toBe(expectedDispatches);
    expect(dispatched).toBeGreaterThan(400);
    expect(settled).toBeGreaterThan(150); // the representative payloads DO settle (the board still does not change)
    // The table names ONLY registered commands (a stale entry is as much a defect as a missing one).
    for (const commandId of Object.keys(PAYLOADS)) expect(registered.has(commandId), `${commandId} is in the table but not registered`).toBe(true);
    expect(JSON.stringify(b)).toBe(boardBefore);
    expect(pcbRevisionId(b)).toBe(revisionBefore);
    expect(JSON.stringify(SCHEMATIC_SOURCES)).toBe(sourcesBefore);
  });

  it("2. the editor's own mirror (*.observe) is human-only: an agent is refused VS_ROLE_FORBIDDEN and nothing changes; every editor with a mirror has exactly one", async () => {
    const b = board();
    let mirrors = 0;
    for (const surface of surfaces(b)) {
      const observes = surface.commands.filter((command) => command.commandId.endsWith(".observe"));
      expect(observes.length, surface.identity.editor).toBeLessThanOrEqual(1);
      for (const command of observes) {
        mirrors += 1;
        const before = surface.bus.viewRevision;
        expect(OBSERVE_PAYLOADS[command.commandId], command.commandId).toBeDefined();
        const result = await surface.bus.dispatch(createViewCommand({ identity: surface.identity, commandId: command.commandId, payload: OBSERVE_PAYLOADS[command.commandId], actor: AGENT, expectedViewRevision: before, issuedAt: T0 }));
        expect(result.status).toBe("refused");
        if (result.status === "refused") expect(result.refusal.code).toBe("VS_ROLE_FORBIDDEN");
        expect(surface.bus.viewRevision).toBe(before);
      }
    }
    expect(mirrors).toBe(3); // pcb, schematic, workspace (the 3D view has no human mirror: every 3D change is a command)
  });

  it("3. no view-session tool in the registry carries engineering side effects, authority, an approval tier or a mutation binding — exposed or not", () => {
    const viewTools = sirkitToolRegistry().list().filter((descriptor) => descriptor.operationClass === "view-session");
    expect(viewTools.length).toBeGreaterThan(0);
    for (const descriptor of viewTools) {
      expect(descriptor.sideEffects, descriptor.toolId).toBe("session-state");
      expect(descriptor.requiredAuthority, descriptor.toolId).toEqual(["none"]);
      expect(descriptor.approvalTier, descriptor.toolId).toBe("none");
      expect(["unbound", "bound-view-session"], descriptor.toolId).toContain(descriptor.binding.status);
      expect(descriptor.requiresExpectedRevision, descriptor.toolId).toBe(false);
      expect(descriptor.requiresLineage, descriptor.toolId).toBe(false);
    }
  });
});
