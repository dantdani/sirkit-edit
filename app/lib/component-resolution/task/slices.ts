/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.3/M.4, design M2.3 and M2.5): the component-resolution task's FINITE, FENCED slices, run by
 * the existing generation worker under the topic `component-resolution-slice`.
 *
 *  - `acquire`: (1) LOCAL SEARCH - M1's candidate search (`searchResolutionCandidates`) over the instance's own catalog part and the
 *    catalog parts whose MPN is the target's exact MPN (a lexical read: no embedding, no reranker, no provider). An eligible published
 *    revision of the SAME exact part (own part or same MPN) is REUSED - the task offers it and downloads nothing (M.3 item 8); other
 *    eligible local alternatives are recorded as evidence (the person may choose "Find a replacement in the library" instead).
 *    (2) SOURCE SELECTION, RETRIEVE, VALIDATE - the pipeline over the admitted CAD sources; a rate limit or an open breaker is a SCHEDULED
 *    wait (`waiting-for-resource`, the next slice at the real retry time); no source / no asset / a refusal is a blocker that keeps the
 *    attempts and names its remedy. (3) A validated candidate waits for a PERSON to send it for review (`awaiting-review`).
 *  - `recheck`: reads the publication request the handoff became (governance scope: a server read) - pending or approved keeps waiting
 *    (re-checked with backoff, bounded, then on Resume); rejected / withdrawn / retired is a blocker; PUBLISHED re-runs M1's candidate
 *    search with the published link's catalog parts in the recall, and an eligible revision becomes the PROPOSAL the page and the chat
 *    offer through the existing review dialog (a human applies it; the receipt and the updated preflight are recorded by `record-applied`).
 *
 * Every commit is fenced (store.ts): a cancel or a lost lease stops the slice, and a late result is never consumed.
 */
import { searchResolutionCandidates, type CandidateEntry } from "../candidate-search";
import type { CatalogSearchPort, RevisionEvidencePort } from "../evidence";
import type { CatalogPartInspectionPort } from "../../agent/catalog-inspection-reads";
import { CAD_SOURCE_REGISTRY } from "../../acquisition/cad-source-registry";
import { runAcquisitionPipeline, type AcquisitionPipelinePorts, type PipelineAttempt } from "../acquisition/pipeline";
import type { AcquisitionCandidate } from "../acquisition/candidate";
import { COMPONENT_RESOLUTION_POLICY, blockerOf, pushEvent, setStage, type ComponentResolutionTaskHead } from "./contracts";
import type { ComponentResolutionTaskStore, ResolutionSliceLease } from "./store";
import type { CadAcquisitionTaskView } from "../../acquisition/cad-acquisition-contract";

export interface ResolutionSliceSupervisor { readonly signal: AbortSignal; boundary(): Promise<"continue" | "yield" | "cancel" | "fenced"> }

/** What a published request the handoff became looks like to the task (a server read of the governance scope). */
export interface HandoffPublicationStatus { status: "pending" | "approved" | "published" | "rejected" | "withdrawn" | "retired" | "not-submitted"; requestId: string | null; revisionId: string | null; linkedPartIds: string[]; reason: string | null }

export interface ComponentResolutionSlicePorts {
  catalog: CatalogPartInspectionPort;
  evidence: RevisionEvidencePort;
  /** catalog parts whose MPN is this exact MPN (a lexical read; no embedding) */
  partsByExactMpn(exactMpn: string): Promise<string[]>;
  pipeline(task: ComponentResolutionTaskHead): AcquisitionPipelinePorts;
  /** the publication status of a handoff (null: the governance scope is not configured) */
  publicationOf(handoffId: string): Promise<HandoffPublicationStatus | null>;
  clock: () => number;
}

export interface ResolutionSliceReport { topic: "component-resolution-slice"; sliceId: string; taskId: string; kind: string; blockId: null; attempt: number; outcome: "ended" | "fenced" | "cancelled" | "released" | "failed"; state: string | null; detail: string }

/** A recall port over a server-derived id list (never a model's): every hit is still re-read through the catalog and evidence ports. */
function knownPartsRecall(partIds: readonly string[]): CatalogSearchPort {
  return { search: async () => ({ state: "ok", hits: partIds.map((partId) => ({ partId, name: "", mpn: null, mainCategory: "", similarity: 1, pinCount: 0 })), category: null, ranking: "unknown" }) };
}

function sameExactPart(entry: CandidateEntry, task: ComponentResolutionTaskHead): boolean {
  if (entry.origin === "own-part") return true;
  const mpn = task.target.exactMpn ?? task.target.catalogMpn;
  return Boolean(mpn && entry.exactPart && entry.exactPart.exactMpn.toUpperCase() === mpn.toUpperCase());
}

