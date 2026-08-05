import { canonicalJson, engineeringDigest } from "../engineering/stable";

export function architectureDigest(value: unknown): string {
  return `arch1-${engineeringDigest({ domain: "sirkit.architecture", value }).slice(5)}`;
}

export function architectureId(prefix: string, value: unknown): string {
  return `${prefix}:${architectureDigest(value).slice(6)}`;
}

export function canonicalArchitectureJson(value: unknown): string { return canonicalJson(value); }

export function withoutArchitectureDigest<T extends Record<string, unknown>>(value: T): unknown {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "deterministicDigest"));
}

export function deepFreezeArchitecture<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeArchitecture(child);
  }
  return value;
}
