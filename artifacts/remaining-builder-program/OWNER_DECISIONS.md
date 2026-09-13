# Owner decisions register

Decisions the program cannot take safely on its own. Each row states the safe default the builder applied (if any) and what changes if the owner decides otherwise. Nothing here was executed without a safe default.

| # | Origin | Decision | Safe default applied | Status |
|---|---|---|---|---|
| OD-1 | B16.1C | DRC preset `jlcpcb-2l` uses one `minAnnularRingMm 0.15` for vias AND plated-through holes; JLCPCB states PTH absolute min 0.18 mm (rec. 0.25 mm) | CLOSED 2026-09-09 (B16-C.4): live page re-fetched, limits split (`minAnnularRingNm` via 0.15 mm, new `minPthAnnularRingNm` 0.25 mm = manufacturer RECOMMENDED; 0.18 mm absolute recorded, not enforced); profile schema v2 with source URLs / retrievedAt / expiresAt / scope; v1 profiles refused at release. Owner may relax 0.25 -> 0.18 mm by editing `jlcpcb-2l.json` (a re-record of the pinned identities follows). See `artifacts/ai-control-plane-b16-closeout/fabrication-rule-authority.md` | closed (builder default 0.25 mm; owner may relax) |
| OD-2 | B16.1C | `bind_atomic_selection` requires reviewer/project_admin; a `pcb_editor` cannot complete Schematic → PCB alone | B16-C.2 adds a visible review handoff; editors are NOT silently granted reviewer power; 403 for insufficient permission | CLOSED 2026-09-09 (B16-C.2, `fc9450b`): editors request review, reviewers/admins approve or reject under their own identity, requests retire on revocation or role change; the browser proof exercises the handoff end to end |
| OD-3 | B16.1C | A routed board refuses structural re-sync (Stage 8 copper protection); no product path for post-qualification design changes | B16-C.1 implements a new routed-board revision path (old board + releases immutable); in-place rip-up only as Tier 2 with preview/inverse | CLOSED 2026-09-09 (B16-C.1): derived board revision `<root>@r<n>` with a reviewed rework plan and per-net equivalence proofs; the old board and its ledger stay immutable and are refused for qualification/release (`MFG_BOARD_SUPERSEDED`). NO in-place rip-up command was provided (would need the Tier 2 destructive-edit machinery; RECORDED, never a silent fallback) |
| OD-4 | B16.1C | physical-bindings route maps `HUMAN_REVIEWER_REQUIRED` to HTTP 422 | B16-C.2 changes to 403 with a regression test | CLOSED 2026-09-09 (B16-C.2): 403 `PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED` naming the `request_atomic_review` handoff; regression test in `b16-c-review-handoff.test.ts` |
| OD-5 | B16.1B | Drizzle migration 0027 (RLS/policies) is not journal-registered; migrations not deployable through the supported toolchain | B16-B provides one supported migration mechanism with tests against a disposable PostgreSQL when available | open (scheduled B16-B) |
| OD-6 | B16.1B | No isolated Supabase project/account for live auth qualification | stays BLOCKED-LIVE-QUALIFICATION; deterministic seams used | needs owner resource |
| OD-7 | B16.1C | No provider credits for a real LLM turn | fake provider adapters in CI; live turn UNKNOWN | needs owner resource |
| OD-8 | runbook §2.4 | Merging chapter PRs normally after green CI is authorized by the runbook; no force-push, history rewrite, access/billing change, live purchase or production data destruction is authorized | builder merges normally only after gates | standing |
| OD-9 | B16-B | `schema.ts` lacks 16 integrity constraints that exist only in the hand-written migrations (durable-workflow CHECK/FK, deferrable binding FKs); re-aligning it changes what `drizzle-kit generate` diffs against | migrations are the delivery truth; `db:push` refused; `schema.ts` left as the ORM's typed view | open (owner: align schema.ts or accept the split) |
| OD-11 | B18-B | The explicit-request grammar (the proof that lets a Tier 1 operation execute WITHOUT confirmation under `execute_explicit_tier1`) covers `pcb.move-footprint` only (absolute/relative moves in mm/mil/nm with a named footprint, whole-message, byte-equal derivation); the other five Tier 1 families always preview + confirm | Conservative default: an unproven instruction is never executed, only previewed. Owner decides whether B18-C adds grammars for rotate/flip, arrange, silkscreen text and the schematic families (each a pinned, tested derivation), or keeps confirmation for them | resolved in B18-C: explicit grammars for move (I3), rotate/flip (I5) and undo/redo (I8; 1.4.0 after review 3); arrange, silkscreen text and dimensions stay confirmation-only — DECIDED (multi-target ambiguity, free text placed by the AI, annotation geometry the human must see); the owner may ask for more grammars |
| OD-12 | B18-B | `/api/chat` now MINTS durable execution grants (classification durable read-write, sensitivity session-identity) while its policy row stays `authenticated-propose` with `authoritativeWrite: false` — the grant is not an engineering write (the commit stays in the browser's canonical session under the human's session), but it is a durable authority artifact | Row left unchanged; the truth is recorded in the classification comment and here. Owner decides whether a grant-minting route should be classified `authenticated-mutation` (which would also require CSRF semantics the streaming route already has) | open (recorded) |
| OD-13 | B18-B; dimensions resolved in B18-C I7 | The runbook's PCB Tier 1 list names "change a via to a validated diameter/drill", "add/update/remove dimensions", "add/update/remove ordinary board text/silkscreen" and "edit a selected track segment within validated rules"; the registry's approval vocabulary had `pcb.dimension`, `pcb.edit-via`, `pcb.create-via` and `pcb.edit-track` at `topology-or-geometry` (Tier 2), so the agent could only propose them | Dimensions: re-tiered `reversible` on the action record and the descriptor, following the runbook's explicit list (B18-C I7; documentation layers only, exact inverses, `edit_placement`; confirmation-only). Via diameter/drill and track segment edits: kept Tier 2 proposal-only — a recorded DIVERGENCE from the runbook's list (both change copper and need the `edit_copper` capability the B18 grant model does not carry; a padstack-bound via cannot change size/drill alone, and I9 makes the via proposal path refuse that truthfully). Ordinary board text (`texts[]`): not covered — no editor command writes it, so an executed family would be parallel mutation code; silkscreen TEXT is covered (B18-C I6) | resolved for dimensions; DIVERGENCE recorded for vias, tracks and board `texts[]` (the owner may widen: grant `edit_copper` for validated via/track edits, or add an editor command for board text) |
| OD-14 | B18-B | Undo/redo as an EXECUTED family under a grant needs a canonical `replayUnderGrant` path (the wrapped history undoes the patch synchronously before the canonical reconcile and rebases on failure; the executor forces `provenance.candidateId = "<direction>:<tx>"`), so it is excluded from B18-B | Deferred to a B18-C sub-design (`latestEligibleUndo` + `sameHead` bound as the undo reference; explicit only when the latest eligible operation's actor is `ai`); the user's own undo of a granted commit works today through the ordinary history | resolved in B18-C I8a/I8b: `sirkit.pcb.undo-redo-granted` replays the exact last AI change through `CanonicalEditorSession.replayUnderGrant` (canonical first, never a patch before the executor answers, no rebase under a grant); the server minter resolves the reference from the principal's own settled grants at the head (sameHead = head sequence + lineage; a revision bound would refuse every undo on a board with a refilled pour); an AI undo or redo is a NEW history entry: the user's own Undo afterwards re-applies the change after an AI undo and removes it again after an AI redo (said per direction by prompt 1.2.1, the preview note and the executed answer; corrected in B18-C review 3, A24). Recorded deviation (B03.1): the replay transaction's provenance source is `ui` (the executor forces it) — the AI attribution lives in the history entry's metadata and in the grant store. Browser-proven in B18-C I10b (an AI undo, a reload, an AI redo) |
| OD-10 | B16-C.1 | RC03 refuses a board whose component has an UNCONNECTED pin (`CAP_PIN_PAD_PARITY_UNPROVEN`: every verified pin-pad mapping must appear in a board net's endpoint keys), so a spare/unpopulated-pin header cannot be qualified autonomously; reproduced on the first H.14 recording (2026-09-09) with an unconnected J2 | Pre-existing RC03 rule, left unchanged in B16-C (H.14 uses a connected J2). Owner decides whether intentionally unconnected pins (schematic `no_connect` / `unconnected` disposition) should satisfy parity; B17/B19 can carry the disposition onto the board's pad classifications | open (recorded) |
| OD-15 | B18-C | Schematic Tier 1 execution under a grant (`schematic.set-property`, `schematic.move-rotate`): every schematic operation needs `edit_components`, which the AI actor is categorically refused (`authorization.ts`) and which the B18 grant model does not carry; the execution journal and the ritual are PCB-literal | Deferred: schematic edits stay sealed proposals the human applies (the B15 path); nothing schematic is executable by the agent | open (owner: decide whether an AI grant may carry `edit_components`; a later increment would add schematic descriptors, a schematic journal and ritual) |
| OD-16 | B18-C | Schematic wires and labels (`schematic.connect`): a Tier 2 record with no proposal vocabulary (the Tier 1 schematic proposal covers set-value / rename / delete only); PCB track segments need `edit_copper` (OD-13) | Wires and labels: neither executable nor proposable by the agent; tracks: proposal-only | open (owner: add a bounded wire/label proposal vocabulary, or grant copper edits) |
| OD-17 | B18-D | The chat execution UX design (`artifacts/ai-control-plane-b18/chat-execution-ux.md` §9) leaves eight product choices: D1 pre-result final model text visible with a label (vs collapsed, or ending the run at the preview); D2 extend the Undo/Redo hold to every canonical commit; D3 the chat protocol stays version 1; D4 where the autonomy control lives; D5 the confirmation card and new chat components join the B01 watched surfaces; D6 ship the untraced `tool_refused` event; D7 the Tier 3 hint vocabulary (display only); D8 interim model text moves to the run log for every multi-step turn | The design's recommendations applied: D1 visible with a label (ending the run at the preview would break the B18-C model contract); D2 only as a follow-up if the probe shows the lost-undo window — the probe and a diagnostic CONFIRMED the window for granted executions (B18-D I7), which the hold now closes; extending the hold to every canonical commit (human commits, Smart Route) remains open; D3 yes; D4 the chat header, as an optional increment; D5 yes (a stricter gate); D6 yes, optional; D7 as written; D8 yes (required by Rule 2) | open (safe defaults applied; the owner may choose otherwise) |

## OD-18 — Rule 2 beyond the agent loop (B18-D review, 2026-09-11)

- Question: the runbook's B18-D rule "No model text may claim success before the transactional result exists" was built into the agent loop and the chat entry. Does it also cover the schematic edit route (`/api/schematic/edit`), whose model `note` the page showed as the assistant's answer before the user applied anything?
- Default applied: yes. Rule 2 covers every chat surface: the edit route's note is shown only as a labelled note in the run log ("Assistant note (written before the result): …"), never as the answer and never in the history the next run receives; the answer is the page's own sentence.
- The owner may reverse this; the change is confined to the page's edit flow and `editProposalMessages`.

## OD-19 — Commit identity (2026-09-11)

- Question: runbook §2.4 approves `Dandi Desta <dandidesta82@gmail.com>`; 54 B18 commits used the owner's other address `danditilahun82@gmail.com` (see the ledger's correction). Which address should the remaining chapters use?
- Default applied: the runbook's approved `dandidesta82@gmail.com` (the repository's configured identity) from the next commit on; the earlier commits stay as they are (no history rewriting).
- The owner may choose `danditilahun82@gmail.com` instead, for example if that address is the one linked to the GitHub account.

