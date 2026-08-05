import { canonicalJson, engineeringDigest } from "../engineering/stable";

export function powerDigest(value: unknown): string { return `pwr1-${engineeringDigest({ domain: "sirkit.power-architecture", value }).slice(5)}`; }
export function powerId(prefix: string, value: unknown): string { return `${prefix}:${powerDigest(value).slice(5)}`; }
export function canonicalPowerJson(value: unknown): string { return canonicalJson(value); }
export function withoutPowerDigest<T extends Record<string, unknown>>(value: T): unknown { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "deterministicDigest")); }
