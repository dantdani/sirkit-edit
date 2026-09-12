/**
 * [B18-B] The request-grammar constants the two grant routes share.
 *
 * Authority-shaped keys are refused BY NAME on every grant request: nothing
 * in a body can name an actor, role, capability, scope, decision, explicitness
 * or a grant's binding — those come only from the trusted session and the
 * stored grant.
 */
export const EXECUTION_GRANT_AUTHORITY_SHAPED_KEYS: ReadonlySet<string> = new Set([
  "actor", "actorId", "actorKind", "role", "principalId", "membershipRevision", "sessionIdentity",
  "capability", "capabilities", "authority", "approval", "approvals", "approved",
  "tenantId", "projectId", "branchId", "scope",
  "nonce", "decision", "explicit", "explicitUserRequest", "autonomy", "tier", "binding", "state", "expiresAt", "issuedAt",
]);

/** Every digest a grant request may carry is an engineering digest (`eng1-` + 16 hex). */
export const ENGINEERING_DIGEST_PATTERN = /^eng1-[0-9a-f]{16}$/;
