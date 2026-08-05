import type { ConstraintDefinition, ConstraintDocument, ConstraintRelationship } from "./types";

const q = (dimension: "length" | "voltage" | "current" | "impedance" | "capacitance" | "resistance", value: string, unit: string) => ({ dimension, value, unit } as const);

function base(id: string, kind: ConstraintDefinition["kind"], targetType: ConstraintDefinition["selector"]["objectType"], targetIds: string[], requirement: ConstraintDefinition["requirement"], domain: ConstraintDefinition["domain"] = "application"): ConstraintDefinition {
  return {
    id,
    revision: 1,
    name: id,
    domain,
    kind,
    scope: { type: "project", id: "project:corpus" },
    selector: { objectType: targetType, predicate: { kind: "ids", ids: targetIds }, cardinality: { kind: "exactly", count: targetIds.length } },
    requirement,
    strength: "hard",
    severityPolicyId: "severity:blocking",
    origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" },
    evidenceIds: ["evidence:stage6-original-corpus"],
    lifecycle: { state: "active" },
    waiverPolicy: { eligible: false },
  };
}

function set(id: string, constraints: ConstraintDefinition[], relationships: ConstraintRelationship[] = []): ConstraintDocument {
  return { schemaVersion: 1, id: `constraint-set:corpus:${id}`, revision: 1, name: id, description: "Original Sirkit Stage 6 deterministic fixture.", extendsSetIds: [], constraints, relationships };
}

