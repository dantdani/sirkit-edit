# Root causes and fixes

Citations are to the current tree on `codex/astra-foundation` (2026-10-14). Labels: CONFIRMED (observed or read in
source and reproduced by a test), INFERRED (reasoned from source, not run), REFUTED (a review claim the reproduction did
not bear out), PROPOSED (a fix direction not yet implemented).

## A — the user journey's confirmed causes

| id | symptom | cause | label | fix (checkpoint) |
|---|---|---|---|---|
| F-01 | Theory mode: "A project selector is required." on every generate | `lib/apply-netlist.ts:11-15` posts `/api/schematic` with only a content type; the route's canonical wrapper (`app/api/schematic/route.ts:11`, `authenticatedJsonRoute`) resolves the project selector from the `x-sirkit-*` selector headers and refuses with 400 `AUTH_PROJECT_SELECTOR_REQUIRED` (`app/lib/auth/trusted-request-context.ts:86-91`). No AbortSignal either, so a project switch cannot cancel it. | CONFIRMED (browser; `pr-a-journey-reproductions` [PR-A 1]) | C: send the selector and the signal through the same request preparation Build mode uses (`app/page.tsx:90` `aiRequestHeaders`); the server contract is unchanged |
| F-02 | Build mode: "No parts produced" after a long run (owner, 2026-10-11) | every `search_parts` failed on a missing table (migration 0030); the loop ended without a submission; the client showed only the terminal line | CONFIRMED (durable call records; server log) | database migrated 2026-10-11; C: a structured status for tool failures and partial results (F-03) |
| F-03 | A partial multi-block design reads as success | `app/api/schematic/build-multi/route.ts:150-178` returns `ok: true` with failed blocks named only in prose; the post-merge ERC is advisory and skipped on exception | CONFIRMED ([PR-A 2]) | C: `status: "complete" \| "partial"`, `omittedBlocks`, `electricalCheck` in the response; the page shows them |
| F-04 | The question route has no submit control; chat starts closed while the sheet says "Describe a circuit above" | `app/page.tsx:5856` `showComposerButton = composerAction !== "ask" …`; `app/page.tsx:2559` `chatOpen` starts false; `app/page.tsx:6337` the hint | CONFIRMED ([PR-A 3]) | C/E: a labelled submit for every route; a circuit-entry action on the empty sheet that opens and focuses the composer |
| F-05 | Header Settings does nothing; unlabeled | `app/page.tsx:6166-6168`: no handler, no accessible name | CONFIRMED ([PR-A 4]) | E: a scoped settings surface or withheld with a reason |
| F-06 | 3D tab shows "3D view" | `app/page.tsx:6416` literal; the real preview is `PcbPreview3D` in `PcbEditor.tsx:2661-2675` | CONFIRMED ([PR-A 4]) | E: route the tab to the existing preview/controller or state unavailability |
| F-07 | "No floating nets" / "Supply rails connected" always green | `app/page.tsx:6275-6276` unconditional `<CheckRow ok>` | CONFIRMED ([PR-A 5]) | E: revision-bound results or `not run` |
| F-08 | A sync click can do nothing | `PcbEditor.tsx:840` returns without feedback when the client or scope is absent | CONFIRMED ([PR-A 6]) | C: a visible, scoped refusal |
| F-09 | Old projects: `PS_SNAPSHOT_DIGEST_MISMATCH` | `8746b46` changed the canonical key order of `physical-binding/stable.ts`; pre-change code reproduces all 14 stored digests | CONFIRMED (read-only recomputation, 2026-10-11) | out of scope here; `remaining-blockers.md` |

The full chain trace with contracts per transition is `workflow-contract.md`.

## B — the pending corrective tree, verified

### OD-229 / OD-236 (owner-approved)

- `app/lib/agent/normalize-tool-arguments.ts` + gateway (`gateway.ts:510-512`) and loop (`loop.ts:440-445`) wiring; tests
  `normalize-tool-arguments` (7), `astra-foundation-regressions` (9), `b09-loop-safety` (13). CONFIRMED: all pass on the
  current tree (run 2026-10-14). The normalization reads the ORIGINAL registry schema, erases only synthetic optional nulls,
  and runs before dispatch; B05 domain validation is unchanged.
