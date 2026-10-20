# Product reliability and the simple workspace — evidence package

Branches `codex/astra-foundation` (A–F) and `codex/product-reliability-g` (G, the pull request's head; base: main `32b081e`, the B24 merge). The owner's assignment:
`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` (checkpoints A–I; the owner later appended sections J and K,
which follow after I). Dates: 2026-10-14 … 2026-10-17. Author of record: the owner's configured Git identity; no AI co-author trailers.
[PR-L7, 2026-10-20] The owner's corrective sections L (a persistent circuit-building task) and M (resolving missing parts) followed on
`codex/astra-foundation` from 2026-10-17 to 2026-10-20 (`84a2f72c` … `deaf15ca`); their compact evidence is `persistent-generation/` and
`component-resolution/`, and both verdicts are PARTIAL.

## Outcome in one paragraph

The real prompt → schematic → PCB journey works in the fixture browser end to end and once live in the normal app (checkpoint C's
bounded run: a complete 8-part proposal, approval, bindings, plan, a durable board and a real local qualification — 0.19 USD). The
page shows the next permitted step at every stage (the journey strip), every control that was dead, unnamed or decorative is now real
or honestly withheld, the Build sidebar's design checks are computed, missing parts are workflow items with a precise checklist and the
existing search / review / draft paths, and the assistant reaches the same semantic commands as the UI (generation, preflight, catalog
inspection, missing facts, a sealed draft request, module contracts, placement intent, stackup candidates) under the same authority —
reads and sealed proposals only; apply, publication, release, purchase stay human. The product outcome stays **PARTIAL** where the
owner's live resources are needed (see `remaining-blockers.md` and `final-verdict.md`): every claim here is labelled deterministic,
fixture-backed or live, and fixture-only success is never presented as a live result. [PR-L7, 2026-10-20] A design request is now a
durable task run by a separate worker in finite, resumable slices (Build and chat share it); the owner's four-motor request reaches a
reviewed 41-part design and the PCB-preparation handoff in the fixture browser, and live (LR-3) it reached a plan and one saved block
before the owner's OpenAI account answered `insufficient_quota`. Missing parts are resolved or replaced through review, from the local
library or acquired KiCad assets.

## How to run the corrected user journey

Normal app (the owner's keys, the migrated database). [PR-L7, 2026-10-20] Since section L a design request is a durable task that a
separate **generation worker** runs; without a worker the task card says "Waiting for a worker" and nothing is designed:

```bash
pnpm run dev:with-worker                 # next dev on :3000 AND the generation worker (direct transport, DATABASE_URL)
# or, in two terminals:
pnpm dev                                 # terminal 1, unchanged
pnpm run worker:generation               # terminal 2 (-- --concurrency 1, -- --once, -- --health-port 7071, -- --help)
```

`pnpm run dev:with-worker -- --port 3005` uses another port; `-- --dry-run` prints the two commands. Stop with Ctrl+C: the worker yields
its slices at a turn boundary and the task resumes from its last checkpoint the next time a worker runs (`persistent-generation/worker.md`).

1. Open `http://localhost:3000`, create a new project (old projects' PCB snapshots predate the migration and are stale), stay in
   **Build** mode, and either click **Describe a circuit** on the empty sheet or open the chat.
2. Type the circuit (e.g. "Design a 5 V 555 LED blinker at about 1 Hz …") and press Enter. [PR-L7, 2026-10-20] The start is accepted at
   once; the task card shows the plan, its assumptions, each block's state, elapsed time and Stop design / Pause / Resume / Retry block.
   A reload or a project switch reattaches to the same task. The result arrives as a proposal in the review dialog with its completeness
   and electrical-check notes as data; **Approve** replaces the sheet. (The composer's Generate and the assistant's
   `sirkit.schematic.generate-proposal` start or attach the SAME durable task and share one dialog; Stop answer ends a chat turn, Stop
   design cancels the task.)
3. The journey strip names the next step. **Prepare PCB** runs the pre-server checks (unresolved parts are listed per reference with
   their missing facts and actions), creates the physical bindings and the plan; **Apply verified plan** (the PCB tab) writes the durable
   board; **Qualify & route** runs the local qualification. Export and release remain the administrator's own clicks.
4. Settings (the gear) holds the sheet size, the AI brain and model, the agent autonomy mode and the runtime facts.
5. [PR-L7, 2026-10-20] Missing parts: the Missing parts list's **Find a replacement in the library** (or a chat sentence such as "Replace
   D1 and D2 with suitable alternatives already in the library.") opens the resolution review; **Approve** commits one transaction with
   its receipt and re-runs the Prepare PCB check. **Obtain the part's assets** starts a durable acquisition task (the bundled KiCad
   library; the online source is blocked, OD-M2-3) whose candidate goes to the existing two-human review and publication.

Fixture proof (no provider, no database, no vendor; the recorded designs, the scripted agent and provider; `playwright.config.ts` starts
the dev server through `scripts/dev-with-worker.mjs`, so the browser proofs have a real pump worker):

```bash
pnpm exec playwright test e2e/simple-workspace.spec.ts e2e/journey-contract.spec.ts e2e/prompt-to-gerber.spec.ts e2e/pr-f-missing-parts.spec.ts
pnpm exec playwright test e2e/l4-generation-task.spec.ts e2e/l5-chat-task.spec.ts e2e/l7-drone-vertical-slice.spec.ts e2e/l7-second-circuit.spec.ts
pnpm exec playwright test e2e/m1-resolve-missing-parts.spec.ts e2e/m2-acquire-missing-part.spec.ts e2e/m4-existing-board-resolution.spec.ts
```

Targeted deterministic gates (the suites added by this assignment): `pnpm exec vitest run pr-a- pr-c- pr-d- pr-e- pr-f-`; [PR-L7,
2026-10-20] sections L and M: `pnpm exec vitest run --maxWorkers=4 l2- l3- l4- l5- l6- l7- m1- m2- m4-` (the PGlite suites among them
need no database server).

### [PR-L7, 2026-10-20] The live-run launch contract (how LR-3 ran; any builder's bounded live run follows it)

A live generation spends the owner's provider credit, so it runs only after its provable worst case is reserved in `live-spend.json`,
and never on the owner's :3000 or with `.env.local` (OD-253 item 7):

- **The server sets the task's allowance, not the worker.** Server environment: `SIRKIT_OPENAI_MODEL=gpt-5.6-sol` (pins the price
  basis), the operator unit in plain digits, each only lowering the default — `SIRKIT_GENERATION_ALLOWANCE_MODEL_CALLS=24`,
  `_OUTPUT_TOKENS=57344`, `_INPUT_TOKENS=450000`, `_CATALOG_SEARCHES=120`, `_WALL_CLOCK_MS=21600000` — and
  `SIRKIT_POST_APPLY_INPUT_TOKENS=100000` (the automatic Tidy / Review ceiling); `ANTHROPIC_API_KEY` empty (reranker off); vendor keys
  absent; `SIRKIT_WORKFLOW_WORKER_SECRET` unset (the pump route fails closed); `SIRKIT_FIXTURE_RUNTIME` unset; `DATABASE_URL` the
  worker's database; the OpenAI key set by name (the start's servability check and the post-approval passes need it).