export const STAGE6_CONSTRAINT_CORPUS = [
  {
    scenario: "led-manufacturing",
    document: set("led-manufacturing", [
      base("corpus:led:width", "trace_width", "net", ["net:led"], { form: "minimum", value: q("length", "0.2", "mm") }, "manufacturing"),
      base("corpus:led:clearance", "clearance", "net", ["net:led"], { form: "minimum", value: q("length", "0.2", "mm") }, "manufacturing"),
    ]),
  },
  {
    scenario: "mcu-domains-decoupling-debug-dnc",
    document: set("mcu", [
      base("corpus:mcu:vdd", "voltage_operating_range", "component", ["component:U1"], { form: "range", min: q("voltage", "2.7", "V"), max: q("voltage", "3.6", "V"), minInclusive: true, maxInclusive: true }),
      base("corpus:mcu:vio-domain", "voltage_operating_range", "rail", ["rail:vio"], { form: "range", min: q("voltage", "1.7", "V"), max: q("voltage", "3.6", "V"), minInclusive: true, maxInclusive: true }),
      base("corpus:mcu:decoupling", "decoupling", "component", ["component:U1"], { form: "must_exist", cardinality: { kind: "at_least", count: 2 } }),
      base("corpus:mcu:dnc", "dnc_connection", "component", ["component:U1"], { form: "must_exist", cardinality: { kind: "at_least", count: 1 } }),
      base("corpus:mcu:reset", "terminal_connection", "terminal", ["terminal:U1:RESET"], { form: "must_connect", relationshipId: "relation:reset-pullup" }),
      base("corpus:mcu:boot", "terminal_connection", "terminal", ["terminal:U1:BOOT0"], { form: "must_connect", relationshipId: "relation:boot-bias" }),
      base("corpus:mcu:debug", "programming_access", "component", ["component:U1"], { form: "must_connect", relationshipId: "relation:swd" }),
    ], [
      { id: "relation:swd", revision: 1, kind: "test_point_coverage", members: [{ role: "target", targetType: "component", targetId: "component:U1" }, { role: "connector", targetType: "component", targetId: "component:JTAG1" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" },
      { id: "relation:reset-pullup", revision: 1, kind: "termination", members: [{ role: "signal", targetType: "terminal", targetId: "terminal:U1:RESET" }, { role: "bias", targetType: "component", targetId: "component:RRESET" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" },
      { id: "relation:boot-bias", revision: 1, kind: "termination", members: [{ role: "signal", targetType: "terminal", targetId: "terminal:U1:BOOT0" }, { role: "bias", targetType: "component", targetId: "component:RBOOT" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" },
    ]),
  },
  {
    scenario: "regulator-current-capacitors-thermal-loop",
    document: set("regulator", [
      base("corpus:reg:input", "voltage_operating_range", "rail", ["rail:vin"], { form: "range", min: q("voltage", "4.5", "V"), max: q("voltage", "16", "V"), minInclusive: true, maxInclusive: true }),
      base("corpus:reg:output", "voltage_operating_range", "rail", ["rail:3v3"], { form: "range", min: q("voltage", "3.2", "V"), max: q("voltage", "3.4", "V"), minInclusive: true, maxInclusive: true }),
      base("corpus:reg:budget", "current_budget", "rail", ["rail:5v"], { form: "budget", aggregate: "sum", limit: q("current", "1.5", "A") }),
      base("corpus:reg:epad", "exposed_pad_connection", "component", ["component:U2"], { form: "must_exist", cardinality: { kind: "exactly", count: 1 } }),
      base("corpus:reg:input-cap", "decoupling", "component", ["component:U2"], { form: "must_connect", relationshipId: "relation:reg-input-cap" }),
      base("corpus:reg:output-cap", "decoupling", "component", ["component:U2"], { form: "must_connect", relationshipId: "relation:reg-output-cap" }),
      base("corpus:reg:esr", "require_checker", "component", ["component:U2"], { form: "require_coverage", checkerId: "checker:capacitor-esr", minimumSupport: "enforced" }),
      base("corpus:reg:switch-layer", "allowed_layers", "net", ["net:switch"], { form: "allowed_set", values: ["layer:copperTop"] }, "routing"),
      base("corpus:reg:loop", "critical_loop", "interface", ["relation:buck-loop"], { form: "must_connect", relationshipId: "relation:buck-loop" }, "placement"),
      base("corpus:reg:thermal", "thermal_relation", "component", ["component:U2"], { form: "must_connect", relationshipId: "relation:reg-thermal" }, "placement"),
    ], [
      { id: "relation:buck-loop", revision: 1, kind: "current_loop", members: [{ role: "switch", targetType: "component", targetId: "component:U2" }, { role: "inductor", targetType: "component", targetId: "component:L1" }, { role: "capacitor", targetType: "component", targetId: "component:COUT" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" },
      { id: "relation:reg-input-cap", revision: 1, kind: "decoupling", members: [{ role: "rail", targetType: "rail", targetId: "rail:vin" }, { role: "capacitor", targetType: "component", targetId: "component:CIN" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" },
      { id: "relation:reg-output-cap", revision: 1, kind: "decoupling", members: [{ role: "rail", targetType: "rail", targetId: "rail:3v3" }, { role: "capacitor", targetType: "component", targetId: "component:COUT" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" },
      { id: "relation:reg-thermal", revision: 1, kind: "placement_group", members: [{ role: "source", targetType: "component", targetId: "component:U2" }, { role: "copper", targetType: "zone", targetId: "zone:reg-thermal" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" },
    ]),
  },
  {
    scenario: "usb-differential-high-speed",
    document: set("usb", [
      base("corpus:usb:impedance", "target_impedance", "differential_pair", ["pair:usb"], { form: "target", value: q("impedance", "90", "Ohm"), toleranceMinus: q("impedance", "9", "Ohm"), tolerancePlus: q("impedance", "9", "Ohm") }, "routing"),
      base("corpus:usb:layers", "allowed_layers", "differential_pair", ["pair:usb"], { form: "allowed_set", values: ["layer:copperTop"] }, "routing"),
      base("corpus:usb:skew", "pair_skew", "differential_pair", ["pair:usb"], { form: "maximum", value: q("length", "0.5", "mm") }, "routing"),
      base("corpus:usb:return", "return_reference", "differential_pair", ["pair:usb"], { form: "must_connect", relationshipId: "relation:usb-return" }, "routing"),
      base("corpus:usb:termination", "topology", "differential_pair", ["pair:usb"], { form: "must_connect", relationshipId: "relation:usb-termination" }, "routing"),
      base("corpus:usb:esd-placement", "placement_proximity", "component", ["component:ESD1"], { form: "distance", relation: "maximum", value: q("length", "5", "mm"), referenceIds: ["component:JUSB"] }, "placement"),
    ], [
      { id: "pair:usb", revision: 1, kind: "differential_pair", members: [{ role: "positive", targetType: "net", targetId: "net:usb-p", order: 0 }, { role: "negative", targetType: "net", targetId: "net:usb-n", order: 1 }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" },
      { id: "relation:usb-return", revision: 1, kind: "return_reference", members: [{ role: "signals", targetType: "differential_pair", targetId: "pair:usb" }, { role: "plane", targetType: "plane", targetId: "plane:gnd" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" },
      { id: "relation:usb-termination", revision: 1, kind: "termination", members: [{ role: "signals", targetType: "differential_pair", targetId: "pair:usb" }, { role: "terminator", targetType: "component", targetId: "component:RUSB" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" },
    ]),
  },
  {
    scenario: "power-entry-protection-edge",
    document: set("power-entry", [
      base("corpus:power:width", "trace_width", "net", ["net:vin"], { form: "minimum", value: q("length", "1.2", "mm") }, "routing"),
      base("corpus:power:clearance", "clearance", "net", ["net:vin"], { form: "minimum", value: q("length", "0.5", "mm") }, "manufacturing"),
      base("corpus:power:edge", "placement_region", "component", ["component:J1"], { form: "containment", regionIds: ["region:edge"], mode: "inside" }, "placement"),
      base("corpus:power:fuse", "terminal_connection", "component", ["component:F1"], { form: "must_connect", relationshipId: "relation:protection" }),
    ], [{ id: "relation:protection", revision: 1, kind: "termination", members: [{ role: "entry", targetType: "component", targetId: "component:J1" }, { role: "fuse", targetType: "component", targetId: "component:F1" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" }]),
  },
  {
    scenario: "four-layer-plane-via-thermal",
    document: set("four-layer", [
      base("corpus:4l:layers", "allowed_layers", "net", ["net:clk"], { form: "allowed_set", values: ["layer:copperTop", "layer:copperBottom"] }, "routing"),
      base("corpus:4l:via", "via_type", "net", ["net:clk"], { form: "allowed_set", values: ["through"] }, "routing"),
      base("corpus:4l:span", "via_span", "net", ["net:clk"], { form: "allowed_set", values: ["layer:copperTop->layer:copperBottom"] }, "routing"),
      base("corpus:4l:return", "return_reference", "net", ["net:clk"], { form: "must_connect", relationshipId: "relation:clk-return" }, "routing"),
      base("corpus:4l:thermal", "zone_thermal_spokes", "net", ["net:gnd"], { form: "minimum", value: { dimension: "dimensionless", value: "4", unit: "1" } }, "pcb_geometry"),
    ], [{ id: "relation:clk-return", revision: 1, kind: "return_reference", members: [{ role: "signal", targetType: "net", targetId: "net:clk" }, { role: "plane", targetType: "plane", targetId: "plane:gnd" }], origin: { kind: "organization_policy", sourceId: "source:stage6-original-corpus", sourceRevision: "1" }, evidenceIds: [], lifecycle: "active" }]),
  },
  {
    scenario: "crowded-placement-soft-routeability",
    document: set("crowded", [
      base("corpus:crowded:room", "placement_region", "component", ["component:U3"], { form: "containment", regionIds: ["region:mcu"], mode: "inside" }, "placement"),
      base("corpus:crowded:fixed", "placement_fixed", "component", ["component:J2"], { form: "equals", value: true }, "placement"),
      base("corpus:crowded:side", "placement_side", "component", ["component:U3"], { form: "allowed_set", values: ["top"] }, "placement"),
      { ...base("corpus:crowded:soft", "placement_proximity", "component", ["component:U3"], { form: "objective", direction: "minimize", metric: "ratsnest", weight: "2" }, "placement"), strength: "soft" },
    ]),
  },
  {
    scenario: "assembly-variant-dnp",
    document: set("variant", [{ ...base("corpus:variant:terminator", "terminal_connection", "component", ["component:RTERM"], { form: "must_exist", cardinality: { kind: "exactly", count: 1 } }), condition: { kind: "fact_equals", factId: "variant:population", value: "production" } }]),
  },
  {
    scenario: "deliberate-hierarchy-conflict",
    document: set("conflict", [
      base("corpus:conflict:min", "trace_width", "net", ["net:conflict"], { form: "minimum", value: q("length", "0.5", "mm") }, "manufacturing"),
      base("corpus:conflict:max", "trace_width", "net", ["net:conflict"], { form: "maximum", value: q("length", "0.2", "mm") }, "routing"),
    ]),
  },
  {
    scenario: "kicad-supported-and-unsupported",
    kicadDru: `(version 1)\n(rule "supported" (condition "A.NetName == 'GND'") (constraint clearance (min 0.2mm)))\n(rule "unsupported" (condition "A.intersectsArea('HV')") (constraint creepage (min 5mm)))`,
  },
] as const;
