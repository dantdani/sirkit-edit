/**
 * [B17-F] The browser half: the page-owned view-session bridge captures the
 * live surfaces as ONE bounded view context and executes server-validated
 * requests on the editor's OWN bus (exact parse, expiry, live surface, same
 * session, the bus's stale-revision rule and single settlement).
 */
import { describe, expect, it } from "vitest";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { ProjectOperationTimeline } from "@/app/lib/project/operation-timeline";
import { ViewSessionBus } from "@/app/lib/view-session/bus";
import { boardGeometryProbe, pcb3dCommands, pcb3dInitialState, type Pcb3dViewState } from "@/app/lib/view-session/pcb3d";
import type { ViewSessionIdentity } from "@/app/lib/view-session/types";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { STAGE10_SCHEMA_VERSION, type CanonicalProjectState } from "@/app/lib/engineering/types";
import { boundedViewState, ViewSessionBridge } from "../view-session-bridge";
import { prepareViewCommandRequest, type ViewCommandRequest } from "../view-context";

const T0 = "2026-09-10T12:00:00.000Z";
const NOW = Date.parse(T0);
function board(): PcbBoard {
  const def = makeResistorDef();
  return makeBoard(40, 30, [makeInstance("r1", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("r2", def, { x: 30, y: 22 }, { "1": 1, "2": 0 })], 2);
}
const identity: ViewSessionIdentity = { sessionId: "vs-t-3d", projectId: "p", branchId: "main", editor: "pcb3d" };

function setup() {
  const bus = new ViewSessionBus<Pcb3dViewState>({ identity, initialState: pcb3dInitialState(), commands: pcb3dCommands(() => boardGeometryProbe(board())), clock: () => T0 });
  const bridge = new ViewSessionBridge();
  let live = true;
  const retire = bridge.register({ identity, isCurrent: () => live, viewRevision: () => bus.viewRevision, state: () => bus.getState(), dispatch: (envelope) => bus.dispatch(envelope) });
  const canonicalState: CanonicalProjectState = { schemaVersion: STAGE10_SCHEMA_VERSION, tenantId: "local", projectId: "p", branchId: "main", pcb: board(), pinnedAssets: [] };
  const prepare = (args: Record<string, unknown>): ViewCommandRequest => {
    const view = bridge.capture();
    const prepared = prepareViewCommandRequest({ descriptor: sirkitToolRegistry().get("sirkit.view.pcb3d", "1.0.0")!, args, context: { canonicalState, view, actor: { actorId: "agent:t", role: "project_admin", actorKind: "agent" }, runId: "run-t", now: () => NOW } });
    if (!prepared.ok) throw new Error(prepared.diagnostics.join("; "));
    return prepared.request;
  };
  return { bus, bridge, prepare, retire: () => { live = false; retire(); } };
}

describe("B17-F — the view-session bridge", () => {
  it("captures the live surfaces as one bounded view context, including the project timeline", () => {
    const { bridge } = setup();
    const timeline = new ProjectOperationTimeline();
    timeline.record({ store: "pcb", kind: "commit", label: "Move R1", actor: "human", head: { store: "pcb", historyId: "h1", headSequence: 1, entryCount: 1 } });
    const view = bridge.capture(timeline);
    expect(view).toMatchObject({ schema: "sirkit.view-context.v1", surfaces: ["pcb3d"], editors: { pcb3d: { editor: "pcb3d", sessionId: "vs-t-3d", viewRevision: 0, state: { open: false } } } });
    expect(view?.timeline?.entries.map((entry) => entry.label)).toEqual(["Move R1"]);
    expect(view?.timeline?.eligibleUndo).toMatchObject({ operation: { label: "Move R1" } });
    expect(new ViewSessionBridge().capture()).toBeNull();
  });

  it("executes a validated request on the bus as the agent actor; a replay of the same request settles once; a stale relative request is refused by the bus", async () => {
    const { bus, bridge, prepare } = setup();
    const open = prepare({ action: "open" });
    expect(open).toMatchObject({ editor: "pcb3d", commandId: "pcb3d.open", expectedViewRevision: 0, actor: { actorKind: "agent" } });
    const first = await bridge.execute(open, NOW);
    expect(first).toMatchObject({ ok: true, status: "settled", commandId: "pcb3d.open", changed: true, viewRevision: 1 });
    expect(bus.getState().open).toBe(true);
    const replay = await bridge.execute(JSON.parse(JSON.stringify(open)), NOW);
    expect(replay).toMatchObject({ ok: true, status: "settled", viewRevision: 1 }); // single settlement — not executed twice
    expect(bus.viewRevision).toBe(1);
    // A relative toggle prepared against the OLD capture refuses as stale (the bus's own rule).
    const stale: ViewCommandRequest = { ...prepare({ action: "toggle-layer", layer: "silkTop" }), expectedViewRevision: 0, requestId: "vcr-stale-0000000000" };
    const refused = await bridge.execute(stale, NOW);
    expect(refused).toMatchObject({ ok: false, status: "refused" });
    if (refused.ok) throw new Error("expected a refusal");
    expect(refused.code).toMatch(/STALE/);
    expect(bus.getState().layers.silkTop).toBe(true);
    // The same toggle against the CURRENT revision settles.
    const fresh = await bridge.execute(prepare({ action: "toggle-layer", layer: "silkTop" }), NOW);
    expect(fresh).toMatchObject({ ok: true, status: "settled" });
    expect(bus.getState().layers.silkTop).toBe(false);
  });

  it("an expired, foreign-session, malformed or surface-less request is dropped without touching the bus", async () => {
    const { bus, bridge, prepare, retire } = setup();
    const open = prepare({ action: "open" });
    expect(await bridge.execute({ ...open, requestId: "vcr-exp-000000000000", expiresAt: new Date(NOW - 1).toISOString() }, NOW)).toMatchObject({ ok: false, status: "expired" });
    expect(await bridge.execute({ ...open, requestId: "vcr-sess-00000000000", sessionId: "vs-other" }, NOW)).toMatchObject({ ok: false, status: "session_mismatch" });
    expect(await bridge.execute({ ...open, actor: { ...open.actor, actorKind: "human" } }, NOW)).toMatchObject({ ok: false, status: "malformed" });
    expect(await bridge.execute({ ...open, commandId: "pcb3d.observe" }, NOW)).toMatchObject({ ok: false, status: "malformed" });
    expect(await bridge.execute({ hello: "world" }, NOW)).toMatchObject({ ok: false, status: "malformed" });
    expect(bus.viewRevision).toBe(0);
    retire();
    expect(bridge.capture()).toBeNull();
    expect(await bridge.execute(open, NOW)).toMatchObject({ ok: false, status: "surface_unavailable" });
    expect(bus.getState().open).toBe(false);
  });

  it("bounds the captured state: long arrays become counts, long strings are cut, deep trees are pruned, functions are dropped", () => {
    const bounded = boundedViewState({ refs: Array.from({ length: 40 }, (_, index) => ({ id: `r${index}` })), label: "x".repeat(500), fn: () => 1, deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } }) as Record<string, unknown>;
    expect(bounded.refs).toMatchObject({ truncated: true, count: 40 });
    expect((bounded.label as string).length).toBeLessThanOrEqual(201);
    expect("fn" in bounded).toBe(false);
    expect(JSON.stringify(bounded)).toContain("[pruned]");
  });
});
