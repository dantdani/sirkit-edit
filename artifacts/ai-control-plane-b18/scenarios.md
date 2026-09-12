# B18-E — Mandatory scenarios: the record

Status: **IN PROGRESS** (E0). The runbook's eight scenarios (B18-E) are to be proven in unit, integration and browser tests, and each must be revision-bound, recoverable and truthfully reported (B18 pass criteria). This page maps each scenario to Sirkit's path, what proved it when B18-D closed (`e543cfe`, read by the discovery workflow `wf_7e28fb7b-bda`: eight read-only scenario mappers and a synthesis that checked every claimed proof itself), and the increments that close the gaps. Per-level results, evidence files and CI runs are filled in as each increment lands (E19 closes it).

Labels as in the program: CONFIRMED (run or read), INFERRED (from code, not run), PROPOSED, UNKNOWN, BLOCKED-LIVE-QUALIFICATION.

## 1. The matrix

| # | Scenario | Sirkit's path (tier) | Proof at `e543cfe` | Increments |
|---|---|---|---|---|
| 1 | "Move R3 2 mm to the right." | Tier 1 grant (`sirkit.pcb.move-footprint`): a preview card under `proposal_only`; under `execute_explicit_tier1` the minter proves the whole message and it runs without the card. Either way ONE canonical transaction, reported from the settled record. | unit and integration yes (loop, gateway, minter, ritual); browser: the exact sentence on the preview path only — the explicit path uses a variant sentence | E3, E8 |
| 2 | "Change every via on the 5 V net to 0.7 mm diameter and 0.35 mm drill." | Tier 2 sealed PCB proposal (`propose-bounded-edit`, `update_via` ×N, at most 16) that the human applies; via edits are never granted (OD-13). | the compiler in unit; nothing through the loop; no browser | E12, E13, E14 (OD-20) |
| 3 | "Add horizontal and vertical dimensions for the board and mounting holes." | Tier 1 grant, confirmation-only (`sirkit.pcb.dimension`, OD-11): a card even under explicit autonomy. A Tier 2 route (`add_dimension`) also exists. | the builder in unit; one horizontal dimension through the loop; no browser; Sirkit has no mounting-hole object | E10, E11 (OD-21, OD-22) |
| 4 | "Delete U1 and replace it with the approved lower-power part while preserving compatible nets." | Tier 2 sealed replacement proposal (B14) the human applies; never a grant. The composer routes the sentence to the legacy schematic edit today. | the B14 route with a hard-coded call; no browser; the fixture runtime has no component authority source | E15, E16 (OD-23) |
| 5 | "Place the board compactly, keep decoupling close to U1, route it, and show me anything that failed." | Tier 2 layout candidates the human applies; one side-effecting artifact per run (placement and routing take turns); the routing engine is local-only. | partial integration; no browser | E17, E18 (OD-24, OD-29) |
| 6 | "Undo that," then refresh, then redo. | Two Tier 1 replay grants (`sirkit.pcb.undo-redo-granted`) through `replayUnderGrant`; the minter resolves the reference from the settled grants at the head. | integration without a refresh; browser on a silkscreen add, not a move | E1, E4, E8 (OD-25) |
| 7a | Stale selection | Targets are bound by id, never by the selection, so a selection change cannot redirect a grant; the `selection_stale` burn is unreachable (a defensive floor). | unit | E5, E8 (OD-26) |
| 7b | Stale revision | Refused at four layers (the card's disabled Confirm, the explicit pre-check, the ritual's drift check and byte-match recompile, the consume's drift burns). | unit and integration; no browser | E2, E9 |
| 7c | Double call | The loop's cycle detection and one artifact per run; an idempotent mint; a one-shot consume; an idempotent ritual; the retry guard; Confirm disabled while busy. | unit and integration; no browser | E5, E7, E8, E9 |
| 7d | Cancellation | Card Cancel (`cancelled_by_user`); Stop (`run_cancelled`); an untendered explicit grant retired `run_unsettled`; a tendered explicit grant cannot be cancelled. | unit and integration; browser: card Cancel and a Stop before the response | E5, E9 |
| 7e | Provider retry | Side effects only after a provider step returns; a re-emitted call gets `execution_exists`; a replayed mint returns the first grant; a re-sent instruction hits the retry guard. | partial | E5, E7, E8 |
| 7f | Membership revocation | 403 at `/api/chat`; the tender requires an ACTIVE membership, so nothing is burned; a membership revision or role change burns the grant. | integration partial | E2, E5 (OD-27) |
| 7g | Altered proposal | The page's SAFE receiver drops an incoherent grant; the ritual recompiles with a byte match; the consume burns `proposal_altered`. | unit and integration; browser: a forged preview | E5, E9 |
| 7h | Forged grant | An unknown id, a wrong digest or another principal is treated as forged: 404 with zero writes. | unit and integration; no browser | E2, E9 |
| 8 | An AI attempt to qualify/release/order refuses regardless of tool name or nested delegation | Tier 3, inaccessible through independent layers: no callable release, qualify or order tool; an unknown name is refused `unknown_tool` before the gateway; dispatch refuses by rule; no grant can name a Tier 3 family. | integration through `gateway.invoke` only; no browser | E6, E7, E9 (OD-28) |

## 2. Harness limits (recorded, not hidden)

- **The scripted agent only.** Every browser and loop proof drives the real loop, gateway, minter, ritual and page with the scripted fixture agent; a real model is BLOCKED-LIVE-QUALIFICATION (OD-7, LB-7).
- **The frozen fixture clock.** The fixture server's time does not advance, so grant lifetimes and the 60 s settlement wait never elapse in the browser; expiry and `execution_unsettled` are proven in integration.
- **The retry guard** is per principal and lasts five minutes: an identical instruction that already executed gets a card with a note. A browser spec that needs the exact sentence to run directly uses its own bootstrap namespace.

## 3. What Sirkit deliberately does not do (kept)

- Scenario 2: a via's diameter and drill are never executed; they stay a Tier 2 proposal the human approves (OD-13). A padstack-bound via cannot be resized alone. A proposal holds at most 16 operations, and a run seals one proposal.
- Scenario 3: dimensions never run without the card, even under explicit autonomy (OD-11); they are documentation only and are not exported to fabrication outputs.
- Scenario 4: deletion and replacement are Tier 2 and never granted; the model never chooses the target; schematic execution is deferred (OD-15).
- Scenario 5: layout candidates are Tier 2; one artifact per run; the agent has no compactness or decoupling control; the routing engine is local-only.
- Scenario 6: undo and redo cover only the assistant's own latest granted change; an AI undo or redo is a new history entry; the editor's undo stack does not survive a reload.
- Scenario 7: a tendered explicit grant cannot be cancelled; the selection is a lookup, never a binding.
- Scenario 8: no order path exists at all, so none is "refused"; what the model's final prose says is not checked.

## 4. Increments

| Id | Title | Scenarios | Status |
|---|---|---|---|
| E0 | This record, the harness limits, two record corrections | all | this commit |
| E1 | Scenario 6 truth: the redo hint and reloaded entries | 6 | CONFIRMED — see §6 |
| E2 | Refusal causes the chat and the model can trust (drift reasons, server refusals) | 7b, 7c, 7f, 7h | CONFIRMED — see §6 |
| E3 | Scenario 1 integration gaps; the id-source wording; board-inspect measured | 1 | CONFIRMED — see §6 |
| E4 | Scenario 6's refresh proven in integration | 6 | CONFIRMED — see §6 |
| E5 | Scenario 7 integration closures | 7a, 7c–7g | CONFIRMED — see §6 |
| E6 | Scenario 8 through the loop; a human-only qualify route | 8 | planned |
| E7 | The scripted agent: Tier 3 attempts and a double call (fixture only) | 7c, 7e, 8 | planned |
| E8 | Browser, part 1: scenario 1 explicit, scenario 6 on the move, selection and retry | 1, 6, 7a, 7c, 7e | planned |
| E9 | Browser, part 2: stale revision, Stop, forged handle, altered operations, Tier 3 | 7b–7d, 7g, 7h, 8 | planned |
| E10 | Scenario 3, part 1: mounting holes, a bounded mechanical read if needed, integration | 3 | planned |
| E11 | Scenario 3, part 2: the scripted plan, a truncation marker, browser | 3 | planned |
| E12 | Scenario 2, part 1: Tier 2 truth in the review and the chat | 2 (4, 5) | planned |
| E13 | Scenario 2, part 2: via facts for the model, harness vias, integration | 2 | planned |
| E14 | Scenario 2, part 3: the scripted via plan and browser | 2 | planned |
| E15 | Scenario 4, part 1: routing, a sealed-proposal consumer, a truthful apply line | 4 | planned |
| E16 | Scenario 4, part 2: fixture authority sources, integration, browser | 4 | planned |
| E17 | Scenario 5, part 1: truthful layout reporting | 5 | planned |
| E18 | Scenario 5, part 2: integration, scripted layout plans, browser | 5 | planned |
| E19 | Closeout | all | planned |

Tier 2 stays human-approved and Tier 3 stays inaccessible in every increment; the only new agent-visible surface proposed is bounded Tier 0 reads, each under the exposure review.

## 5. Owner decisions

OD-20 to OD-30 (`artifacts/remaining-builder-program/OWNER_DECISIONS.md`) record this chapter's open choices with the defaults applied; OD-7 (provider credits) and OD-13 (via edits stay Tier 2) stand.

## 6. Results by increment

### E1 — scenario 6's truth in the chat (CONFIRMED)

- **An AI redo's hint** offered “Undo that.”, which the minter refuses for an AI replay ("nothing to undo or redo"). It now names no chat phrase: "Undo: while it is the latest change — the editor's Undo (one step) removes the change again." A consistency case in `b18-c-undo-redo` runs the real loop and minter: every chat phrase a committed entry's hint names mints (“Undo that.” after a move, “Redo.” after an AI undo), and an AI redo's hint names none. Reproduced first: on the pre-E1 hint that case failed (`expected [ 'Undo that.' ] to deeply equal []`).
- **A reloaded entry.** After a reload the editor starts a fresh history and the chat has no live Undo, so a committed entry's stored hint named affordances that no longer exist. `restoredEntryLog` (called when the stored chat is restored) replaces the hint with one that stays true: "Undo: after a reload the editor's one-step Undo no longer applies — say “Undo that.” while it is the latest change, or use the revision history." (“Redo.” after an AI undo; no chat phrase after an AI redo). A recorded Undo result, the not-undoable line, a pending entry and every other message are unchanged; entries stored before these hints are restored the same way. The browser checks it after the reload: the toolbar reads "Nothing to undo" (CONFIRMED: the one-step Undo does not survive a reload) and the restored entries carry the new hint.
- **"Nothing to undo or redo"** is said plainly on the tool line ("… — nothing to undo or redo — the assistant acts only on its own latest change; nothing was changed"), not as a bare code.
- Tests: `b18-e-scenario-6-truth` (new, in the CI list), the `b18-c-undo-redo` consistency case, a `b18-d-review-part3` pin moved, a `b18-d-ui-gates` wire for the restore; `agent-execution`: 16/16 passed (4.8 min), including the reload checks: the toolbar reads “Nothing to undo” and the restored entries carry the new hint.
- CI green at `223ab7a` (deterministic-manufacturing 34649084554 incl. page-browser-e2e, benchmark-quality 34649084619).

### E2 — refusals name their cause (CONFIRMED)

- **The server's refusal of a tender, in words.** A consume the server refused used to read "Not made — the server refused the change (it was cancelled, expired or altered)." whatever the cause. The ritual now reports the server's HTTP status with its reason, and the entry names the cause: a retirement reason in words ("Not made — the board changed. Nothing was changed."; "… your project membership changed …"), a lost authorization for 401/403 ("the server no longer authorizes you for this project"), a change the server does not know for 404, and — without claiming nothing changed, since the other attempt may have — "Not made here — another attempt had already started this change." for a replay. Anything else keeps the generic sentence; "the board MAY have changed" still wins over every code.
- **Drift is named in the durable record.** The ritual's drift check and the editor's live pre-check cancel an explicit grant with the drift itself — `revision_drift`, `history_drift` or `lineage_drift` — instead of a generic reason; the model is told that reason (`execution_retired`), and the audit trail agrees with the entry. Other pre-check refusals keep `refused_before_execution`; a retiring project keeps `session_superseded`.
- **One cancel vocabulary.** `CANCEL_RETIREMENT_REASONS` (seven reasons, all inside the closed retirement vocabulary; only `session_superseded` is also a consumed grant's reason) is shared by the route, the consume request, the transport and the controller. A cancel still retires only the bound principal's ISSUED grant.
- Reproduced first: on the pre-E2 code six tests failed — the route refused a revision_drift cancel (400), the ritual's drift cancel recorded refused_before_execution instead of the drift, the entry read the generic “the server refused the change (it was cancelled, expired or altered)” where it should say “the board changed”, and the four new refusal-cause tests failed
- Tests: the affected files 19/19 (121 tests), including the new b18-e-refusal-causes, a route drift-cancel case, the ritual's drift and HTTP-status pins and a loop row; `agent-execution`: 16/16 passed (4.8 min).
- CI green at `36b6697` (deterministic-manufacturing 34659860318 incl. page-browser-e2e, benchmark-quality 34659860191).

### E3 — scenario 1: what the model can read, and what it is told to read (CONFIRMED)

- **board-inspect against the model's budget — measured, the open A23 question answered.** One tool result may be at most 60,000
  characters (`MAX_RESULT_CHARS`); a larger one is replaced by `output_too_large_for_model`, so the model gets no board facts at
  all. Measured on real boards: a PLACED board — the unit golden blinker, and the shape the browser scenarios bootstrap — is
  40,410 characters (67% of the budget); each recorded ROUTED board is 70,173 and 72,453 characters, over it. A23 recorded the
  snapshot as "not bounded below" the budget and never measured it; it is now CONFIRMED that a routed board exceeds it, and
  UNKNOWN only how much copper it takes to cross. `b18-e-board-inspect-budget` pins both directions against the loop's own
  constant (exported for it), so a later change that shrinks the snapshot says so instead of passing silently.
- **What the execution tools tell the model.** All three footprint execution tools named board-inspect as the only id source,
  which is the read that can be unreadable. They now name `sirkit.selection.inspect` as well: `sirkit.pcb.move-footprint` 1.1.1,
  `sirkit.pcb.rotate-side-footprint` 1.2.1 and `sirkit.pcb.arrange` 1.1.1 (descriptions, the id arguments and the version notes;
  arguments, schema shape and reach unchanged). The B04, B09 and B11 artifacts are regenerated in this commit; two pins moved
  (`b18-c-gateway-execution` toolVersion, `b18-c-exposure-lift` shape). The B01 fingerprint and the B17 inventory are unchanged.
- **Scenario 1 through the real loop.** Two cases were missing and now exist in `b18-c-fixture-agent`: sending the exact sentence
  a second time is previewed with the retry note and the board moves only once (nothing runs until the human confirms); with
  nothing selected the scripted agent asks for a selection — no grant, no ritual, the head unchanged.
- **The composer.** The runbook's mandatory sentences for scenarios 1, 2, 3, 5 and 6 reach the assistant; scenario 4's sentence
  still goes to the legacy schematic edit, which E15 fixes — both pinned in `b18-d-composer-routing`, so E15's fix moves a pin.
- Consequence recorded for the scenarios: a routed project cannot be read through board-inspect, so scenario 1's ids come from
  the selection (OD-22's recorded precondition) or from the bounded reads E10 and E13 propose. Every browser proof runs on a
  placed board, which fits — that is why none of them has hit this.
- CI green at `adb2647` (deterministic-manufacturing 34660509539 incl. page-browser-e2e, benchmark-quality 34660509523).

### E4 — scenario 6's refresh, in integration (CONFIRMED)

- The harness can now RELOAD the editor as the browser does (`reloadEditor`, test-only): a fresh `PcbHistory` over the board the
  project persisted, reopened at the EXACT canonical head with the verified claim and the same durable store (B03.1), and a new
  commit interlock — while the durable grant store, the execution journal and the in-flight registry stay. The test asserts the
  reopen kept the SAME lineage, so this is the exact-head reopen and not a fresh content-equivalence lineage.
- The scenario, end to end through the real loop, minter and ritual: an AI move, then "Undo that." (committed), then the refresh.
  After it the editor's own undo stack is gone — `canUndo` and `canRedo` are both false — and the board is what the project
  persisted. "Undo that." then answers `nothing_to_replay` (the latest AI change is itself an AI undo), while "Redo." executes
  from the DURABLE records: one new head, R3 back where the AI put it, answered `executed` from the settled record. A human
  change after the refresh makes "Redo." refuse with nothing changed.
- Found while writing it: binding a canonical session is synchronous, but its lineage reopens on the session's own queue, so the
  head is provable only after `whenIdle()`. The first version of the reload returned too early and the run context could not be
  assembled at all (a null head). Recorded because a browser reload has the same shape: nothing may assume the canonical head
  before the session has settled.
- Tests: b18-c-undo-redo 11/11 (the two new refresh cases); the seven harness-based B18-C suites 35/35
- CI green at `97e852b` (deterministic-manufacturing 34661135227 incl. page-browser-e2e, benchmark-quality 34661135312).

### E5 — scenario 7's conditions, closed in integration (CONFIRMED)

Four conditions now run through the real loop, gateway, minter, grant store, consume and settle services and the granted-execution
ritual over a real canonical session (`b18-e-scenario-7`, in the CI list). Each leaves the board and the durable records untouched.

- **7c and 7e, a double call and a re-emission.** A second execution call in the same run, and the provider re-emitting the very
  same call, are both refused `execution_exists`; one grant is minted, one transaction commits, the board moves once. MEASURED
  correction: the re-emission is refused `execution_exists`, not `repeated_call` — the run already holds its one side-effecting
  artifact, and that check comes before the repeated-call guard (which `b18-d-tool-refused` pins for a read).
- **7d, cancellation.** With the editor's auto-run HELD, a cancelled run leaves its explicit grant retired and nothing committed;
  the editor's later tender is refused. MEASURED correction: the retirement reason depends on where the cancellation lands — the
  loop was awaiting this grant's settlement, so it retires `run_unsettled`; `run_cancelled` is the reason while the loop is still
  waiting on the provider, which the Stop proof covers. D-A9's shorthand ("the loop retires its still-issued explicit grants,
  `run_cancelled`") is therefore true of one window, not both.
- **7f, the server refusing the tender** (a revoked membership or a non-human principal, refused at the route before any burn).
  The ritual reports the refusal with the server's HTTP status (E2's `serverStatus`, here 403), abandons its journal entry and
  commits nothing; the grant is never consumed.
- **7g, an altered proposal.** A forgery made COHERENT — the change rewritten and all three digests recomputed — passes the page's
  own integrity check, is still refused by the editor's recompile, and is burned `proposal_altered` by the server when the altered
  digests are tendered. Nothing is committed at any step.
- The harness gained what these need (test-only): a cancellation signal passed into the loop's run request, a held auto-run that
  collects the ritual instead of starting it, and a transport that can refuse a tender as the route would.
- Tests: b18-e-scenario-7 4/4 (new); the eight harness-based B18-C suites 46/46
