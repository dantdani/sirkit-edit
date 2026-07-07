/**
 * Response contracts for the /api/pcb/footprints/* routes (PCB Stage 2).
 *
 * Pinned cross-stage API: Stage 4 (netlist bridge / footprint auto-assignment)
 * and Stage 8 (auto-place) import these types and rely on the exact shapes.
 * Stage 4 usage: `resolve` for exact KiCad footprint hints ("Lib:Name" strings
 * already stored on symbols), `search` for AI-assisted assignment.
 */

import type { BBox } from "./geometry";
import type { Pad, FootprintModelRef } from "./types";

/** One hit from GET /api/pcb/footprints/search (also `resolve`'s hit shape). */
export interface FootprintSearchHit {
  id: string;
  libName: string;
  name: string;
  /** 'Resistor_SMD:R_0805_2012Metric' */
  fullName: string;
  description: string | null;
  padCount: number;
  attrSmd: boolean;
  attrTht: boolean;
  bodyBBox: BBox;
  /** Hybrid rank score in [0, 1]; exact fullName matches report 1. */
  score: number;
}

/** Full row from GET /api/pcb/footprints/[id] — includes verbatim source. */
export interface FootprintDetail extends Omit<FootprintSearchHit, "score"> {
  tags: string | null;
  pads: Pad[];
  courtyardBBox: BBox | null;
  models: FootprintModelRef[];
  /** VERBATIM .kicad_mod content — Stage 13 splices this into .kicad_pcb. */
  rawSexpr: string;
  source: string;
  sourceCommit: string;
}

/** GET /api/pcb/footprints/search response body. */
export interface FootprintSearchResponse {
  hits: FootprintSearchHit[];
}

/** GET /api/pcb/footprints/resolve response body. */
export interface FootprintResolveResponse {
  hit: FootprintSearchHit | null;
}
