"use client";

import { useEffect, useState } from "react";
import { PowerWorkspace } from "@/app/components/power/PowerWorkspace";
import { createUpstreamCompletionSignoff, EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1 } from "@/app/lib/power/capability";
import { createPowerProjectState } from "@/app/lib/power/project";
import { createPowerSelectionDecision } from "@/app/lib/power/selection";
import { createPowerTransaction, PowerTransactionService } from "@/app/lib/power/transactions";
import type { PowerArchitectureCandidate, PowerArchitectureProblem, PowerProblemCompileInput } from "@/app/lib/power/types";
import type { SavedProject } from "@/lib/persistence";
import { loadProject, saveProjectPower } from "@/lib/persistence";

const actor = { actorId: "local-project-owner", actorKind: "human" as const, sessionId: "power-workspace", role: "project_admin" as const };
function scopeHeaders(projectId: string, branchId = "main") { return { "content-type": "application/json", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": branchId, "x-sirkit-actor-id": actor.actorId, "x-sirkit-role": actor.role }; }

export default function PowerPage() {
  const [project, setProject] = useState<SavedProject | null | undefined>(undefined); const [working, setWorking] = useState(false); const [error, setError] = useState("");
  useEffect(() => { queueMicrotask(() => { const id = new URLSearchParams(window.location.search).get("project"); setProject(id ? loadProject(id) : null); }); }, []);

  async function activate(): Promise<void> {
    if (!project?.requirements || !project.architecture?.selection) return; const selected = project.architecture.candidates.find((item) => item.candidateId === project.architecture!.selection!.candidateId && item.deterministicDigest === project.architecture!.selection!.candidateDigest); if (!selected) return;
    if (!window.confirm("Confirm that the pinned CD-1 package and selected CD-2 architecture are complete for CD-3 exploration? This records a human signoff; it does not alter the schematic or PCB.")) return;
    setWorking(true); setError(""); try {
      const now = new Date().toISOString(); const upstreamSignoff = createUpstreamCompletionSignoff({ cd1Verdict: "CD-1 COMPLETE", cd2Verdict: "CD-2 COMPLETE", requirementsDigest: project.requirements.deterministicDigest, architectureProblemDigest: project.architecture.problem.deterministicDigest, architectureCandidateDigest: selected.deterministicDigest, architectureDecisionDigest: project.architecture.selection.deterministicDigest, approver: actor, approvedAt: now });
      const input: PowerProblemCompileInput = { tenantId: "local", branchId: project.architecture.branchId, requirementsPackage: project.requirements, architectureState: project.architecture, upstreamSignoff, capabilityProfile: EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1, policyProfileRevision: "sirkit-power-policy/1", ruleModelRegistryRevision: "sirkit-power-rules/1", actor, createdAt: now };
      const response = await fetch("/api/power/problem", { method: "POST", headers: scopeHeaders(project.id, input.branchId), body: JSON.stringify(input) }); const body = await response.json() as { ok: boolean; problem?: PowerArchitectureProblem; error?: string; diagnostics?: Array<{ message: string }> }; if (!response.ok || !body.ok || !body.problem) throw new Error(body.error ?? body.diagnostics?.map((item) => item.message).join("; ") ?? "Power problem compilation failed");
      const power = createPowerProjectState({ projectId: project.id, branchId: input.branchId, upstreamSignoff, problem: body.problem, candidates: [], selection: null }); if (!saveProjectPower(project.id, power)) throw new Error("Power persistence failed"); setProject(loadProject(project.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setWorking(false); }
  }

  async function generate(): Promise<void> {
    if (!project?.power) return; setWorking(true); setError(""); try { const response = await fetch("/api/power/alternatives", { method: "POST", headers: scopeHeaders(project.id, project.power.branchId), body: JSON.stringify({ problem: project.power.problem, count: 3 }) }); const body = await response.json() as { ok: boolean; candidates?: PowerArchitectureCandidate[]; error?: string }; if (!response.ok || !body.ok || !body.candidates) throw new Error(body.error ?? "Power alternatives failed"); const service = new PowerTransactionService(project.power); const tx = createPowerTransaction({ transactionId: crypto.randomUUID(), projectId: project.id, branchId: project.power.branchId, actor, reason: "Generate bounded CD-3 alternatives", baseStateDigest: project.power.deterministicDigest, idempotencyKey: crypto.randomUUID(), operations: body.candidates.map((candidate) => ({ operationId: crypto.randomUUID(), kind: "add_candidate" as const, candidate })), createdAt: new Date().toISOString() }); const outcome = service.submit(tx); if (outcome.state !== "accepted" || !saveProjectPower(project.id, outcome.project)) throw new Error(outcome.state === "accepted" ? "Power persistence failed" : outcome.diagnostics.join(", ")); setProject(loadProject(project.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setWorking(false); }
  }

  function select(candidateId: string): void {
    if (!project?.power || project.power.selection) return; const candidate = project.power.candidates.find((item) => item.candidateId === candidateId); if (!candidate) return; const rationale = window.prompt("Why is this power architecture preferred over the alternatives?"); if (!rationale?.trim()) return; const risks = candidate.risks.filter((item) => !["closed", "mitigation_verified"].includes(item.mitigationState)); if (risks.length && !window.confirm(`Acknowledge ${risks.length} unresolved power architecture risk(s)? They remain visible and unverified.`)) return;
    try { const decision = createPowerSelectionDecision({ candidates: project.power.candidates, candidateId, approver: actor, rationale, unresolvedRiskIds: risks.map((item) => item.riskId), approvedAt: new Date().toISOString() }); const service = new PowerTransactionService(project.power); const transaction = createPowerTransaction({ transactionId: crypto.randomUUID(), projectId: project.id, branchId: project.power.branchId, actor, reason: "Human CD-3 selection", baseStateDigest: project.power.deterministicDigest, idempotencyKey: crypto.randomUUID(), operations: [{ operationId: crypto.randomUUID(), kind: "select_candidate", decision }], createdAt: new Date().toISOString() }); const outcome = service.submit(transaction); if (outcome.state !== "accepted" || !saveProjectPower(project.id, outcome.project)) throw new Error(outcome.state === "accepted" ? "Power persistence failed" : outcome.diagnostics.join(", ")); setProject(loadProject(project.id)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  if (project === undefined) return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-500">Loading power architecture…</main>;
  if (!project) return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-300"><h1 className="text-xl text-zinc-100">Sirkit Power Architecture</h1><p className="mt-3 text-sm text-zinc-500">Open <code>/power?project=&lt;project-id&gt;</code>.</p></main>;
  if (!project.power) { const ready = project.requirements?.status === "accepted_for_architecture_exploration" && Boolean(project.architecture?.selection); return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-300"><h1 className="text-xl text-zinc-100">{project.name} · CD-03</h1><p className="mt-3 max-w-2xl text-sm text-zinc-500">CD-3 requires an integrity-valid accepted CD-1 package, a human-selected CD-2 candidate, and an explicit human completion signoff pinned to both.</p>{ready ? <button type="button" disabled={working} onClick={activate} className="mt-5 rounded border border-cyan-800 px-3 py-2 text-sm text-cyan-300 disabled:opacity-40">{working ? "Compiling…" : "Sign off upstream and start CD-3"}</button> : <p className="mt-4 text-sm text-amber-400">Blocked: complete and select CD-1/CD-2 first.</p>}{error && <p className="mt-3 text-sm text-red-400">{error}</p>}</main>; }
  return <><PowerWorkspace value={project.power} onGenerateAlternatives={project.power.candidates.length ? undefined : generate} onSelectCandidate={project.power.selection ? undefined : select} />{working && <div className="fixed bottom-4 right-4 rounded bg-zinc-800 px-3 py-2 text-sm">Working…</div>}{error && <div className="fixed bottom-4 left-4 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-300">{error}</div>}</>;
}
