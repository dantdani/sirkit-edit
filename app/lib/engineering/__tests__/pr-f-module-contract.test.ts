/**
 * [PR-F fD] The module contract (`sirkit.module-contract.v1`, app/lib/engineering/module-contract.ts; the owner's Astra directive,
 * sections 6-7; CONTINUATION E): the schema and the validator against a pinned schematic.
 *
 *  - the schema: the constants, the descriptor's input schema (the curated example validates; the schema refuses a missing key,
 *    an unknown key and a bad enum), the descriptor text under the first-party bounds, strict-compatible;
 *  - the sheet authorities the validator reuses: identities (KiCad part and revision ids, Theory ids and types; a stimulus is not
 *    physical; an ambiguous reference is recorded, never guessed), the named nets (the netlist authority's names united with the
 *    sheet's labels and GND), the physical instance count;
 *  - the happy path: a two-module acquisition chain over the fixture sheet validates; the set carries the exact identities read
 *    from the sheet, the derived part-authority rows (the editor's refusal list), the coverage (unassigned, known / referenced /
 *    shared nets), electricalCheck not_run; the digest is deterministic; the sheet is untouched;
 *  - refusals as data, every code of the closed list exercised: unknown / ambiguous / doubly owned component, a stated part id that
 *    disagrees, an unnamed port net, a port fact neither stated nor unknown, a value without units, evidence without a source or
 *    malformed, a stated port fact without evidence, a requirement without evidence, a topic unstated or stated twice, a
 *    part-authority gap hidden or claimed falsely, a malformed test, constraint shape / net / module / evidence, a shared resource
 *    without its owner, two owners of one net, the directive's case ("an individually passing filter and ADC module do not make a
 *    passing system"): each module validates alone, the pair without its interface constraint is refused `interface-unstated`;
 *    a driver-to-receiver net without an interface is `interface-loading-unstated`; a shared reference without its owner is
 *    `reference-unstated`; a sheet beyond the qualified scope is `scope-unsupported`; unknown stays unknown (an interface whose
 *    loading is declared unknown with a reason is accepted and stays visible).
 */
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { sirkitToolRegistry } from "../tool-catalog";
import { validateToolDescriptor } from "../tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { validateAgainstSchema } from "../tool-io-validation";
import { schematicStateDigest } from "../schematic-model";
import { strictCompatibility } from "../../agent/provider-tools";
import { buildNetlist } from "../../pcb/netlist-bridge";
import { listUnresolvedInstances } from "../../pcb-sync/unresolved-instances";
import { MODULE_CONTRACT_INPUT_EXAMPLE, MODULE_CONTRACT_PROPOSAL_TOOL_ID } from "../../agent/module-contract-proposals";
import {
  ASTRA_QUALIFIED_PHYSICAL_INSTANCES, CONSTRAINT_KINDS, ELECTRICAL_CHECK_NOT_RUN, EVIDENCE_KINDS, MODULE_CONTRACT_REFUSAL_CODES, MODULE_CONTRACT_SCHEMA, PORT_DIRECTIONS, PORT_FACTS, REQUIREMENT_TOPICS,
  knownNetNames, moduleContractSetDigest, physicalInstanceCount, schematicComponentIdentities, validateModuleContractSet, type ModuleContractRefusalCode,
} from "../module-contract";

const registry = sirkitToolRegistry();
const descriptor = () => registry.get(MODULE_CONTRACT_PROPOSAL_TOOL_ID)!;

/** The fixture sheet: a Theory RC filter (R1, C1, a ground symbol) and two catalog parts - U1 without a published revision, U2 with one; nets VIN, AIN, GND wired, +3V3 declared by a lone label. */
const SHEET: SchematicState = {
  components: [
    { id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k", refDes: "R1" },
    { id: "c1", type: "capacitor", x: 200, y: 100, rotation: 0, value: "100n", refDes: "C1" },
    { id: "gnd1", type: "ground", x: 200, y: 200, rotation: 0, value: "" },
  ],
  wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 170, y: 100 }] }, { id: "w2", vertices: [{ x: 230, y: 100 }, { x: 230, y: 180 }, { x: 200, y: 180 }] }],
  netLabels: [
    { id: "l1", position: { x: 70, y: 100 }, name: "VIN", kind: "signal", orientation: 0 },
    { id: "l2", position: { x: 130, y: 100 }, name: "AIN", kind: "signal", orientation: 0 },
    { id: "l3", position: { x: 400, y: 300 }, name: "+3V3", kind: "power", orientation: 0 },
  ],
  kicadComponents: [
    { id: "u1-id", partId: "lib:adc121", x: 400, y: 100, rotation: 0, refDes: "U1", value: "ADC121" },
    { id: "u2-id", partId: "lib:ne555", x: 400, y: 200, rotation: 0, refDes: "U2", value: "NE555", atomicPartRevisionId: "rev-u2", symbolAssetVersionId: "sym-u2" },
  ],
} as unknown as SchematicState;

