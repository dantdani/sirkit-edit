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
| E1 | Scenario 6 truth: the redo hint and reloaded entries | 6 | planned |
| E2 | Refusal causes the chat and the model can trust (drift reasons, server refusals) | 7b, 7c, 7f, 7h | planned |
| E3 | Scenario 1 integration gaps; the id-source wording; board-inspect measured | 1 | planned |
| E4 | Scenario 6's refresh proven in integration | 6 | planned |
| E5 | Scenario 7 integration closures | 7a, 7c–7g | planned |
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
