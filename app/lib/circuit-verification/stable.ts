import { canonicalJson } from "../engineering/stable";
import { stableHash } from "../pcb/smart-routing/hash";

export function verificationDigest(value: unknown): string {
  const json = canonicalJson(value);
  return `cv9-${stableHash(`cd9:a\0${json}`)}${stableHash(`cd9:b\0${json}`)}${stableHash(`cd9:c\0${json}`)}${stableHash(`cd9:d\0${json}`)}`;
}

export function verificationId(kind: string, value: unknown): string {
  return `${kind}:${verificationDigest(value).slice(4, 36)}`;
}

export function finalizeVerification<T extends { deterministicDigest: string }>(value: Omit<T, "deterministicDigest"> | T): T {
  const base = structuredClone(value) as T;
  delete (base as Partial<T>).deterministicDigest;
  return { ...base, deterministicDigest: verificationDigest(base) };
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
