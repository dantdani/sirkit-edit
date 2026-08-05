import { createHash } from "node:crypto";

export function canonicalBenchmarkValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalBenchmarkValue);
  if (!value || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Benchmark canonicalization rejects non-finite numbers.");
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalBenchmarkValue(child)]));
}

export function canonicalBenchmarkJson(value: unknown): string {
  return JSON.stringify(canonicalBenchmarkValue(value));
}

export function benchmarkDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalBenchmarkJson(value)).digest("hex")}`;
}

export function benchmarkStableId(prefix: string, value: unknown): string {
  return `${prefix}:${benchmarkDigest(value).slice(7, 39)}`;
}

export function withoutDigest<T extends Record<string, unknown>>(value: T, key: keyof T): unknown {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== String(key)));
}
