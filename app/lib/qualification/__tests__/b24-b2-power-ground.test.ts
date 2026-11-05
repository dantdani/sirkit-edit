/**
 * [B24-B2] Power and ground preservation (D24-16, OD-205; runbook B24-B :1058 "- power and ground preservation;"), one offline
 * evaluation per agent verb, each through the agent's own path - the production registry's gateway and its invocation services,
 * driven as b09-proposals and b09-1-boundary drive them - with the sealed operations applied through the canonical executor. The
 * facts and the contract are `_power-ground-facts.ts` (OD-228 (c)): every power/ground net's name, symbols and member pins (keyed by
 * component id and pin), and on a board its net-class assignment and pads; a net is exempt only when the sealed proposal names it
 * (operation targets, removedLabelNames), and the member rule has no exemption.
 *
 *  1. the facts and each rule bite: a mutated plan that drops a power symbol it does not name, a renamed GND net, a surviving pin
 *     that leaves GND, a changed net class; a KiCad rename is no change;
 *  2. delete (sirkit.schematic.propose-tier1-edit): a theory part with GND on one pin and VCC on the other - every other fact
 *     unchanged, and the proposal names exactly what it removes;
 *  3. delete: a theory part that reaches GND through a wire, no symbol at its pin - the wire goes, GND is not named, no surviving
 *     pin's fact changes;
 *  4. delete: a KiCad part is refused `pins-unavailable` (the gateway compiles Tier 1 with an empty pin map) and nothing changes;
 *  5. replace (sirkit.schematic.propose-component-replacement, the B21 F1/D3 fixture with GND and VCC on U1): every power/ground pin
 *     keeps its net and its symbols through the family's own approval path, one canonical transaction;
 *  6. replace: a target that would drop the connected VCC pin is refused `replacement-plan-refused`, nothing sealed or changed (the
 *     agent path can never acknowledge a drop);
 *  7. edit: Tier 1 set-value (theory) and rename (KiCad) change no fact; a theory rename refuses `unsupported-theory-rename`;
 *  8. edit: one granted PCB move (sirkit.pcb.move-footprint) changes no net-class membership and no pad;
 *  9. OD-229 approved: a shared-wire AI delete refuses before sealing. The original counterexample is retained in B24's reports;
 *     the AI compiler now protects the batch's surviving circuitry, using canonical connectivity.
 *     Human-editor deletion retains its existing semantics;
 * 10. the catalog links this suite under power-ground x deterministic offline.
 *
 * Failing first on b0af256: the suite and its catalog link are absent (ci-admission.md section 2). Nothing is written to disk and no
 * process is started; no network (the replacement family's reauthorization channel is routed into its real in-process handler).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KicadPin } from "@/app/lib/kicad/types";
import type { NetLabel, SchComponent, SchematicState } from "@/lib/schematic-types";
import { kicadPinWorldPos, pinWorldPos } from "@/app/lib/geometry";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import type { AgentRunContext, GatewayInvocationOutcome } from "@/app/lib/agent/contracts";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { TIER1_PROPOSAL_SCHEMA, verifySealedTier1Proposal, type SealedTier1Proposal, type Tier1ProposalHeadMark } from "@/app/lib/engineering/schematic-proposals";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import type { EngineeringOperation } from "@/app/lib/engineering/types";
import type { PublishedSymbolPinFacts } from "@/app/lib/engineering/replacement-pin-facts";
import type { SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { createHistory } from "@/app/lib/pcb/history";
import { buildExecutionOperations } from "@/app/lib/engineering/execution-operations";
import { bindCanonicalEditorSession, canonicalSessionFor } from "@/app/lib/engineering/editor-adapter";
import { pcbBoardInstanceId } from "@/app/lib/pcb/board-identity";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import { mmToNm } from "@/app/lib/pcb/units";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { ExecutionGrantStore } from "@/app/lib/execution-grant/store";
import { createExecutionGrantMinter } from "@/app/lib/execution-grant/mint";
import { AGENT_AUTONOMY_SCHEMA, type AgentAutonomySetting } from "@/app/lib/engineering/permission-tiers";
import { AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";
import { GOLDEN_EVAL_CATALOG } from "@/app/lib/evaluation/golden-catalog";
import { CURRENT_FACTS, D3_SCOPE, REPLACEMENT, TARGET_FACTS, TIER1, TIMER, TIMER_PINS, approveReplacement, installCatalog, principalOf, resetCatalog, stubReplacementAuthorityFetch, timerContext, timerSchematic, type RecordingPinFactsSource, type TimerEditor } from "@/app/lib/agent/orchestration/__tests__/_d3-fixtures";
import { powerGroundFacts, powerGroundViolations, type PinsOf } from "./_power-ground-facts";

const SELF = "app/lib/qualification/__tests__/b24-b2-power-ground.test.ts";
const registry = sirkitToolRegistry();
const SCOPE = { tenantId: "local", projectId: "p-b24-b2-pg", branchId: "main" };
const label = (id: string, position: { x: number; y: number }, name: string, kind: NetLabel["kind"]): NetLabel => ({ id, position: { ...position }, name, kind, orientation: 0 });

// ── the Tier 1 path (b09-proposals' pattern): the gateway seals, the trusted session applies ───────────────────────────────────
function tier1Context(schematic: SchematicState, headMark: Tier1ProposalHeadMark): AgentRunContext {
  const assembly = assembleAgentRunContext({ ...SCOPE, schematic, board: createEmptyBoard(), schematicHeadMark: headMark });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
async function readyEditor(state: SchematicState): Promise<SchematicEditorSession> {
  const editor = new SchematicEditorSession({ ...SCOPE }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(structuredClone(state), null);
  return editor;
}
const sealTier1 = (ops: unknown, schematic: SchematicState, editor: SchematicEditorSession): Promise<GatewayInvocationOutcome> =>
  createAgentToolGateway(registry).invoke({ runId: "run-b24-b2-pg", provider: "openai", toolId: TIER1, version: registry.get(TIER1)!.version, args: { ops }, context: tier1Context(schematic, editor.headMark()!), timeoutMs: 5_000 });
function sealedTier1(outcome: GatewayInvocationOutcome): SealedTier1Proposal {
  if (outcome.kind !== "proposal" || outcome.proposal.schema !== TIER1_PROPOSAL_SCHEMA) throw new Error(`expected a sealed Tier 1 proposal, got ${JSON.stringify(outcome).slice(0, 300)}`);
  return outcome.proposal;
}
/** The explicit apply: verify the sealed artifact, then ONE canonical transaction of exactly its operations. */
async function applyTier1(editor: SchematicEditorSession, state: SchematicState, proposal: SealedTier1Proposal, operations: readonly EngineeringOperation[] = proposal.operations): Promise<SchematicState> {
  const verification = verifySealedTier1Proposal(proposal, { currentSchematicDigest: schematicStateDigest(state), now: Date.now(), expectedScope: { ...SCOPE, headMark: editor.headMark()! } });
  if (!verification.ok) throw new Error(`verification refused: ${JSON.stringify(verification)}`);
  const result = await editor.execute(structuredClone(state), { commandId: "schematic.edit-tier1-apply", label: "Applied AI edit proposal", buildOperations: () => structuredClone(operations) as EngineeringOperation[], expectedBaseDigest: proposal.baseSchematicDigest, expectedHeadMark: proposal.scope.headMark });
  if (result.status !== "executed") throw new Error(`apply did not execute: ${JSON.stringify(result).slice(0, 300)}`);
  return result.state as SchematicState;
}
/** The names a sealed Tier 1 proposal gives (its sealed removedLabelNames; its operations target components, never a net). */
const namedBy = (proposal: SealedTier1Proposal): string[] => proposal.impacts.deletes.flatMap((plan) => plan.removedLabelNames);
const deletedBy = (proposal: SealedTier1Proposal): string[] => proposal.impacts.deletes.map((plan) => plan.componentId);

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const r = (id: string, x: number, y: number) => ({ id, type: "resistor" as const, x, y, rotation: 0 as const, value: "10k" });
const c = (id: string, x: number, y: number) => ({ id, type: "capacitor" as const, x, y, rotation: 0 as const, value: "100n" });
const at = (component: SchComponent, pin: "left" | "right") => pinWorldPos(component, pin);
/** R1 carries GND on its left pin and VCC on its right; C1 carries both again; C2 holds an unrelated +5V and AGND (a wire to it). */
function symbolsAtPins(): SchematicState {
  const r1 = r("r1", 100, 100), c1 = c("c1", 200, 200), c2 = c("c2", 300, 300);
  return {
    components: [r1, c1, c2],
    wires: [{ id: "w-agnd", vertices: [at(c2, "right"), { x: at(c2, "right").x + 40, y: at(c2, "right").y }] }],
    netLabels: [
      label("gnd-r1", at(r1, "left"), "GND", "ground"), label("vcc-r1", at(r1, "right"), "VCC", "power"),
      label("gnd-c1", at(c1, "right"), "GND", "ground"), label("vcc-c1", at(c1, "left"), "VCC", "power"),
      label("p5v-c2", at(c2, "left"), "+5V", "power"), label("agnd-c2", { x: at(c2, "right").x + 40, y: at(c2, "right").y }, "AGND", "ground"),
    ],
    kicadComponents: [],
  };
}
/** R2 reaches GND only through a wire into C3's left pin, where the GND symbol sits; C4 holds a second GND member. */
function groundThroughWire(): SchematicState {
  const r2 = r("r2", 100, 100), c3 = c("c3", 200, 100), c4 = c("c4", 200, 220);
  return {
    components: [r2, c3, c4],
    wires: [{ id: "w-r2-c3", vertices: [at(r2, "right"), at(c3, "left")] }],
    netLabels: [label("gnd-c3", at(c3, "left"), "GND", "ground"), label("gnd-c4", at(c4, "left"), "GND", "ground"), label("vcc-c4", at(c4, "right"), "VCC", "power")],
    kicadComponents: [],
  };
}
/** The recorded counterexample: ONE wire starts on R4's right pin, passes through C5's left pin and ends on C6's left pin, where GND sits. */
function wireThroughDeletedPin(): SchematicState {
  const r4 = r("r4", 100, 100), c5 = c("c5", 200, 100), c6 = c("c6", 260, 220);
  const corner = { x: at(c5, "left").x, y: at(c6, "left").y };
  return {
    components: [r4, c5, c6],
    wires: [{ id: "w-through", vertices: [at(r4, "right"), at(c5, "left"), corner, at(c6, "left")] }],
    netLabels: [label("gnd-c6", at(c6, "left"), "GND", "ground")],
    kicadComponents: [],
  };
}
/** U1 (KiCad, the D3 timer) with GND reached by a wire into pin 1 and VCC on pin 2; a theory capacitor shares GND. */
const U1 = timerSchematic().kicadComponents![0]!;
const PIN1 = kicadPinWorldPos(U1, TIMER_PINS[0]!);
const PIN2 = kicadPinWorldPos(U1, TIMER_PINS[1]!);
function timerWithRails(): SchematicState {
  const base = timerSchematic();
  const far = base.wires[0]!.vertices[0]!;
  const c9 = c("c9", far.x - 30, far.y);
  return { ...base, components: [c9], netLabels: [label("gnd-u1", far, "GND", "ground"), label("vcc-u1", PIN2, "VCC", "power")] };
}
const timerPins: PinsOf = (partId) => (partId === U1.partId ? TIMER_PINS : null);

