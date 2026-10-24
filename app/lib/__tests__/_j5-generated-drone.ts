/**
 * [PR-J5, 2026-10-23] Test fixture: the fixture drone's PLANNED generation result as the fixture provider submits it - its block
 * designs (app/lib/fixture-runtime/generation-recipes.ts) over the committed fixture catalog, merged with final reference designators
 * (mergeBuildNetlists) and the sheet set derived by J5-1's `deriveGeneratedSheets` - for the suites of lib/build-sheet-layout.ts and
 * the page's sheeted replace. Pure; no store, no provider, no network.
 */
import { mergeBuildNetlists } from "@/app/lib/merge-netlists";
import { BLINKER_PART_IDS, FIXTURE_RESOLUTION_PART_IDS, GENERATION_FIXTURE_PART_IDS, fixtureRuntimeCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import { droneBlockDesign, dronePlan, type DesignSpec } from "@/app/lib/fixture-runtime/generation-recipes";
import { designSubmission, type ReturnedPart } from "@/app/lib/fixture-runtime/generation-policy";
import { deriveGeneratedSheets, type GeneratedSheetSet, type GeneratedSheetsPlannedBlock, type PinTypedPart } from "@/app/lib/schematic/generated-sheets";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";

const ROLE_PART: Readonly<Record<string, string>> = {
  header2: BLINKER_PART_IDS.header, capacitor: BLINKER_PART_IDS.capacitor, resistor: BLINKER_PART_IDS.resistor, led: BLINKER_PART_IDS.led,
  ldo: GENERATION_FIXTURE_PART_IDS.ldo, nmos: GENERATION_FIXTURE_PART_IDS.nmos, schottky: GENERATION_FIXTURE_PART_IDS.schottky, mcu: GENERATION_FIXTURE_PART_IDS.mcu,
  imu: GENERATION_FIXTURE_PART_IDS.imu, "header-isp": GENERATION_FIXTURE_PART_IDS.header2x03, "header-uart": GENERATION_FIXTURE_PART_IDS.header1x04,
  timer: BLINKER_PART_IDS.timer, potentiometer: GENERATION_FIXTURE_PART_IDS.potentiometer, "signal-diode": FIXTURE_RESOLUTION_PART_IDS.eligibleDiode,
};

/** The committed fixture catalog (every part the drone references, with its pins). */
export const J5_FIXTURE_CATALOG = fixtureRuntimeCatalog().cachedParts;
/** The project connectivity's part lookup over that catalog. */
export const j5FixtureLookup = (partId: string) => { const part = J5_FIXTURE_CATALOG.get(partId); return part ? { pins: part.pins } : null; };

function returned(partId: string): ReturnedPart {
  const part = J5_FIXTURE_CATALOG.get(partId);
  if (!part) throw new Error(`fixture part ${partId} missing`);
  return { partId, mainCategory: part.mainCategory, pins: part.pins.map((pin) => ({ number: pin.number, name: pin.name, type: pin.type ?? "" })), verified: true, orderableValues: null, text: part.name, name: part.name };
}
function submitted(design: DesignSpec): BuildLogicalNetlist {
  const filled = new Map(design.roles.map((role) => {
    const part = returned(ROLE_PART[role.key]!);
    const values = new Map(design.components.filter((component) => component.role === role.key).map((component) => [component.ref, component.values === "part-name" ? part.name : component.values[0]!] as const));
    return [role.key, { part, values }] as const;
  }));
  return designSubmission(design, filled) as unknown as BuildLogicalNetlist;
}

/** The pin-typed parts deriveGeneratedSheets reads (every role's part). */
export const J5_PIN_TYPED_PARTS: PinTypedPart[] = [...new Set(Object.values(ROLE_PART))].map((partId) => ({ partId, pins: returned(partId).pins }));

/** The drone's planned blocks, its merged netlist and the derived sheet set (non-null for the drone). */
export function generatedDrone(motors: number, barometer: boolean, omit: readonly string[] = []): { netlist: BuildLogicalNetlist; set: GeneratedSheetSet; findings: string[] } {
  const plan = dronePlan(motors, barometer);
  const planned: GeneratedSheetsPlannedBlock[] = plan.blocks.map((block, index) => ({ blockId: `b${index + 1}`, name: block.name, sharedNets: block.sharedNets, status: omit.includes(block.name) ? "omitted" : "designed" }));
  const designedBlocks = plan.blocks.filter((block) => !omit.includes(block.name)).map((block) => ({ name: block.name, netlist: submitted(droneBlockDesign(block.name, block.sharedNets)!) }));
  const merged = mergeBuildNetlists(designedBlocks);
  const ids = planned.filter((block) => block.status === "designed").map((block) => block.blockId);
  const doc = deriveGeneratedSheets({ planned, designed: merged.blocks.map((block, index) => ({ blockId: ids[index]!, name: block.name, netlist: block.netlist })), flat: merged.netlist, parts: J5_PIN_TYPED_PARTS });
  if (!doc.sheets) throw new Error(`the drone derived no sheet set: ${doc.findings.join(" | ")}`);
  return { netlist: merged.netlist, set: doc.sheets, findings: doc.findings };
}
