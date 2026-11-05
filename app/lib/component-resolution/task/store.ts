/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.4, design M2.3): the component-resolution task STORE over the injected durable repository
 * (the generation-task store's pattern and rules, app/lib/generation-task/store.ts; this module never imports the durable runtime):
 *
 *  - start / attach: the task id is derived from (scope, principal, instance ids, requirement digest, schematic base digest) - the same
 *    request on the same sheet ATTACHES; ONE commit writes head revision 1 and the first `acquire` slice's outbox effect (topic
 *    `component-resolution-slice`) under the idempotency key `start:<taskId>`;
 *  - reads are scoped by the trusted scope: an unknown id, a foreign scope's id and a malformed id are the SAME refusal;
 *  - slices: `claimSlices` claims outbox events of the topic, then CLAIMS the head (CAS: `fenceCounter + 1`, the owner with the lease
 *    token); every later commit of the slice continues ONLY while the head's pending slice is still this fence and token (else
 *    COMPONENT_RESOLUTION_SLICE_FENCED, nothing written) and the task is not cancelling; a slice's end commit clears its pending entry and
 *    schedules the next slice as an outbox effect of the SAME commit (S1 `availableAt` for a delay); `renewSlice` is the fenced S2 renewal,
 *    `releaseSlice` hands the slice back for immediate takeover;
 *  - control: cancel (a running slice is fenced out at its next boundary; a late result is never consumed), resume, recheck, the human
 *    handoff record and the applied-receipt record - each idempotent on its client action id.
 */
