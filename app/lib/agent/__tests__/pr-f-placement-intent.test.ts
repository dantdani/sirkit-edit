/**
 * [PR-F fE] The structured placement INTENT (`sirkit.placement-intent.v1`) of `sirkit.placement.propose` (directive section 8;
 * CONTINUATION E-F), through the REAL registry, gateway and loop over fixture boards:
 *
 *  - the schema: the descriptor's `intent` block admits exactly the schema / units / frame literals, the manual example validates,
 *    the descriptor stays strict-compatible, and the frame statement quotes the model's own authorities (+y down, counter-clockwise
 *    on screen, integer nanometres);
 *  - identity binding: a component is { ref, instanceId } and BOTH must name the same footprint, a net { name, id } the same net, a
 *    pad must exist - each refusal is `proposal-blocked` data with its code and the board revision is unchanged;
 *  - a locked component the intent tries to move: the conflict `locked` is reported, the lock is preserved (the footprint stays);
 *  - a keepout: the intent puts a part on a fixed instance; the engine's legalization moves it away and the conflict says so;
 *  - coordinates legalized with the conflict list: two parts asked for the same place, one asked off the board;
 *  - groups, regions, pin-specific proximity, separation, corridors and critical nets: satisfied or a conflict, never dropped;
 *  - the scope gate: over 50 physical instances the intent is recorded `unsupported-scope` and NOT applied, the candidate still
 *    stands on the engine's own run;
 *  - the candidate's digest covers the intent block; a candidate without an intent carries no `intent` key (editor bytes unchanged);
 *  - the loop: `layout_candidate_ready` with the intent, the result's bounded conflict report and PLACEMENT_INTENT_NOTE.
 */
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { makeBoard, makeDef, makeInstance, makePad, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import type { FootprintInstance, PcbBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { layoutCandidateIntact, runPlacementCandidate, type PlacementLayoutCandidate } from "@/app/lib/pcb/candidates/layout-candidate";
import { PLACEMENT_INTENT_FRAME, PLACEMENT_INTENT_FRAME_STATEMENT, PLACEMENT_INTENT_SCHEMA, PLACEMENT_INTENT_UNITS, PLACEMENT_SCOPE_LIMIT, classifyPlacementScope, compilePlacementIntent, countPhysicalInstances } from "@/app/lib/pcb/placement/intent";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { validateAgainstSchema } from "@/app/lib/engineering/tool-io-validation";
import { MANUAL_EXAMPLES } from "@/app/lib/engineering/tool-manual";
import { strictCompatibility } from "../provider-tools";
import { assembleAgentRunContext } from "../context";
import { createAgentToolGateway } from "../gateway";
import { runAgentLoop } from "../loop";
import { PLACEMENT_INTENT_NOTE, layoutCandidateChatLine, placementReport } from "../layout-report";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type AgentToolResult, type ProviderAgentAdapter } from "../contracts";

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const MARK = { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" };
const T0 = Date.parse("2026-10-17T12:00:00.000Z");
const TOOL = "sirkit.placement.propose";
const registry = sirkitToolRegistry();
const MM = 1_000_000;

/** r1, r2, r3 resistors; u1 an 8-pad IC; j1 a LOCKED 6 x 6 mm connector at (35, 15); nets NET_1..NET_3. */
function board(): PcbBoard {
  const resistor = makeResistorDef();
  const ic = makeDef("IC8", 10, 10, [makePad("1", -4, -3), makePad("8", 4, -3)]);
  const connector = makeDef("CONN", 6, 6, [makePad("1", 0, -2), makePad("2", 0, 2)]);
  return makeBoard(40, 30, [
    makeInstance("r1", resistor, { x: 5, y: 5 }, { "1": 1, "2": 2 }),
    makeInstance("r2", resistor, { x: 30, y: 22 }, { "1": 1, "2": 0 }),
    makeInstance("r3", resistor, { x: 8, y: 24 }, { "1": 2, "2": 0 }),
    makeInstance("u1", ic, { x: 20, y: 15 }, { "1": 3, "8": 2 }),
    makeInstance("j1", connector, { x: 35, y: 15 }, { "1": 1, "2": 3 }, { locked: true }),
  ], 3);
}
const REF = { r1: { ref: "R1", instanceId: "r1" }, r2: { ref: "R2", instanceId: "r2" }, r3: { ref: "R3", instanceId: "r3" }, u1: { ref: "U1", instanceId: "u1" }, j1: { ref: "J1", instanceId: "j1" } };
const HEAD = { schema: PLACEMENT_INTENT_SCHEMA, units: PLACEMENT_INTENT_UNITS, frame: PLACEMENT_INTENT_FRAME } as const;

function assemble(input: { board?: PcbBoard; role?: "viewer" | "pcb_editor" | "project_admin" } = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p-prf-e", branchId: "main", schematic: SCHEMATIC, board: input.board ?? board(), schematicHeadMark: MARK, ...(input.role ? { verifiedActor: { principalId: `u-${input.role}`, actorRole: input.role, membershipRevision: "m1", authMethod: "local_dev" as const } } : {}) });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
const descriptor = () => registry.get(TOOL)!;
const invoke = (context: AgentRunContext, args: Record<string, unknown>) => createAgentToolGateway(registry, { now: () => T0 }).invoke({ runId: "run-prf-e", provider: "openai", toolId: TOOL, version: descriptor().version, args, context, timeoutMs: 20_000 });
const candidateOf = async (context: AgentRunContext, intent: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<PlacementLayoutCandidate> => {
  const outcome = await invoke(context, { candidateCount: 2, maxIterations: 20, intent, ...extra });
  if (outcome.kind !== "layout-candidate") throw new Error(JSON.stringify(outcome).slice(0, 600));
  return outcome.candidate as PlacementLayoutCandidate;
};
const conflictsOf = (candidate: PlacementLayoutCandidate, kind: string) => (candidate.intent?.conflicts ?? []).filter((conflict) => conflict.kind === kind);

describe("PR-F fE - the placement intent: schema, units and frame", () => {
  it("the descriptor admits the intent block (1.2.0, strict-compatible); schema / units / frame are closed literals; the manual's intent example validates", () => {
    const d = descriptor();
    expect(d.version).toBe("1.2.0");
    const intentSchema = (d.inputSchema.properties as Record<string, Record<string, unknown>>).intent;
    expect(intentSchema).toBeDefined();
    const properties = intentSchema!.properties as Record<string, Record<string, unknown>>;
    expect(properties.schema!.enum).toEqual([PLACEMENT_INTENT_SCHEMA]);
    expect(properties.units!.enum).toEqual([PLACEMENT_INTENT_UNITS]);
    expect(properties.frame!.enum).toEqual([PLACEMENT_INTENT_FRAME]);
    expect(intentSchema!.required).toEqual(["schema", "units", "frame"]);
    expect(Object.keys(properties).sort()).toEqual(["corridors", "criticalNets", "frame", "groups", "placements", "proximity", "regions", "schema", "separations", "units"]);
    expect(strictCompatibility(d).ok).toBe(true);
    const examples = MANUAL_EXAMPLES[TOOL]!;
    expect(examples.some((example) => "intent" in example)).toBe(true);
    for (const example of examples) expect(validateAgainstSchema(example, d.inputSchema, "example")).toEqual([]);
  });

  it("the frame statement quotes the model's own authorities: integer nanometres, +x right, +y DOWN, counter-clockwise on screen, 0|90|180|270, bottom mirrors x", () => {
    expect(PLACEMENT_INTENT_FRAME_STATEMENT).toMatch(/integer-nanometre/);
    expect(PLACEMENT_INTENT_FRAME_STATEMENT).toMatch(/\+x right, \+y DOWN/);
    expect(PLACEMENT_INTENT_FRAME_STATEMENT).toMatch(/COUNTER-CLOCKWISE as seen on screen/);
    expect(PLACEMENT_INTENT_FRAME_STATEMENT).toMatch(/0 \| 90 \| 180 \| 270/);
    expect(PLACEMENT_INTENT_FRAME_STATEMENT).toMatch(/mirrors the footprint across x/);
    expect(PLACEMENT_INTENT_FRAME_STATEMENT).toMatch(/app\/lib\/pcb\/units\.ts/);
    expect(PLACEMENT_INTENT_FRAME_STATEMENT).toMatch(/app\/lib\/pcb\/geometry\.ts/);
  });

  it("units other than mm and frames other than board-world refuse as blockers; an empty intent refuses; the compiled intent is in integer nanometres", () => {
    const b = board();
    expect(compilePlacementIntent(b, { ...HEAD, units: "cm", placements: [{ component: REF.r1, xMm: 1, yMm: 1 }] })).toMatchObject({ ok: false, blockers: [{ code: "units-unsupported" }] });
    expect(compilePlacementIntent(b, { ...HEAD, frame: "outline-corner", placements: [{ component: REF.r1, xMm: 1, yMm: 1 }] })).toMatchObject({ ok: false, blockers: [{ code: "frame-unsupported" }] });
    expect(compilePlacementIntent(b, { ...HEAD })).toMatchObject({ ok: false, blockers: [{ code: "empty-intent" }] });
    expect(compilePlacementIntent(b, { ...HEAD, extra: 1, placements: [{ component: REF.r1, xMm: 1, yMm: 1 }] })).toMatchObject({ ok: false, blockers: [{ code: "intent-malformed" }] });
    const compiled = compilePlacementIntent(b, { ...HEAD, placements: [{ component: REF.r1, xMm: 12.5, yMm: 7.25, rotationDeg: 90 }] });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.intent.placements[0]).toMatchObject({ component: REF.r1, position: { x: 12_500_000, y: 7_250_000 }, rotationDeg: 90, side: null });
    expect(compiled.seed).toMatchObject({ placements: { r1: { position: { x: 12_500_000, y: 7_250_000 }, rotationDeg: 90 } }, orientationPinnedIds: ["r1"], preferSeeded: true });
    expect(compiled.intent.frameStatement).toBe(PLACEMENT_INTENT_FRAME_STATEMENT);
  });
});

describe("PR-F fE - identity binding refusals (as data; the board is unchanged)", () => {
  it("an unknown instance, a ref that names another instance, a net that is not on the revision, an unknown pad, a duplicate placement: proposal-blocked with the code, nothing sealed, nothing changed", async () => {
    const b = board();
    const context = assemble({ board: b });
    const before = pcbRevisionId(context.canonicalState!.pcb);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ placements: [{ component: { ref: "R9", instanceId: "r9" }, xMm: 1, yMm: 1 }] }, "unknown-component"],
      [{ placements: [{ component: { ref: "R2", instanceId: "r1" }, xMm: 1, yMm: 1 }] }, "identity-mismatch"],
      [{ criticalNets: [{ net: { name: "GND", id: 1 }, priority: 1 }] }, "unknown-net"],
      [{ criticalNets: [{ net: { name: "NET_1", id: 9 }, priority: 1 }] }, "unknown-net"],
      [{ proximity: [{ component: REF.r1, pad: "7", near: REF.u1, maxDistanceMm: 3 }] }, "unknown-pad"],
      [{ placements: [{ component: REF.r1, xMm: 1, yMm: 1 }, { component: REF.r1, xMm: 2, yMm: 2 }] }, "duplicate-id"],
      [{ groups: [{ id: "g", members: [REF.r1], regionId: "nowhere" }] }, "unknown-region"],
      [{ regions: [{ id: "r", polygonMm: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] }, "polygon-malformed"],
      [{ placements: [{ component: REF.r1, xMm: 99_999, yMm: 1 }] }, "value-out-of-range"],
    ];
    for (const [intent, code] of cases) {
      const outcome = await invoke(context, { intent: { ...HEAD, ...intent } });
      expect(outcome, code).toMatchObject({ kind: "proposal-blocked", ok: false });
      if (outcome.kind === "proposal-blocked") expect(outcome.blockers.map((blocker) => blocker.code), code).toContain(code);
    }
    expect(pcbRevisionId(context.canonicalState!.pcb)).toBe(before);
    // the intent is one of the strict keys; an authority-shaped key is still refused by name
    const authority = await invoke(context, { intent: { ...HEAD, placements: [{ component: REF.r1, xMm: 1, yMm: 1 }] }, apply: true });
    expect(authority).toMatchObject({ kind: "refused", status: "invalid_input" });
    if (authority.kind === "refused") expect(authority.diagnostics[0]).toMatch(/authority-shaped/);
  });
});

describe("PR-F fE - the intent through the engine: locks, keepouts, legalization, the conflict list", () => {
  it("a locked component the intent tries to move: the conflict `locked` names the fixed reasons, the footprint stays, the candidate still seals and verifies", async () => {
    const b = board();
    const context = assemble({ board: b });
    const candidate = await candidateOf(context, { ...HEAD, placements: [{ component: REF.j1, xMm: 10, yMm: 10, rotationDeg: 90 }] });
    expect(candidate.intent).toBeDefined();
    expect(candidate.intent!.applied).toBe(true);
    expect(candidate.intent!.scope).toMatchObject({ classification: "qualified", physicalInstanceCount: 5, limit: PLACEMENT_SCOPE_LIMIT });
    const locked = conflictsOf(candidate, "locked");
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({ component: REF.j1 });
    expect(locked[0]!.happened).toMatch(/footprint_locked/);
    expect(locked[0]!.happened).toMatch(/lock is preserved/);
    expect(candidate.candidate.placements.j1).toMatchObject({ position: { x: 35 * MM, y: 15 * MM }, rotationDeg: 0, side: "top" });
    expect(candidate.intent!.seededInstanceIds).toEqual([]); // nothing movable was named, so nothing was seeded
    expect(layoutCandidateIntact(candidate)).toBe(true);
    expect(candidate.legal).toBe(true);
  });

  it("a keepout: the intent puts r1 on the locked connector; legalization moves it off and the conflict `keepout` names the fixed instance; j1 is untouched", async () => {
    const b = board();
    const context = assemble({ board: b });
    const candidate = await candidateOf(context, { ...HEAD, placements: [{ component: REF.r1, xMm: 35, yMm: 15 }] });
    const keepout = conflictsOf(candidate, "keepout");
    expect(keepout).toHaveLength(1);
    expect(keepout[0]).toMatchObject({ component: REF.r1 });
    expect(keepout[0]!.happened).toMatch(/fixed instance j1 \(footprint_locked\)/);
    const r1 = candidate.candidate.placements.r1!;
    // r1's 3.4 x 2 mm envelope no longer overlaps j1's 6 x 6 mm envelope centred at (35, 15)
    const overlaps = Math.abs(r1.position.x - 35 * MM) < (1.7 + 3) * MM && Math.abs(r1.position.y - 15 * MM) < (1 + 3) * MM;
    expect(overlaps).toBe(false);
    expect(candidate.candidate.placements.j1).toMatchObject({ position: { x: 35 * MM, y: 15 * MM } });
    expect(candidate.legal).toBe(true);
  });

  it("coordinates legalized with the conflict list: two parts asked for one place (one is nudged: `legalized`), a part asked off the board (`outside-board`), a part placed exactly (satisfied, orientation kept)", async () => {
    const b = board();
    const context = assemble({ board: b });
    const candidate = await candidateOf(context, { ...HEAD, placements: [
      { component: REF.r2, xMm: 10, yMm: 10, rotationDeg: 90 },
      { component: REF.r3, xMm: 10, yMm: 10 },
      { component: REF.u1, xMm: 39.5, yMm: 5 },
    ] });
    const intent = candidate.intent!;
    expect(intent.seededInstanceIds).toEqual(["r2", "r3", "u1"]);
    expect(intent.selectedInitializer).toBe("intent_seed");
    expect(intent.seededCandidate).toMatchObject({ legal: true, selected: true });
    expect(conflictsOf(candidate, "outside-board")).toHaveLength(1);
    expect(conflictsOf(candidate, "outside-board")[0]).toMatchObject({ component: REF.u1 });
    expect(conflictsOf(candidate, "outside-board")[0]!.happened).toMatch(/it ended at \(/);
    const legalized = conflictsOf(candidate, "legalized");
    expect(legalized).toHaveLength(1);
    expect(legalized[0]!.component!.instanceId).toBe("r3"); // r2 settles first (ascending id), r3 is nudged
    expect(legalized[0]!.happened).toMatch(/exact legalization .* moved it by \d+\.\d{3} mm/);
    expect(intent.satisfied.some((item) => item.kind === "placement" && item.component?.instanceId === "r2")).toBe(true);
    expect(candidate.candidate.placements.r2).toMatchObject({ position: { x: 10 * MM, y: 10 * MM }, rotationDeg: 90 });
    expect(intent.conflicts.map((conflict) => conflict.kind).sort()).toEqual(["legalized", "outside-board"]);
    expect(candidate.legal).toBe(true);
    expect(layoutCandidateIntact(candidate)).toBe(true);
  });

  it("an orientation outside the allowed set is a conflict `orientation`; the allowed rotation is kept", async () => {
    const b = board();
    b.footprints.find((footprint) => footprint.id === "r2")!.placementConstraints = { allowedRotations: [0, 180] };
    const context = assemble({ board: b });
    const candidate = await candidateOf(context, { ...HEAD, placements: [{ component: REF.r2, xMm: 10, yMm: 10, rotationDeg: 90 }] });
    const orientation = conflictsOf(candidate, "orientation");
    expect(orientation).toHaveLength(1);
    expect(orientation[0]!.happened).toMatch(/rotation 90 deg is outside the allowed set \[0, 180\]/);
    expect([0, 180]).toContain(candidate.candidate.placements.r2!.rotationDeg);
  });

  it("groups and regions, pin-specific proximity, separation, corridors and critical nets: each satisfied or a conflict, never dropped; critical nets are data the engine does not enforce", async () => {
    const b = board();
    const context = assemble({ board: b });
    const candidate = await candidateOf(context, { ...HEAD,
      regions: [{ id: "left", polygonMm: [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 30 }, { x: 0, y: 30 }] }],
      groups: [{ id: "analog", name: "analog front end", members: [REF.r1, REF.r3], regionId: "left" }],
      placements: [{ component: REF.r1, xMm: 5, yMm: 5 }, { component: REF.r3, xMm: 5, yMm: 9 }, { component: REF.r2, xMm: 20, yMm: 5 }],
      proximity: [{ component: REF.r3, pad: "1", near: REF.r1, nearPad: "2", maxDistanceMm: 3, reason: "decoupling" }, { component: REF.r3, near: REF.r1, maxDistanceMm: 10 }],
      separations: [{ component: REF.r1, from: REF.j1, minDistanceMm: 5 }, { component: REF.r1, from: REF.r3, minDistanceMm: 8, reason: "heat" }],
      corridors: [{ id: "bus", polygonMm: [{ x: 18, y: 0 }, { x: 22, y: 0 }, { x: 22, y: 30 }, { x: 18, y: 30 }], nets: [{ name: "NET_2", id: 2 }] }],
      criticalNets: [{ net: { name: "NET_1", id: 1 }, priority: 1, reason: "return path" }],
    });
    const intent = candidate.intent!;
    expect(intent.bindings.components.map((component) => component.instanceId)).toEqual(["j1", "r1", "r2", "r3"]);
    expect(intent.bindings.nets).toEqual([{ name: "NET_1", id: 1 }, { name: "NET_2", id: 2 }]);
    expect(intent.criticalNets).toEqual([{ net: { name: "NET_1", id: 1 }, priority: 1, reason: "return path", enforcement: "not-enforced-by-placement" }]);
    expect(intent.satisfied.some((item) => item.kind === "group" && /analog/.test(item.detail))).toBe(true);
    // r3 pad 1 at (4.1, 9) vs r1 pad 2 at (5.9, 5): 4.39 mm > 3 mm -> conflict; the whole-part proximity within 10 mm -> satisfied
    const proximity = conflictsOf(candidate, "proximity");
    expect(proximity).toHaveLength(1);
    expect(proximity[0]!.intent).toMatch(/R3 pad 1 within 3\.000 mm of R1 pad 2 \(decoupling\)/);
    expect(proximity[0]!.happened).toMatch(/measured 4\.\d{3} mm/);
    expect(intent.satisfied.some((item) => item.kind === "proximity")).toBe(true);
    // r1 and r3 envelopes are 2 mm apart (centres 4 mm apart, 2 mm tall) < 8 mm -> conflict; r1 to j1 >= 5 mm -> satisfied
    const separation = conflictsOf(candidate, "separation");
    expect(separation).toHaveLength(1);
    expect(separation[0]!.intent).toMatch(/R1 at least 8\.000 mm from R3 \(heat\)/);
    expect(intent.satisfied.some((item) => item.kind === "separation")).toBe(true);
    // u1 (10 x 10 mm at (20, 15)) and r2 (placed at (20, 5)) sit in the bus corridor x 18..22 -> conflicts for each
    const corridor = conflictsOf(candidate, "corridor");
    expect(corridor.map((conflict) => conflict.component?.instanceId).sort()).toEqual(["r2", "u1"]);
    expect(corridor[0]!.intent).toMatch(/corridor bus for NET_2/);
    expect(layoutCandidateIntact(candidate)).toBe(true);
  });

  it("the scope gate: over 50 physical instances the intent is classified unsupported-scope, recorded and NOT applied; the candidate stands on the engine's own run; the count rule counts packages, de-duplicated by the sync identity", async () => {
    const resistor = makeResistorDef();
    const footprints: FootprintInstance[] = [];
    for (let index = 0; index < 52; index += 1) footprints.push(makeInstance(`p${String(index).padStart(2, "0")}`, resistor, { x: 5 + (index % 13) * 7, y: 5 + Math.floor(index / 13) * 7 }, { "1": 1 + (index % 3) }));
    const big = makeBoard(100, 40, footprints, 3);
    expect(countPhysicalInstances(big)).toBe(52);
    expect(classifyPlacementScope(big)).toMatchObject({ physicalInstanceCount: 52, limit: 50, classification: "unsupported-scope" });
    // two footprints that are units of ONE package (the same sync identity) count once
    const twoUnits = makeBoard(40, 30, [
      { ...makeInstance("ua", resistor, { x: 5, y: 5 }), syncIdentity: { componentInstanceId: "u-one", bindingRevisionId: "b", footprintAssetVersionId: "f", footprintContentDigest: "d", mappingCertificateId: "m", symbolAssetVersionId: "s", syncPlanId: "p" } },
      { ...makeInstance("ub", resistor, { x: 15, y: 5 }), syncIdentity: { componentInstanceId: "u-one", bindingRevisionId: "b", footprintAssetVersionId: "f", footprintContentDigest: "d", mappingCertificateId: "m", symbolAssetVersionId: "s", syncPlanId: "p" } },
      makeInstance("r9", resistor, { x: 25, y: 5 }),
    ], 1);
    expect(countPhysicalInstances(twoUnits)).toBe(2);
    const context = assemble({ board: big });
    const candidate = await candidateOf(context, { ...HEAD, placements: [{ component: { ref: "P00", instanceId: "p00" }, xMm: 50, yMm: 20 }] }, { maxIterations: 5 });
    const intent = candidate.intent!;
    expect(intent.applied).toBe(false);
    expect(intent.scope).toMatchObject({ physicalInstanceCount: 52, limit: PLACEMENT_SCOPE_LIMIT, classification: "unsupported-scope" });
    expect(intent.seededInstanceIds).toEqual([]);
    expect(intent.conflicts).toHaveLength(1);
    expect(intent.conflicts[0]).toMatchObject({ kind: "not-applied", component: null });
    expect(intent.conflicts[0]!.happened).toMatch(/52 physical component instances, above the qualified limit of 50: classified unsupported-scope/);
    expect(intent.bindings.components).toEqual([{ ref: "P00", instanceId: "p00" }]);
    expect(candidate.run.candidateCount).toBeGreaterThanOrEqual(2);
    expect(candidate.candidate.initializer).not.toBe("intent_seed");
    expect(layoutCandidateIntact(candidate)).toBe(true);
    // an unknown identity still refuses on an unsupported-scope board (identity binding is not skipped)
    expect(await invoke(context, { intent: { ...HEAD, placements: [{ component: { ref: "P99", instanceId: "p99" }, xMm: 1, yMm: 1 }] }, maxIterations: 5 })).toMatchObject({ kind: "proposal-blocked" });
    expect(layoutCandidateChatLine(candidate)).toMatch(/NOT applied: 52 physical instances exceed the qualified scope of 50/);
  });

  it("the digest covers the intent block; a candidate without an intent carries no `intent` key; the report and the chat line carry the conflicts", async () => {
    const b = board();
    const context = assemble({ board: b });
    const candidate = await candidateOf(context, { ...HEAD, placements: [{ component: REF.j1, xMm: 10, yMm: 10 }] });
    expect(layoutCandidateIntact(candidate)).toBe(true);
    const tampered = { ...candidate, intent: { ...candidate.intent!, conflicts: [] } } as PlacementLayoutCandidate;
    expect(layoutCandidateIntact(tampered)).toBe(false);
    const plain = runPlacementCandidate({ board: b, request: { producer: "editor", candidateCount: 2, maxIterations: 20 }, clock: () => "2026-10-17T12:00:00.000Z" }).candidate!;
    expect("intent" in plain).toBe(false);
    const report = placementReport(candidate);
    expect(report.intent).toMatchObject({ applied: true, classification: "qualified", conflicts: 1, conflictKinds: ["locked"], conflictsReported: 1 });
    expect(report.intent!.firstConflicts[0]).toMatchObject({ kind: "locked", ref: "J1" });
    expect(layoutCandidateChatLine(candidate)).toMatch(/placement intent \(1 item\) has 1 conflict \(locked\)/);
    expect(placementReport(plain).intent).toBeUndefined();
  });
});

// ── the loop: the event and the bounded report ──
type StepScript = () => Partial<AgentStep>;
class FakeAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly continueInputs: Array<readonly AgentToolResult[]> = [];
  private index = 0;
  constructor(private readonly script: StepScript[]) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "fake", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(): Promise<AgentStep> { return this.step(this.script[this.index++]!()); }
  async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> { this.continueInputs.push(input.results); return this.step(this.script[this.index++]!()); }
}

