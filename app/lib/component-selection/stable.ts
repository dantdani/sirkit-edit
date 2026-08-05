import { canonicalJson, engineeringDigest } from "../engineering/stable";
export function selectionDigest(value: unknown): string { return `sel1-${engineeringDigest({ domain: "sirkit.component-selection", value }).slice(5)}`; }
export function selectionId(prefix: string, value: unknown): string { return `${prefix}:${selectionDigest(value).slice(5)}`; }
export function canonicalSelectionJson(value: unknown): string { return canonicalJson(value); }
