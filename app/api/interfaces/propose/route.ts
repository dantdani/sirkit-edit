import type { SystemArchitectureCandidate } from "@/app/lib/architecture/types";
import { EMBEDDED_MIXED_SIGNAL_INTERFACE_PROFILE_V1 } from "@/app/lib/interfaces/capability";
import { compileInterfacePlanningCandidate } from "@/app/lib/interfaces/compiler";
import { createInterfacePlanningProposal, INTERFACE_PROPOSAL_JSON_SCHEMA, INTERFACE_PROPOSAL_SYSTEM_INSTRUCTIONS, INTERFACE_PROPOSAL_TOOL_NAME, type InterfacePlanningProposal } from "@/app/lib/interfaces/proposal-schema";
import { validateInterfacePlanningProblem } from "@/app/lib/interfaces/problem";
import type { InterfacePlanningProblem } from "@/app/lib/interfaces/types";
import type { PowerArchitectureCandidate } from "@/app/lib/power/types";
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
  if (!object(body) || !object(body.problem) || !object(body.architecture) || !object(body.power) || typeof body.userRequest !== "string" || !body.userRequest.trim()) return Response.json({ ok: false, error: "problem, architecture, power, and userRequest are required" }, { status: 400 });
  const projectId = context.projectId, branchId = context.branchId, actorId = context.actor.actorId; const problem = body.problem as unknown as InterfacePlanningProblem; const architecture = body.architecture as unknown as SystemArchitectureCandidate; const power = body.power as unknown as PowerArchitectureCandidate; if (problem.projectId !== projectId || problem.branchId !== branchId || architecture.projectId !== projectId || power.projectId !== projectId) return Response.json({ ok: false, error: "interface proposal scope mismatch" }, { status: 403 }); const errors = validateInterfacePlanningProblem(problem); if (errors.length) return Response.json({ ok: false, error: "interface problem integrity failed", diagnostics: errors }, { status: 422 });
  const provider = requestedProvider(body.provider); try { const response = await llmRouter.generate({ provider, maxTokens: 8_192, temperature: 0, system: INTERFACE_PROPOSAL_SYSTEM_INSTRUCTIONS, messages: [{ role: "user", content: `Pinned CD-4 problem:\n${JSON.stringify(problem)}\n\nPinned architecture flow summaries:\n${JSON.stringify(architecture.flows)}\n\nRequested exploration:\n${body.userRequest.trim()}` }], tools: [{ name: INTERFACE_PROPOSAL_TOOL_NAME, description: "Submit one abstract CD-4 protocol/topology/resource proposal.", inputSchema: INTERFACE_PROPOSAL_JSON_SCHEMA.schema as unknown as Record<string, unknown>, strict: true }], toolChoice: { name: INTERFACE_PROPOSAL_TOOL_NAME }, designConstraints: problem, userRequest: body.userRequest.trim() }); const call = response.toolCalls.find((item) => item.name === INTERFACE_PROPOSAL_TOOL_NAME); if (!call) return Response.json({ ok: false, error: "provider returned no typed interface proposal" }, { status: 422 }); const proposed = call.input as unknown as Omit<InterfacePlanningProposal, "deterministicDigest">; const proposal = createInterfacePlanningProposal({ proposalId: proposed.proposalId, problemDigest: proposed.problemDigest, title: proposed.title, summary: proposed.summary, choices: proposed.choices, assumptions: proposed.assumptions, questions: proposed.questions }); const result = compileInterfacePlanningCandidate({ problem, architecture, power, proposal, profile: EMBEDDED_MIXED_SIGNAL_INTERFACE_PROFILE_V1, actor: { actorId, actorKind: "ai", sessionId: context.actor.sessionId, role: "automation" }, createdAt: new Date().toISOString() }); return Response.json(result, { status: result.ok ? 200 : 422, headers: { "X-Sirkit-AI-Provider": provider, "Cache-Control": "no-store" } }); } catch (error) { return providerErrorResponse(error, provider); }
});
