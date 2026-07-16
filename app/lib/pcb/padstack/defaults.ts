/**
 * Default padstacks (PCB Stage 17 Phase C) — one per Stage 10 net class,
 * seeded onto boards that have no padstack library yet. Fixed ids so the
 * route tool can map net class → padstack without a lookup table.
 *
 * Dims are the Stage 17 pinned values (JLCPCB-economy-friendly 0.6/0.3
 * default) — deliberately NOT the Stage 10 `DEFAULT_CLASSES` via dims;
 * existing vias keep their dims through migration regardless.
 */

import type { PcbBoard, Via } from "../types";
import type { NetClassId } from "../netclass";
import { DEFAULT_CLASSES, getNetClass } from "../netclass";
import type { Padstack } from "./types";
import { getPadstack } from "./registry";

export const CLASS_PADSTACK_ID: Record<NetClassId, string> = {
  Default: "via-default",
  Power: "via-power",
  HighCurrent: "via-highcurrent",
};

export const DEFAULT_PADSTACKS: readonly Padstack[] = [
  {
    id: "via-default",
    name: "Via 0.6/0.3",
    kind: "via",
    outerNm: 600_000,
    drillNm: 300_000,
    tented: true,
    zoneConnect: "solid",
  },
  {
    id: "via-power",
    name: "Power via 0.8/0.4",
    kind: "via",
    outerNm: 800_000,
    drillNm: 400_000,
    tented: true,
    zoneConnect: "solid",
  },
  {
    id: "via-highcurrent",
    name: "High-current via 1.2/0.6",
    kind: "via",
    outerNm: 1_200_000,
    drillNm: 600_000,
    tented: true,
    zoneConnect: "solid",
  },
];

/** Seed the class defaults (skipping ids that already exist). Mutates. */
export function seedDefaultPadstacks(board: PcbBoard): boolean {
  const list = board.padstacks ?? (board.padstacks = []);
  let changed = false;
  for (const def of DEFAULT_PADSTACKS) {
    if (!list.some((p) => p.id === def.id)) {
      list.push({ ...def });
      changed = true;
    }
  }
  return changed;
}

/** The active net class's default padstack — the route tool's via source. */
export function classDefaultPadstack(board: PcbBoard, netId: number): Padstack | undefined {
  const effective = getNetClass(board, netId);
  const base = DEFAULT_CLASSES[effective.id];
  // Respect AI/manual via overrides instead of replacing them with the class
  // padstack. The route tool then uses the effective dimensions directly.
  if (effective.viaSize !== base.viaSize || effective.viaDrill !== base.viaDrill) return undefined;
  return getPadstack(board, CLASS_PADSTACK_ID[effective.id]);
}

/** Apply a padstack to a freshly built via (dims denormalized — see registry). */
export function applyPadstackToVia(via: Via, padstack: Padstack): void {
  via.padstackId = padstack.id;
  via.size = padstack.outerNm;
  via.drill = padstack.drillNm;
}
