# B16 — Foundation closeout (`chapter/b16-foundation-closeout`, PR #6)

Labels used everywhere in this directory: **CONFIRMED** (executed and measured on this machine or in CI), **INFERRED** (derived from code reading), **PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim), **UNKNOWN** (not established), **BLOCKED-LIVE-QUALIFICATION** (needs a live resource the owner has not provided).

B16 closes the foundation left by B16.1C (PR #5): it integrates that code, makes the deterministic prompt-to-Gerber path a CI gate without dead external resources, makes database delivery repeatable, gives routed designs a safe revision path, makes component review operable, pins fabrication rules to their source, and proves the real page-level flow in a browser.

| Checkpoint | Artifact | Verdict |
|---|---|---|
| B16-A independent verification of PR #5 | `starting-state.md`, `b16-1c-independent-verification.md` | CONFIRMED — 28 review findings corrected with regression tests; deterministic CI job `prompt-to-gerber` |
| B16-B database delivery | `migration-delivery-contract.md`, `clean-and-upgrade-db-proof.md`, `rls-and-membership-proof.md` | CONFIRMED on disposable in-process PostgreSQL (PGlite); real-server run BLOCKED-LIVE-QUALIFICATION (LB-4, LB-6) |
| B16-C.1 routed-board revision lifecycle | `routed-board-revision-contract.md` | CONFIRMED (durable stack, route, dialog, recovery H.14 with real routing) |
| B16-C.2 component-binding review handoff | `component-review-handoff.md` | CONFIRMED (route, panel, acceptance pipeline step 4, browser proof) |
| B16-C.3 snapshot-conflict UX | `snapshot-conflict-ux.md` | CONFIRMED |
| B16-C.4 fabrication-rule authority | `fabrication-rule-authority.md` | CONFIRMED (live JLCPCB page re-fetched 2026-09-09; profile v2 source-pinned) |
| B16-C.5 page-level browser proof | `page-browser-e2e.md` | CONFIRMED — fresh Chromium, real Next.js app, fixture runtime, frozen clock; 1 passed in 37 s (two consecutive green runs); nine defects in the real page found and fixed |
| Failure and recovery | `failure-and-recovery-matrix.csv` | one row per bounded failure with its surface, code, status, recovery and proof |
| Change set | `changed-files.md` | every file of the chapter with its purpose |
| Measurements | `test-and-validation-report.md` | commands, counts and identities as executed |
| Open questions | `unknowns-and-owner-decisions.md` | what is not established and what the owner must decide |
| Verdict | `final-verdict.md` | what B16 proves and does not prove |

The durable program ledger lives in `artifacts/remaining-builder-program/` (`EXECUTION_LEDGER.md`, `PROGRAM_STATE.json`, `OWNER_DECISIONS.md`, `LIVE_BLOCKERS.md`); the B16.1C evidence directory `artifacts/ai-control-plane-b16-1c/` is unchanged by this chapter.
