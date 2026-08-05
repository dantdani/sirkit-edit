import type { ConstraintDefinition, ConstraintDocument, ConstraintRelationship, TypedRequirement } from "@/app/lib/constraints/types";
import { migrateBoardConstraintState } from "@/app/lib/constraints/legacy";
import { applyConstraintTransaction, previewConstraintTransaction } from "@/app/lib/constraints/transactions";
import { stackupProfile } from "../stackup";
import { mmToNm } from "../units";
import type { FootprintDef, FootprintInstance, Pad, PcbBoard, Zone } from "../types";
import type { EngineeringPlacementOptions } from "./types";

const PROJECT_ID = "stage7-corpus";
const origin = { kind: "organization_policy" as const, sourceId: "source:stage7-original-corpus", sourceRevision: "1" };

function pad(number: string, xMm = 0, yMm = 0): Pad {
  return { number, type: "smd", shape: { kind: "rect", width: mmToNm(0.6), height: mmToNm(0.6) }, at: { x: mmToNm(xMm), y: mmToNm(yMm) }, rotationDeg: 0, layers: ["copperTop"] };
}

function definition(name: string, widthMm: number, heightMm: number, pads: Pad[]): FootprintDef {
  return { libName: "SirkitStage7Corpus", name, attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads, graphics: [], courtyardBBox: { minX: -mmToNm(widthMm / 2), minY: -mmToNm(heightMm / 2), maxX: mmToNm(widthMm / 2), maxY: mmToNm(heightMm / 2) }, bodyBBox: { minX: -mmToNm(widthMm / 2), minY: -mmToNm(heightMm / 2), maxX: mmToNm(widthMm / 2), maxY: mmToNm(heightMm / 2) }, models: [], rawSexpr: `(footprint "${name}")` };
}

function instance(id: string, def: FootprintDef, xMm: number, yMm: number, padNets: Record<string, number> = {}, options: Partial<Pick<FootprintInstance, "locked" | "side" | "rotationDeg" | "placementConstraints">> = {}): FootprintInstance {
  return { id, ref: id.toUpperCase(), footprintId: `SirkitStage7Corpus:${def.name}`, def, at: { x: mmToNm(xMm), y: mmToNm(yMm) }, rotationDeg: options.rotationDeg ?? 0, side: options.side ?? "top", padNets, ...(options.locked ? { locked: true } : {}), ...(options.placementConstraints ? { placementConstraints: options.placementConstraints } : {}) };
}