type Rec = Record<string, unknown>;
const Q = (name: string, value: number, unit: string, bound = "nominal"): Rec => ({ name, value, unit, bound });
const EVIDENCE: Rec = { sourceIdentity: "ADC121 datasheet", documentRevision: "rev C", section: "analog input", applicability: "U1 AIN pin", assumptions: "acquisition time as specified", uncertainty: "none stated", kind: "hard-requirement" };
const LPF: Rec = {
  id: "lpf", name: "Anti-alias low-pass filter", responsibility: "Band-limit VIN below the ADC's Nyquist frequency and present it on AIN.",
  components: [{ refDes: "R1" }, { refDes: "C1" }],
  ports: [
    { id: "in", net: "VIN", direction: "input", logicLevel: "analog", voltage: [Q("signal", 0, "V", "min"), Q("signal", 2.5, "V", "max")], impedance: [Q("input impedance", 10000, "ohm")], unknown: ["current", "permittedLoading"], evidence: [EVIDENCE] },
    { id: "out", net: "AIN", direction: "output", logicLevel: "analog", voltage: [Q("signal", 2.5, "V", "max")], impedance: [Q("output impedance", 10000, "ohm")], permittedLoading: [Q("load capacitance", 50, "pF", "max")], unknown: ["current"], evidence: [EVIDENCE] },
    { id: "gnd", net: "GND", direction: "ground", unknown: ["voltage", "current", "impedance", "permittedLoading"] },
  ],
  requirements: [{ topic: "bandwidth", statement: "Cut-off well below the Nyquist frequency of 5 kHz.", quantities: [Q("cut-off frequency", 1600, "Hz")], evidence: [EVIDENCE] }],
  unknown: ["noise", "accuracy", "timing"], notApplicable: ["gain", "power", "reference", "ground", "startup", "protection"],
  partAuthorityGaps: ["R1", "C1"], placementRouting: ["keep C1 at the ADC input pin"],
  tests: [{ id: "lpf-fc", procedure: "sweep VIN 100 Hz to 20 kHz and measure AIN", acceptance: "-3 dB at the cut-off frequency", quantities: [Q("attenuation at cut-off", -3, "dB")], evidence: [] }],
};
const ADC: Rec = {
  id: "adc", name: "ADC interface", responsibility: "Sample AIN at 10 kS/s referenced to the 3.3 V rail.",
  components: [{ refDes: "U1" }],
  ports: [
    { id: "ain", net: "AIN", direction: "input", logicLevel: "analog", voltage: [Q("absolute maximum", 3.6, "V", "max")], impedance: [Q("sample capacitance", 20, "pF", "typical")], unknown: ["current", "permittedLoading"], evidence: [EVIDENCE] },
    { id: "vref", net: "+3V3", direction: "power-in", voltage: [Q("supply and reference", 3.3, "V")], current: [Q("supply current", 2, "mA", "max")], unknown: ["impedance", "permittedLoading"], evidence: [EVIDENCE] },
    { id: "gnd", net: "GND", direction: "ground", unknown: ["voltage", "current", "impedance", "permittedLoading"] },
  ],
  requirements: [{ topic: "accuracy", statement: "12-bit no-missing-codes over the input range.", quantities: [Q("resolution", 12, "bit")], evidence: [EVIDENCE] }],
  unknown: ["noise", "timing", "startup", "protection"], notApplicable: ["bandwidth", "gain", "power", "reference", "ground"],
  partAuthorityGaps: ["U1"], placementRouting: [], tests: [],
};
const INTERFACE: Rec = { id: "ain-interface", kind: "interface", net: "AIN", modules: ["lpf", "adc"], statement: "The filter drives the ADC sample capacitor.", loading: { driver: "lpf", quantities: [Q("receiver sample capacitance", 20, "pF", "typical"), Q("driver permitted load", 50, "pF", "max")] }, evidence: [EVIDENCE] };
const RAIL: Rec = { id: "rail", kind: "shared-power", net: "+3V3", modules: ["adc"], owner: "adc", statement: "The 3.3 V rail is the ADC reference.", evidence: [EVIDENCE] };
const GROUND: Rec = { id: "ground", kind: "shared-ground", net: "GND", modules: ["adc", "lpf"], owner: "adc", statement: "One ground return for the filter and the ADC.", evidence: [EVIDENCE] };
const SYSTEM: Rec = { name: "Single-channel acquisition front end", statement: "A 0 to 2.5 V signal band-limited and sampled by a 12-bit ADC from a 3.3 V rail.", operatingConditions: [Q("ambient temperature", 70, "degC", "max")] };
const VALID: Rec = { system: SYSTEM, modules: [LPF, ADC], constraints: [INTERFACE, RAIL, GROUND] };
const clone = <T>(value: T): T => structuredClone(value);
const withModule = (set: Rec, id: string, patch: (contract: Rec) => void): Rec => { const next = clone(set); for (const contract of next.modules as Rec[]) if (contract.id === id) patch(contract); return next; };
const codesOf = (set: unknown, sheet: SchematicState = SHEET): string[] => { const result = validateModuleContractSet(set, sheet); return result.ok ? [] : result.blockers.map((blocker) => blocker.code); };
const detailsOf = (set: unknown, sheet: SchematicState = SHEET): string[] => { const result = validateModuleContractSet(set, sheet); return result.ok ? [] : result.blockers.map((blocker) => blocker.detail); };

