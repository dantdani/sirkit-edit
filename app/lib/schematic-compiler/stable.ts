import { canonicalJson } from "../engineering/stable";
import { stableHash } from "../pcb/smart-routing/hash";
export function schematicDigest(value: unknown): string { const json = canonicalJson(value); return `sch8-${stableHash(`cd8:a\0${json}`)}${stableHash(`cd8:b\0${json}`)}${stableHash(`cd8:c\0${json}`)}${stableHash(`cd8:d\0${json}`)}`; }
export function schematicId(kind: string, value: unknown): string { return `${kind}:${schematicDigest(value).slice(5, 37)}`; }
