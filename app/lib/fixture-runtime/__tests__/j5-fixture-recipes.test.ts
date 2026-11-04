/**
 * [PR-J5, 2026-10-23] Runbook J.6.1-J.6.2 and J.3 item 4, increment J5-C (OD-259 items 4, 6, 7): the FIXTURE half of sheet-aware AI.
 *
 *  1. the drone plan's typed interfaces (a FIXTURE-ONLY plan field; the live planner prompt is not edited): well-formed (at most 16 per
 *     block, the closed direction / kind vocabularies, bounded names, exactly one per shared net in the shared nets' order); PWMn leaves
 *     the MCU (output) and enters the motor stages (input); I2C_SDA / I2C_SCL are bidirectional on every I2C block; IMU_INT1 leaves the
 *     IMU and enters the MCU; each power rail is sourced by exactly one block (VBAT and +3V3 by the power block) and consumed by the
 *     others; GND is the passive ground return everywhere; every declared direction AGREES with the catalog-derived direction of the
 *     generated sheet set's port (never input against output) and every declared rail is a project rail of the set, never a port;
 *  2. the scripted planner turn emits the interfaces per block for the owner's sentence (two motors: two PWM interfaces); the single
 *     designs have no plan - the blinker recipe is byte-identical (digest pinned; no "interfaces" anywhere) and its planner turn is the
 *     empty turn, so the prompt-to-Gerber replay cannot move (3 calls, BLINKER_NETLIST: l7-fixture-vertical-slice, l7-scripted-policy);
 *  3. the organise groups the scripted agent proposes (sheet-organization-groups.ts, imported by builder A's adapter turn): the dimmer's
 *     three groups cover its 14 parts exactly once with U1 OUT -> R2 as the ONE boundary crossing; over the page's own layout of the
 *     dimmer the groups are valid and the ORGANISE planner, following their wire CHAINS, plans them as ONE transaction (every operation
 *     kind inside the executor's move-to-sheet binding), the crossing a port on both sheets, the pin-to-net partition, the 14 identities
 *     and the published footprint set unchanged and no wire end left in the air on any sheet ([PR-J5 integration, 2026-10-26] review
 *     J5R-AI-1: OPEN ISSUE J5-C-1 fixed - the sealed proposal re-plans and applies the same; a group that cuts a route ends it at its sheet
 *     pin; a route a single port cannot end is refused ORGANIZE_DRAWING_DEGRADED, never sealed); the drone groups are the
 *     plan's blocks (the names) with the merge's final reference designators for 1..4 motors, and plan through the organise planner over
 *     the flat drone to the J4 hinted proposal's sheets with the partition kept; `fixtureSheetOrganizationFor` recognises each design by
 *     its parts and nothing else, and a run with no schematic read (no PCB board) that tries `fixtureSheetOrganizationCandidates()` in
 *     order meets each design's own organisation first (`fixtureSheetOrganizationArgs` spells it as the tool's closed input); the
 *     organise sentence routes to the assistant.
 * Pure / in-memory: the committed catalog, the scripted provider, the planners; no network, no database, no clock, no model.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KERNEL_OPERATION_BINDINGS } from "@/app/lib/engineering/executor";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { buildAuthorizationBinding } from "@/app/lib/engineering/proposal-authorization";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import { compileSheetOrganizationProposal, replanSheetOrganization, sealSheetOrganizationProposal } from "@/app/lib/engineering/sheet-organization-proposal";
import { BLINKER_ACCEPTANCE_PROMPT, BLINKER_NETLIST, BLINKER_PART_IDS, FIXTURE_RESOLUTION_PART_IDS, GENERATION_FIXTURE_PART_IDS, fixtureRuntimeCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import { designSubmission, planTurn, scriptedGenerationTurn, type ReturnedPart } from "@/app/lib/fixture-runtime/generation-policy";
import { DRONE_BLOCK_NAMES, DRONE_MAX_MOTORS, PLAN_INTERFACES_PER_BLOCK, PLAN_INTERFACE_DIRECTIONS, PLAN_INTERFACE_KINDS, droneBlockDesign, dronePlan, interfaceDirectionAgrees, selectRecipe, type DesignSpec, type PlanInterfaceSpec, type RequestRecipe } from "@/app/lib/fixture-runtime/generation-recipes";
import { DRONE_SHEET_GROUPS, DRONE_SHEET_NAMES, LED_DIMMER_CROSSINGS, LED_DIMMER_SHEET_GROUPS, ORGANIZE_SHEETS_SENTENCE, droneSheetGroups, fixtureSheetOrganizationArgs, fixtureSheetOrganizationCandidates, fixtureSheetOrganizationFor, type FixtureSheetOrganization } from "@/app/lib/fixture-runtime/sheet-organization-groups";
import { kicadPinWorldPos, pointKey } from "@/app/lib/geometry";
import { mergeBuildNetlists } from "@/app/lib/merge-netlists";
import { routeComposerMessage } from "@/app/lib/project/composer-routing";
import { deriveGeneratedSheets, type GeneratedSheetsPlannedBlock, type PinTypedPart } from "@/app/lib/schematic/generated-sheets";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { organizePlanPorts, organizeSheetId, planOrganizeIntoSheets, sheetDrawingDefects, validateOrganizeGroups } from "@/app/lib/schematic/sheet-organization";
import { sheetOf, validateSheetHierarchy } from "@/app/lib/schematic/sheets";
import { J4_DRONE_HINTED_PROPOSAL, flatDroneProjectState } from "@/app/lib/schematic/__tests__/_j4-organize-fixtures";
import { autoLayoutBuildValidated } from "@/lib/build-auto-layout";
import type { BuildLogicalNetlist, SchematicState } from "@/lib/schematic-types";

const OWNER_FOUR_MOTOR_SENTENCE = "build me a simple drone controlling circuitly with 4 motors just a simple one";
const DIMMER_REQUEST = "Design a 5 V LED dimmer: a 555 timer PWM with a 10k potentiometer setting the brightness, switching the LED through an N-channel MOSFET.";
/** The blinker recipe's content digest (roles' queries and texts, components, connections, explanation) at 5993dd68: the recorded design. */
const BLINKER_DESIGN_DIGEST = "sha256:ce90ae1b3c4d7fde9d4e00e7a325c52e564c442938a338cacd3ecf446b29d116";
/** The LED dimmer recipe's content digest at 5993dd68 (the second ordinary circuit; untouched by J5). */
const LED_DIMMER_DESIGN_DIGEST = "sha256:edcaea81c302218e607e77c9b97b347d0d00324ded57ff2c802aea7d20bfbab5";
const MOTOR_COUNTS = [1, 2, 3, 4] as const;

