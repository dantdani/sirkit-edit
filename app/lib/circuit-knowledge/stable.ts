import { canonicalJson, engineeringDigest } from "../engineering/stable";
export function circuitDigest(value: unknown): string { return `ckt1-${engineeringDigest({ domain: "sirkit.circuit-knowledge", value }).slice(5)}`; }
export function circuitId(prefix: string, value: unknown): string { return `${prefix}:${circuitDigest(value).slice(5)}`; }
export function canonicalCircuitJson(value: unknown): string { return canonicalJson(value); }