import { canonicalDurableScope, durableAggregateIdentity, durableScopeKey, durableWorkflowDigest, durableWorkflowId } from "../../durable-workflow/stable";
import type { DurableOutboxEffect, DurableOutboxEvent, DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import type { SchematicCanonicalMark } from "../../engineering/schematic-projection";
import type { ProjectRole } from "../../engineering/types";
import type { SchematicInstanceFacts } from "../instance-facts";
import type { AcquisitionTarget } from "../acquisition/candidate";
import { CAD_ACQUISITION_TASK_SCHEMA, type CadAcquisitionRequest, type CadAcquisitionTaskView } from "../../acquisition/cad-acquisition-contract";
import {
  COMPONENT_RESOLUTION_POLICY, COMPONENT_RESOLUTION_SCOPE_SUFFIX, COMPONENT_RESOLUTION_SLICE_CONTRACT, COMPONENT_RESOLUTION_SLICE_EVENT, COMPONENT_RESOLUTION_SLICE_ID, COMPONENT_RESOLUTION_SLICE_TOPIC,
  COMPONENT_RESOLUTION_TASK_AGGREGATE, COMPONENT_RESOLUTION_TASK_ID, blockerOf, emptyStages, isTerminalResolutionState, pushEvent, setStage,
  type ComponentResolutionSliceKind, type ComponentResolutionTaskHead,
} from "./contracts";

const CAS = "DW_OPTIMISTIC_REVISION_CONFLICT";
const isCas = (error: unknown): boolean => error instanceof Error && error.message === CAS;
const clone = <T>(value: T): T => structuredClone(value);
const iso = (ms: number): string => new Date(ms).toISOString();

type RenewingRepository = DurableWorkflowRepository & { renewOutboxLease: NonNullable<DurableWorkflowRepository["renewOutboxLease"]> };

export class ComponentResolutionStoreError extends Error {
  constructor(readonly code: string, detail = code) {
    super(detail);
    this.name = "ComponentResolutionStoreError";
  }
}

export interface ResolutionSliceLease { scope: DurableWorkflowScope; taskId: string; sliceId: string; kind: ComponentResolutionSliceKind; attempt: number; fence: number; workerId: string; leaseToken: string; eventId: string; leaseExpiresAt: string }
export type ResolutionClaimOutcome = { outcome: "claimed"; lease: ResolutionSliceLease; task: ComponentResolutionTaskHead } | { outcome: "stale-event" | "not-before" | "dropped" | "failed" | "cancelled"; eventId: string; taskId: string | null; code?: string };
/** Before any work of a slice: the initiator still holds an editor role on the task's project. */
export type ResolutionSliceRevalidator = (task: ComponentResolutionTaskHead) => Promise<{ ok: true } | { ok: false; failure: "authority_revoked" }>;
export type ResolutionCommitOutcome = { ok: true; task: ComponentResolutionTaskHead; revision: number; replayed: boolean } | { ok: false; code: "COMPONENT_RESOLUTION_TASK_NOT_FOUND" | "COMPONENT_RESOLUTION_SLICE_FENCED" | "COMPONENT_RESOLUTION_CANCEL_REQUESTED" | "COMPONENT_RESOLUTION_CONTENDED" | "COMPONENT_RESOLUTION_STATE_CONFLICT"; issue?: string };

export interface ResolutionStartInput {
  scope: DurableWorkflowScope;
  principal: { principalId: string; role: ProjectRole; membershipRevision: string | null; actorKind: "human" | "ai" };
  origin: "page" | "chat";
  request: CadAcquisitionRequest;
  base: { schematicDigest: string; headMark: SchematicCanonicalMark | null };
  target: AcquisitionTarget;
  instances: SchematicInstanceFacts[];
}

export interface ResolutionSliceEnd {
  mutate(next: ComponentResolutionTaskHead, now: string): void;
  /** the next slice, scheduled atomically with this end (`notBefore` later than now is its `availableAt`) */
  schedule?: { kind: ComponentResolutionSliceKind; notBefore?: string } | null;
}

export class ComponentResolutionTaskStore {
  private readonly repository: RenewingRepository;
  private readonly clock: () => number;
  private readonly leaseMs: number;

  constructor(options: { repository: DurableWorkflowRepository; clock?: () => number; leaseMs?: number }) {
    if (!options?.repository || typeof options.repository.renewOutboxLease !== "function") throw new ComponentResolutionStoreError("COMPONENT_RESOLUTION_STORE_UNAVAILABLE", "a durable repository with lease renewal is required");
    this.repository = options.repository as RenewingRepository;
    this.clock = options.clock ?? (() => Date.now());
    this.leaseMs = options.leaseMs ?? COMPONENT_RESOLUTION_POLICY.leaseMs;
  }

  private now(): string { return iso(this.clock()); }
  private scopeKey(scope: DurableWorkflowScope): string { return durableScopeKey(scope, COMPONENT_RESOLUTION_SCOPE_SUFFIX); }
  private identity(scope: DurableWorkflowScope, taskId: string) { return durableAggregateIdentity(scope, COMPONENT_RESOLUTION_TASK_AGGREGATE, taskId); }

  static taskIdFor(input: Pick<ResolutionStartInput, "scope" | "principal" | "request" | "base">): string {
    const scope = canonicalDurableScope(input.scope);
    return `cr-task:${durableWorkflowDigest({ scope, principal: input.principal.principalId, componentIds: [...input.request.componentIds].sort(), requirement: requirementDigest(input.request), base: input.base.schematicDigest }).slice(4, 36)}`;
  }

  private effect(head: ComponentResolutionTaskHead, sliceId: string, kind: ComponentResolutionSliceKind, availableAt?: string): DurableOutboxEffect {
    return { owner: { aggregateType: COMPONENT_RESOLUTION_TASK_AGGREGATE, aggregateKey: head.taskId }, eventType: COMPONENT_RESOLUTION_SLICE_EVENT, eventVersion: 1, topic: COMPONENT_RESOLUTION_SLICE_TOPIC, payload: { schema: COMPONENT_RESOLUTION_SLICE_CONTRACT, taskId: head.taskId, sliceId, kind }, idempotencyKey: `slice:${sliceId}`, ...(availableAt ? { availableAt } : {}) };
  }

  /** Schedule the next slice on `next` (mutates it) and return its outbox effect. */
  private schedule(next: ComponentResolutionTaskHead, kind: ComponentResolutionSliceKind, nowMs: number, notBefore?: string): DurableOutboxEffect {
    next.sliceCounter += 1;
    const sliceId = `${next.taskId}:s${next.sliceCounter}`;
    const at = notBefore && Date.parse(notBefore) > nowMs ? iso(Date.parse(notBefore)) : iso(nowMs);
    next.pending = { sliceId, kind, notBefore: at, owner: null };
    return this.effect(next, sliceId, kind, at > iso(nowMs) ? at : undefined);
  }

  // ── reads ──

  async get(scope: DurableWorkflowScope, taskId: unknown): Promise<{ task: ComponentResolutionTaskHead; revision: number } | null> {
    if (typeof taskId !== "string" || !COMPONENT_RESOLUTION_TASK_ID.test(taskId)) return null;
    const head = await this.repository.loadHead<ComponentResolutionTaskHead>(this.identity(scope, taskId));
    if (!head || head.payload.schema !== CAD_ACQUISITION_TASK_SCHEMA || head.payload.taskId !== taskId) return null;
    const own = canonicalDurableScope(scope);
    const stored = head.payload.scope;
    if (stored.tenantId !== own.tenantId || stored.projectId !== own.projectId || stored.branchId !== own.branchId) return null;
    return { task: clone(head.payload), revision: head.revision };
  }

  async list(scope: DurableWorkflowScope): Promise<ComponentResolutionTaskHead[]> {
    const heads = await this.repository.listHeads<ComponentResolutionTaskHead>({ aggregateType: COMPONENT_RESOLUTION_TASK_AGGREGATE, scope, limit: 500 });
    return heads.map((head) => clone(head.payload)).filter((task) => task.schema === CAD_ACQUISITION_TASK_SCHEMA).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.taskId.localeCompare(b.taskId));
  }

  // ── start / attach ──

  async start(input: ResolutionStartInput): Promise<{ ok: true; task: ComponentResolutionTaskHead; attached: boolean } | { ok: false; code: "COMPONENT_RESOLUTION_INVALID_REQUEST"; issue: string }> {
    if (input.instances.length === 0 || input.instances.some((instance) => !input.request.componentIds.includes(instance.componentId))) return { ok: false, code: "COMPONENT_RESOLUTION_INVALID_REQUEST", issue: "the instances are not the request's" };
    const scope = canonicalDurableScope(input.scope);
    const taskId = ComponentResolutionTaskStore.taskIdFor(input);
    const existing = await this.get(scope, taskId);
    if (existing) return { ok: true, task: existing.task, attached: true };
    const nowMs = this.clock();
    const now = iso(nowMs);
    const head: ComponentResolutionTaskHead = {
      schema: CAD_ACQUISITION_TASK_SCHEMA, taskId, scope, initiator: clone(input.principal), origin: input.origin,
      request: { ...clone(input.request), requirementDigest: requirementDigest(input.request) }, base: clone(input.base), target: clone(input.target), instances: clone(input.instances),
      state: "queued", stage: "local-search", stages: emptyStages(), attempts: [], candidateId: null, candidate: null, handoff: null, publication: null, proposal: null, applied: null, preflight: null, blocker: null,
      pending: null, sliceCounter: 0, fenceCounter: 0, recheckCount: 0, control: { cancel: null, applied: [] }, events: [], nextSeq: 1, createdAt: now, updatedAt: now,
    };
    pushEvent(head, "accepted", now, `Acquisition accepted for ${input.instances.map((instance) => instance.refDes).join(", ")} (${input.target.symbol.library}:${input.target.symbol.name}); a worker runs it in saved steps.`);
    const effect = this.schedule(head, "acquire", nowMs);
    try {
      await this.repository.commit({ scope, scopeKey: this.scopeKey(scope), idempotencyKey: `start:${taskId}`, operations: [{ aggregateType: COMPONENT_RESOLUTION_TASK_AGGREGATE, aggregateKey: taskId, expectedRevision: 0, payload: head }], outbox: [effect], result: { taskId }, committedAt: now });
    } catch (error) {
      if (!isCas(error)) throw error;
      const raced = await this.get(scope, taskId);
      if (raced) return { ok: true, task: raced.task, attached: true };
      throw error;
    }
    return { ok: true, task: head, attached: false };
  }

  // ── the CAS commit with the rebase rule ──

  /** Mutate the head under CAS; `mutate` returns null to refuse, or the effects to commit with it. Retries on a CAS conflict. */
  async commitHead(scope: DurableWorkflowScope, taskId: string, key: string, mutate: (current: ComponentResolutionTaskHead, nowMs: number) => { next: ComponentResolutionTaskHead; outbox?: DurableOutboxEffect[] } | { refuse: Exclude<ResolutionCommitOutcome, { ok: true }>["code"]; issue?: string } | { noop: true }): Promise<ResolutionCommitOutcome> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const read = await this.get(scope, taskId);
      if (!read) return { ok: false, code: "COMPONENT_RESOLUTION_TASK_NOT_FOUND" };
      const nowMs = this.clock();
      const outcome = mutate(clone(read.task), nowMs);
      if ("refuse" in outcome) return { ok: false, code: outcome.refuse, ...(outcome.issue ? { issue: outcome.issue } : {}) };
      if ("noop" in outcome) return { ok: true, task: read.task, revision: read.revision, replayed: true };
      outcome.next.updatedAt = iso(nowMs);
      try {
        const result = await this.repository.commit({ scope, scopeKey: this.scopeKey(scope), idempotencyKey: `${taskId}:${key}:${read.revision}`, operations: [{ aggregateType: COMPONENT_RESOLUTION_TASK_AGGREGATE, aggregateKey: taskId, expectedRevision: read.revision, payload: outcome.next }], outbox: outcome.outbox ?? [], result: { taskId }, committedAt: iso(nowMs) });
        const record = result.records.find((item) => item.aggregateKey === taskId);
        return { ok: true, task: clone((record?.payload as ComponentResolutionTaskHead) ?? outcome.next), revision: record?.revision ?? read.revision + 1, replayed: result.idempotent };
      } catch (error) {
        if (isCas(error)) continue;
        throw error;
      }
    }
    return { ok: false, code: "COMPONENT_RESOLUTION_CONTENDED" };
  }

  // ── slices ──

  async claimSlices(input: { workerId: string; limit: number; revalidate: ResolutionSliceRevalidator; scope?: DurableWorkflowScope }): Promise<ResolutionClaimOutcome[]> {
    const nowMs = this.clock();
    const events = await this.repository.claimOutbox({ workerId: input.workerId, now: iso(nowMs), leaseUntil: iso(nowMs + this.leaseMs), limit: Math.max(1, Math.min(10, input.limit)), topics: [COMPONENT_RESOLUTION_SLICE_TOPIC], ...(input.scope ? { scope: canonicalDurableScope(input.scope) } : {}) }); // [PR-L6, 2026-10-19] the worker's --scope (OD-253 item 6)
    const outcomes: ResolutionClaimOutcome[] = [];
    for (const event of events) outcomes.push(await this.claimOne(event, input.workerId, input.revalidate));
    return outcomes;
  }

  private async finish(event: DurableOutboxEvent, workerId: string, how: { terminal?: string; retryAt?: string } = {}): Promise<void> {
    const base = { scope: event.scope, eventId: event.eventId, workerId, leaseToken: event.leaseToken! };
    try {
      if (how.terminal) await this.repository.failOutbox({ ...base, errorCode: how.terminal, failedAt: this.now(), retryAt: this.now(), terminal: true });
      else if (how.retryAt) await this.repository.failOutbox({ ...base, errorCode: "COMPONENT_RESOLUTION_SLICE_NOT_YET", failedAt: this.now(), retryAt: how.retryAt, terminal: false });
      else await this.repository.completeOutbox({ ...base, completedAt: this.now() });
    } catch (error) {
      if (!(error instanceof Error && error.message === "DW_OUTBOX_LEASE_CONFLICT")) throw error;
    }
  }

  private async claimOne(event: DurableOutboxEvent, workerId: string, revalidate: ResolutionSliceRevalidator): Promise<ResolutionClaimOutcome> {
    const payload = event.payload as Record<string, unknown>;
    const taskId = typeof payload?.taskId === "string" && COMPONENT_RESOLUTION_TASK_ID.test(payload.taskId) ? payload.taskId : null;
    const sliceId = typeof payload?.sliceId === "string" && COMPONENT_RESOLUTION_SLICE_ID.test(payload.sliceId) ? payload.sliceId : null;
    if (!event.leaseToken || payload?.schema !== COMPONENT_RESOLUTION_SLICE_CONTRACT || !taskId || !sliceId || !sliceId.startsWith(`${taskId}:s`)) {
      if (event.leaseToken) await this.finish(event, workerId, { terminal: "COMPONENT_RESOLUTION_SLICE_EVENT_INVALID" });
      return { outcome: "dropped", eventId: event.eventId, taskId, code: "COMPONENT_RESOLUTION_SLICE_EVENT_INVALID" };
    }
    const attempt = event.attempts, leaseToken = event.leaseToken;
    const read = await this.get(event.scope, taskId);
    if (!read) { await this.finish(event, workerId, { terminal: "COMPONENT_RESOLUTION_TASK_NOT_FOUND" }); return { outcome: "dropped", eventId: event.eventId, taskId, code: "COMPONENT_RESOLUTION_TASK_NOT_FOUND" }; }
    const head = read.task;
    if (isTerminalResolutionState(head.state) || head.pending?.sliceId !== sliceId) { await this.finish(event, workerId); return { outcome: "stale-event", eventId: event.eventId, taskId }; }
    const nowMs = this.clock();
    if (head.control.cancel) {
      await this.commitHead(event.scope, taskId, `${sliceId}:a${attempt}:drop`, (current) => {
        if (current.pending?.sliceId !== sliceId) return { noop: true };
        current.pending = null; current.state = "cancelled";
        pushEvent(current, "cancelled", iso(nowMs), "The acquisition was stopped; the stored objects and the candidate are kept.");
        return { next: current };
      });
      await this.finish(event, workerId);
      return { outcome: "cancelled", eventId: event.eventId, taskId };
    }
    if (Date.parse(head.pending.notBefore) > nowMs) { await this.finish(event, workerId, { retryAt: head.pending.notBefore }); return { outcome: "not-before", eventId: event.eventId, taskId }; }
    const verdict = attempt - 1 >= COMPONENT_RESOLUTION_POLICY.maxAttemptsPerSlice ? { ok: false as const, failure: "platform" as const } : await revalidate(clone(head));
    if (!verdict.ok) {
      const revoked = verdict.failure === "authority_revoked";
      await this.commitHead(event.scope, taskId, `${sliceId}:a${attempt}:refuse`, (current) => {
        if (current.pending?.sliceId !== sliceId) return { noop: true };
        current.pending = null;
        current.state = "failed";
        current.blocker = revoked ? blockerOf("authority_revoked", null) : blockerOf("source_unavailable", "the slice failed repeatedly; the stored work is kept and Resume schedules it again");
        if (!revoked) current.state = "waiting-for-resource";
        pushEvent(current, revoked ? "failed" : "waiting_resource", iso(nowMs), revoked ? "The acquisition stopped: the requester no longer has access to this project." : "The acquisition slice failed repeatedly; it waits for Resume.");
        return { next: current };
      });
      await this.finish(event, workerId);
      return { outcome: "failed", eventId: event.eventId, taskId, code: revoked ? "authority_revoked" : "COMPONENT_RESOLUTION_ATTEMPTS_EXHAUSTED" };
    }
    const claimed = await this.commitHead(event.scope, taskId, `${sliceId}:a${attempt}:claim`, (current) => {
      if (current.pending?.sliceId !== sliceId) return { refuse: "COMPONENT_RESOLUTION_SLICE_FENCED", issue: "the slice is no longer pending" };
      current.fenceCounter += 1;
      current.pending = { ...current.pending, owner: { attempt, fence: current.fenceCounter, workerId, leaseToken, claimedAt: iso(nowMs) } };
      current.state = "running";
      pushEvent(current, "worker_claimed", iso(nowMs), `A worker started the ${current.pending.kind === "acquire" ? "acquisition" : "review re-check"} step (attempt ${attempt}).`, { kind: current.pending.kind, attempt });
      return { next: current };
    });
    if (!claimed.ok) { await this.finish(event, workerId); return { outcome: "stale-event", eventId: event.eventId, taskId, code: claimed.code }; }
    const owner = claimed.task.pending!.owner!;
    return { outcome: "claimed", task: claimed.task, lease: { scope: canonicalDurableScope(event.scope), taskId, sliceId, kind: claimed.task.pending!.kind, attempt, fence: owner.fence, workerId, leaseToken, eventId: event.eventId, leaseExpiresAt: event.leaseExpiresAt! } };
  }

  /** S2: extend this slice's outbox lease; a lapsed or re-claimed lease answers false and the slice must stop. */
  async renewSlice(lease: ResolutionSliceLease): Promise<boolean> {
    const nowMs = this.clock(), leaseUntil = iso(nowMs + this.leaseMs);
    try {
      await this.repository.renewOutboxLease({ scope: lease.scope, eventId: lease.eventId, workerId: lease.workerId, leaseToken: lease.leaseToken, now: iso(nowMs), leaseUntil });
      lease.leaseExpiresAt = leaseUntil;
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === "DW_OUTBOX_LEASE_LOST") return false;
      throw error;
    }
  }

  /** Is this slice still the owner, and was the task cancelled? */
  async pollControl(lease: ResolutionSliceLease): Promise<{ fenced: boolean; cancel: boolean }> {
    const read = await this.get(lease.scope, lease.taskId);
    if (!read) return { fenced: true, cancel: false };
    const owner = read.task.pending?.sliceId === lease.sliceId ? read.task.pending.owner : null;
    return { fenced: !owner || owner.fence !== lease.fence || owner.leaseToken !== lease.leaseToken, cancel: read.task.control.cancel !== null };
  }

  /** A fenced progress commit inside a running slice (refused once the fence moved or a cancel arrived). */
  async commitProgress(lease: ResolutionSliceLease, key: string, mutate: (next: ComponentResolutionTaskHead, now: string) => void): Promise<ResolutionCommitOutcome> {
    return this.commitHead(lease.scope, lease.taskId, `${lease.sliceId}:a${lease.attempt}:${key}`, (current, nowMs) => {
      const owner = current.pending?.sliceId === lease.sliceId ? current.pending.owner : null;
      if (!owner || owner.fence !== lease.fence || owner.leaseToken !== lease.leaseToken) return { refuse: "COMPONENT_RESOLUTION_SLICE_FENCED" };
      if (current.control.cancel) return { refuse: "COMPONENT_RESOLUTION_CANCEL_REQUESTED" };
      mutate(current, iso(nowMs));
      return { next: current };
    });
  }

  /** The slice's end: fenced, clears the pending slice, applies the end and schedules the next slice in the SAME commit. */
  async endSlice(lease: ResolutionSliceLease, end: ResolutionSliceEnd): Promise<ResolutionCommitOutcome> {
    const outcome = await this.commitHead(lease.scope, lease.taskId, `${lease.sliceId}:a${lease.attempt}:end`, (current, nowMs) => {
      const owner = current.pending?.sliceId === lease.sliceId ? current.pending.owner : null;
      if (!owner || owner.fence !== lease.fence || owner.leaseToken !== lease.leaseToken) return { refuse: "COMPONENT_RESOLUTION_SLICE_FENCED" };
      current.pending = null;
      if (current.control.cancel) {
        current.state = "cancelled";
        pushEvent(current, "cancelled", iso(nowMs), "The acquisition was stopped; the stored objects and the candidate are kept.");
        return { next: current };
      }
      end.mutate(current, iso(nowMs));
      const outbox = end.schedule ? [this.schedule(current, end.schedule.kind, nowMs, end.schedule.notBefore)] : [];
      return { next: current, outbox };
    });
    await this.completeEvent(lease);
    return outcome;
  }

  private async completeEvent(lease: ResolutionSliceLease): Promise<void> {
    try { await this.repository.completeOutbox({ scope: lease.scope, eventId: lease.eventId, workerId: lease.workerId, leaseToken: lease.leaseToken, completedAt: this.now() }); } catch (error) { if (!(error instanceof Error && error.message === "DW_OUTBOX_LEASE_CONFLICT")) throw error; }
  }

  /** Hand the slice back for immediate takeover (a shutdown): the owner is cleared, the event is retried now. */
  async releaseSlice(lease: ResolutionSliceLease): Promise<void> {
    await this.commitHead(lease.scope, lease.taskId, `${lease.sliceId}:a${lease.attempt}:release`, (current) => {
      const owner = current.pending?.sliceId === lease.sliceId ? current.pending.owner : null;
      if (!owner || owner.fence !== lease.fence) return { noop: true };
      current.pending = { ...current.pending!, owner: null };
      current.state = "queued";
      return { next: current };
    });
    try { await this.repository.failOutbox({ scope: lease.scope, eventId: lease.eventId, workerId: lease.workerId, leaseToken: lease.leaseToken, errorCode: "COMPONENT_RESOLUTION_SLICE_RELEASED", failedAt: this.now(), retryAt: this.now(), terminal: false }); } catch (error) { if (!(error instanceof Error && error.message === "DW_OUTBOX_LEASE_CONFLICT")) throw error; }
  }

  // ── control ──

  /** One idempotent control action of a person (or the agent's status read for `recheck`). */
  async control(input: { scope: DurableWorkflowScope; taskId: string; principalId: string; action: "cancel" | "resume" | "recheck" | "record-handoff" | "record-applied"; clientActionId: string; handoff?: NonNullable<CadAcquisitionTaskView["handoff"]>; applied?: NonNullable<CadAcquisitionTaskView["applied"]>; preflight?: NonNullable<CadAcquisitionTaskView["preflight"]> }): Promise<ResolutionCommitOutcome> {
    const key = `control:${input.action}:${durableWorkflowId("client-action", { principal: input.principalId, id: input.clientActionId }).slice(14)}`;
    return this.commitHead(input.scope, input.taskId, key, (current, nowMs) => {
      const now = iso(nowMs);
      if (current.control.applied.some((stamp) => stamp.key === key)) return { noop: true };
      current.control.applied = [...current.control.applied, { key, action: input.action, at: now }].slice(-32);
      const outbox: DurableOutboxEffect[] = [];
      switch (input.action) {
        case "cancel": {
          if (isTerminalResolutionState(current.state)) return { noop: true };
          current.control.cancel = { at: now, by: input.principalId };
          if (current.pending?.owner) current.state = "cancel-requested";
          else { current.pending = null; current.state = "cancelled"; pushEvent(current, "cancelled", now, "The acquisition was stopped; the stored objects and the candidate are kept."); }
          return { next: current };
        }
        case "resume": case "recheck": {
          if (isTerminalResolutionState(current.state)) return { noop: true };
          // a slice already running (or due) is not doubled; a waiting REVIEW re-check is brought forward (it calls no source), while a
          // source's retry time (a 429's Retry-After, an open breaker) is honoured - a person's Resume never hammers the source
          if (current.pending && (current.pending.owner || Date.parse(current.pending.notBefore) <= nowMs || current.pending.kind === "acquire")) return { noop: true };
          const kind: ComponentResolutionSliceKind = current.handoff && !current.proposal ? "recheck" : "acquire";
          if (input.action === "recheck" && kind !== "recheck") return { refuse: "COMPONENT_RESOLUTION_STATE_CONFLICT", issue: "nothing has been sent for review yet" };
          if (current.blocker?.code === "authority_revoked" || current.blocker?.code === "stale_base") return { refuse: "COMPONENT_RESOLUTION_STATE_CONFLICT", issue: current.blocker.message };
          if (current.proposal && !current.applied) return { noop: true };
          current.blocker = null;
          current.state = "queued";
          current.recheckCount = 0;
          outbox.push(this.schedule(current, kind, nowMs));
          return { next: current, outbox };
        }
        case "record-handoff": {
          if (!input.handoff || isTerminalResolutionState(current.state)) return { refuse: "COMPONENT_RESOLUTION_STATE_CONFLICT", issue: "the task cannot take a handoff now" };
          if (current.handoff?.handoffId === input.handoff.handoffId) return { noop: true };
          current.handoff = clone(input.handoff);
          setStage(current, "handoff", "done", now, `sent for component review as ${input.handoff.handoffId} by ${input.handoff.by}`);
          setStage(current, "awaiting-publication", "awaiting", now, "waiting for a reviewer to approve and a different administrator to publish"); // [PR-L/M integration, 2026-10-18] "awaiting", not "running": nothing runs while people review
          current.state = "awaiting-review";
          current.blocker = null;
          pushEvent(current, "handed_off", now, "Sent for component review: a reviewer approves and a different administrator publishes; the task checks again on its own.", { handoffId: input.handoff.handoffId });
          if (!current.pending) outbox.push(this.schedule(current, "recheck", nowMs, iso(nowMs + COMPONENT_RESOLUTION_POLICY.firstRecheckMs)));
          return { next: current, outbox };
        }
        case "record-applied": {
          if (!input.applied || !current.proposal) return { refuse: "COMPONENT_RESOLUTION_STATE_CONFLICT", issue: "no replacement was offered" };
          if (current.applied?.receiptId === input.applied.receiptId) return { noop: true }; if (isTerminalResolutionState(current.state)) return { refuse: "COMPONENT_RESOLUTION_STATE_CONFLICT", issue: "the task cannot take a receipt now" }; // [PR-L/M integration, 2026-10-18] M2-SEC-2: a cancelled, failed, stale or already-succeeded task never takes a (new) receipt; the same receipt again stays the no-op above (record-handoff's rule)
          current.applied = clone(input.applied);
          setStage(current, "applied", "done", now, `receipt ${input.applied.receiptId}; schematic ${input.applied.schematicDigestAfter}`);
          pushEvent(current, "applied", now, `The replacement was committed (receipt ${input.applied.receiptId.slice(0, 40)}).`);
          if (input.preflight) {
            current.preflight = clone(input.preflight);
            setStage(current, "preflight", "done", now, input.preflight.unresolvedCount === 0 ? "Prepare PCB preflight: no unresolved instance" : `Prepare PCB preflight: ${input.preflight.unresolvedCount} unresolved (${input.preflight.unresolvedRefDes.join(", ")})`);
            pushEvent(current, "preflight", now, input.preflight.unresolvedCount === 0 ? "Updated Prepare PCB preflight: no unresolved instance remains." : `Updated Prepare PCB preflight: ${input.preflight.unresolvedRefDes.join(", ")} still unresolved.`, { unresolved: input.preflight.unresolvedCount });
          }
          current.state = "succeeded";
          return { next: current };
        }
      }
    });
  }
}

/** The requirement's digest (the start's idempotency identity). */
export function requirementDigest(request: CadAcquisitionRequest): string {
  return durableWorkflowDigest({ requirement: request.requirement, assetKinds: [...request.assetKinds].sort() });
}