// ─── The fixture designs as the provider submits them, and the generated sheet set they derive to ────────────────────────────

const ROLE_PART: Readonly<Record<string, string>> = {
  header2: BLINKER_PART_IDS.header, capacitor: BLINKER_PART_IDS.capacitor, resistor: BLINKER_PART_IDS.resistor, led: BLINKER_PART_IDS.led,
  ldo: GENERATION_FIXTURE_PART_IDS.ldo, nmos: GENERATION_FIXTURE_PART_IDS.nmos, schottky: GENERATION_FIXTURE_PART_IDS.schottky, mcu: GENERATION_FIXTURE_PART_IDS.mcu,
  imu: GENERATION_FIXTURE_PART_IDS.imu, "header-isp": GENERATION_FIXTURE_PART_IDS.header2x03, "header-uart": GENERATION_FIXTURE_PART_IDS.header1x04,
  timer: BLINKER_PART_IDS.timer, potentiometer: GENERATION_FIXTURE_PART_IDS.potentiometer, "signal-diode": FIXTURE_RESOLUTION_PART_IDS.eligibleDiode,
};
const catalog = fixtureRuntimeCatalog().cachedParts;
const getPart = (partId: string) => catalog.get(partId) ?? null;
function returned(partId: string): ReturnedPart {
  const part = catalog.get(partId);
  if (!part) throw new Error(`fixture part ${partId} missing`);
  return { partId, mainCategory: part.mainCategory, pins: part.pins.map((pin) => ({ number: pin.number, name: pin.name, type: pin.type ?? "" })), verified: true, orderableValues: null, text: part.name, name: part.name };
}
/** One recipe design as the fixture provider submits it: its roles filled with the committed catalog's parts, endpoints as pin numbers. */
function submitted(design: DesignSpec): BuildLogicalNetlist {
  const filled = new Map(design.roles.map((role) => {
    const part = returned(ROLE_PART[role.key]!);
    const values = new Map(design.components.filter((component) => component.role === role.key).map((component) => [component.ref, component.values === "part-name" ? part.name : component.values[0]!] as const));
    return [role.key, { part, values }] as const;
  }));
  return designSubmission(design, filled) as unknown as BuildLogicalNetlist;
}
const PARTS: PinTypedPart[] = [...new Set(Object.values(ROLE_PART))].map((partId) => ({ partId, pins: returned(partId).pins }));
/** The drone's plan, the merge of its designed blocks (final refDes) and the sheet set the merge derives (as the slice does). */
function droneSheetSet(motors: number) {
  const plan = dronePlan(motors, false);
  const planned: GeneratedSheetsPlannedBlock[] = plan.blocks.map((block, index) => ({ blockId: `b${index + 1}`, name: block.name, sharedNets: block.sharedNets, status: "designed" }));
  const merged = mergeBuildNetlists(plan.blocks.map((block) => ({ name: block.name, netlist: submitted(droneBlockDesign(block.name, block.sharedNets)!) })));
  const doc = deriveGeneratedSheets({ planned, designed: merged.blocks.map((block, index) => ({ blockId: `b${index + 1}`, name: block.name, netlist: block.netlist })), flat: merged.netlist, parts: PARTS });
  return { plan, merged, doc };
}
const single = (prompt: string): DesignSpec => { const recipe = selectRecipe(prompt); if (!recipe || recipe.kind !== "single") throw new Error(`no single recipe for ${prompt}`); return recipe.design; };
/** A design's content digest (RegExp sources included; key order as written). */
const designDigest = (design: DesignSpec): string => `sha256:${createHash("sha256").update(JSON.stringify(design, (_key, value: unknown) => (value instanceof RegExp ? value.toString() : value))).digest("hex")}`;
const identityOf = (state: SchematicState) => state.kicadComponents!.map(({ x: _x, y: _y, rotation: _r, sheetId: _s, ...rest }) => { void _x; void _y; void _r; void _s; return rest; }).sort((a, b) => a.refDes.localeCompare(b.refDes));
/** The page's own layout of a single design (`offerBuildResult`'s `autoLayoutBuildValidated`): a flat page with wires and labels. */
function pageLayout(design: DesignSpec): SchematicState {
  const netlist = submitted(design);
  const used = new Map([...new Set(netlist.components.map((component) => component.partId))].map((partId) => [partId, catalog.get(partId)!] as const));
  const built = autoLayoutBuildValidated(netlist, used);
  expect(built.validation.ok, JSON.stringify(built.validation.violations.slice(0, 3))).toBe(true);
  return built.state;
}
/** [PR-J5 integration, 2026-10-26] review J5R-AI-1: the test-only `chainAttached` helper is gone - the organise planner itself follows wire
 *  chains now (sheet-organization.ts groupEntities), and the helper followed them THROUGH parts outside the group (a cut route moved whole,
 *  its far end left in the air on the new sheet). The proofs below run the real planner and check every sheet's drawing. */
