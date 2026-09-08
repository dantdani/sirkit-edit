import type { FootprintInstance, Pad } from "./types";
import { stableHash } from "./smart-routing/hash";
import { compareCodePoints } from "@/app/lib/stable-compare";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => compareCodePoints(a, b))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

/** Geometry/electrical identity independent of footprint pad array ordering. */
export function padSemanticKey(pad: Pad): string {
  return JSON.stringify(canonicalValue({
    number: pad.number,
    type: pad.type,
    shape: pad.shape,
    at: pad.at,
    rotationDeg: pad.rotationDeg,
    layers: [...pad.layers].sort(),
    drill: pad.drill,
  }));
}

export interface IndexedPhysicalPad {
  id: string;
  footprintId: string;
  padIndex: number;
  padNumber: string;
  pad: Pad;
}

/**
 * Stable physical-pad instances. Repeated pad numbers remain distinct; exact
 * duplicate definitions receive a deterministic occurrence suffix as a set.
 */
export function physicalPadInstances(footprint: FootprintInstance): IndexedPhysicalPad[] {
  const entries = footprint.def.pads.map((pad, padIndex) => ({ pad, padIndex, key: padSemanticKey(pad) }));
  entries.sort((a, b) => compareCodePoints(a.key, b.key) || a.padIndex - b.padIndex);
  const occurrences = new Map<string, number>();
  return entries.map(({ pad, padIndex, key }) => {
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    return {
      id: `pad:${encodeURIComponent(footprint.id)}:${encodeURIComponent(pad.number)}:${stableHash(key)}:${occurrence}`,
      footprintId: footprint.id,
      padIndex,
      padNumber: pad.number,
      pad,
    };
  }).sort((a, b) => compareCodePoints(a.id, b.id));
}

export function physicalPadByIdentity(
  footprint: FootprintInstance,
  padInstanceId: string | undefined,
  padIndex: number | undefined,
  padNumber: string,
): IndexedPhysicalPad | undefined {
  const pads = physicalPadInstances(footprint);
  return pads.find((entry) => entry.id === padInstanceId)
    ?? pads.find((entry) => entry.padIndex === padIndex)
    ?? pads.find((entry) => entry.padNumber === padNumber);
}
