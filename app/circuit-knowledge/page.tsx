"use client";

import { useEffect, useState } from "react";
import { CircuitKnowledgeWorkspace } from "@/app/components/circuit-knowledge/CircuitKnowledgeWorkspace";
import { createCd5PcbFoundationSignoff, createCd5UpstreamCompletionSignoff, CURRENT_PCB_FOUNDATION_REVISIONS, EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 } from "@/app/lib/circuit-knowledge/capability";
import { createCircuitRecipeLibrary } from "@/app/lib/circuit-knowledge/library";
import { createCircuitKnowledgeProjectState } from "@/app/lib/circuit-knowledge/project";
import { circuitDigest } from "@/app/lib/circuit-knowledge/stable";
import type { CircuitKnowledgeProblem, CircuitKnowledgeProblemInput } from "@/app/lib/circuit-knowledge/types";
import type { SavedProject } from "@/lib/persistence";
import { loadProject, saveProjectCircuitKnowledge } from "@/lib/persistence";

const actor = { actorId: "local-project-owner", actorKind: "human" as const, sessionId: "circuit-knowledge-workspace", role: "project_admin" as const };
function headers(projectId: string, branchId: string) { return { "content-type": "application/json", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": branchId, "x-sirkit-actor-id": actor.actorId, "x-sirkit-role": actor.role }; }

export default function CircuitKnowledgePage() {
  const [project, setProject] = useState<SavedProject | null | undefined>(undefined); const [working, setWorking] = useState(false); const [error, setError] = useState("");
  useEffect(() => { queueMicrotask(() => { const id = new URLSearchParams(window.location.search).get("project"); setProject(id ? loadProject(id) : null); }); }, []);
  async function activate() {
    if (!project?.requirements || !project.architecture?.selection || !project.power?.selection || !project.interfacePlanning?.selection) return;
    const architecture = project.architecture.candidates.find((item) => item.candidateId === project.architecture!.selection!.candidateId && item.deterministicDigest === project.architecture!.selection!.candidateDigest);
    const power = project.power.candidates.find((item) => item.candidateId === project.power!.selection!.candidateId && item.deterministicDigest === project.power!.selection!.candidateDigest);
    const interfaces = project.interfacePlanning.candidates.find((item) => item.candidateId === project.interfacePlanning!.selection!.candidateId && item.deterministicDigest === project.interfacePlanning!.selection!.candidateDigest);
    if (!architecture || !power || !interfaces) return;
    if (!window.confirm("Confirm CD-1 through CD-4 and the installed PCB Stage 1-6, 9, and 10 foundations are complete at their declared resolution and pin their exact revisions for CD-5? The gate will reject incomplete evidence. This does not change the schematic or PCB.")) return;
    setWorking(true); setError("");
    try {
      const now = new Date().toISOString(); const signoff = createCd5UpstreamCompletionSignoff({ cd1Verdict: "CD-1 COMPLETE", cd2Verdict: "CD-2 COMPLETE", cd3Verdict: "CD-3 COMPLETE", cd4Verdict: "CD-4 COMPLETE", requirementsDigest: project.requirements.deterministicDigest, architectureCandidateDigest: architecture.deterministicDigest, architectureDecisionDigest: project.architecture.selection.deterministicDigest, powerCandidateDigest: power.deterministicDigest, powerDecisionDigest: project.power.selection.deterministicDigest, interfaceCandidateDigest: interfaces.deterministicDigest, interfaceDecisionDigest: project.interfacePlanning.selection.deterministicDigest, approver: actor, approvedAt: now });
      const pcbFoundationSignoff = createCd5PcbFoundationSignoff({ pcbStage1Verdict: "PCB STAGE 1 COMPLETE", pcbStage2Verdict: "PCB STAGE 2 COMPLETE", pcbStage3Verdict: "PCB STAGE 3 COMPLETE", pcbStage4Verdict: "PCB STAGE 4 COMPLETE", pcbStage5Verdict: "PCB STAGE 5 COMPLETE", pcbStage6Verdict: "PCB STAGE 6 COMPLETE", pcbStage9Verdict: "PCB STAGE 9 COMPLETE", pcbStage10Verdict: "PCB STAGE 10 COMPLETE", ...CURRENT_PCB_FOUNDATION_REVISIONS, approver: actor, approvedAt: now });
      const emptyLibrary = createCircuitRecipeLibrary({ createdAt: now });
      const input: CircuitKnowledgeProblemInput = { tenantId: "local", branchId: project.interfacePlanning.branchId, requirementsPackage: project.requirements, architectureState: project.architecture, powerState: project.power, interfaceState: project.interfacePlanning, upstreamSignoff: signoff, pcbFoundationSignoff, capabilityProfile: EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1, componentKnowledgeSnapshotRevision: circuitDigest(Object.values(project.componentSelections ?? {}).map((item) => item.atomicRevisionId).sort()), recipeLibraryRevision: emptyLibrary.deterministicDigest, policyRuleRegistryRevision: "sirkit-circuit-policy/1.0.0", actor, createdAt: now };
      const response = await fetch("/api/circuit-knowledge/problem", { method: "POST", headers: headers(project.id, input.branchId), body: JSON.stringify(input) }); const body = await response.json() as { ok: boolean; problem?: CircuitKnowledgeProblem; verdict?: string; error?: string; diagnostics?: Array<{ message: string }> };
      if (!response.ok || !body.ok || !body.problem) throw new Error(`${body.verdict ?? body.error ?? "CD-5 problem compilation failed"}: ${body.diagnostics?.map((item) => item.message).join("; ") ?? ""}`);
      const state = createCircuitKnowledgeProjectState({ projectId: project.id, branchId: input.branchId, upstreamSignoff: signoff, pcbFoundationSignoff, problem: body.problem, library: emptyLibrary });
      if (!saveProjectCircuitKnowledge(project.id, state)) throw new Error("Circuit knowledge persistence failed"); setProject(loadProject(project.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setWorking(false); }
  }
  if (project === undefined) return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-500">Loading circuit knowledge…</main>;
  if (!project) return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-300"><h1 className="text-xl text-zinc-100">Sirkit Circuit Knowledge</h1><p className="mt-3 text-sm text-zinc-500">Open <code>/circuit-knowledge?project=&lt;project-id&gt;</code>.</p></main>;
  if (project.circuitKnowledge) return <CircuitKnowledgeWorkspace value={project.circuitKnowledge} />;
  const ready = Boolean(project.requirements && project.architecture?.selection && project.power?.selection && project.interfacePlanning?.selection);
  return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-300"><div className="max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-6"><p className="text-xs uppercase tracking-[0.2em] text-cyan-400">Conceptual design · CD-05</p><h1 className="mt-2 text-2xl text-zinc-100">Executable Circuit Knowledge</h1><p className="mt-3 text-sm leading-6 text-zinc-400">CD-5 requires exact, integrity-valid, human-selected CD-1 through CD-4 revisions. Starting CD-5 creates only a pinned recipe-compilation workspace; it does not place components, select parts or values, or alter the schematic/PCB.</p>{ready ? <button type="button" disabled={working} onClick={activate} className="mt-5 rounded border border-cyan-800 bg-cyan-950/30 px-3 py-2 text-sm text-cyan-300 disabled:opacity-40">{working ? "Checking strict prerequisite chain…" : "Sign off upstream and start CD-5"}</button> : <p className="mt-5 rounded border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-300">Blocked: CD-1 through CD-4 must each have a selected, compatible revision.</p>}{error && <p className="mt-4 rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}</div></main>;
}
