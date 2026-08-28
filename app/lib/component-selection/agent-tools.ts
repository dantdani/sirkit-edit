import { selectionDigest, selectionId } from "./stable";
import type { ComponentSelectionProblem, EngineeringCatalogSnapshot } from "./types";

export interface CatalogSearchProposal {
  proposalId: string;
  problemDigest: string;
  roleRequirementId: string;
  categories: string[];
  exactAtomicRevisionIds: string[];
  manufacturerIds: string[];
  rationale: string[];
  missingEvidenceRequests: string[];
  authority: "proposal_only";
  deterministicDigest: string;
}

export const COMPONENT_SEARCH_PROPOSAL_TOOL = {
  name: "propose_component_catalog_search",
  description: "Propose bounded filters for a pinned exact-part catalog query. This does not evaluate, select, rank, or approve a part.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["roleRequirementId", "categories", "exactAtomicRevisionIds", "manufacturerIds", "rationale", "missingEvidenceRequests"],
    properties: {
      roleRequirementId: { type: "string", minLength: 1, maxLength: 300 },
      categories: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 120 } },
      exactAtomicRevisionIds: { type: "array", maxItems: 128, items: { type: "string", minLength: 1, maxLength: 300 } },
      manufacturerIds: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 300 } },
      rationale: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 500 } },
      missingEvidenceRequests: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 500 } },
    },
  },
} as const;

/** A string-array node of the tool schema. */
interface StringArraySchemaNode { readonly items: { readonly minLength?: number; readonly maxLength?: number }; readonly maxItems: number }

/**
 * [B16.0.18 §E] STRICT structural validation of raw provider tool output
 * against the ONE declared COMPONENT_SEARCH_PROPOSAL_TOOL schema — required
 * fields, additionalProperties behavior, array item caps and string min/max
 * lengths are all READ FROM the schema nodes at call time (the B16.0.17.2
 * lesson applied up front: no numeric limit is independently hard-coded, so
 * the provider-declared contract and this validator cannot drift). Runs BEFORE
 * `createCatalogSearchProposal`, so malformed provider output yields a
 * deterministic bounded refusal instead of an incidental TypeError. Returns
 * bounded diagnostics (no provider payload echo); empty array = valid.
 */
export function validateComponentSearchProposalToolInput(value: unknown): string[] {
  const P = COMPONENT_SEARCH_PROPOSAL_TOOL.schema.properties;
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["proposal: must be an object"];
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!(key in P)) errors.push(`proposal: unexpected key ${key.slice(0, 64)}`);
  const boundedString = (name: string, v: unknown, node: { readonly minLength?: number; readonly maxLength?: number }): void => {
    const minLength = node.minLength ?? 0;
    const maxLength = node.maxLength ?? Number.POSITIVE_INFINITY;
    if (typeof v !== "string" || v.length < minLength || v.length > maxLength) errors.push(`${name}: must be a string of ${minLength}..${maxLength} chars`);
  };
  const stringArray = (name: string, v: unknown, node: StringArraySchemaNode): void => {
    const minLength = node.items.minLength ?? 0;
    const maxLength = node.items.maxLength ?? Number.POSITIVE_INFINITY;
    if (!Array.isArray(v)) { errors.push(`${name}: missing or not an array`); return; }
    if (v.length > node.maxItems) errors.push(`${name}: exceeds ${node.maxItems} items`);
    if (v.some((item) => typeof item !== "string" || item.length < minLength || item.length > maxLength)) errors.push(`${name}: items must be strings of ${minLength}..${maxLength} chars`);
  };
  boundedString("roleRequirementId", raw.roleRequirementId, P.roleRequirementId);
  stringArray("categories", raw.categories, P.categories);
  stringArray("exactAtomicRevisionIds", raw.exactAtomicRevisionIds, P.exactAtomicRevisionIds);
  stringArray("manufacturerIds", raw.manufacturerIds, P.manufacturerIds);
  stringArray("rationale", raw.rationale, P.rationale);
  stringArray("missingEvidenceRequests", raw.missingEvidenceRequests, P.missingEvidenceRequests);
  return errors;
}

export function createCatalogSearchProposal(input: Omit<CatalogSearchProposal, "proposalId" | "problemDigest" | "authority" | "deterministicDigest">, problem: ComponentSelectionProblem, catalog: EngineeringCatalogSnapshot): CatalogSearchProposal {
  if (!problem.componentRoleRequirements.some((item) => item.roleRequirementId === input.roleRequirementId)) throw new Error("CD6_AGENT_ROLE_OUT_OF_SCOPE");
  if (input.exactAtomicRevisionIds.some((id) => !catalog.atomicPartRevisionIds.includes(id))) throw new Error("CD6_AGENT_ATOMIC_REVISION_OUT_OF_SNAPSHOT");
  if (input.categories.length > 16 || input.exactAtomicRevisionIds.length > 128 || input.manufacturerIds.length > 64 || input.rationale.length > 32 || input.missingEvidenceRequests.length > 32) throw new Error("CD6_AGENT_PROPOSAL_LIMIT_EXCEEDED");
  const base = { ...structuredClone(input), categories: [...new Set(input.categories)].sort(), exactAtomicRevisionIds: [...new Set(input.exactAtomicRevisionIds)].sort(), manufacturerIds: [...new Set(input.manufacturerIds)].sort(), problemDigest: problem.deterministicDigest, authority: "proposal_only" as const };
  const withId = { ...base, proposalId: selectionId("catalog-search-proposal", base) };
  return { ...withId, deterministicDigest: selectionDigest(withId) };
}