/** M1's candidate search for every target instance; the eligible revision ALL instances share, or the reasons none does. */
async function searchForInstances(task: ComponentResolutionTaskHead, ports: ComponentResolutionSlicePorts, extraPartIds: readonly string[], signal: AbortSignal): Promise<{ shared: CandidateEntry | null; alternatives: CandidateEntry[]; reasons: string[] }> {
  const mpn = task.target.exactMpn ?? task.target.catalogMpn;
  const recall = [...new Set([...(mpn ? await ports.partsByExactMpn(mpn).catch(() => []) : []), ...extraPartIds])].filter((id) => id !== task.target.catalogPartId).slice(0, 9);
  let shared: CandidateEntry | null = null;
  const alternatives: CandidateEntry[] = [];
  const reasons: string[] = [];
  const requirement = { ...(task.request.requirement.mounting ? { mounting: task.request.requirement.mounting } : {}), ...(task.request.requirement.packageCode ? { packageCode: task.request.requirement.packageCode } : {}) };
  const perInstance: CandidateEntry[][] = [];
  for (const instance of task.instances) {
    const outcome = await searchResolutionCandidates({ query: `${task.target.symbol.name} ${mpn ?? ""}`.trim().slice(0, 300), category: null, limit: 10, instance, requirement, ports: { search: knownPartsRecall(recall), catalog: ports.catalog, evidence: ports.evidence }, scope: task.scope, runId: `cr:${task.taskId}`, budgetMs: 20_000, signal, now: ports.clock });
    if (!outcome.ok) { reasons.push(`${instance.refDes}: ${outcome.detail}`); perInstance.push([]); continue; }
    perInstance.push(outcome.report.buckets.eligible);
    for (const [bucket, entries] of Object.entries(outcome.report.buckets)) for (const entry of entries) if (bucket !== "eligible") reasons.push(`${instance.refDes}: ${entry.name || entry.catalogPartId.slice(0, 12)} is ${bucket} (${entry.reasons[0]?.code ?? "no reason"})`);
  }
  const first = perInstance[0] ?? [];
  for (const entry of first) {
    const everywhere = perInstance.every((entries) => entries.some((other) => other.catalogPartId === entry.catalogPartId && other.exactRevision?.revisionId === entry.exactRevision?.revisionId));
    if (!everywhere) continue;
    if (!shared && sameExactPart(entry, task)) shared = entry;
    else alternatives.push(entry);
  }
  return { shared, alternatives, reasons: [...new Set(reasons)].slice(0, 12) };
}

function proposalOf(task: ComponentResolutionTaskHead, entry: CandidateEntry, now: string, reused: boolean): NonNullable<CadAcquisitionTaskView["proposal"]> {
  return { componentIds: task.instances.map((instance) => instance.componentId), candidatePartId: entry.catalogPartId, atomicPartRevisionId: entry.exactRevision!.revisionId, exactMpn: entry.exactPart?.exactMpn ?? null, footprint: entry.exactRevision?.footprintFullName ?? null, origin: entry.origin, foundAt: now, reused };
}

function candidateView(candidate: AcquisitionCandidate): NonNullable<CadAcquisitionTaskView["candidate"]> {
  return {
    candidateId: candidate.candidateId, sourceId: candidate.sourceId, verdict: candidate.report.verdict, identity: candidate.report.identity, reportDigest: candidate.report.digest,
    objects: candidate.objects.map((object) => ({ role: object.role, sha256: object.sha256, byteLength: object.byteLength, locator: object.locator, ref: object.ref, retrievedAt: object.retrievedAt })),
    unresolved: [...candidate.report.unresolved, ...candidate.missing].slice(0, 12), conflicts: candidate.report.conflicts.slice(0, 12),
    licence: { id: candidate.licence.record.id, spdx: candidate.licence.record.spdxId, attribution: candidate.licence.attribution, link: candidate.licence.link }, fixtureEvidence: candidate.fixtureEvidence,
  };
}

const describe = (attempt: PipelineAttempt): string => `${CAD_SOURCE_REGISTRY[attempt.sourceId as keyof typeof CAD_SOURCE_REGISTRY]?.displayName ?? attempt.sourceId}: ${attempt.outcome}${attempt.code ? ` (${attempt.code})` : ""}`;

