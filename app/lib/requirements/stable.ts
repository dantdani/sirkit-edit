import { canonicalJson, engineeringDigest } from "../engineering/stable";

export function canonicalRequirementsJson(value: unknown): string {
  return canonicalJson(value);
}

/** Browser-safe semantic digest shared by the compiler, project persistence, and UI. */
export function requirementsDigest(value: unknown): string {
  return `req1-${engineeringDigest({ domain: "sirkit.requirements", value }).slice(5)}`;
}

export function requirementsId(prefix: string, value: unknown): string {
  return `${prefix}:${requirementsDigest(value).slice(5)}`;
}

export function withoutRequirementDigest<T extends Record<string, unknown>>(value: T): unknown {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "deterministicDigest"));
}

export function deepFreezeRequirements<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeRequirements(child);
  }
  return value;
}

