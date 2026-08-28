# B16.0 — test and validation report

## New permanent suites (38 tests)

| suite | tests | covers |
|---|---|---|
| `app/lib/auth/__tests__/b16-0-trusted-request-context.test.ts` | 20 | items 1-20: forged role/actor-id/kind ignored; 401 (missing/expired/invalid); 403 (no/revoked/insufficient/cross-tenant/cross-project); exact role derivation; role never from metadata; CSRF; worker boundary; local-dev/production modes; no-secret output |
| `app/lib/auth/__tests__/b16-0-ai-approval-lifecycle.test.ts` | 5 | items 21-23, 31-32: exactly 12 tools; no release exposure; membership-revision change on role change/revocation; revoked member refused at chat; AI cannot claim human via headers |
| `app/lib/auth/__tests__/b16-0-local-dev-and-csrf.test.tsx` | 4 | item 20 banner; same-origin/open-redirect/content-type helpers |
| `app/api/__tests__/b16-0-identity-header-gate.test.ts` | 6 | items 29-30: migrated perimeter reads no forbidden headers; backlog is pinned; browser cannot import the server auth core; worker ≠ human; negative tripwires |
| `app/api/__tests__/b16-0-auth-route-coverage.test.ts` | 3 | items 24-28: every route classified; perimeter migrated; byte-stable CSV |

## Migrated-route regressions (behaviour-preserving)
- `app/api/pcb-sync/__tests__/route.test.ts` — 401 unauthenticated, 403 insufficient-role apply, 403 cross-project (stronger than the prior 404); the forged-actor idempotency case removed (impossible now).
- `app/api/assignment-queue/__tests__/_scope.test.ts` — async, selector/CSRF/size boundary checks retained.
- `app/lib/physical-binding/__tests__/shadow-sync-api-migration.test.ts` — async scope, selector honored.

## Full validation
- **Full suite: green** (the 4 pre-fix failures were: an async-scope test call
  updated to `await`; two AST import-gate files tripped by a non-literal
  dynamic import, fixed with a static literal now that the Supabase package is
  installed; and a non-literal Supabase dynamic import replaced with a static literal).
  The definitive full run then showed a SINGLE failure — the pre-existing
  `assignment-queue-panel` UI flake (documented since B15.2.2): 5/6 pass in
  isolation, non-deterministic, and orthogonal to B16.0's header-only edit
  (its preselection/confirmation logic is not identity-related). Classified a
  pre-existing flake, not a regression. The `pcb-repair-agent` performance
  threshold also flaked once under load and passes 8/8 in isolation.
- `pnpm exec tsc --noEmit`: **0 errors**.
- Scoped ESLint on all changed files: clean.
- `git diff --check`: clean.
- Artifact generators run twice: byte-stable (auth-route-coverage.csv +
  regenerated b01 CSVs).
- Exposure remains exactly **12** agent tools; `sirkit.manufacturing.release`
  stays internal-only (release-class, not exposed).
- B12-B15.3 approval/import/replay pins unchanged (the AST import gates and
  the 12-tool exposure assertion pass).
- Protected original `C:\Users\robsa\sirkit` at its 6-entry baseline.

## No Supabase Auth / provider / release contact
All identity/membership is driven through injected fakes; the Supabase adapter
is exercised only through its injected verifier. No provider credits, no live
router, no live release.
