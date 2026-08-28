# B16.0.14 §E — Trusted membership & controller-behavior proof

## Live membership is reloaded server-side

`resolveTrustedRequestContext` calls `memberships.loadActiveMembership(...)` on
every request — the snapshot reflects LIVE membership, not any cached or
body-supplied value. A revoked or foreign membership yields
`AUTH_NO_ACTIVE_MEMBERSHIP` (403); a logged-out caller yields 401. Both are
pinned.

## Caller-supplied authority is refused/ignored

The selector envelope accepts only `scope.{tenantId,projectId,branchId}` as a
SELECTOR. Any `role`, `actor`, `principalId`, or `membershipRevision` in the
body is ignored — the resolved role is derived from the stored membership
(`projectRoleFromMembership`), pinned by the attacker-body test.

## Approval controller comparison unchanged

The apply-time reauthorization protocol (the controller that consults this
route and compares the snapshot against the proposal's sealed §E authorization
binding) is UNCHANGED. Standing suites, all green post-migration:

| Suite | Coverage |
|---|---|
| `b16-0-1-apply-reauthorization` | the controller's snapshot comparison + divergence refusal |
| `b16-0-2-required-apply-role` | required apply role enforcement |
| `b16-0-2-session-identity` | session-identity binding into the snapshot |
| `b16-0-2-bounded-json` | the bounded reader contract the route relies on |

None of these files were modified; they exercise the migrated route through
its public POST and continue to pass.