describe("[B24-B2] power and ground preservation (D24-16, OD-205)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetCatalog();
  });

  it("1. the facts name each power/ground net with its symbols and member pins by id (a KiCad rename is no change), and each rule bites: a mutated plan dropping a power symbol it does not name, a renamed GND net, a surviving pin leaving GND, a changed net class", () => {
    const facts = powerGroundFacts(symbolsAtPins());
    expect(facts.nets.map((net) => [net.role, net.name, net.symbols, net.members])).toEqual([
      ["ground", "AGND", ["ground:AGND"], ["c2:right"]],
      ["ground", "GND", ["ground:GND", "ground:GND"], ["c1:right", "r1:left"]],
      ["power", "+5V", ["power:+5V"], ["c2:left"]],
      ["power", "VCC", ["power:VCC", "power:VCC"], ["c1:left", "r1:right"]],
    ]);
    expect(powerGroundViolations(facts, powerGroundFacts(symbolsAtPins()))).toEqual([]);
    // a KiCad rename changes the refDes only: members are keyed by the stable id
    const renamed = timerWithRails();
    renamed.kicadComponents = renamed.kicadComponents!.map((instance) => ({ ...instance, refDes: "U7" }));
    expect(powerGroundViolations(powerGroundFacts(timerWithRails(), undefined, timerPins), powerGroundFacts(renamed, undefined, timerPins))).toEqual([]);
    expect(powerGroundFacts(timerWithRails(), undefined, timerPins).nets.map((net) => [net.name, net.members])).toEqual([["GND", ["c9:right", `${TIMER}:1`]], ["VCC", [`${TIMER}:2`]]]);
    // bite: the +5V symbol dropped, and the proposal names only GND and VCC
    const dropped = symbolsAtPins();
    dropped.netLabels = dropped.netLabels!.filter((entry) => entry.id !== "p5v-c2");
    expect(powerGroundViolations(facts, powerGroundFacts(dropped), { named: ["GND", "VCC"] }).join(" ")).toMatch(/net changed or lost: .*"\+5V"/);
    // bite: GND renamed GND2 (nothing named)
    const regrounded = symbolsAtPins();
    regrounded.netLabels = regrounded.netLabels!.map((entry) => (entry.name === "GND" ? { ...entry, name: "GND2" } : entry));
    expect(powerGroundViolations(facts, powerGroundFacts(regrounded)).join(" ")).toMatch(/net changed or lost: .*"name":"GND"[\s\S]*net changed or gained: .*"name":"GND2"/);
    // bite: a surviving pin leaves GND (its label moved off the pin), even though GND is named
    const left = symbolsAtPins();
    left.netLabels = left.netLabels!.map((entry) => (entry.id === "gnd-c1" ? { ...entry, position: { x: entry.position.x + 500, y: entry.position.y } } : entry));
    expect(powerGroundViolations(facts, powerGroundFacts(left), { named: ["GND"] })).toEqual(expect.arrayContaining(["member c1:right: ground [c1:right, r1:left] -> on no power/ground net", "member r1:left: ground [c1:right, r1:left] -> ground [r1:left]"]));
    // bite: a changed net class on a board
    const board = railBoard();
    const reclassed = structuredClone(board);
    reclassed.netClassing!.assignments[1] = { classId: "HighCurrent", explanation: "changed" };
    expect(powerGroundViolations(powerGroundFacts(symbolsAtPins(), board), powerGroundFacts(symbolsAtPins(), reclassed)).join(" ")).toMatch(/board net changed or lost: .*"name":"VCC"/);
  });

  it("2. delete through the agent's Tier 1 path: a theory part with GND on one pin and VCC on the other - the sealed proposal names exactly GND and VCC, and every other power/ground fact is unchanged after the canonical apply", { timeout: 30_000 }, async () => {
    const state = symbolsAtPins();
    const editor = await readyEditor(state);
    const proposal = sealedTier1(await sealTier1([{ op: "delete", target: "r1" }], state, editor));
    expect(namedBy(proposal)).toEqual(["GND", "VCC"]);
    expect(proposal.impacts.deletes[0]).toMatchObject({ componentId: "r1", removeNetLabelIds: ["gnd-r1", "vcc-r1"], removeWireIds: [] });
    const after = await applyTier1(editor, state, proposal);
    expect(after.components.map((component) => component.id)).toEqual(["c1", "c2"]);
    expect(powerGroundViolations(powerGroundFacts(state), powerGroundFacts(after), { targets: deletedBy(proposal), named: namedBy(proposal) })).toEqual([]);
    // the named nets survive through C1's own symbols
    expect(powerGroundFacts(after).nets.map((net) => [net.name, net.symbols, net.members])).toEqual([["AGND", ["ground:AGND"], ["c2:right"]], ["GND", ["ground:GND"], ["c1:right"]], ["+5V", ["power:+5V"], ["c2:left"]], ["VCC", ["power:VCC"], ["c1:left"]]]);
    // ... and the mutated plan that drops the +5V symbol it does not name is caught on the canonical apply
    const mutated = proposal.operations.map((operation) => (operation.kind === "schematic_delete_component" ? { ...operation, removeNetLabelIds: [...operation.removeNetLabelIds, "p5v-c2"] } : operation)) as EngineeringOperation[];
    const editor2 = await readyEditor(state);
    const proposal2 = sealedTier1(await sealTier1([{ op: "delete", target: "r1" }], state, editor2));
    const mutatedAfter = await applyTier1(editor2, state, proposal2, mutated);
    expect(powerGroundViolations(powerGroundFacts(state), powerGroundFacts(mutatedAfter), { targets: deletedBy(proposal2), named: namedBy(proposal2) }).join(" ")).toMatch(/net changed or lost: .*"\+5V"/);
  });

  it("3. delete: a theory part that reaches GND only through a wire - the wire goes, GND is not named, and no surviving pin's fact changes", { timeout: 30_000 }, async () => {
    const state = groundThroughWire();
    const editor = await readyEditor(state);
    const proposal = sealedTier1(await sealTier1([{ op: "delete", target: "r2" }], state, editor));
    expect(proposal.impacts.deletes[0]).toMatchObject({ componentId: "r2", removeWireIds: ["w-r2-c3"], removeNetLabelIds: [], removedLabelNames: [] });
    const after = await applyTier1(editor, state, proposal);
    expect(after.wires).toEqual([]);
    expect(namedBy(proposal)).toEqual([]);
    expect(powerGroundViolations(powerGroundFacts(state), powerGroundFacts(after), { targets: deletedBy(proposal), named: [] })).toEqual([]);
    expect(powerGroundFacts(after).nets.find((net) => net.name === "GND")).toMatchObject({ symbols: ["ground:GND", "ground:GND"], members: ["c3:left", "c4:left"] });
    // bite: the GND net renamed after the same delete is caught (nothing names it)
    const renamed = structuredClone(after);
    renamed.netLabels = renamed.netLabels!.map((entry) => (entry.name === "GND" ? { ...entry, name: "GND2" } : entry));
    expect(powerGroundViolations(powerGroundFacts(state), powerGroundFacts(renamed), { targets: deletedBy(proposal), named: [] }).length).toBeGreaterThan(0);
  });

  it("4. delete: a KiCad part is refused pins-unavailable through the agent's path (no pin data in the run context) and nothing changes", { timeout: 30_000 }, async () => {
    const state = timerWithRails();
    const editor = await readyEditor(state);
    const before = schematicStateDigest(state);
    const outcome = await sealTier1([{ op: "delete", target: "U1" }], state, editor);
    expect(outcome.kind).toBe("proposal-blocked");
    if (outcome.kind !== "proposal-blocked") return;
    expect(outcome.blockers.map((blocker) => blocker.code)).toEqual(["pins-unavailable"]);
    expect(schematicStateDigest(state)).toBe(before);
    expect(editor.events.filter((event) => event.kind === "executed")).toHaveLength(0);
    expect(powerGroundViolations(powerGroundFacts(timerWithRails(), undefined, timerPins), powerGroundFacts(state, undefined, timerPins))).toEqual([]);
  });

  it("5. replace through the agent's path (the F1/D3 fixture): the exact target seals, the family's approval path applies one canonical transaction, and every power/ground pin keeps its net and its symbols - U1's own pins included", { timeout: 60_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    const moved = targetFacts([TIMER_PINS[0]!, { ...TIMER_PINS[1]!, position: { x: 5, y: 0 } }]);
    const source = pinFactsSource(moved);
    const catalog = await installCatalog(D3_SCOPE, { pinFacts: source });
    const live = await principalOf(D3_SCOPE);
    stubReplacementAuthorityFetch();
    const state = timerWithRails();
    const editor = await editorOver(state);
    const outcome = await createAgentToolGateway(registry, { replacementPinFacts: (revision, role) => source.loadPinFacts(revision, undefined, role) })
      .invoke({ runId: "run-b24-b2-replace", provider: "openai", toolId: REPLACEMENT, version: registry.get(REPLACEMENT)!.version, args: { componentId: TIMER }, context: timerContext(editor, catalog.authority, live, D3_SCOPE), timeoutMs: 10_000 });
    expect(outcome.kind, JSON.stringify(outcome).slice(0, 400)).toBe("proposal");
    if (outcome.kind !== "proposal") return;
    const proposal = outcome.proposal as SealedReplacementProposal;
    expect(proposal.impact.droppedConnections).toEqual([]);
    const applied = await approveReplacement(editor, proposal, "run-b24-b2-replace", D3_SCOPE);
    expect(applied, JSON.stringify(applied).slice(0, 400)).toMatchObject({ ok: true, status: "committed" });
    expect(editor.executed()).toBe(1);
    const after = editor.visible();
    const pinsAfter: PinsOf = (partId) => (partId === U1.partId ? TIMER_PINS : partId === after.kicadComponents![0]!.partId ? moved.pins : null);
    expect(after.kicadComponents![0]!.partId).not.toBe(U1.partId);
    // U1's pin 2 moved: its VCC symbol moved with it (label safety)
    expect(after.netLabels!.find((entry) => entry.id === "vcc-u1")!.position).toEqual(kicadPinWorldPos(after.kicadComponents![0]!, moved.pins[1]!));
    expect(after.netLabels!.find((entry) => entry.id === "vcc-u1")!.position).not.toEqual(PIN2);
    // strict: no target exclusion, nothing named - every pin, U1's included, keeps its net and its symbols
    expect(powerGroundViolations(powerGroundFacts(state, undefined, timerPins), powerGroundFacts(after, undefined, pinsAfter), { targets: [], named: [] })).toEqual([]);
  });

  it("6. replace: a target without the connected VCC pin is refused replacement-plan-refused through the agent's path - no operation sealed, no fact changed (the agent path never supplies a dropped-pin acknowledgement)", { timeout: 60_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    const source = pinFactsSource(targetFacts([TIMER_PINS[0]!]));
    const catalog = await installCatalog(D3_SCOPE, { pinFacts: source });
    const live = await principalOf(D3_SCOPE);
    const state = timerWithRails();
    const editor = await editorOver(state);
    const before = schematicStateDigest(state);
    const outcome = await createAgentToolGateway(registry, { replacementPinFacts: (revision, role) => source.loadPinFacts(revision, undefined, role) })
      .invoke({ runId: "run-b24-b2-drop", provider: "openai", toolId: REPLACEMENT, version: registry.get(REPLACEMENT)!.version, args: { componentId: TIMER }, context: timerContext(editor, catalog.authority, live, D3_SCOPE), timeoutMs: 10_000 });
    expect(outcome.kind, JSON.stringify(outcome).slice(0, 400)).toBe("proposal-blocked");
    if (outcome.kind !== "proposal-blocked") return;
    expect(outcome.blockers.map((blocker) => blocker.code)).toEqual(["replacement-plan-refused"]);
    // the identity mapping finds no pin 2 on the target, so the planner refuses explicit-pin-mapping-required (the assembler never supplies a
    // mapping or an acknowledgement, so unacknowledged-dropped-connections is unreachable from the agent's path) - CONFIRMED here
    expect(outcome.blockers[0]!.detail).toBe("The old→new pin mapping is not an exact number+name identity for pin(s) 2; ambiguous or non-identity mappings are out of scope. Nothing was changed.");
    expect(schematicStateDigest(state)).toBe(before);
    expect(editor.executed()).toBe(0);
    expect(powerGroundViolations(powerGroundFacts(timerWithRails(), undefined, timerPins), powerGroundFacts(editor.visible(), undefined, timerPins))).toEqual([]);
  });

  it("7. edit: Tier 1 set-value on a theory part and rename on a KiCad part change no power/ground fact; a theory rename refuses unsupported-theory-rename and changes nothing", { timeout: 30_000 }, async () => {
    const theory = symbolsAtPins();
    const state: SchematicState = { ...theory, kicadComponents: [{ ...U1 }], netLabels: [...theory.netLabels!, label("gnd-u1", PIN1, "GND", "ground")] };
    const editor = await readyEditor(state);
    const proposal = sealedTier1(await sealTier1([{ op: "set-value", target: "r1", value: "22k" }, { op: "rename", target: "U1", refDes: "U7" }], state, editor));
    expect(proposal.impacts.propertyEdits.map((edit) => [edit.componentId, edit.patch])).toEqual([["r1", { value: "22k" }], [TIMER, { refDes: "U7" }]]);
    const after = await applyTier1(editor, state, proposal);
    expect(after.kicadComponents![0]!.refDes).toBe("U7");
    expect(powerGroundViolations(powerGroundFacts(state, undefined, timerPins), powerGroundFacts(after, undefined, timerPins), { targets: [], named: [] })).toEqual([]);
    const refused = await sealTier1([{ op: "rename", target: "r1", refDes: "R9" }], after, await readyEditor(after));
    expect(refused.kind).toBe("proposal-blocked");
    if (refused.kind !== "proposal-blocked") return;
    expect(refused.blockers.map((blocker) => blocker.code)).toEqual(["unsupported-theory-rename"]);
  });

  it("8. edit: one granted PCB move (sirkit.pcb.move-footprint) minted through the gateway and committed through the canonical session changes no net-class membership and no pad of a power/ground net", { timeout: 30_000 }, async () => {
    const history = createHistory(railBoard());
    const bound = bindCanonicalEditorSession(history, SCOPE, { durableStore: new InMemoryAtomicProjectStore() });
    const session = canonicalSessionFor(bound.history)!;
    const r3 = bound.history.committedPresent.footprints.find((footprint) => footprint.ref === "R3")!;
    const setup = buildExecutionOperations(bound.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: mmToNm(6), y: mmToNm(5) }] });
    if (!setup.ok) throw new Error(setup.message);
    expect(await session.commit({ commandId: "pcb.move-footprint", label: "setup", buildOperations: () => setup.operations })).toMatchObject({ ok: true, status: "executed" });
    const board = bound.history.committedPresent;
    const head = session.headMetadataFor(board)!;
    const autonomy: AgentAutonomySetting = { schema: AGENT_AUTONOMY_SCHEMA, tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, mode: "execute_explicit_tier1", revision: 1, updatedAt: null, updatedBy: null };
    const assembly = assembleAgentRunContext({
      ...SCOPE, board: JSON.parse(JSON.stringify(board)) as PcbBoard,
      pcbProposalBasis: { historyHeadSequence: head.headSequence, historyHeadLabel: null, lineageId: head.lineageId, activeDrcPresetId: DEFAULT_PRESET_ID },
      verifiedActor: { principalId: "u-1", actorRole: "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" }, executionGrantsAvailable: true, autonomy,
    });
    if (!assembly.ok) throw new Error(assembly.reason);
    const minter = createExecutionGrantMinter({
      principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a", authClass: "local_dev", sessionIdentity: "sess-1", correlationId: "corr-1",
      scope: SCOPE, boardInstanceId: pcbBoardInstanceId(SCOPE.projectId), autonomy, userMessage: "Move R3 2 mm to the right.", runId: "run-b24-b2-move", provider: "openai",
      store: new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()), now: () => Date.now(),
    });
    const move = registry.get("sirkit.pcb.move-footprint")!;
    const outcome = await createAgentToolGateway(registry, { executionGrants: minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION })
      .invoke({ runId: "run-b24-b2-move", provider: "openai", toolId: move.toolId, version: move.version, args: { moves: [{ footprintId: r3.id, x: board.footprints.find((footprint) => footprint.id === r3.id)!.at.x + mmToNm(2), y: board.footprints.find((footprint) => footprint.id === r3.id)!.at.y }] }, context: assembly.context, timeoutMs: 5_000, callId: "call-move" });
    expect(outcome, JSON.stringify(outcome).slice(0, 400)).toMatchObject({ kind: "execution-grant", ok: true, decision: "execute_explicit" });
    if (outcome.kind !== "execution-grant") return;
    const operations = outcome.grant.binding.proposal.operations;
    expect(operations.length).toBeGreaterThan(0);
    expect(await session.commit({ commandId: "pcb.move-footprint", label: "Granted move", buildOperations: () => structuredClone(operations) as EngineeringOperation[] })).toMatchObject({ ok: true, status: "executed" });
    const after = bound.history.committedPresent;
    expect(after.footprints.find((footprint) => footprint.id === r3.id)!.at.x).toBe(board.footprints.find((footprint) => footprint.id === r3.id)!.at.x + mmToNm(2));
    const schematic = symbolsAtPins();
    const was = powerGroundFacts(schematic, board);
    expect(was.board!.map((net) => [net.name, net.netId, net.netClass === "none" ? "none" : JSON.parse(net.netClass).classId, net.pads.length])).toEqual([["VCC", 1, "Power", 2], ["GND", 2, "none", 1]]);
    expect(powerGroundViolations(was, powerGroundFacts(schematic, after), { targets: [], named: [] })).toEqual([]);
  });

  it("9. OD-229 approved: a shared-wire AI delete is blocked before sealing or mutation", { timeout: 30_000 }, async () => {
    const state = wireThroughDeletedPin();
    const editor = await readyEditor(state);
    const before = structuredClone(state);
    const outcome = await sealTier1([{ op: "delete", target: "r4" }], state, editor);
    expect(outcome).toMatchObject({ kind: "proposal-blocked", ok: false });
    expect(outcome).not.toHaveProperty("proposal");
    expect(JSON.stringify(outcome)).toContain("delete-plan-refused");
    expect(state).toEqual(before);
    expect(powerGroundFacts(state).nets.find((net) => net.name === "GND")!.members).toEqual(["c5:left", "c6:left", "r4:right"]);
    expect(powerGroundViolations(powerGroundFacts(before), powerGroundFacts(state), { targets: [], named: [] })).toEqual([]);
  });

  it("10. the catalog links this suite under power-ground x deterministic offline (OD-205 applied)", () => {
    const row = GOLDEN_EVAL_CATALOG.find((candidate) => candidate.area === "power-ground" && candidate.class === "deterministic_offline")!;
    expect(row.links.map((entry) => [entry.path, entry.kind])).toEqual([[SELF, "suite"]]);
  });
});

