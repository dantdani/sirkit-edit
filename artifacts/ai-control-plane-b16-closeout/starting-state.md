# B16 — Starting state (recorded at the B16-A handoff, 2026-09-07)

Labels: CONFIRMED (observed), RECORDED (read from artifacts/git), INFERRED, UNKNOWN, BLOCKED-LIVE-QUALIFICATION.

| Item | State at handoff | Evidence |
|---|---|---|
| Repository | `C:\Users\robsa\Desktop\sirkit-edit`, origin `dantdani/sirkit-edit` (private); protected original `C:\Users\robsa\sirkit` never touched | `git remote -v`; tripwire `b16-1c-invariant-tripwires` |
| `main` | `b7bb6d6` (B16.1B merged, PR #4) | `git log` |
| PR #5 | OPEN, not merged, head `c82d1cb`, base `main`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`; `benchmark-core` SUCCESS, `benchmark-nightly` SKIPPED (by design); six commits `16d1382, 8a635a4, c29c92d, ed83e69, 2e380bb, c82d1cb` | `gh pr view 5` (CONFIRMED) |
| B16.1C deliverable | fresh-browser prompt-to-Gerber under the mandate's fallback: fake provider adapter, committed KiCad catalog, recorded FreeRouting router replayed by placed-board revision, server-owned qualification authority, ledgered deterministic release, admin-authorized release UI; 19 artifacts in `artifacts/ai-control-plane-b16-1c/` | RECORDED |
| Invariants | 153 route methods / 150 canonical wrappers / 3 factories / 0 raw; 12 agent-exposed tools, none qualifies or releases | tripwire suite (CONFIRMED at re-measurement) |
| Deterministic CI | `benchmark-quality` only (benchmark validate, stage-09, stage10 engineering suite); the prompt-to-Gerber suites ran locally only | `.github/workflows/benchmark.yml` (RECORDED) |
| Database delivery | Drizzle journal 0000–0026; `0027`/`0028` unjournaled; snapshots to `0008` only; no migrate command; documented path `db:push`; `.env.local` `DATABASE_URL` points at a Supabase project that no longer resolves (`ENOTFOUND`) → one default-suite failure (`ingest-integrity`) | LB-4 (CONFIRMED) |
| Live auth | BLOCKED-LIVE-QUALIFICATION since B16.1B (no isolated Supabase project/account); deterministic seam `injectAuthorizedPrincipal`; 9 opt-in live tests | LB-1 (RECORDED) |
| Provider turn | UNKNOWN (no credits; fake adapter) | LB-2 |
| Router | bundled FreeRouting 2.2.4 + JRE local-only (`vendor/freerouting`, gitignored); CI replays committed recordings | LB-3 |
| Docker | Docker Desktop 4.67 installed; engine NOT running at handoff | CONFIRMED |
| Hardware / fabrication | not attempted | LB-5 |
| Runbook | `C:\Users\robsa\Downloads\Sirkit_Remaining_Builder_Master_Runbook.md` (1267 lines), read completely; chapters B16–B24 | RECORDED |
| Program ledger | `artifacts/remaining-builder-program/{PROGRAM_STATE.json, EXECUTION_LEDGER.md, OWNER_DECISIONS.md (OD-1…OD-8), LIVE_BLOCKERS.md (LB-1…LB-5)}` created at B16-A start (`9b05187`) | CONFIRMED |
| Owner rules | commit AND push after every change set; never push to `main` directly; merge chapter PRs normally only after green gates (runbook §2.4 / OD-8); truthful Dandi-authored commits, real dates, no AI co-author trailers | RECORDED |
