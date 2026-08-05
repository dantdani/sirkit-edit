import { defaultCircuitVerificationCapabilityProfile } from "@/app/lib/circuit-verification/capability";
import { evaluateCircuitReadiness } from "@/app/lib/circuit-verification/readiness";
import type { CircuitVerificationProblem, CircuitWaiver, FullOracleRun, OracleParityReport, RequiredRuleDenominator, RequirementCoverageRecord, RuleRegistrySnapshot } from "@/app/lib/circuit-verification/types";
import { object, scopedJson } from "../_scope";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response;
  const { body, scope } = parsed;
  if (!object(body.problem) || !object(body.registry) || !object(body.denominator) || typeof body.graphDigest !== "string") return Response.json({ ok: false, error: "problem, graph digest, registry, and explicit denominator are required" }, { status: 400 });
  const problem = body.problem as unknown as CircuitVerificationProblem;
  if (problem.projectId !== scope.projectId || problem.branchId !== scope.branchId) return Response.json({ ok: false, error: "readiness scope mismatch" }, { status: 403 });
  const report = evaluateCircuitReadiness({ problem, graphDigest: body.graphDigest, registry: body.registry as unknown as RuleRegistrySnapshot, capabilityProfile: defaultCircuitVerificationCapabilityProfile(), denominator: body.denominator as unknown as RequiredRuleDenominator, fullRun: object(body.fullRun) ? body.fullRun as unknown as FullOracleRun : undefined, parity: object(body.parity) ? body.parity as unknown as OracleParityReport : undefined, waivers: Array.isArray(body.waivers) ? body.waivers as CircuitWaiver[] : [], requirementCoverage: Array.isArray(body.requirementCoverage) ? body.requirementCoverage as RequirementCoverageRecord[] : [], now: new Date().toISOString() });
  return Response.json({ ok: true, report }, { headers: { "Cache-Control": "no-store" } });
}
