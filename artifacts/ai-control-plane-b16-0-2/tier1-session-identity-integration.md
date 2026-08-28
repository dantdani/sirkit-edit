# Production tier-1 session identity integration (§E / R6)

## Before (the defect)
`primeSessionIdentity` had ZERO production callers; `page.tsx` called
`sessionAuthorizationBinding(scope)` **synchronously**, which fell back to the
deterministic `local-dev-principal`. In production a proposal sealed before
live identity loaded bound to `local-dev-principal` and was **guaranteed** to
fail apply-time reauthorization (`principal-changed`) — a proposal the visible
user could never apply.

## After
`app/lib/project/session-identity.ts` is rewritten as a **request-owned, async,
typed** load with **no fallback of any kind**:
- `loadSessionIdentity(scope, { signal })` asks the ONE narrow same-origin
  read-only endpoint (`/api/pcb/apply-authorization`) who the caller is for
  EXACTLY this tenant/project/branch and returns a typed result: the live
  server-derived principal / role / membership revision, or a typed refusal
  (`unauthenticated | forbidden | unreachable | malformed | aborted |
  scope-mismatch | denied`). No local-dev principal, no cache, no browser guess
  (source-pinned: the module imports none of `LOCAL_DEV_PRINCIPAL_ID`,
  `localDevMembership`, `auth/project-membership`).
- Local development obtains its deterministic identity through the SAME server
  boundary (the server's local_dev identity provider answers there).
- The load is bound to the captured `ProjectAsyncScope.signal`: project switch /
  logout / unmount / late completion aborts it and never seals under a stale
  identity; the result carries the scope it answered for (a foreign-scope answer
  is refused).
- `sessionAuthorizationBindingFrom(identity, scope)` builds the §E binding ONLY
  from a successful, scope-matching load; it throws on any disagreement.

## page.tsx seal site
Awaits `loadSessionIdentity(sealScope, { signal: scope.signal })` BEFORE sealing;
re-checks the tier-1 pin after the await; on `!ok` creates **NO** proposal and
shows the truthful `SESSION_IDENTITY_UNAVAILABLE_MESSAGE` ("sign in / retry");
otherwise seals with `sessionAuthorizationBindingFrom(sessionIdentity, sealScope)`.

## Production integration test (real endpoint + real apply service)
authenticated (supabase_cookie) editor → proposal sealed under the EXACT live
principal/revision → explicit Apply → fresh matching reauthorization → exactly
ONE canonical transaction (head 0→1, one adoption). Logout, no-membership,
project-switch abort, identity-load failure → ZERO proposal. Downgrade,
membership-revision change, logout-after-seal, different-principal-after-seal →
apply refused with ZERO mutation / ZERO head advance.
