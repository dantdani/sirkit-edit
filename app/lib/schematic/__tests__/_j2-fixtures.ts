/**
 * [PR-J, 2026-10-22] Section J increment 2 golden fixtures (shared by the J2 suites; not a test file itself).
 *
 *  - `dimmerFixtureState()`: the LED-dimmer sheet the M1 / M4 browser journeys open (app/lib/fixture-runtime/__tests__/
 *    _resolution-sheet.ts `fixtureDimmerSheet`: U1 NE555D, R1, C1 resolved, D1 / D2 1N4148 without a published revision), frozen
 *    as `fixtures/j2-dimmer-state.json` at 5bf1e599 before any consumer moved onto the project connectivity authority.
 *  - `groundKindDimmerState()`: the same sheet with its two GND labels renamed to two DIFFERENT ground-kind names (U1 pin 1 on
 *    DGND, C1 pin 2 on AGND): the legacy single-sheet rule publishes both as ONE net named GND and the ERC treats both as its one
 *    ground node (OD-255 item 3, LEGACY_GROUND_NAME_COLLAPSE) - the KiCad ground-kind case.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";

const DIR = join(process.cwd(), "app", "lib", "schematic", "__tests__", "fixtures");

export function dimmerFixtureState(): SchematicState {
  return JSON.parse(readFileSync(join(DIR, "j2-dimmer-state.json"), "utf8")) as SchematicState;
}

export function groundKindDimmerState(): SchematicState {
  const state = dimmerFixtureState();
  const grounds = (state.netLabels ?? []).filter((label) => label.kind === "ground");
  if (grounds.length !== 2) throw new Error(`the dimmer fixture has ${grounds.length} ground labels, expected 2`);
  grounds[0]!.name = "DGND";
  grounds[1]!.name = "AGND";
  return state;
}
