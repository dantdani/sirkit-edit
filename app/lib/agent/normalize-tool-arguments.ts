import { capturePlainJson, type PlainJsonValue } from "./plain-capture";

type Schema = Record<string, unknown>;
const record = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value);

// Only an explicitly non-null schema licenses erasing the strict renderer's
// synthetic null. An original nullable field retains its domain meaning.
function excludesNull(schema: Schema): boolean {
  if (Array.isArray(schema.anyOf)) return schema.anyOf.every((item) => record(item) && excludesNull(item));
  if (Array.isArray(schema.enum)) return !schema.enum.includes(null);
  if (Object.hasOwn(schema, "const")) return schema.const !== null;
  if (Array.isArray(schema.type)) return !schema.type.includes("null");
  return typeof schema.type === "string" && schema.type !== "null";
}

function normalize(value: PlainJsonValue, schema: Schema): PlainJsonValue {
  // Ambiguous union branches never license omission. Normalizing only when
  // every branch agrees is conservative; the domain validator still decides.
  if (Array.isArray(schema.anyOf)) {
    const candidates = schema.anyOf.map((branch) => record(branch) ? normalize(value, branch) : value);
    return candidates.length && candidates.every((candidate) => JSON.stringify(candidate) === JSON.stringify(candidates[0])) ? candidates[0] : value;
  }
  if (Array.isArray(value) && schema.type === "array" && record(schema.items)) {
    const items = schema.items;
    return value.map((item) => normalize(item, items));
  }
  if (record(value) && schema.type === "object" && record(schema.properties)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const result: Record<string, PlainJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const property = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
      if (record(property) && !required.has(key) && entry === null && excludesNull(property)) continue;
      // Unknown keys, required nulls and array nulls survive to validation.
      Object.defineProperty(result, key, { value: record(property) ? normalize(entry as PlainJsonValue, property) : entry, enumerable: true, configurable: true, writable: true });
    }
    return result;
  }
  return value;
}

/** OD-236: inverse of strict optional->required/nullable, against the ORIGINAL
 * registry schema. Never mutates caller bytes or bypasses domain validation. */
export function normalizeToolArguments(args: unknown, originalSchema: Schema):
  | { ok: true; args: Record<string, unknown> }
  | { ok: false } {
  const captured = capturePlainJson(args);
  if (!captured.ok || !record(captured.value)) return { ok: false };
  return { ok: true, args: normalize(captured.value, originalSchema) as Record<string, unknown> };
}