describe("PR-F fD module contract - the schema", () => {
  it("the constants are the directive's vocabulary; the descriptor validates with its text under the first-party bounds and is strict-compatible; the curated example validates against the input schema, which refuses a missing key, an unknown key and a bad enum", () => {
    expect(MODULE_CONTRACT_SCHEMA).toBe("sirkit.module-contract.v1");
    expect(EVIDENCE_KINDS).toEqual(["hard-requirement", "approved-policy", "optimization-goal"]);
    expect(REQUIREMENT_TOPICS).toEqual(["bandwidth", "gain", "noise", "timing", "accuracy", "power", "reference", "ground", "startup", "protection"]);
    expect(PORT_DIRECTIONS).toHaveLength(7);
    expect(PORT_FACTS).toEqual(["voltage", "current", "logicLevel", "impedance", "permittedLoading"]);
    expect(CONSTRAINT_KINDS).toContain("interface");
    expect(ASTRA_QUALIFIED_PHYSICAL_INSTANCES).toBe(50);
    expect(new Set(MODULE_CONTRACT_REFUSAL_CODES).size).toBe(MODULE_CONTRACT_REFUSAL_CODES.length);
    const d = descriptor();
    expect(validateToolDescriptor(d, new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id)))).toEqual([]);
    expect(strictCompatibility(d).ok).toBe(true);
    expect(d.description.length).toBeLessThanOrEqual(1_000);
    expect(validateAgainstSchema(MODULE_CONTRACT_INPUT_EXAMPLE, d.inputSchema)).toEqual([]);
    expect(validateAgainstSchema(VALID, d.inputSchema)).toEqual([]);
    expect(validateAgainstSchema({ modules: [], constraints: [] }, d.inputSchema)).toEqual(["$.system: required"]);
    expect(validateAgainstSchema({ ...VALID, approved: true }, d.inputSchema)).toEqual(["$.approved: unknown field"]);
    expect(validateAgainstSchema({ ...VALID, modules: [{ ...LPF, requirements: [{ ...(LPF.requirements as Rec[])[0], topic: "colour" }] }] }, d.inputSchema).some((issue) => issue.includes("topic"))).toBe(true);
    expect(Object.keys(d.inputSchema.properties as Record<string, unknown>)).toEqual(["system", "modules", "constraints"]);
  });
});

