import { describe, expect, it } from "vitest";
import { createAgentToolGateway } from "../gateway";
import { assembleAgentRunContext } from "../context";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { compileTier1Proposal, planSchematicDelete } from "../../engineering/schematic-plans";
import { createEmptyBoard } from "../../pcb/types";
import { kicadPinWorldPos, pinWorldPos } from "../../geometry";
import type { KicadPin } from "../../kicad/types";
import type { SchematicState, SchComponent } from "@/lib/schematic-types";

const part = (id: string, x: number): SchComponent => ({ id, type: "resistor", x, y: 100, rotation: 0, value: "10k" });
function sharedWire(): SchematicState {
  const components = [part("r1", 100), part("r2", 200), part("r3", 300)];
  return { components, wires: [{ id: "shared", vertices: [pinWorldPos(components[0], "right"), pinWorldPos(components[1], "left"), pinWorldPos(components[2], "left")] }], netLabels: [], kicadComponents: [] };
}

describe("post-B24 foundation: approved OD-229 / OD-236", () => {
  it.each(["openai", "anthropic"] as const)("%s strict optional null reaches the real read service", async (provider) => {
    const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "foundation", branchId: "main", board: createEmptyBoard() });
    if (!assembly.ok) throw new Error(assembly.reason);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const invoke = (args: Record<string, unknown>) => gateway.invoke({ runId: "foundation", provider, toolId: "sirkit.pcb.via-inspect", version: "1.0.0", args, context: assembly.context, timeoutMs: 5_000 });
    const args = Object.freeze({ netName: null });
    expect(await invoke(args)).toMatchObject({ ok: true });
    expect(await invoke({})).toMatchObject({ ok: true });
    expect(await invoke({ netName: null, invented: null })).toMatchObject({ ok: false, status: "invalid_input" });
    expect(args).toEqual({ netName: null });
  });

  it("AI delete cannot remove a shared wire between surviving pins; the batch is all-or-nothing", () => {
    const state = sharedWire(), before = structuredClone(state);
    const result = compileTier1Proposal(state, { ops: [{ op: "set-value", target: "r2", value: "22k" }, { op: "delete", target: "r1" }], pinsByPartId: new Map() });
    expect(result).toMatchObject({ ok: false, blockers: [{ code: "delete-plan-refused" }] });
    expect(result).not.toHaveProperty("operations");
    expect(state).toEqual(before);
  });

  it("the human delete planner is unchanged", () => {
    expect(planSchematicDelete(sharedWire(), { family: "theory", componentId: "r1" })).toMatchObject({ ok: true, plan: { removeWireIds: ["shared"] } });
  });

  it("an ordinary leaf delete still compiles", () => {
    const state = sharedWire();
    state.wires[0].vertices = state.wires[0].vertices.slice(0, 2);
    expect(compileTier1Proposal(state, { ops: [{ op: "delete", target: "r1" }], pinsByPartId: new Map() })).toMatchObject({ ok: true });
  });

  it("an alternate surviving path is preserved and allows deletion", () => {
    const state = sharedWire();
    state.wires.push({ id: "alternate", vertices: state.wires[0].vertices.slice(1) });
    expect(compileTier1Proposal(state, { ops: [{ op: "delete", target: "r1" }], pinsByPartId: new Map() })).toMatchObject({ ok: true });
  });

  it("checks all removed wires together, including surviving wire junctions", () => {
    const state = sharedWire();
    const [target, a, b] = state.wires[0].vertices;
    state.wires = [{ id: "one", vertices: [target, a] }, { id: "two", vertices: [target, b] }];
    expect(compileTier1Proposal(state, { ops: [{ op: "delete", target: "r1" }], pinsByPartId: new Map() })).toMatchObject({ ok: false });
  });

  it("label removal cannot break a virtual connection between survivors", () => {
    const state = sharedWire();
    const [target, a, b] = state.wires[0].vertices;
    state.wires = [{ id: "one", vertices: [target, a] }];
    state.netLabels = [{ id: "at-target", name: "GND", position: target, kind: "label", orientation: 0 }, { id: "remote", name: "GND", position: b, kind: "label", orientation: 0 }];
    expect(compileTier1Proposal(state, { ops: [{ op: "delete", target: "r1" }], pinsByPartId: new Map() })).toMatchObject({ ok: false });
  });

  it("a surviving KiCad pin participates in shared-wire protection, and absent pin evidence refuses", () => {
    const state = sharedWire();
    const component = { id: "u1", partId: "lib:part", x: 400, y: 100, rotation: 0 as const, refDes: "U1", value: "fixture" };
    const pin: KicadPin = { number: "1", name: "A", type: "passive", position: { x: -2.5, y: 0 }, orientation: 0, length: 2.54 };
    state.kicadComponents = [component];
    state.wires[0].vertices = [state.wires[0].vertices[0], state.wires[0].vertices[1], kicadPinWorldPos(component, pin)];
    for (const pinsByPartId of [new Map(), new Map([[component.partId, []]]), new Map([[component.partId, [pin]]])]) {
      expect(compileTier1Proposal(state, { ops: [{ op: "delete", target: "r1" }], pinsByPartId })).toMatchObject({ ok: false, blockers: [{ code: "delete-plan-refused" }] });
    }
  });
});
