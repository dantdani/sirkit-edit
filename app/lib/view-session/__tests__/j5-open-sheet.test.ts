/**
 * [PR-J5, 2026-10-23] Runbook J.6.5 / J.6.6 (OD-259): the `schematic.open-sheet` view command on the view-session bus and its agent
 * route through `sirkit.view.canvas-navigation` 1.2.0 (action `open-sheet`).
 *
 *  1. by id, by unique display name (case-insensitive) and by path the command settles and the probe's openSheet is asked exactly once
 *     with the sheet's id; the view state is untouched (navigation is view state the editor's navigator owns);
 *  2. a name two sheets share is refused with the candidates (never a guessed target); an unknown sheet lists the sheets; an editor
 *     without a navigator is unavailable; a navigator that cannot open is unavailable; a bad payload is VS_PAYLOAD_INVALID;
 *     [PR-J5 integration, 2026-10-23] review J5R-AI-4: the resolution is tiered - the id, then an exact path (unique), then a unique
 *     name - so a top-level sheet whose name a nested sheet shares opens by its path (it was refused, and the refusal's advice "open one
 *     by its id or its path" named the very string just refused); a name only nested sheets share is still refused, and its advice works;
 *  3. an agent actor may issue it (a view command, never engineering state);
 *  4. view-context maps action open-sheet onto the command for the schematic editor only; the descriptor lists the bus command and
 *     the action; the registry validates the descriptor.
 */
import { describe, expect, it, vi } from "vitest";
import { createViewCommand, ViewSessionBus } from "../bus";
import { schematicCommands, schematicInitialState, schematicViewProbe, type SchematicProbeSources, type SchematicViewState } from "../schematic";
import type { TrustedViewActor, ViewCommandEnvelope, ViewSessionIdentity } from "../types";
import { viewCommandFor } from "@/app/lib/agent/view-context";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";

const HUMAN: TrustedViewActor = { actorId: "u-1", role: "pcb_editor", actorKind: "human" };
const AGENT: TrustedViewActor = { actorId: "agent-1", role: "pcb_editor", actorKind: "agent" };
const T0 = "2026-10-23T12:00:00.000Z";
const IDENTITY: ViewSessionIdentity = { sessionId: "vs-sch", projectId: "proj-1", branchId: "main", editor: "schematic" };
const env = (commandId: string, payload: unknown, rev: number, id: string, actor: TrustedViewActor = HUMAN): ViewCommandEnvelope => createViewCommand({ identity: IDENTITY, commandId, payload, actor, expectedViewRevision: rev, issuedAt: T0, invocationId: id });

function sources(openSheet: (id: string) => boolean, withSheets = true): SchematicProbeSources {
  return {
    components: [], kicadComponents: [{ id: "k-u1", x: 300, y: 400, refDes: "U1" }], netLabels: [], pagePx: { width: 1123, height: 794 },
    ...(withSheets ? { sheets: [{ id: "root", name: "Overview", path: "" }, { id: "sheet-power", name: "Power", path: "Power" }, { id: "sheet-stage-a", name: "Stage", path: "Stage" }, { id: "sheet-stage-b", name: "Stage", path: "Power/Stage" }], openSheet } : {}),
  };
}
const bus = (current: SchematicProbeSources | null) => new ViewSessionBus<SchematicViewState>({ identity: IDENTITY, initialState: schematicInitialState(), commands: schematicCommands(() => schematicViewProbe(current)), clock: () => T0 });