describe("PR-F fD module contract - the sheet authorities the validator reuses", () => {
  it("identities: KiCad instances with their part and revision ids, physical Theory parts with their types; the ground symbol is not physical; a reference held by two instances is ambiguous", () => {
    const { byRef, ambiguous } = schematicComponentIdentities(SHEET);
    expect([...byRef.keys()].sort()).toEqual(["C1", "R1", "U1", "U2"]);
    expect(byRef.get("U1")).toEqual({ refDes: "U1", family: "kicad", componentId: "u1-id", partId: "lib:adc121", revisionId: null, theoryType: null, value: "ADC121" });
    expect(byRef.get("U2")).toMatchObject({ family: "kicad", componentId: "u2-id", partId: "lib:ne555", revisionId: "rev-u2" });
    expect(byRef.get("R1")).toEqual({ refDes: "R1", family: "theory", componentId: "r1", partId: null, revisionId: null, theoryType: "resistor", value: "10k" });
    expect(ambiguous.size).toBe(0);
    expect(physicalInstanceCount(SHEET)).toBe(4);
    const clash = { ...SHEET, kicadComponents: [...SHEET.kicadComponents!, { id: "r1-kicad", partId: "lib:r", x: 0, y: 0, rotation: 0, refDes: "r1", value: "1k" }] } as SchematicState;
    const clashed = schematicComponentIdentities(clash);
    expect(clashed.ambiguous.has("R1")).toBe(true);
    expect(clashed.byRef.has("R1")).toBe(false);
  });

  it("named nets: the netlist authority's names (labels win, ground is GND, N$ nets excluded) united with the sheet's labels (a lone power label the authority cannot locate without the parts cache) - never a second netlist", () => {
    const netlist = buildNetlist(SHEET);
    const authorityNames = netlist.nets.map((net) => net.name).filter((name) => !/^N\$\d+$/.test(name));
    expect(authorityNames.sort()).toEqual(["AIN", "GND", "VIN"]);
    const known = knownNetNames(SHEET);
    expect([...known].sort()).toEqual(["+3V3", "AIN", "GND", "VIN"]);
    for (const name of authorityNames) expect(known.has(name)).toBe(true);
    expect(knownNetNames({ components: [], wires: [], netLabels: [], kicadComponents: [] }).size).toBe(0);
    expect([...knownNetNames({ components: [{ id: "g", type: "ground", x: 0, y: 0, rotation: 0, value: "" }], wires: [] })]).toEqual(["GND"]);
  });
});

