/**
 * B16.0.1 §F — the ONE family-neutral apply-time membership reauthorization
 * boundary.
 *
 * All three human-approved apply flows (B12 schematic tier-1, B14 component
 * replacement, B15 bounded PCB edit) consult the SAME narrow server endpoint
 * (`/api/pcb/apply-authorization` — historically named for the first family it
 * served; it reports project membership evidence, nothing PCB-specific)
 * immediately before minting their one-shot apply capability. The endpoint:
 *
 *  - performs NO mutation;
 *  - accepts NO role, actor-kind, or membership claim (identity is derived
 *    server-side from the cookie session by `resolveTrustedRequestContext`);
 *  - is same-origin protected;
 *  - returns bounded authorization evidence only (never a token or secret);
 *  - is never callable by the provider/tool gateway (import gates pin the
 *    client factory's importers to the trusted apply controllers).
 *
 * The caller compares the LIVE evidence against the proposal's sealed §E
 * authorization binding via `evaluateMembershipReauthorization` and refuses
 * the apply on ANY divergence — so a logged-out, replaced, downgraded, or
 * revoked author, or a membership whose revision moved since sealing, can
 * never apply an already-sealed proposal.
 */

import type { ProjectRole } from "../engineering/types";

/** The generic sealed authorization identity every §E binding carries. */
export interface MembershipAuthorizationIdentity {
  principalId: string;
  membershipRevision: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  requiredApplyRole: ProjectRole;
}

export interface MembershipReauthorizationRequest {
  scope: { tenantId: string; projectId: string; branchId: string };
  proposalId: string;
  signal?: AbortSignal;
}

/** The live membership snapshot, or a fail-closed refusal. */
export type MembershipReauthorization =
  | {
      ok: true;
      principalId: string;
      role: ProjectRole;
      membershipRevision: string;
      scope: { tenantId: string; projectId: string; branchId: string };
    }
  | { ok: false; code: string; detail: string };

/** The one narrow reauthorization step. Same-origin, read-only, no mutation. */
export type MembershipReauthorizer = (request: MembershipReauthorizationRequest) => Promise<MembershipReauthorization>;

export interface MembershipReauthorizationDenial {
  code:
    | "membership-unavailable"
    | "principal-changed"
    | "scope-changed"
    | "role-insufficient"
    | "required-role-unknown"
    | "membership-changed";
  detail: string;
}

/**
 * [B16.0.2 §F] the EXPLICIT accepted-role mapping for a sealed
 * `requiredApplyRole`. There is deliberately NO general role ordering: each
 * required role names exactly the live roles that satisfy it, and an unknown
 * required role accepts NOTHING (fail closed). Gate-pinned.
 */
export const ACCEPTED_LIVE_ROLES_FOR_REQUIRED_APPLY_ROLE: Readonly<Partial<Record<ProjectRole, readonly ProjectRole[]>>> = Object.freeze({
  project_admin: Object.freeze(["project_admin"]) as readonly ProjectRole[],
  pcb_editor: Object.freeze(["pcb_editor", "project_admin"]) as readonly ProjectRole[],
});

/** The live roles a sealed required role accepts — empty for an unknown role. */
export function acceptedLiveRolesFor(requiredApplyRole: string): readonly ProjectRole[] {
  return (ACCEPTED_LIVE_ROLES_FOR_REQUIRED_APPLY_ROLE as Record<string, readonly ProjectRole[] | undefined>)[requiredApplyRole] ?? [];
}

/**
 * Compare a LIVE reauthorization against a sealed authorization identity.
 * Returns null (authorized) or the exact denial. Fail-closed: any uncertainty
 * about the live membership refuses. [B16.0.2 §F] BOTH the family-permitted
 * apply roles AND the sealed `requiredApplyRole` (via the explicit accepted-
 * role mapping) must admit the live role; an unknown required role refuses.
 */
