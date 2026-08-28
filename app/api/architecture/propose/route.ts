import { compileArchitectureCandidate } from "@/app/lib/architecture/compiler";
import { ARCHITECTURE_PROPOSAL_JSON_SCHEMA, ARCHITECTURE_PROPOSAL_SYSTEM_INSTRUCTIONS } from "@/app/lib/architecture/proposal-schema";
import { validateArchitectureProblem } from "@/app/lib/architecture/problem";
import type { ArchitectureCandidateProposal, ArchitectureProblem } from "@/app/lib/architecture/types";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import { llmRouter } from "@/app/lib/llm/router";

import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const body: unknown = rawBody;
  if (!object(body) || !object(body.problem) || typeof body.userRequest !== "string" || !body.userRequest.trim()) return Response.json({ ok: false, error: "problem and userRequest are required" }, { status: 400 });
  const projectId = context.projectId; const branchId = context.branchId; const actorId = context.actor.actorId;
  const problem = body.problem as unknown as ArchitectureProblem;
  if (problem.projectId !== projectId || problem.branchId !== branchId) return Response.json({ ok: false, error: "architecture proposal scope mismatch" }, { status: 403 });
  const problemErrors = validateArchitectureProblem(problem); if (problemErrors.length) return Response.json({ ok: false, error: "architecture problem integrity failed", diagnostics: problemErrors }, { status: 422 });
  const provider = requestedProvider(body.provider);
  try {
    const response = await llmRouter.generate({ provider, maxTokens: 8_192, temperature: 0, system: ARCHITECTURE_PROPOSAL_SYSTEM_INSTRUCTIONS, messages: [{ role: "user", content: `Architecture problem:\n${JSON.stringify(problem)}\n\nRequested exploration:\n${body.userRequest.trim()}` }], tools: [{ name: ARCHITECTURE_PROPOSAL_JSON_SCHEMA.name, description: "Submit one abstract functional architecture candidate. Detailed circuit implementation is forbidden.", inputSchema: ARCHITECTURE_PROPOSAL_JSON_SCHEMA.schema as unknown as Record<string, unknown>, strict: true }], toolChoice: { name: ARCHITECTURE_PROPOSAL_JSON_SCHEMA.name }, designConstraints: problem, userRequest: body.userRequest.trim() });
    const call = response.toolCalls.find((item) => item.name === ARCHITECTURE_PROPOSAL_JSON_SCHEMA.name); if (!call) return Response.json({ ok: false, error: "provider returned no typed architecture proposal" }, { status: 422 });
    const result = compileArchitectureCandidate({ problem, proposal: call.input as unknown as ArchitectureCandidateProposal, actor: { actorId, actorKind: "ai", sessionId: context.actor.sessionId, role: "automation" }, createdAt: new Date().toISOString(), provider: response.provider, model: response.model });
    return Response.json(result, { status: result.ok ? 200 : 422, headers: { "X-Sirkit-AI-Provider": provider, "Cache-Control": "no-store" } });
  } catch (error) { return providerErrorResponse(error, provider); }
});