function board(widthMm: number, heightMm: number, footprints: FootprintInstance[], netNames: string[]): PcbBoard {
  return { formatVersion: 1, identityVersion: 1, stackup: 2, outline: { kind: "rect", width: mmToNm(widthMm), height: mmToNm(heightMm), origin: { x: 0, y: 0 } }, nets: [{ id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] }, ...netNames.map((name, index) => ({ id: index + 1, name, stableId: `net:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, endpointKeys: [] }))], footprints, tracks: [], vias: [], zones: [], texts: [] };
}

function relationship(id: string, kind: ConstraintRelationship["kind"], members: ConstraintRelationship["members"]): ConstraintRelationship {
  return { id, revision: 1, kind, members, origin, evidenceIds: [`evidence:${id}`], lifecycle: "active" };
}

function constraint(id: string, kind: ConstraintDefinition["kind"], targetType: ConstraintDefinition["selector"]["objectType"], targetId: string, requirement: TypedRequirement, strength: ConstraintDefinition["strength"] = "hard"): ConstraintDefinition {
  return { id, revision: 1, name: id, domain: kind.startsWith("placement_") || kind === "critical_loop" || kind === "thermal_relation" ? "placement" : "routing", kind, scope: { type: "project", id: `project:${PROJECT_ID}` }, selector: { objectType: targetType, predicate: { kind: "ids", ids: [targetId] }, cardinality: { kind: "exactly", count: 1 } }, requirement, strength, severityPolicyId: strength === "hard" ? "severity:blocking" : "severity:advisory", origin, evidenceIds: [`evidence:${id}`], lifecycle: { state: "active" }, waiverPolicy: { eligible: false } };
}

function activate(value: PcbBoard, constraints: ConstraintDefinition[] = [], relationships: ConstraintRelationship[] = []): PcbBoard {
  const migrated = migrateBoardConstraintState(value, PROJECT_ID).board;
  const document: ConstraintDocument = { schemaVersion: 1, id: "constraint-set:stage7-corpus", revision: 1, name: "Stage 7 original corpus", extendsSetIds: [], constraints, relationships };
  const preview = previewConstraintTransaction({ board: migrated, projectId: PROJECT_ID, documents: [...migrated.constraintState!.documents.filter((item) => item.id !== document.id), document] });
  const result = applyConstraintTransaction({ board: migrated, projectId: PROJECT_ID, preview, actorId: "corpus:stage7" });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.board;
}

function crossing(heightMm: number, count: number, withObstacle = false): PcbBoard {
  const one = definition("CHANNEL_PIN", 0.4, 0.4, [pad("1")]);
  const footprints: FootprintInstance[] = [];
  for (let index = 0; index < count; index += 1) {
    // Ten columns by two rows keeps every 1.654 mm routing envelope legal
    // while all nets still consume the central horizontal routing cut.
    const column = Math.floor(index / 2);
    const row = index % 2;
    const y = 0.9 + row * (heightMm - 1.8);
    footprints.push(instance(`left-${index}`, one, 0.9 + column * 1.7, y, { "1": index + 1 }));
    footprints.push(instance(`right-${index}`, one, 39.1 - column * 1.7, y, { "1": index + 1 }));
  }
  if (withObstacle) footprints.push(instance("fixed-channel", definition("CHANNEL_BLOCK", 3, Math.max(1, heightMm - 2.4), []), 20, heightMm / 2, {}, { locked: true }));
  return board(40, heightMm, footprints, Array.from({ length: count }, (_, index) => `SIG_${index + 1}`));
}

function currentPlaneZone(widthMm: number, heightMm: number, netId: number): Zone {
  const outer = [{ x: 0, y: 0 }, { x: mmToNm(widthMm), y: 0 }, { x: mmToNm(widthMm), y: mmToNm(heightMm) }, { x: 0, y: mmToNm(heightMm) }];
  return { id: "native-plane", layer: "in1", netId, source: "stackup-plane", sourceLayerId: "in1", polygon: outer, appearance: "solid", connection: "solid", fill: [{ outer, holes: [], boundingBox: { minX: 0, minY: 0, maxX: mmToNm(widthMm), maxY: mmToNm(heightMm) }, areaNm2: mmToNm(widthMm) * mmToNm(heightMm) }], dirty: false, fillState: { status: "current", algorithmVersion: "stage7-corpus", sourceRevision: "stage7-corpus", fillHash: "stage7-corpus", diagnostics: [] } };
}

export interface Stage7PlacementCorpusFixture {
  id: string;
  description: string;
  expected: { feasible: boolean; objectives: string[]; notes: string[] };
  build(): { board: PcbBoard; options: EngineeringPlacementOptions; comparisonBoard?: PcbBoard };
}

const twoPin = definition("TWO_PIN", 2, 1, [pad("1", -0.6), pad("2", 0.6)]);
const onePin = definition("ONE_PIN", 1, 1, [pad("1")]);
const mcu = definition("MCU", 8, 8, [pad("1", -3), pad("2", 3), pad("3", 0, -3), pad("4", 0, 3)]);

export const STAGE7_PLACEMENT_CORPUS: readonly Stage7PlacementCorpusFixture[] = [
  {
    id: "simple-led-two-layer", description: "Simple LED/resistor board for legality and stability.", expected: { feasible: true, objectives: ["wirelength", "placement_stability"], notes: [] },
    build: () => ({ board: activate(board(30, 20, [instance("j1", twoPin, 3, 10, { "1": 1 }), instance("r1", twoPin, 15, 10, { "1": 1, "2": 2 }), instance("d1", twoPin, 26, 10, { "1": 2 })], ["VCC", "LED"])), options: { projectId: PROJECT_ID, seeds: [1, 2] } }),
  },
  {
    id: "forced-crossing-two-layer", description: "Known narrow-channel overflow fixture.", expected: { feasible: true, objectives: ["routing_congestion", "via_pressure"], notes: ["narrow channel must rank below wide channel"] },
    build: () => ({ board: activate(crossing(5, 20)), options: { projectId: PROJECT_ID, capacityColumns: 8, capacityRows: 4, seeds: [3, 4] } }),
  },
  {
    id: "four-layer-all-signal", description: "Four signal layers with alternating preferred directions.", expected: { feasible: true, objectives: ["routing_congestion", "via_pressure"], notes: [] },
    build: () => { const value = crossing(12, 12); value.stackup = 4; value.stackupConfig = stackupProfile("all-signal-4"); return { board: activate(value), options: { projectId: PROJECT_ID, seeds: [5, 6] } }; },
  },
  {
    id: "signal-plane-access", description: "Stage 4 current native plane access and power-via intent.", expected: { feasible: true, objectives: ["plane_return_access", "via_pressure"], notes: ["only current native fill counts as plane access"] },
    build: () => { const value = board(30, 20, [instance("u1", mcu, 10, 10, { "1": 1 }), instance("c1", twoPin, 20, 10, { "1": 1 })], ["GND"]); value.stackup = 4; value.stackupConfig = stackupProfile("signal-plane-4"); value.stackupConfig.copperLayers.find((layer) => layer.id === "in1")!.planeNetId = 1; value.zones.push(currentPlaneZone(30, 20, 1)); return { board: activate(value), options: { projectId: PROJECT_ID, seeds: [7, 8] } }; },
  },
  {
    id: "crowded-mcu", description: "Crowded 30-part MCU-style legalizer/capacity regression.", expected: { feasible: true, objectives: ["routing_congestion", "pin_escape", "wirelength"], notes: ["legacy crossing count is diagnostic only"] },
    build: () => { const footprints = [instance("u1", mcu, 30, 20, { "1": 1, "2": 2, "3": 3, "4": 4 })]; for (let index = 0; index < 29; index += 1) footprints.push(instance(`r${index}`, twoPin, 3 + index % 10 * 5, 3 + Math.floor(index / 10) * 5, { "1": index % 4 + 1 })); return { board: activate(board(60, 40, footprints, ["GND", "VCC", "CLK", "IO"])), options: { projectId: PROJECT_ID, seeds: [9, 10], candidateCount: 4 } }; },
  },
  {
    id: "mcu-decoupling", description: "MCU with exact supply-pin/capacitor relationships.", expected: { feasible: true, objectives: ["decoupling", "plane_return_access"], notes: ["geometry is not electrical-performance proof"] },
    build: () => { const value = board(40, 30, [instance("u1", mcu, 20, 15, { "1": 1 }), ...Array.from({ length: 4 }, (_, i) => instance(`c${i + 1}`, twoPin, 5 + i * 10, 5, { "1": 1 }))], ["VDD"]); return { board: activate(value, [], [relationship("relation:mcu-decoupling", "decoupling", [{ role: "load", targetType: "component", targetId: "component:u1" }, ...Array.from({ length: 4 }, (_, i) => ({ role: "capacitor", targetType: "component" as const, targetId: `component:c${i + 1}` }))])]), options: { projectId: PROJECT_ID, seeds: [11, 12] } }; },
  },
  {
    id: "switching-regulator", description: "Power stage with explicit current loop and switch-node intent.", expected: { feasible: true, objectives: ["critical_loop", "sensitive_separation", "plane_return_access"], notes: ["not EMI/PI proof"] },
    build: () => { const value = board(40, 25, [instance("ureg", mcu, 20, 12, { "1": 1, "2": 2 }), instance("cin", twoPin, 5, 12, { "1": 1 }), instance("l1", twoPin, 28, 12, { "1": 2 }), instance("cout", twoPin, 36, 12, { "1": 3 })], ["VIN", "SW", "VOUT"]); return { board: activate(value, [], [relationship("relation:buck-loop", "current_loop", [{ role: "input-cap", targetType: "component", targetId: "component:cin" }, { role: "switch", targetType: "component", targetId: "component:ureg" }, { role: "inductor", targetType: "component", targetId: "component:l1" }, { role: "output-cap", targetType: "component", targetId: "component:cout" }])]), options: { projectId: PROJECT_ID, seeds: [13, 14] } }; },
  },
  {
    id: "usb-differential", description: "Connector/ESD/termination/receiver differential interface.", expected: { feasible: true, objectives: ["high_speed_ordering", "plane_return_access"], notes: ["Stage 8 routing/tuning still required"] },
    build: () => { const value = board(50, 25, [instance("jusb", twoPin, 3, 12, { "1": 1, "2": 2 }, { placementConstraints: { edgeConnector: "left" } }), instance("esd", mcu, 15, 12, { "1": 1, "2": 2 }), instance("term", mcu, 27, 12, { "1": 1, "2": 2 }), instance("u1", mcu, 43, 12, { "1": 1, "2": 2 })], ["USB_P", "USB_N"]); const relations = [relationship("pair:usb", "differential_pair", [{ role: "positive", targetType: "net", targetId: "net:usb-p", order: 0 }, { role: "negative", targetType: "net", targetId: "net:usb-n", order: 1 }]), relationship("relation:usb-chain", "termination", [{ role: "connector", targetType: "component", targetId: "component:jusb", order: 0 }, { role: "esd", targetType: "component", targetId: "component:esd", order: 1 }, { role: "termination", targetType: "component", targetId: "component:term", order: 2 }, { role: "receiver", targetType: "component", targetId: "component:u1", order: 3 }])]; return { board: activate(value, [], relations), options: { projectId: PROJECT_ID, seeds: [15, 16] } }; },
  },
  {
    id: "rf-antenna-crystal", description: "Explicit RF edge/keepout and sensitive-chain fixture.", expected: { feasible: true, objectives: ["mechanical_edge", "sensitive_separation"], notes: ["no name-only RF inference"] },
    build: () => { const value = board(45, 25, [instance("ant", onePin, 42, 12, { "1": 1 }, { placementConstraints: { edgeConnector: "right", criticalRole: "rf" } }), instance("match", twoPin, 34, 12, { "1": 1 }), instance("xtal", twoPin, 15, 12, { "1": 2 }, { placementConstraints: { criticalRole: "clock" } }), instance("mcu", mcu, 22, 12, { "1": 2 })], ["RF", "XTAL"]); value.routingKeepouts = [{ id: "antenna-keepout", name: "Antenna copper keepout", polygon: [{ x: mmToNm(38), y: mmToNm(5) }, { x: mmToNm(45), y: mmToNm(5) }, { x: mmToNm(45), y: mmToNm(20) }, { x: mmToNm(38), y: mmToNm(20) }], layers: ["copperTop", "copperBottom"], forbidTracks: true, forbidVias: true }]; return { board: activate(value), options: { projectId: PROJECT_ID, seeds: [17, 18] } }; },
  },
  {
    id: "connector-mechanical", description: "Edge connector, mounting fixtures, side/orientation policy.", expected: { feasible: true, objectives: ["mechanical_edge", "assembly_test"], notes: [] },
    build: () => { const value = board(40, 30, [instance("j1", mcu, 5, 15, {}, { placementConstraints: { edgeConnector: "left", allowedRotations: [90, 270] } }), instance("h1", onePin, 3, 3, {}, { locked: true }), instance("h2", onePin, 37, 27, {}, { locked: true }), instance("u1", mcu, 25, 15, {})], []); return { board: activate(value, [constraint("c:j1:side", "placement_side", "component", "component:j1", { form: "allowed_set", values: ["top"] })]), options: { projectId: PROJECT_ID, seeds: [19, 20] } }; },
  },
  {
    id: "thermal-separation", description: "Source-backed hot/sensitive minimum separation.", expected: { feasible: true, objectives: ["thermal_intent", "placement_stability"], notes: ["geometric proxy only"] },
    build: () => { const value = board(40, 30, [instance("hot", mcu, 10, 15, {}, { placementConstraints: { criticalRole: "thermal" } }), instance("sensor", mcu, 30, 15, {}, { placementConstraints: { criticalRole: "analog" } })], []); return { board: activate(value, [constraint("c:thermal:separation", "placement_separation", "component", "component:hot", { form: "distance", relation: "minimum", value: { dimension: "length", value: "10", unit: "mm" }, referenceIds: ["component:sensor"] }, "soft")]), options: { projectId: PROJECT_ID, seeds: [21, 22] } }; },
  },
  {
    id: "assembly-variant", description: "DNP-excluded assembly variant fixture.", expected: { feasible: true, objectives: ["placement_stability"], notes: ["unpopulated instance is absent, not silently placed"] },
    build: () => ({ board: activate(board(30, 20, [instance("u1", mcu, 15, 10), instance("r-pop", twoPin, 5, 10)], [])), options: { projectId: PROJECT_ID, seeds: [23, 24] } }),
  },
  {
    id: "routed-protected-scope", description: "Existing manual/generated copper with preserve and selected-scope policy.", expected: { feasible: true, objectives: ["placement_stability"], notes: ["manual copper must remain protected"] },
    build: () => { const value = board(40, 20, [instance("a", twoPin, 10, 10, { "1": 1 }), instance("b", twoPin, 30, 10, { "1": 1 })], ["SIG"]); value.tracks = [{ id: "manual", layer: "copperTop", width: mmToNm(0.25), start: { x: mmToNm(9.4), y: mmToNm(10) }, end: { x: mmToNm(15), y: mmToNm(10) }, netId: 1, source: "human", locked: true }, { id: "generated", layer: "copperTop", width: mmToNm(0.25), start: { x: mmToNm(29.4), y: mmToNm(10) }, end: { x: mmToNm(25), y: mmToNm(10) }, netId: 1, source: "autorouter" }]; return { board: activate(value), options: { projectId: PROJECT_ID, mode: "preserve_routed", seeds: [25, 26] } }; },
  },
  {
    id: "deliberately-infeasible", description: "Envelope area exceeds authorized outline.", expected: { feasible: false, objectives: [], notes: ["outline must not expand silently"] },
    build: () => ({ board: activate(board(10, 10, [instance("a", definition("HUGE", 12, 12, []), 5, 5)], [])), options: { projectId: PROJECT_ID, seeds: [27, 28] } }),
  },
  {
    id: "same-hpwl-different-capacity", description: "Same signal endpoints with and without a fixed channel obstruction.", expected: { feasible: true, objectives: ["routing_congestion", "wirelength"], notes: ["capacity must distinguish equal HPWL"] },
    build: () => ({ board: activate(crossing(5, 20, true)), comparisonBoard: activate(crossing(5, 20, false)), options: { projectId: PROJECT_ID, capacityColumns: 8, capacityRows: 4, seeds: [29, 30] } }),
  },
] as const;
