/**
 * B09 — provider-safe agent tool rendering.
 *
 * Corrects the outdated B04 adapter assumptions:
 *  - OpenAI now renders the FLAT Responses-API function-tool shape
 *    (`{type:"function", name, description, parameters, strict:true}`),
 *    never the nested Chat Completions `{function:{…}}` shape.
 *  - Anthropic renders `{name, description, input_schema, strict:true}`.
 *  - Both providers receive STRICT schemas: every object level carries
 *    `additionalProperties:false` and lists EVERY property in `required`;
 *    previously-optional fields become nullable (`type: [T, "null"]`) so
 *    optionality survives strict mode without semantic drift.
 *  - Provider names map reversibly and collision-checked to
 *    `{toolId, version}`; unknown/ambiguous names resolve to nothing.
 *
 * Rendering happens ONLY over the exact discovered/exposed subset for a
 * run — never over the whole registry.
 */

import { canonicalJson } from "../engineering/stable";
import type { JsonSchema, ToolDescriptor } from "../engineering/tool-registry";
import type { ProviderToolDeclaration } from "./contracts";

// ─── Strict schema conversion ────────────────────────────────────────────────

/**
 * [B09.1] the COMMON WIRE SUBSET both providers' strict modes provably
 * accept. Every keyword outside this set — including `minItems`/`maxItems`
 * (observed rejected live by Anthropic strict tools), `oneOf`, `allOf`,
 * `pattern`, `format`, length/number bounds, `$ref`, … — is REJECTED
 * before rendering instead of silently forwarded. Runtime bounds (e.g. the
 * proposal's 1–20 operation limit) live in server-side argument
 * validation, never in wire schemas. Unknown constructs are never
 * weakened or guessed.
 */
const WIRE_SUBSET_KEYWORDS = new Set([
  "type", "description", "properties", "required", "additionalProperties",
  "items", "enum", "anyOf", "const", "title",
]);

const JSON_SCHEMA_TYPES = new Set(["object", "string", "number", "integer", "boolean", "array", "null"]);

/** JSON-safe primitive: null, string, boolean, or a FINITE number. */
function isJsonSafePrimitive(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}

/** Does `value` inhabit the declared non-null base type? */
function matchesBaseType(value: unknown, baseType: string): boolean {
  switch (baseType) {
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "null": return value === null;
    default: return false; // object/array values are never valid enum/const members here
  }
}

/**
 * [B09.2/B09.3] SEMANTIC validation of a schema node — run BEFORE
 * normalization (against the untouched source) and AGAIN on the normalized
 * output. Beyond container shape, this enforces keyword VALUE types,
 * type/keyword compatibility, type-array discipline, enum/const value
 * typing, and rejects unconstrained empty schemas — malformed or
 * meaningless constructs are rejected, never silently discarded, weakened,
 * or guessed. The source schema is never mutated.
 */