const drawingDefectCount = (state: SchematicState): { danglingEnds: number; islands: number } => {
  let danglingEnds = 0, islands = 0;
  for (const entry of sheetDrawingDefects(state, getPart).values()) { danglingEnds += entry.danglingEnds.length; islands += entry.islands.length; }
  return { danglingEnds, islands };
};

describe("[PR-J5 C] 1. the drone plan's typed interfaces (fixture-only plan field, OD-259 item 6)", () => {
  const plans = MOTOR_COUNTS.flatMap((motors) => [false, true].map((barometer) => ({ motors, barometer, label: `drone(${motors}${barometer ? "+barometer" : ""})`, plan: dronePlan(motors, barometer) })));

  it("every block declares exactly one well-formed interface per shared net, in the shared nets' order, from the closed vocabularies; never a bus", () => {
    for (const { plan, label } of plans) {
      for (const block of plan.blocks) {
        const where = `${label} ${block.name}`;
        expect(block.interfaces, where).toBeDefined();
        const interfaces = block.interfaces!;
        expect(interfaces.length, where).toBeLessThanOrEqual(PLAN_INTERFACES_PER_BLOCK);
        expect(interfaces.map((entry) => entry.net), where).toEqual(block.sharedNets);
        for (const entry of interfaces) {
          expect(Object.keys(entry).sort(), where).toEqual(["direction", "domain", "kind", "net"]);
          expect(PLAN_INTERFACE_DIRECTIONS, where).toContain(entry.direction);
          expect(PLAN_INTERFACE_KINDS, where).toContain(entry.kind);
          expect(entry.kind, where).not.toBe("bus");
          expect(entry.net.length, where).toBeGreaterThan(0);
          expect(entry.net.length, where).toBeLessThanOrEqual(64);
          expect(entry.net, where).toBe(entry.net.trim().toUpperCase());
          expect(entry.domain.length, where).toBeGreaterThan(0);
        }
      }
    }
    expect(PLAN_INTERFACE_DIRECTIONS).toEqual(["input", "output", "bidirectional", "passive"]);
    expect(PLAN_INTERFACE_KINDS).toEqual(["signal", "power", "ground", "bus"]);
    expect(PLAN_INTERFACES_PER_BLOCK).toBe(16);
  });

  it("PWMn leaves the MCU and enters the motor stages; I2C bidirectional on every I2C block; IMU_INT1 from the IMU into the MCU; one source per power rail; GND the passive return", () => {
    for (const { plan, motors, barometer, label } of plans) {
      const of = (name: string): Map<string, PlanInterfaceSpec> => new Map(plan.blocks.find((block) => block.name === name)!.interfaces!.map((entry) => [entry.net, entry]));
      const power = of(DRONE_BLOCK_NAMES.power), stages = of(DRONE_BLOCK_NAMES.motors), mcu = of(DRONE_BLOCK_NAMES.mcu), imu = of(DRONE_BLOCK_NAMES.imu);
      for (let n = 1; n <= motors; n += 1) {
        expect(mcu.get(`PWM${n}`), label).toEqual({ net: `PWM${n}`, direction: "output", kind: "signal", domain: "logic" });
        expect(stages.get(`PWM${n}`), label).toEqual({ net: `PWM${n}`, direction: "input", kind: "signal", domain: "logic" });
      }
      expect(mcu.has(`PWM${motors + 1}`), label).toBe(false);
      expect(stages.has(`PWM${motors + 1}`), label).toBe(false);
      for (const net of ["I2C_SDA", "I2C_SCL"]) for (const block of [mcu, imu]) expect(block.get(net), `${label} ${net}`).toEqual({ net, direction: "bidirectional", kind: "signal", domain: "logic" });
      expect(imu.get("IMU_INT1"), label).toMatchObject({ direction: "output", kind: "signal" });
      expect(mcu.get("IMU_INT1"), label).toMatchObject({ direction: "input", kind: "signal" });
      expect(power.get("VBAT"), label).toEqual({ net: "VBAT", direction: "output", kind: "power", domain: "battery" });
      expect(stages.get("VBAT"), label).toEqual({ net: "VBAT", direction: "input", kind: "power", domain: "battery" });
      expect(power.get("+3V3"), label).toEqual({ net: "+3V3", direction: "output", kind: "power", domain: "logic" });
      for (const block of [mcu, imu]) expect(block.get("+3V3"), label).toEqual({ net: "+3V3", direction: "input", kind: "power", domain: "logic" });
      for (const block of [power, stages, mcu, imu]) expect(block.get("GND"), label).toEqual({ net: "GND", direction: "passive", kind: "ground", domain: "return" });
      // exactly one block sources each power rail (the planner prompt's own rule); every other block that names it consumes it
      for (const rail of ["VBAT", "+3V3"]) {
        expect(plan.blocks.filter((block) => block.interfaces!.some((entry) => entry.net === rail && entry.kind === "power" && entry.direction === "output")).map((block) => block.name), `${label} ${rail} source`).toEqual([DRONE_BLOCK_NAMES.power]);
        expect(plan.blocks.filter((block) => block.interfaces!.some((entry) => entry.net === rail && entry.direction !== "output")).every((block) => block.interfaces!.find((entry) => entry.net === rail)!.direction === "input"), `${label} ${rail} consumers`).toBe(true);
      }
      // every signal that leaves one block enters another: an interface is a connection, not a note
      const signals = plan.blocks.flatMap((block) => block.interfaces!.filter((entry) => entry.kind === "signal"));
      for (const entry of signals.filter((item) => item.direction === "output")) expect(signals.some((item) => item.net === entry.net && item.direction === "input"), `${label} ${entry.net} has a listener`).toBe(true);
      if (barometer) {
        const barometerBlock = of(DRONE_BLOCK_NAMES.barometer);
        expect([...barometerBlock.keys()], label).toEqual(["+3V3", "GND", "I2C_SDA", "I2C_SCL"]);
        expect(barometerBlock.get("I2C_SDA"), label).toMatchObject({ direction: "bidirectional" });
        expect(barometerBlock.get("+3V3"), label).toMatchObject({ direction: "input" });
      }
    }
  });

  it("agrees with the catalog-derived directions of the generated sheet set (never input against output); the declared rails are the set's project rails, never ports", () => {
    for (const motors of MOTOR_COUNTS) {
      const { plan, doc } = droneSheetSet(motors);
      expect(doc.sheets, `drone(${motors}) derives a sheet set`).not.toBeNull();
      const set = doc.sheets!;
      for (const [index, block] of plan.blocks.entries()) {
        const child = set.children[index]!;
        expect(child.name).toBe(block.name);
        const declared = new Map(block.interfaces!.map((entry) => [entry.net, entry]));
        for (const port of child.ports) {
          const entry = declared.get(port.net);
          expect(entry, `${block.name}: ${port.net} is declared`).toMatchObject({ kind: "signal" });
          expect(interfaceDirectionAgrees(entry!.direction, port.direction), `${block.name} ${port.net}: declared ${entry!.direction}, derived ${port.direction}`).toBe(true);
        }
        const portNets = child.ports.map((port) => port.net).sort();
        expect(block.interfaces!.filter((entry) => entry.kind === "signal").map((entry) => entry.net).sort(), `${block.name} signals are exactly its ports`).toEqual(portNets);
        for (const rail of block.interfaces!.filter((entry) => entry.kind !== "signal")) {
          const projectRail = set.rails.find((item) => item.net === rail.net);
          expect(projectRail, `${block.name}: ${rail.net} is a project rail`).toMatchObject({ kind: rail.kind });
          expect(projectRail!.sheets, `${block.name}: ${rail.net} reaches the sheet`).toContain(child.sheetKey);
          expect(portNets).not.toContain(rail.net);
        }
      }
      // the agreement is not vacuous: the derived set carries passive (motor resistors), bidirectional (MCU), input (IMU SCL) and output (IMU INT1) ports
      expect(new Set(set.children.flatMap((child) => child.ports.map((port) => port.direction)))).toEqual(new Set(["passive", "bidirectional", "input", "output"]));
    }
    expect(interfaceDirectionAgrees("input", "output")).toBe(false);
    expect(interfaceDirectionAgrees("output", "input")).toBe(false);
    for (const derived of ["input", "output", "bidirectional", "passive", "unspecified", "tri_state"]) {
      expect(interfaceDirectionAgrees("bidirectional", derived)).toBe(true);
      expect(interfaceDirectionAgrees("passive", derived)).toBe(true);
    }
    expect(interfaceDirectionAgrees("output", "output")).toBe(true);
    expect(interfaceDirectionAgrees("input", "passive")).toBe(true);
  });
});

