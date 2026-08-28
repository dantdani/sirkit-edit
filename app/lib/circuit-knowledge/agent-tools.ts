/**
 * B16.0.19 §D — the SHARED authority for the circuit-knowledge proposal tool.
 * The tool name + strict schema were previously inlined in the propose route;
 * they now live beside their structural validator so the provider-declared
 * contract and the local validation cannot drift.
 *
 * [B16.0.19 §D security tightening] the three reference arrays' items were
 * previously UNBOUNDED strings; the schema now declares
 * `minLength: 1, maxLength: 300` on each — an intentional bound on
 * provider-declared output, mirrored automatically by the validator.
 */

export const CIRCUIT_RECIPE_CLAIM_TOOL = {
  name: "propose_circuit_recipe_claim",
  description: "Submit one untrusted, quarantined circuit-knowledge claim proposal.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["claimKind", "proposedValue", "conditions", "sourceEvidenceRefs", "sourceLocationRefs", "reviewerQueueIds"],
    properties: {
      claimKind: { type: "string", minLength: 1, maxLength: 120 },
      proposedValue: { type: "object", additionalProperties: true },
      conditions: { type: "array", maxItems: 64, items: { type: "string", maxLength: 500 } },
      sourceEvidenceRefs: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", minLength: 1, maxLength: 300 } },
      sourceLocationRefs: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", minLength: 1, maxLength: 300 } },
      reviewerQueueIds: { type: "array", minItems: 1, maxItems: 16, items: { type: "string", minLength: 1, maxLength: 300 } },
    },
  },
} as const;

/** A string-array node of the tool schema. */
interface StringArraySchemaNode { readonly items: { readonly minLength?: number; readonly maxLength?: number }; readonly maxItems: number; readonly minItems?: number }

/**
 * STRICT structural validation of raw provider tool output against the ONE
 * declared CIRCUIT_RECIPE_CLAIM_TOOL schema — required fields,
 * additionalProperties, min/max items and string bounds are READ FROM the
 * schema nodes at call time; no numeric limit is independently hard-coded.
 * Returns bounded diagnostics (no provider payload echo); empty = valid.
 */
export function validateCircuitRecipeClaimToolInput(value: unknown): string[] {
  const P = CIRCUIT_RECIPE_CLAIM_TOOL.schema.properties;
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["proposal: must be an object"];
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!(key in P)) errors.push(`proposal: unexpected key ${key.slice(0, 64)}`);
  const kind = P.claimKind;
  if (typeof raw.claimKind !== "string" || raw.claimKind.length < kind.minLength || raw.claimKind.length > kind.maxLength) errors.push(`claimKind: must be a string of ${kind.minLength}..${kind.maxLength} chars`);
  if (!raw.proposedValue || typeof raw.proposedValue !== "object" || Array.isArray(raw.proposedValue)) errors.push("proposedValue: must be an object");
  const stringArray = (name: string, v: unknown, node: StringArraySchemaNode): void => {
    const minLength = node.items.minLength ?? 0;
    const maxLength = node.items.maxLength ?? Number.POSITIVE_INFINITY;
    if (!Array.isArray(v)) { errors.push(`${name}: missing or not an array`); return; }
    if (v.length > node.maxItems) errors.push(`${name}: exceeds ${node.maxItems} items`);
    if (v.length < (node.minItems ?? 0)) errors.push(`${name}: requires at least ${node.minItems} items`);
    if (v.some((item) => typeof item !== "string" || item.length < minLength || item.length > maxLength)) errors.push(`${name}: items must be strings of ${minLength}..${maxLength} chars`);
  };
  stringArray("conditions", raw.conditions, P.conditions);
  stringArray("sourceEvidenceRefs", raw.sourceEvidenceRefs, P.sourceEvidenceRefs);
  stringArray("sourceLocationRefs", raw.sourceLocationRefs, P.sourceLocationRefs);
  stringArray("reviewerQueueIds", raw.reviewerQueueIds, P.reviewerQueueIds);
  return errors;
}