export function validateSchemaStructure(node: unknown, path = "$"): string[] {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return [`${path}: a schema must be a plain object`];
  }
  const issues: string[] = [];
  const value = node as Record<string, unknown>;
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!WIRE_SUBSET_KEYWORDS.has(key)) issues.push(`${path}.${key}: unknown or unsupported keyword`);
  }

  // A schema must actually constrain something — an empty (or
  // annotation-only) schema is never guessed into a type.
  const CONSTRAINT_KEYWORDS = ["type", "enum", "const", "anyOf", "properties"];
  if (!keys.some((key) => CONSTRAINT_KEYWORDS.includes(key))) {
    issues.push(`${path}: unconstrained schema (no type/enum/const/anyOf/properties) — declare the intended type explicitly`);
  }

  // Annotation keyword VALUE types.
  if (value.description !== undefined && typeof value.description !== "string") {
    issues.push(`${path}.description: must be a string`);
  }
  if (value.title !== undefined && typeof value.title !== "string") {
    issues.push(`${path}.title: must be a string`);
  }

  // Type declaration: a single base type, or [base, "null"] — never
  // duplicates, never multiple unrelated non-null types.
  let declaredTypes: string[] = [];
  let typeValid = false;
  if (value.type !== undefined) {
    const types = Array.isArray(value.type) ? value.type : [value.type];
    typeValid = true;
    if (types.length === 0) { issues.push(`${path}.type: empty type array`); typeValid = false; }
    for (const item of types) {
      if (typeof item !== "string" || !JSON_SCHEMA_TYPES.has(item)) { issues.push(`${path}.type: invalid type ${JSON.stringify(item)}`); typeValid = false; }
    }
    if (Array.isArray(value.type)) {
      if (new Set(value.type).size !== value.type.length) { issues.push(`${path}.type: duplicate type entries`); typeValid = false; }
      const nonNull = types.filter((item) => item !== "null");
      if (nonNull.length > 1) { issues.push(`${path}.type: multiple non-null base types (${nonNull.join(", ")}) are not supported — use exactly one, optionally with "null"`); typeValid = false; }
      if (nonNull.length === 0) { issues.push(`${path}.type: a type array must contain exactly one non-null base type`); typeValid = false; }
    }
    if (typeValid) declaredTypes = types.filter((item): item is string => typeof item === "string");
  }
  const nonNullBase = declaredTypes.find((item) => item !== "null") ?? (declaredTypes.includes("null") ? "null" : undefined);

  // anyOf composes ALTERNATIVES; combining it with sibling constraint
  // keywords at the same level is ambiguous and unsupported.
  if (value.anyOf !== undefined) {
    for (const sibling of ["type", "properties", "required", "additionalProperties", "items", "enum", "const"]) {
      if (value[sibling] !== undefined) issues.push(`${path}.anyOf: cannot be combined with sibling "${sibling}" — move the constraint into the anyOf members`);
    }
    if (!Array.isArray(value.anyOf) || value.anyOf.length === 0) {
      issues.push(`${path}.anyOf: must be a non-empty array of schemas`);
    } else {
      (value.anyOf as unknown[]).forEach((item, index) => issues.push(...validateSchemaStructure(item, `${path}.anyOf[${index}]`)));
    }
  }

  // Object-only keywords require an EXPLICIT object base type. [B10 gate 0]
  // A schema carrying properties/required/additionalProperties WITHOUT
  // `type` is refused instead of being silently inferred into an object.
  const isObjectSchema = typeValid && nonNullBase === "object";
  for (const keyword of ["properties", "required", "additionalProperties"] as const) {
    if (value[keyword] !== undefined && !isObjectSchema) {
      issues.push(`${path}.${keyword}: only valid on schemas with an explicit object base type (declared type is ${value.type === undefined ? "absent" : JSON.stringify(value.type)})`);
    }
  }
  if (value.properties !== undefined) {
    if (typeof value.properties !== "object" || value.properties === null || Array.isArray(value.properties)) {
      issues.push(`${path}.properties: must be a plain object`);
    } else {
      for (const [name, property] of Object.entries(value.properties as Record<string, unknown>)) {
        issues.push(...validateSchemaStructure(property, `${path}.properties.${name}`));
      }
    }
  }
  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.some((item) => typeof item !== "string")) {
      issues.push(`${path}.required: must be an array of strings`);
    } else {
      if (new Set(value.required).size !== value.required.length) issues.push(`${path}.required: duplicate entries`);
      const names = typeof value.properties === "object" && value.properties !== null ? Object.keys(value.properties as Record<string, unknown>) : [];
      for (const name of value.required as string[]) {
        if (!names.includes(name)) issues.push(`${path}.required: "${name}" is not a declared property`);
      }
    }
  }
  if (value.additionalProperties !== undefined && value.additionalProperties !== false) {
    issues.push(`${path}.additionalProperties: only the fail-closed form (false) is supported`);
  }

  // Array-only keywords require an EXPLICIT array base type [B10 gate 0],
  // and arrays require exactly ONE items schema (never a tuple array).
  if (value.items !== undefined && nonNullBase !== "array") {
    issues.push(`${path}.items: only valid on schemas with an explicit array base type (declared type is ${value.type === undefined ? "absent" : JSON.stringify(value.type)})`);
  }
  if (value.items !== undefined) {
    if (Array.isArray(value.items)) {
      issues.push(`${path}.items: must be exactly one schema object, not a tuple array`);
    } else {
      issues.push(...validateSchemaStructure(value.items, `${path}.items`));
    }
  }
  if (nonNullBase === "array" && value.items === undefined) {
    issues.push(`${path}: array type requires a valid items schema`);
  }

  // enum/const: JSON-safe primitive values (finite numbers), consistent
  // with the declared non-null type when one is declared, and never both.
  if (value.enum !== undefined && value.const !== undefined) {
    issues.push(`${path}: enum and const cannot be combined`);
  }
  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.some((item) => !isJsonSafePrimitive(item))) {
      issues.push(`${path}.enum: must be a non-empty array of JSON-safe primitive values (finite numbers only)`);
    } else if (typeValid && declaredTypes.length > 0) {
      for (const item of value.enum) {
        const fitsDeclared = declaredTypes.some((declared) => matchesBaseType(item, declared));
        if (!fitsDeclared) issues.push(`${path}.enum: value ${JSON.stringify(item)} does not inhabit the declared type ${JSON.stringify(value.type)}`);
      }
    }
  }
  if (value.const !== undefined) {
    if (!isJsonSafePrimitive(value.const)) {
      issues.push(`${path}.const: must be a JSON-safe primitive value (finite numbers only)`);
    } else if (typeValid && declaredTypes.length > 0 && !declaredTypes.some((declared) => matchesBaseType(value.const, declared))) {
      issues.push(`${path}.const: value ${JSON.stringify(value.const)} does not inhabit the declared type ${JSON.stringify(value.type)}`);
    }
  }

  return issues;
}