- **One worker, scoped to the run's project:** `node node_modules/tsx/dist/cli.mjs scripts/generation-worker.ts --no-env-file
  --concurrency 1 --scope <tenant>/<project>/main --health-port 7071`, with `SIRKIT_OPENAI_MODEL=gpt-5.6-sol`,
  `SIRKIT_BUILD_ITERATION_CAP=4`, `ANTHROPIC_API_KEY` empty, `SIRKIT_DB_POOL_MAX=5`, the same `DATABASE_URL` and the provider key set
  by name in its environment (never printed). `tasklist` shows no other generation worker or `dev:with-worker` against that database.
- **Zero-spend check before the worker starts:** start the server only, press Build in a NEW project, read the task snapshot and
  require `allowance.units` 1 and the remaining calls, output, searches and input equal to the unit; confirm the server's model with
  `GET /api/ai/runtime` and, after the first call, the call record's model.
- **During the run:** no Continue with another allowance unless reserved; no chat proposal, Tier-1 proposal or replacement approved
  (each re-runs Review); the code sends every metered call with SDK retries 0. **After:** price the run from the durable call records (counts
  only) and record it in `live-spend.json`.
- **Resuming LR-3** (once the owner's OpenAI quota is restored): the same server environment and a worker scoped to
  `local/21558dad-52cd-473a-9101-e72a16deded6/main`; open that project, and resume the existing task from its card — never a new
  start; it runs inside LR-3's held reservation (2.66 USD).

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
| [PR-L7, 2026-10-20] `persistent-generation/` | section L: `progress.md` (the increment ledger and the exact next step), `limit-and-stall-map.md`, `task-worker-contract.md`, `worker.md` (startup, supervision, the operator allowance), `changed-files.md`, `validation.md` (commands, results, exit codes; the CI section by the CI builder), `final-verdict.md` (L.7 items 1-10, LR-3, the L.8 stop condition), `screenshots/` (fixture four-motor board; LR-3's task card) |
| [PR-L7, 2026-10-20] `component-resolution/` | section M: `m2-acquisition-design.md` (with OD-M2-1 … OD-M2-14), `m4-board-impact.md`, `cad-source-registry.csv` (generated), `final-verdict.md` (M.5 items 1-8) |

[PR-L7, 2026-10-20] `manuals/` now holds 63 generated manuals (the manifest's count); `live-spend.json` records 1.3628 USD known of 5.00
(LR-1, LR-2, LR-3) and LR-3's held 2.66 USD.

Decision records live in `artifacts/remaining-builder-program/OWNER_DECISIONS.md` (OD-229 … OD-249 for this assignment; [PR-L7,
2026-10-20] OD-250 … OD-253 for G and sections L and M, and the CI builder's OD-254); the ledger entries in `EXECUTION_LEDGER.md`; the
program state in `PROGRAM_STATE.json`.

## Boundaries this package never crosses

No automatic procurement, fabrication or physical certification; no release, purchase, publication or credential operation by an
agent; no live test outside the owner's US$5 allowance on synthetic circuits; no change to the default model or to the qualified
model admission beyond the role override; the legacy checkout `C:\Users\robsa\sirkit` untouched.
