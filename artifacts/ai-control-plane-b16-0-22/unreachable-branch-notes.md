# B16.0.22 — unreachable-branch normalizations (same class as B16.0.12–21)

Each family scope helper carried a non-authenticated-kind guard AFTER a
successful `authorizeRequest`:

| family | historical guard |
|---|---|
| assignment-queue | 401 `AQ_API_UNAUTHENTICATED` |
| physical-bindings | 401 `PB_API_UNAUTHENTICATED` |
| footprint-resolution | 401 `API_UNAUTHENTICATED` |
| passive-policy | 401 `API_UNAUTHENTICATED` |
| pcb-sync | 401 `PS_API_UNAUTHENTICATED` |
| replacement-authority | 401 "an authenticated project member is required" |

The canonical wrapper's equivalent guard returns **403
AUTH_UNSUPPORTED_PRINCIPAL**.

**Why the branch is unreachable on these policy rows**: `authorizeRequest`
yields `kind !== "authenticated"` only for worker-secret principals, and the
worker identity source applies only to `internal-worker` policy rows (e.g.
`/api/assignment-queue/materialize`). All eight tranche-15 rows are
`trusted-context` rows: any request that is not an authenticated project
member is refused INSIDE `authorizeRequest` (401 anonymous / 403 foreign,
revoked, role) before either guard could run. The §A suite pins those real
terminals; no test in the repository reaches the historical 401 kind-guards
(verified: the standing suites remained green unchanged).

The helpers (with their historical guards) remain in each `_scope.ts` for the
standing factory/scope tests — the guards were NOT deleted, only bypassed by
the canonical wrapper path. **CONFIRMED**, same disposition as every prior
tranche since B16.0.12.
