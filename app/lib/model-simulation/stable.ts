import { canonicalJson } from "../engineering/stable";
import { stableHash } from "../pcb/smart-routing/hash";

export function simulationDigest(value: unknown): string { const json = canonicalJson(value); return `sim10-${stableHash(`cd10:a\0${json}`)}${stableHash(`cd10:b\0${json}`)}${stableHash(`cd10:c\0${json}`)}${stableHash(`cd10:d\0${json}`)}`; }
export function simulationId(kind: string, value: unknown): string { return `${kind}:${simulationDigest(value).slice(6, 38)}`; }
export function finalizeSimulation<T extends { deterministicDigest: string }>(value: Omit<T, "deterministicDigest"> | T): T { const base = structuredClone(value) as T; delete (base as Partial<T>).deterministicDigest; return { ...base, deterministicDigest: simulationDigest(base) }; }
export function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))].sort(); }
