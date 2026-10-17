# Missing parts in the ordinary workflow (product reliability F, fA — the UI side)

Owner's assignment: `artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` section F (F.1–F.5) and
`artifacts/astra-guided-pcb/CONTINUATION.md` section C. Date: 2026-10-17. Fixture-backed throughout: nothing here is a live claim.

## What changed

Before this checkpoint an unresolved part was a row in the Schematic → PCB refusal (`PcbEditor.tsx` SyncBlockersPanel,
`data-testid="sync-blockers"` / `sync-unresolved-<refDes>`, from `app/lib/pcb-sync/unresolved-instances.ts`: `published_exact_revision`
| `symbol_asset` | `theory_symbol_only`, one review-path sentence each) and a count in the journey strip's "Parts & footprints" stage.
It is now a WORKFLOW ITEM:

| Surface | What it does now | File |
| --- | --- | --- |
| The refusal rows | Each row keeps its missing fact and review path and expands (per row, on click) into the **missing-facts checklist** with the **next actions** in F's order. Test ids kept: `sync-blockers`, `sync-unresolved-instances`, `sync-unresolved-<refDes>`, `data-missing`. | `app/components/pcb/MissingPartsList.tsx` (new), `app/components/pcb/PcbEditor.tsx` (SyncBlockersPanel area + `missingPartsRequestToken`) |
| The checklist and the actions | Pure derivation: facts known / unknown / conflicting with their source label; the four classes kept apart; a Theory symbol "not a physical part"; the actions' availability with the exact reason when not available. | `app/lib/parts/missing-facts.ts` (new) + `app/lib/parts/__tests__/pr-f-missing-facts.test.ts` (15 tests) |
| The journey strip | The parts stage says **"N missing part(s): no published exact revision, symbol, footprint or pin-map authority"**; its one action "Resolve parts" (`fix_blockers`) opens the PCB tab's Missing parts list even when no run has refused yet. | `app/lib/workflow/journey.ts`, `app/page.tsx` `handleJourneyAction` |
| The Build sidebar | A **"Missing parts (N)"** line beside the design checks footer (`data-testid="missing-parts-open"`, count from the same pure `listUnresolvedInstances` over the authoritative schematic); it opens the PCB tab and shows the list; with none missing it says "Missing parts: none" and opens nothing. | `app/page.tsx` (designChecksFooter, `openMissingParts`, `missingPartsRequestToken`) |

Nothing new may approve, publish, bind, buy or mint authority: every control is a read, a navigation, or opens the existing human
request form; the server-side authorities (catalog, acquisition admission, publication governance, physical-binding review) are
unchanged and not called in any new way.

## The checklist contract (`app/lib/parts/missing-facts.ts`, schema `sirkit.missing-facts-checklist.v1`)

Input: the unresolved instance (`UnresolvedInstance`), the instance's own schematic facts (value, part id, exact revision and symbol
asset ids, Theory type), the catalog part record as loaded by the page's parts cache (`loaded` / `loading` / `unavailable` / `none`),
optional sourcing observations (external-search hits), and whether a project is open.

Output: eight facts in three classes, each `known | unknown | conflicting` with the label of the source that decided it:

| Class | Facts | Known only from | Never from |
| --- | --- | --- | --- |
| Identity | manufacturer, exact MPN, package variant | the catalog part record (`CachedPart` / `CatalogPartDetail`: `mpn`, `manufacturer`, `packageNormalized`) | a distributor's spelling (an identity HINT: it can make the record's fact **conflicting**, never known); a footprint hint is "a library hint, never package proof" |
| Evidence | symbol, footprint, pin-to-pad mapping — import-review.ts's `pcb_assignable` needs, verbatim (`EVIDENCE_NEEDS`, gate-tested equal to `importReviewProfileNeeds("pcb_assignable")`) | a published, never withdrawn atomic revision linked to the instance's value (`atomicAssignments[valueKey] ?? atomicAssignments[""]`, a withdrawn key has no fallback) | a KiCad library drawing ("a drawing, not a published symbol asset"), a footprint hint, a pin count ("a pin count, never a pin-to-pad mapping"), any vendor text |
| Stock and pricing | stock, pricing | sourcing observations, labelled with their source and `source-registry.ts` `ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING` ("a sourcing observation - never proof of exact-part-identity, electrical-pin-mapping, symbol, footprint, package-geometry, cad-correctness") | — they never flip an identity or evidence fact to known (tested) |
| Theory (F.5) | all identity and evidence facts | nothing: "not a physical part: a Theory symbol names no manufacturer part, package or pins" | a distributor hit (the symbol stays non-physical whatever a distributor says; tested) |

`symbol_asset` (a published revision without its installed symbol asset): the symbol fact says "re-place the part from its published
revision"; the review and the draft are **not available** ("a published revision exists for this instance: re-place the part from it").
A part whose record already links a published revision (`published_exact_revision` because the instance was placed without it): the
evidence is known from THAT revision and the headline says to place it from the Build Library (Use published exact revision); the
review and the draft are not available for the same reason.

