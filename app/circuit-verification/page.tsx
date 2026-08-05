"use client";
import { useEffect, useState } from "react";
import { CircuitVerificationWorkspace } from "@/app/components/circuit-verification/CircuitVerificationWorkspace";
import { createCd9UpstreamCompletionSignoff, defaultCircuitVerificationCapabilityProfile } from "@/app/lib/circuit-verification/capability";
import { compileRequirementCoverage } from "@/app/lib/circuit-verification/coverage";
import { appendCircuitVerificationArtifact, createCircuitVerificationProjectState } from "@/app/lib/circuit-verification/project";
import { createFoundationalRuleRegistry } from "@/app/lib/circuit-verification/registry";
import { verificationDigest } from "@/app/lib/circuit-verification/stable";
import type { CircuitReadinessReport, CircuitVerificationProblem, FullOracleRun, RequiredRuleDenominator, VerificationContext } from "@/app/lib/circuit-verification/types";
import type { SavedProject } from "@/lib/persistence";
import { loadProject, saveProjectCircuitVerificationProgram } from "@/lib/persistence";

const actor = { actorId: "local-project-owner", actorKind: "human" as const, sessionId: "circuit-verification-workspace", role: "project_admin" as const };
function headers(projectId: string, branchId: string) { return { "content-type": "application/json", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": branchId, "x-sirkit-actor-id": actor.actorId, "x-sirkit-role": actor.role }; }

export default function CircuitVerificationPage() {
  const [project, setProject] = useState<SavedProject | null | undefined>(undefined), [working, setWorking] = useState(false), [error, setError] = useState("");
  useEffect(() => { queueMicrotask(() => { const id = new URLSearchParams(window.location.search).get("project"); setProject(id ? loadProject(id) : null); }); }, []);
  const cd8 = project?.schematicCompilationProgram, candidate = cd8?.decision?.state === "approved" ? cd8.candidates.find((item) => item.candidateId === cd8.decision?.candidateId && item.approvalState === "approved" && item.lifecycleState === "approved_for_CD9") : undefined;
  const graph = candidate ? cd8?.graphs.find((item) => item.graphId === candidate.semanticGraphRevisionId && item.deterministicDigest === candidate.semanticGraphDigest) : undefined, certificate = candidate ? cd8?.roundTripCertificates.find((item) => item.certificateId === candidate.roundTripCertificateId && item.certificateState === "semantically_equivalent") : undefined;

  async function activate() {
    if (!project?.requirements || !cd8 || !candidate || !graph || !certificate || !cd8.decision) return;
    if (!window.confirm("Approve the foundational CD-9 deterministic rule registry and run the complete oracle against this exact CD-8 graph? This does not modify the schematic or PCB.")) return;
    setWorking(true); setError("");
    try {
      const now = new Date().toISOString(), registry = createFoundationalRuleRegistry({ reviewer: actor, reviewedAt: now }), s = cd8.upstreamSignoff;
      const stageDigests = [
        { stage: "CD-1" as const, stateDigest: s.requirementsDigest, decisionDigest: s.requirementsDigest },
        { stage: "CD-2" as const, stateDigest: s.architectureCandidateDigest, decisionDigest: s.architectureDecisionDigest },
        { stage: "CD-3" as const, stateDigest: s.powerCandidateDigest, decisionDigest: s.powerDecisionDigest },
        { stage: "CD-4" as const, stateDigest: s.interfaceCandidateDigest, decisionDigest: s.interfaceDecisionDigest },
        { stage: "CD-5" as const, stateDigest: s.circuitKnowledgeStateDigest, decisionDigest: s.circuitKnowledgeDecisionDigest },
        { stage: "CD-6" as const, stateDigest: s.componentSelectionStateDigest, decisionDigest: s.componentSelectionDecisionDigest },
        { stage: "CD-7" as const, stateDigest: s.calculationStateDigest, decisionDigest: s.calculationDecisionDigest },
        { stage: "CD-8" as const, stateDigest: cd8.deterministicDigest, decisionDigest: cd8.decision.deterministicDigest },
      ];
      const upstreamSignoff = createCd9UpstreamCompletionSignoff({ cd1Verdict: "CD-1 COMPLETE", cd2Verdict: "CD-2 COMPLETE", cd3Verdict: "CD-3 COMPLETE", cd4Verdict: "CD-4 COMPLETE", cd5Verdict: "CD-5 COMPLETE", cd6Verdict: "CD-6 COMPLETE", cd7Verdict: "CD-7 COMPLETE", cd8Verdict: "CD-8 COMPLETE", stageDigests, approvedSchematicCandidateId: candidate.candidateId, approvedSchematicCandidateDigest: candidate.deterministicDigest, semanticGraphDigest: graph.deterministicDigest, roundTripCertificateDigest: certificate.deterministicDigest, approver: actor, approvedAt: now });
      const requirementRevisionRefs = project.requirements.requirements.filter((item) => item.status === "confirmed").map((item) => ({ requirementId: item.requirementId, revisionDigest: verificationDigest({ package: project.requirements!.deterministicDigest, id: item.requirementId, revision: item.revision }), safetyCritical: item.criticality === "safety_critical" }));
      const problemResponse = await fetch("/api/circuit-verification/problem", { method: "POST", headers: headers(project.id, cd8.branchId), body: JSON.stringify({ schematicProject: cd8, upstreamSignoff, registry, requirementRevisionRefs, requiredContextKinds: ["static_unpowered", "static_powered"] }) });
      const problemResult = await problemResponse.json() as { ok: boolean; problem?: CircuitVerificationProblem; diagnostics?: Array<{ message: string }>; error?: string };
      if (!problemResponse.ok || !problemResult.ok || !problemResult.problem) throw new Error(problemResult.diagnostics?.map((item) => item.message).join("; ") || problemResult.error || "CD-9 problem compilation failed");
      const requirementCoverage = compileRequirementCoverage({ problem: problemResult.problem });
      const runResponse = await fetch("/api/circuit-verification/run", { method: "POST", headers: headers(project.id, cd8.branchId), body: JSON.stringify({ problem: problemResult.problem, graph, registry, requirementCoverage }) });
      const runResult = await runResponse.json() as { ok: boolean; contexts?: VerificationContext[]; denominator?: RequiredRuleDenominator; run?: FullOracleRun; error?: string };
      if (!runResponse.ok || !runResult.ok || !runResult.contexts || !runResult.denominator || !runResult.run) throw new Error(runResult.error || "Full circuit oracle failed");
      const readinessResponse = await fetch("/api/circuit-verification/readiness", { method: "POST", headers: headers(project.id, cd8.branchId), body: JSON.stringify({ problem: problemResult.problem, graphDigest: graph.deterministicDigest, registry, denominator: runResult.denominator, fullRun: runResult.run, requirementCoverage }) });
      const readinessResult = await readinessResponse.json() as { ok: boolean; report?: CircuitReadinessReport; error?: string };
      if (!readinessResponse.ok || !readinessResult.ok || !readinessResult.report) throw new Error(readinessResult.error || "Readiness aggregation failed");
      let state = createCircuitVerificationProjectState({ projectId: project.id, branchId: cd8.branchId, problem: problemResult.problem, capabilityProfile: defaultCircuitVerificationCapabilityProfile(), registry });
      state = appendCircuitVerificationArtifact({ state, operation: "set_contexts", artifact: runResult.contexts, actor, createdAt: now });
      state = appendCircuitVerificationArtifact({ state, operation: "add_denominator", artifact: runResult.denominator, actor, createdAt: now });
      state = appendCircuitVerificationArtifact({ state, operation: "set_requirement_coverage", artifact: requirementCoverage, actor, createdAt: now });
      state = appendCircuitVerificationArtifact({ state, operation: "add_full_run", artifact: runResult.run, actor, createdAt: now });
      state = appendCircuitVerificationArtifact({ state, operation: "add_readiness", artifact: readinessResult.report, actor, createdAt: now });
      if (!saveProjectCircuitVerificationProgram(project.id, state)) throw new Error("CD-9 persistence integrity check failed");
      setProject(loadProject(project.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setWorking(false); }
  }
  if (project === undefined) return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-500">Loading circuit verification…</main>;
  if (!project) return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-300"><h1 className="text-xl text-zinc-100">Sirkit Circuit Verification</h1><p className="mt-3 text-sm text-zinc-500">Open <code>/circuit-verification?project=&lt;project-id&gt;</code>.</p></main>;
  if (project.circuitVerificationProgram) return <CircuitVerificationWorkspace value={project.circuitVerificationProgram}/>;
  return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-300"><div className="max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-6"><p className="text-xs uppercase tracking-[0.2em] text-cyan-400">Conceptual design · CD-09</p><h1 className="mt-2 text-2xl text-zinc-100">Circuit ERC, Application Rules & Safety Verification</h1><p className="mt-3 text-sm leading-6 text-zinc-400">CD-9 verifies the approved CD-8 semantic graph using an explicit rule/context/target denominator and an independent full oracle. It does not use drawing coordinates or AI assertions as electrical truth.</p>{candidate && graph && certificate ? <button type="button" disabled={working} onClick={activate} className="mt-5 rounded border border-cyan-800 bg-cyan-950/30 px-3 py-2 text-sm text-cyan-300 disabled:opacity-40">{working ? "Compiling denominator and running full oracle…" : "Approve registry and run full verification"}</button> : <div className="mt-5 rounded border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-300"><p>BLOCKED BY CD-8</p><p className="mt-1 text-xs text-amber-400/80">One current human-approved CD-8 candidate, valid semantic graph, complete synchronization contract, and independently certified semantically equivalent KiCad round trip are required. The current CD-8 profile has no certified production KiCad adapter.</p></div>}{error && <p className="mt-4 rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}</div></main>;
}
