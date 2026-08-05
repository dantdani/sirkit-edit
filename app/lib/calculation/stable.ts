import { engineeringDigest, engineeringId } from "../engineering/stable";
export function calculationDigest(value: unknown): string { return `calc1-${engineeringDigest({ domain: "sirkit.circuit-calculation", value }).slice(5)}`; }
export function calculationId(prefix: string, value: unknown): string { return `${prefix}:${engineeringId("calculation", { prefix, value }).split(":").at(-1)}`; }
