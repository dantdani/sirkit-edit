/**
 * [B20 C1] The output-schema conformance gate of Sirkit's MCP server (OD-96, amending OD-56; D20-12). MCP revision
 * 2026-07-28, server/tools, "Output Schema": when a tool provides an output schema, servers MUST provide structured results
 * that conform to it.
 *
 *  - `mcpOutputSchemaEvaluable`: whether B05's deterministic output validator (`validateAgainstSchema`) can EVALUATE a
 *    schema, rather than falsely accept it or always refuse. That validator switches on ONE `type` string, never reads
 *    `const` or `anyOf`, and reads `required` with `in` and properties by key — so a name that is an `Object.prototype`
 *    member resolves through the prototype and is never really checked. An output schema it cannot evaluate is never
 *    declared to MCP: `tool-definitions.ts` omits it with a closed reason and the tool stays listed.
 *  - `gateStructuredContent`: what a served success carries. No declared schema: nothing (`omit`, and the value is never
 *    read). A declared schema: the value only when it passes the bounded safety walk (`assertSafeJsonValue` with B05's
 *    output limits, before anything else reads it) and then conforms (`include`); otherwise `refuse`, which the read
 *    pipeline answers with B05's own closed `invalid_output`.
 *
 * Pure: no I/O, clock or randomness; it imports the B05 validator and a type, nothing else. Nothing here throws.
 */
import { DEFAULT_OUTPUT_LIMITS, FORBIDDEN_KEYS, assertSafeJsonValue, validateAgainstSchema } from "../../engineering/tool-io-validation";
import type { JsonSchema } from "../../engineering/tool-registry";

export const MCP_STRUCTURED_CONTENT_VERDICTS = Object.freeze(["include", "omit", "refuse"] as const);
export type McpStructuredContentVerdict = (typeof MCP_STRUCTURED_CONTENT_VERDICTS)[number];
export type McpStructuredContentGate =
  | { readonly kind: "include"; readonly value: unknown }
  | { readonly kind: "omit" }
  | { readonly kind: "refuse" };

/** The walk's bounds: schema-node nesting, and schema nodes visited (occurrences — a shared subschema counts each time). */
export const MCP_EVALUABLE_SCHEMA_MAX_DEPTH = 64;
export const MCP_EVALUABLE_SCHEMA_MAX_NODES = 4_096;
/** The `type` values the validator switches on: a type array, "null" and anything else fall to its fail-closed default. */
const EVALUABLE_TYPES: readonly string[] = Object.freeze(["object", "array", "string", "number", "integer", "boolean"]);

const OMIT: McpStructuredContentGate = Object.freeze({ kind: "omit" });
const REFUSE: McpStructuredContentGate = Object.freeze({ kind: "refuse" });

function isPlainNode(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
/** A property or `required` name the validator reads by key: never a reserved key, never an `Object.prototype` member. */
const evaluableName = (name: unknown): boolean => typeof name === "string" && !FORBIDDEN_KEYS.has(name) && !Object.hasOwn(Object.prototype, name);

/**
 * Whether `validateAgainstSchema` evaluates `schema` exactly: every node is a plain object whose `type` is one of the six it
 * switches on, or which has no `type` and an `enum` array; no node carries `anyOf` or `const`; every `properties` key and
 * `required` entry is an evaluable name; `properties` is a plain object, `items` one plain node, `additionalProperties`
 * absent or a boolean. Bounded (depth 64, 4 096 nodes); a cycle on the ancestor path, a throwing getter or a hostile Proxy
 * is `false`. Never throws.
 */
export function mcpOutputSchemaEvaluable(schema: unknown): boolean {
  try {
    return evaluableNode(schema, 0, [], { nodes: 0 });
  } catch {
    return false;
  }
}

function evaluableNode(node: unknown, depth: number, ancestors: object[], budget: { nodes: number }): boolean {
  budget.nodes += 1;
  if (budget.nodes > MCP_EVALUABLE_SCHEMA_MAX_NODES || depth > MCP_EVALUABLE_SCHEMA_MAX_DEPTH) return false;
  if (!isPlainNode(node) || ancestors.includes(node)) return false;
  if (Object.hasOwn(node, "anyOf") || Object.hasOwn(node, "const")) return false;
  const type: unknown = Object.hasOwn(node, "type") ? node.type : undefined;
  if (type === undefined) return Array.isArray(node.enum);
  if (typeof type !== "string" || !EVALUABLE_TYPES.includes(type)) return false;
  if (Object.hasOwn(node, "enum") && !Array.isArray(node.enum)) return false;
  if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") return false;
  ancestors.push(node);
  try {
    if (type === "object") {
      if (Object.hasOwn(node, "properties")) {
        const properties = node.properties;
        if (!isPlainNode(properties)) return false;
        for (const name of Object.keys(properties)) {
          if (!evaluableName(name) || !evaluableNode(properties[name], depth + 1, ancestors, budget)) return false;
        }
      }
      if (Object.hasOwn(node, "required")) {
        const required = node.required;
        if (!Array.isArray(required) || !required.every(evaluableName)) return false;
      }
    }
    if (type === "array" && Object.hasOwn(node, "items") && !evaluableNode(node.items, depth + 1, ancestors, budget)) return false;
    return true;
  } finally {
    ancestors.pop();
  }
}

/**
 * The `structuredContent` a success carries under the listing's declared output schema (`null`: none is declared, and the
 * value is never read). In order: the bounded safety walk over the value (plain JSON only, within B05's output limits); the
 * schema's evaluability; the validator. What is checked is exactly what is returned, stored for replay and traced. Never
 * throws: anything hostile is `refuse`, which the caller answers with the closed `invalid_output`.
 */
export function gateStructuredContent(value: unknown, declared: JsonSchema | null): McpStructuredContentGate {
  if (declared === null) return OMIT;
  try {
    if (assertSafeJsonValue(value, DEFAULT_OUTPUT_LIMITS).length > 0) return REFUSE;
    if (!mcpOutputSchemaEvaluable(declared)) return REFUSE;
    if (validateAgainstSchema(value, declared as unknown as Record<string, unknown>).length > 0) return REFUSE;
    return Object.freeze({ kind: "include", value });
  } catch {
    return REFUSE;
  }
}
