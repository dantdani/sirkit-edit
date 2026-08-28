# B16.0.3 — authorization exception elimination and BOM ownership DDL closure

**Status: R1–R5 CLOSED. Full suite 3220 passed / 0 failed / 20 skipped (358 files).
ZERO authenticated-route exceptions remain. B16.1 NOT started. Live Supabase
authentication remains UNKNOWN (R9).**

This narrow corrective stage closes the two defects independent verification
confirmed against B16.0.2: one authenticated route (`/api/replacement-authority`)
was deliberately exempted from the runtime-boundary gate and reached durable
component-authority resolution with NO authentication, and the BOM ownership
CHECK did not enforce its documented all-or-nothing invariant (partial ownership
passed via SQL UNKNOWN).

| finding | closure | evidence |
|---|---|---|
| R1 anonymous replacement-authority reached authority-source resolution (503, never 401) | `authorizeRequest` FIRST: authentication + membership + editor role + exact-origin CSRF complete BEFORE body consumption and BEFORE any source/facts call; trusted scope is the ONLY data selector | `replacement-authority-authentication-boundary.md`, `b16-0-3-route-auth.test.ts` (12) |
| R2 `KNOWN_NON_BOUNDARY_ROUTES` exempted the route from the boundary gate | the exception set is DELETED (source-pinned absent); the gate is now a STRUCTURAL AST check — a real, reachable, imported call is required; four mandated negative tripwires fail every mention-only form | `authorization-gate-and-negative-tripwires.md`, `b16-0-3-boundary-gate.test.ts` (11) |
| R3 classification said `durable_access=none` / `caller-supplied-only` while the handler reads durable authority | reclassified `read` / `project-durable` (chat likewise gained `read`); a permanent connective check ties known durable-source CALLS to a durable annotation; CSV regenerated via its generator, byte-stable ×2 | `effective-resource-classification.md`, `b16-0-3-effective-classification.test.ts` (4) |
| R4 partially-owned BOM rows passed the CHECK (UNKNOWN passes) | explicit `IS NOT NULL` conjuncts in migration 0028 AND declared as named `check()` constraints in `schema.ts`; six-value Kleene truth table pinned with the OLD form as a regression witness | `bom-ownership-check-truth-table.md`, `b16-0-3-bom-ownership-check.test.ts` (5) |
| R5 migration delivery unproven (journal stops at 0026; no verified migrate command; schema lacked the CHECK) | schema/migration parity pinned by test; delivery state documented HONESTLY as an owner-gated deployment blocker — nothing applied, nothing invented | `migration-delivery-and-live-state.md` |

## Contents
1. `README.md` (this file)
2. `pre-edit-counterexamples.md`
3. `replacement-authority-authentication-boundary.md`
4. `authorization-gate-and-negative-tripwires.md`
5. `effective-resource-classification.md`
6. `bom-ownership-check-truth-table.md`
7. `migration-delivery-and-live-state.md`
8. `changed-files.md`
9. `test-and-validation-report.md`
10. `unknowns-and-owner-decisions.md`
11. `final-verdict.md`

Supersession notes were appended to the four B16.0.2 documents whose claims
this stage affects (README, final-verdict, unknowns-and-owner-decisions,
migration-and-legacy-row-disposition); no historical evidence was deleted.
