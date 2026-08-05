/**
 * B05 — repository-owned deterministic schema + safety validation for tool
 * inputs and outputs. Deliberately dependency-free: the subset of JSON Schema
 * the B04 catalog uses (object/array/string/number/boolean/enum, properties,
 * required, additionalProperties, min/max, maxLength/maxItems).
 *
 * Everything arriving here is UNTRUSTED data. Validation fails closed:
 * unknown schema constructs reject the value rather than admitting it.
 */

export const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface IoLimits {
  maxDepth: number;
  maxStringLength: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxTotalNodes: number;
}

export const DEFAULT_INPUT_LIMITS: IoLimits = Object.freeze({
  maxDepth: 16, maxStringLength: 10_000, maxArrayItems: 2_000, maxObjectKeys: 256, maxTotalNodes: 20_000,
});

export const DEFAULT_OUTPUT_LIMITS: IoLimits = Object.freeze({
  maxDepth: 32, maxStringLength: 100_000, maxArrayItems: 50_000, maxObjectKeys: 4_096, maxTotalNodes: 2_000_000,
});

/**
 * Structural safety: plain JSON only. Rejects functions, symbols, bigints,
 * class instances, cyclic references, prototype-pollution keys, non-finite
 * numbers, and size-limit violations.
 */
export function assertSafeJsonValue(value: unknown, limits: IoLimits, path = "$"): string[] {
  const errors: string[] = [];
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number, at: string): void => {
    if (errors.length >= 20) return;
    nodes += 1;
    if (nodes > limits.maxTotalNodes) { errors.push(`${at}: value exceeds total size limit`); return; }
    if (depth > limits.maxDepth) { errors.push(`${at}: exceeds depth limit`); return; }
    if (current === null || typeof current === "boolean") return;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) errors.push(`${at}: non-finite number`);
      return;
    }
    if (typeof current === "string") {
      if (current.length > limits.maxStringLength) errors.push(`${at}: string exceeds length limit`);
      return;
    }
    if (typeof current === "function" || typeof current === "symbol" || typeof current === "bigint" || current === undefined) {
      errors.push(`${at}: ${typeof current} values are not permitted`);
      return;
    }
    if (typeof current === "object") {
      if (seen.has(current as object)) { errors.push(`${at}: cyclic reference`); return; }
      seen.add(current as object);
      if (Array.isArray(current)) {
        if (current.length > limits.maxArrayItems) errors.push(`${at}: array exceeds item limit`);
        current.forEach((item, index) => visit(item, depth + 1, `${at}[${index}]`));
      } else {
        const proto = Object.getPrototypeOf(current);
        if (proto !== Object.prototype && proto !== null) { errors.push(`${at}: class instances are not permitted`); return; }
        const keys = Object.keys(current as Record<string, unknown>);
        if (keys.length > limits.maxObjectKeys) errors.push(`${at}: object exceeds key limit`);
        for (const key of keys) {
          if (FORBIDDEN_KEYS.has(key)) { errors.push(`${at}.${key}: forbidden key`); continue; }
          visit((current as Record<string, unknown>)[key], depth + 1, `${at}.${key}`);
        }
      }
      seen.delete(current as object);
      return;
    }
    errors.push(`${at}: unsupported value`);
  };
  visit(value, 0, path);
  return errors;
}

/** Deterministic subset JSON-Schema validation. Unknown constructs reject. */
export function validateAgainstSchema(value: unknown, schema: Record<string, unknown>, at = "$"): string[] {
  const errors: string[] = [];
  const type = schema.type;
  const fail = (message: string): string[] => { errors.push(`${at}: ${message}`); return errors; };
  if (schema.enum !== undefined) {
    const allowed = schema.enum as unknown[];
    if (!Array.isArray(allowed) || !allowed.some((candidate) => candidate === value)) return fail(`must be one of ${JSON.stringify(allowed)}`);
    return errors;
  }
  switch (type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("must be an object");
      const record = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema.required ?? []) as string[];
      for (const key of required) if (!(key in record)) errors.push(`${at}.${key}: required`);
      const allowAdditional = schema.additionalProperties !== false;
      for (const [key, entry] of Object.entries(record)) {
        const propertySchema = properties[key];
        if (!propertySchema) {
          if (!allowAdditional) errors.push(`${at}.${key}: unknown field`);
          continue;
        }
        errors.push(...validateAgainstSchema(entry, propertySchema, `${at}.${key}`));
      }
      return errors;
    }
    case "array": {
      if (!Array.isArray(value)) return fail("must be an array");
      const maxItems = schema.maxItems as number | undefined;
      if (maxItems !== undefined && value.length > maxItems) errors.push(`${at}: exceeds maxItems ${maxItems}`);
      const items = schema.items as Record<string, unknown> | undefined;
      if (items) value.forEach((item, index) => errors.push(...validateAgainstSchema(item, items, `${at}[${index}]`)));
      return errors;
    }
    case "string": {
      if (typeof value !== "string") return fail("must be a string");
      const maxLength = schema.maxLength as number | undefined;
      if (maxLength !== undefined && value.length > maxLength) errors.push(`${at}: exceeds maxLength ${maxLength}`);
      const pattern = schema.pattern as string | undefined;
      if (pattern !== undefined && !new RegExp(pattern).test(value)) errors.push(`${at}: does not match pattern`);
      return errors;
    }
    case "number": case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("must be a finite number");
      if (type === "integer" && !Number.isInteger(value)) return fail("must be an integer");
      const minimum = schema.minimum as number | undefined;
      const maximum = schema.maximum as number | undefined;
      if (minimum !== undefined && value < minimum) errors.push(`${at}: below minimum ${minimum}`);
      if (maximum !== undefined && value > maximum) errors.push(`${at}: above maximum ${maximum}`);
      return errors;
    }
    case "boolean": {
      if (typeof value !== "boolean") return fail("must be a boolean");
      return errors;
    }
    default:
      // Fail closed on schema constructs this validator does not implement.
      return fail(`schema type ${String(type)} is not supported by the deterministic validator`);
  }
}

/** Well-formed Sirkit object/project identifiers (untrusted-input gate):
 *  non-empty, bounded, no whitespace or control characters, no pollution keys. */
export function isWellFormedId(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return false; // whitespace + control chars
  }
  return !FORBIDDEN_KEYS.has(value);
}
