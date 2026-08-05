import { canonicalJson } from "../engineering/stable";
import { stableHash } from "../pcb/smart-routing/hash";

export function cd11Digest(value: unknown): string { const json = canonicalJson(value); return `cd11-${stableHash(`cd11:a\0${json}`)}${stableHash(`cd11:b\0${json}`)}${stableHash(`cd11:c\0${json}`)}${stableHash(`cd11:d\0${json}`)}`; }
export function cd11Id(kind: string, value: unknown): string { return `${kind}:${cd11Digest(value).slice(5, 37)}`; }
export function finalizeCd11<T extends { deterministicDigest: string }>(value: Omit<T, "deterministicDigest"> | T): T { const base = structuredClone(value) as T; delete (base as Partial<T>).deterministicDigest; return { ...base, deterministicDigest: cd11Digest(base) }; }
export function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))].sort(); }
