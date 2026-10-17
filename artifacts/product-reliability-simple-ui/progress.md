# Progress — reliable prompt-to-PCB, semantic control, simple workspace

Assignment: `artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` (prepared 2026-10-14), checkpoints A–I.
Checkout: `C:\Users\robsa\Desktop\sirkit-edit`, remote `dantdani/sirkit-edit`, branch `codex/astra-foundation`, base `32b081e` (B24 merge).
Protected original `C:\Users\robsa\sirkit`: not touched.

This file is the context-recovery record: current checkpoint, current blocker, exact next step. Dates are real; every claim
carries CONFIRMED / INFERRED / PROPOSED / UNKNOWN / BLOCKED-LIVE-QUALIFICATION.

## Checkpoint A — establish and reproduce the real user journey (2026-10-14)

Status: IN PROGRESS → evidence in `reproductions.md`, `root-causes-and-fixes.md`, `workflow-contract.md`.

Inventory (CONFIRMED, read-only):
- Branch `codex/astra-foundation` at `32b081e`, no commits beyond `main`. Uncommitted: 32 modified tracked files (570+/304−)
  and 10 untracked files — the owner-approved OD-229/OD-236 fixes, React lifecycle repairs (BomView, AssignmentQueuePanel,
  CommandPalette, SilkTool, useLivePreview, useSilkTool, TextInspector, ViaInspector, NumberField, PadstackEditor, PcbEditor
  proposal clock, page.tsx ref assignments), their three regression test files, the B24 metadata reconciliation, and the
  `artifacts/astra-guided-pcb/` continuation pages. Inventoried file by file (see `root-causes-and-fixes.md` §B); nothing
  reset or discarded.
- Processes at start: no dev server listening (the owner's `pnpm run dev` tab had been stopped). Seven other git worktrees
  exist for unmerged side branches; untouched.
- Repository instructions: `vendor/freerouting/AGENTS.md` only (plus the runbooks named by the assignment).
- Credentials, presence only: `.env.local` sets 13 names (OpenAI, Anthropic, database, Supabase, Mouser, Nexar, DigiKey,
  `SIRKIT_PCB_SYNC_STAGE3`); configured model `gpt-5.6-sol`, effort `high`.
  - configured: yes (all 13 names set); funded: OpenAI answered a live Build request on 2026-10-11 (the owner's own
    session), Anthropic last answered "credit balance too low" (2026-10-11); authorized: the owner's US$5 cap for the
    builder's bounded live tests (`live-spend.json`); qualified: none — every live scope remains BLOCKED-LIVE-QUALIFICATION
    (LB-1..LB-17 unchanged).
- Feature flags: `SIRKIT_PCB_SYNC_STAGE3` is set in `.env.local` (normal app) and declared `opt_in` by the fixture runtime
  and the Playwright web server; `SIRKIT_FIXTURE_AGENT=scripted` only under the fixture.
- Database (the owner's Supabase project, read-only checks): migrated through 0031 on 2026-10-11 (ledger 32 applied, no
  drift). Catalog: 22,756 parts; 21 parts with full atomic authority (13 R values, 5 C values, one LED, NE555DR, a 2-pin
  header). 14 schematic snapshots and 10 release-authority heads written before 2026-09-07 fail the current digest
  (`8746b46` changed the canonical key order) — old projects show `PS_SNAPSHOT_DIGEST_MISMATCH`; new projects round-trip clean.

Reproductions (CONFIRMED, `reproductions.md`):
- R1 Theory mode, fresh project, "make a schematic for a 555 LED blinker" → route shown "generate", POST `/api/schematic`
  400 `AUTH_PROJECT_SELECTOR_REQUIRED`, chat shows "A project selector is required.", nothing changed, no provider call.
- R2 Build mode, the owner's own live run of 2026-10-11 (durable `llm.call-record.v1`, 13 model calls, 28,878 input /
  3,211 output tokens, ~35 s): every `search_parts` failed on the then-missing table → "Loading 0 catalog parts / No parts
  produced"; the migration fixed the table; no Build run has been made since (none recorded).
- R3 Chat closed on load; the empty sheet says "Describe a circuit above"; the "ask" route shows no submit control.
- R4 Header Settings button: no handler, no accessible name (`button [ref_12]`). 3D tab: the literal "3D view".
- R5 Build sidebar "Design checks": "No floating nets" and "Supply rails connected" always green.
- R6 PCB sync entry: `if (!client || !syncIdentity) return;` (source; the normal-mode condition is traced in
  `workflow-contract.md`).
- Fixture journey baseline: `pnpm exec playwright test e2e/prompt-to-gerber.spec.ts` → 1 passed (1.4 min), exit 0, on the
  current tree with the pending changes (replay router, scripted agent, recorded design).

Permanent reproduction suite: `app/lib/qualification/__tests__/pr-a-journey-reproductions.test.ts` — 1 ordinary case (the
server-side selector refusal, zero provider work) and 10 `it.fails` cases that state the contracts C and E must meet; run
2026-10-14: 11 passed (the 10 expected failures fail as expected).

