import { canonicalJson } from "../revision";
import { stableHash } from "../smart-routing/hash";

export function placementSemanticHash(value: unknown): string {
  const text = canonicalJson(value);
  return `p7-${stableHash(`sirkit-stage7:a\0${text}`)}${stableHash(`sirkit-stage7:b\0${text}`)}${stableHash(`sirkit-stage7:c\0${text}`)}`;
}

export function placementStableId(prefix: string, value: unknown): string {
  return `${prefix}:${placementSemanticHash(value).slice(3)}`;
}

export function deepFreezePlacement<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezePlacement(child);
  }
  return value;
}
