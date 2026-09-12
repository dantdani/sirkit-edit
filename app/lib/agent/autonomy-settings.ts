/**
 * [B18-A] The project's agent AUTONOMY SETTING — server-owned, project-scoped,
 * membership-authorized, revisioned and auditable.
 *
 *  - Reads return the default (`proposal_only`, revision 0) when nothing was
 *    ever written; a missing row is never an error and never "execute".
 *  - Writes are compare-and-set on the setting revision (`expectedRevision`),
 *    authorized against the TRUSTED actor's role (project administrators
 *    only), and produce one audit change record per accepted write. Setting
 *    the mode that is already current is a no-op (no revision bump, no
 *    change record).
 *  - Nothing in a request body, a tool argument or a model output can assert a
 *    mode: the route derives the actor from `resolveTrustedRequestContext` and
 *    passes only the requested mode + expected revision.
 *
 * `InMemoryAgentAutonomyRepository` is the reference implementation (tests,
 * the fixture runtime, local development); the Postgres repository mirrors
 * its exact semantics over the `agent_autonomy_settings` /
 * `agent_autonomy_changes` tables.
 */
import { AGENT_AUTONOMY_CHANGE_SCHEMA, canChangeAutonomy, defaultAutonomySetting, isAutonomyMode, type AgentAutonomyActor, type AgentAutonomyChange, type AgentAutonomyScope, type AgentAutonomySetting, type AutonomyMode } from "../engineering/permission-tiers";

export const AUTONOMY_WRITE_REFUSALS = ["forbidden", "stale_revision", "invalid_mode", "unavailable"] as const;
export type AutonomyWriteRefusalCode = (typeof AUTONOMY_WRITE_REFUSALS)[number];

export interface AutonomyWriteRequest {
  scope: AgentAutonomyScope;
  mode: AutonomyMode;
  /** The revision the caller read; a mismatch refuses `stale_revision` with the current setting. */
  expectedRevision: number;
  actor: AgentAutonomyActor;
  at: string;
}

export type AutonomyWriteResult =
  | { ok: true; setting: AgentAutonomySetting; change: AgentAutonomyChange | null; unchanged: boolean }
  | { ok: false; code: AutonomyWriteRefusalCode; message: string; current: AgentAutonomySetting | null };

export interface AgentAutonomyRepository {
  /** The current setting, or the default when none was ever written. */
  get(scope: AgentAutonomyScope): Promise<AgentAutonomySetting>;
  /** Compare-and-set write by a project administrator; one audit change per accepted write. */
  set(request: AutonomyWriteRequest): Promise<AutonomyWriteResult>;
  /** The audit trail, oldest first (bounded by the implementation). */
  changes(scope: AgentAutonomyScope, limit?: number): Promise<AgentAutonomyChange[]>;
}

export const AUTONOMY_CHANGES_LIMIT = 200;

export function autonomyScopeKey(scope: AgentAutonomyScope): string {
  return `${scope.tenantId}/${scope.projectId}`;
}

/** The shared authorization + validation prelude every implementation runs BEFORE touching storage. */
export function refuseAutonomyWrite(request: AutonomyWriteRequest, current: AgentAutonomySetting): AutonomyWriteResult | null {
  if (!isAutonomyMode(request.mode)) return { ok: false, code: "invalid_mode", message: "mode must be proposal_only or execute_explicit_tier1.", current };
  if (!canChangeAutonomy(request.actor.role)) return { ok: false, code: "forbidden", message: `Role ${request.actor.role} may not change the project's agent autonomy setting; a project administrator must.`, current };
  if (!Number.isInteger(request.expectedRevision) || request.expectedRevision !== current.revision) {
    return { ok: false, code: "stale_revision", message: `The setting is at revision ${current.revision}, not ${request.expectedRevision}; re-read it and decide again.`, current };
  }
  return null;
}

export class InMemoryAgentAutonomyRepository implements AgentAutonomyRepository {
  private readonly settings = new Map<string, AgentAutonomySetting>();
  private readonly audit = new Map<string, AgentAutonomyChange[]>();

  async get(scope: AgentAutonomyScope): Promise<AgentAutonomySetting> {
    const found = this.settings.get(autonomyScopeKey(scope));
    return found ? { ...found } : defaultAutonomySetting(scope);
  }

  async set(request: AutonomyWriteRequest): Promise<AutonomyWriteResult> {
    const current = await this.get(request.scope);
    const refusal = refuseAutonomyWrite(request, current);
    if (refusal) return refusal;
    if (current.mode === request.mode) return { ok: true, setting: current, change: null, unchanged: true };
    const revision = current.revision + 1;
    const setting: AgentAutonomySetting = { ...current, mode: request.mode, revision, updatedAt: request.at, updatedBy: { ...request.actor } };
    const change: AgentAutonomyChange = { schema: AGENT_AUTONOMY_CHANGE_SCHEMA, tenantId: request.scope.tenantId, projectId: request.scope.projectId, fromMode: current.mode, toMode: request.mode, revision, at: request.at, actor: { ...request.actor } };
    const key = autonomyScopeKey(request.scope);
    this.settings.set(key, setting);
    const trail = this.audit.get(key) ?? [];
    trail.push(change);
    while (trail.length > AUTONOMY_CHANGES_LIMIT) trail.shift();
    this.audit.set(key, trail);
    return { ok: true, setting: { ...setting }, change: { ...change }, unchanged: false };
  }

  async changes(scope: AgentAutonomyScope, limit = AUTONOMY_CHANGES_LIMIT): Promise<AgentAutonomyChange[]> {
    const trail = this.audit.get(autonomyScopeKey(scope)) ?? [];
    return trail.slice(-Math.max(1, Math.min(limit, AUTONOMY_CHANGES_LIMIT))).map((change) => ({ ...change }));
  }
}
