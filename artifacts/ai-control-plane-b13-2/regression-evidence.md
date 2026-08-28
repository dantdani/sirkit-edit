# B13.2 — regression evidence

## New permanent suites

**`app/lib/engineering/__tests__/b13-2-authority-scope-and-cancellation.test.ts`
— 23 tests** covering mandatory cases 1–18:

- §A complete scope (8 tests): component substitution; hierarchy
  substitution; variant substitution; universal variant + containing-list
  variant; board/branch/project/tenant mismatch; mixed binding scopes and a
  wrong-owner selected binding; raw aggregate bound + complete-scope
  hand-off; shared-identity defaults.
- §B exact-authority consistency (4 tests): manufacturer mismatch; MPN
  mismatch; eight invalid/empty/whitespace identifier cases plus the
  no-selection case; inspection-vs-grant agreement through the REAL grant
  path.
- §C abort settlement (5 tests): immediate mid-flight settlement with zero
  timer advance; deadline settlement; concurrent abort/deadline race in both
  orders; late resolution and late rejection with an unhandled-rejection
  trap; pre-aborted no-I/O.
- §D query cancellation (6 tests): binding-query cancel; atomic-query cancel;
  abort between sequential reads; driver-error redaction; projection
  minimality + query-layer filtering; supplementary `void signal` tripwire.

**`app/api/chat/__tests__/b13-2-route-authority.test.ts` — 8 tests**
covering mandatory cases 19–25 against the REAL exported `POST` handler:
route success (with the exact scope the route derived); scope mismatch
(component/hierarchy/variant/board); database failure; browser forgery (four
sub-cases); pre-aborted request + provider never invoked; mid-flight abort
with a hanging source; resource/tool exposure consistency; toolset
determinism.

## Updated suites (strengthened, never weakened)

- `b13-component-authority-bridge.test.ts` (17 tests) — source fakes take the
  complete scope; test `#9` now asserts the truthful `unavailable` refusal
  instead of a silent drop.
- `b13-1-authority-integrity.test.ts` (22 tests) — loads request the fixture
  hierarchy; the deferred source uses the new two-parameter signature. All
  B13.1 assertions retained.
- `_authority-fixtures.ts` / `physical-binding/__tests__/fixtures.ts` —
  `validApprovedAggregate(component, { variants, scopeOverrides })` and
  `exactCandidate(..., { scopeOverrides })` let a test build a genuinely
  valid aggregate under ANY durable scope (used for every substitution case
  and for the route's board scope). Existing call sites are unchanged.

## Results (this machine, bounded 5-fork pool)

| battery | result |
| --- | --- |
| b13-2 scope/cancellation suite | 23/23 |
| b13-2 route suite (real POST handler) | 8/8 |
| b13-1 suite | 22/22 |
| b13 suite | 17/17 |
| broad battery — engineering + agent + chat + physical-binding + atomic + project (93 files; includes B05/B05.1/B06/B06.1, B09/B10, B11, B12 families) | 1176 passed / 6 DB-gated skips / 0 failures |
| **FULL SUITE** | **308 files passed / 3 skipped; 2639 tests passed / 20 skipped; 0 failures (exit 0)** |

`pnpm exec tsc --noEmit` clean; scoped ESLint clean on all changed files
(one `prefer-const` finding was fixed, not suppressed); no timing failure
occurred, so no failure was classified as flaky and no threshold was
touched.

Test-count delta: 2608 → 2639 (+31 = 23 new + 8 new; the updated suites kept
their counts).
