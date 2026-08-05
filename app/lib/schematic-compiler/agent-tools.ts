import { schematicDigest, schematicId } from "./stable";
import type { SchematicChangeProposal, SchematicCompilationProblem, SchematicSemanticGraph } from "./types";

export const SCHEMATIC_PROPOSAL_TOOL = {
  name: "propose_schematic_semantic_changes",
  description: "Propose typed semantic schematic actions for human review. This tool cannot mutate a graph, emit CAD text, or use drawing coordinates as electrical authority.",
  schema: {
    type: "object", additionalProperties: false, required: ["proposalKind", "referencedSemanticObjectIds", "proposedActions", "assumptions", "warnings"],
    properties: {
      proposalKind: { enum: ["hierarchy", "connectivity", "terminal_disposition", "naming", "layout_intent", "review_questions"] },
      referencedSemanticObjectIds: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 512 },
      proposedActions: { type: "array", maxItems: 256, items: { type: "object", additionalProperties: false, required: ["actionKind", "targetObjectIds", "rationale"], properties: { actionKind: { enum: ["create_net", "connect_pin", "set_disposition", "rename_net", "create_sheet", "bind_port", "request_review"] }, targetObjectIds: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 32 }, rationale: { type: "string", minLength: 1, maxLength: 2000 } } } },
      assumptions: { type: "array", items: { type: "string", maxLength: 1000 }, maxItems: 64 }, warnings: { type: "array", items: { type: "string", maxLength: 1000 }, maxItems: 64 }
    }
  }
} as const;

export function normalizeSchematicChangeProposal(raw: Omit<SchematicChangeProposal, "proposalId" | "problemDigest" | "graphDigest" | "authority" | "deterministicDigest">, problem: SchematicCompilationProblem, graph: SchematicSemanticGraph): SchematicChangeProposal {
  const known = new Set([graph.graphId, ...graph.components.map((item) => item.componentInstanceId), ...graph.units.map((item) => item.unitInstanceId), ...graph.pins.map((item) => item.pinInstanceId), ...graph.nets.map((item) => item.netId), ...graph.sheetInstances.map((item) => item.sheetInstanceId), ...graph.portDefinitions.map((item) => item.portDefinitionId), ...graph.portBindings.map((item) => item.bindingId), ...graph.bundleDefinitions.map((item) => item.bundleId)]);
  const referenced = [...new Set(raw.referencedSemanticObjectIds)].sort(), targets = raw.proposedActions.flatMap((item) => item.targetObjectIds);
  if ([...referenced, ...targets].some((id) => !known.has(id)) || raw.proposedActions.some((item) => !item.rationale.trim())) throw new Error("CD8_AI_PROPOSAL_REFERENCE_INVALID");
  const base = { problemDigest: problem.deterministicDigest, graphDigest: graph.deterministicDigest, proposalKind: raw.proposalKind, referencedSemanticObjectIds: referenced, proposedActions: raw.proposedActions.map((item) => ({ ...item, targetObjectIds: [...new Set(item.targetObjectIds)].sort(), rationale: item.rationale.trim() })), assumptions: [...new Set(raw.assumptions)].sort(), warnings: [...new Set(raw.warnings)].sort(), authority: "proposal_only" as const };
  const withId = { ...base, proposalId: schematicId("schematic-change-proposal", base) };
  return { ...withId, deterministicDigest: schematicDigest(withId) };
}
