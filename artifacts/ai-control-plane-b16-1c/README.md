# B16.1C — Fresh-browser prompt-to-Gerber and deterministic manufacturing release

Repository `C:\Users\robsa\Desktop\sirkit-edit`, branch `integration/b16-1c-prompt-to-gerber`, baseline `b7bb6d6a46654fab48daf33cb8b3a163ea360432` (B16.1B merged). Protected original `C:\Users\robsa\sirkit` untouched.

## What this stage establishes (one paragraph)

A fresh authenticated browser session (local/test identity seam; production auth remains BLOCKED-LIVE-QUALIFICATION) can carry the verbatim 555 astable LED blinker prompt through: proposal (fake provider adapter in CI) → human review of what will change (every provider-generated proposal — the generation, the Tier-2 topology edit via `/api/schematic/edit-build`, and "Apply suggestions" — is staged in the same review dialog; the ONE apply that does not pass through the dialog is the layout "tidy": a server re-layout of positions/wire geometry only, applied only when the server has verified connectivity unchanged, and it runs inside the auto loop) → canonical schematic mutation → human-approved component/footprint/pin-map authority (server-owned physical bindings over published atomic revisions built from the official KiCad libraries) → durable schematic-to-PCB synchronization (publish against the server snapshot head, inert plan, explicit apply) → server-owned qualification (component authority from bindings only; RC01 parity against the applied synchronization snapshot's netlist; a durable single-flight lease; the routed board and the sealed authority written in ONE durable commit compare-and-swapped on the current revision; real evidence digests; deterministic authority digest) → a SEPARATE project-administrator authorization whose confirmation of the exact authority revision/digest is a mandatory server invariant → a deterministic, ledgered, byte-identical Gerber/Excellon ZIP whose contents an in-repo independent RS-274X/Excellon reader verifies against the manifest and the board (manifest digest, release id, member sha256s, counts, geometry), and which a second, third-party reader (gerbonara, `scripts/verify-release-independent.py`, pre-existing, run locally only, not in CI) parses on its own terms — layer presence, parseability, outline closure/extent, drill ≥ 0.30 mm, bounding-box containment; it does NOT check manifest digests, member sha256s, the release id or counts — with refresh restoring truthful progress at every step, and the AI unable to qualify or release.

[B16-A corrected] The paragraph above previously said "human review of what will change" without naming the Tier-2 edit path that applied provider output directly (F11, fixed in `d795aba`), "in-flight guard" for a process-local Map (F7, now a durable lease, `3231f3f`), and "two independent readers … verify against the manifest and the board" (F17 — only reader 1 checks the manifest; reader 2's scope is stated truthfully above). The confirmation pins were optional (F6, now mandatory, `3231f3f`). The full finding table is `b16-a-review-corrections.md`.

## Verdict pointers

- `final-verdict.md` — stop-condition status, commits, PR, limitations.
- `test-and-validation-report.md` — every run and count (74 new tests in B16.1C; full suite twice; tsc 0; ESLint 0 new; generators byte-stable; benchmark steps green locally) plus the B16-A test-integrity corrections (§12–§13).
- `pre-edit-counterexamples.md` — the 16 §B probes and the permanent tests that now pin each.
- `b16-a-review-corrections.md` — the 28 findings of the B16-A adversarial review of PR #5, each with its correction, commit and regression test, what did not change, and what is still open.

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
12. `b16-a-review-corrections.md` — read this LAST for the B16.1C claims and FIRST for the B16-A state: it lists every claim above that the review corrected. Identity values shown as `IDENTITY` placeholder in these artifacts are placeholders for the re-recorded identities (the F8 locale fix, commit `8746b46`, changed every recorded identity; the orchestrator substitutes the new values).

## Labels

CONFIRMED = observed in a test run or a probe in this stage; RECORDED = read from source or from an official page on the stated date; INFERRED = deduced from confirmed facts; PROPOSED = an owner decision, nothing changed; UNKNOWN = not established.

## Not done, by mandate

No MCP, multi-agent orchestration, provider expansion, external catalog acquisition, purchasing, fabrication upload, firmware flashing, 3D expansion, or B16.1D. No merge.
