# B16.1C — Fresh-browser prompt-to-Gerber and deterministic manufacturing release

Repository `C:\Users\robsa\Desktop\sirkit-edit`, branch `integration/b16-1c-prompt-to-gerber`, baseline `b7bb6d6a46654fab48daf33cb8b3a163ea360432` (B16.1B merged). Protected original `C:\Users\robsa\sirkit` untouched.

## What this stage establishes (one paragraph)

A fresh authenticated browser session (local/test identity seam; production auth remains BLOCKED-LIVE-QUALIFICATION) can carry the verbatim 555 astable LED blinker prompt through: proposal (fake provider adapter in CI) → human review of what will change → canonical schematic mutation → human-approved component/footprint/pin-map authority (server-owned physical bindings over published atomic revisions built from the official KiCad libraries) → durable schematic-to-PCB synchronization (publish against the server snapshot head, inert plan, explicit apply) → server-owned qualification (component authority from bindings only, current durable revision compare-and-swap, in-flight guard, real evidence digests, sealed authority with a deterministic digest) → a SEPARATE project-administrator authorization → a deterministic, ledgered, byte-identical Gerber/Excellon ZIP whose contents two independent readers (an in-repo RS-274X/Excellon lexer and third-party gerbonara) verify against the manifest and the board — with refresh restoring truthful progress at every step, and the AI unable to qualify or release.

## Verdict pointers

- `final-verdict.md` — stop-condition status, commits, PR, limitations.
- `test-and-validation-report.md` — every run and count (74 new tests; full suite twice; tsc 0; ESLint 0 new; generators byte-stable; benchmark steps green locally).
- `pre-edit-counterexamples.md` — the 16 §B probes and the permanent tests that now pin each.

## Reading order

1. `current-prompt-to-gerber-map.md` — the path, handler by handler.
2. `workflow-state-machine.md` — the explicit 18-state machine and how it coordinates the existing authorities.
3. `fresh-browser-hydration-proof.md` — `GET /api/pcb-sync?include=manufacturing` and reconstruction.
4. `component-authority-proof.md` — the acceptance catalog, bindings, parity, and the first-principles electrical checks.
5. `qualification-authority-contract.md` — what the qualify route reads, runs, seals.
6. `fabrication-profile-sources.md` — JLCPCB two-layer profile vs the official capability page (retrieved 2026-09-07).
7. `deterministic-release-contract.md` and `release-file-manifest.csv` — the release route, ledger, archive identity, member digests.
8. `independent-gerber-verification.md` — the two independent readers' results.
9. `failure-and-recovery-matrix.csv` and `ui-handler-command-authority-matrix.csv` — §H cases and §F surfaces.
10. `security-and-human-truth-proof.md` — invariants (153/150/3/0, 12 tools, policy rows, human-only release, redaction).
11. `superseded-claims.md`, `unknowns-and-owner-decisions.md`, `changed-files.md`.

## Labels

CONFIRMED = observed in a test run or a probe in this stage; RECORDED = read from source or from an official page on the stated date; INFERRED = deduced from confirmed facts; PROPOSED = an owner decision, nothing changed; UNKNOWN = not established.

## Not done, by mandate

No MCP, multi-agent orchestration, provider expansion, external catalog acquisition, purchasing, fabrication upload, firmware flashing, 3D expansion, or B16.1D. No merge.
