import { createHash } from "node:crypto";
import { compareCodePoints } from "@/app/lib/stable-compare";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => compareCodePoints(a, b))
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  return value;
}

export function stableJson(value: unknown, pretty = false): string {
  return JSON.stringify(normalize(value), null, pretty ? 2 : undefined);
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function deterministicUuid(hash: string): string {
  const h = hash.padEnd(32, "0").slice(0, 32).split("");
  h[12] = "5";
  h[16] = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export function safeFabName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return (clean || "sirkit-board").slice(0, 80);
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