Current blocker: none for A. Live Build-mode reproduction by the builder is deferred until C bounds the loop's worst case so a
request can be reserved against the US$5 cap (see `live-spend.json`).

Status: DONE (reproductions, suite, traces; `fault-register.md` and `workflow-contract.md` written from the traces).

## Checkpoint B — finish the pending corrective foundation (2026-10-14)

Status: DONE, pending commit.

- OD-229/OD-236 and the lifecycle repairs verified: the 13 new/modified suites of the pending tree pass on the current tree.
- Four holes closed test-first (counterexamples recorded in `root-causes-and-fixes.md` §B): inspector selection identity
  (`Inspector.tsx`), live-preview hint retirement (`useLivePreview.ts`), panel-owned commit result
  (`AssignmentQueuePanel.tsx`), BOM request settlement (`BomView.tsx`). One review claim refuted and kept as a pin.
- Gates on the corrective tree: `tsc --noEmit` exit 0; whole-repository `eslint .` exit 0, 0 errors, 34 warnings (28
  `no-unused-vars`, 5 `no-console`, 1 `exhaustive-deps`) — the historical 33 errors are gone; both sanctioned generators
  re-run after the BOM handler rename (628 controls / 63 surfaces; in scope 168, unnamed 0); gate suites in `validation.md`.
- Metadata: the pending reconciliation of B24's verdict (section 5.5, metadata only) kept; B24 stays PARTIAL; live blockers
  LB-1..LB-17 unchanged; the ledger carries the A/B entry.

Committed as `535760f` (author Dandi Desta, 2026-10-14 15:06 −04:00) and pushed to `origin/codex/astra-foundation` (no PR
yet; a normal PR follows the series). Tree secret scan before the push: 0 hits.

## Checkpoint C — one understandable workflow (2026-10-14)

Status: IN PROGRESS.

Landed so far (my files): `app/lib/schematic/build-result.ts` (the structured Build result contract: completeness,
omitted blocks, electrical check state, planner, budget), `app/lib/project/ai-request.ts` (the one request preparation),
`lib/apply-netlist.ts` (Theory client: selector + signal + invalid-output refusal; `pr-c-theory-request` 4 passed),
`app/lib/project/pending-proposal-store.ts` (a pinned proposal survives a reload only against the same base digest;
`pr-c-pending-proposal-store` 4 passed), `app/page.tsx` (a labelled submit for every composer route — "Send" for ask;
the Build result's partial/skipped-check notes as activity steps and in the proposal dialog's validation note; the
drawing check's note in the dialog; proposal save/restore effects). `pr-a-journey-reproductions`: [PR-A 1] and the
composer case flipped to ordinary cases and pass.

Landed since (see `root-causes-and-fixes.md` §C for the per-fault table): server contracts and bounds (`build-loop.ts`
budget + failure classes; `build-multi` structured result, three loops in flight under one 40 s deadline, the operator's
`SIRKIT_BUILD_ITERATION_CAP`; `build`/`edit-build` forward `reason`/`retryable`; the Theory route's `build_invalid_output`;
the apply 409 carries `code`); PCB sync feedback (no silent returns; unresolved instances named per refDes before any
server call; the readiness panel mounted per blocker; the stale-apply reason and withdrawn Apply); the journey model
(`journey.ts`, `JourneyStrip` under the header, PcbEditor facts bridge, "Prepare PCB" through the same preparation the
button runs); the composer's question rule and prepare-PCB hint; OD-242 re-pins OD-106's tripwire. Citation maintenance:
27 rows re-pointed by content (accessibility.md, B21 composer-and-first-turn.md, evaluation-matrix.md) and the page
line-count pin 8459 → 8556, each with a dated note.

Done since: whole-repository eslint 0 errors / 33 warnings (prior debt); `e2e/journey-contract.spec.ts` green after three
diagnosed restore defects; the full browser suite 68 passed / 1 failed → the replay-key cause fixed in the fixture branch
of the build loop, the two journey specs re-run green; the bounded live run in the normal app went through proposal,
approval, bindings, plan, board and a real local qualification (0.19 USD; `live-spend.json`).

Status: DONE, pending commit.

Exact next step: secret scan, commit C, push; then checkpoint D (the generated UI↔AI coverage matrix with dispositions,
registry-generated manuals, drift gates, and the missing high-value shared commands).

## Checkpoint E — the interface simplified in place (2026-10-16): DONE

Landed: the empty sheet's entry action; the Workspace settings dialog (the Settings gear named and wired; the chat header's
settings moved into it with a one-line summary left behind); the 3D tab as a real state of the PCB editor (one renderer); computed
design checks (`design-checks.ts`) rendered under both library panels; the canvas sheet-size select removed (it duplicated Settings
and overlapped the rails at ≤1366 px); a class-only styling pass (no blur, flat shadows, flat logo). Three registry rules; the B17
inventory (636 / 64) and the B24 census (168 in scope, 0 unnamed) regenerated; C19 re-anchored; 29 citation rows re-pointed; the
page line-count pin 8618 → 8626 → 8612.