// ── replacement and board fixtures ────────────────────────────────────────────────────────────────────────────────────────────
/** The target revision's published pin facts with the given pins (the fixture catalog's exact target, its certificate kept consistent). */
function targetFacts(pins: readonly KicadPin[]): PublishedSymbolPinFacts {
  const ids = pins.map((entry) => `pin-${entry.number}`);
  return { ...TARGET_FACTS, pins: [...pins], symbolPinIds: ids, certificate: { ...TARGET_FACTS.certificate, symbolPinIds: ids } };
}
function pinFactsSource(target: PublishedSymbolPinFacts): RecordingPinFactsSource {
  const reads: RecordingPinFactsSource["reads"] = [];
  const facts = new Map([[CURRENT_FACTS.atomicPartRevisionId, CURRENT_FACTS], [target.atomicPartRevisionId, target]]);
  return { reads, async loadPinFacts(revision, signal, role) { reads.push({ revision, role, signal }); return facts.get(revision) ?? null; } };
}
/** The D3 production editor composition (`_d3-fixtures.ts` timerEditor) over a given schematic. */
async function editorOver(state: SchematicState): Promise<TimerEditor> {
  const editor = new SchematicEditorSession({ ...D3_SCOPE }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(structuredClone(state), null);
  let visible = structuredClone(state);
  const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (labelText, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {}, history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative), historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
      }, labelText, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  return { editor, coordinator, history, visible: () => structuredClone(visible), executed: () => editor.events.filter((event) => event.kind === "executed").length };
}
/** R3 and R4 on a two-net board named as the schematic's rails: VCC (net 1, class Power) and GND (net 2, no assignment). */
function railBoard(): PcbBoard {
  const def = makeResistorDef();
  const board = makeBoard(40, 30, [makeInstance("r3", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("r4", def, { x: 30, y: 22 }, { "1": 1, "2": 0 })], 2);
  board.nets = board.nets.map((net) => (net.id === 1 ? { ...net, name: "VCC" } : net.id === 2 ? { ...net, name: "GND" } : net));
  board.netClassing = { version: 1, assignments: { 1: { classId: "Power", explanation: "VCC is a supply rail" } }, ruleDeltas: [] };
  return board;
}