## The next actions, in F's order, over what exists

| # | Action | Reuses exactly | Available when | Not available (reason shown beside the disabled control) |
| --- | --- | --- | --- | --- |
| 1 | Search catalog | `POST /api/parts/search` (the Build Library's catalog read, `BuildLibraryPanel.runSearch`'s route), then `GET /api/parts/[id]` for the first 5 hits (the Build Library's "Use published exact revision" source, `app/lib/atomic/catalog-part-detail.ts`) — each hit says "published exact revision <id>" or "no published exact revision" | an MPN, part name or value exists to search by (Theory: "<type> <value>") | nothing to search by |
| 2 | Search distributors | `POST /api/parts/external-search` with the bounded query (1..64 printable ASCII, `boundedExternalQuery`), `mode: exact` when an MPN is known else `keyword`, `limit: EXTERNAL_SEARCH_MAX_LIMIT`; every source's state is shown in the Build Library's words (`externalSourceStateWords`: live/memo · N found, paused until …, search failed, no candidate search, disabled (OD-xx), blocked, switched off by the operator, not configured); the hits feed the checklist as sourcing observations only | a project is open and a query fits the bound | no project ("the distributor search is a member's read of that project"); no searchable text |
| 3 | Request review | the EXISTING `AtomicPublicationReviewSection` (`app/components/parts/AtomicPublicationReviewPanel.tsx`, `POST /api/components/atomic/publication submit_request`) opened inline under the row with the prefill (exact MPN, manufacturer, part id); a person submits, a reviewer approves, a different administrator publishes; the server decides the governance project (OD-37) and the roles | a project is open and no published revision already answers the row | no project; `symbol_asset`; a published revision exists for the part |
| 4 | Create unverified draft | the SAME request path with the symbol and footprint named BY REFERENCE (`symbol: {library: libraryName, name}`, `footprint` parsed from the record's `Library:Name` hint) and profile `pcb_assignable`: the server assembles the draft (`assembleAtomicDraft`, `app/lib/atomic/authoring.ts`, through `publication-review.ts`) as a PENDING request — explicitly UNVERIFIED, not PCB-assignable until the deterministic mapping checks and the human approval + publication pass | as 3, plus a record with an exact MPN, a symbol drawing and documented pins | Theory ("no documented dimensions or pins to draft from"); no record; "no exact MPN: a draft is of one exact manufacturer part"; "no symbol drawing to reference"; "documents no pins: a draft without a pin table cannot be mapped" |

Why `/api/parts/search` and not `/api/components/atomic/search` for F.1: the atomic search route requires a structured
`ComponentQuery` bound to a `catalogSnapshotId` the browser does not hold (a mismatch is a 409, `app/lib/atomic/search.ts:104`) and
has no UI caller; the published exact revisions a catalog part links are what `GET /api/parts/[id]` answers (`atomicAssignments`),
which is the Build Library's own path. The component-binding review (`ComponentReviewPanel`, `/api/physical-bindings
request_atomic_review`) needs an exact revision on the instance, so it is not the review of a MISSING part; the atomic publication
request is, and it is what the Build Library's "Request evidence review" opens too.

No member-callable route creates a free-standing draft: the draft exists only as a publication request (the server assembles and
reviews it). That is why action 4 is "the same request path with the references prefilled", and why it is `not_available` with the
reason whenever the documented facts (exact MPN, symbol reference, pin table) are missing — never a fabricated draft.

## Control registry and accessibility

`app/lib/engineering/control-registry.ts` ([PR-F fA, 2026-10-17]): `dispatcher.missing-part-actions` (one button per row and
action, dispatching to `parts.catalog-read`, `parts.external-observation-read`, `parts.atomic-publication-review`),
`view.missing-parts-list` (checklist toggle, inline request Close), `view.page-missing-parts` (the sidebar line). B17-A inventory
636 → 640 sites, 64 → 65 surfaces; B24-D3 census regenerated (in scope 168, unnamed 0); every new control has an accessible name
(button text, or `aria-label` "Show/Hide the missing-facts checklist for <ref>" / "Close the publication request for <ref>").
Pins moved with dated notes: `b24-d3-accessible-names` `PAGE_LINES_AT_3773C6A` 8690 → 8705; `b21-e2-run-view` page markup
`onClick=` 81 → 82, `<button` 40 → 41 (the sidebar line); `pr-c-journey` note regexes "unresolved part" → "missing part";
`artifacts/ai-control-plane-b24/accessibility.md` citation rows re-pointed by the refresh script (19 rows, 0 problems); the PR-D
coverage matrix regenerated (the three new control sites classified, 922 → 928 rows).

## Fixture proof (`e2e/pr-f-missing-parts.spec.ts`; fixture runtime, scripted agent, in-memory stores, frozen clock)

Run: `SIRKIT_ACQUISITION_DISABLED_SOURCES=digikey,octopart timeout 900 pnpm exec playwright test e2e/pr-f-missing-parts.spec.ts
--reporter=line` — 1 passed (11.8 s) on the third run (2026-10-17); `playwright-report/` and `test-results/` deleted afterwards.
Screenshot: `screenshots/after-f-missing-parts-1366x768.png` (the PCB tab's Missing parts list for L1 with its checklist, the
four actions, the distributor source states and the review handoff open).

What the run proved, in order (every assertion is in the spec):

1. The recorded blinker design is described, proposed and approved (the journey-contract steps).
2. A Theory **inductor** is placed on the sheet (Theory mode → Theory Library → Inductor → one canvas click → Build mode); the
   sidebar line reads "Missing parts (1)" (`data-count="1"`) before any PCB run.
3. Prepare PCB from the journey strip refuses BEFORE any server call: `sync-blockers` with `data-kind="unresolved_instances"`, exactly
   one row with `data-missing="theory_symbol_only"` and `data-physical="false"` (L1), the empty state still shown (no board), the
   parts stage `blocked` with the title "… 1 missing part: no published exact revision, symbol, footprint or pin-map authority", the
   one action `fix_blockers` "Resolve parts".
4. The checklist expands: headline "not a physical part"; manufacturer, exact MPN, package variant, symbol, footprint, pin-to-pad
   mapping, stock all `unknown`; Create unverified draft `data-available="false"` with the reason "not a physical part …".
5. Search distributors: the fixture server's `POST /api/parts/external-search` answered `ok: true`, every source in a no-call state
   (DigiKey `operator_disabled`, Mouser `disabled` (OD-32), Octopart (Nexar) `operator_disabled`, LCSC `blocked`), `servedFrom` null and
   `hitCount` 0 for each, `hits: []`; the list shows each source's state (`missing-source-L1-<id>` with `data-served-from="none"`) and
   "No sourcing observation: no admitted source answered."; no `missing-hit` row; stock and exact MPN still `unknown`.
6. Request review opens the existing publication review handoff inline (`missing-review-L1`, `data-kind="review"`, the
   `atomic-publication-panel` with its banner "A bundle proves nothing; only a published atomic revision controls schematic/PCB"); the
   fixture has no governance project, so the viewer reads "Unavailable (ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED)" and the alert
   says publication happens only in the catalog governance project — nothing was requested.
7. Dismiss → the Schematic tab → "Missing parts (1)" → the PCB tab's list is back with the same row, still no board.
8. `page.on("request")`: no browser request left the origin for the whole test (the collector is asserted empty at the end).

Two findings from the runs, recorded as data:
- The registry id of Nexar is `octopart`, so the operator switch must name `digikey,octopart` (run 1 had named `nexar`; the fixture
  then answered `credentials_missing` for Octopart — still no call, since no credentials are configured, but the switch is the
  guarantee the proof relies on, not the absence of a developer's credentials).
- A Theory **resistor** cannot be placed beside the recorded design: `nextTheoryDisplayRef` (app/lib/engineering/schematic-graph.ts)
  numbers Theory references over the Theory components only, and the canonical validation then refuses "display reference R1 is
  already in use" (the KiCad R1) — nothing is applied, with a toast. The proof therefore places an inductor (L is free). The
  cross-family numbering is a pre-existing gap outside this assignment's files (open issue for the lead).
- The PCB empty state centred its column with plain `justify-center`: once the Missing parts list made the column taller than the
  viewport, its top (the Dismiss control, the first rows) was clipped beyond reach (run 2 failed there). It is now `justify-center-safe`
  (Tailwind 4.3 ships it): an overflowing column starts at the top and scrolls.

## Live blockers (unchanged by this checkpoint; nothing here is a live claim)

- **Admitted distributor credentials.** DigiKey and Nexar are admitted by the registry but answer `credentials_missing` without the
  operator's own credentials (`admitSource`, `app/lib/acquisition/source-registry.ts`), `operator_disabled` under
  `SIRKIT_ACQUISITION_DISABLED_SOURCES`; Mouser is `disabled` (OD-33) and LCSC `blocked` by the registry. A live search spends metered
  vendor quota and is the owner's decision; no live search was made for this checkpoint.
- **The catalog database.** `POST /api/parts/search` and the parts cache read the catalog database; the fixture runtime has no
  `DATABASE_URL` and serves only the committed blinker catalog parts by id, so under the fixture the catalog search answers its honest
  failure sentence and the published-revision facts come from the fixture catalog's links.
- **Human review and publication.** The publication request is refused unless the project is the catalog governance project
  (`SIRKIT_ATOMIC_CATALOG_TENANT_ID` / `SIRKIT_ATOMIC_CATALOG_PROJECT_ID`, `ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED` otherwise); a
  reviewer's approval and a different administrator's publication are human acts the UI only requests. The fixture has no governance
  project, so the handoff shows that unavailable state truthfully.