/** Run one claimed slice to its end commit. */
export async function runComponentResolutionSlice(input: { store: ComponentResolutionTaskStore; lease: ResolutionSliceLease; task: ComponentResolutionTaskHead; ports: ComponentResolutionSlicePorts; supervisor: ResolutionSliceSupervisor }): Promise<ResolutionSliceReport> {
  const { store, lease, ports, supervisor } = input;
  const report = (outcome: ResolutionSliceReport["outcome"], state: string | null, detail: string): ResolutionSliceReport => ({ topic: "component-resolution-slice", sliceId: lease.sliceId, taskId: lease.taskId, kind: lease.kind, blockId: null, attempt: lease.attempt, outcome, state, detail: detail.slice(0, 300) });
  const stopped = async (): Promise<ResolutionSliceReport | null> => {
    const verdict = await supervisor.boundary();
    if (verdict === "continue") return null;
    if (verdict === "yield") { await store.releaseSlice(lease); return report("released", null, "the worker is stopping; the slice was handed back"); }
    if (verdict === "cancel") { const ended = await store.endSlice(lease, { mutate: () => undefined }); return report("cancelled", ended.ok ? ended.task.state : null, "the task was cancelled; nothing later was consumed"); }
    return report("fenced", null, "another owner holds the slice; nothing was written");
  };
  const ended = async (end: Parameters<ComponentResolutionTaskStore["endSlice"]>[1], detail: string): Promise<ResolutionSliceReport> => {
    const outcome = await store.endSlice(lease, end);
    if (!outcome.ok) return report(outcome.code === "COMPONENT_RESOLUTION_SLICE_FENCED" ? "fenced" : "failed", null, `the end commit was refused (${outcome.code}); the result was not consumed`);
    return report("ended", outcome.task.state, detail);
  };

  try {
    if (lease.kind === "acquire") {
      // ── 1. local search (reuse first) ──
      await store.commitProgress(lease, "local-search", (next, now) => { setStage(next, "local-search", "running", now, null); pushEvent(next, "local_search", now, `Searching the local library for a published revision of ${next.target.symbol.library}:${next.target.symbol.name} for ${next.instances.map((instance) => instance.refDes).join(", ")}.`); });
      const local = await searchForInstances(input.task, ports, [], supervisor.signal);
      const halt = await stopped();
      if (halt) return halt;
      if (local.shared) {
        const entry = local.shared;
        return ended({ mutate: (next, now) => {
          setStage(next, "local-search", "done", now, `an eligible published revision of the same exact part exists (${entry.exactRevision!.revisionId.slice(0, 40)}): reused, nothing downloaded`);
          for (const stage of ["source-selection", "retrieve", "validate", "handoff", "awaiting-publication"] as const) setStage(next, stage, "skipped", now, "an eligible published revision was reused");
          next.proposal = proposalOf(next, entry, now, true);
          setStage(next, "proposal", "done", now, `offer ${entry.name || entry.catalogPartId} revision ${entry.exactRevision!.revisionId.slice(0, 40)}`);
          next.state = "awaiting-review";
          pushEvent(next, "local_candidate_found", now, `An eligible published revision of the same part is already in the library (${entry.exactPart?.exactMpn ?? entry.name}); it is reused - nothing was downloaded.`);
          pushEvent(next, "proposal_ready", now, `Ready to offer the replacement for ${next.instances.map((instance) => instance.refDes).join(", ")}: review and apply it.`);
        } }, "an eligible revision of the same exact part was reused");
      }
      await store.commitProgress(lease, "local-searched", (next, now) => {
        setStage(next, "local-search", "done", now, local.alternatives.length > 0 ? `no published revision of this exact part; ${local.alternatives.length} other eligible local alternative(s) exist (${local.alternatives.map((entry) => entry.name || entry.catalogPartId).slice(0, 3).join(", ")}) - "Find a replacement in the library" offers them` : `no eligible local revision of this exact part${local.reasons.length ? ` (${local.reasons.slice(0, 3).join("; ")})` : ""}`);
        setStage(next, "source-selection", "running", now, null);
      });

      // ── 2. source selection, retrieve, validate ──
      const pipelinePorts = ports.pipeline(input.task);
      const pipeline = await runAcquisitionPipeline({ scope: lease.scope, target: input.task.target, assetKinds: input.task.request.assetKinds, ports: pipelinePorts, signal: supervisor.signal, checkpoint: async () => (await supervisor.boundary()) === "continue" });
      if (pipeline.kind === "cancelled") return (await stopped()) ?? report("cancelled", null, "the retrieval was stopped");
      const halt2 = await stopped();
      if (halt2) return halt2;
      if (pipeline.kind === "wait") {
        const retryAt = new Date(pipeline.retryAtMs).toISOString();
        return ended({ mutate: (next, now) => {
          next.attempts = [...next.attempts, ...pipeline.attempts].slice(-COMPONENT_RESOLUTION_POLICY.maxAttempts);
          setStage(next, "source-selection", "blocked", now, `waiting for the source until ${retryAt} (${pipeline.code})`);
          next.state = "waiting-for-resource";
          pushEvent(next, "waiting_resource", now, `The CAD source asked us to wait (${pipeline.code}); the next attempt is scheduled for ${retryAt} - nothing is retried before then.`, { retryAt });
        }, schedule: { kind: "acquire", notBefore: retryAt } }, `waiting until ${retryAt}`);
      }
      if (pipeline.kind === "blocked") {
        return ended({ mutate: (next, now) => {
          next.attempts = [...next.attempts, ...pipeline.attempts].slice(-COMPONENT_RESOLUTION_POLICY.maxAttempts);
          setStage(next, "source-selection", "blocked", now, `${pipeline.attempts.map(describe).join("; ") || "no source"}`);
          next.blocker = blockerOf(pipeline.code, pipeline.detail);
          next.state = pipeline.code === "parser_refused" ? "awaiting-review" : "waiting-for-resource";
          for (const attempt of pipeline.attempts) pushEvent(next, attempt.outcome === "skipped" ? "source_skipped" : "blocked", now, `${describe(attempt)} - ${attempt.detail}`.slice(0, 400));
          pushEvent(next, "blocked", now, `${next.blocker.message} ${next.blocker.remedy}`);
        } }, `blocked: ${pipeline.code}`);
      }
      const candidate = pipeline.candidate;
      return ended({ mutate: (next, now) => {
        next.attempts = [...next.attempts, ...pipeline.attempts].slice(-COMPONENT_RESOLUTION_POLICY.maxAttempts);
        for (const attempt of pipeline.attempts) pushEvent(next, attempt.outcome === "used" ? "source_selected" : "source_skipped", now, `${describe(attempt)} - ${attempt.detail}`.slice(0, 400));
        setStage(next, "source-selection", "done", now, `${CAD_SOURCE_REGISTRY[candidate.sourceId].displayName}${candidate.fixtureEvidence ? " (FIXTURE evidence)" : ""}`);
        setStage(next, "retrieve", "done", now, candidate.objects.map((object) => `${object.role} ${object.sha256.slice(0, 12)} (${object.byteLength} B) ${object.locator}`).join("; "));
        pushEvent(next, "retrieved", now, `Retrieved ${candidate.objects.length} object(s) from ${CAD_SOURCE_REGISTRY[candidate.sourceId].displayName}: ${candidate.objects.map((object) => `${object.role} sha256 ${object.sha256.slice(0, 12)}`).join(", ")}.`);
        pushEvent(next, "stored", now, "Stored the bytes and the parsed candidate durably with their provenance and licence.");
        next.candidateId = candidate.candidateId;
        next.candidate = candidateView(candidate);
        if (candidate.report.verdict === "validated") {
          setStage(next, "validate", "done", now, `validated (${candidate.report.digest.slice(0, 20)}); ${candidate.report.identity.kind === "generic" ? "a GENERIC KiCad candidate" : `exact ${candidate.report.identity.exactMpn}`}; unresolved: ${candidate.report.unresolved.length}`);
          setStage(next, "handoff", "running", now, "a person sends the package for component review");
          next.state = "awaiting-review";
          pushEvent(next, "validated", now, `Validation passed: symbol ${candidate.target.symbol.library}:${candidate.target.symbol.name}${candidate.footprint ? ` and footprint ${candidate.target.footprint!.library}:${candidate.target.footprint!.name}` : ""}, pin 1 / pad 1, pins to pads${candidate.pinTable ? " and the pin table" : ""}; ${candidate.report.unresolved.length} fact(s) stay for a person to confirm.`);
          pushEvent(next, "awaiting_handoff", now, "Awaiting a person to send the package for component review (a reviewer approves; a different administrator publishes).");
        } else {
          setStage(next, "validate", "blocked", now, `${candidate.report.verdict}: ${[...candidate.report.conflicts, ...candidate.report.checks.filter((check) => check.status === "fail").map((check) => check.detail)].slice(0, 3).join("; ")}`);
          next.blocker = blockerOf(candidate.report.verdict === "conflicting" ? "mapping_conflict" : "parser_refused", candidate.report.conflicts.slice(0, 3).join("; ") || null);
          next.state = "awaiting-review";
          pushEvent(next, "validation_failed", now, `Validation did not pass (${candidate.report.verdict}); nothing was guessed. ${next.blocker.remedy}`);
        }
      } }, `candidate ${candidate.report.verdict}`);
    }

    // ── recheck: the review and publication the handoff became ──
    const handoffId = input.task.handoff?.handoffId;
    if (!handoffId) return ended({ mutate: (next, now) => { next.state = "awaiting-review"; pushEvent(next, "publication_checked", now, "Nothing has been sent for review yet."); } }, "no handoff");
    const status = await ports.publicationOf(handoffId);
    const halt = await stopped();
    if (halt) return halt;
    if (!status) return ended({ mutate: (next, now) => { next.blocker = blockerOf("governance_unconfigured", null); next.state = "awaiting-review"; setStage(next, "awaiting-publication", "blocked", now, "no governance project is configured"); pushEvent(next, "blocked", now, `${next.blocker.message} ${next.blocker.remedy}`); } }, "governance unconfigured");
    if (status.status !== "published") {
      const terminal = status.status === "rejected" || status.status === "withdrawn" || status.status === "retired";
      const count = input.task.recheckCount + 1;
      const delay = Math.min(COMPONENT_RESOLUTION_POLICY.maxRecheckMs, COMPONENT_RESOLUTION_POLICY.firstRecheckMs * 2 ** Math.min(10, count));
      const again = !terminal && count < COMPONENT_RESOLUTION_POLICY.maxScheduledRechecks;
      return ended({ mutate: (next, now) => {
        next.recheckCount = count;
        next.publication = { status: status.status, requestId: status.requestId, revisionId: null, checkedAt: now };
        next.state = "awaiting-review";
        if (terminal) {
          next.blocker = blockerOf(status.status === "rejected" ? "review_rejected" : "review_withdrawn", status.reason);
          setStage(next, "awaiting-publication", "blocked", now, `the publication request is ${status.status}${status.reason ? `: ${status.reason}` : ""}`);
          pushEvent(next, "blocked", now, `${next.blocker.message} ${next.blocker.remedy}`);
        } else pushEvent(next, "publication_checked", now, status.status === "not-submitted" ? "Awaiting the publication request: a person submits the package in the governance project's review." : `The publication request is ${status.status}; ${again ? "checking again later" : "use Check again after the review"}.`);
      }, schedule: again ? { kind: "recheck", notBefore: new Date(ports.clock() + delay).toISOString() } : null }, `publication ${status.status}`);
    }
    const found = await searchForInstances(input.task, ports, status.linkedPartIds, supervisor.signal);
    const halt2 = await stopped();
    if (halt2) return halt2;
    const shared = found.shared ?? found.alternatives.find((entry) => entry.exactRevision?.revisionId === status.revisionId) ?? null;
    return ended({ mutate: (next, now) => {
      next.publication = { status: "published", requestId: status.requestId, revisionId: status.revisionId, checkedAt: now };
      setStage(next, "awaiting-publication", "done", now, `published as revision ${status.revisionId?.slice(0, 40) ?? "?"} by two people`);
      pushEvent(next, "published", now, `Published: revision ${status.revisionId?.slice(0, 40) ?? "?"} (a reviewer approved, a different administrator published).`);
      if (shared && shared.exactRevision) {
        next.proposal = proposalOf(next, shared, now, false);
        next.blocker = null;
        setStage(next, "proposal", "done", now, `M1's candidate search: ${shared.name || shared.catalogPartId} revision ${shared.exactRevision.revisionId.slice(0, 40)} is eligible for ${next.instances.map((instance) => instance.refDes).join(", ")}`);
        next.state = "awaiting-review";
        pushEvent(next, "proposal_ready", now, `The published part is an eligible replacement for ${next.instances.map((instance) => instance.refDes).join(", ")}: review and apply it.`);
      } else {
        next.blocker = blockerOf("not_resolvable", found.reasons.slice(0, 3).join("; ") || null);
        setStage(next, "proposal", "blocked", now, found.reasons.slice(0, 4).join("; ") || "no eligible revision");
        next.state = "awaiting-review";
        pushEvent(next, "blocked", now, `${next.blocker.message} ${next.blocker.remedy}`);
      }
    } }, shared ? "proposal ready" : "not resolvable");
  } catch (error) {
    // an unexpected failure: the lease lapses and the slice is retried (attempts are bounded at the claim)
    return report("failed", null, `the slice failed (${error instanceof Error ? error.name : "error"}); it is retried after its lease lapses`);
  }
}
