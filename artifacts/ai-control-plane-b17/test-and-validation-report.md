# B17 — test and validation report

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Branch `chapter/b17-semantic-editor` (PR #7), base `82ecbf8`. All runs on the Windows development machine (Node 24, pnpm 11, Vitest 3.2.6, Playwright 1.63, Next 16.2.6 / Turbopack) unless marked CI (ubuntu-latest).

## 1. Checkpoint gates (CONFIRMED — see each checkpoint's artifact)

| checkpoint | dedicated tests | result | CI |
|---|---|---|---|
| B17-A rebaseline | `b17-a-control-inventory.test.ts` (6), `action-registry.test.ts` | green; inventory 573 controls / 58 surfaces; B01 matrices byte-consistent | green at `adb9ade` |
| B17-B bus | `b17-b-view-session-bus.test.ts` (12) | green | green at `9e90e5c` (after the H.16 pin correction `a0236b0`) |
| B17-C 3D | `b17-c-pcb3d-commands.test.ts` (6), `pcb3d-view-session.test.tsx` (2, StrictMode) | green; browser scenario 1 | green at `040df94` / `e7a5a44` |
| B17-D canvas/selection | `b17-d-pcb-view-commands.test.ts` (6), `b17-d-schematic-workspace-commands.test.ts` (3), `use-view-session.test.tsx` | green; browser scenarios 2–3 | green at `96a2925` |
| B17-E parity | `b17-e-layout-candidates.test.ts` (5), `b17-e-operation-timeline.test.ts` (3), `b17-e-io-outcomes.test.ts` (2), `b16-0-12-tranche-parity` | green; browser scenario 4 | green at `041fad9` |
| B17-F exposure | `b17-f-agent-exposure.test.ts` (8), `b17-f-view-tools.test.ts` (11), `b17-f-view-session-bridge.test.ts` (4); 37 re-derived gates | green; browser scenario 5 | green at `81bf3ea` (deterministic-manufacturing 34430572594, benchmark-quality 34430572590) |
| validation | `b17-negative-tripwires.test.ts` (3) | green (518 dispatches, > 150 settled, board byte-identical) | this commit |

## 2. Full suite (CONFIRMED)

**Run 1** — `pnpm exec vitest run` (default parallelism, 16 workers), 2026-09-10 02:39–02:55 local, on the B17-F tree: 1485 suites / 4959 tests — **4895 passed, 31 failed, 33 pending (opt-in live/DB)**. The 31 failures re-run alone with 4 workers (380 passed / 4 failed):

| class | files | disposition |
|---|---|---|
| contention timeouts (whole-tree AST / source scans and heavy compute exceeding vitest's 5 s per-test timeout under 16 parallel workers) | `b16-0-identity-header-gate`, `b16-1c-invariant-tripwires`, `b09-3-closure` §B, `b11-4` G9/G11, `b16-0-2-gates` (2), `b16-0-7-wrapper-adoption-gate`, `b16-0-ai-approval-lifecycle` 22/23, `b16-1b-auth-composition` §G, `b16-b-migrations` dry run, `b03-2-boundary`, `b12-boundary-and-e2e`, `b14-1` (2), `fixture-runtime` §5, `route-tool` perf, `b14-2/3/4/5`, `b15-2-1`, `b15-2-2`, `auto-place` 100-footprint | all PASS alone (RECORDED, not dismissed: each was re-executed and its assertions hold; R17-8) |
| timing thresholds under load | `performance-property` (8.2 s vs 5 s budget), `auto-place` 30-footprint (1089 ms vs 500), `pcb-repair-agent` (731 ms vs 250) | all PASS alone (RECORDED) |
| **real regression from B17-E** | `b08-2-async-ownership` 9 — "GENERATION beats digest": after a same-digest lifecycle replacement, `apply()` on a partial placement preview (a report without a candidate) returned early instead of invalidating the preview (state stayed `done`, no toast). Cause: B17-E placed the candidate lookup before the generation check. | **FIXED** in `useAutoPlace.apply` (the generation check precedes the lookup; the stale candidate is retired; scope cleared); the B08.2 suite and the PCB component suites pass (64/1 skipped) |
| test defect (validation's own) | `b17-negative-tripwires` — envelopes issued on the wall clock expired against the bus's frozen clock (every dispatch refused `VS_EXPIRED`, which the first draft accepted) | **FIXED**: envelopes issued on the frozen clock; the test now requires > 150 settled dispatches and forbids infrastructure refusals; valid mirror payloads isolate the role gate |
| pre-existing on the branch (B16-C.1), not in any CI list | `b16-0-8-migration-ratchet` — raw-route baseline sha1 for `POST /api/pcb-sync` stale since `f6b9390` (the lineage wiring) | **RESOLVED**: baseline regenerated with the documented generator (3 → 3 legacy methods, 0 migrated, 0 added; only that sha1 changed; the 153 = 150 + 3 + 0 ratchet is unchanged) — D17-5 |
| pre-existing on the branch (B16-C.1), not in any CI list | `b16-0-22-tranche-parity` — the two pcb-sync GET cases mock the board read but not the B16-C.1 lineage read; the durable workflow store then threw `DATABASE_URL is not set`, surfaced as 422 `PS_INTERNAL_ERROR`. In production both reads use the same database (the board read would fail first), so the product contract is unchanged. | **RESOLVED**: the tests mock `DurableBoardLineageStore.get` → null (the implicit lineage), and now also assert the implicit lineage summary (`generation 0`, `current`); 59/59 |

**Run 2** — `pnpm exec vitest run --maxWorkers=4` on the final tree (after the fixes above): see the line appended below.

1487 suites / 4962 tests — **4928 passed, 1 failed, 33 pending (opt-in live/DB)**, 2026-09-10 02:59–03:20 local. The single failure is `b16-b-migrations` "dry run plans without …" (PGlite disposable-PostgreSQL migration planning) exceeding the per-test timeout under the 4-worker run; re-run alone it passes (15/15 in 106.7 s; its cases take 3.5–11 s each) — RECORDED as a load timeout, not dismissed. Net: every test in the tree passes; the only non-green outcomes in either run were contention/timing effects that each pass in isolation.

## 3. Generators (CONFIRMED)

Every generator was re-run on the final tree and produced byte-identical committed artifacts (no drift): `generate-tool-registry-artifacts` (35 descriptors, 22 exposed, digest `eng1-32df22be92bc24c7`), `generate-read-invocation-artifacts` (11 bindings / 11 fixtures), `generate-agent-artifacts` (22 exposed), `generate-b10-artifacts` (8 cases), `generate-b11-artifacts` (19/19 cases, 59/59 checks), `generate-action-toolability-matrix` (96 records, 142 route entries), `generate-b17-control-inventory` (573 / 58), `generate-b16-0-8-baseline` (3 → 3).

## 4. Static checks (CONFIRMED)

- `pnpm exec tsc --noEmit`: 0 errors on every commit of the chapter.
- eslint on every change set: 0 new reports. Pre-existing and untouched: `app/page.tsx` 14 React-hooks errors (refs written during render, present in `82ecbf8`), `PcbEditor.tsx` 1 (`react-hooks/purity`, `Date.now()` in the proposal-expiry guard), `b14-replacement-proposal.test.ts` 2 `prefer-const`. CI has no eslint job (RECORDED).

## 5. Browser proofs (CONFIRMED)

`pnpm exec playwright test` — both specs on ONE fixture dev server (frozen clock, per-spec deterministic uuid namespaces, recorded routing), retries 0:

| tree | result |
|---|---|
| B17-D final (`96a2925`) | 4 passed, 1.1 min |
| B17-E final (`041fad9`) | 5 passed, 1.2 min |
| B17-F final (`81bf3ea`) | **6 passed, 2.1 min** — prompt-to-Gerber 1.1 min (qualification replaying the recording, `POST /api/pcb/qualify 200`), five semantic scenarios 12.6 s / 9.5 s / 4.1 s / 6.2 s / 6.9 s |

Scenarios: (1) B17-C 3D acceptance through `pcb3d.*`; (2) B17-D PCB canvas (Go to, layers, fit, DRC reveal); (3) workspace + schematic; (4) B17-E parity surfaces + project timeline; (5) B17-F agent view tools through the bridge. Every proof run that found a defect is recorded in the checkpoint artifacts (B17-C: 2 defects, B17-D: 5 + 1 suite-level, B17-E: 0 code defects, B17-F: 1 hook defect). CI `page-browser-e2e` green on every push since `e7a5a44`.

## 6. CI history for the chapter (CONFIRMED)

| sha | deterministic-manufacturing | benchmark-quality | note |
|---|---|---|---|
| `adb9ade` B17-A | green | green | |
| `9e90e5c` B17-B | prompt-to-gerber FAILED (H.16 pin) | green | corrected in `a0236b0` (test corrected to the truthful `implemented` status, invariants strengthened) |
| `040df94` B17-C | page-browser-e2e FAILED (shared uuid sequence) | green | corrected in `e7a5a44` (per-spec namespaces) |
| `96a2925` B17-D | green | green | |
| `041fad9` B17-E | green | green | |
| `81bf3ea` B17-F | green (34430572594) | green (34430572590) | |
| `f788acd` validation | green (34432252639) | green (34432252622) | the final tree of the chapter |

## 7. What was not run (RECORDED)

- Live provider turn (U17-1), production Supabase browser E2E (U17-3), database-backed suites with a live `DATABASE_URL` (33 pending tests are opt-in), live FreeRouting in CI (U17-2).
