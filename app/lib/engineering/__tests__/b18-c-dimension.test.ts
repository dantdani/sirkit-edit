/**
 * [B18-C I7] Dimension annotations as a reviewed granted execution:
 *
 *  - re-tiered permission Tier 1 (the runbook's PCB Tier 1 list; OD-13) on
 *    BOTH the registry record and the descriptor; exposed only as a reviewed
 *    granted execution; vias and copper tracks stay Tier 2 and unexposed;
 *  - add / update / remove build byte-identical operations from the model's
 *    edits and from `planFromOperations` (the browser's recompile); dimension
 *    kinds only;
 *  - an add's id is DETERMINISTIC and its style is the editor's own dimension
 *    tool's (the tool, the inspector and the agent share ONE pure command
 *    module); an update never moves the measured points;
 *  - refusals: a zero offset on add, a zero span, coincident points, a
 *    non-documentation layer, precision beyond 4, a sub-0.1 mm label the plan
 *    sets, a zero stroke, an unknown id, the same dimension twice, too many, a
 *    derived-id collision, a pinned replace that moves the points;
 *  - the seal's argument contract (null is absent; exactly each op's fields);
 *  - end to end: confirmation-only — previewed even under
 *    execute_explicit_tier1; the human's Confirm commits ONE transaction whose
 *    board carries the deterministic id.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { mmToNm } from "../../pcb/units";
import { DIMENSION_LAYERS, type BoardDimension, type PcbBoard } from "../../pcb/types";
import { DIMENSION_DEFAULTS, DIMENSION_KINDS, newBoardDimension } from "../../pcb/dimensions/commands";
import { aiDimensionId, buildExecutionOperations, planFromOperations, type BuiltExecution, type DimensionEdit } from "../execution-operations";
import { parseExecutionArguments } from "../../agent/execution-intents";
import { KERNEL_OPERATION_BINDINGS } from "../executor";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { permissionTierOfAction, permissionTierOfDescriptor } from "../permission-tiers";
import { sirkitToolRegistry } from "../tool-catalog";
import { GRANTED_EXECUTION_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS, grantedExecutionViolations } from "../granted-execution-families";
import { tenderConfirmedExecution } from "../../project/granted-execution-controller.internal";
import { call, composition, headOf, ritual, runScenario } from "./b18c-harness";

const FAMILY = "pcb.dimension" as const;
type AddEdit = Extract<DimensionEdit, { op: "add" }>;
const WIDTH: BoardDimension = newBoardDimension({ id: "dim-width", kind: "horizontal", a: { x: 0, y: 0 }, b: { x: mmToNm(40), y: 0 }, offsetNm: -mmToNm(3), layer: "fabTop" });
// A human-placed 0.05 mm label (the kernel accepts any positive height; the agent never SETS one below 0.1 mm).
const SMALL: BoardDimension = newBoardDimension({ id: "dim-small", kind: "vertical", a: { x: mmToNm(40), y: 0 }, b: { x: mmToNm(40), y: mmToNm(30) }, offsetNm: mmToNm(3), textHeightNm: 50_000 });
function fixture(): PcbBoard {
  const board = makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
  board.dimensions = [structuredClone(WIDTH), structuredClone(SMALL)];
  return board;
}
const B = fixture();
const ok = (built: ReturnType<typeof buildExecutionOperations>): BuiltExecution => { if (!built.ok) throw new Error(built.message); return built; };
const build = (edits: DimensionEdit[], board: PcbBoard = B) => buildExecutionOperations(board, { family: FAMILY, edits });
const ADD: AddEdit = { op: "add", kind: "horizontal", a: { x: mmToNm(5), y: mmToNm(20) }, b: { x: mmToNm(15), y: mmToNm(20) }, offsetNm: mmToNm(2), ...DIMENSION_DEFAULTS };
function recompiled(built: BuiltExecution, board: PcbBoard = B): BuiltExecution {
  const plan = planFromOperations(built.family, built.operations);
  if (!plan) throw new Error("the inverse must rebuild the plan");
  return ok(buildExecutionOperations(board, plan));
}
const same = (a: BuiltExecution, b: BuiltExecution) => {
  expect(b.operationsDigest).toBe(a.operationsDigest);
  expect(b.previewDigest).toBe(a.previewDigest);
  expect(b.resultRevision).toBe(a.resultRevision);
  expect(b.resultLineageDigest).toBe(a.resultLineageDigest);
};

describe("B18-C I7 — dimension builds", () => {
  it("add / update / remove: byte-identical from the edits and from the inverse; dimension kinds only; the preview names the change", () => {
    const cases: Array<[string, DimensionEdit[], string[]]> = [
      ["add", [ADD], ["add_dimension"]],
      ["update", [{ op: "update", dimensionId: "dim-width", offsetNm: -mmToNm(5), precision: 1 }], ["update_dimension"]],
      ["remove", [{ op: "remove", dimensionId: "dim-width" }], ["remove_dimension"]],
      ["add + update + remove", [ADD, { op: "update", dimensionId: "dim-small", layer: "silkBottom" }, { op: "remove", dimensionId: "dim-width" }], ["add_dimension", "update_dimension", "remove_dimension"]],
    ];
    const allowed = (KERNEL_OPERATION_BINDINGS as Record<string, readonly string[]>)[FAMILY]!;
    for (const [label, edits, kinds] of cases) {
      const built = ok(build(edits));
      same(built, recompiled(built));
      expect(built.operations.map((operation) => operation.kind).sort(), label).toEqual([...kinds].sort());
      expect(built.operations.every((operation) => allowed.includes(operation.kind)), label).toBe(true);
      expect(built.targets.kinds, label).toEqual(["dimension"]);
    }
    expect(ok(build([ADD])).preview).toMatchObject({ before: "(new)", after: "horizontal dimension 10.00 mm from (5.000, 20.000) to (15.000, 20.000) mm, offset 2.000 mm, on silkTop, text 1.000 mm, stroke 0.150 mm" });
    expect(ok(build([{ op: "remove", dimensionId: "dim-width" }])).preview).toMatchObject({ before: "horizontal dimension 40.00 mm from (0.000, 0.000) to (40.000, 0.000) mm, offset -3.000 mm, on fabTop, text 1.000 mm, stroke 0.150 mm", after: "(removed)" });
    expect(ok(build([{ op: "update", dimensionId: "dim-width", unit: "in", precision: 3 }])).preview).toMatchObject({ after: "horizontal dimension 1.575 in from (0.000, 0.000) to (40.000, 0.000) mm, offset -3.000 mm, on fabTop, text 1.000 mm, stroke 0.150 mm" });
  });

  it("an add's id is DETERMINISTIC (base revision + index + content) and the dimension is exactly what the editor's own tool places", () => {
    const first = ok(build([ADD]));
    const add = first.operations[0]!;
    if (add.kind !== "add_dimension") throw new Error("unreachable");
    const { id, ...body } = add.dimension;
    expect(id).toBe(aiDimensionId(B, 0, body));
    expect(id).toMatch(/^dim-ai-[0-9a-f]{16}$/);
    // The tool's constructor for the same points and offset (only the id differs: the tool's is a salted counter).
    expect(add.dimension).toEqual(newBoardDimension({ id, kind: "horizontal", a: ADD.a, b: ADD.b, offsetNm: mmToNm(2) }));
    expect(ok(build([ADD])).operationsDigest).toBe(first.operationsDigest);
    const other = fixture();
    other.footprints[0]!.at = { x: mmToNm(6), y: mmToNm(5) };
    const moved = ok(build([ADD], other)).operations[0]!;
    if (moved.kind !== "add_dimension") throw new Error("unreachable");
    expect(moved.dimension.id).not.toBe(id); // another base revision
    const two = ok(build([ADD, { ...ADD, offsetNm: mmToNm(4) }]));
    expect(new Set(two.operations.map((operation) => (operation.kind === "add_dimension" ? operation.dimension.id : "")))).toHaveProperty("size", 2);
  });

  it("an update changes only what the inspector edits: a pinned replace that moves the points refuses; a no-op update is no target; a height the plan does not set keeps the human's", () => {
    const moved: BoardDimension = { ...WIDTH, a: { x: mmToNm(1), y: 0 } };
    expect(buildExecutionOperations(B, { family: FAMILY, mode: "pinned", changes: [{ op: "replace", item: moved }] })).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(build([{ op: "update", dimensionId: "dim-width", layer: "fabTop" }])).toMatchObject({ ok: false, code: "no_change" });
    const mixed = ok(build([{ op: "update", dimensionId: "dim-width", layer: "fabTop" }, { op: "update", dimensionId: "dim-small", precision: 3 }]));
    expect(mixed.targets.objectIds).toEqual(["dim-small"]);
    const relayered = ok(build([{ op: "update", dimensionId: "dim-small", layer: "fabBottom" }]));
    const operation = relayered.operations[0]!;
    if (operation.kind !== "update_dimension") throw new Error("unreachable");
    expect(operation.replace).toEqual({ ...SMALL, layer: "fabBottom" });
    expect(build([{ op: "update", dimensionId: "dim-small", textHeightNm: 60_000 }])).toMatchObject({ ok: false, code: "invalid_geometry" });
  });

  it("refusals: a zero offset on add, a zero span, coincident points, copper, precision 5, a sub-0.1 mm label, a zero stroke, unknown, twice, too many, a derived-id collision, a pinned zero-offset add", () => {
    const bad = (edit: Partial<AddEdit>) => build([{ ...ADD, ...edit }]);
    expect(bad({ offsetNm: 0 })).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(bad({ b: { x: mmToNm(5), y: mmToNm(30) } })).toMatchObject({ ok: false, code: "invalid_geometry" }); // horizontal over a zero X span
    expect(bad({ kind: "aligned", b: { ...ADD.a } })).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(bad({ layer: "copperTop" as unknown as AddEdit["layer"] })).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(bad({ precision: 5 as unknown as AddEdit["precision"] })).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(bad({ textHeightNm: 99_999 })).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(bad({ strokeWidthNm: 0 })).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(build([{ op: "remove", dimensionId: "no-such" }])).toMatchObject({ ok: false, code: "unknown_target" });
    expect(build([{ op: "remove", dimensionId: "dim-width" }, { op: "update", dimensionId: "dim-width", precision: 1 }])).toMatchObject({ ok: false, code: "unknown_target" });
    expect(build(Array.from({ length: 17 }, (_, index) => ({ ...ADD, offsetNm: mmToNm(index + 1) })))).toMatchObject({ ok: false, code: "too_many" });
    // A (pinned) add whose id already exists refuses: a replayed or forged grant can never squat an existing dimension.
    const item = (ok(build([ADD])).operations[0] as { dimension: BoardDimension }).dimension;
    expect(buildExecutionOperations(B, { family: FAMILY, mode: "pinned", changes: [{ op: "add", item: { ...item, id: "dim-width" } }] })).toMatchObject({ ok: false, code: "unknown_target" });
    expect(buildExecutionOperations(B, { family: FAMILY, mode: "pinned", changes: [{ op: "add", item: { ...item, offsetNm: 0 } }] })).toMatchObject({ ok: false, code: "invalid_geometry" });
  });
});

describe("B18-C I7 — the seal's argument contract", () => {
  const parse = (args: Record<string, unknown>) => parseExecutionArguments(FAMILY, args, B);
  const NULLS = { dimensionId: null, kind: null, a: null, b: null, offsetNm: null, layer: null, unit: null, precision: null, textHeightNm: null, strokeWidthNm: null };
  it("each op carries exactly its fields (null is absent); an add takes the editor's own style defaults; an update never carries the points", () => {
    expect(parse({ edits: [{ ...NULLS, op: "add", kind: "horizontal", a: { x: 1, y: 2 }, b: { x: 3, y: 2 }, offsetNm: 5 }] })).toEqual({ ok: true, plan: { family: FAMILY, edits: [{ op: "add", kind: "horizontal", a: { x: 1, y: 2 }, b: { x: 3, y: 2 }, offsetNm: 5, ...DIMENSION_DEFAULTS }] } });
    expect(parse({ edits: [{ ...NULLS, op: "add", kind: "aligned", a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, offsetNm: -5, layer: "fabBottom", unit: "in", precision: 3, textHeightNm: 800_000, strokeWidthNm: 100_000 }] }))
      .toEqual({ ok: true, plan: { family: FAMILY, edits: [{ op: "add", kind: "aligned", a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, offsetNm: -5, layer: "fabBottom", unit: "in", precision: 3, textHeightNm: 800_000, strokeWidthNm: 100_000 }] } });
    expect(parse({ edits: [{ ...NULLS, op: "update", dimensionId: "dim-width", offsetNm: -4 }] })).toEqual({ ok: true, plan: { family: FAMILY, edits: [{ op: "update", dimensionId: "dim-width", offsetNm: -4 }] } });
    expect(parse({ edits: [{ op: "remove", dimensionId: "dim-width" }] })).toEqual({ ok: true, plan: { family: FAMILY, edits: [{ op: "remove", dimensionId: "dim-width" }] } });
    expect(parse({ edits: [{ op: "update", dimensionId: "dim-width", a: { x: 1, y: 2 } }] })).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/never moves the measured points/)] });
    for (const edits of [
      [{ op: "add", kind: "horizontal", a: { x: 1, y: 2 }, b: { x: 3, y: 2 } }],                                  // no offset
      [{ op: "add", a: { x: 1, y: 2 }, b: { x: 3, y: 2 }, offsetNm: 5 }],                                          // no kind
      [{ op: "add", kind: "horizontal", a: { x: 1.5, y: 2 }, b: { x: 3, y: 2 }, offsetNm: 5 }],                    // not integer nm
      [{ op: "add", kind: "horizontal", a: { x: 1, y: 2, z: 0 }, b: { x: 3, y: 2 }, offsetNm: 5 }],                // a stray coordinate
      [{ op: "add", kind: "diagonal", a: { x: 1, y: 2 }, b: { x: 3, y: 2 }, offsetNm: 5 }],                        // unknown kind
      [{ op: "add", kind: "horizontal", a: { x: 1, y: 2 }, b: { x: 3, y: 2 }, offsetNm: 5, layer: "copperTop" }],  // copper
      [{ op: "add", kind: "horizontal", a: { x: 1, y: 2 }, b: { x: 3, y: 2 }, offsetNm: 5, unit: "cm" }],          // unit
      [{ op: "add", kind: "horizontal", a: { x: 1, y: 2 }, b: { x: 3, y: 2 }, offsetNm: 5, precision: 1.5 }],      // precision
      [{ op: "add", kind: "horizontal", a: { x: 1, y: 2 }, b: { x: 3, y: 2 }, offsetNm: 5, dimensionId: "d" }],    // a stray id
      [{ op: "update", dimensionId: "dim-width" }],                                                                 // nothing to change
      [{ op: "remove", dimensionId: "dim-width", precision: 2 }],                                                   // a stray field
      [{ op: "remove" }],                                                                                            // no id
      [{ op: "rotate", dimensionId: "dim-width" }],                                                                 // unknown op
      [{ op: "add", kind: "horizontal", a: { x: 1, y: 2 }, b: { x: 3, y: 2 }, offsetNm: 5, color: "red" }],         // unknown field
    ]) expect(parse({ edits }), JSON.stringify(edits)).toMatchObject({ ok: false });
    expect(parse({ edits: [] })).toMatchObject({ ok: false });
    expect(parse({ edits: [{ op: "remove", dimensionId: "dim-width" }], approval: true })).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/authority-shaped/)] });
  });
});

describe("B18-C I7 — the re-tier and the gates (OD-13)", () => {
  const registry = sirkitToolRegistry();
  it("Tier 1 on the record AND the descriptor; a reviewed granted execution the pattern no longer lists; vias and copper tracks stay Tier 2, unexposed and pattern-listed; the schema's enums are the model's", () => {
    const descriptor = registry.get("sirkit.pcb.dimension")!;
    expect(descriptor.version).toBe("1.2.0");
    expect(permissionTierOfDescriptor(descriptor)).toBe(1);
    expect(permissionTierOfAction(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "pcb.dimension")!)).toBe(1);
    expect(GRANTED_EXECUTION_TOOL_IDS).toContain("sirkit.pcb.dimension");
    expect(grantedExecutionViolations(descriptor)).toEqual([]);
    expect(descriptor.agentExposed).toBe(true);
    expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test("sirkit.pcb.dimension"))).toBe(false);
    for (const id of ["sirkit.pcb.create-via", "sirkit.pcb.edit-track"]) {
      expect(permissionTierOfDescriptor(registry.get(id)!), id).toBe(2);
      expect(registry.get(id)!.agentExposed, id).toBe(false);
      expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(id)), id).toBe(true);
    }
    const items = (descriptor.inputSchema as unknown as { properties: { edits: { items: { properties: Record<string, { enum?: readonly unknown[] }> } } } }).properties.edits.items.properties;
    expect(items.layer!.enum).toEqual([...DIMENSION_LAYERS]);
    expect(items.kind!.enum).toEqual([...DIMENSION_KINDS]);
  });

  it("the editor's dimension tool and inspector build their candidates through the SAME pure commands the agent's builder uses (source pins)", () => {
    const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
    const tool = read("app", "components", "pcb", "hooks", "useDimensionTool.ts");
    expect(tool).toContain("newBoardDimension(");
    expect(tool).toContain('kind: "AddDimension"');
    expect(tool).not.toContain("dimensions ??= []");
    const inspector = read("app", "components", "pcb", "inspectors", "DimensionInspector.tsx");
    expect(inspector).toContain('kind: "EditDimension"');
    expect(inspector).not.toContain("Object.assign(");
  });
});

describe("B18-C I7 — end to end (confirmation-only)", () => {
  it("previewed even under execute_explicit_tier1; the human's Confirm commits ONE transaction whose board carries the deterministic id", async () => {
    const c = await composition("execute_explicit_tier1");
    const args = { edits: [{ op: "add", dimensionId: null, kind: "horizontal", a: { x: mmToNm(5), y: mmToNm(20) }, b: { x: mmToNm(15), y: mmToNm(20) }, offsetNm: mmToNm(2), layer: null, unit: null, precision: null, textHeightNm: null, strokeWidthNm: null }] };
    const { adapter, grants, rituals } = await runScenario(c, (_move, tool) => [() => ({ toolCalls: [call("c1", tool("sirkit.pcb.dimension"), JSON.stringify(args))] }), () => ({ text: "done" })], { message: "Add a horizontal dimension from 5,20 to 15,20 mm with a 2 mm offset." });
    expect(rituals).toEqual([]);
    expect(JSON.parse(adapter.continueInputs[0]![0]!.outputText)).toMatchObject({ ok: true, status: "execution_preview_issued", family: "pcb.dimension", decision: "preview_then_confirm" });
    const pinned = grants[0]!.binding.proposal.operations[0]!;
    if (pinned.kind !== "add_dimension") throw new Error("unreachable");
    expect(pinned.dimension.id).toMatch(/^dim-ai-[0-9a-f]{16}$/);
    const before = headOf(c).headSequence;
    expect(await tenderConfirmedExecution(ritual(c, grants[0]!))).toMatchObject({ ok: true, status: "committed" });
    expect(headOf(c).headSequence).toBe(before + 1);
    expect(c.history.committedPresent.dimensions?.find((item) => item.id === pinned.dimension.id)).toMatchObject({ kind: "horizontal", layer: "silkTop", offsetNm: mmToNm(2) });
  }, 30_000);
});
