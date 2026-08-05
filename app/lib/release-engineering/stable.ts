import { canonicalJson } from "../engineering/stable";
import { stableHash } from "../pcb/smart-routing/hash";

export function cd12Digest(value: unknown): string {
  const json = canonicalJson(value);
  return `cd12-${stableHash(`cd12:a\0${json}`)}${stableHash(`cd12:b\0${json}`)}${stableHash(`cd12:c\0${json}`)}${stableHash(`cd12:d\0${json}`)}`;
}

export function cd12Id(kind: string, value: unknown): string { return `${kind}:${cd12Digest(value).slice(5, 37)}`; }
export function finalizeCd12<T extends { deterministicDigest: string }>(value: Omit<T, "deterministicDigest"> | T): T { const base = structuredClone(value) as T; delete (base as Partial<T>).deterministicDigest; return { ...base, deterministicDigest: cd12Digest(base) }; }
export function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))].sort(); }

