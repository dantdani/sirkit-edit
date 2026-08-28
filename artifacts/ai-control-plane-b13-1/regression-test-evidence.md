# B13.1 — regression test evidence

## New permanent suite

`app/lib/engineering/__tests__/b13-1-authority-integrity.test.ts` —
**22 tests covering the 28 mandated stage cases** (several cases are
multi-assertion within one test):

- §A production default: 2 (real resolver without setter under
  `DATABASE_URL`; unset/throwing ⇒ null, withheld).
- §B identity parity: 4 (shared formula; PcbEditor + route source gates;
  hierarchy default; variant default).
- §C durable validation: 7 tamper cases ⇒ conflicted (schemaVersion,
  technicalDigest, binding recordDigest, set recordDigest,
  selected-not-candidate, empty decisionEvidenceRefs,
  mapping/footprint mismatch).
- §D atomic cross-check: 6 (five single-field mismatches ⇒
  `exact-authority-unresolved`; fully-agreeing ⇒ `verified-exact`).
- §E state semantics: 2 (facets-without-exact; partial exactAuthority).
- §F deadline/cancellation: 4 fake-timer tests (deadline aborts source;
  pre-aborted no I/O; late resolve discarded; late reject discarded with
  zero unhandled rejections).
- §G route/provider: 5 (valid ⇒ resource+tool; DB failure ⇒ withheld
  with board-inspect surviving; browser authority-shaped key ignored;
  REAL provider-transform parity; manifest determinism).

Shared non-test fixture `__tests__/_authority-fixtures.ts` builds REAL
approved aggregates through `PhysicalBindingService`
(create → select → revalidate → approve) so every validation test runs
against data the production write path could actually produce.

## Rewritten/updated suites

- `b13-component-authority-bridge.test.ts` REWRITTEN — 17 tests, now on
  real-service fixtures (synthetic partial bindings cannot pass the new
  validation). All B13 behaviours re-pinned: sealing, digest tamper,
  scope auth, tenth-tool exposure, grant derive/exact-compare,
  `asset_mismatch` on 4-field substitution, manifest sensitivity.
- `b05-read-invocation.test.ts` — verified-exact fixtures gain
  exactAuthority; NEW `c-facets-no-exact` case pins
  `exact-authority-unresolved`. 33 + 21 tests green.
- `tool-read-replay.ts` `auth:u1` fixture completed with exactAuthority;
  b05 artifacts regenerated once, byte-stable ×2.

## Results (this machine, bounded 5-fork pool)

| battery | result |
| --- | --- |
| b13-1 suite | 22/22 |
| rewritten b13 suite | 17/17 |
| b05 suites | 54/54 |
| broad battery (engineering+agent+chat+physical-binding+atomic+project, 91 files) | 1146 passed / 6 DB-gated skips, 0 failures |
| **FULL SUITE** | **306 files passed / 3 skipped; 2608 tests passed / 20 skipped; 0 failures** |

The full suite was entirely green in a single run — no flake isolation
required this stage. `tsc --noEmit` clean; scoped ESLint clean;
`page.tsx` at its exact 14-problem pre-existing baseline.
