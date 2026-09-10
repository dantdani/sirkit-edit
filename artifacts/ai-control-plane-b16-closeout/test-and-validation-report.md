# B16 — Test and validation report

Labels: CONFIRMED = executed on this machine on the stated date; RECORDED = read from the ledger/git; BLOCKED-LIVE-QUALIFICATION = needs a live resource the owner has not provided.

Host: Windows 11 Pro 10.0.26200, Node 24, pnpm 11.2.2, Chromium 1243 (Playwright 1.63.0), bundled FreeRouting 2.2.4 on the bundled JRE (local only). All measurements CONFIRMED on 2026-09-09 unless labelled otherwise.

## 1. Final measurements at the B16-C.1/C.5 commit

| check | command | result |
|---|---|---|
| TypeScript | `pnpm exec tsc --noEmit` | 0 errors |
| CI `prompt-to-gerber` suite list (the exact list in `.github/workflows/deterministic-manufacturing.yml`, 22 paths) | `pnpm exec vitest run <list>` | 43 files: 40 passed, 3 skipped (opt-in DB/live); 354 tests: 341 passed, 13 skipped, 0 failed; 79 s |
| CI `database-delivery` suite list | `pnpm exec vitest run app/lib/db app/lib/pcb/__tests__/ingest-integrity.test.ts app/lib/physical-binding/__tests__/schema-integrity.test.ts app/lib/durable-workflow/__tests__/tenant-scope.test.ts` | 9 files: 6 passed, 3 skipped; 68 tests: 56 passed, 12 skipped, 0 failed |
| Page-level browser proof (CI configuration: replay) | `pnpm exec playwright test` | 1 passed, 37.3 s (run 18) and 37.0 s (run 19) — two consecutive green runs |
| Page-level browser proof (router RECORD, bundled FreeRouting) | `SIRKIT_FIXTURE_ROUTER=record pnpm exec playwright test` | the recording was written (2 router executions, 69 s of routing); that run's later steps were disturbed by a source edit made during the run (dev-server reload) and are proven by the replay runs |
| ESLint on the change set | `pnpm exec eslint <changed .ts/.tsx>` | 0 new errors; page.tsx 14 and PcbEditor.tsx 1 pre-existing errors are byte-identical to HEAD (`react-hooks/refs`, `set-state-in-effect`, `purity`); CI does not run eslint |
| Staged-content secret scan | before every push (runbook non-negotiable) | see the ledger entry of each push |

## 2. Per-checkpoint measurements (RECORDED from the ledger)

| checkpoint | suites | result |
|---|---|---|
| B16-A | narrow suites at PR #5 head + corrections | 37 files / 341 tests passed, 11 skipped; identities reproduced independently (gerbonara reader) |
| B16-B | `app/lib/db` + auth boundary gate; disposable PostgreSQL proofs | 6 files / 77 tests passed, 3 skipped; default run without the marker: DB suites SKIPPED, never failed |
| B16-C.4 | DRC/constraints/capability/repair/proposal (75 files), api/pcb + fab + pcb-sync (23), workflow + fixture-runtime + fab replay (12) | all green; identities re-recorded 4 times (clock and aperture-key defects found and fixed) |
| B16-C.2 | physical-bindings + physical-binding + tripwires + auth + assignment-queue (73 files), prompt-to-gerber + physical-bindings replay (6), panel (3 tests) | all green |
| B16-C.3 | pcb-sync + api/pcb-sync + panel/dialog | all green |
| B16-C.1 | `b16-c-board-revision.test.ts` (7), `b16-c-board-revision-route.test.ts` (2), `board-revision-dialog.test.tsx` (2), recovery H.14 (real routing on the derived revision; fixture re-recorded) | all green; pcb-sync + api/pcb-sync 10 files / 104 tests |
| B16-C.5 | `fixture-runtime.test.ts` (11), `b16-c-strict-mode-remount.test.tsx` (4), `manufacturing-workflow-panel.test.tsx` (12), `b16-c-review-handoff.test.ts` (7, case 3 extended), acceptance pipeline steps 4 and 7 extended | all green |

## 3. Pinned identities (CONFIRMED by replay; `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.json`)

| identity | value |
|---|---|
| frozen clock | `2026-09-09T12:00:00.000Z` (pipelines and fixture runtime alike) |
| qualified board revision | `pcb2-f61eca48a58212d9` |
| authority | revision 1, digest `sha256:991dd76d8ee59fed28fcac8360820a21571c58c648b10092399f41816bfb035e` |
| release id / filename | `mfg-release-45b3b7efbc85dc3a8ecd233c906384cd` / `sirkit-board-b16-1c-blinker-233c906384cd.zip` |
| archive | 41,855 bytes, sha256 `997664c0b9a87c4d3a65e64eeb90b98159b2ad6ad8806e4ebea748a592ac6dcc` |
| manifest content digest | `mfg-manifest-bca057f6a031374aa46edc283b9759a3f4d80d3ad97487430e062f93889826d2` |
| counts | 9 components, 24 pads, 7 nets, 80 tracks, 2 vias, 4 plated holes, 0 remaining connections, 0 shorts |
| browser router recording | `e2e/fixtures/blinker-route-fixture.json`: placed-board revisions `pcb2-4a5fcf0e62b99bef`, `pcb2-b2d4a6209fb553f5`; FreeRouting 2.2.4, bundled JRE |

The browser journey's own release identity is a different board (deterministic browser ids `b16c0000-e2e0-4000-8000-…`) and is asserted structurally (sha256 of the downloaded bytes equals the panel's digest; independent reader ok; second authorization byte-identical), not pinned by value.

## 4. What was NOT run (RECORDED)

- The complete Vitest suite was not re-run for this commit (the runbook forbids concurrent full suites; the last bounded full suite at B16-A `7d341ff` was 427/3 skipped/2 failed with the two failures being the dead-DB tests since made opt-in in B16-B). CI runs the deterministic lists on every push.
- Live provider, live Supabase authentication, real-server PostgreSQL, live routing in CI, physical fabrication: BLOCKED-LIVE-QUALIFICATION / UNKNOWN per `unknowns-and-owner-decisions.md`.
- Firefox/WebKit: not exercised (Chromium only).