export function evaluateMembershipReauthorization(
  binding: MembershipAuthorizationIdentity,
  live: MembershipReauthorization,
  applyRoles: readonly ProjectRole[],
): MembershipReauthorizationDenial | null {
  if (!live.ok) {
    return { code: "membership-unavailable", detail: live.detail || "The live project membership could not be reauthorized." };
  }
  if (live.principalId !== binding.principalId) {
    return { code: "principal-changed", detail: "The authenticated principal is no longer the one the proposal was authorized for." };
  }
  if (live.scope.tenantId !== binding.tenantId || live.scope.projectId !== binding.projectId || live.scope.branchId !== binding.branchId) {
    return { code: "scope-changed", detail: "The live project scope no longer matches the proposal's authorization scope." };
  }
  const acceptedForRequired = acceptedLiveRolesFor(binding.requiredApplyRole);
  if (acceptedForRequired.length === 0) {
    return { code: "required-role-unknown", detail: "The proposal's sealed required apply role is not a recognized role; it cannot be applied." };
  }
  if (!applyRoles.includes(live.role)) {
    return { code: "role-insufficient", detail: `Role ${live.role} may not apply this proposal; reapproval by an editor is required.` };
  }
  if (!acceptedForRequired.includes(live.role)) {
    return { code: "role-insufficient", detail: `Role ${live.role} does not satisfy the proposal's required apply role (${binding.requiredApplyRole}).` };
  }
  if (live.membershipRevision !== binding.membershipRevision) {
    return { code: "membership-changed", detail: "The project membership changed since the proposal was sealed; reapproval is required." };
  }
  return null;
}

/** The one narrow same-origin endpoint every production reauthorizer calls. */
export const MEMBERSHIP_AUTHORIZATION_ENDPOINT = "/api/pcb/apply-authorization" as const;

/**
 * The PRODUCTION reauthorizer: a same-origin POST asking the server to reload
 * the caller's LIVE membership for the proposal's project. Sends no authority;
 * reads only the bounded snapshot back. Any non-200, malformed body, network
 * error, or abort fails CLOSED to `{ ok: false }` so the apply refuses.
 */
export function createMembershipReauthorizer(): MembershipReauthorizer {
  return async (request: MembershipReauthorizationRequest): Promise<MembershipReauthorization> => {
    try {
      const response = await fetch(MEMBERSHIP_AUTHORIZATION_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: request.scope, proposalId: request.proposalId }),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (!response.ok) {
        return { ok: false, code: `http-${response.status}`, detail: "The reauthorization endpoint refused the request." };
      }
      const body: unknown = await response.json();
      return parseMembershipReauthorization(body);
    } catch {
      return { ok: false, code: "unreachable", detail: "The reauthorization endpoint could not be reached." };
    }
  };
}

/** Parse + validate the endpoint's response body. Fail-closed on any surprise. */
export function parseMembershipReauthorization(body: unknown): MembershipReauthorization {
  if (typeof body !== "object" || body === null) return { ok: false, code: "malformed", detail: "The reauthorization response was not an object." };
  const record = body as Record<string, unknown>;
  if (record.ok !== true) {
    const code = typeof record.code === "string" ? record.code : "denied";
    const detail = typeof record.detail === "string" ? record.detail : "The reauthorization was denied.";
    return { ok: false, code, detail };
  }
  const scope = record.scope;
  if (
    typeof record.principalId !== "string" || record.principalId.length === 0
    || typeof record.role !== "string" || record.role.length === 0
    || typeof record.membershipRevision !== "string" || record.membershipRevision.length === 0
    || typeof scope !== "object" || scope === null
  ) {
    return { ok: false, code: "malformed", detail: "The reauthorization response was missing required fields." };
  }
  const s = scope as Record<string, unknown>;
  if (typeof s.tenantId !== "string" || typeof s.projectId !== "string" || typeof s.branchId !== "string") {
    return { ok: false, code: "malformed", detail: "The reauthorization response scope was malformed." };
  }
  return {
    ok: true,
    principalId: record.principalId,
    role: record.role as ProjectRole,
    membershipRevision: record.membershipRevision,
    scope: { tenantId: s.tenantId, projectId: s.projectId, branchId: s.branchId },
  };
}
