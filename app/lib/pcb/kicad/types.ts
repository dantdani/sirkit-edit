// KiCad 8.x .kicad_pcb export types + shared constants (PCB Stage 13).
// Format spec: https://dev-docs.kicad.org/en/file-formats/sexpr-pcb/

import type { DrcRules } from "../drc/types";

/** Pinned: emit KiCad 8.x only. KiCad 9 opens 8.x files cleanly. */
export const KICAD_PCB_VERSION = 20240108;
export const KICAD_GENERATOR = "sirkit";

export interface WriteKicadPcbOptions {
  /** Download filename stem; default 'sirkit-board'. */
  boardName?: string;
  /** Default true. Zones emit nothing until Stage 11 lands regardless. */
  includeZones?: boolean;
  /** Rules for the (setup ...) block; default: JLCPCB 2-layer preset. */
  drcRules?: DrcRules;
}

/** `(net N "name")` table entry — the merged board/netlist net list. */
export interface KicadNetRef {
  id: number;
  name: string;
}

/** Fresh KiCad-style UUID for every emitted item (pinned: crypto.randomUUID). */
export function newUuid(): string {
  return globalThis.crypto.randomUUID();
}
