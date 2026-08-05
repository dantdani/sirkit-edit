import { canonicalJson } from "../engineering/stable";
import { stableHash } from "../pcb/smart-routing/hash";

export function cd13Digest(value: unknown): string { const json = canonicalJson(value); return `cd13-${stableHash(`cd13:a\0${json}`)}${stableHash(`cd13:b\0${json}`)}${stableHash(`cd13:c\0${json}`)}${stableHash(`cd13:d\0${json}`)}`; }
export function cd13Id(kind: string, value: unknown): string { return `${kind}:${cd13Digest(value).slice(5, 37)}`; }
export function finalizeCd13<T extends { deterministicDigest: string }>(value: Omit<T, "deterministicDigest"> | T): T { const base = structuredClone(value) as T; delete (base as Partial<T>).deterministicDigest; return { ...base, deterministicDigest: cd13Digest(base) }; }
export function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))].sort(); }

