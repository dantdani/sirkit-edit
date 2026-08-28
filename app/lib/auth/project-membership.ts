/**
 * B16.0 — the authoritative project-membership model.
 *
 * A human's project ROLE is derived here from server-owned storage, never
 * from a client header and never from user-editable JWT `user_metadata`
 * (which an authenticated user can rewrite to escalate — see the Supabase
 * RLS guidance). Membership is keyed on `(tenantId, projectId,
 * authenticatedUserId)` and is unique per that triple.
 *
 * Requirements enforced here: unique membership; explicit mapping from a
 * stored membership role to Sirkit's `ProjectRole`; revoked membership fails
 * immediately; cross-tenant / cross-project access refuses (a lookup for a
 * foreign tenant/project simply returns null → 403 upstream); no implicit
 * first-user administrator (nothing grants membership here); no browser-
 * supplied role.
 */

import { engineeringDigest } from "../engineering/stable";
import type { ProjectRole } from "../engineering/types";

/** The membership roles stored in the authoritative table. They map 1:1 to a
 *  subset of `ProjectRole` via `PROJECT_ROLE_FROM_MEMBERSHIP`. */
export type MembershipRole =
  | "viewer"
  | "commenter"
  | "editor"
  | "reviewer"
  | "admin";

/** Explicit membership-role → Sirkit ProjectRole mapping. The stored role is
 *  a narrow, durable vocabulary; the engineering ProjectRole is derived from
 *  it deterministically. A stored role outside this table yields no role
 *  (fail closed). */
export const PROJECT_ROLE_FROM_MEMBERSHIP: Record<MembershipRole, ProjectRole> = {
  viewer: "viewer",
  commenter: "commenter",
  editor: "pcb_editor",
  reviewer: "reviewer",
  admin: "project_admin",
};

export function projectRoleFromMembership(role: string): ProjectRole | null {
  return (PROJECT_ROLE_FROM_MEMBERSHIP as Record<string, ProjectRole>)[role] ?? null;
}

export interface ProjectMembershipRecord {
  tenantId: string;
  projectId: string;
  /** The authenticated user id (Supabase user id in production). */
  userId: string;
  role: MembershipRole;
  /** Active memberships authorize; revoked ones fail immediately. */
  state: "active" | "revoked";
  /** Monotonic membership version — the derived context's
   *  `membershipRevision` is computed from this so a role change or
   *  revocation retires bound proposals/approvals. */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** The actor that last changed this membership (audit). */
  auditActorId: string;
}

/** A membership version key an approval/proposal binds to — changes on any
 *  role change or revocation. */
export function membershipRevisionOf(record: ProjectMembershipRecord): string {
  return `mbr1-${engineeringDigest({
    schema: "sirkit.project-membership-revision.v1",
    tenantId: record.tenantId,
    projectId: record.projectId,
    userId: record.userId,
    role: record.role,
    state: record.state,
    version: record.version,
  }).slice(5, 21)}`;
}

/** The authoritative lookup — returns the membership for a principal in a
 *  project, or null when there is no ACTIVE membership (missing, revoked,
 *  cross-tenant, or cross-project all fail closed as null). */
export interface ProjectMembershipRepository {
  /** Load the ACTIVE membership for `(tenantId, projectId, userId)`, or null.
   *  Implementations MUST return null for a revoked/absent/foreign record —
   *  they never widen. */
  loadActiveMembership(input: { tenantId: string; projectId: string; userId: string }): Promise<ProjectMembershipRecord | null>;
}

/**
 * In-memory repository for tests and for the local_dev fixed principal.
 * NEVER used in production (the production adapter reads durable storage).
 */
export class InMemoryProjectMembershipRepository implements ProjectMembershipRepository {
  private readonly records = new Map<string, ProjectMembershipRecord>();
  private key(tenantId: string, projectId: string, userId: string): string {
    return JSON.stringify([tenantId, projectId, userId]);
  }
  set(record: ProjectMembershipRecord): void {
    this.records.set(this.key(record.tenantId, record.projectId, record.userId), { ...record });
  }
  async loadActiveMembership(input: { tenantId: string; projectId: string; userId: string }): Promise<ProjectMembershipRecord | null> {
    const record = this.records.get(this.key(input.tenantId, input.projectId, input.userId));
    if (!record || record.state !== "active") return null;
    return { ...record };
  }
}

/** The fixed local-development principal id and its single admin membership.
 *  Explicitly a development identity — never production authentication. */
export const LOCAL_DEV_PRINCIPAL_ID = "local-dev-principal";
export const LOCAL_DEV_SESSION_ID = "local-dev-session";

export function localDevMembership(input: { tenantId: string; projectId: string }): ProjectMembershipRecord {
  return {
    tenantId: input.tenantId,
    projectId: input.projectId,
    userId: LOCAL_DEV_PRINCIPAL_ID,
    role: "admin",
    state: "active",
    version: 1,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    auditActorId: "local-dev",
  };
}

/** The local_dev repository — the fixed local principal is `admin` on any
 *  project it selects. This is truthful ONLY because local_dev is not
 *  production authentication (a visible banner and truthful diagnostics say
 *  so). It is never reachable in production. */
export class LocalDevProjectMembershipRepository implements ProjectMembershipRepository {
  async loadActiveMembership(input: { tenantId: string; projectId: string; userId: string }): Promise<ProjectMembershipRecord | null> {
    if (input.userId !== LOCAL_DEV_PRINCIPAL_ID) return null;
    return localDevMembership({ tenantId: input.tenantId, projectId: input.projectId });
  }
}
