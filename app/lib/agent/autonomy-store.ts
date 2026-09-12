/**
 * [B18-A] The DURABLE agent autonomy store — the server-owned home of the
 * project's autonomy setting, built on the durable-workflow aggregate
 * `agent.autonomy-settings.v1` (the same substrate as the manufacturing
 * authority and release ledger):
 *
 *  - revisioned: the aggregate revision IS the setting revision; every write is
 *    compare-and-set on it (a concurrent change refuses `stale_revision`);
 *  - auditable: each accepted write appends one immutable record whose
 *    payload carries the change (who, from, to, when) and emits one outbox
 *    event `agent.autonomy-changed`; `changes()` reads the append-only history;
 *  - project-scoped: keyed by tenant + project (branch-independent);
 *  - digest-bound: a stored record whose digest or revision disagrees with its
 *    payload is refused, never trusted.
 *
 * Under the fixture runtime the durable repository is the in-memory one the
 * dev server hosts; in production it is PostgreSQL; without a database the
 * store is UNAVAILABLE and every caller fails closed to `proposal_only`.
 */
import { getDurableWorkflowRepository } from "../durable-workflow/runtime";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import { engineeringDigest } from "../engineering/stable";
import { AGENT_AUTONOMY_CHANGE_SCHEMA, defaultAutonomySetting, type AgentAutonomyChange, type AgentAutonomyScope, type AgentAutonomySetting } from "../engineering/permission-tiers";
import { AUTONOMY_CHANGES_LIMIT, refuseAutonomyWrite, type AgentAutonomyRepository, type AutonomyWriteRequest, type AutonomyWriteResult } from "./autonomy-settings";

export const AUTONOMY_AGGREGATE_TYPE = "agent.autonomy-settings.v1";
export const AUTONOMY_CHANGED_EVENT = "agent.autonomy-changed";
/** The setting is project-scoped (branch-independent): one sentinel branch in the durable scope. */
export const AUTONOMY_SCOPE_BRANCH = "project";

interface AutonomyPayload {
  setting: AgentAutonomySetting;
  /** The change that produced this revision (null only for a record written without a change — never by this store). */
  change: AgentAutonomyChange | null;
}

function workflowScope(scope: AgentAutonomyScope): DurableWorkflowScope {
  return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: AUTONOMY_SCOPE_BRANCH };
}

function aggregateKey(scope: AgentAutonomyScope): string {
  return durableWorkflowId("agent-autonomy", { tenantId: scope.tenantId, projectId: scope.projectId });
}

export function autonomyRecordDigest(payload: AutonomyPayload): string {
  return engineeringDigest({ schema: AUTONOMY_AGGREGATE_TYPE, payload });
}

export class DurableAgentAutonomyRepository implements AgentAutonomyRepository {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  private identity(scope: AgentAutonomyScope) {
    return durableAggregateIdentity(workflowScope(scope), AUTONOMY_AGGREGATE_TYPE, aggregateKey(scope));
  }

  async get(scope: AgentAutonomyScope): Promise<AgentAutonomySetting> {
    const head = await this.workflow.loadHead<AutonomyPayload>(this.identity(scope));
    if (!head) return defaultAutonomySetting(scope);
    const setting = head.payload.setting;
    if (!setting || setting.revision !== head.revision || setting.tenantId !== scope.tenantId || setting.projectId !== scope.projectId || autonomyRecordDigest(head.payload) !== head.recordDigest) {
      throw new Error("AGENT_AUTONOMY_RECORD_MISMATCH");
    }
    return structuredClone(setting);
  }

  async set(request: AutonomyWriteRequest): Promise<AutonomyWriteResult> {
    const current = await this.get(request.scope);
    const refusal = refuseAutonomyWrite(request, current);
    if (refusal) return refusal;
    if (current.mode === request.mode) return { ok: true, setting: current, change: null, unchanged: true };
    const revision = current.revision + 1;
    const setting: AgentAutonomySetting = { ...current, mode: request.mode, revision, updatedAt: request.at, updatedBy: { ...request.actor } };
    const change: AgentAutonomyChange = { schema: AGENT_AUTONOMY_CHANGE_SCHEMA, tenantId: request.scope.tenantId, projectId: request.scope.projectId, fromMode: current.mode, toMode: request.mode, revision, at: request.at, actor: { ...request.actor } };
    const payload: AutonomyPayload = { setting, change };
    const recordDigest = autonomyRecordDigest(payload);
    const scope = workflowScope(request.scope);
    const key = aggregateKey(request.scope);
    try {
      await this.workflow.commit({
        scope,
        scopeKey: durableScopeKey(scope, "agent-autonomy"),
        idempotencyKey: `agent-autonomy:${revision}:${recordDigest}`,
        operations: [{ aggregateType: AUTONOMY_AGGREGATE_TYPE, aggregateKey: key, expectedRevision: current.revision, payload, recordDigest }],
        outbox: [{ owner: { aggregateType: AUTONOMY_AGGREGATE_TYPE, aggregateKey: key }, eventType: AUTONOMY_CHANGED_EVENT, eventVersion: 1, topic: AUTONOMY_CHANGED_EVENT, payload: { tenantId: change.tenantId, projectId: change.projectId, fromMode: change.fromMode, toMode: change.toMode, revision, principalId: change.actor.principalId, membershipRevision: change.actor.membershipRevision, recordDigest } }],
        result: { revision, mode: request.mode, recordDigest },
        committedAt: request.at,
      });
    } catch (error) {
      // A concurrent writer won the compare-and-set: report the CURRENT setting, never a guess.
      const message = error instanceof Error ? error.message : String(error);
      if (/REVISION|CONFLICT|STALE/i.test(message)) {
        const latest = await this.get(request.scope);
        return { ok: false, code: "stale_revision", message: `The setting moved to revision ${latest.revision} while this change was in flight; re-read it and decide again.`, current: latest };
      }
      throw error;
    }
    const head = await this.workflow.loadHead<AutonomyPayload>(this.identity(request.scope));
    if (!head || head.recordDigest !== recordDigest || head.revision !== revision) throw new Error("AGENT_AUTONOMY_SAVE_UNVERIFIED");
    return { ok: true, setting: structuredClone(setting), change: structuredClone(change), unchanged: false };
  }

  async changes(scope: AgentAutonomyScope, limit = AUTONOMY_CHANGES_LIMIT): Promise<AgentAutonomyChange[]> {
    const records = await this.workflow.history<AutonomyPayload>(this.identity(scope));
    const trail = [...records]
      .sort((a, b) => a.revision - b.revision)
      .map((record) => record.payload.change)
      .filter((change): change is AgentAutonomyChange => Boolean(change));
    return trail.slice(-Math.max(1, Math.min(limit, AUTONOMY_CHANGES_LIMIT))).map((change) => structuredClone(change));
  }
}

// ── the server composition seam ─────────────────────────────────────────────

type Factory = () => AgentAutonomyRepository;
const productionFactory: Factory = () => new DurableAgentAutonomyRepository(getDurableWorkflowRepository());
let factory: Factory = productionFactory;

/** The route and the chat run resolve the store here; tests and the fixture runtime inject a repository. */
export function resolveAgentAutonomyRepository(): AgentAutonomyRepository {
  return factory();
}

export function setAgentAutonomyRepositoryFactory(next: Factory): void {
  factory = next;
}

export function resetAgentAutonomyRepositoryFactory(): void {
  factory = productionFactory;
}
