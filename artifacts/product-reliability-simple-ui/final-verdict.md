# Final verdict — product reliability and the simple workspace (2026-10-17; [PR-L7, 2026-10-20] updated for sections L and M)

Branch `codex/product-reliability-g` (A–F on `codex/astra-foundation` up to `6042488`, then G: `2d079637`, `d8b590fa`, `caf9ec23`),
base `main` `32b081e`. [PR-L7, 2026-10-20] Sections L and M continued on `codex/astra-foundation` (`84a2f72c` … `deaf15ca`); PR #16's head
`codex/product-reliability-g` is fast-forwarded to it by the lead. This verdict separates the deterministic tranche from the owner's
real product outcome, as section I requires. It does not claim the application or the program complete.

## [PR-L7, 2026-10-20] What changed since 2026-10-17

- **Section L, the persistent circuit-building task: PARTIAL** (`persistent-generation/final-verdict.md`). The blocking request-lifetime
  generation is replaced by one durable task that Build and chat share, a separate worker running finite slices that checkpoint and
  continue, saved blocks, durable Stop / Pause / Resume / Retry, real progress on the card, and the same review dialog. L.7 items 1-8
  and 10 CONFIRMED by permanent tests (fake-backed and fixture browser); item 9 PARTIAL: the owner's four-motor sentence reaches a
  reviewed, published 41-part design and the PCB-preparation handoff in the fixture browser, and live (LR-3) it reached a plan with
  disclosed assumptions and one saved block before the owner's OpenAI account answered `insufficient_quota` (1.17 USD spent; the task is
  durable and resumable).
- **Section M, missing parts resolved and replaced: PARTIAL** (`component-resolution/final-verdict.md`). Local alternatives through
  review, Approve, a receipt and the recomputed preflight; acquisition of real KiCad bytes from the bundled library and a fixture source
  to a validated candidate and the two-human publication; board impact before approval on a project with a durable PCB. The online
  source waits on OD-M2-3 and the other M2 owner decisions; a bound part cannot yet be rebound from the page.
- **Spend:** known 1.3628 USD of 5.00 (LR-1 0.19, LR-2 0.0028, LR-3 1.17); LR-3's 2.66 USD remainder held for its resume.
- **New blockers and open items:** `remaining-blockers.md` (the owner's OpenAI quota first).

## [PR-J7, 2026-11-05] Section J, multi-sheet schematics and workload limits: PARTIAL

One project now holds real connected subsystem sheets in one document with one connectivity authority; the user navigates and edits
them, moves and organises circuitry between them as previewed undoable transactions, and ERC, BOM, SPICE, the hierarchical KiCad export
and the PCB sync read the whole project whatever sheet is open. Proven by permanent tests and the fixture browser only (US$0); PARTIAL for
no live-model proof, the deferred sheet-scoped AI edit (J5-6), refused bus ports and split units, and the open workload items J7-4 …
J7-8 (`multi-sheet/final-verdict.md`, `multi-sheet/validation.md`).

## The owner's product outcome: PARTIAL

- **What a normal user can do now.** In the real page with the owner's keys: describe a circuit, review the generated proposal (its
  completeness and electrical check shown as data), approve it, prepare the PCB (bindings, plan), apply the plan and run the local
  qualification and routing; release stays the administrator's own step. This ran once end to end on 2026-10-16 (LR-1: an 8-part
  555 blinker, 0 remaining connections, 0 DRC errors, 0.19 USD). [PR-L7, 2026-10-20] A design request is now a durable task that
  survives reloads, project switches and worker restarts; missing parts can be resolved or replaced through review.
- **What does not yet work for the owner.** ~~On 2026-10-17 the owner's four-motor drone request ended with "All 3 subsystem blocks
  failed to design" (checkpoint C's 40-second budget); a concurrent 180-second correction was uncommitted.~~ [PR-L7, 2026-10-20]
  superseded: the correction was integrated as an interim measure (OD-251) and section L replaced the request-lifetime path. The owner's
  four-motor request has not yet produced a reviewable design live: LR-3 stopped at the owner's OpenAI quota with one block saved.
- **What stays blocked:** the owner's OpenAI quota, hosted authentication, live distributor search, catalog publication by two humans,
  the online KiCad source, CI routing on a qualified platform, a live-model evaluation corpus, quotes, orders and anything physical
  (`remaining-blockers.md`).

## Section I, criterion by criterion

