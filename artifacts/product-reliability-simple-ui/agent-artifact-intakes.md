# The page's intakes of the agent's sealed artifacts (PR-G, 2026-10-17)

Branch `codex/astra-foundation`, on checkpoint F (`6042488`). Builder gA of the PR-G round. Every statement below names the code that
makes it true; nothing here was observed against a live provider, distributor, database or network - fixtures and source reads only.

The chat agent can seal four kinds of artifact that the page must show a human. Each travels on its OWN event in the NDJSON stream
(`AgentRunEvent`, `app/lib/agent/contracts.ts`), each is received by a SAFE receiver in `app/lib/project/` that re-verifies the sealed
digests and offers nothing on failure, and each reaches exactly one EXISTING human surface. No event mutates anything on receipt; no
model approves, applies, publishes, binds, buys, releases or mints authority through any of them.

| Event | Artifact | Receiver (app/lib/project) | What the page shows | What the human does | What never happens |
| --- | --- | --- | --- | --- | --- |
| `generation_proposal_ready` (PR-D, OD-246) | `sirkit.schematic-generation-proposal.v1` | `generation-proposal-events.ts`: `receiveGenerationProposalEvent`, `generationProposalCurrency` | the composer's own review dialog (`schematic-proposal-review`), laid out and validated through the composer's Generate path, with the partial / electrical-check notes as data; a run-log line | approves or discards in the dialog; the exact-base apply re-checks everything | no auto-apply; a stale, foreign, expired or altered proposal is refused with its run-log sentence and nothing is offered |
| `generation_task_ready` (PR-L, runbook L.5, 2026-10-18; replaces the row above, whose v1 artifact and intake were removed with the in-turn path) | `sirkit.generation-task-ref.v1` (a task reference, never a design) | `generation-proposal-events.ts`: `receiveGenerationTaskEvent`, `generationTaskAttachDecision` | the task is re-read through `GET /api/generation-tasks/[id]` and followed on the SAME status card as a Build start; its result reaches the SAME review dialog through `offerGenerationTaskResult -> offerBuildResult`, once per (task, result digest), noting that the assistant proposed it | approves or discards in the dialog (recorded on the task); Stop design / Pause / Resume on the card | no auto-apply; a foreign reference, a task already followed or a result already in the dialog is not attached twice |
| `generation_task_control_ready` (PR-L, runbook L.5, 2026-10-18) | `sirkit.generation-task-control-request.v1` | `generation-proposal-events.ts`: `receiveGenerationTaskControlEvent`, `generationTaskControlCurrency` | a confirm chip in the run log ("The assistant asks: <Stop design / Pause design / Resume design / Retry block>") with Confirm and Dismiss | Confirm sends the action once to `POST /api/generation-tasks/[id]/control` under the human's authorization; Dismiss sends nothing | nothing happens to the design until the human confirms; an altered, foreign or expired chip is dropped with its sentence |
| `draft_request_ready` (PR-F fB, OD-248) | `sirkit.part-draft-request.v1` | `draft-request-events.ts`: `receiveDraftRequestEvent`, `draftRequestCurrency`, `draftRequestCardLines`, `draftRequestPublicationPrefill` | a REVIEW TASK card in the run log (`chat-draft-request-card`): the part and its missing fact, every documented fact with its source, every missing fact, the PCB-assignment blockers, the catalog cross-check, the path, what the artifact never claims; ONE action, "Open the publication request" (`draft-request-open`) | opens the EXISTING Build Library evidence review (`AtomicPublicationReviewSection`, the surface MissingPartsList's draft action opens too) in the page's dialog (`draft-request-publication-dialog`), PREFILLED from the sealed spec (MPN, manufacturer, profile, the pin table, package, mounting, datasheet); picks the symbol and footprint; presses the section's own "Request evidence review" | the page never files the request (no publication POST, no submit call, no normalizer, no draft assembly in `app/page.tsx`); nothing is published, bound or PCB-assignable until a person submits, a reviewer approves and a different administrator publishes (the server's human-only governance, `submitAtomicPublicationRequest`); a stale, foreign, expired or altered request is refused with its sentence; a card restored after a reload is a static record whose control is disabled with the reason |
| `module_contracts_ready` (PR-F fD, OD-249) | `sirkit.module-contract-proposal.v1` | `module-contract-events.ts`: `receiveModuleContractsEvent`, `moduleContractCurrency`, `moduleContractNoteLines` | a collapsible ENGINEERING NOTE card in the run log (`chat-module-note-card`, `module-note-toggle`): a summary row, then every module with its owned components (exact identities from the pinned sheet) and ports, each cross-module constraint, the shared nets, the unresolved part authority (what must be published before PCB), the validator's result AS DATA (`contract-structure-checked`; electrical check `not_run`) and what the artifact never claims | reads it and continues (accepts the plan) or asks the assistant for a revision | there is NO apply path for a contract set: nothing changes the sheet or a board; no "Keep as engineering note" store exists in this project (none in `app/lib/project` or `app/lib/engineering`), so the card IS the note and says so (`MODULE_CONTRACT_NOTE_HOME`): it is saved with the project's chat history like every run-log card |
| `stackup_candidate_ready` (PR-F fE, OD-249) | `sirkit.stackup-candidate.v1` | `stackup-candidate-events.ts`: `receiveStackupCandidateEvent`, `verifyStackupCandidateAgainstBoard`, `stackupCandidateChatLine` | the page checks the candidate against the LIVE board's revision (the editor-context bridge's exact working copy) and hands it to `PcbEditor` (`stackupCandidateIntake`), which re-verifies it (digest, base revision, expiry) and renders `StackupCandidatePanel` as a PREVIEW beside the layout candidates: current against recommended stackup, layer roles and plane nets, the manufacturing preset with its release qualification AS THE CANDIDATE STATES IT, the via profiles with the preset-minimum check, what accepting invalidates (the cited rules), what was not validated, what the chain does not support; a run-log line says the same | Accept (`stackup-candidate-accept`) or Discard (`stackup-candidate-discard`); Accept re-checks the live revision and runs the SAME `applyStackupProfile` the toolbar's Stackup selector runs - one canonical `pcb.board-geometry` transaction (stackup, stackupConfig, the plane nets, `reconcileStackupPlaneZones`), one undo entry; the recommended DRC preset becomes the DRC panel's active preset (a view preference) only when the commit landed | the candidate never writes the board; the intake effect never commits; a stale, altered or expired candidate is refused visibly and Accept is disabled with the reason; nothing is manufactured, qualified or released by it (dependent approvals are INVALIDATED and re-run from scratch, as the artifact states) |

