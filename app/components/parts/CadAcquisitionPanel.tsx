"use client";

/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.3 / M.4, design M2.1): "Obtain the part's assets" in the Missing parts list - the page's half of
 * the durable CAD acquisition task (the agent's `sirkit.parts.acquisition-start` / `-status` read the SAME task through the same service).
 *
 * For the listed catalog instances of ONE catalog part a person starts (or reattaches to) the task; a worker then searches the local
 * library (a published revision of the same exact part is reused, nothing downloaded), asks an ADMITTED CAD source only for the real KiCad
 * symbol and footprint (and a pin table where the source has one), stores and hashes the bytes, parses and validates them, and prepares a
 * review package. The panel shows each stage with its own evidence, the source attempts, the candidate's verdict and identity (an exact
 * MPN only with real evidence, otherwise a GENERIC KiCad candidate), the stored objects' hashes, the licence, every unresolved fact and
 * conflict, and a blocker with its remedy. A PERSON sends the package for component review (the agent cannot); a reviewer approves and a
 * different administrator publishes it in the catalog governance project; "Check again" then lets the task offer the replacement, which
 * goes through the existing review dialog ("Offer the replacement" hands the instances to the same path as "Find a replacement in the
 * library"). Nothing here approves, publishes, binds or applies anything.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SchematicState } from "@/lib/schematic-types";
import type { ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { CAD_ACQUISITION_TERMINAL_STATES, type CadAcquisitionTaskView } from "@/app/lib/acquisition/cad-acquisition-contract";
import { controlCadAcquisition, listCadAcquisitions, readCadAcquisition, sendCadAcquisitionForReview, startCadAcquisition, type CadAcquisitionAnswer } from "@/app/lib/project/cad-acquisition-client";

export const OBTAIN_ASSETS_LABEL = "Obtain the part's assets";
const POLL_MS = 1_500;
const ACTIVE: ReadonlySet<string> = new Set(["queued", "running", "waiting-for-resource", "cancel-requested"]);

export interface AcquisitionInstance { componentId: string; refDes: string; partId: string }
interface Group { partId: string; instances: AcquisitionInstance[] }

const STAGE_LABEL: Readonly<Record<string, string>> = {
  "local-search": "Local library", "source-selection": "Source", retrieve: "Retrieve", validate: "Validate", handoff: "Send for review",
  "awaiting-publication": "Review and publication", proposal: "Replacement", applied: "Applied", preflight: "Prepare PCB check",
};
const STATUS_CLASS: Readonly<Record<string, string>> = { done: "text-emerald-300", running: "text-sky-300", pending: "text-zinc-500", skipped: "text-zinc-500", blocked: "text-amber-300" };

const shortHash = (hash: string): string => `sha256:${hash.slice(0, 12)}…`;

function identityWords(task: CadAcquisitionTaskView): string | null {
  const candidate = task.candidate;
  if (!candidate) return null;
  return candidate.identity.kind === "exact" ? `exact MPN ${candidate.identity.exactMpn ?? ""} (${candidate.identity.basis})` : `GENERIC KiCad candidate - ${candidate.identity.basis}`;
}

export function CadAcquisitionPanel({ instances, schematic, projectScope, onOfferReplacement }: {
  instances: readonly AcquisitionInstance[];
  schematic: SchematicState;
  projectScope: ProjectSelectorScope | null;
  /** the page's existing replacement path (the review dialog); absent: no assistant on this surface */
  onOfferReplacement?: (instances: Array<{ componentId: string; refDes: string }>) => void;
}) {
  const groups = useMemo<Group[]>(() => {
    const byPart = new Map<string, AcquisitionInstance[]>();
    for (const instance of instances) byPart.set(instance.partId, [...(byPart.get(instance.partId) ?? []), instance]);
    return [...byPart.entries()].map(([partId, list]) => ({ partId, instances: list }));
  }, [instances]);
  const [tasks, setTasks] = useState<Record<string, CadAcquisitionTaskView>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const scopeKey = projectScope ? `${projectScope.tenantId}/${projectScope.projectId}/${projectScope.branchId}` : "";

  // the latest scope and groups, read by the effects below (kept in refs so an equal scope object never refetches)
  const scopeRef = useRef(projectScope);
  const groupsRef = useRef(groups);
  useEffect(() => { scopeRef.current = projectScope; groupsRef.current = groups; }, [projectScope, groups]);
  const groupsKey = groups.map((group) => `${group.partId}:${group.instances.map((instance) => instance.componentId).join("+")}`).join(",");

  // reattach: the project's recent tasks whose targets are these instances (a reload, a remount)
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope || groupsKey === "") return;
    let live = true;
    void listCadAcquisitions(scope).then((listed) => {
      if (!live || !listed.ok) return;
      const found: Record<string, CadAcquisitionTaskView> = {};
      for (const group of groupsRef.current) {
        const ids = new Set(group.instances.map((instance) => instance.componentId));
        const task = listed.tasks.find((candidate) => candidate.targets.some((target) => ids.has(target.componentId)));
        if (task) found[group.partId] = task;
      }
      setTasks((current) => ({ ...found, ...current }));
    });
    return () => { live = false; };
  }, [scopeKey, groupsKey]);

  const applyAnswer = useCallback((partId: string, answer: CadAcquisitionAnswer) => {
    if (answer.ok) {
      setTasks((current) => ({ ...current, [partId]: answer.task }));
      setErrors((current) => { const next = { ...current }; delete next[partId]; return next; });
    } else {
      setErrors((current) => ({ ...current, [partId]: `${answer.error} (${answer.code})` }));
    }
  }, []);

  // poll while a task is working in the worker (each poll is one GET of its public view)
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  const activeKey = Object.entries(tasks).filter(([, task]) => ACTIVE.has(task.state)).map(([partId, task]) => `${partId}:${task.taskId}`).join(",");
  useEffect(() => {
    if (activeKey === "") return;
    const timer = setInterval(() => {
      const scope = scopeRef.current;
      if (!scope) return;
      for (const [partId, task] of Object.entries(tasksRef.current)) {
        if (!ACTIVE.has(task.state)) continue;
        void readCadAcquisition(scope, task.taskId).then((answer) => { if (answer.ok) applyAnswer(partId, answer); });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [activeKey, applyAnswer]);

  const run = useCallback(async (partId: string, action: () => Promise<CadAcquisitionAnswer>) => {
    if (busy) return;
    setBusy(partId);
    try { applyAnswer(partId, await action()); } finally { setBusy(null); }
  }, [busy, applyAnswer]);

  if (groups.length === 0) return null;
  return (
    <div data-testid="missing-acquisition" className="mt-2 space-y-1.5">
      {groups.map((group) => {
        const task = tasks[group.partId] ?? null;
        const refs = group.instances.map((instance) => instance.refDes).join(", ");
        const reason = !projectScope ? "open a project first" : null;
        const terminal = task ? CAD_ACQUISITION_TERMINAL_STATES.includes(task.state) : true;
        const working = task ? ACTIVE.has(task.state) : false;
        const error = errors[group.partId];
        return (
          <div key={group.partId} data-testid={`missing-acquisition-${group.partId}`} data-state={task?.state ?? "none"} data-stage={task?.stage ?? "none"} data-next={task?.nextAction ?? "start"} className="rounded border border-zinc-800 bg-zinc-950/60 p-1.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {(!task || terminal) && task?.state !== "succeeded" && (
                <button type="button" disabled={reason !== null || busy !== null} onClick={() => void run(group.partId, () => startCadAcquisition(projectScope!, { componentIds: group.instances.map((instance) => instance.componentId), schematic }))} aria-label={`${OBTAIN_ASSETS_LABEL} for ${refs}`} data-testid={`missing-acquire-start-${group.partId}`} className="rounded border border-sky-800 px-2 py-0.5 text-sky-200 hover:border-sky-600 disabled:cursor-not-allowed disabled:opacity-50">
                  {busy === group.partId ? `${OBTAIN_ASSETS_LABEL}…` : OBTAIN_ASSETS_LABEL}
                </button>
              )}
              <span className="text-zinc-400">{reason ? `not available: ${reason}` : task ? `${refs}: ${task.state.replace(/-/g, " ")} - ${STAGE_LABEL[task.stage] ?? task.stage}` : `for ${refs}: retrieves the part's KiCad symbol and footprint from an admitted source, validates them and prepares a review package - nothing in the design changes`}</span>
            </div>
            {error && <div role="alert" data-testid={`missing-acquisition-error-${group.partId}`} className="mt-0.5 text-amber-300">{error}</div>}
            {task && (
              <div className="mt-1 space-y-1">
                <ol aria-label={`Acquisition stages for ${refs}`} className="grid gap-0.5">
                  {task.stages.filter((stage) => stage.status !== "pending").map((stage) => (
                    <li key={stage.stage} data-testid={`missing-acquisition-stage-${group.partId}-${stage.stage}`} data-status={stage.status} className="grid grid-cols-[8rem_1fr] gap-x-2">
                      <span className="text-zinc-300">{STAGE_LABEL[stage.stage] ?? stage.stage}</span>
                      <span><span className={STATUS_CLASS[stage.status] ?? "text-zinc-400"}>{stage.status}</span>{stage.evidence ? <span className="text-zinc-500"> · {stage.evidence}</span> : null}</span>
                    </li>
                  ))}
                </ol>
                {task.attempts.length > 0 && (
                  <div data-testid={`missing-acquisition-attempts-${group.partId}`} className="flex flex-wrap gap-1">
                    {task.attempts.map((attempt, index) => <span key={`${attempt.sourceId}:${index}`} data-source={attempt.sourceId} data-outcome={attempt.outcome} title={attempt.detail} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">{attempt.sourceId} · {attempt.outcome}{attempt.code ? ` (${attempt.code})` : ""}</span>)}
                  </div>
                )}
                {task.candidate && (
                  <div data-testid={`missing-acquisition-candidate-${group.partId}`} data-verdict={task.candidate.verdict} data-identity={task.candidate.identity.kind} data-fixture={task.candidate.fixtureEvidence ? "true" : "false"} className="rounded border border-zinc-800 p-1">
                    <div><span className={task.candidate.verdict === "validated" ? "text-emerald-300" : "text-amber-300"}>{task.candidate.verdict}</span> · {identityWords(task)}{task.candidate.fixtureEvidence ? " · FIXTURE evidence" : ""}</div>
                    <div className="text-zinc-500">licence {task.candidate.licence.spdx ?? task.candidate.licence.id} · {task.candidate.licence.attribution}</div>
                    <ul className="mt-0.5 grid gap-0.5 text-zinc-400">
                      {task.candidate.objects.map((object) => <li key={`${object.role}:${object.sha256}`} data-testid="missing-acquisition-object" data-role={object.role}>{object.role} · {shortHash(object.sha256)} · {object.byteLength} bytes{object.ref ? ` · ${object.ref.slice(0, 40)}` : ""}</li>)}
                    </ul>
                    {task.candidate.unresolved.length > 0 && <div className="text-zinc-400">Unresolved: {task.candidate.unresolved.join("; ")}</div>}
                    {task.candidate.conflicts.length > 0 && <div className="text-amber-300">Conflicts: {task.candidate.conflicts.join("; ")}</div>}
                  </div>
                )}
                {task.blocker && <div role="status" data-testid={`missing-acquisition-blocker-${group.partId}`} data-code={task.blocker.code} className="text-amber-300">{task.blocker.message} <span className="text-zinc-400">{task.blocker.remedy}</span></div>}
                {task.handoff && <div data-testid={`missing-acquisition-handoff-${group.partId}`} className="text-zinc-300">Sent for component review by {task.handoff.by} · {task.publication ? `publication ${task.publication.status}` : "awaiting the reviewers"}</div>}
                {task.proposal && <div data-testid={`missing-acquisition-proposal-${group.partId}`} data-revision={task.proposal.atomicPartRevisionId} className="text-emerald-300">Published revision {task.proposal.atomicPartRevisionId.slice(0, 28)}… is an eligible replacement{task.proposal.reused ? " (reused - nothing was downloaded)" : ""}</div>}
                {task.applied && <div data-testid={`missing-acquisition-applied-${group.partId}`} className="text-emerald-300">Applied: receipt {task.applied.receiptId.slice(0, 24)}…{task.preflight ? ` · Prepare PCB check: ${task.preflight.unresolvedCount === 0 ? "no unresolved part" : `${task.preflight.unresolvedCount} unresolved (${task.preflight.unresolvedRefDes.join(", ")})`}` : ""}</div>}
                <ul aria-label={`Acquisition progress for ${refs}`} className="grid gap-0.5 text-[10px] text-zinc-500">
                  {task.events.slice(-4).map((event) => <li key={event.seq} data-kind={event.kind}>{event.message}</li>)}
                </ul>
                <div className="flex flex-wrap gap-1">
                  {task.nextAction === "send-for-review" && <button type="button" disabled={busy !== null || !projectScope} onClick={() => void run(group.partId, () => sendCadAcquisitionForReview(projectScope!, task.taskId))} data-testid={`missing-acquisition-handoff-send-${group.partId}`} className="rounded border border-emerald-800 px-2 py-0.5 text-emerald-200 hover:border-emerald-600 disabled:opacity-50">Send for component review</button>}
                  {(task.nextAction === "await-publication" || (task.blocker !== null && !working)) && <button type="button" disabled={busy !== null || !projectScope} onClick={() => void run(group.partId, () => controlCadAcquisition(projectScope!, task.taskId, "recheck"))} data-testid={`missing-acquisition-recheck-${group.partId}`} className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-200 hover:border-zinc-500 disabled:opacity-50">Check again</button>}
                  {task.nextAction === "offer-replacement" && <button type="button" disabled={!onOfferReplacement} onClick={() => onOfferReplacement?.(group.instances.map((instance) => ({ componentId: instance.componentId, refDes: instance.refDes })))} title={onOfferReplacement ? "opens the existing review dialog through the assistant's replacement path" : "the assistant is not available on this surface"} data-testid={`missing-acquisition-offer-${group.partId}`} className="rounded border border-teal-800 px-2 py-0.5 text-teal-200 hover:border-teal-600 disabled:opacity-50">Offer the replacement</button>}
                  {working && <button type="button" disabled={busy !== null || !projectScope || task.state === "cancel-requested"} onClick={() => void run(group.partId, () => controlCadAcquisition(projectScope!, task.taskId, "cancel"))} data-testid={`missing-acquisition-cancel-${group.partId}`} className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-zinc-500 disabled:opacity-50">Cancel</button>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