describe("PR-F fD module contract - the happy path", () => {
  it("validates the two-module acquisition chain: exact identities copied from the sheet, the derived part-authority rows, coverage, electricalCheck not_run; deterministic digest; the sheet untouched", () => {
    const before = schematicStateDigest(SHEET);
    const result = validateModuleContractSet(VALID, SHEET);
    expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const set = result.set;
    expect(set.schema).toBe(MODULE_CONTRACT_SCHEMA);
    expect(set.system).toEqual({ name: SYSTEM.name, statement: SYSTEM.statement, operatingConditions: [{ name: "ambient temperature", value: 70, unit: "degC", bound: "max" }] });
    expect(set.modules.map((module) => module.id)).toEqual(["lpf", "adc"]);
    expect(set.modules[0]!.components).toEqual([
      { refDes: "R1", family: "theory", componentId: "r1", partId: null, revisionId: null, theoryType: "resistor", value: "10k" },
      { refDes: "C1", family: "theory", componentId: "c1", partId: null, revisionId: null, theoryType: "capacitor", value: "100n" },
    ]);
    expect(set.modules[1]!.components).toEqual([{ refDes: "U1", family: "kicad", componentId: "u1-id", partId: "lib:adc121", revisionId: null, theoryType: null, value: "ADC121" }]);
    expect(set.modules[0]!.ports.map((port) => [port.id, port.net, port.direction])).toEqual([["in", "VIN", "input"], ["out", "AIN", "output"], ["gnd", "GND", "ground"]]);
    expect(set.modules[0]!.ports[2]).toMatchObject({ logicLevel: null, voltage: [], unknown: ["voltage", "current", "impedance", "permittedLoading"], evidence: [] });
    expect(set.modules[1]!.requirements[0]).toMatchObject({ topic: "accuracy", quantities: [{ name: "resolution", value: 12, unit: "bit", bound: "nominal" }], evidence: [EVIDENCE] });
    expect(set.constraints.map((constraint) => [constraint.id, constraint.kind, constraint.net, constraint.owner])).toEqual([["ain-interface", "interface", "AIN", null], ["rail", "shared-power", "+3V3", "adc"], ["ground", "shared-ground", "GND", "adc"]]);
    expect(set.constraints[0]!.loading).toEqual({ state: "stated", driver: "lpf", quantities: [{ name: "receiver sample capacitance", value: 20, unit: "pF", bound: "typical" }, { name: "driver permitted load", value: 50, unit: "pF", bound: "max" }] });
    expect(set.constraints[2]!.modules).toEqual(["adc", "lpf"]);
    // the editor's own refusal list decides part authority: Theory symbols and U1 (no published revision) are gaps; U2 is resolved but unassigned
    const unresolved = listUnresolvedInstances(SHEET);
    expect(unresolved.map((item) => item.refDes).sort()).toEqual(["C1", "R1", "U1"]);
    expect(set.partAuthority).toEqual([
      { refDes: "R1", moduleId: "lpf", state: "unresolved", missing: "theory_symbol_only", reviewPath: unresolved.find((item) => item.refDes === "R1")!.reviewPath },
      { refDes: "C1", moduleId: "lpf", state: "unresolved", missing: "theory_symbol_only", reviewPath: unresolved.find((item) => item.refDes === "C1")!.reviewPath },
      { refDes: "U1", moduleId: "adc", state: "unresolved", missing: "published_exact_revision", reviewPath: unresolved.find((item) => item.refDes === "U1")!.reviewPath },
    ]);
    expect(set.coverage).toEqual({ physicalInstances: 4, owned: 3, unassigned: ["U2"], knownNets: ["+3V3", "AIN", "GND", "VIN"], referencedNets: ["+3V3", "AIN", "GND", "VIN"], sharedNets: [{ net: "AIN", modules: ["adc", "lpf"], constraintIds: ["ain-interface"] }, { net: "GND", modules: ["adc", "lpf"], constraintIds: ["ground"] }] });
    expect(set.electricalCheck).toEqual({ state: "not_run", detail: ELECTRICAL_CHECK_NOT_RUN });
    expect(JSON.stringify(set)).not.toMatch(/"state":"passed"|verified/);
    const again = validateModuleContractSet(clone(VALID), SHEET);
    expect(again.ok && moduleContractSetDigest(again.set)).toBe(moduleContractSetDigest(set));
    expect(moduleContractSetDigest(set)).toMatch(/^eng1-/);
    expect(schematicStateDigest(SHEET)).toBe(before);
  });

  it("a module owning a resolved instance (U2) acknowledges no gap for it; a component owned by a module whose part id is stated correctly is accepted", () => {
    const set = withModule(VALID, "adc", (module) => { module.components = [{ refDes: "U1", partId: "lib:adc121" }, { refDes: "U2", partId: "lib:ne555", revisionId: "rev-u2" }]; });
    const result = validateModuleContractSet(set, SHEET);
    expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
    if (result.ok) {
      expect(result.set.partAuthority.find((row) => row.refDes === "U2")).toEqual({ refDes: "U2", moduleId: "adc", state: "published-exact-revision", missing: null, reviewPath: null });
      expect(result.set.coverage.unassigned).toEqual([]);
    }
  });

  it("unknown stays unknown: an interface whose loading is declared unknown with a reason is accepted and the reason stays visible in the set", () => {
    const set = clone(VALID);
    (set.constraints as Rec[])[0] = { ...INTERFACE, loading: { unknown: "the ADC's sample capacitance is not stated by the available revision of the datasheet" } };
    const result = validateModuleContractSet(set, SHEET);
    expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
    if (result.ok) expect(result.set.constraints[0]!.loading).toEqual({ state: "unknown", reason: "the ADC's sample capacitance is not stated by the available revision of the datasheet" });
  });
});