## OD-20 — Scenario 2's wording (B18-E, 2026-09-11)

- Question: the runbook says "the 5 V net"; the fixture design's rail is named `/root/VCC` (J1 is `PWR_5V`). Prove the verbatim sentence as a truthful no-match (the nets listed, nothing changed) and the change with "the VCC net", recording the deviation — or rename the rail `+5V` in the fixture (the placed-board revision changes and the router recording must be re-recorded)?
- Default applied: the first: the verbatim sentence gets a truthful no-match and the change is proven with "the VCC net"; the deviation is recorded; the fixture is unchanged.
- The owner may choose otherwise.

## OD-21 — What a mounting hole is (scenario 3) (B18-E, 2026-09-11)

- Question: Sirkit has no mounting-hole object. Which footprints count (for example, every pad `np_thru_hole`, or an unconnected plated hole with a `Mounting*` library name), and should the blinker fixture gain holes (every fixture spec and the router recording change) or should the browser prove only the board outline, with holes proven in integration?
- Default applied: a footprint whose pads are all `np_thru_hole`; the fixture is unchanged; holes are proven in integration and the browser proves the outline.
- The owner may choose otherwise.

## OD-22 — Scenario 1's precondition (B18-E, 2026-09-11)

- Question: the move takes footprint ids; a real model resolves R3 from the selection or from board-inspect, whose size on a synchronized board is unmeasured. Record "select the part first" as the precondition, or add a bounded Tier 0 footprint lookup?
- Default applied: record the precondition now; decide on a bounded Tier 0 lookup after E3 measures board-inspect (read-only either way).
- The owner may choose otherwise.