- `app/lib/engineering/agent-delete-connectivity.ts` + the Tier-1 compiler call (`schematic-plans.ts:328-329`); tests
  `b14-replacement-proposal` (21) and `astra-foundation-regressions`. CONFIRMED: AI deletion that splits a surviving
  partition is refused; `planSchematicDelete` (human) unchanged.

### Lifecycle repairs (pending tree) — verified and extended

Pending-tree suites run 2026-10-14 (13 files, all green): `bom-request-retirement` (9), `assignment-queue-panel-lifecycle`
(3), `inspector-draft-lifecycle` (10), `b16-0-2-session-identity` (14), `b24-b2-power-ground` (10), `b24-c3-recorded-limits`
(11), `b24-d2-board-read`, `b24-d3-accessible-names` (11), `b24-f-verdict-lines` (11), and the agent suites above.

Holes closed test-first in this checkpoint (each shown failing against the pending tree with the fixes reversed
string-exactly, then passing with them; `scratchpad` harness `counterexample.py`, run 2026-10-14):

| id | defect | evidence before | fix | test |
|---|---|---|---|---|
| B-1 | Same-kind, same-value selection (track A → B) reused A's draft: the Width field showed "0.4" (A's draft) on B | CONFIRMED (`inspector-selection-identity` case 1 failed: expected "0.25") | `Inspector.tsx`: the editable subtree is keyed to the selected references' identities (`refKey` join), not the board revision; a same-selection board refresh keeps the draft | case 1 (both halves) |
| B-2 | A→B→A revived the old preview warning without a new preview | CONFIRMED (case 2 failed: the warning `<p>` was present; `preview` called once) | `useLivePreview.ts`: the hint is retired during render when its identity changes | case 2 |
| B-3 | A committed assignment's result banner vanished when the reload answered revision + 1 (the keyed detail remounted) | CONFIRMED (`assignment-commit-result` failed) | `AssignmentQueuePanel.tsx`: the result is panel-owned (`CommittedAssignment`), shown for the committed item even after its detail remounts or it leaves the open view | `assignment-commit-result` |
| B-4 | A BOM request rejection outside `fetchBom`'s own handling left "Loading…" with Refresh disabled | CONFIRMED (`bom-refresh-lifecycle` case 2 failed: the error never shown) | `BomView.tsx`: the request chain's `.catch` settles the request with its error | case 2 |
| B-5 | Review claim: "Refresh prices" consumed its force flag in the first, aborted StrictMode effect run, so development sent a cached read | REFUTED: StrictMode double-invokes mount effects only; a Refresh click re-runs the effect once, and the pending tree sent `forceRefresh: true` (case 1 passed before the change) | kept as a pin: the intent is read, never consumed by an aborted run, and cleared by the answered request; all nonce bumps go through one helper (`requestAgain`) so the forced nonce can name its request | case 1 (a pin, so labelled) |

Reviewed and left as is: `PadstackEditor`'s pending state is not keyed per padstack, but its production host already keys
the editor by `selected.id` (`PadstackPanel.tsx:179`), so A→B is a remount there; `CommandPalette`, `SilkTool`,
`useSilkTool`, `TextInspector`, `ViaInspector`, `NumberField` changes verified by the pending suites.

### Gates on the corrective tree (B.4)

See `validation.md` for the exact commands, exit codes and the whole-repository lint result.

## C — one understandable workflow: what landed per fault (2026-10-14)

