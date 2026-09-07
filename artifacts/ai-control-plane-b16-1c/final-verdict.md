# B16.1C — Final verdict

## Stop conditions

| Condition | Status | Evidence |
|---|---|---|
| The fresh-browser deterministic CI workflow passes end to end | MET (deterministic, credit-free) | `acceptance-pipeline.test.ts` 11/11 and `recovery-pipeline.test.ts` 9/9 over the real route handlers with isolated in-memory repositories, the fake provider adapter and the replayed real-router recordings; replayed three times identically; the real provider turn stays UNKNOWN (no credits); production authentication stays BLOCKED-LIVE-QUALIFICATION (B16.1B) — the local/test identity seam was used, as the mandate allows |
| Qualification uses the current durable revision and trusted component authority | MET | `qualification-authority-contract.md`; tripwires; parity suite; recovery H.3/H.6/H.11/H.13 |
| Release is deterministic and independently verified | MET | byte-identical archives (in-process twice, concurrent twice, and across REPLAYS of the committed recording under the frozen clock `2026-09-07T12:00:00.000Z`: sha256 `5cd671810e87cfe805a91d83406fe456c2cc802320ba5b6e9a31341b1667ef66`); ledgered; reader 1 (in-repo `independent-archive-verifier.ts`) verifies digests, release id, member sha256s, counts and geometry — 80/80; reader 2 (third-party gerbonara, local only, not in CI) parses layers/outline/drill on its own terms without checking the manifest's digests, sha256s, release id or counts. [B16-A corrected: this row said "across days" (F15) — a real qualification on another day seals a different `sourceDate` and therefore different bytes; the contract is "same sealed authority → same bytes". It also said "two independent readers PASS" as if both verified the manifest (F17). The sha256 changed with the F8 locale fix (`8746b46`) and is substituted by the orchestrator.] |
| UI actions are visible, idempotent and recoverable | MET for the manufacturing stages (panel + hook, jsdom-tested: hydration status incl. a distinct `hydration_failed` state, integrity-failed hydration, non-admin disabled release with the reason, state, disabled-while-pending, separate admin authorization, explicit retry — re-hydrating and re-confirming after a stale confirmation, refresh truth, release result) and for the schematic review gate: every provider-generated proposal — generation, the Tier-2 topology edit (`/api/schematic/edit-build`) and "Apply suggestions" — is staged in the review dialog with a change summary; the ONE apply outside the dialog is the layout "tidy" (`/api/schematic/layout-critic`): a server re-layout of positions/wire geometry that the server applies only when its re-validation reproduces the original connectivity (`applied = validation.ok && …`, route source CONFIRMED), and it runs in the auto loop; the page-level click path is RECORDED, not jsdom-mounted (`unknowns-and-owner-decisions.md` #6). [B16-A corrected: this row said "every generation waits in the dialog" while `handleEditSchematic`'s Tier-2 path applied `edit-build` output directly (F11, fixed in `d795aba`; source tripwire `b16-a-review-corrections-tripwires.test.ts` pins exactly three `applySchematic(` sites: definition, dialog approval, tidy)] |
| AI cannot approve or invoke manufacturing release | MET | recovery H.16, tripwires, `release-human-only.test.ts`, action/tool registries unchanged (12 exposed read/propose tools) |
| All invariants and full validation pass | MET with one documented environment exception | 153/150/3/0 and 12 re-measured; tsc 0; ESLint 0 new; git diff --check clean; generators ×2 byte-stable; benchmark steps green locally; full suite run 2: 4667 passed / 29 skipped / 1 failed = the pre-existing dead-database `ingest-integrity` DB test (same as B16.1B), not touched by this stage |
| Artifacts and PR are complete | artifacts: 19 B16.1C files + `b16-a-review-corrections.md` (B16-A) in `artifacts/ai-control-plane-b16-1c/`; PR: see below (opened, NOT merged) |

## Commits (Dandi Desta <dandidesta82@gmail.com>, no AI co-author trailers per the owner mandate)

[B16-A corrected] The list below is the CURRENT full commit list of the branch (`git log --oneline b7bb6d6..HEAD`, HEAD `adda8e5`, read 2026-09-07 local, CONFIRMED — 22 commits); the previous version listed only the first five B16.1C commits plus "this file's commit". Further B16-A commits (these artifact corrections, and any re-measurement / ledger commits) FOLLOW this list and are not yet in it.

| Commit | Subject |
|---|---|
| `16d1382` | B16.1C: server-owned qualification authority and deterministic, ledgered release |
| `8a635a4` | B16.1C: prompt-to-Gerber workflow state machine and deterministic acceptance/recovery suites |
| `c29c92d` | B16.1C: visible manufacturing workflow with a separate administrator release authorization |
| `ed83e69` | B16.1C: stage artifacts |
| `2e380bb` | B16.1C: line-ending-independent acceptance catalog; router fixtures re-recorded |
| `c82d1cb` | B16.1C: record PR #5 and commit list in the final verdict (PR #5 head at review time) |
| `9b05187` | Program ledger: durable execution state for the remaining builder runbook (B16-A start) |
| `f0ac092` | Ledger: B16-A narrow re-measurement results |
| `071318a` | Ledger: B16-A independent archive identity re-verified |
| `0c0b3b0` | Ledger: B16-A adversarial review of PR #5 — 28 confirmed findings and their corrections |
| `cee3b04` | B16-A F1: per-request correlation ids (route facet + fresh entropy) — the id was a per-route constant |
| `3231f3f` | B16-A F2-F7: qualify commits board+authority atomically, snapshot-derived RC01 parity, closed bodies, design scope binding, durable single-flight lease; release confirmation pins mandatory |
| `d795aba` | B16-A F11: Tier-2 topology edits and 'Apply suggestions' stage their result in the review dialog (no hidden auto-apply); source tripwires for F3/F6/F11 |
| `f69178a` | B16-A F23-F28: behavioural tests for durable heads, authority store and owned release; protected-original tripwire reports skipped; raw-route baseline regenerated and sha1-ratcheted |
| `fba0e1e` | B16-A: qualify tripwire pins the atomic commit's CAS pin (expectedBoardAggregateRevision) |
| `92c9601` | B16-A F12-F14/F18/F19/F25: manufacturing summary reports integrity per subject and the viewer's release capability; panel shows failed hydration and non-admin reason; retry after a stale confirmation re-hydrates and re-confirms |
| `8746b46` | B16-A F8: locale-independent identities — code-point/natural comparators replace localeCompare in every identity-bearing canonicalizer; router fixtures re-recorded (2 + 4 executions) |
| `850ee3e` | B16-A F9/F21: pinned release identities asserted on every replay, deterministic-manufacturing CI workflow, opt-in live-router run (SIRKIT_B16_1C_LIVE_ROUTER=1) |
| `e0efcfb` | B16-A F8 follow-up: regenerate B05/B06 replay fixtures and the raw-route baseline under code-point canonicalization; snapshot-netlist moved to pcb/fab (Stage 3 forbids netlist-bridge references) |
| `4da76b8` | CI: deterministic-manufacturing workflow — literal evidence path (runner context is unavailable in job-level env) |
| `7d341ff` | B16-A F8 follow-up: regenerate the B11 replay-trace pins under code-point canonicalization (e03-valid-board) |
| `adda8e5` | Ledger: B16-A corrections landed, re-recorded identities, final measurements |
| (following) | B16-A artifact corrections (this file and its siblings; `b16-a-review-corrections.md`) — PROPOSED until committed |

Branch `integration/b16-1c-prompt-to-gerber` pushed to `origin` (dantdani/sirkit-edit); whether the B16-A commits above are pushed at the time of reading is UNKNOWN from this file (check `git status -sb`).

## Pull request

https://github.com/dantdani/sirkit-edit/pull/5 — opened against `main` after every gate above passed; NOT merged (owner mandate). Head SHA at opening: `2e380bb07dcc07cf72e12a5bc37eebfdb3be51f5`; head at the B16-A review: `c82d1cbcbb1476937631b6e3c932f67bfb630893`; the final head SHA after the B16-A corrections is stated in the closing report.

## Confirmed limitations (verbatim from the stage)

1. Real provider turn UNKNOWN (no credits) — fake adapter in CI.
2. Production-auth browser E2E BLOCKED-LIVE-QUALIFICATION — local/test seams used.
3. FreeRouting is local-only; CI replays committed recordings and refuses unknown boards.
4. Post-qualification design changes cannot re-sync through the UI (Stage 8 copper protection) — owner decision.
5. Reviewer/admin role is required to bind component authority (a `pcb_editor` alone cannot finish sync on a fresh project) — owner decision.
6. DRC preset annular ring conflates via and PTH; PTH minimum below JLCPCB's stated 0.18 mm — owner decision; presets untouched.
7. "Gerbers generated and read back on the server by Sirkit's internal parser (not a third-party DFM check)" ≠ fabricated, ordered, assembled, or electrically certified. Nothing was uploaded or ordered. [B16-A corrected: the panel text said "independently read back" (F18); the readback at release is the server's own parser]
8. [B16-A] Byte-identity is proven across replays of the committed recording under the frozen clock, not across calendar days (F15); the TypeScript routing-integration code is exercised only by an opt-in live router run (F21, `SIRKIT_B16_1C_LIVE_ROUTER=1`, committed in `850ee3e`); the deterministic-manufacturing CI job (F9, `850ee3e`/`4da76b8`) is PROPOSED-until-merged as a `main` gate — it runs on this PR's `pull_request` events, and the ledger RECORDS a green ubuntu-latest run; `localeCompare` residue outside the release-identity chain remains (F8, listed in `unknowns-and-owner-decisions.md`).

## Verdict

B16.1C delivered under the mandate's fallback: every deterministic local/fake-backed requirement is met and proven; the live provider turn and production-auth checks are classified UNKNOWN / BLOCKED-LIVE-QUALIFICATION and were not misrepresented. The B16-A adversarial review confirmed 28 findings against PR #5 (`b16-a-review-corrections.md`); each is corrected on the branch with a regression test (commits `cee3b04`…`7d341ff`; ledger `adda8e5`). The pass status of the corrected suites at `adda8e5` is NOT re-measured in this document pass (UNKNOWN here; the ledger and the closing report carry the re-measurement). Ready for independent verification; not merged.
