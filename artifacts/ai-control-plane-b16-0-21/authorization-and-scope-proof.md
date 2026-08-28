# B16.0.21 §B — Authorization & scope proof (CONFIRMED)

All eight callbacks derive tenant/project/branch/actor/role/session
EXCLUSIVELY from the trusted context via the family projectors (each =
`flatScopeOf(context)`); no callback receives or reconstructs Request, URL,
cookies, Authorization, or raw headers (code-only gates). Body-supplied
authority fields are ignored (proposals) or used only as post-auth typed
inputs (problem/run/transition payloads). Wrapper ordering: policy →
membership/role → CSRF → media → bounded 64 MB/30 s read → callback — every
refusal class pinned with zero domain work (compile spies never called).

Scope-mismatch semantics were already trusted-context-bound: these families
never read a body scope; the wrapper's policy row + trusted selector provide
the project binding. `full-flow/run` pins `startingBranchRef: scope.branchId`
and identity from scope only.
