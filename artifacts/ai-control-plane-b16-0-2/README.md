# B16.0.2 — closed project ownership, exact-origin CSRF, bounded auth bodies, production tier-1 identity

**Status: R1–R8 CLOSED. Full suite 3186 passed / 0 failed / 20 skipped (354 files).
B16.1 NOT started. Live Supabase authentication remains UNKNOWN (R9).**

This mandatory correction closes eight independently-confirmed defects left by
B16.0.1. Every fix is enforced at a real runtime boundary and pinned by a
permanent regression test; the pre-edit reproductions are recorded (probes
deleted afterward).

| gap | closure | evidence |
|---|---|---|
| R1 SPICE child routes public | bundle/events/waveforms authenticated + exact project scope; anonymous → 401 before lookup | `b16-0-2-spice-scope-isolation.test.ts` |
| R2 SPICE ops not project-scoped | every run/batch bound to server-derived `{tenant,project,branch}`; foreign scope → uniform 404, no listener, no cancel | same |
| R3 BOM ownership caller-controlled | server-derived ownership columns; every predicate carries the full scope; `projectKey`/raw id never authorize; diff is a bounded POST | `b16-0-2-bom-ownership.test.ts`, migration 0028 |
| R4 CSRF host-only + forwarded | ONE server-owned expected-origin authority; full scheme+host+port compare; forwarding headers inert; both reproduced bypasses pinned | `b16-0-2-csrf-exact-origin.test.ts` |
| R5 unbounded auth bodies | ONE bounded total-settlement JSON reader over `bounded-stream.ts`; never-settling → deterministic 408; oversized stops at the ceiling | `b16-0-2-bounded-json.test.ts` |
| R6 tier-1 prod identity unintegrated | request-owned async typed identity load; NO local-dev fallback; the page awaits it and seals only from it | `b16-0-2-session-identity.test.ts` |
| R7 requiredApplyRole ignored | explicit accepted-role mapping; both family list AND sealed required role must admit; unknown role fails closed; all three families | `b16-0-2-required-apply-role.test.ts` |
| R8 engineering export misattributes | authenticated + engineering role + CSRF; body actor/project refused; attribution server-derived; labelled unverified | `b16-0-2-engineering-export.test.ts` |
| R9 live auth | UNKNOWN — never claimed | `unknowns-and-owner-decisions.md` |

## Contents
1. `README.md` (this file)
2. `pre-edit-counterexamples.md`
3. `route-data-and-resource-classification.csv` (byte-pinned)
4. `project-object-ownership-matrix.csv`
5. `csrf-origin-contract.md`
6. `bounded-request-settlement.md`
7. `tier1-session-identity-integration.md`
8. `required-apply-role-contract.md`
9. `engineering-export-truth-boundary.md`
10. `migration-and-legacy-row-disposition.md`
11. `changed-files.md`
12. `test-and-validation-report.md`
13. `unknowns-and-owner-decisions.md`
14. `final-verdict.md`

## Permanent gates (`b16-0-2-gates.test.ts`)
no durable-data/process route public · every SPICE child route exact-scope ·
every authenticated route reaches the shared boundary (+ negative tripwire) ·
protected body routes use the bounded reader · forwarding headers can't define
the origin · project_admin-required rejects pcb_editor · client tier-1 sealing
has no local-dev fallback · body actor/project can't enter export attribution ·
tool exposure = 12 · `sirkit.manufacturing.release` internal-only ·
provider/agent/gateway import neither reauthorization nor approval authority.


---

## SUPERSESSION NOTE (B16.0.3, 2026-08-24)

The permanent-gates claim above is PARTIALLY SUPERSEDED: the B16.0.2 boundary
gate carried ONE explicit exception (KNOWN_NON_BOUNDARY_ROUTES =
app/api/replacement-authority/route.ts) and matched helper names textually.
B16.0.3 removed the exception entirely, made /api/replacement-authority pass
the shared authenticated boundary at runtime, and replaced the text scan with
a structural (TypeScript AST) real-call check with negative tripwires. See
artifacts/ai-control-plane-b16-0-3/.