describe("[PR-J5 C] 2. the scripted planner turn", () => {
  it("emits each block's interfaces for the owner's sentence (equal to the recipe's); two motors give two PWM interfaces; the provider's answer carries them", () => {
    const turn = planTurn(OWNER_FOUR_MOTOR_SENTENCE);
    expect(turn.toolCalls).toHaveLength(1);
    const input = turn.toolCalls[0]!.input as { blocks: Array<{ name: string; brief: string; sharedNets: string[]; interfaces?: PlanInterfaceSpec[] }> };
    expect(input.blocks.map((block) => block.interfaces)).toEqual(dronePlan(4, false).blocks.map((block) => block.interfaces));
    expect(input.blocks.every((block) => Object.keys(block).sort().join(",") === "brief,interfaces,name,sharedNets")).toBe(true);
    const two = planTurn("a drone with 2 motors").toolCalls[0]!.input as typeof input;
    expect(two.blocks[1]!.interfaces!.filter((entry) => entry.net.startsWith("PWM")).map((entry) => `${entry.net}:${entry.direction}`)).toEqual(["PWM1:input", "PWM2:input"]);
    expect(two.blocks[2]!.interfaces!.filter((entry) => entry.net.startsWith("PWM")).map((entry) => `${entry.net}:${entry.direction}`)).toEqual(["PWM1:output", "PWM2:output"]);
    const answer = scriptedGenerationTurn({ provider: "openai", toolChoice: { name: "submit_plan" }, messages: [{ role: "user", content: OWNER_FOUR_MOTOR_SENTENCE }] });
    expect(answer.toolCalls[0]!.input).toEqual(turn.toolCalls[0]!.input);
    // the emitted interfaces are copies: mutating the answer never reaches the recipe
    (answer.toolCalls[0]!.input as typeof input).blocks[2]!.interfaces![0]!.net = "MUTATED";
    expect(dronePlan(4, false).blocks[2]!.interfaces![0]!.net).toBe("+3V3");
  });

  it("the single designs have no plan and no interfaces: the blinker recipe is byte-identical (digest pinned) and the dimmer unchanged", () => {
    for (const prompt of [BLINKER_ACCEPTANCE_PROMPT, DIMMER_REQUEST]) {
      expect(planTurn(prompt), prompt).toEqual({ text: "", toolCalls: [], stopReason: "end_turn" });
      const recipe = selectRecipe(prompt) as RequestRecipe;
      expect(recipe.kind, prompt).toBe("single");
      expect(JSON.stringify(recipe, (_key, value: unknown) => (value instanceof RegExp ? value.toString() : value)), prompt).not.toContain("interfaces");
    }
    const blinker = single(BLINKER_ACCEPTANCE_PROMPT);
    expect(designDigest(blinker)).toBe(BLINKER_DESIGN_DIGEST);
    expect(blinker.components.map((component) => [component.ref, component.values === "part-name" ? null : component.values[0], component.componentRole])).toEqual(BLINKER_NETLIST.components.map((component) => [component.refDes, component.value, component.role]));
    expect(blinker.explanation).toBe(BLINKER_NETLIST.explanation);
    expect(designDigest(single(DIMMER_REQUEST))).toBe(LED_DIMMER_DESIGN_DIGEST);
  });
});