| criterion | verdict | evidence |
|---|---|---|
| The fixture journey produces, reviews and applies a schematic and PCB; normal mode names its blockers | COMPLETE (fixture); normal mode exercised live (LR-1; [PR-L7, 2026-10-20] LR-3 named its provider blocker on the task card) | `e2e/prompt-to-gerber.spec.ts`, `e2e/journey-contract.spec.ts`, [PR-L7] `e2e/l7-drone-vertical-slice.spec.ts`, `e2e/l7-second-circuit.spec.ts`; unresolved parts, missing facts and provider failures shown as scoped refusals |
| The user sees the next stage without hidden controls; permitted operations execute or refuse visibly | COMPLETE for the tested paths | the journey strip, the empty-sheet entry action, the Missing parts list; [PR-L7] the task card's Stop design / Pause / Resume / Retry block; `pr-c-journey`, `pr-a`, `e2e/simple-workspace.spec.ts`, `e2e/l4-generation-task.spec.ts` |
| Generation, partial results, saved state, bindings, sync, history and validation statuses are truthful and revision-consistent | PARTIAL | the structured build result, the digest-pinned proposal store, computed design checks; [PR-L7] the durable task's saved blocks, explicit review-partial and stale-base refusal (`l3-*`, `l4-*`); gaps in `verification-matrix.md`; the live four-motor design not yet reached |
| The dead, placeholder and misleading controls are fixed or withheld | COMPLETE | F-04 … F-08, F-30, F-31 in `fault-register.md`; the census has 0 unnamed controls in scope |
| Meaningful UI operations have evidence-backed dispositions; the AI uses shared authority; forbidden operations stay forbidden | COMPLETE as a generated, drift-gated matrix | `ui-agent-command-coverage.csv`; [PR-L7] the task inspect / control tools (control is a confirm chip), the resolution and acquisition tools; no release, purchase, publication or credential tool |
| The simplified interface is keyboard-accessible, responsive and does not regress editor state or coverage | COMPLETE in the fixture browser | four desktop sizes with the chat open and closed; `minimum-width`, `keyboard-and-focus` specs |
| Permanent regressions, final-source validation and safe integration are recorded, with live limits and spend explicit | PARTIAL until PR #16's CI is read on the integrated head | `validation.md`, [PR-L7] `persistent-generation/validation.md` (increment 7's CI admission and split: OD-254, see its CI section, written by the CI builder); `live-spend.json` (1.3628 of 5.00 USD) |

## The deterministic tranche

Checkpoints A–G landed with their tests: the journey model and strip, the build result contract and bounds, the proposal store,
sync feedback, the simplified workspace, computed design checks, the generation / preflight / catalog / missing-facts / draft-request
/ module-contract / placement-intent / stackup commands for the assistant (reads and sealed proposals only), the registry-derived
coverage matrix and the manuals, the page intakes, the bounded placement → routing feedback loop and its capability matrix. At the G
tree: the CI job's positional selection ran 514 files and 5,848 tests with no failure; this assignment's 110 suites passed; the five
fixture browser specs passed; tsc and the changed-file lint are clean; the history and tree secret scans are clean. [PR-L7, 2026-10-20]
Sections L and M added 80 vitest files and 7 browser specs (`persistent-generation/changed-files.md`); on the increment 6 integration
tree 1001 of 1001 vitest files ran and every CI selection passed on the final tree (five functional pin failures fixed first; what
remained was timing-only and green alone), and the full fixture browser suite passed (`persistent-generation/validation.md`).

## Live and physical, stated plainly

Three live provider runs and one free models probe were made in all, inside the owner's allowance: LR-1 (a Build generation in the
normal app, 0.19 USD), LR-2 (one forced-tool contract turn with `gpt-6-astra`, 0.0028 USD) and [PR-L7, 2026-10-20] LR-3 (the four-motor
request as a durable task, 1.17 USD, stopped by the provider's quota). None is an engineering-quality evaluation. No hosted environment,
live distributor, live CAD source, publication, quote, order, fabrication or physical test was attempted.

## Integration

~~The concurrent agent's correction must be committed and combined with this branch before merging.~~ [PR-L7, 2026-10-20] superseded:
integrated in `84a2f72c` (OD-251). The pull request targets `main` from `codex/product-reliability-g`; the lead fast-forwards that head
to `codex/astra-foundation` after increment 7 and does not merge it. The owner's appended runbook sections J and K have not started.
[PR-J7, 2026-11-05] superseded for J: section J is built and verified to its PARTIAL verdict (the section above); section K follows in
`work-log-and-assets/progress.md`.

## Pull request and CI

Pull request #16 (https://github.com/dantdani/sirkit-edit/pull/16), `codex/product-reliability-g` → `main`, opened on 2026-10-17; not
merged by the builder. [PR-L7, 2026-10-20] Its CI on the integrated head had not been read when this line was written; criterion 7
stays PARTIAL until it is.
