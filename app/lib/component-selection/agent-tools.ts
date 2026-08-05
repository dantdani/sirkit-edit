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

export function createCatalogSearchProposal(input: Omit<CatalogSearchProposal, "proposalId" | "problemDigest" | "authority" | "deterministicDigest">, problem: ComponentSelectionProblem, catalog: EngineeringCatalogSnapshot): CatalogSearchProposal {
  if (!problem.componentRoleRequirements.some((item) => item.roleRequirementId === input.roleRequirementId)) throw new Error("CD6_AGENT_ROLE_OUT_OF_SCOPE");
  if (input.exactAtomicRevisionIds.some((id) => !catalog.atomicPartRevisionIds.includes(id))) throw new Error("CD6_AGENT_ATOMIC_REVISION_OUT_OF_SNAPSHOT");
  if (input.categories.length > 16 || input.exactAtomicRevisionIds.length > 128 || input.manufacturerIds.length > 64 || input.rationale.length > 32 || input.missingEvidenceRequests.length > 32) throw new Error("CD6_AGENT_PROPOSAL_LIMIT_EXCEEDED");
  const base = { ...structuredClone(input), categories: [...new Set(input.categories)].sort(), exactAtomicRevisionIds: [...new Set(input.exactAtomicRevisionIds)].sort(), manufacturerIds: [...new Set(input.manufacturerIds)].sort(), problemDigest: problem.deterministicDigest, authority: "proposal_only" as const };
  const withId = { ...base, proposalId: selectionId("catalog-search-proposal", base) };
  return { ...withId, deterministicDigest: selectionDigest(withId) };
}