## OD-23 — Scenario 4's meaning (B18-E, 2026-09-11)

- Question: is "the approved lower-power part" the single server-owned exact authority recorded for U1 (B14), with no power claim unless a tool fact states one? And may the fixture runtime gain a CMOS 555 atomic part with an approved mapping, for the browser proof?
- Default applied: yes to the first reading (choosing among several approved alternates would be a new selection authority and is not proposed); yes to a fixture-only part, gated to the fixture runtime with a tripwire.
- [B18-E E16, 2026-09-12] The first half is what the code does. The second half was NOT needed and was not taken: once the
  fixture runtime was given the component-authority sources it was missing, the browser journey already produces a real
  replacement (U1's loose part reference against the exact part its authority records), so no fictional part was added to
  the catalog. Scenario 4 is proven end to end in the browser without one.
- The owner may choose otherwise.

## OD-24 — Scenario 5's controls (B18-E, 2026-09-11)

- Question: "compactly" and "keep decoupling close to U1" are not agent controls today. Expose the spacing preset or decoupling relationships to the agent?
- Default applied: no widening: the chat reports truthfully (the objective's state, or not evaluated).
- The owner may choose otherwise.

## OD-25 — Scenario 6's "redo" (B18-E, 2026-09-11)

- Question: the editor's own undo stack does not survive a reload. Is the runbook's redo proven as the chat's "Redo."?
- Default applied: yes; a redo through the editor's button after a reload is outside B18.
- The owner may choose otherwise.

## OD-26 — Scenario 7a's defensive floor (B18-E, 2026-09-11)

- Question: no production code supplies the live selection digest, so the `selection_stale` burn and the ritual's stale-selection refusal can never fire. Keep them as a pinned defensive floor, or delete them with their display sentence?
- Default applied: keep them, pinned by a synthetic case (E5).
- Measured in E8 (browser): the confirmation card is a MODAL dialog, so while a preview waits the human cannot reach the
  editor at all and the selection cannot change under it — a second, independent reason the burn cannot fire through the
  product. The floor stays a floor; the decision is unchanged.
- The owner may choose otherwise.

## OD-27 — Scenario 7f in the browser (B18-E, 2026-09-11)

- Question: a browser revocation proof needs a revocation switch in the fixture's local membership repository — an auth surface. Add it (fixture runtime only), or keep revocation proven in integration and prove only a clearly labelled role change in the browser?
- Default applied: no auth-surface change: revocation is proven in integration; the browser proves what the fixture can do without one.
- The owner may choose otherwise.

## OD-28 — Scenario 8's display (B18-E, 2026-09-11)

- Question: should an unknown tool name that matches the Tier 3 families show a display-only "T3" tag, and should the answer of a run with a refused call carry a label?
- Default applied: no tag (the line reads "Unknown tool — refused before running (unknown_tool) — nothing ran") and no label; the model's prose is not checked (recorded).
- The owner may choose otherwise.

## OD-29 — Resources for live and routing proofs (B18-E, 2026-09-11)

- Question: a live model run of each scenario needs provider credits (OD-7); a chat routing replay for scenario 5 needs a machine with the FreeRouting runtime to record it.
- Default applied: BLOCKED-LIVE-QUALIFICATION until credits exist; without a recording the routing browser proof is the truthful `routing_engine_unavailable` refusal.
- The owner may choose otherwise.

## OD-30 — CI time (B18-E, 2026-09-11)

- Question: each bootstrapped browser spec adds minutes to page-browser-e2e (timeout 30 min). Accept a longer job, or split it?
- Default applied: accept a longer job while it stays well inside its timeout; split it if a run comes within five minutes of the limit.
- The owner may choose otherwise.

## OD-31 — Who may spend live distributor quota (B19-B I2, 2026-09-13)

- Question: live pricing spends a metered vendor quota (Mouser's is about 1000 queries a month). Before B19 any anonymous
  caller could spend it, and force a refresh. Who should be able to?
- Default applied: a project member, in the BOM workbench (`/api/bom`, authenticated, `providerCredit`), and the
  authenticated snapshot and diff. Exports, the procurement packet and the cart routes stay public and price from the
  cache only, so an anonymous visitor sees cached offers (labelled as such) and never spends quota.
- Not decided here: a per-project or per-user quota budget. Nothing reads `providerCredit` yet; metering it is recorded
  for the source registry (I3).
- The owner may choose otherwise.

## OD-32 — Mouser (B19-A I3, 2026-09-13)

- Question: Mouser's current API terms (last modified 2013-03-11) prohibit caching, recording, pre-fetching or storing
  its content, license display only inside the application, and require the application's primary purpose to be driving
  sales to Mouser. Sirkit's BOM compares several distributors and cached their offers. May Sirkit use the Mouser API?
- Default applied: **disabled** in the source registry. Even if enabled later, Mouser offers are never persisted or
  memoized, never served from a cache, and never bulk-refreshed. Choosing Mouser in the BOM prices nothing and says why.
- To enable: the owner confirms Sirkit's use complies (or obtains Mouser's agreement), and the registry entry is changed
  in a reviewed revision (the artifact gate makes that change visible).
- The owner may choose otherwise.

## OD-33 — DigiKey and Nexar storage, and bulk refresh (B19-A I3, 2026-09-13)

- Question: DigiKey's API agreement prohibits building or updating a database from its data and bulk download, and
  states no retention period; Nexar's terms allow storage for at most 24 hours and prohibit mass aggregation. How long
  may Sirkit keep their offers, may the operator job pre-fetch pricing in bulk, and does a consolidated lifecycle status
  written to `parts` count as a database built from their data?
- Default applied: DigiKey offers are served and kept for at most **1 hour**; Nexar's at most **24 hours**; older rows are
  deleted. The `refresh-bom-pricing` bulk job touches no source (DigiKey prohibited, Nexar unclear), and logs that. The
  derived lifecycle status is left as it was, and recorded here as undecided.
- The owner may choose otherwise (for example: permit Nexar bulk refresh within its plan, or stop persisting derived
  lifecycle status).

## OD-34 — What counts as the same part number (B19-D I5b, 2026-09-13)

- Question: when a distributor answers a request for an MPN, which spellings are the same part?
- Default applied: an exact published MPN compares after trimming surrounding whitespace and upper-casing ASCII letters
  only. Every other character is significant (`MAX3232CSE+` is not `MAX3232CSE`; `LT1086CM#PBF` is not `LT1086CMPBF`). An
  MPN containing anything outside printable ASCII (zero-width or bidirectional characters, homoglyphs, a long s, full-width
  digits) never matches and is refused as an evidence identity. The manufacturer is not compared (distributor manufacturer
  names have aliases Sirkit cannot resolve yet), so two manufacturers publishing the same exact string remain one pricing
  identity.
- Also applied: prices are compared and totalled in USD only; an offer without a USD break has no unit price.
- The owner may choose otherwise (e.g. suffix-insensitive matching for specific manufacturers, or currency conversion).