/** Recursive common-wire-subset validation; returns every violation path. */
export function validateWireSubset(schema: unknown, path = "$"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item, index) => validateWireSubset(item, `${path}[${index}]`));
  if (typeof schema !== "object" || schema === null) return [];
  const issues: string[] = [];
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!WIRE_SUBSET_KEYWORDS.has(key)) {
      issues.push(`${path}.${key}: keyword is outside the proven provider wire subset`);
      continue;
    }
    if (key === "properties" && typeof value === "object" && value !== null) {
      for (const [name, property] of Object.entries(value as Record<string, unknown>)) {
        issues.push(...validateWireSubset(property, `${path}.properties.${name}`));
      }
    } else if (key === "items" || key === "anyOf") {
      issues.push(...validateWireSubset(value, `${path}.${key}`));
    }
  }
  return issues;
}

/** Convert a registry JSON schema to a strict-compatible schema. Throws
 *  `STRICT_SCHEMA_UNSUPPORTED:` when the shape cannot be represented
 *  strictly OR uses keywords outside the proven wire subset (the tool is
 *  then excluded, never weakened). */
export function toStrictSchema(schema: JsonSchema): JsonSchema {
  // [B09.2] structural/semantic validation of the SOURCE (before any
  // rewriting can hide a malformed construct, e.g. required entries that
  // reference nonexistent properties)…
  const pre = validateSchemaStructure(schema);
  if (pre.length > 0) throw new Error(`STRICT_SCHEMA_UNSUPPORTED:${pre.slice(0, 3).join("; ")}`);
  // [B09.3] a function PARAMETERS root must be an explicit object schema —
  // a string/array/enum root can never describe tool arguments.
  if ((schema as Record<string, unknown>).type !== "object") {
    throw new Error("STRICT_SCHEMA_UNSUPPORTED:$: a function parameters root must be an explicit object schema (type: \"object\")");
  }
  const converted = convert(structuredClone(schema)) as JsonSchema;
  // …and of the NORMALIZED output before provider rendering.
  const post = [...validateSchemaStructure(converted), ...validateWireSubset(converted)];
  if (post.length > 0) throw new Error(`STRICT_SCHEMA_UNSUPPORTED:${post.slice(0, 3).join("; ")}`);
  if ((converted as Record<string, unknown>).type !== "object") {
    throw new Error("STRICT_SCHEMA_UNSUPPORTED:$: normalization did not preserve the explicit object parameters root");
  }
  return converted;
}

function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert);
  if (typeof node !== "object" || node === null) return node;
  const value = { ...(node as Record<string, unknown>) };
  // [B10 gate 0] the properties-without-type inference branch is REMOVED:
  // only an explicit `type: "object"` schema is normalized as an object
  // (pre-validation refuses object-only keywords without that type).
  if (value.type === "object") {
    const properties = (value.properties ?? {}) as Record<string, unknown>;
    const previouslyRequired = new Set(Array.isArray(value.required) ? (value.required as string[]) : []);
    const names = Object.keys(properties);
    for (const name of names) {
      properties[name] = convert(properties[name]);
      if (!previouslyRequired.has(name)) {
        // Optional → required + nullable (strict-compatible optionality).
        const property = properties[name] as Record<string, unknown>;
        if (typeof property.type === "string") property.type = [property.type, "null"];
        else if (Array.isArray(property.type)) { if (!(property.type as unknown[]).includes("null")) (property.type as unknown[]).push("null"); }
        else if (property.enum !== undefined || property.anyOf !== undefined) {
          properties[name] = { anyOf: [property, { type: "null" }] };
        } else {
          throw new Error(`STRICT_SCHEMA_UNSUPPORTED:optional property "${name}" cannot be made nullable`);
        }
      }
    }
    value.type = "object";
    value.properties = properties;
    value.required = names;
    value.additionalProperties = false;
  }
  if (value.items !== undefined) value.items = convert(value.items);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(value[key])) value[key] = (value[key] as unknown[]).map(convert);
  }
  return value;
}

