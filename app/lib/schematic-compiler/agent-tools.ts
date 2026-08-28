import { schematicDigest, schematicId } from "./stable";
import type { SchematicChangeProposal, SchematicCompilationProblem, SchematicSemanticGraph } from "./types";

export const SCHEMATIC_PROPOSAL_TOOL = {
  name: "propose_schematic_semantic_changes",
  description: "Propose typed semantic schematic actions for human review. This tool cannot mutate a graph, emit CAD text, or use drawing coordinates as electrical authority.",
  schema: {
    type: "object", additionalProperties: false, required: ["proposalKind", "referencedSemanticObjectIds", "proposedActions", "assumptions", "warnings"],
    properties: {
      proposalKind: { enum: ["hierarchy", "connectivity", "terminal_disposition", "naming", "layout_intent", "review_questions"] },
      referencedSemanticObjectIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: 512 },
      proposedActions: { type: "array", maxItems: 256, items: { type: "object", additionalProperties: false, required: ["actionKind", "targetObjectIds", "rationale"], properties: { actionKind: { enum: ["create_net", "connect_pin", "set_disposition", "rename_net", "create_sheet", "bind_port", "request_review"] }, targetObjectIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: 32 }, rationale: { type: "string", minLength: 1, maxLength: 2000 } } } },
      assumptions: { type: "array", items: { type: "string", maxLength: 1000 }, maxItems: 64 }, warnings: { type: "array", items: { type: "string", maxLength: 1000 }, maxItems: 64 }
    }
  }
} as const;

/** A string-array node of the tool schema (`{ items: { minLength?, maxLength? }, maxItems }`). */
interface StringArraySchemaNode { readonly items: { readonly minLength?: number; readonly maxLength?: number }; readonly maxItems: number }
/** A string node of the tool schema (`{ minLength?, maxLength? }`). */
interface StringSchemaNode { readonly minLength?: number; readonly maxLength?: number }

/**
 * [B16.0.17.1 §C / B16.0.17.2 §B] STRICT structural validation of raw provider
 * tool output against the ONE declared SCHEMATIC_PROPOSAL_TOOL schema. EVERY
 * constraint — allowed kinds, required fields, additionalProperties behavior,
 * array item caps, and string minimum/maximum lengths — is READ FROM the
 * schema nodes at call time; no numeric limit is independently hard-coded, so
 * the provider-declared contract and this validator cannot drift. Runs BEFORE
 * `normalizeSchematicChangeProposal`, so malformed provider output yields a
 * deterministic bounded refusal instead of an incidental TypeError. Returns
 * bounded diagnostics (no provider payload echo); empty array = valid.
 */
export function validateSchematicProposalToolInput(value: unknown): string[] {
  const P = SCHEMATIC_PROPOSAL_TOOL.schema.properties;
  const ACTION = P.proposedActions.items.properties;
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["proposal: must be an object"];
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!(key in P)) errors.push(`proposal: unexpected key ${key.slice(0, 64)}`);
  if (!(P.proposalKind.enum as readonly string[]).includes(raw.proposalKind as string)) errors.push("proposalKind: missing or not a declared kind");
  const stringArray = (name: string, v: unknown, node: StringArraySchemaNode): void => {
    const minLength = node.items.minLength ?? 0;
    const maxLength = node.items.maxLength ?? Number.POSITIVE_INFINITY;
    if (!Array.isArray(v)) { errors.push(`${name}: missing or not an array`); return; }
    if (v.length > node.maxItems) errors.push(`${name}: exceeds ${node.maxItems} items`);
    if (v.some((item) => typeof item !== "string" || item.length < minLength || item.length > maxLength)) errors.push(`${name}: items must be strings of ${minLength}..${maxLength} chars`);
  };
  const boundedString = (name: string, v: unknown, node: StringSchemaNode): void => {
    const minLength = node.minLength ?? 0;
    const maxLength = node.maxLength ?? Number.POSITIVE_INFINITY;
    if (typeof v !== "string" || v.length < minLength || v.length > maxLength) errors.push(`${name}: must be a string of ${minLength}..${maxLength} chars`);
  };
  stringArray("referencedSemanticObjectIds", raw.referencedSemanticObjectIds, P.referencedSemanticObjectIds);
  stringArray("assumptions", raw.assumptions, P.assumptions);
  stringArray("warnings", raw.warnings, P.warnings);
  if (!Array.isArray(raw.proposedActions)) errors.push("proposedActions: missing or not an array");
  else {
    if (raw.proposedActions.length > P.proposedActions.maxItems) errors.push(`proposedActions: exceeds ${P.proposedActions.maxItems} items`);
    raw.proposedActions.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) { errors.push(`proposedActions[${index}]: must be an object`); return; }
      const action = item as Record<string, unknown>;
      for (const key of Object.keys(action)) if (!(key in ACTION)) errors.push(`proposedActions[${index}]: unexpected key ${key.slice(0, 64)}`);
      if (!(ACTION.actionKind.enum as readonly string[]).includes(action.actionKind as string)) errors.push(`proposedActions[${index}].actionKind: missing or not a declared kind`);
      stringArray(`proposedActions[${index}].targetObjectIds`, action.targetObjectIds, ACTION.targetObjectIds);
      boundedString(`proposedActions[${index}].rationale`, action.rationale, ACTION.rationale);
    });
  }
  return errors;
}

export function normalizeSchematicChangeProposal(raw: Omit<SchematicChangeProposal, "proposalId" | "problemDigest" | "graphDigest" | "authority" | "deterministicDigest">, problem: SchematicCompilationProblem, graph: SchematicSemanticGraph): SchematicChangeProposal {
  const known = new Set([graph.graphId, ...graph.components.map((item) => item.componentInstanceId), ...graph.units.map((item) => item.unitInstanceId), ...graph.pins.map((item) => item.pinInstanceId), ...graph.nets.map((item) => item.netId), ...graph.sheetInstances.map((item) => item.sheetInstanceId), ...graph.portDefinitions.map((item) => item.portDefinitionId), ...graph.portBindings.map((item) => item.bindingId), ...graph.bundleDefinitions.map((item) => item.bundleId)]);
  const referenced = [...new Set(raw.referencedSemanticObjectIds)].sort(), targets = raw.proposedActions.flatMap((item) => item.targetObjectIds);
  if ([...referenced, ...targets].some((id) => !known.has(id)) || raw.proposedActions.some((item) => !item.rationale.trim())) throw new Error("CD8_AI_PROPOSAL_REFERENCE_INVALID");
  const base = { problemDigest: problem.deterministicDigest, graphDigest: graph.deterministicDigest, proposalKind: raw.proposalKind, referencedSemanticObjectIds: referenced, proposedActions: raw.proposedActions.map((item) => ({ ...item, targetObjectIds: [...new Set(item.targetObjectIds)].sort(), rationale: item.rationale.trim() })), assumptions: [...new Set(raw.assumptions)].sort(), warnings: [...new Set(raw.warnings)].sort(), authority: "proposal_only" as const };
  const withId = { ...base, proposalId: schematicId("schematic-change-proposal", base) };
  return { ...withId, deterministicDigest: schematicDigest(withId) };
}
