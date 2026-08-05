// DRC message + id helpers (PCB Stage 12). Plain-English only — no codes.

import { LAYERS, type LayerId } from "../layers";
import type { PcbBoard } from "../types";
import type { Vec2 } from "../geometry";
import { copperItemId, type CopperItemRef } from "../connectivity-board";
import { padWorldPosition } from "../geometry-copper";
import { physicalPadByIdentity } from "../pad-identity";

/**
 * Nanometers → millimeter string with 2–3 decimals: 100_000 → "0.10",
 * 127_000 → "0.127", 1_000_000 → "1.00". (≥2 decimals so widths read naturally,
 * ≤3 so we don't print sub-µm noise.)
 */
export function fmtMm(nm: number): string {
  let s = (nm / 1_000_000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const dot = s.indexOf(".");
  if (dot === -1) s += ".00";
  else if (s.length - dot - 1 < 2) s += "0";
  return s;
}

/** Human display name for a layer ("Top Copper"), or "the board" when absent. */
export function layerName(layer?: LayerId): string {
  if (!layer) return "the board";
  return LAYERS.find((l) => l.id === layer)?.displayName ?? layer;
}

/** Stable-within-a-run key for a copper item (dedup + violation id). */
export function refKey(ref: CopperItemRef): string {
  switch (ref.kind) {
    case "pad":
      return copperItemId(ref);
    case "track":
      return `track:${ref.id}`;
    case "via":
      return `via:${ref.id}`;
    case "zone-region": // Stage 11
      return `zone:${ref.zoneId}#${ref.regionIndex}`;
  }
}

/** The id a scene highlight (setSelection) understands: item id, or the pad's instance. */
export function refHighlightId(ref: CopperItemRef): string {
  if (ref.kind === "pad") return ref.instanceId;
  if (ref.kind === "zone-region") return ref.zoneId; // Stage 11
  return ref.id;
}

/** World location of an item for zoom-to (track midpoint, via/pad center). */
export function refLocation(board: PcbBoard, ref: CopperItemRef): Vec2 {
  if (ref.kind === "track") {
    const t = board.tracks.find((x) => x.id === ref.id);
    if (t) return { x: (t.start.x + t.end.x) / 2, y: (t.start.y + t.end.y) / 2 };
  } else if (ref.kind === "via") {
    const v = board.vias.find((x) => x.id === ref.id);
    if (v) return { ...v.at };
  } else if (ref.kind === "zone-region") {
    // Stage 11: region bbox center.
    const b = board.zones.find((z) => z.id === ref.zoneId)?.fill[ref.regionIndex]?.boundingBox;
    if (b) return { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) };
  } else {
    const inst = board.footprints.find((f) => f.id === ref.instanceId);
    const pad = inst ? physicalPadByIdentity(inst, ref.padInstanceId, ref.padIndex, ref.padNumber)?.pad : undefined;
    if (inst && pad) return padWorldPosition(inst, pad);
  }
  return { x: 0, y: 0 };
}

/** FNV-1a 32-bit → 8 hex. Deterministic, dependency-free. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Stable id for a violation — hash of kind + sorted item keys + measured/threshold.
 *  `extra` disambiguates checks whose `refs` don't uniquely identify them
 *  (courtyard = footprint pair, silk = a graphic primitive). */
export function violationId(
  kind: string,
  refs: CopperItemRef[],
  measuredNm: number,
  thresholdNm: number,
  extra = "",
): string {
  const keys = refs.map(refKey).sort().join(",");
  return `drc_${fnv1a(`${kind}|${keys}|${measuredNm}|${thresholdNm}|${extra}`)}`;
}
