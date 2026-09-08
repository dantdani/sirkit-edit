# B16-A — Independent verification of B16.1C (PR #5) and its corrections

Labels: CONFIRMED (observed in B16-A), RECORDED (read from artifacts/git), INFERRED, UNKNOWN, BLOCKED-LIVE-QUALIFICATION. The full per-finding record is `artifacts/ai-control-plane-b16-1c/b16-a-review-corrections.md`; the ledger is `artifacts/remaining-builder-program/EXECUTION_LEDGER.md` (section "B16-A").

## 1. Independent re-measurement of the PR head `c82d1cb` (CONFIRMED)

- `tsc --noEmit` 0; narrow suites 37 files / 341 tests passed, 11 skipped (opt-in); `git diff --check` clean; four sanctioned generators byte-stable twice; scoped ESLint 0 errors.
- Archive identity independently reproduced: evidence ZIP 40,962 bytes, sha256 `23314a7513b3c87fb135caab534e5d6d708b1259508e88d17919d8b7d7acf456` (as claimed), in-repo reader 80/80, gerbonara 1.6.3 PASS, all members dated 1980-01-01.

## 2. Adversarial review (CONFIRMED)

Five lenses (authority bypass, determinism/host dependence, human truth, test integrity, CI risk), every finding challenged by two independent refuters; **28 findings survived, 0 refuted**. Highest severity: F11 (HIGH) — the Tier-2 topology edit path applied provider output without the review dialog, contradicting the "no hidden auto-approval" claim. Medium: constant correlation ids (F1), board published before the parity gate (F2), client-steerable placement seeds (F3), tautological parity source (F4), locale-dependent identities (F8), unpinned identities and no CI for the suites (F9), swallowed integrity failures (F12), idle label on failed hydration (F13), any member could open the admin dialog (F14), tautological retry test (F19), missing positive pin test (F20), replay masks TS routing integration (F21).

## 3. Corrections (CONFIRMED — each with reproduction + regression test, committed and pushed one change set at a time)

| Commit | Correction |
|---|---|
| `cee3b04` | F1 per-request correlation ids |
| `3231f3f` | F2–F7 atomic board+authority commit, snapshot-derived RC01 parity, closed bodies, design-scope binding, durable single-flight lease; mandatory release confirmation pins |
| `d795aba` | F11 Tier-2 edit / "Apply suggestions" through the review dialog; source tripwires |
| `f69178a`, `fba0e1e` | F23–F28 behavioural tests, honest tripwire, sha1-ratcheted raw-route baseline |
| `92c9601` | F12–F14/F18/F19/F25 summary integrity + viewer capability, `hydration_failed`, honest retry, corrected result text |
| `8746b46` | F8 `app/lib/stable-compare.ts` in 50 identity-bearing modules; router fixtures re-recorded (bundled FreeRouting 2.2.4) |
| `850ee3e`, `4da76b8` | F9/F21 pinned identities (`fixtures/expected-identities.json`), `deterministic-manufacturing` CI workflow, `SIRKIT_B16_1C_LIVE_ROUTER=1` |
| `e0efcfb`, `7d341ff` | F8 consequence: B05/B06/B11 replay fixtures and the raw-route baseline regenerated with their sanctioned generators; `snapshot-netlist` moved to `app/lib/pcb/fab/` |
| `a9fa5e7` | artifact corrections (identities substituted, overstated claims relabelled) |

New recorded identities (CONFIRMED locally on Windows and on ubuntu-latest CI run 34160044215): board `pcb2-bbc76fdb18ec7646`, authority digest `sha256:f648165b…7927d`, releaseId `mfg-release-e0bdf91bb6f5d9656ec23c9c6f02a496`, archive `sirkit-board-b16-1c-blinker-3c9c6f02a496.zip` 40,962 bytes sha256 `5cd671810e87cfe805a91d83406fe456c2cc802320ba5b6e9a31341b1667ef66`, manifest `mfg-manifest-a5592c82…d482`; byte-identical across processes and hosts; in-repo reader 80/80; gerbonara PASS.

## 4. Integration (CONFIRMED)

Final measurements at branch head: full suite 4,752 passed / 29 skipped / 2 failed (dead-database `ingest-integrity` — closed in B16-B — and a 5 s perf test that passes in isolation); engineering 801/801; agent 297/297; benchmark validate 63 pkgs / 0 diagnostics; `benchmark-quality` and `deterministic-manufacturing` SUCCESS on `a9fa5e7`. PR #5 merged normally (merge commit `62ea4a6`), `main` fast-forwarded, chapter branch `chapter/b16-foundation-closeout` opened.

## 5. Still open after B16-A (truthful)

- `localeCompare` residue outside the release-identity chain (routing/zones/placement/smart-routing/kicad/dsn/edit/atomic/workflow facets) — UNKNOWN impact until swept (`unknowns-and-owner-decisions.md`).
- The live provider turn (LB-2), production-auth browser E2E (LB-1), live router in CI (LB-3) and physical fabrication (LB-5) remain as classified.
- The layout "tidy" applies a server-verified re-layout (positions/wire geometry, connectivity unchanged) without a dialog in the auto loop — documented, not a hidden topology change.
