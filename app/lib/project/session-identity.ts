/**
 * B16.0.2 §E — the interactive composition root's session identity source.
 *
 * The schematic page seals tier-1 proposals CLIENT-side (the interactive
 * path), so it needs the verified principal + membership revision to bind
 * (§E of B16.0.1). R6 (B16.0.1 gap): the previous design primed a cache
 * that had ZERO production callers and fell back SYNCHRONOUSLY to the
 * deterministic local-dev identity — so a production proposal sealed before
 * live identity was loaded bound to `local-dev-principal` and was GUARANTEED
 * to fail apply-time reauthorization: a proposal the visible user could
 * never apply.
 *
 * This module replaces that with a REQUEST-OWNED, ASYNC, TYPED identity load
 * for the EXACT current tenant/project/branch:
 *
 *  - `loadSessionIdentity(scope, { signal })` asks the ONE narrow, same-origin,
 *    read-only membership endpoint (`/api/pcb/apply-authorization`) who the
 *    caller is for exactly this scope and returns a typed result — the live
 *    server-derived principal / role / membership revision, or a typed
 *    refusal. There is NO fallback identity of any kind: no local-dev
 *    principal, no cached guess, no browser-derived value. Local development
 *    obtains its deterministic identity through the SAME server boundary
 *    (the server's local_dev identity provider answers there), never through
 *    a client-side constant.
 *  - The load is bound to the caller's async scope: an `AbortSignal` from the
 *    `ProjectAsyncScope` cancels it on project switch / logout / unmount, and
 *    the result carries the scope it answered for so a caller can refuse a
 *    late completion for a different scope.
 *  - `sessionAuthorizationBindingFrom(identity, scope)` builds the §E binding
 *    ONLY from a successful load whose scope matches; it throws on any
 *    disagreement (a programming error, never a widened seal).
 *
 * The page therefore NEVER creates a proposal without live identity: when the
 * load fails it shows `SESSION_IDENTITY_UNAVAILABLE_MESSAGE` (sign in / retry)
 * and creates nothing.
 */

import { buildAuthorizationBinding, type SchematicProposalAuthorizationBinding } from "../engineering/proposal-authorization";
import type { ProjectRole } from "../engineering/types";
import { createMembershipReauthorizer, type MembershipReauthorization, type MembershipReauthorizer } from "./membership-reauthorization";

export interface SessionIdentityScope { tenantId: string; projectId: string; branchId: string }

export type SessionIdentityLoad =
  | {
      ok: true;
      principalId: string;
      role: ProjectRole;
      membershipRevision: string;
      /** The scope the server answered for (always equal to the requested scope). */
      scope: SessionIdentityScope;
    }
  | {
      ok: false;
      code: "unauthenticated" | "forbidden" | "unreachable" | "malformed" | "aborted" | "scope-mismatch" | "denied";
      message: string;
    };

/** The truthful, bounded user-facing message when identity cannot be loaded. */
export const SESSION_IDENTITY_UNAVAILABLE_MESSAGE =
  "Your sign-in could not be verified for this project, so no proposal was created. Sign in (or retry) and run the edit again. Nothing was changed.";

export interface LoadSessionIdentityOptions {
  /** The owning async scope's signal — abort cancels the load. */
  signal?: AbortSignal;
  /** Test seam: the transport (defaults to the production same-origin reauthorizer). */
  reauthorize?: MembershipReauthorizer;
}

function denialFrom(live: Extract<MembershipReauthorization, { ok: false }>): Extract<SessionIdentityLoad, { ok: false }> {
  if (live.code === "http-401") return { ok: false, code: "unauthenticated", message: "You are not signed in." };
  if (live.code === "http-403") return { ok: false, code: "forbidden", message: "You have no active membership for this project." };
  if (live.code === "unreachable") return { ok: false, code: "unreachable", message: "The identity service could not be reached." };
  if (live.code === "malformed") return { ok: false, code: "malformed", message: "The identity service returned an unexpected answer." };
  return { ok: false, code: "denied", message: live.detail || "The identity request was refused." };
}

/**
 * Load the live session identity for EXACTLY `scope`. Never throws; never
 * falls back; never caches. A pre-aborted or aborted-during-flight signal
 * yields `{ ok: false, code: "aborted" }` — the caller seals nothing.
 */
export async function loadSessionIdentity(scope: SessionIdentityScope, options: LoadSessionIdentityOptions = {}): Promise<SessionIdentityLoad> {
  if (options.signal?.aborted) return { ok: false, code: "aborted", message: "The project changed before identity could be loaded." };
  const reauthorize = options.reauthorize ?? createMembershipReauthorizer();
  let live: MembershipReauthorization;
  try {
    live = await reauthorize({ scope: { ...scope }, proposalId: "session-identity-load", ...(options.signal ? { signal: options.signal } : {}) });
  } catch {
    return { ok: false, code: "unreachable", message: "The identity service could not be reached." };
  }
  if (options.signal?.aborted) return { ok: false, code: "aborted", message: "The project changed while identity was being loaded." };
  if (!live.ok) return denialFrom(live);
  if (live.scope.tenantId !== scope.tenantId || live.scope.projectId !== scope.projectId || live.scope.branchId !== scope.branchId) {
    return { ok: false, code: "scope-mismatch", message: "The identity service answered for a different project scope." };
  }
  return { ok: true, principalId: live.principalId, role: live.role, membershipRevision: live.membershipRevision, scope: { ...live.scope } };
}

/**
 * The §E binding for an interactive seal — built ONLY from a successful,
 * scope-matching identity load. Throws on any disagreement: this is a
 * programming-error guard, never a fallback.
 */
export function sessionAuthorizationBindingFrom(identity: SessionIdentityLoad, scope: SessionIdentityScope): SchematicProposalAuthorizationBinding {
  if (!identity.ok) throw new Error("sessionAuthorizationBindingFrom requires a successful identity load");
  if (identity.scope.tenantId !== scope.tenantId || identity.scope.projectId !== scope.projectId || identity.scope.branchId !== scope.branchId) {
    throw new Error("sessionAuthorizationBindingFrom: identity scope does not match the seal scope");
  }
  return buildAuthorizationBinding({ principalId: identity.principalId, membershipRevision: identity.membershipRevision, scope: { ...scope } });
}