| fault | fix | files | tests |
|---|---|---|---|
| F-01 Theory selector mismatch | the Theory client prepares its request through the shared `app/lib/project/ai-request.ts` (the selector headers + JSON content type) and passes the lifecycle signal; an answer without `components`/`connections` is refused as invalid local output | `lib/apply-netlist.ts`, `app/lib/project/ai-request.ts`, `app/page.tsx` (call site) | `pr-c-theory-request` (4), `pr-a` [PR-A 1] |
| F-03 partial results as `ok: true` | `build-multi` answers `app/lib/schematic/build-result.ts`: `status` complete/partial, `omittedBlocks`, `electricalCheck` passed/findings/skipped/not_run, `planner`, `budget`; the page shows the notes as activity steps and in the proposal dialog's validation note | `app/api/schematic/build-multi/route.ts`, `app/lib/schematic/build-result.ts`, `app/page.tsx` | `pr-c-build-multi-status` (19), `pr-a` [PR-A 2] |
| provider/quota conflated with local output (trace §1 d) | the loop classifies: `provider_unavailable` + `reason` (+ `retryable` false for `insufficient_quota`/`breaker_open`), `build_budget_exhausted`, `build_loop_failed` (bounded, redacted), Theory `build_invalid_output`; `build`, `edit-build` forward `reason`/`retryable`; the shared card withholds Retry on quota | `app/lib/build-loop.ts`, `app/api/schematic/{build,edit-build,route}.ts` | `pr-c-build-loop-budget` (10), `pr-c-theory-route-classification` (8), `b16-0-10-tranche-parity` |
| unbounded loops (trace §1 f1) | `runBuildToolLoop` takes `budget` (iteration cap ≤ 20, a deadline checked before every model turn); `build-multi` runs block loops three at a time under one 40 s deadline and reports `budget` | `app/lib/build-loop.ts`, `build-multi/route.ts` | `pr-c-build-loop-budget` |
| F-04 no submit for the ask route; closed chat | a labelled submit for every route ("Send" / "Generate" / "Edit", `composer-submit`); the empty-sheet entry action is checkpoint E | `app/page.tsx` | `pr-a` [PR-A 3] |
| a pure question on an empty project spent provider budget (trace §1 f2) | routing rule 1b: a question form is "ask" even without a schematic; "can you build…" stays a request | `app/lib/project/composer-routing.ts` | `pr-c-composer-question` (6); `b18-d`, `b21-e4`, `b21-b-router` unchanged |
| the approver could not see the electrical finding (trace §1 f3) | the drawing check's note and the server's partial/skipped notes travel with the proposal (`validationNote`) | `app/page.tsx` | `pr-a` [PR-A 2] (source), `pr-c-journey` (partial proposal) |
| no next step after approval (trace §2 d) | the journey model (`app/lib/workflow/journey.ts`) derives ten stages with one next permitted action from page and editor facts; the `JourneyStrip` under the header shows it; "Prepare PCB" starts the same preparation the button starts (bindings → publication → preflight); apply, qualify and release stay their own clicks; the "prepare-pcb" composer hint carries the intent across the approval | `app/lib/workflow/journey.ts`, `app/components/workflow/JourneyStrip.tsx`, `app/page.tsx`, `app/components/pcb/PcbEditor.tsx` (facts bridge, sync request token) | `pr-c-journey` (34), `pr-c-journey-strip` (4) |
| the proposal was lost on reload (trace §2 a) | a pinned proposal is stored per project and offered again only against the same base digest; approval or discard clears it | `app/lib/project/pending-proposal-store.ts`, `app/page.tsx` | `pr-c-pending-proposal-store` (4) |
| F-08 silent sync returns; unnamed non-atomic parts (trace §3 a, c, d) | every guard speaks; unresolved instances are listed by refDes with the missing fact and the review path BEFORE any server call (fail closed, nothing published); a blocked preflight mounts the existing readiness panel per blocker | `app/components/pcb/PcbEditor.tsx`, `app/lib/pcb-sync/unresolved-instances.ts` | `pr-c-unresolved-instances` (9), `pr-c-sync-feedback` (9), `pr-a` [PR-A 6] |
| a stale apply lost its reason (trace §3 e) | the apply 409 carries `code` (the first blocker's, else `PS_APPLY_<STATUS>`) and a sentence; the editor says the plan is stale and withdraws the Apply buttons | `app/api/pcb-sync/handler.ts`, `PcbEditor.tsx` | `pr-c-apply-blocked-code` (7) |

Owner-decision record: OD-242 (OWNER_DECISIONS.md) re-pins OD-106's byte tripwire on `build-multi` to the new sha256; the route
stays outside the B21 DAG and the import gate is unchanged.

### C — the live journey in normal mode (2026-10-16, CONFIRMED)

One bounded request through the real page with the owner's key (`validation.md` §C, `live-spend.json` LR-1): the circuit
request became a complete proposal (8 parts, all with atomic authority), the approval applied it, "Prepare PCB" prepared the
bindings, publication and preflight, the human's apply made the durable board, and the human's "Qualify & route" placed and
routed it with the bundled FreeRouting (0 unrouted, 0 shorts, parity pass). No stage hung, returned silently or invented a
pass; the only refusals were Anthropic's rerank calls (no credits), which the part search tolerates. Known limits recorded:
the loop deadline refuses a new turn but does not abort one in flight (the request took 47.7 s against a 40 s deadline);
the post-approval automatic passes (layout critic, review) spend provider budget outside the request's reservation ([PR-L6 spend, 2026-10-19] SPEND-3: since bounded - one attempt each, and each request's input admitted against a 200000-token ceiling before any provider call, refused with 413 `POST_APPLY_INPUT_BOUND_EXCEEDED` above it; [PR-L6 spend, 2026-10-19] the attack review: the 3,000-token "high" image allowance only for the documented gpt-5.6-sol / terra / luna, an image at an OpenAI model with no documented cap refused as 413 `POST_APPLY_INPUT_UNBOUNDED`, the image charged at the router's serving model, and a reported input above its bound latching Tidy and Review closed until restart; the BOM view's live distributor pricing after an apply is a cached, table-bounded distributor quota read only while the BOM tab is open, not an AI bill - accepted); release
was not exercised live (an administrator's irreversible act; the fixture proves it).

## E — the interface simplified in place: what landed per fault (2026-10-16)

| fault | fix | files | tests |
|---|---|---|---|
| R4 the empty-sheet hint pointed "above" at a closed chat | one labelled entry action that opens the chat and focuses the composer through the journey's `describe_circuit` action | `app/page.tsx` | `e2e/simple-workspace` step 1; `pr-a` (source) |
| R4 / C19 the Settings gear had no handler and no name | **Workspace settings** dialog holding the existing settings (sheet size; AI Brain, model/context/embeddings, agent autonomy, Tier-3 line; runtime); Escape closes, focus returns; the chat header keeps a one-line summary | `app/page.tsx`, `control-registry.ts` (`view.page-settings`) | `e2e/simple-workspace` step 2; `pr-a` (source); b24-d3 |
| R4 the 3D tab was a placeholder literal | `PcbEditor presentation="3d"`: an accurate unavailable state with "Open the PCB tab" (no board) or the PCB editor's own `PcbPreview3D` (one renderer) | `PcbEditor.tsx`, `app/page.tsx`, `control-registry.ts` (`view.pcb-3d-open-pcb`) | `e2e/simple-workspace` step 3; `pr-a` (source) |
| F-07 decorative design checks | `computeDesignChecks` from the authoritative schematic and the loaded catalog parts; pass / findings / not run (reason); digest-bound; "not run" is never a pass | `app/lib/schematic/design-checks.ts`, `app/page.tsx` | `pr-e-design-checks` (3); `e2e/simple-workspace` step 4 |
| F-30 the design checks were unreachable in Build mode (the default): the block sat in the Theory-only JSX branch | one `designChecksFooter` rendered under both library panels (`BuildLibraryPanel` + footer in Build mode) | `app/page.tsx` | `e2e/simple-workspace` step 4 (failed before the fix, passes after) |
| F-31 the canvas sheet-size select overlapped the toolbar's rails at ≤1366 px and duplicated the Settings control | removed from the canvas chrome; Fit and Go to stay | `app/page.tsx` | `e2e/simple-workspace` step 5 + screenshots; `minimum-width` (3) |
| visual noise (blur, heavy shadows, gradient logo) | class-only styling pass in 15 files | `app/components/**` | eslint; the full fixture specs above |

## D — AI semantic parity with the permitted UI operations: what landed (2026-10-16/17)

| requirement (section D) | what landed | files | tests |
|---|---|---|---|
| D.1 a current coverage matrix from actual surfaces and routes | derived at run time from the action, route, control and tool registries and the exposure/tier/grant/authorization facts; 922 rows (107 action, 763 control, 52 tool); CSV + summary committed | `app/lib/engineering/parity-matrix.ts`, `scripts/generate-pr-d-coverage-matrix.ts`, `ui-agent-command-coverage.csv`, `-summary.json` | `pr-d-coverage-matrix` (13): drift, closed set, reasons, gaps, exposed ids have handler + validation + test |
| D.2 a disposition per meaningful operation, no unexplained row | closed set of nine dispositions, every reason names the registry fact; 54 `missing` rows carry their gaps (OD-245 lists the lead's reading of the 14 records) | same | same |
| D.4 missing high-value shared commands — the vertical slice | `sirkit.schematic.generate-proposal` (the Build composer's generation as a Tier 2 sealed proposal through the chat port, OD-243); `sirkit.pcb-sync.preflight` (the Prepare PCB pre-server checks as a Tier 0 read, OD-244); `sirkit.parts.catalog-inspect` (one catalog part by id through the injected catalog port, OD-244); `sirkit.component.review-request` registered unavailable with its reason (OD-244) | `app/lib/schematic/build-multi-generation.ts`, `app/lib/agent/generation-proposals.ts`, `app/api/chat/schematic-generation-runtime.ts`, `app/lib/pcb-sync/preflight-read.ts`, `app/lib/agent/pcb-sync-preflight-reads.ts`, `app/lib/atomic/catalog-part-detail.ts`, `app/lib/agent/catalog-inspection-reads.ts`, `app/api/chat/catalog-inspection-runtime.ts`, the registries | `pr-d-generate-proposal` (19), `pr-d-pcb-sync-preflight` (11), `pr-d-catalog-inspect` (13), `pr-d-review-request-unavailable` (3), `pr-d-parity-*` (25) |
| D.5–6 the same domain authority and validations for UI and AI | the route is a thin caller of the ONE generation the tool runs; the preflight read calls the editor's own unresolved-instance functions; the catalog read and the parts route share one reader; agent authority stays narrower (proposal-only, read-only, MCP withheld) | OD-243, OD-244 | the parity suites: equal permitted effects, equal validation refusals, denied discovery, failed invocations |
| D.7 no release / purchase / publication / credentials / arbitrary transfer, shell, SQL, files | unchanged: Tier 3 and the never-exposed ids stay outside `INTENTIONAL_AGENT_EXPOSED_TOOL_IDS`; the matrix shows them human-admin-only | `agent-exposure.ts`, `permission-tiers.ts` | `b17-f-agent-exposure`, `b18-c-exposure-lift`, `b21-c-no-elevation`, the parity suites |
| D.8 honest "currently available" discovery | the new reads and the generation are discovered only with their facts (validated schematic + digest; the catalog port; the generation port + Build sheet + budget); B11's recorded capsules now show the preflight read wherever a schematic is | `tool-discovery.ts`, `context.ts`, `evaluation-cases.ts` | B11 19/19 cases, 62/62 checks; B09/B10/B19-E/B21-C toolset pins (moved with dated notes) |
| D.9 registry-backed manuals | 52 manuals + manifest with a digest pin; examples validated; units "not declared" where no source declares them (OD-247) | `tool-manual.ts`, `scripts/generate-pr-d-tool-manuals.ts`, `manuals/` | `pr-d-tool-manuals` (17) |
| D.10 coverage / drift gates | the matrix drift gate; the manuals digest gate; B17's unclassified-control refusal; the route↔policy bijection (b16-0-1) already fails an unclassified route, so no duplicate was added | — | `pr-d-coverage-matrix`, `pr-d-tool-manuals`, `b17-a`, `b16-0-1` |
| the page's intake of the generated proposal | the same review dialog, the same store, no auto-apply (OD-246) | `app/page.tsx`, `app/lib/project/generation-proposal-events.ts` | `pr-d-page-intake` (11; source-reading + receiver/currency unit cases); browser proof deferred to G |

Open after D (recorded, not hidden): no cancellation seam inside `runBuildMultiGeneration` (an abandoned generation runs to its own
≤ 40 s deadline); provider availability is the key's presence; the flag-on DAG path does not count the generation as the run's
artifact; the fourteen `missing` action records; the review request stays unavailable; the intake has no browser proof yet.
