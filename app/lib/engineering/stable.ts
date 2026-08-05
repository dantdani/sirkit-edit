import { canonicalJson, canonicalJsonValue } from "../pcb/revision";
import { stableHash } from "../pcb/smart-routing/hash";

export { canonicalJson, canonicalJsonValue };

/** Browser-safe deterministic engineering identity. Durable stores add a cryptographic envelope digest. */
export function engineeringDigest(value: unknown): string {
  const json = canonicalJson(value);
  return `eng1-${stableHash(`stage10:a\0${json}`)}${stableHash(`stage10:b\0${json}`)}`;
}

export function engineeringId(prefix: string, value: unknown): string {
  return `${prefix}:${engineeringDigest(value).slice(5)}`;
}

export function objectVersion(value: unknown): string {
  return engineeringDigest({ schema: "sirkit.object-version.v1", value });
}

export function omitKey<T extends Record<string, unknown>>(value: T, key: keyof T): unknown {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== String(key)));
}
