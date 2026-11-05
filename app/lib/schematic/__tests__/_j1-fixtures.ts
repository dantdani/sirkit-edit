/**
 * [PR-J, 2026-10-22] Section J increment 1 golden fixtures (shared by the J1 suites; not a test file itself).
 *
 *  - `j1-blinker-state.json`: the fixture blinker (BLINKER_NETLIST laid out by autoLayoutBuildValidated over blinkerCatalog() with
 *    counter UUIDs), frozen at 5bf1e599 before any section J change.
 *  - `j1-drone-state.json`: the fixture drone (the owner's four-motor sentence through the real generation-task start route, worker
 *    pump and slice core under SIRKIT_FIXTURE_RUNTIME=blinker, laid out the page's way; 41 instances), frozen at 5bf1e599.
 *  - `theoryLegacyFixture()`: a hand-built Theory schematic with a ground symbol, a voltage source, passives, a power label, a local
 *    label pair and two DIFFERENT ground labels (AGND, DGND) on separate nets, the legacy ground-collapse case (OD-255 item 3).
 * The digests pinned in the suites were computed from these inputs at 5bf1e599 (before the sheet contract existed).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureRuntimeCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import type { NetlistPartData } from "@/app/lib/pcb/netlist-bridge";
import type { SchematicState } from "@/lib/schematic-types";

const DIR = join(process.cwd(), "app", "lib", "schematic", "__tests__", "fixtures");

export function blinkerFixtureState(): SchematicState {
  return JSON.parse(readFileSync(join(DIR, "j1-blinker-state.json"), "utf8")) as SchematicState;
}

export function droneFixtureState(): SchematicState {
  return JSON.parse(readFileSync(join(DIR, "j1-drone-state.json"), "utf8")) as SchematicState;
}

/** The committed fixture catalog as the netlist bridge's part lookup (blinker and generation parts). */
export function fixturePartLookup(): (partId: string) => NetlistPartData | null {
  const parts = fixtureRuntimeCatalog().cachedParts;
  return (partId) => parts.get(partId) ?? null;
}

export function fixtureParts(): ReturnType<typeof fixtureRuntimeCatalog>["cachedParts"] {
  return fixtureRuntimeCatalog().cachedParts;
}

export function theoryLegacyFixture(): SchematicState {
  return {
    components: [
      { id: "V1", type: "voltage-source", x: 100, y: 200, rotation: 0, value: "5" },
      { id: "R1", type: "resistor", x: 200, y: 170, rotation: 0, value: "1k" },
      { id: "C1", type: "capacitor", x: 300, y: 170, rotation: 0, value: "100n" },
      { id: "GND1", type: "ground", x: 100, y: 260, rotation: 0, value: "" },
      { id: "R2", type: "resistor", x: 430, y: 170, rotation: 0, value: "10k" },
      { id: "D1", type: "diode", x: 530, y: 170, rotation: 0, value: "1N4148" },
    ],
    wires: [
      { id: "w-v1-r1", vertices: [{ x: 100, y: 170 }, { x: 170, y: 170 }] },
      { id: "w-r1-c1", vertices: [{ x: 230, y: 170 }, { x: 270, y: 170 }] },
      { id: "w-v1-gnd", vertices: [{ x: 100, y: 230 }, { x: 100, y: 240 }] },
    ],
    kicadComponents: [],
    netLabels: [
      { id: "l-out-a", position: { x: 330, y: 170 }, name: "OUT", kind: "label", orientation: 0 },
      { id: "l-out-b", position: { x: 400, y: 170 }, name: "OUT", kind: "label", orientation: 0 },
      { id: "l-agnd", position: { x: 460, y: 170 }, name: "AGND", kind: "ground", orientation: 0 },
      { id: "l-5v", position: { x: 500, y: 170 }, name: "+5V", kind: "power", orientation: 0 },
      { id: "l-dgnd", position: { x: 560, y: 170 }, name: "DGND", kind: "ground", orientation: 0 },
    ],
    pageSize: "A4",
  };
}