/** Validate a descriptor's schema is strict-representable. */
export function strictCompatibility(descriptor: ToolDescriptor): { ok: true; schema: JsonSchema } | { ok: false; reason: string } {
  try {
    return { ok: true, schema: toStrictSchema(descriptor.inputSchema) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// ─── Reversible, collision-checked name mapping ──────────────────────────────

export function agentProviderName(toolId: string): string {
  const name = toolId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  if (name.length === 0 || name.length > 64) throw new Error(`TOOL_NAME_UNREPRESENTABLE:${toolId}`);
  return name;
}

export interface AgentToolNameMap {
  declarations: ProviderToolDeclaration[];
  /** providerName → exactly one {toolId, version}. */
  resolve(providerName: string): { toolId: string; version: string } | null;
}

/** Build declarations + the reversible map over the EXACT exposed subset.
 *  A name collision (two tool ids mapping to one provider name) throws —
 *  ambiguity is a registration error, never resolved by guessing. */
export function buildAgentToolDeclarations(descriptors: readonly ToolDescriptor[]): AgentToolNameMap {
  const byName = new Map<string, { toolId: string; version: string }>();
  const declarations: ProviderToolDeclaration[] = [];
  for (const descriptor of descriptors) {
    const strict = strictCompatibility(descriptor);
    if (!strict.ok) throw new Error(`AGENT_TOOL_NOT_STRICT:${descriptor.toolId}: ${strict.reason}`);
    const providerName = agentProviderName(descriptor.toolId);
    const existing = byName.get(providerName);
    if (existing && existing.toolId !== descriptor.toolId) {
      throw new Error(`AGENT_TOOL_NAME_COLLISION:${providerName} (${existing.toolId} vs ${descriptor.toolId})`);
    }
    byName.set(providerName, { toolId: descriptor.toolId, version: descriptor.version });
    declarations.push({
      providerName,
      toolId: descriptor.toolId,
      version: descriptor.version,
      description: descriptor.description,
      inputSchema: strict.schema,
    });
  }
  declarations.sort((a, b) => a.providerName.localeCompare(b.providerName));
  return {
    declarations,
    resolve: (providerName: string) => byName.get(providerName) ?? null,
  };
}

// ─── Provider shapes (current official formats) ──────────────────────────────

/** OpenAI Responses API FLAT function tool (not the nested Chat shape). */
export interface OpenAiResponsesFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
  strict: true;
}

export function renderOpenAiResponsesTool(declaration: ProviderToolDeclaration): OpenAiResponsesFunctionTool {
  return {
    type: "function",
    name: declaration.providerName,
    description: declaration.description,
    parameters: structuredClone(declaration.inputSchema) as JsonSchema,
    strict: true,
  };
}

export interface AnthropicAgentTool {
  name: string;
  description: string;
  input_schema: JsonSchema;
  strict: true;
}

export function renderAnthropicAgentTool(declaration: ProviderToolDeclaration): AnthropicAgentTool {
  return {
    name: declaration.providerName,
    description: declaration.description,
    input_schema: structuredClone(declaration.inputSchema) as JsonSchema,
    strict: true,
  };
}

/** Deterministic B09 parity report over the exposed declarations. */
export function renderAgentProviderParity(declarations: readonly ProviderToolDeclaration[]): {
  schema: "sirkit.agent-provider-parity.v2";
  notes: string[];
  tools: Array<{ toolId: string; version: string; providerName: string; semanticallyEquivalent: boolean; strict: true }>;
} {
  return {
    schema: "sirkit.agent-provider-parity.v2",
    notes: [
      "OpenAI renders the FLAT Responses-API function tool shape with strict:true.",
      "Anthropic renders {name, description, input_schema} with strict:true.",
      "Strict schemas: every object level has additionalProperties:false and full required lists; optional fields are nullable.",
      "Semantic equivalence compares {name, description, inputSchema} across both renderers via canonical JSON.",
    ],
    tools: declarations.map((declaration) => {
      const openAi = renderOpenAiResponsesTool(declaration);
      const anthropic = renderAnthropicAgentTool(declaration);
      const equivalent = canonicalJson({ name: openAi.name, description: openAi.description, schema: openAi.parameters })
        === canonicalJson({ name: anthropic.name, description: anthropic.description, schema: anthropic.input_schema });
      return { toolId: declaration.toolId, version: declaration.version, providerName: declaration.providerName, semanticallyEquivalent: equivalent, strict: true };
    }),
  };
}
