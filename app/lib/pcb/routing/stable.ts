import { canonicalJson } from "../revision";
import { stableHash } from "../smart-routing/hash";

export function routingSemanticHash(value: unknown): string {
  const text = canonicalJson(value);
  return `r8-${stableHash(`sirkit-stage8:a\0${text}`)}${stableHash(`sirkit-stage8:b\0${text}`)}${stableHash(`sirkit-stage8:c\0${text}`)}`;
}

export function routingStableId(prefix: string, value: unknown): string {
  return `${prefix}:${routingSemanticHash(value).slice(3)}`;
}

export function deepFreezeRouting<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeRouting(child);
  }
  return value;
}