describe("PR-F fD module contract - refusals as data (all-or-nothing, every blocker listed)", () => {
  const cases: Array<[label: string, set: () => unknown, code: ModuleContractRefusalCode, detail: RegExp]> = [
    ["an unknown component", () => withModule(VALID, "lpf", (module) => { module.components = [{ refDes: "R1" }, { refDes: "C1" }, { refDes: "R9" }]; }), "component-unknown", /R9 is not a physical component of the pinned schematic/],
    ["a component owned twice", () => withModule(VALID, "adc", (module) => { module.components = [{ refDes: "U1" }, { refDes: "C1" }]; }), "component-double-ownership", /C1 is owned by module "lpf" and by module "adc"/],
    ["a stated part id that disagrees", () => withModule(VALID, "adc", (module) => { module.components = [{ refDes: "U1", partId: "lib:other" }]; }), "component-identity-mismatch", /U1 was placed from part lib:adc121, not lib:other/],
    ["a stated revision id that disagrees", () => withModule(VALID, "adc", (module) => { module.components = [{ refDes: "U1", revisionId: "rev-x" }]; }), "component-identity-mismatch", /carries no published exact revision, not rev-x/],
    ["a port on an unnamed net", () => withModule(VALID, "lpf", (module) => { (module.ports as Rec[])[1] = { ...(module.ports as Rec[])[1], net: "VOUT" }; }), "port-net-unknown", /"VOUT" is not a named net of the pinned schematic/],
    ["a port fact neither stated nor listed unknown", () => withModule(VALID, "lpf", (module) => { (module.ports as Rec[])[0] = { ...(module.ports as Rec[])[0], unknown: ["current"] }; }), "port-fact-unstated", /permittedLoading neither stated nor listed unknown/],
    ["a value without units", () => withModule(VALID, "lpf", (module) => { (module.requirements as Rec[])[0] = { ...(module.requirements as Rec[])[0], quantities: [{ name: "cut-off frequency", value: 1600, unit: " " }] }; }), "quantity-without-units", /carries no unit/],
    ["a quantity that is not a number", () => withModule(VALID, "lpf", (module) => { (module.requirements as Rec[])[0] = { ...(module.requirements as Rec[])[0], quantities: [{ name: "cut-off frequency", value: "1600", unit: "Hz" }] }; }), "quantity-malformed", /finite numeric value/],
    ["evidence without a source", () => withModule(VALID, "adc", (module) => { (module.requirements as Rec[])[0] = { ...(module.requirements as Rec[])[0], evidence: [{ ...EVIDENCE, sourceIdentity: "" }] }; }), "evidence-without-source", /names no source/],
    ["evidence of an unknown kind", () => withModule(VALID, "adc", (module) => { (module.requirements as Rec[])[0] = { ...(module.requirements as Rec[])[0], evidence: [{ ...EVIDENCE, kind: "guess" }] }; }), "evidence-malformed", /lacks a kind in/],
    ["evidence missing its uncertainty", () => withModule(VALID, "adc", (module) => { (module.requirements as Rec[])[0] = { ...(module.requirements as Rec[])[0], evidence: [{ ...EVIDENCE, uncertainty: "" }] }; }), "evidence-malformed", /lacks uncertainty/],
    ["a stated port fact without evidence", () => withModule(VALID, "adc", (module) => { (module.ports as Rec[])[1] = { ...(module.ports as Rec[])[1], evidence: [] }; }), "evidence-missing", /states a limit or an impedance without evidence/],
    ["a requirement without evidence", () => withModule(VALID, "lpf", (module) => { (module.requirements as Rec[])[0] = { ...(module.requirements as Rec[])[0], evidence: [] }; }), "requirement-without-evidence", /carries no evidence/],
    ["a topic neither stated, unknown nor not applicable", () => withModule(VALID, "lpf", (module) => { module.notApplicable = ["gain", "power", "reference", "ground", "startup"]; }), "module-topic-unstated", /topic protection is neither stated/],
    ["a topic stated and listed unknown at once", () => withModule(VALID, "lpf", (module) => { module.unknown = ["noise", "accuracy", "timing", "bandwidth"]; }), "module-topic-conflict", /topic bandwidth is stated and unknown at once/],
    ["a part-authority gap hidden", () => withModule(VALID, "adc", (module) => { module.partAuthorityGaps = []; }), "part-authority-gap-unstated", /U1 lacks a published exact revision and is not acknowledged/],
    ["a Theory symbol's gap hidden", () => withModule(VALID, "lpf", (module) => { module.partAuthorityGaps = ["R1"]; }), "part-authority-gap-unstated", /C1 lacks a physical package \(a Theory symbol\)/],
    ["a part-authority gap claimed for a resolved instance", () => withModule(VALID, "adc", (module) => { module.components = [{ refDes: "U1" }, { refDes: "U2" }]; module.partAuthorityGaps = ["U1", "U2"]; }), "part-authority-mismatch", /U2 carries a published exact revision and its symbol asset; it is not a part-authority gap/],
    ["a part-authority gap claimed for a component the module does not own", () => withModule(VALID, "adc", (module) => { module.partAuthorityGaps = ["U1", "R1"]; }), "part-authority-mismatch", /R1 is listed as a part-authority gap but the module does not own it/],
    ["a malformed test", () => withModule(VALID, "lpf", (module) => { module.tests = [{ id: "t", procedure: "" }]; }), "test-malformed", /a unique id, a procedure and an acceptance criterion are required/],
    ["a constraint on an unnamed net", () => ({ ...VALID, constraints: [INTERFACE, RAIL, { ...GROUND, net: "AGND" }] }), "constraint-net-unknown", /"AGND" is not a named net/],
    ["a constraint naming an unknown module", () => ({ ...VALID, constraints: [INTERFACE, RAIL, { ...GROUND, modules: ["adc", "lpf", "psu"] }] }), "constraint-module-unknown", /psu is not a module of this set/],
    ["a constraint without evidence", () => ({ ...VALID, constraints: [INTERFACE, RAIL, { ...GROUND, evidence: [] }] }), "constraint-without-evidence", /carries no evidence/],
    ["a shared resource without its owner", () => ({ ...VALID, constraints: [INTERFACE, { ...RAIL, owner: undefined }, GROUND] }), "net-owner-missing", /names the module that owns the net/],
    ["two owners of one net", () => ({ ...VALID, constraints: [INTERFACE, RAIL, GROUND, { ...GROUND, id: "ground-2", owner: "lpf" }] }), "net-ownership-conflict", /GND is owned by "adc" \(constraint "ground"\) and by "lpf"/],
    ["an interface whose loading is unsaid", () => ({ ...VALID, constraints: [{ ...INTERFACE, loading: undefined }, RAIL, GROUND] }), "interface-loading-unstated", /loading must be stated \(driver and quantities\) or declared unknown/],
    ["an interface whose loading names a module outside it", () => ({ ...VALID, constraints: [{ ...INTERFACE, loading: { driver: "psu", quantities: [Q("x", 1, "pF")] } }, RAIL, GROUND] }), "interface-loading-unstated", /loading names the driving module/],
    ["a shared net no constraint states", () => ({ ...VALID, constraints: [INTERFACE, RAIL] }), "interface-unstated", /net GND is carried by modules adc, lpf but no cross-module constraint states that interface/],
    ["a driver-to-receiver net stated by ownership only", () => ({ ...VALID, constraints: [{ id: "ain-owner", kind: "net-ownership", net: "AIN", modules: ["lpf", "adc"], owner: "lpf", statement: "The filter owns AIN.", evidence: [EVIDENCE] }, RAIL, GROUND] }), "interface-loading-unstated", /net AIN joins a driver and a receiver across modules adc, lpf without an interface constraint/],
    ["a shared reference without its owner", () => { const set = clone(VALID); for (const contract of set.modules as Rec[]) (contract.ports as Rec[]).push({ id: "ref", net: "+3V3", direction: "reference", voltage: [Q("reference", 3.3, "V")], unknown: ["current", "impedance", "permittedLoading"], evidence: [EVIDENCE] }); (set.constraints as Rec[])[1] = { ...RAIL, modules: ["adc", "lpf"] }; return set; }, "reference-unstated", /net \+3V3 is a reference shared by modules adc, lpf without a shared-reference constraint naming its owner/],
    ["a duplicate module id", () => ({ ...VALID, modules: [LPF, { ...ADC, id: "lpf" }] }), "module-id-duplicate", /module id "lpf" is declared twice/],
    ["a module with an unknown key", () => ({ ...VALID, modules: [LPF, { ...ADC, approved: true }] }), "module-malformed", /not an object with the module keys/],
    ["a port with an unknown key", () => withModule(VALID, "adc", (module) => { (module.ports as Rec[])[0] = { ...(module.ports as Rec[])[0], verified: true }; }), "port-malformed", /not an object with the port keys/],
    ["a requirement of an unknown topic", () => withModule(VALID, "adc", (module) => { (module.requirements as Rec[])[0] = { ...(module.requirements as Rec[])[0], topic: "colour" }; }), "requirement-malformed", /not an object with topic/],
    ["a constraint of an unknown kind", () => ({ ...VALID, constraints: [INTERFACE, RAIL, { ...GROUND, kind: "shared-everything" }] }), "constraint-malformed", /kind must be one of/],
  ];
  for (const [label, set, code, detail] of cases) {
    it(`${label}: ${code}`, () => {
      const result = validateModuleContractSet(set(), SHEET);
      expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.blockers.map((blocker) => blocker.code), result.blockers.map((blocker) => blocker.detail).join(" | ")).toContain(code);
      expect(result.blockers.find((blocker) => blocker.code === code)!.detail).toMatch(detail);
      for (const blocker of result.blockers) expect(MODULE_CONTRACT_REFUSAL_CODES).toContain(blocker.code);
    });
  }

  it("the directive's case: the filter module validates alone and the ADC module validates alone, but the pair without its interface constraint is refused interface-unstated (and interface-loading-unstated) - two individually passing modules do not make a passing system", () => {
    const lpfAlone = validateModuleContractSet({ system: SYSTEM, modules: [LPF], constraints: [] }, SHEET);
    expect(lpfAlone.ok, JSON.stringify(lpfAlone).slice(0, 400)).toBe(true);
    const adcAlone = validateModuleContractSet({ system: SYSTEM, modules: [ADC], constraints: [RAIL] }, SHEET);
    expect(adcAlone.ok, JSON.stringify(adcAlone).slice(0, 400)).toBe(true);
    const pair = validateModuleContractSet({ system: SYSTEM, modules: [LPF, ADC], constraints: [RAIL] }, SHEET);
    expect(pair.ok).toBe(false);
    if (pair.ok) throw new Error("unreachable");
    expect(pair.blockers.map((blocker) => blocker.code)).toEqual(["interface-unstated", "interface-unstated"]);
    expect(pair.blockers.map((blocker) => blocker.detail).join("\n")).toMatch(/net AIN is carried by modules adc, lpf/);
    expect(pair.blockers.map((blocker) => blocker.detail).join("\n")).toMatch(/net GND is carried by modules adc, lpf/);
    expect(pair.blockers[0]!.detail).toContain("two individually complete modules do not make a system until their interface is stated");
    // the ground stated, the signal interface still unsaid: the loading check names it
    const groundOnly = validateModuleContractSet({ system: SYSTEM, modules: [LPF, ADC], constraints: [RAIL, GROUND] }, SHEET);
    expect(groundOnly.ok).toBe(false);
    if (!groundOnly.ok) expect(groundOnly.blockers.map((blocker) => blocker.code)).toEqual(["interface-unstated"]);
    const owned = validateModuleContractSet({ system: SYSTEM, modules: [LPF, ADC], constraints: [RAIL, GROUND, { id: "ain-owner", kind: "net-ownership", net: "AIN", modules: ["lpf", "adc"], owner: "lpf", statement: "The filter owns AIN.", evidence: [EVIDENCE] }] }, SHEET);
    expect(owned.ok).toBe(false);
    if (!owned.ok) expect(owned.blockers.map((blocker) => blocker.code)).toEqual(["interface-loading-unstated"]);
  });

  it("the set's shape: not an object, a missing key, an unknown key, an empty module list, a system without a statement - set-malformed; a sheet beyond the qualified scope - scope-unsupported, and the set is not validated further into a success", () => {
    for (const bad of [null, [], "x", { modules: [], constraints: [] }, { ...VALID, approved: true }]) expect(codesOf(bad), JSON.stringify(bad)).toEqual(["set-malformed"]);
    expect(codesOf({ ...VALID, modules: [] })).toContain("set-malformed");
    expect(codesOf({ ...VALID, system: { name: "x" } })).toContain("set-malformed");
    const large = { ...SHEET, kicadComponents: Array.from({ length: 49 }, (_, index) => ({ id: `k${index}`, partId: "lib:r", x: 0, y: 0, rotation: 0, refDes: `J${index + 1}`, value: "" })) } as SchematicState;
    expect(physicalInstanceCount(large)).toBe(51);
    const result = validateModuleContractSet(VALID, large);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers[0]).toMatchObject({ code: "scope-unsupported" });
      expect(result.blockers[0]!.detail).toContain("51 physical component instances");
      expect(result.blockers[0]!.detail).toContain("at most 50");
      expect(result.blockers[0]!.detail).toMatch(/unsupported or experimental/);
      expect(result.blockers.map((blocker) => blocker.code)).toContain("component-unknown"); // U1's identity differs on this sheet (U1 is not among J1..J49): every blocker is listed
    }
    expect(codesOf(VALID, { ...SHEET, kicadComponents: Array.from({ length: 46 }, (_, index) => ({ id: `k${index}`, partId: "lib:r", x: 0, y: 0, rotation: 0, refDes: `J${index + 1}`, value: "" })).concat(SHEET.kicadComponents!) } as SchematicState)).toEqual([]);
  });

  it("every blocker names its module where one applies, and the details are bounded", () => {
    const details = detailsOf(withModule(VALID, "adc", (module) => { module.partAuthorityGaps = []; }));
    expect(details).toHaveLength(1);
    const result = validateModuleContractSet(withModule(VALID, "adc", (module) => { module.partAuthorityGaps = []; }), SHEET);
    if (!result.ok) expect(result.blockers[0]).toMatchObject({ moduleId: "adc" });
    for (const detail of details) expect(detail.length).toBeLessThanOrEqual(300);
  });
});
