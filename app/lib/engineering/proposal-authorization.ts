/**
 * B16.0.1 §E — the closed authorization binding sealed into every SCHEMATIC
 * sealed-proposal family (tier-1 and component replacement; the bounded PCB
 * proposal carries its own structurally identical binding in
 * `app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts`).
 *
 * The binding makes the verified principal AND the membership revision the
 * role was resolved at LOAD-BEARING inside the proposal identity (covered by
 * each family's whole-body identity digest): the apply-time reauthorization
 * (§F, `app/lib/project/membership-reauthorization.ts`) reloads the live
 * membership and refuses the apply if the principal changed, the role is no
 * longer an apply role, the membership revision moved, or the project scope
 * differs — so a revoked, downgraded, or logged-out author can never apply an
 * already-sealed proposal.
 *
 * It is NEVER caller-supplied on any provider/tool surface: the sealers
 * derive `principalId` from the server-verified effective actor and refuse a
 * binding whose scope disagrees with the proposal scope.
 */

import type { ProjectRole } from "./types";

export const SCHEMATIC_PROPOSAL_AUTHORIZATION_SCHEMA = "sirkit.schematic-proposal-authorization.v1" as const;

/** The roles that may APPLY a schematic proposal (a viewer/commenter never can). */
export const SCHEMATIC_APPLY_ROLES: readonly ProjectRole[] = ["pcb_editor", "project_admin"];

/** The revision sealed when no verified membership revision is supplied (the
 *  local-only build); apply-time reauthorization then succeeds only when the
 *  live membership also reads this sentinel. */
export const UNVERIFIED_MEMBERSHIP_REVISION = "membership:unverified" as const;

export interface SchematicProposalAuthorizationBinding {
  authorizationSchema: typeof SCHEMATIC_PROPOSAL_AUTHORIZATION_SCHEMA;
  /** The verified principal id the proposal was authorized for. */
  principalId: string;
  /** The membership revision the principal's role was resolved at. */
  membershipRevision: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  /** The minimum role required to APPLY — one of SCHEMATIC_APPLY_ROLES. */
  requiredApplyRole: ProjectRole;
}

const BINDING_KEYS = ["authorizationSchema", "principalId", "membershipRevision", "tenantId", "projectId", "branchId", "requiredApplyRole"] as const;
const BOUNDED_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Exact closed shape + bounded fields + a permitted apply role. */
export function isWellFormedAuthorizationBinding(value: unknown): value is SchematicProposalAuthorizationBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== BINDING_KEYS.length) return false;
  for (const key of BINDING_KEYS) if (!(key in record)) return false;
  if (record.authorizationSchema !== SCHEMATIC_PROPOSAL_AUTHORIZATION_SCHEMA) return false;
  for (const key of ["principalId", "membershipRevision", "tenantId", "projectId", "branchId"] as const) {
    if (typeof record[key] !== "string" || !BOUNDED_ID.test(record[key] as string)) return false;
  }
  return (SCHEMATIC_APPLY_ROLES as readonly string[]).includes(record.requiredApplyRole as string);
}

/**
 * Build the binding from server-verified facts. `principalId` is ALWAYS the
 * verified effective actor and the scope is the proposal scope — a caller can
 * choose only the membership revision (its real server-derived value, or the
 * unverified sentinel) and the required apply role.
 */
export function buildAuthorizationBinding(input: {
  principalId: string;
  membershipRevision?: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  requiredApplyRole?: ProjectRole;
}): SchematicProposalAuthorizationBinding {
  return {
    authorizationSchema: SCHEMATIC_PROPOSAL_AUTHORIZATION_SCHEMA,
    principalId: input.principalId,
    membershipRevision: input.membershipRevision ?? UNVERIFIED_MEMBERSHIP_REVISION,
    tenantId: input.scope.tenantId,
    projectId: input.scope.projectId,
    branchId: input.scope.branchId,
    requiredApplyRole: input.requiredApplyRole ?? "pcb_editor",
  };
}
