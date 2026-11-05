"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, History, Loader2, RefreshCw, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import { ASSIGNMENT_REQUEST_VERSION, type AssignmentDecisionAction, type AssignmentDecisionPlan, type AssignmentDecisionRequest, type AssignmentDecisionResult, type PhysicalAssignmentItem } from "@/app/lib/assignment-queue/types";

interface Scope { tenantId: string; projectId: string; branchId: string; assemblyVariantId: string }
// B16.0: only the project/branch SELECTOR is sent. Identity/role are derived
// server-side from the authenticated session + membership; the route
// overrides any body actorContext with the server-derived actor.
const headers = (scope: Scope, json = false): HeadersInit => ({ ...(json ? { "Content-Type": "application/json" } : {}), "x-sirkit-tenant-id": scope.tenantId, "x-sirkit-project-id": scope.projectId, "x-sirkit-branch-id": scope.branchId });
const title = (value: string): string => value.replaceAll("_", " ");

interface QueuePage { items: PhysicalAssignmentItem[]; nextCursor: string | null }
async function requestQueue(scope: Scope, cursor?: string, signal?: AbortSignal): Promise<QueuePage> {
  const response = await fetch(`/api/assignment-queue?variant=${encodeURIComponent(scope.assemblyVariantId)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: headers(scope), cache: "no-store", signal });
  const body = await response.json() as { ok?: boolean; code?: string; items?: PhysicalAssignmentItem[]; nextCursor?: string | null };
  if (!response.ok || !body.ok) throw new Error(body.code ?? "Assignment queue unavailable");
  return { items: body.items ?? [], nextCursor: body.nextCursor ?? null };
}

// Per-item decisions start with the render of their item; no later effect
// can clear a candidate, assignee or confirmation the user has just entered.
/** A committed decision's result, owned by the panel: the detail that committed it is keyed to the item's revision and remounts when the server bumps that revision, so the result must outlive it. */
export interface CommittedAssignment { itemId: string; referenceDesignator: string; result: AssignmentDecisionResult }

function AssignmentItemDetail({ scope, selected, reason, setReason, load, onCommitted }: { scope: Scope; selected: PhysicalAssignmentItem; reason: string; setReason: (value: string) => void; load: () => Promise<void>; onCommitted: (committed: CommittedAssignment) => void }) {
  const [assigneeId, setAssigneeId] = useState(""), [candidateId, setCandidateId] = useState<string | null>(null), [preview, setPreview] = useState<{ plan: AssignmentDecisionPlan; request: AssignmentDecisionRequest } | null>(null), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const lifetime = useRef({ active: true, previewSequence: 0 });
  useEffect(() => {
    const session = lifetime.current;
    session.active = true;
    return () => { session.active = false; session.previewSequence++; };
  }, []);

  const makeRequest = (action: AssignmentDecisionAction): AssignmentDecisionRequest => { const candidate = selected.candidateSet.find((item) => item.candidateId === candidateId), idempotencyKey = crypto.randomUUID(); return { requestSchemaVersion: ASSIGNMENT_REQUEST_VERSION, requestId: crypto.randomUUID(), tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, itemId: selected.itemId, expectedItemRevision: selected.itemRevision, expectedItemDigest: selected.itemDigest, action, ...(candidate ? { selectedCandidateId: candidate.candidateId, selectedCandidateDigest: candidate.candidateDigest } : {}), ...(action === "assign" ? { assignee: { actorOrGroupId: assigneeId.trim(), kind: "actor" } as const } : {}), ...(action === "approve_policy_exception" ? { policyException: { exceptionId: `exception:${idempotencyKey}`, action: "require_exact_part", assemblyVariantIds: [scope.assemblyVariantId], reason, evidenceRefs: [] } } : {}), reason, actorContext: { actorId: "local-user", actorKind: "human", role: "project_admin", sessionId: "pcb-assignment-workbench" }, mode: "preview", idempotencyKey, requestedAt: new Date().toISOString() }; };
  const previewAction = async (action: AssignmentDecisionAction) => {
    const request = makeRequest(action), sequence = ++lifetime.current.previewSequence;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/assignment-queue", { method: "POST", headers: headers(scope, true), body: JSON.stringify({ operation: "preview", request }) });
      const body = await response.json() as { ok?: boolean; code?: string; plan?: AssignmentDecisionPlan };
      if (!lifetime.current.active || sequence !== lifetime.current.previewSequence) return;
      if (!response.ok || !body.ok || !body.plan) throw new Error(body.code ?? "Preview failed");
      setPreview({ plan: body.plan, request }); setConfirmed(false);
    } catch (cause) {
      if (lifetime.current.active && sequence === lifetime.current.previewSequence) setError(cause instanceof Error ? cause.message : "Preview failed");
    } finally {
      if (lifetime.current.active && sequence === lifetime.current.previewSequence) setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview || !confirmed || busy) return;
    setBusy(true); setError(null);
    try {
      const request: AssignmentDecisionRequest = { ...preview.request, mode: "commit", planId: preview.plan.planId, planDigest: preview.plan.planDigest };
      const response = await fetch("/api/assignment-queue", { method: "POST", headers: { ...headers(scope, true), "x-sirkit-assignment-commit": "apply_exact_plan" }, body: JSON.stringify({ operation: "commit", request }) });
      const body = await response.json() as { ok?: boolean; code?: string; result?: AssignmentDecisionResult };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.code ?? "Commit failed");
      onCommitted({ itemId: selected.itemId, referenceDesignator: selected.referenceDesignator, result: body.result }); // the panel keeps it across the reload
      if (lifetime.current.active) { setPreview(null); setConfirmed(false); }
      await load();
    } catch (cause) {
      if (lifetime.current.active) setError(cause instanceof Error ? cause.message : "Commit failed");
    } finally {
      if (lifetime.current.active) setBusy(false);
    }
  };

  return <div className="space-y-4">
    {error && <div role="alert" className="rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-200">{error}</div>}
    <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-zinc-100">{selected.referenceDesignator} · {selected.displayName}</h3><span className="rounded bg-red-950 px-2 py-0.5 text-[10px] uppercase text-red-300">{title(selected.severity)}</span><span className="rounded bg-amber-950 px-2 py-0.5 text-[10px] uppercase text-amber-300">{title(selected.riskClass)}</span></div><p className="mt-1 text-xs text-zinc-500">Variant {selected.assemblyVariantId} · stable component {selected.componentId}</p></div>
    <div className="rounded border border-red-900/60 bg-red-950/20 p-3"><div className="flex items-center gap-1.5 text-xs font-semibold text-red-200"><AlertTriangle className="size-3.5" />{selected.primaryBlocker.sourceIssueCode}</div><p className="mt-1 text-xs text-zinc-300">{selected.primaryBlocker.safeMessage}</p><p className="mt-1 text-[10px] text-zinc-600">Source {selected.primaryBlocker.sourceStage} · {selected.primaryBlocker.remediationCategory}</p></div>
    <div><h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Candidates ({selected.candidateSet.length})</h4><div className="mt-2 grid gap-2">{selected.candidateSet.length ? selected.candidateSet.map((candidate) => <label key={candidate.candidateId} className={`rounded border p-3 ${candidateId === candidate.candidateId ? "border-teal-500 bg-teal-950/25" : "border-zinc-800 bg-zinc-900/40"}`}><div className="flex items-start gap-2"><input type="radio" name="assignment-candidate" checked={candidateId === candidate.candidateId} disabled={!candidate.selectable && !candidate.approvalReady} onChange={() => setCandidateId(candidate.candidateId)} className="mt-0.5" /><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-1"><span className="text-xs font-medium text-zinc-200">{candidate.exactPart?.exactMpn ?? candidate.footprint?.footprintName ?? candidate.candidateId}</span>{candidate.selectable && <span className="rounded bg-emerald-950 px-1 text-[9px] text-emerald-300">selectable</span>}{candidate.approvalReady && <span className="rounded bg-cyan-950 px-1 text-[9px] text-cyan-300">approval ready</span>}{candidate.suggestionOnly && <span className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-400">suggestion only</span>}</div><p className="mt-1 text-[10px] text-zinc-500">{candidate.package?.canonicalName ?? "package unknown"} · {candidate.footprint ? `${candidate.footprint.libraryNickname}:${candidate.footprint.footprintName}` : "footprint missing"}</p><p className="mt-1 text-[10px] text-zinc-600">Mapping {title(candidate.mapping.state)} · approval {title(candidate.approvalState)} · freshness {title(candidate.freshnessState)}</p>{candidate.disqualificationReasons.length > 0 && <p className="mt-1 text-[10px] text-red-300">{candidate.disqualificationReasons.join(", ")}</p>}</div></div></label>) : <p className="rounded border border-zinc-800 p-3 text-xs text-zinc-500">No trusted candidate is currently available. Provide data or escalate; the AI cannot invent one.</p>}</div></div>
    <div><label className="text-xs text-zinc-400">Decision reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-200" placeholder="Required for engineering audit" /></label>{selected.allowedActions.some((action) => action.action === "assign") && <label className="mt-2 block text-xs text-zinc-400">Reviewer or group ID<input value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-200" placeholder="e.g. pcb-reviewers" /></label>}<div className="mt-2 flex flex-wrap gap-2">{selected.allowedActions.map((action) => <button key={action.action} type="button" disabled={busy || action.candidateRequired && !candidateId || action.reasonRequired && !reason.trim() || action.action === "assign" && !assigneeId.trim()} onClick={() => void previewAction(action.action)} className="rounded border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:border-teal-600 hover:text-white disabled:opacity-35">{action.label}</button>)}</div></div>
    {preview && <div className="rounded border border-amber-700 bg-amber-950/20 p-3"><div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200"><ShieldCheck className="size-3.5" />Exact decision preview</div><p className="mt-1 text-xs text-zinc-300">{preview.plan.expectedOutcome}</p><ul className="mt-2 space-y-1 text-[10px] text-zinc-500">{preview.plan.operations.map((operation) => <li key={operation.operationId}>{operation.owner}: {title(operation.action)} · before {operation.beforeRevision}</li>)}</ul>{preview.plan.warnings.map((warning) => <p key={warning} className="mt-2 text-[10px] text-amber-300">{warning}</p>)}<label className="mt-3 flex items-start gap-2 text-xs text-zinc-300"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />Commit this exact plan. Chat and AI suggestions are not authorization.</label><button type="button" disabled={!confirmed || busy} onClick={() => void commit()} className="mt-3 flex items-center gap-1.5 rounded bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-zinc-800 disabled:text-zinc-500">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <UserRoundCheck className="size-3.5" />}Commit exact plan</button></div>}
    <div className="flex items-center gap-1 text-[10px] text-zinc-600"><History className="size-3" />Item revision {selected.itemRevision} · {selected.sourceIssues.length} source reference(s)</div>
  </div>;
}

export function AssignmentQueuePanel({ scope, onClose }: { scope: Scope; onClose: () => void }) {
  const scopeKey = JSON.stringify([scope.tenantId, scope.projectId, scope.branchId, scope.assemblyVariantId]);
  return <ScopedAssignmentQueuePanel key={scopeKey} scope={scope} onClose={onClose} />;
}

function ScopedAssignmentQueuePanel({ scope: suppliedScope, onClose }: { scope: Scope; onClose: () => void }) {
  const { tenantId, projectId, branchId, assemblyVariantId } = suppliedScope;
  const scope = useMemo(() => ({ tenantId, projectId, branchId, assemblyVariantId }), [tenantId, projectId, branchId, assemblyVariantId]);
  const [items, setItems] = useState<PhysicalAssignmentItem[]>([]), [selectedId, setSelectedId] = useState<string | null>(null), [nextCursor, setNextCursor] = useState<string | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [reason, setReason] = useState(""), [filter, setFilter] = useState("open"), [committed, setCommitted] = useState<CommittedAssignment | null>(null);
  const queueLifetime = useRef({ generation: 0, mounted: true });
  const selected = items.find((item) => item.itemId === selectedId) ?? items[0] ?? null;
  const visible = useMemo(() => filter === "all" ? items : items.filter((item) => filter === "open" ? !["resolved", "resolved_with_new_blocker", "superseded", "cancelled"].includes(item.lifecycle) : item.lifecycle === filter || item.category === filter), [items, filter]);
  const applyPage = useCallback((page: QueuePage, cursor?: string) => {
    setItems((current) => cursor ? [...new Map([...current, ...page.items].map((item) => [item.itemId, item])).values()] : page.items);
    setNextCursor(page.nextCursor);
    setSelectedId((current) => cursor ? current ?? page.items[0]?.itemId ?? null : current && page.items.some((item) => item.itemId === current) ? current : page.items[0]?.itemId ?? null);
  }, []);
  const load = useCallback(async (cursor?: string) => {
    if (!queueLifetime.current.mounted) return;
    const requestGeneration = ++queueLifetime.current.generation;
    setLoading(true); setError(null);
    try {
      const page = await requestQueue(scope, cursor);
      if (requestGeneration === queueLifetime.current.generation) applyPage(page, cursor);
    } catch (cause) {
      if (requestGeneration === queueLifetime.current.generation) setError(cause instanceof Error ? cause.message : "Assignment queue unavailable");
    } finally {
      if (requestGeneration === queueLifetime.current.generation) setLoading(false);
    }
  }, [scope, applyPage]);
  useEffect(() => {
    const session = queueLifetime.current;
    session.mounted = true;
    const controller = new AbortController(), requestGeneration = ++session.generation;
    // Initial loading is state initialization. Only the asynchronous request's
    // completion updates it; cancellation also invalidates late responses.
    void requestQueue(scope, undefined, controller.signal).then((page) => {
      if (!controller.signal.aborted && requestGeneration === session.generation) applyPage(page);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && requestGeneration === session.generation) setError(cause instanceof Error ? cause.message : "Assignment queue unavailable");
    }).finally(() => {
      if (!controller.signal.aborted && requestGeneration === session.generation) setLoading(false);
    });
    return () => { session.mounted = false; controller.abort(); session.generation++; };
  }, [scope, applyPage]);

  return <aside aria-label="Footprint assignment queue" className="absolute inset-y-0 right-0 z-50 flex w-[min(760px,94%)] flex-col border-l border-zinc-700 bg-zinc-950 shadow-sm">
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800 px-4"><div><h2 className="text-sm font-semibold text-zinc-100">Physical assignment workbench</h2><p className="text-[10px] text-zinc-500">Explicit decisions only · PCB unchanged</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => void load()} aria-label="Refresh assignment queue" className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"><RefreshCw className="size-4" /></button><button type="button" onClick={onClose} aria-label="Close assignment queue" className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"><X className="size-4" /></button></div></header>
    {error && <div role="alert" className="m-3 rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-200">{error}</div>}
    {loading && items.length === 0 ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-500"><Loader2 className="size-4 animate-spin" />Loading current blockers…</div> : <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
      <section className="min-h-0 overflow-y-auto border-r border-zinc-800"><div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950 p-2"><select aria-label="Assignment filter" value={filter} onChange={(event) => setFilter(event.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"><option value="open">Active ({items.filter((item) => !item.lifecycle.startsWith("resolved")).length})</option><option value="all">All ({items.length})</option><option value="deferred">Deferred</option><option value="stale">Stale</option><option value="resolved">Resolved</option></select></div>{visible.length ? visible.map((item) => <button type="button" key={item.itemId} onClick={() => setSelectedId(item.itemId)} className={`block w-full border-b border-zinc-800 p-3 text-left ${selected?.itemId === item.itemId ? "bg-teal-950/35" : "hover:bg-zinc-900"}`}><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-zinc-200">{item.referenceDesignator || item.displayName}</span><span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase text-zinc-400">{title(item.lifecycle)}</span></div><p className="mt-1 text-[11px] text-zinc-400">{title(item.category)}</p><p className="mt-1 line-clamp-2 text-[10px] text-zinc-600">{item.primaryBlocker.safeMessage}</p></button>) : <p className="p-4 text-xs text-zinc-500">No items in this view.</p>}{nextCursor && <button type="button" disabled={loading} onClick={() => void load(nextCursor)} className="m-2 w-[calc(100%-1rem)] rounded border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 hover:text-white disabled:opacity-40">Load more</button>}</section>
      <section className="min-h-0 overflow-y-auto p-4">
        {committed && (!selected || committed.itemId === selected.itemId) && <div className="mb-4 rounded border border-emerald-900 bg-emerald-950/20 p-3"><div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-200"><CheckCircle2 className="size-3.5" />{committed.referenceDesignator}: {title(committed.result.status)}</div><p className="mt-1 text-[10px] text-zinc-400">Board changed: no · {committed.result.auditIds.length} authoritative audit reference(s)</p>{committed.result.warnings.map((warning) => <p key={warning} className="mt-1 text-[10px] text-amber-300">{warning}</p>)}</div>}
        {selected ? <AssignmentItemDetail key={JSON.stringify([selected.itemId, selected.itemRevision, selected.itemDigest])} scope={scope} selected={selected} reason={reason} setReason={setReason} load={load} onCommitted={setCommitted} /> : <div className="flex h-full items-center justify-center text-sm text-zinc-600">No assignment blockers.</div>}
      </section>
    </div>}
  </aside>;
}
