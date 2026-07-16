export function createId(prefix: string): string {
  const uuid = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${uuid}`;
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  function normalize(input: unknown): unknown {
    if (input === null || typeof input !== "object") {
      if (typeof input === "number" && !Number.isFinite(input)) return String(input);
      return input;
    }
    if (seen.has(input)) return "[Circular]";
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalize);
    const obj = input as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .filter((key) => obj[key] !== undefined)
        .sort()
        .map((key) => [key, normalize(obj[key])]),
    );
  }
  return JSON.stringify(normalize(value));
}

/** Stable, compact content identity for client-side revision tracking. */
export function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : stableStringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + ((h1 << 5) | (h1 >>> 27));
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}