describe("[PR-J5 C] 3. the organise groups the scripted agent proposes (sheet-organization-groups.ts)", () => {
  const dimmer = single(DIMMER_REQUEST);
  const dimmerRefs = dimmer.components.map((component) => component.ref);
  const flatDimmer = pageLayout(dimmer);
  const allowedKinds = new Set<string>(KERNEL_OPERATION_BINDINGS["schematic.move-to-sheet"]);

  it("the dimmer's three groups cover its 14 parts exactly once; U1 OUT -> R2 is the ONE boundary crossing (the rails cross everywhere); the sentence routes to the assistant", () => {
    expect(dimmerRefs).toHaveLength(14);
    expect(LED_DIMMER_SHEET_GROUPS.flatMap((group) => group.refs).sort()).toEqual([...dimmerRefs].sort());
    expect(LED_DIMMER_SHEET_GROUPS.map((group) => group.name)).toEqual(["555 PWM timing", "LED driver", "Power input"]);
    const groupOf = (ref: string): number => LED_DIMMER_SHEET_GROUPS.findIndex((group) => group.refs.includes(ref));
    const endRef = (pinRef: string): string => pinRef.slice(0, pinRef.indexOf(":"));
    const wireCrossings = dimmer.connections.flatMap((connection) => ("wire" in connection && groupOf(endRef(connection.wire[0])) !== groupOf(endRef(connection.wire[1])) ? [connection.wire.join(" -> ")] : []));
    expect(wireCrossings).toEqual(["U1:OUT -> R2:#1"]);
    const labelGroups = new Map<string, Set<number>>();
    for (const connection of dimmer.connections) if ("label" in connection) labelGroups.set(connection.net, new Set([...(labelGroups.get(connection.net) ?? []), groupOf(endRef(connection.label))]));
    expect([...labelGroups.entries()].filter(([, groups]) => groups.size > 1).map(([net]) => net).sort()).toEqual(["GND", "VCC"]);
    expect(LED_DIMMER_CROSSINGS).toEqual([{ between: ["U1", "R2"], name: "PWM_OUT" }]);
    expect(groupOf("U1")).not.toBe(groupOf("R2"));
    expect(ORGANIZE_SHEETS_SENTENCE).toBe("Organize this schematic into subsystem sheets");
    expect(routeComposerMessage(ORGANIZE_SHEETS_SENTENCE, true).route).toBe("ask");
    expect(routeComposerMessage(`${ORGANIZE_SHEETS_SENTENCE}.`, true).route).toBe("ask");
  });

  it("over the page's own layout of the dimmer (a wire-drawn page: multi-segment routes) the groups are valid; the ORGANISE planner follows the wire chains and plans them as ONE transaction (binding kinds only), the crossing a port on both sheets, partition / identities / footprints unchanged, no wire end left in the air on any sheet", () => {
    // [PR-J5 integration, 2026-10-26] pin move (review J5R-AI-1, OPEN ISSUE J5-C-1 fixed; was: the proof moved each group through
    // planMoveToSheet with the test's own chainAttached helper, while planOrganizeIntoSheets refused SHEET_MOVE_AMBIGUOUS - pinned below)
    expect(flatDimmer.kicadComponents).toHaveLength(14);
    expect(flatDimmer.sheets).toBeUndefined();
    expect(validateOrganizeGroups(flatDimmer, LED_DIMMER_SHEET_GROUPS, "root")).toBeNull();
    const before = resolveProjectConnectivity(flatDimmer, getPart);
    expect(before.ok).toBe(true);
    // the page draws two-pin nets as routes of several segments (what one hop of wire per pin could not carry)
    const pinPoints = new Set(flatDimmer.kicadComponents!.flatMap((item) => (catalog.get(item.partId)?.pins ?? []).map((pin) => pointKey(kicadPinWorldPos(item, pin)))));
    expect(flatDimmer.wires.filter((wire) => !pinPoints.has(pointKey(wire.vertices[0]!)) && !pinPoints.has(pointKey(wire.vertices[wire.vertices.length - 1]!))).length, "inner route segments").toBeGreaterThan(0);
    expect(drawingDefectCount(flatDimmer)).toEqual({ danglingEnds: 0, islands: 0 });
    // the crossing net as the page drew it: a wire from U1 OUT to R2, or (no clean route) a deterministically named label pair; its name is the port's
    const u1 = flatDimmer.kicadComponents!.find((item) => item.refDes === "U1")!;
    const crossingNet = before.nets.find((net) => net.pins.some((pin) => pin.componentId === u1.id && pin.pinId === "3"))!;
    expect(crossingNet.pins.map((pin) => flatDimmer.kicadComponents!.find((item) => item.id === pin.componentId)!.refDes).sort()).toEqual(["R2", "U1"]);
    const expectedPort = crossingNet.name ?? "SIG1";
    const plan = planOrganizeIntoSheets(flatDimmer, LED_DIMMER_SHEET_GROUPS, getPart);
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
    for (const operation of plan.operations) expect(allowedKinds.has(operation.kind), operation.kind).toBe(true);
    expect(plan.preview.steps.map((step) => [...new Set(step.crossings.map((crossing) => crossing.port.name))])).toEqual([[expectedPort], [expectedPort], []]);
    const current = plan.after;
    expect(current.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", "555 PWM timing", "LED driver", "Power input"]);
    for (const group of LED_DIMMER_SHEET_GROUPS) {
      const sheet = current.sheets!.sheets.find((item) => item.name === group.name)!;
      expect(current.kicadComponents!.filter((item) => sheetOf(item) === sheet.id).map((item) => item.refDes).sort(), group.name).toEqual([...group.refs].sort());
      expect((sheet.ports ?? []).map((port) => port.name), group.name).toEqual(group.name === "Power input" ? [] : [expectedPort]);
    }
    expect(current.kicadComponents!.filter((item) => sheetOf(item) === "root")).toEqual([]);
    expect(current.wires.filter((item) => sheetOf(item) === "root"), "no wire segment of a moved route stays on the overview").toEqual([]);
    expect(current.wires).toHaveLength(flatDimmer.wires.length);
    expect(drawingDefectCount(current), "no wire end in the air and no wire island on any sheet").toEqual({ danglingEnds: 0, islands: 0 });
    expect(validateSheetHierarchy(current)).toEqual([]);
    const after = resolveProjectConnectivity(current, getPart);
    expect(after.ok).toBe(true);
    expect(after.partitionDigest).toBe(before.partitionDigest);
    expect(identityOf(current)).toEqual(identityOf(flatDimmer));
    // the published footprint set is a function of the identities: 14 instances, every one with its published revision, before and after
    expect(current.kicadComponents!.filter((item) => typeof item.atomicPartRevisionId === "string")).toHaveLength(14);
    // ONE transaction: the batch through the executor's own code is the plan's result
    expect(schematicStateDigest(fromCanonicalSchematic(applySchematicOperationsToCanonical(toCanonicalSchematic(flatDimmer), plan.operations).schematic))).toBe(schematicStateDigest(current));
  });

  it("J5-C-1 fixed (review J5R-AI-1): the organise PROPOSAL over the wire-drawn dimmer seals, re-plans and applies equivalently with a clean drawing; a group whose boundary cuts a route ([C2]; [C2] then [U1]) ends that route at its sheet pin; a route meeting several of a group's pins AND an outside part is refused ORGANIZE_DRAWING_DEGRADED, never sealed", () => {
    // [PR-J5 integration, 2026-10-26] pin move (was: "OPEN ISSUE J5-C-1 (pinned until fixed)": planOrganizeIntoSheets refused the dimmer
    // SHEET_MOVE_AMBIGUOUS because the one-hop attachedSelection left a route's inner segments on the overview; the review then showed a
    // CUT route was sealed with wire ends in the air - [C2] over this layout - since the partition proof cannot see a broken drawing)
    const scope = { tenantId: "local", projectId: "proj-j5c", branchId: "main" };
    const digest = schematicStateDigest(flatDimmer);
    const sealed = (groups: ReadonlyArray<{ name: string; refs: readonly string[] }>) => {
      const compiled = compileSheetOrganizationProposal({ state: flatDimmer, request: { groups: groups.map((group) => ({ name: group.name, members: [...group.refs] })) }, getPart });
      if (!compiled.ok) return { kind: "blocked" as const, blocked: compiled.blockers };
      const out = sealSheetOrganizationProposal({ state: flatDimmer, compilation: compiled.compilation, scope: { ...scope, headMark: { lineageId: "lin1-0123456789abcdef", headSequence: 1, canonicalStateDigest: digest } }, authorization: buildAuthorizationBinding({ principalId: "u-1", membershipRevision: "r-1", scope }), version: "1.0.0", provenance: { provider: "fixture", runId: "run-j5c", note: "", instruction: "" }, now: 1_000 });
      if (out.kind !== "sealed") return { kind: "blocked" as const, blocked: out.blockers };
      const replan = replanSheetOrganization(out.proposal, flatDimmer, getPart);
      if (!replan.ok) throw new Error(replan.detail);
      const applied = fromCanonicalSchematic(applySchematicOperationsToCanonical(toCanonicalSchematic(flatDimmer), replan.operations).schematic);
      expect(schematicStateDigest(applied)).toBe(schematicStateDigest(replan.after));
      expect(resolveProjectConnectivity(applied, getPart).partitionDigest).toBe(resolveProjectConnectivity(flatDimmer, getPart).partitionDigest);
      expect(identityOf(applied)).toEqual(identityOf(flatDimmer));
      return { kind: "sealed" as const, proposal: out.proposal, applied };
    };
    const dimmer = sealed(LED_DIMMER_SHEET_GROUPS);
    if (dimmer.kind !== "sealed") throw new Error(JSON.stringify(dimmer.blocked));
    expect(dimmer.proposal.groups.map((group) => group.name)).toEqual(LED_DIMMER_SHEET_GROUPS.map((group) => group.name));
    expect(drawingDefectCount(dimmer.applied)).toEqual({ danglingEnds: 0, islands: 0 });
    // the reviewer's failing inputs: a group that CUTS a page-drawn route (C2.1 -> U1.5, several segments): the route stays whole on the
    // overview and the new port's sheet pin sits where C2.1 was, so every wire end still meets a pin or a label on every sheet (was: two
    // dangling ends; with [C2] then [U1] five, and two wire islands on the overview touching no pin or label)
    const c2 = flatDimmer.kicadComponents!.find((item) => item.refDes === "C2")!;
    const c2Pin1 = kicadPinWorldPos(c2, catalog.get(c2.partId)!.pins.find((pin) => pin.number === "1")!);
    for (const groups of [[{ name: "Decoupling", refs: ["C2"] }], [{ name: "Decoupling", refs: ["C2"] }, { name: "Timer", refs: ["U1"] }]]) {
      const label = groups.map((group) => group.refs.join(",")).join(" | ");
      const outcome = sealed(groups);
      if (outcome.kind !== "sealed") throw new Error(`${label}: ${JSON.stringify(outcome.blocked)}`);
      expect(drawingDefectCount(outcome.applied), label).toEqual({ danglingEnds: 0, islands: 0 });
      expect(outcome.applied.wires.filter((wire) => sheetOf(wire) === "root"), `${label}: the cut routes stay whole on the overview`).toHaveLength(flatDimmer.wires.length);
      const pin = (outcome.applied.netLabels ?? []).find((item) => (item as { scope?: string }).scope === "sheet-pin" && sheetOf(item) === "root" && item.position.x === c2Pin1.x && item.position.y === c2Pin1.y);
      expect(pin, `${label}: the Decoupling port's sheet pin ends the C2.1 route where C2.1 was`).toBeDefined();
    }
    // a route that meets two of a group's pins and an outside part (R1.2 and RV1.2 with U1.7) cannot end at ONE sheet pin: refused, nothing sealed
    const split = sealed([{ name: "Pot", refs: ["R1", "RV1"] }]);
    if (split.kind !== "blocked") throw new Error("the R1 + RV1 split was sealed");
    expect(split.blocked[0]!.code).toBe("plan-refused");
    expect(split.blocked[0]!.detail).toContain("ORGANIZE_DRAWING_DEGRADED");
    expect(split.blocked[0]!.detail).toContain("Nothing was changed.");
    // every one- and two-part group over this page: either refused, or planned with a clean drawing - never a planned broken one
    const refs = flatDimmer.kicadComponents!.map((item) => item.refDes);
    const codes = new Map<string, number>();
    let planned = 0;
    for (let i = 0; i < refs.length; i += 1) for (let j = i; j < refs.length; j += 1) {
      const group = { name: "G", refs: i === j ? [refs[i]!] : [refs[i]!, refs[j]!] };
      const plan = planOrganizeIntoSheets(flatDimmer, [group], getPart);
      if (plan.ok) { planned += 1; expect(drawingDefectCount(plan.after), group.refs.join(",")).toEqual({ danglingEnds: 0, islands: 0 }); }
      else codes.set(plan.code, (codes.get(plan.code) ?? 0) + 1);
    }
    expect(planned + [...codes.values()].reduce((sum, count) => sum + count, 0)).toBe(105);
    expect([...codes.keys()]).toEqual(["ORGANIZE_DRAWING_DEGRADED"]);
    expect(planned).toBeGreaterThan(90);
    // [PR-J5 integration, 2026-10-26] only a NEW defect refuses: a stub the drawing already had (C2.1 to an empty grid point) moves with C2 and
    // keeps its dangling end - the same wire end, now on the new sheet - and the organisation still plans (a per-sheet count refused it)
    const stubbed: SchematicState = { ...flatDimmer, wires: [...flatDimmer.wires, { id: "j5c-stub", vertices: [{ x: c2Pin1.x, y: c2Pin1.y }, { x: c2Pin1.x - 40, y: c2Pin1.y }] } as SchematicState["wires"][number]] };
    expect(drawingDefectCount(stubbed)).toEqual({ danglingEnds: 1, islands: 0 });
    const withStub = planOrganizeIntoSheets(stubbed, LED_DIMMER_SHEET_GROUPS, getPart);
    if (!withStub.ok) throw new Error(`${withStub.code}: ${withStub.message}`);
    expect(drawingDefectCount(withStub.after)).toEqual({ danglingEnds: 1, islands: 0 });
    expect(sheetOf(withStub.after.wires.find((wire) => wire.id === "j5c-stub")!)).toBe(organizeSheetId(LED_DIMMER_SHEET_GROUPS[0]!.refs));
  });

  it("the drone groups are the plan's blocks: the names equal DRONE_BLOCK_NAMES, the refs equal the merge's final reference designators for 1..4 motors; outside 1..4 null", () => {
    expect(DRONE_SHEET_NAMES).toEqual({ power: DRONE_BLOCK_NAMES.power, motors: DRONE_BLOCK_NAMES.motors, mcu: DRONE_BLOCK_NAMES.mcu, imu: DRONE_BLOCK_NAMES.imu });
    for (const motors of MOTOR_COUNTS) {
      const { plan, merged } = droneSheetSet(motors);
      const groups = droneSheetGroups(motors)!;
      expect(groups.map((group) => group.name), `drone(${motors})`).toEqual(plan.blocks.map((block) => block.name));
      expect(groups.map((group) => [...group.refs].sort()), `drone(${motors})`).toEqual(merged.blocks.map((block) => block.netlist.components.map((component) => component.refDes).sort()));
      expect(groups.flatMap((group) => group.refs), `drone(${motors})`).toHaveLength(merged.netlist.components.length);
      expect(new Set(groups.flatMap((group) => group.refs)).size).toBe(merged.netlist.components.length);
    }
    expect(DRONE_MAX_MOTORS).toBe(4);
    for (const motors of [0, 5, 2.5, Number.NaN]) expect(droneSheetGroups(motors), String(motors)).toBeNull();
    expect(DRONE_SHEET_GROUPS).toEqual(droneSheetGroups(4));
    expect(DRONE_SHEET_GROUPS.flatMap((group) => group.refs)).toHaveLength(41);
  });

  it("plans through the organise planner over the flat fixture drone to the J4 hinted proposal's sheets: four sheets with the exact ports (binding kinds only), 41 instances, the partition digest kept", () => {
    const flat = flatDroneProjectState();
    const plan = planOrganizeIntoSheets(flat, DRONE_SHEET_GROUPS, getPart);
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
    for (const operation of plan.operations) expect(allowedKinds.has(operation.kind), operation.kind).toBe(true);
    const sameRefs = (a: readonly string[], b: readonly string[]): boolean => [...a].sort().join(",") === [...b].sort().join(",");
    const ports = new Map(organizePlanPorts(plan).map((entry) => [entry.sheetName, entry.ports] as const));
    for (const group of DRONE_SHEET_GROUPS) {
      const hinted = J4_DRONE_HINTED_PROPOSAL.find((item) => sameRefs(item.refs, group.refs));
      expect(hinted, `${group.name} is one of the J4 hinted proposal's groups`).toBeDefined();
      expect(ports.get(group.name), group.name).toEqual([...hinted!.ports].sort());
      const sheet = plan.after.sheets!.sheets.find((item) => item.name === group.name)!;
      expect(plan.after.kicadComponents!.filter((item) => sheetOf(item) === sheet.id).map((item) => item.refDes).sort(), group.name).toEqual([...group.refs].sort());
    }
    expect(plan.after.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", DRONE_BLOCK_NAMES.power, DRONE_BLOCK_NAMES.motors, DRONE_BLOCK_NAMES.mcu, DRONE_BLOCK_NAMES.imu]);
    expect(plan.after.kicadComponents).toHaveLength(41);
    expect(plan.preview.componentCount).toBe(41);
    expect(resolveProjectConnectivity(plan.after, getPart).partitionDigest).toBe(resolveProjectConnectivity(flat, getPart).partitionDigest);
    expect(identityOf(plan.after)).toEqual(identityOf(flat));
    expect(validateSheetHierarchy(plan.after)).toEqual([]);
    expect(planOrganizeIntoSheets(flatDroneProjectState(), DRONE_SHEET_GROUPS, getPart)).toEqual(plan);
  });

  it("fixtureSheetOrganizationFor recognises each design by its parts (any order, repeats ignored) and nothing else; names and rationales within the sheet and proposal bounds", () => {
    const dimmerFound = fixtureSheetOrganizationFor([...dimmerRefs].reverse());
    expect(dimmerFound).toMatchObject({ key: "led-dimmer", motors: null, crossings: [{ between: ["U1", "R2"], name: "PWM_OUT" }] });
    expect(dimmerFound!.groups).toEqual(LED_DIMMER_SHEET_GROUPS);
    expect(fixtureSheetOrganizationFor([...dimmerRefs, "U1", " R1 "])!.key).toBe("led-dimmer");
    for (const motors of MOTOR_COUNTS) {
      const { merged } = droneSheetSet(motors);
      const found = fixtureSheetOrganizationFor(merged.netlist.components.map((component) => component.refDes));
      expect(found, `drone(${motors})`).toMatchObject({ key: "drone", motors, crossings: [] });
      expect(found!.groups).toEqual(droneSheetGroups(motors));
      expect(found!.rationale).toContain(`PWM${motors}`);
      expect(found!.rationale).not.toContain(`PWM${motors + 1}`);
    }
    // [PR-J5, 2026-10-23] a run with NO schematic read (no PCB board, so no canonical-state resource) tries the candidates in order and the
    // tool refuses every proposal naming a part the schematic does not hold: the FIRST candidate whose every member the design holds must
    // be the design's own organisation, for each fixture design - and no candidate fits the blinker (nothing is proposed for it)
    const candidates = fixtureSheetOrganizationCandidates();
    expect(candidates.map((organization) => `${organization.key}:${organization.motors ?? "-"}`)).toEqual(["led-dimmer:-", "drone:4", "drone:3", "drone:2", "drone:1"]);
    const firstFitting = (refs: readonly string[]): FixtureSheetOrganization | null => candidates.find((organization) => organization.groups.every((group) => group.refs.every((ref) => refs.includes(ref)))) ?? null;
    expect(firstFitting(dimmerRefs)).toEqual(dimmerFound);
    for (const motors of MOTOR_COUNTS) {
      const designRefs = droneSheetSet(motors).merged.netlist.components.map((component) => component.refDes);
      expect(firstFitting(designRefs), `drone(${motors})`).toEqual(fixtureSheetOrganizationFor(designRefs));
      expect(firstFitting(designRefs)!.motors, `drone(${motors})`).toBe(motors);
    }
    expect(firstFitting(BLINKER_NETLIST.components.map((component) => component.refDes))).toBeNull();
    // the tool's closed input: { groups: [{ name, members }] } only, in the organisation's order, as fresh arrays (never the frozen data)
    const args = fixtureSheetOrganizationArgs(dimmerFound!);
    expect(Object.keys(args)).toEqual(["groups"]);
    expect(args.groups).toEqual(LED_DIMMER_SHEET_GROUPS.map((group) => ({ name: group.name, members: [...group.refs] })));
    expect(args.groups.every((group) => Object.keys(group).join(",") === "name,members")).toBe(true);
    args.groups[0]!.members.push("MUTATED");
    expect(LED_DIMMER_SHEET_GROUPS[0]!.refs).not.toContain("MUTATED");
    expect(fixtureSheetOrganizationFor(dimmerRefs.slice(1))).toBeNull();
    expect(fixtureSheetOrganizationFor([...dimmerRefs, "R9"])).toBeNull();
    expect(fixtureSheetOrganizationFor(BLINKER_NETLIST.components.map((component) => component.refDes))).toBeNull();
    expect(fixtureSheetOrganizationFor([])).toBeNull();
    for (const organization of [dimmerFound!, ...MOTOR_COUNTS.map((motors) => fixtureSheetOrganizationFor(droneSheetGroups(motors)!.flatMap((group) => group.refs))!)]) {
      expect(organization.rationale.length).toBeGreaterThan(40);
      expect(organization.rationale.length).toBeLessThanOrEqual(600);
      expect(organization.groups.length).toBeLessThanOrEqual(8);
      for (const group of organization.groups) {
        expect(group.name).not.toContain("/");
        expect(group.name.trim()).toBe(group.name);
        expect(group.name.length).toBeGreaterThan(0);
        expect(group.name.length).toBeLessThanOrEqual(80);
        expect(group.refs.length).toBeGreaterThan(0);
      }
      for (const crossing of organization.crossings) {
        const [a, b] = crossing.between;
        expect(organization.groups.findIndex((group) => group.refs.includes(a))).not.toBe(organization.groups.findIndex((group) => group.refs.includes(b)));
        expect(crossing.name).toMatch(/^[A-Z][A-Z0-9_]{0,31}$/);
      }
    }
  });
});
