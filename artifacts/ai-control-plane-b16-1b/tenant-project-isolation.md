# B16.1B §D/§G — tenant and project isolation

## Mechanism (unchanged design, re-proven)

- A client may only REQUEST a `(tenantId, projectId, branchId)` selector (headers, or a query/body selector on the header-less surfaces). A selector is never authority.
- Identity is the verified, LIVE principal (`claims.sub`, server-confirmed). Membership is loaded for exactly `(tenantId, projectId, principal.userId)` from server-owned storage on every request.
- Any lookup that does not hit an ACTIVE row for that exact tuple — missing, revoked, a different project, a different tenant — yields the ONE bounded 403 `AUTH_NO_ACTIVE_MEMBERSHIP` with a byte-identical body, so a caller cannot distinguish "project exists but not yours" from "project does not exist".
- The durable repository renders the tuple as `("tenant_id" = $1 and "project_id" = $2 and "user_id" = $3) … limit 1` with exactly the input values (no wildcard, no widening); RLS (`project_members_self_select`) additionally confines any publishable-key read to the caller's own active rows.

## Evidence

| case | evidence | label |
|---|---|---|
| foreign project with an ACTIVE membership elsewhere | 403 body identical to "missing" (`b16-1b-real-sdk-identity.test.ts`, `b16-1b-auth-composition.test.ts`, pre-edit harness R4) | CONFIRMED (offline, real SDK identity) |
| foreign tenant with an ACTIVE membership elsewhere | same | CONFIRMED |
| revoked membership in the requested project | same 403; observed on the very next request after revocation; no token refresh involved | CONFIRMED |
| role change | `membershipRevision` changes (bound approvals retire) | CONFIRMED |
| repository tuple exactness | recording fake DB handle + `PgDialect` rendering; parameters equal the inputs for both matching and foreign tuples | CONFIRMED |
| RLS confinement of client-side reads | policy predicate identical in migration and schema | CONFIRMED (declared) / live application BLOCKED |
| forged `x-sirkit-*` authority headers with a real live session | actor id = `sub`, role from membership, kind human | CONFIRMED (real SDK, offline) |
| real HTTP with foreign selectors and a LIVE session | — | BLOCKED (opt-in live test asserts identical 403 bodies for a foreign project and a foreign tenant) |

No route reads project data for a selector the principal has no active membership in; that is enforced in the wrapper/resolver before any handler executes (zero downstream work on refusal is pinned).