## The answer's model label (directive 4)

`run_started.provider` and `run_completed.model` already reached the trace and the orchestration events, but the chat bubble carried no
label. The run view now folds both (`RunViewState.provider`, `.model`, `.fallbackNotices`; `reduceRunView` and `reduceAnswerSource`,
`app/lib/project/chat-run-view.ts`), and the answer bubble gets a footer line (`chat-answer-footer`): `answered by <provider> · <model>`
from the run's OWN events, never from configuration. The page adds the disclosure through `answerFooter(runView, configured)`: when the
run's provider or model differs from the configured one (the send's pinned provider and `/api/ai/runtime`'s model for it) the footer
says "a fallback answered, not the configured <provider> · <model>"; each `degraded compatible_fallback` notice is counted and named
("N specialist results came from a compatible fallback"). A run whose terminal event recorded no model (a replayed resume, a refused run)
says "model not recorded by the run". The footer is kept with the answer (`StoredChatMessage.footer`, bounded and validated on import)
and never enters the history the next run sees (`chatHistoryForModel` maps role and content only). `chat-run-view.ts` stays
line-neutral where B21 cites it: the additive code is appended and folded into existing lines.

## Where each piece lives

- Receivers and their shared currency check: `app/lib/project/sheet-artifact-currency.ts` (scope, expiry, head, base - the generation
  proposal's order and sentences, worded per artifact), `draft-request-events.ts`, `module-contract-events.ts`, `stackup-candidate-events.ts`.
- The page: the three `applyAgentEvent` cases (`stackup_candidate_ready` beside `layout_candidate_ready`, then `draft_request_ready`,
  `module_contracts_ready`), `liveSheetForSealedArtifacts` (the same live-editor recipe as `offerGenerationProposal`, pinned byte-identical),
  `upsertReviewCard` (a run-log card inserted before the run's answer, as execution entries are), `openDraftRequestPublication`, the
  publication dialog, `MessageBubble`'s card action, note collapse and answer footer.
- The editor: `PcbEditor.tsx` `applyStackupProfile` (the ONE stackup change path; the toolbar's selector now calls it), the intake effect,
  `acceptStackupCandidate`; `app/components/pcb/StackupCandidatePanel.tsx`.
- The publication form: `AtomicPublicationReviewPanel.tsx` takes the sealed spec's remaining fields as optional prefill (profile, terminal
  table, package, mounting, datasheet) and its terminal-table parser keeps a pin function with a space whole (`number function [pads]`).
- Classification: `control-registry.ts` rules `view.page-draft-request-open`, `view.page-module-note-toggle`, `pcb.stackup-candidate-accept`
  (semantic, `pcb.board-geometry`), `view.stackup-candidate-discard`; the dialog's Close under `view.page-dismiss`. B17-A inventory
  640/65 -> 646/66; B24 census: every new control named, 0 unnamed in scope.

## Evidence

- `app/lib/project/__tests__/pr-g-artifact-receivers.test.ts` (10 cases): integrity (tampered facts, asserted verifications, extra keys,
  foreign producers), currency and refusal sentences in order, the prefill, the card rows, the note rows, the board check and the chat line -
  over artifacts the services' own sealers / compiler produced.
- `app/lib/qualification/__tests__/pr-g-page-intakes.test.ts` (12 cases): the three cases once each through their receivers, the shared
  review surfaces, the no-apply rule (the page never commits; the intake effect never commits; Accept runs the selector's path), the
  byte-identical live-editor recipe, the inventories, the footer.
- `app/lib/project/__tests__/b18-d-chat-run-view.test.ts` (+3 cases): the footer from the run's own events, bounded values, the fallback
  disclosures, the history untouched.
- Pins moved with dated notes: `b24-d3` page line count 8705 -> 8842; `b21-e2-run-view` case list + markup counts (onClick= 82 -> 85,
  `<button` 41 -> 42); the B21 and accessibility citation tables re-pointed by the refresh script (0 problems).
- Not done here: a browser run of the three intakes (the fixture agent adapter does not emit these events; that belongs to the e2e builder).