Verified: tsc 0; eslint 0 on the touched files; the eight gate suites 81 passed; `e2e/simple-workspace.spec.ts` (new, five steps,
four sizes, chat open and closed) green after two real defects it found were fixed (F-30 design checks unreachable in Build mode,
F-31 the canvas select overlap) and one spec defect; 11 fixture specs passed in one run (`simple-workspace`, `journey-contract`,
`prompt-to-gerber`, `minimum-width` ×3, `keyboard-and-focus` ×5). Details and the honest notes (the fixture's categories 500, the
post-apply AI passes' 503 → provider card) in `validation.md` and `ui-simplification.md`.

Exact next step: commit E (explicit paths; the D agents' uncommitted edits stay out), push; then checkpoint D — the first
background workflow (two agents, "commands" and "parity") stopped writing at 00:14 EDT on 2026-10-16 with phase 1 unfinished and
no completion record; its partial outputs in the tree (`pr-d-parity-*.test.ts`, `build-multi-generation.ts`, the `build-multi`
route extraction) are assessed and completed under D, then the matrix, the manuals and the drift gates.

## Checkpoint D — AI semantic parity (2026-10-16/17): DONE

Landed (OD-243 … OD-247): `sirkit.schematic.generate-proposal` (the Build composer's generation as a sealed proposal through the chat port;
the route is a thin caller of the ONE extracted generation; OD-106's tripwire re-pinned), `sirkit.pcb-sync.preflight` and
`sirkit.parts.catalog-inspect` (Tier 0 reads over the same domain functions the UI calls), `sirkit.component.review-request` registered
unavailable with its reason; the page's intake of the generated proposal in the SAME review dialog; the registry-derived coverage matrix
(922 rows, every row with a disposition and a registry-fact reason, 14 action records honestly `missing`) with a byte drift gate; 52
registry-generated manuals with validated examples and a digest pin; B11's recorded capsules and every registry/exposure/toolset pin
moved with dated notes; the PR-C operator cap flag inventoried. Registry 52 / 40 / 9 / 11.

Verified: gate set 304 files, 3754 passed; tsc 0; eslint 0 on 93 files; fixture Playwright 3 passed. Details, the two pre-existing
breaks fixed in passing and the deferred `b24-d0-ci-split` evidence in `validation.md`.

Owner's runbook: sections J (multi-sheet schematics, workload limits; 2026-10-15) and K (work log, persistent recovery, part acquisition,
real 3D; 2026-10-16) were appended by the owner; both say finish the current work first. Order: F, G, H, I, then J, then K.

Exact next step: commit D (with the owner's runbook K edit), push; then F — missing parts in the ordinary workflow (reuse the external
search / evidence read / acquisition pipeline; drafts and blockers as workflow items) and the remaining Astra work with exact live
blockers; then G (the full deterministic suite incl. the CI-split evidence re-measurement, whole-repository eslint, every Playwright
config, an e2e spec for the agent generation intake), H (README, remaining-blockers, final-verdict, the PR), I.

## Checkpoint F — missing parts and the first Astra increments (2026-10-17): DONE (fixture-backed; live blockers exact)

Landed (OD-248, OD-249): the missing-facts checklist (`app/lib/parts/missing-facts.ts`) rendered per unresolved instance inside the
Schematic → PCB refusal with the four actions over the existing routes (catalog search, distributor search with honest source states,
review request, prefilled unverified-draft request), the journey stage and the Build sidebar's "Missing parts (N)" line; the agent's
`sirkit.parts.missing-facts` read and `sirkit.parts.draft-request` sealed request (its own propose record; publication stays human);
Astra: the rebaseline of the directive against the tree, the `gpt-6-astra` profile admitted only through the role override (default
unchanged; account availability confirmed by a free models probe), `sirkit.module-contract.v1` + `sirkit.module.propose-contracts`,
the placement proposal's structured intent block (conflicts reported, locks win, 50-instance scope gate), `sirkit.stackup.propose`
over the qualified profiles only, the bounded placement → routing feedback loop with its generated capability matrix (differential
coupling, skew, impedance, return paths UNSUPPORTED). Registry 56 / 44 / 9 / 15; 108 action records; 932 matrix rows; 56 manuals.

Verified: see `validation.md` (the final gate set, tsc 0, eslint 0, four fixture browser specs). Evidence: `missing-parts.md`,
`missing-parts-agent.md`, `astra/{rebaseline,compatibility,module-contracts,placement-and-stackup,placement-routing-feedback}.md`,
`astra/routing-capability-matrix.csv`, screenshot `after-f-missing-parts-1366x768.png`.

Exact next step: commit F, push; then G — the whole deterministic suite with the `b24-d0-ci-split` junit re-measurement,
whole-repository eslint, every Playwright config, an e2e spec for the agent generation intake, the live `gpt-6-astra` contract turn
(≤ ~0.46 USD worst case, inside the owner's allowance) recorded in `live-spend.json`; then H (README, remaining-blockers,
final-verdict, the PR on codex/astra-foundation, never merged by the builder), I; then J, then K.
