# B16.0.1 — authorization, CSRF, verified-actor and membership-lineage closure

**Status: R1–R8 CLOSED; R9 (live production auth) deliberately UNKNOWN.
Full suite 3073 passed / 0 failed. B16.1 remains NOT started.**

B16.0 built the auth foundation; its stop condition was NOT accepted. This
corrective stage closes the nine verified gaps (R1–R9) before any
manufacturing-release exposure:

| gap | closure | evidence |
|---|---|---|
| R1 viewer reached release scope | exact per-route role sets; release=`project_admin` ONLY, qualify=`pcb_editor|project_admin`, enforced before any authority load | `legacy-route-migration.md`, `b16-0-1-route-authorization` |
| R2 CSRF helper unconnected | automatic same-origin CSRF driven by the policy table at every real route boundary | `csrf-route-enforcement.md` |
| R3 verified principal discarded | the trusted principal (id/role/revision/class) binds the agent run, discovery, and every sealed `effectiveActor` | `verified-actor-propagation.md` |
| R4 membership revision not load-bearing | §E closed authorization bindings in ALL THREE sealed families (explicit new schema versions) + §F apply-time reauthorization + intent/journal/receipt-commitment/receipt/recovery binding | `proposal-membership-binding.md`, `apply-time-reauthorization.md` |
| R5 74 legacy-header routes | every route migrated; production identity-header reads = ZERO (gate-pinned) | `legacy-route-migration.md` |
| R6 broad prefix exemptions | backlog EMPTY; exact (path, method) classification with bijection gates + hostile-subpath tripwires | `b16-0-1-ci-gates` |
| R7 production → local_dev | production ALWAYS resolves production; host vars/headers are never mode configuration | `production-local-mode-separation.md` |
| R8 no production login | sign-in (existing accounts) + PKCE callback + sign-in page + sign-out lifecycle; NO signup | `signin-and-session-lifecycle.md` |
| R9 live auth unproven | kept UNKNOWN — never claimed | `unknowns-and-owner-decisions.md` |

## Stop-condition answers

- No sensitive route is caller-header-authenticated (zero reads, gate-pinned).
- No viewer reaches qualification or release (role-exact, refused pre-load).
- CSRF is enforced BY actual routes (policy-driven, proven in production mode
  including the chat surface before any provider call).
- Membership revocation DOES stop an already-sealed proposal from applying:
  all three apply flows reload the LIVE membership and refuse
  logout/replacement/downgrade/revocation/revision-change with ZERO mutation
  and ZERO journal prepare.

## Contents

1. `README.md` (this file)
2. `pre-edit-counterexamples.md`
3. `exact-route-authorization-policy.csv` (byte-pinned)
4. `legacy-route-migration.md`
5. `csrf-route-enforcement.md`
6. `verified-actor-propagation.md`
7. `proposal-membership-binding.md`
8. `apply-time-reauthorization.md`
9. `production-local-mode-separation.md`
10. `signin-and-session-lifecycle.md`
11. `test-and-validation-report.md`
12. `changed-files.md`
13. `migration-and-rollback.md`
14. `unknowns-and-owner-decisions.md`
15. `final-verdict.md`

Supersession notes were added to the four B16.0 documents that overclaimed
(final verdict, README, identity-and-approval lifecycle, trusted request
context); the B16.0 "B16.1 may proceed" authorization is WITHDRAWN there.
