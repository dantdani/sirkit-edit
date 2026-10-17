# Product reliability and the simple workspace — evidence package

Branch `codex/astra-foundation` (base: main `32b081e`, the B24 merge). The owner's assignment:
`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` (checkpoints A–I; the owner later appended sections J and K,
which follow after I). Dates: 2026-10-14 … 2026-10-17. Author of record: the owner's configured Git identity; no AI co-author trailers.

## Outcome in one paragraph

The real prompt → schematic → PCB journey works in the fixture browser end to end and once live in the normal app (checkpoint C's
bounded run: a complete 8-part proposal, approval, bindings, plan, a durable board and a real local qualification — 0.19 USD). The
page shows the next permitted step at every stage (the journey strip), every control that was dead, unnamed or decorative is now real
or honestly withheld, the Build sidebar's design checks are computed, missing parts are workflow items with a precise checklist and the
existing search / review / draft paths, and the assistant reaches the same semantic commands as the UI (generation, preflight, catalog
inspection, missing facts, a sealed draft request, module contracts, placement intent, stackup candidates) under the same authority —
reads and sealed proposals only; apply, publication, release, purchase stay human. The product outcome stays **PARTIAL** where the
owner's live resources are needed (see `remaining-blockers.md` and `final-verdict.md`): every claim here is labelled deterministic,
fixture-backed or live, and fixture-only success is never presented as a live result.

## How to run the corrected user journey

Normal app (the owner's keys, the migrated database):

```bash
pnpm dev
```

1. Open `http://localhost:3000`, create a new project (old projects' PCB snapshots predate the migration and are stale), stay in
   **Build** mode, and either click **Describe a circuit** on the empty sheet or open the chat.
2. Type the circuit (e.g. "Design a 5 V 555 LED blinker at about 1 Hz …") and press Enter. The Build result arrives as a proposal in the
   review dialog with its completeness and electrical-check notes as data; **Approve** replaces the sheet. (The composer's Generate and
   the assistant's `sirkit.schematic.generate-proposal` share one generation and one dialog.)
3. The journey strip names the next step. **Prepare PCB** runs the pre-server checks (unresolved parts are listed per reference with
   their missing facts and actions), creates the physical bindings and the plan; **Apply verified plan** (the PCB tab) writes the durable
   board; **Qualify & route** runs the local qualification. Export and release remain the administrator's own clicks.
4. Settings (the gear) holds the sheet size, the AI brain and model, the agent autonomy mode and the runtime facts.

Fixture proof (no provider, no database, no vendor; the recorded blinker design and the scripted agent):

```bash
pnpm exec playwright test e2e/simple-workspace.spec.ts e2e/journey-contract.spec.ts e2e/prompt-to-gerber.spec.ts e2e/pr-f-missing-parts.spec.ts
```

Targeted deterministic gates (the suites added by this assignment): `pnpm exec vitest run pr-a- pr-c- pr-d- pr-e- pr-f-`.

## Where the evidence is

| file | what it holds |
|---|---|
| `progress.md` | the checkpoints in order, each with its verification and the exact next step |
| `reproductions.md` | the original failures as reproduced, requests and observed results, the permanent regression paths |
| `root-causes-and-fixes.md` | confirmed causes with source citations, separated from hypotheses; what landed per checkpoint |
| `fault-register.md` | F-01 … F-31 with class, severity, fix direction and the test that pins each |
| `workflow-contract.md` | the shared stages, approval boundaries, state ownership, scope/revision rules, recovery; the agent generation addendum |
| `ui-simplification.md`, `screenshots/` | before/after real screenshots, the component changes, responsive and accessibility evidence |
| `ui-agent-command-coverage.csv`, `-summary.json` | the registry-derived UI ↔ AI coverage matrix with dispositions and reasons (drift-gated) |
| `manuals/` | 56 registry-generated tool manuals with validated examples and a digest-pinned manifest |
| `missing-parts.md`, `missing-parts-agent.md` | the missing-facts checklist, the four actions, the agent's read and draft request, the refusal matrix |
| `astra/` | the Astra rebaseline, compatibility (incl. the live contract turn), module contracts, placement intent and stackup, the routing feedback loop and its capability matrix |
| `validation.md` | exact commands, results, exit codes, exclusions; live versus fake distinctions, per checkpoint |
| `live-spend.json` | cumulative approved / reserved / known spend (0.1928 USD of 5.00) without credentials or payloads |
| `verification-matrix.md` | the G.1–G.12 proof map: which permanent test proves what, and the honest gaps |
| `remaining-blockers.md` | unresolved resources and owner decisions, the usable behaviour, the precise unavailable stages, the remaining Astra work |
| `final-verdict.md` | working capabilities, actual limitations, the verified commit / PR / CI, complete / partial / blocked per requested outcome |

Decision records live in `artifacts/remaining-builder-program/OWNER_DECISIONS.md` (OD-229 … OD-249 for this assignment); the ledger
entries in `EXECUTION_LEDGER.md`; the program state in `PROGRAM_STATE.json`.

## Boundaries this package never crosses

No automatic procurement, fabrication or physical certification; no release, purchase, publication or credential operation by an
agent; no live test outside the owner's US$5 allowance on synthetic circuits; no change to the default model or to the qualified
model admission beyond the role override; the legacy checkout `C:\Users\robsa\sirkit` untouched.
