import { compileArchitectureCandidate } from "@/app/lib/architecture/compiler";
import { ARCHITECTURE_PROPOSAL_JSON_SCHEMA, ARCHITECTURE_PROPOSAL_SYSTEM_INSTRUCTIONS } from "@/app/lib/architecture/proposal-schema";
import { validateArchitectureProblem } from "@/app/lib/architecture/problem";
import type { ArchitectureCandidateProposal, ArchitectureProblem } from "@/app/lib/architecture/types";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import { llmRouter } from "@/app/lib/llm/router";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 4_000_000;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "architecture proposal body is too large" }, { status: 413 });
  let body: unknown; try { body = JSON.parse(raw); } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  if (!object(body) || !object(body.problem) || typeof body.userRequest !== "string" || !body.userRequest.trim()) return Response.json({ ok: false, error: "problem and userRequest are required" }, { status: 400 });
  const projectId = request.headers.get("x-sirkit-project-id"); const branchId = request.headers.get("x-sirkit-branch-id"); const actorId = request.headers.get("x-sirkit-actor-id");
  if (!projectId || !branchId || !actorId) return Response.json({ ok: false, error: "project, branch, and actor scope headers are required" }, { status: 401 });
  const problem = body.problem as unknown as ArchitectureProblem;
  if (problem.projectId !== projectId || problem.branchId !== branchId) return Response.json({ ok: false, error: "architecture proposal scope mismatch" }, { status: 403 });
  const problemErrors = validateArchitectureProblem(problem); if (problemErrors.length) return Response.json({ ok: false, error: "architecture problem integrity failed", diagnostics: problemErrors }, { status: 422 });
  const provider = requestedProvider(body.provider);
  try {
    const response = await llmRouter.generate({ provider, maxTokens: 8_192, temperature: 0, system: ARCHITECTURE_PROPOSAL_SYSTEM_INSTRUCTIONS, messages: [{ role: "user", content: `Architecture problem:\n${JSON.stringify(problem)}\n\nRequested exploration:\n${body.userRequest.trim()}` }], tools: [{ name: ARCHITECTURE_PROPOSAL_JSON_SCHEMA.name, description: "Submit one abstract functional architecture candidate. Detailed circuit implementation is forbidden.", inputSchema: ARCHITECTURE_PROPOSAL_JSON_SCHEMA.schema as unknown as Record<string, unknown>, strict: true }], toolChoice: { name: ARCHITECTURE_PROPOSAL_JSON_SCHEMA.name }, designConstraints: problem, userRequest: body.userRequest.trim() });
    const call = response.toolCalls.find((item) => item.name === ARCHITECTURE_PROPOSAL_JSON_SCHEMA.name); if (!call) return Response.json({ ok: false, error: "provider returned no typed architecture proposal" }, { status: 422 });
    const result = compileArchitectureCandidate({ problem, proposal: call.input as unknown as ArchitectureCandidateProposal, actor: { actorId, actorKind: "ai", sessionId: request.headers.get("x-sirkit-session-id") ?? "architecture-proposal", role: "automation" }, createdAt: new Date().toISOString(), provider: response.provider, model: response.model });
    return Response.json(result, { status: result.ok ? 200 : 422, headers: { "X-Sirkit-AI-Provider": provider, "Cache-Control": "no-store" } });
  } catch (error) { return providerErrorResponse(error, provider); }
}
