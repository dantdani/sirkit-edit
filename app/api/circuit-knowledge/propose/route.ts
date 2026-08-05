import { createProposedRecipeClaim, validateClaimPromotion, validateRecipeSourceBundle } from "@/app/lib/circuit-knowledge/source";
import type { CircuitKnowledgeProblem, RecipeSourceBundle } from "@/app/lib/circuit-knowledge/types";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import { llmRouter } from "@/app/lib/llm/router";
import { object, scopedJson } from "../_scope";
export const runtime = "nodejs";
const TOOL = "propose_circuit_recipe_claim";
const SCHEMA = { type: "object", additionalProperties: false, required: ["claimKind", "proposedValue", "conditions", "sourceEvidenceRefs", "sourceLocationRefs", "reviewerQueueIds"], properties: { claimKind: { type: "string", minLength: 1, maxLength: 120 }, proposedValue: { type: "object", additionalProperties: true }, conditions: { type: "array", maxItems: 64, items: { type: "string", maxLength: 500 } }, sourceEvidenceRefs: { type: "array", minItems: 1, maxItems: 64, items: { type: "string" } }, sourceLocationRefs: { type: "array", minItems: 1, maxItems: 64, items: { type: "string" } }, reviewerQueueIds: { type: "array", minItems: 1, maxItems: 16, items: { type: "string" } } } } as const;
export async function POST(request: Request): Promise<Response> {
  const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response; const { body, scope } = parsed;
  if (!object(body.problem) || !object(body.sourceBundle) || typeof body.userRequest !== "string" || !body.userRequest.trim()) return Response.json({ ok: false, error: "problem, sourceBundle, and userRequest are required" }, { status: 400 });
  const problem = body.problem as unknown as CircuitKnowledgeProblem; const sourceBundle = body.sourceBundle as unknown as RecipeSourceBundle;
  if (problem.projectId !== scope.projectId || problem.branchId !== scope.branchId) return Response.json({ ok: false, error: "circuit proposal scope mismatch" }, { status: 403 });
  const sourceErrors = validateRecipeSourceBundle(sourceBundle, { publicationScope: "private_review" }); if (sourceErrors.length) return Response.json({ ok: false, error: "source bundle integrity failed", diagnostics: sourceErrors }, { status: 422 });
  const provider = requestedProvider(body.provider);
  try {
    const result = await llmRouter.generate({ provider, maxTokens: 4096, temperature: 0, system: "You are a proposal-only circuit-knowledge extraction assistant. Use only the supplied pinned source evidence. Never assert authority, approve or publish a recipe, select a part/value/pin/net, claim verification, or add unstated conventional knowledge. Return one typed proposed claim for qualified human review.", messages: [{ role: "user", content: `Pinned CD-5 problem digest: ${problem.deterministicDigest}\nAllowed evidence IDs and exact locations:\n${JSON.stringify(sourceBundle.sourceLocations)}\nRequest:\n${body.userRequest.trim()}` }], tools: [{ name: TOOL, description: "Submit one untrusted, quarantined circuit-knowledge claim proposal.", inputSchema: SCHEMA as unknown as Record<string, unknown>, strict: true }], toolChoice: { name: TOOL }, designConstraints: problem, userRequest: body.userRequest.trim() });
    const call = result.toolCalls.find((item) => item.name === TOOL); if (!call) return Response.json({ ok: false, error: "provider returned no typed proposal" }, { status: 422 }); const value = call.input as { claimKind: string; proposedValue: unknown; conditions: string[]; sourceEvidenceRefs: string[]; sourceLocationRefs: string[]; reviewerQueueIds: string[] };
    const proposal = createProposedRecipeClaim({ sourceBundleId: sourceBundle.sourceBundleId, sourceEvidenceRefs: value.sourceEvidenceRefs, sourceLocationRefs: value.sourceLocationRefs, extractionActor: { actorId: scope.actorId, actorKind: "ai", sessionId: scope.sessionId, role: "automation" }, extractionMethod: "llm", confidence: "low", claimKind: value.claimKind, proposedValue: value.proposedValue, conditions: value.conditions, authorityAssessment: "unknown", reviewerQueueIds: value.reviewerQueueIds });
    const traceabilityErrors = validateClaimPromotion(proposal, proposal.extractionActor, sourceBundle); if (traceabilityErrors.length) return Response.json({ ok: false, error: "proposal references evidence outside the pinned source bundle", diagnostics: traceabilityErrors }, { status: 422 });
    return Response.json({ ok: true, proposal, authority: "proposal_only", publicationEligible: false }, { headers: { "X-Sirkit-AI-Provider": provider, "Cache-Control": "no-store" } });
  } catch (error) { return providerErrorResponse(error, provider); }
}
