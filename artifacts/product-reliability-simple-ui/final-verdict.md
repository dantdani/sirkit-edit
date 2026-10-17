# Final verdict — product reliability and the simple workspace (2026-10-17)

Branch `codex/product-reliability-g` (A–F on `codex/astra-foundation` up to `6042488`, then G: `2d079637`, `d8b590fa`, `caf9ec23`),
base `main` `32b081e`. The pull request and its CI run are recorded at the end. This verdict separates the deterministic tranche from
the owner's real product outcome, as section I requires.

## The owner's product outcome: PARTIAL

- **What a normal user can do now.** In the real page with the owner's keys: describe a circuit, review the generated proposal (its
  completeness and electrical check shown as data), approve it, prepare the PCB (bindings, plan), apply the plan and run the local
  qualification and routing; release stays the administrator's own step. This ran once end to end on 2026-10-16 (LR-1: an 8-part
  555 blinker, 0 remaining connections, 0 DRC errors, 0.19 USD).
- **What does not yet work for the owner.** On 2026-10-17 the owner's four-motor drone request ended with "All 3 subsystem blocks
  failed to design." The cause is checkpoint C's 40-second shared generation budget (a planner, catalog searches and three subsystem
  loops did not fit). A concurrent correction by another agent in the main checkout (a 180-second budget, one cancellation boundary
  through the providers, stage-named failures, three new suites) addresses it; it is uncommitted and not part of this branch. Until it
  is integrated and a complex request is re-run, larger designs remain PARTIAL.
- **What stays blocked:** hosted authentication, live distributor search, catalog publication by two humans, CI routing on a qualified
  platform, a live-model evaluation corpus, quotes, orders and anything physical (`remaining-blockers.md`).

## Section I, criterion by criterion

| criterion | verdict | evidence |
|---|---|---|
| The fixture journey produces, reviews and applies a schematic and PCB; normal mode names its blockers | COMPLETE (fixture); normal mode exercised once live (LR-1) | `e2e/prompt-to-gerber.spec.ts`, `e2e/journey-contract.spec.ts`; unresolved parts, missing facts and provider failures shown as scoped refusals |
| The user sees the next stage without hidden controls; permitted operations execute or refuse visibly | COMPLETE for the tested paths | the journey strip, the empty-sheet entry action, the Missing parts list; `pr-c-journey`, `pr-a`, `e2e/simple-workspace.spec.ts` |
| Generation, partial results, saved state, bindings, sync, history and validation statuses are truthful and revision-consistent | PARTIAL | the structured build result, the digest-pinned proposal store, computed design checks; gaps in `verification-matrix.md` (browser cancel and double click on the proposal dialog; the sync apply crash window in the browser); the drone failure above |
| The dead, placeholder and misleading controls are fixed or withheld | COMPLETE | F-04 … F-08, F-30, F-31 in `fault-register.md`; the census has 0 unnamed controls in scope |
| Meaningful UI operations have evidence-backed dispositions; the AI uses shared authority; forbidden operations stay forbidden | COMPLETE as a generated, drift-gated matrix | `ui-agent-command-coverage.csv` (every row with a disposition and a registry reason; 54 rows honestly `missing`); the parity suites; no release, purchase, publication or credential tool |
| The simplified interface is keyboard-accessible, responsive and does not regress editor state or coverage | COMPLETE in the fixture browser | four desktop sizes with the chat open and closed; `minimum-width`, `keyboard-and-focus` specs |
| Permanent regressions, final-source validation and safe integration are recorded, with live limits and spend explicit | PARTIAL until this PR's CI is read | `validation.md`; every assignment suite now runs in a CI job; `live-spend.json` (0.1928 of 5.00 USD) |

## The deterministic tranche

Checkpoints A–G landed with their tests: the journey model and strip, the build result contract and bounds, the proposal store,
sync feedback, the simplified workspace, computed design checks, the generation / preflight / catalog / missing-facts / draft-request
/ module-contract / placement-intent / stackup commands for the assistant (reads and sealed proposals only), the registry-derived
coverage matrix and 56 manuals, the page intakes, the bounded placement → routing feedback loop and its capability matrix. At the G
tree: the CI job's positional selection ran 514 files and 5,848 tests with no failure; this assignment's 110 suites passed; the five
fixture browser specs passed; tsc and the changed-file lint are clean; the history and tree secret scans are clean.

## Live and physical, stated plainly

Two live provider requests and one free models probe were made in all, inside the owner's allowance: LR-1 (a Build generation in the
normal app, 0.19 USD) and LR-2 (one forced-tool contract turn with `gpt-6-astra`, 0.0028 USD). Neither is an engineering-quality
evaluation. No hosted environment, live distributor, publication, quote, order, fabrication or physical test was attempted.

## Integration

The pull request targets `main` from `codex/product-reliability-g`; the builder does not merge it. The concurrent agent's correction
(see above) must be committed and combined with this branch before merging; the two overlap only in generated artifacts, which the
sanctioned generators re-render. The owner's appended runbook sections J and K have not started.

## Pull request and CI

Pull request #16 (https://github.com/dantdani/sirkit-edit/pull/16), `codex/product-reliability-g` → `main`, opened on
2026-10-17; not merged by the builder. Its CI run had not reported when this line was written: the two vitest jobs' minutes stay
INFERRED, and criterion 7 stays PARTIAL, until that run is read.
