# Sirkit Remaining Builder Program — Execution Ledger

Durable, append-only record of every checkpoint. Tests, code, durable artifacts and observed behaviour remain authoritative; this ledger is a map to them, never proof by itself. Labels: CONFIRMED (observed in this program), RECORDED (read from source/artifacts), INFERRED, PROPOSED, UNKNOWN, BLOCKED-LIVE-QUALIFICATION.

Identity: commits by `Dandi Desta <dandidesta82@gmail.com>`, real timestamps, no AI co-author trailers. Working repository `C:\Users\robsa\Desktop\sirkit-edit`; protected original `C:\Users\robsa\sirkit` never touched.

---

## B16-A — Integrate and independently verify B16.1C

**Started:** 2026-09-07 (local), on `integration/b16-1c-prompt-to-gerber` at `c82d1cbcbb1476937631b6e3c932f67bfb630893` (PR #5 head), base `b7bb6d6a46654fab48daf33cb8b3a163ea360432` (origin/main).

**Starting handoff verified (CONFIRMED via `git fetch` + `gh pr view 5`):** PR #5 OPEN, not draft, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, no reviews, head `c82d1cb`, base `main`; checks: `benchmark-core` SUCCESS, `benchmark-nightly` SKIPPED (by workflow design). Six commits in range `b7bb6d6..c82d1cb`: 16d1382, 8a635a4, c29c92d, ed83e69, 2e380bb, c82d1cb. Repository has no CLAUDE.md/AGENTS.md (only `.claude/launch.json`).

**Re-measurement plan (runbook B16-A.3):** narrow suites (acceptance, recovery, qualification/release, component authority, route/tool/invariant gates), tsc, scoped ESLint, `git diff --check`, sanctioned generators ×2, bounded full suite, benchmark-quality commands, independent ZIP/Gerber validators; plus an adversarial multi-lens review of the diff (authority bypass, determinism/host dependence, human truth, test integrity, CI risk) with two refuters per finding.

_(results appended below as they are observed)_

### B16-A narrow re-measurement (CONFIRMED, 2026-09-07 local, head c82d1cb + ledger commit 9b05187)

- `pnpm exec tsc --noEmit` → exit 0.
- Narrow suites (`app/lib/workflow/prompt-to-gerber/__tests__`, `app/lib/pcb/fab/__tests__`, `app/api/pcb`, `b16-1c-invariant-tripwires`, `b16-0-15-tranche-parity`, `manufacturing-workflow-panel`, `manufacturing-release-gate`, `native-fab`, `b16-1b-auth-composition`, `physical-binding`, `footprint-resolver`, `pcb-sync`): 37 files passed, 1 skipped (opt-in DB); 341 tests passed, 11 skipped, 0 failed; 15.5 s.
- `git diff --check` → clean.
- Sanctioned generators ×2 → sha1 `4d93461b` / `e22ec3a3` / `0599d5e6` / `49f279fd` both runs, identical to committed files (git status clean under artifacts/).
- Scoped ESLint over every B16.1C production module → 0 errors, 1 pre-existing warning (`app/api/pcb/edit/__tests__/assist-live.test.ts` unused directive, not in range).
- Independent archive identity (CONFIRMED): the acceptance suite's evidence ZIP (`%TEMP%/sirkit-b16-1c-evidence/b16-1c-acceptance-release.zip`, 40,962 bytes) hashes to `23314a7513b3c87fb135caab534e5d6d708b1259508e88d17919d8b7d7acf456` — equal to the B16.1C claim; releaseId `mfg-release-110d72644994b65fd0d757ff5c3311e2`, board `pcb2-d3c41a58ca702019`; 10 members all dated 1980-01-01; in-repo independent reader 80/80 checks ok; third-party gerbonara 1.6.3 `INDEPENDENT VERIFICATION: PASS`.

### B16-A adversarial review of PR #5 (RECORDED, 2026-09-07 local)

Multi-lens review of `b7bb6d6..c82d1cb` (authority bypass, determinism/host dependence, human truth, test integrity, CI risk), every finding challenged by two independent refuters; 28 findings survived, 0 refuted (journal: session workflow `wf_19e58a58-f13`). Each is corrected on the PR #5 branch with its own reproduction and regression test before the merge (runbook B16-A.6). Severity as assessed by the reviewers.

| # | Sev | Finding (CONFIRMED) | Correction |
|---|---|---|---|
| F1 | medium | `deriveCorrelationId` hashes only method+path → every `/api/pcb/qualify` failure carries the same correlation id; a trace cannot be found by it | per-request unique id (path digest + random suffix), test pins two requests differ |
| F2 | medium | qualify publishes the routed board durably inside `commitSelected` BEFORE RC01/RC02 and the authority save → a later failure leaves the board replaced while the envelope says "Nothing was changed" | gates run on the candidate before any durable write; board + authority committed in ONE durable commit |
| F3 | medium | client body key `seeds` is cast unvalidated and steers the placement RNG/run id | body closed to `boardId`/`designId`; unknown keys refused |
| F4 | medium | RC01 parity certified against `boardToSourceNetlist(board)` (board-projected) → passes by construction; the same netlist is sealed as `authority.netlist` | parity against the netlist derived from the LAST APPLIED synchronization snapshot; that netlist is sealed |
| F5 | low | `designId` is a free-form client string never checked against the synchronized design | must equal the applied snapshot's `designId` (refused otherwise) |
| F6 | low | administrator confirmation pin enforced only when volunteered | `expectedAuthorityRevision` (integer) + `expectedAuthorityDigest` (string) mandatory on release; positive/negative/type tests |
| F7 | low | in-flight qualification guard is a process-local Map (multi-instance: two router runs) | durable lease aggregate (CAS, TTL) replaces the Map |
| F8 | medium | canonical key sort uses bare `localeCompare` → identities depend on the host ICU locale (lt-LT reproduces `ROUTE_FIXTURE_MISS`) | code-point comparator in every identity-bearing canonicalizer; locale-shim regression test |
| F9 | medium | recorded release identities asserted by no test; acceptance/recovery suites run by no CI workflow | pinned-identities assertion; deterministic manufacturing CI job |
| F10 | low | contract says "DEFLATE level fixed"; archive uses STORE | doc corrected |
| F11 | high | "no hidden auto-approval" false: `handleEditSchematic` Tier-2 path applies `edit-build` output directly | Tier-2 output staged in the same review dialog; source tripwire pins the only direct apply sites |
| F12 | medium | summary reader swallows corrupt authority/snapshot heads → browser shows "authority none" | reader reports integrity per subject; hook treats corrupt as failed hydration |
| F13 | medium | panel shows the `idle` label after a FAILED hydration | distinct failed state label |
| F14 | medium | H.7 "dialog only for admins" false: any member sees the enabled Request release + dialog | server reports the viewer's release capability; non-admins see a disabled control with the reason |
| F15 | low | "byte-identical across days" overstated (frozen clock) | wording corrected |
| F16 | low | CSV says 61 PASS rows (actual 80); component-authority proof says 24 (actual 26) | corrected |
| F17 | low | README overstates the gerbonara reader (no manifest digest/count checks) | wording corrected |
| F18 | low | panel text "independently read back" describes the internal parser | wording corrected |
| F19 | medium | panel "stale confirmation → retry" test tautological (hook re-sends the same stale pin) | retry after CONFIRMATION_MISMATCH/STALE re-hydrates and asks for a new confirmation; test asserts the new pin |
| F20 | medium | no positive route test for matching pins; no type-contract negative | added |
| F21 | medium | recorded fixtures replace the whole production router, masking TS routing-integration regressions | opt-in live-router run (`SIRKIT_B16_1C_LIVE_ROUTER=1`) documented; limitation recorded |
| F22 | low | tranche-parity helper hardcodes `verifiedAt: "2026-09-07"` without a fake clock (fails after 2027-09-08) | helper derives from the current date |
| F23 | low | `getSnapshotHead` / authority `getHead`/`save` digest branches and the summary reader untested | behavioural tests added |
| F24 | low | `runOwnedRelease` stale/thrown branches untested | tests added |
| F25 | low | `include=<other>` refusal and reader-absent untested | tests added |
| F26/27 | low | protected-original tripwire passes vacuously off this machine | reported as skipped (never passed) when the path is absent |
| F28 | low | raw-route baseline sha1 for `/api/pcb-sync` stale; sha1 informational | baseline regenerated; ratchet compares sha1 |
