import { canonicalJson, engineeringDigest } from "../engineering/stable";

export function interfaceDigest(value: unknown): string { return `ifc1-${engineeringDigest({ domain: "sirkit.interface-planning", value }).slice(5)}`; }
export function interfaceId(prefix: string, value: unknown): string { return `${prefix}:${interfaceDigest(value).slice(5)}`; }
export function canonicalInterfaceJson(value: unknown): string { return canonicalJson(value); }