describe("PR-F fE - the loop hands the model the intent's conflicts and the note", () => {
  it("layout_candidate_ready carries the intent block; the result lists the conflicts (bounded) and PLACEMENT_INTENT_NOTE; a blocked intent is proposal_blocked data", async () => {
    const context = assemble();
    const events: AgentRunEvent[] = [];
    const adapter = new FakeAdapter([
      () => ({ toolCalls: [{ callId: "c1", providerName: "sirkit_placement_propose", argumentsText: JSON.stringify({ candidateCount: 2, maxIterations: 10, intent: { ...HEAD, placements: [{ component: REF.j1, xMm: 10, yMm: 10 }] } }) }] }),
      () => ({ text: "done" }),
    ]);
    const result = await runAgentLoop(
      { runId: "run-prf-e", provider: "openai", history: [], userMessage: "place the connector at 10, 10", budget: { ...DEFAULT_AGENT_BUDGET } },
      { adapter, gateway: createAgentToolGateway(registry, { now: () => T0 }), registry, context, system: "sys", emit: (event) => events.push(event) },
    );
    expect(result.status).toBe("completed");
    const ready = events.filter((event) => event.type === "layout_candidate_ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ type: "layout_candidate_ready", toolId: TOOL, candidate: { kind: "placement", producer: "agent", intent: { applied: true, conflicts: [{ kind: "locked" }] } } });
    const results = adapter.continueInputs[0]!.map((item) => JSON.parse(item.outputText) as Record<string, unknown>);
    expect(results[0]).toMatchObject({ ok: true, status: "layout_candidate_ready", kind: "placement", intent: { applied: true, conflicts: 1, conflictKinds: ["locked"] }, intentNote: PLACEMENT_INTENT_NOTE });
    expect(String(results[0]!.note)).toMatch(/NOTHING on the board has changed/);

    const blockedEvents: AgentRunEvent[] = [];
    const blocked = new FakeAdapter([
      () => ({ toolCalls: [{ callId: "c1", providerName: "sirkit_placement_propose", argumentsText: JSON.stringify({ intent: { ...HEAD, placements: [{ component: { ref: "R9", instanceId: "r9" }, xMm: 1, yMm: 1 }] } }) }] }),
      () => ({ text: "done" }),
    ]);
    await runAgentLoop(
      { runId: "run-prf-e2", provider: "openai", history: [], userMessage: "place R9", budget: { ...DEFAULT_AGENT_BUDGET } },
      { adapter: blocked, gateway: createAgentToolGateway(registry, { now: () => T0 }), registry, context: assemble(), system: "sys", emit: (event) => blockedEvents.push(event) },
    );
    expect(blockedEvents.some((event) => event.type === "layout_candidate_ready")).toBe(false);
    expect(blockedEvents.find((event) => event.type === "tool_finished")).toMatchObject({ ok: false, status: "proposal_blocked" });
    const blockedResult = JSON.parse(blocked.continueInputs[0]![0]!.outputText) as Record<string, unknown>;
    expect(blockedResult).toMatchObject({ ok: false, status: "proposal_blocked", blockers: [{ code: "unknown-component" }] });
  });
});