describe("[PR-J5] schematic.open-sheet", () => {
  it("1. opens by id, unique name (case-insensitive) and path through the probe; the view state is untouched", async () => {
    const openSheet = vi.fn(() => true);
    const b = bus(sources(openSheet));
    const before = JSON.stringify(b.describeCommands().find((c) => c.commandId === "schematic.open-sheet"));
    expect(before).toContain("Open a schematic sheet");
    const byId = await b.dispatch(env("schematic.open-sheet", { sheet: "sheet-power" }, 0, "o-1"));
    expect(byId).toMatchObject({ status: "settled" });
    const byName = await b.dispatch(env("schematic.open-sheet", { sheet: "  power " }, byId.viewRevision, "o-2"));
    expect(byName).toMatchObject({ status: "settled" });
    const byPath = await b.dispatch(env("schematic.open-sheet", { sheet: "Power/Stage" }, byName.viewRevision, "o-3"));
    expect(byPath).toMatchObject({ status: "settled" });
    expect(openSheet.mock.calls).toEqual([["sheet-power"], ["sheet-power"], ["sheet-stage-b"]]);
    expect((byPath as { state: SchematicViewState }).state).toEqual(schematicInitialState());
  });

  it("2. refusals: a shared name lists the candidates, an unknown sheet lists the sheets, no navigator and a failed open are unavailable, a bad payload is invalid", async () => {
    const openSheet = vi.fn(() => true);
    const b = bus(sources(openSheet));
    // [PR-J5 integration, 2026-10-23] pin move (review J5R-AI-4; was: {sheet: "Stage"} refused "Stage names 2 sheets ... open one by its id or
    // its path" although "Stage" IS sheet-stage-a's path): the exact-path tier opens the top-level sheet; the nested one by its own path
    const topLevel = await b.dispatch(env("schematic.open-sheet", { sheet: "Stage" }, 0, "o-0"));
    expect(topLevel).toMatchObject({ status: "settled" });
    expect(openSheet.mock.calls).toEqual([["sheet-stage-a"]]);
    openSheet.mockClear();
    // a name ONLY nested sheets share is refused with the candidates, and the advice works: each opens by its path
    const nested = bus({ ...sources(openSheet), sheets: [{ id: "root", name: "Overview", path: "" }, { id: "sheet-power", name: "Power", path: "Power" }, { id: "sheet-motors", name: "Motors", path: "Motors" }, { id: "sheet-power-stage", name: "Stage", path: "Power/Stage" }, { id: "sheet-motor-stage", name: "Stage", path: "Motors/Stage" }] });
    const shared = await nested.dispatch(env("schematic.open-sheet", { sheet: "Stage" }, 0, "o-1"));
    expect(shared).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect((shared as { refusal: { message: string } }).refusal.message).toContain("Stage names 2 sheets");
    expect((shared as { refusal: { message: string } }).refusal.message).toContain("Power/Stage [sheet-power-stage]");
    expect((shared as { refusal: { message: string } }).refusal.message).toContain("Motors/Stage [sheet-motor-stage]");
    expect(openSheet).not.toHaveBeenCalled();
    expect(await nested.dispatch(env("schematic.open-sheet", { sheet: "motors/stage" }, 0, "o-1b"))).toMatchObject({ status: "settled" });
    expect(openSheet.mock.calls).toEqual([["sheet-motor-stage"]]);
    openSheet.mockClear();
    const unknown = await b.dispatch(env("schematic.open-sheet", { sheet: "Radio" }, 0, "o-2"));
    expect(unknown).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect((unknown as { refusal: { message: string } }).refusal.message).toContain("Power [sheet-power]");
    expect(openSheet).not.toHaveBeenCalled();
    const none = await bus(sources(openSheet, false)).dispatch(env("schematic.open-sheet", { sheet: "Power" }, 0, "o-3"));
    expect(none).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect((none as { refusal: { message: string } }).refusal.message).toContain("lists no sheets");
    const failed = await bus(sources(() => false)).dispatch(env("schematic.open-sheet", { sheet: "Power" }, 0, "o-4"));
    expect(failed).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "sheet unavailable: sheet sheet-power could not be opened" } });
    expect(await b.dispatch(env("schematic.open-sheet", { sheet: "" }, 0, "o-5"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    expect(await b.dispatch(env("schematic.open-sheet", null, 0, "o-6"))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    expect(await bus(null).dispatch(env("schematic.open-sheet", { sheet: "Power" }, 0, "o-7"))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
  });

  it("3. an agent actor may open a sheet (view state only)", async () => {
    const openSheet = vi.fn(() => true);
    expect(await bus(sources(openSheet)).dispatch(env("schematic.open-sheet", { sheet: "sheet-power" }, 0, "a-1", AGENT))).toMatchObject({ status: "settled" });
    expect(openSheet).toHaveBeenCalledWith("sheet-power");
  });

  it("4. the agent route: canvas-navigation 1.2.0 maps open-sheet onto the command for the schematic editor only and lists the bus command", () => {
    expect(viewCommandFor("sirkit.view.canvas-navigation", { editor: "schematic", action: "open-sheet", sheet: "Power" })).toEqual({ editor: "schematic", commandId: "schematic.open-sheet", payload: { sheet: "Power" } });
    expect(viewCommandFor("sirkit.view.canvas-navigation", { editor: "pcb", action: "open-sheet", sheet: "Power" })).toBeNull();
    expect(viewCommandFor("sirkit.view.canvas-navigation", { editor: "workspace", action: "open-sheet", sheet: "Power" })).toBeNull();
    const descriptor = sirkitToolRegistry().get("sirkit.view.canvas-navigation")!;
    expect(descriptor.version).toBe("1.2.0");
    expect(descriptor.viewCommands).toContain("schematic.open-sheet");
    const schema = descriptor.inputSchema as { properties: Record<string, { enum?: string[] }> };
    expect(schema.properties.action!.enum).toContain("open-sheet");
    expect(schema.properties.sheet).toBeDefined();
  });
});
