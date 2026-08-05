import { stableHash } from "@/app/lib/pcb/smart-routing/hash";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  return value;
}

export function canonicalConstraintJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

/** Browser-safe deterministic identity (four domain-separated FNV lanes). */
export function constraintSemanticHash(value: unknown): string {
  const text = canonicalConstraintJson(value);
  return `c6-${["a", "b", "c", "d"].map((lane) => stableHash(`sirkit-stage6:${lane}\0${text}`)).join("")}`;
}

export function stableConstraintId(prefix: string, value: unknown): string {
  return `${prefix}:${constraintSemanticHash(value).slice(3)}`;
}

export function deepFreezeConstraint<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeConstraint(child);
  }
  return value;
}

