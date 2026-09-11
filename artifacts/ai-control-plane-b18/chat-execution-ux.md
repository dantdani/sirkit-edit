# B18-D — Chat execution UX: design record

Status: **PROPOSED design, adopted as the B18-D plan** (I0, 2026-09-11). Produced by a design workflow (`wf_1121fdf1-b3d`, eight read-only agents): four discovery maps of the current surfaces (the chat stream and the model-text path; the confirmation card and the ritual UX; composer routing and tier surfaces; the UI gates and test harnesses), three independent designs (minimal-truthful, enforcement-first, user-first) and a judge that verified the decisive anchors in the code, scored the designs 36 / 37 / 34 and synthesized this contract from the enforcement-first design with grafts from the others.

Recorded limits of the process: the judge received design A truncated and scored it on its visible sections; the anchors below were read by the agents — the builder spot-checked the two decisive anchors (`loop.ts:328` emits a step's text before its tool calls are handled; `page.tsx` appends that text to the answer unmarked and labels any `ok` tool_finished "— succeeded") — and every increment re-verifies the anchors it touches before changing code. The owner decisions D1–D8 (§9) run on the recommended defaults (OWNER_DECISIONS OD-17). Labels: C = CONFIRMED, I = INFERRED, P = PROPOSED, U = UNKNOWN.

## Scores

The scale is 1–10. The labels used throughout are **C** = CONFIRMED (I read the code), **I** = INFERRED (reasoned from code I read), **P** = PROPOSED and **U** = UNKNOWN. Paths are relative to `C:\Users\robsa\Desktop\sirkit-edit`. Design A reached me truncated: I saw only its D4–D7 increments and its gates, tests, risks and out-of-scope sections. Its earlier sections are U, and it is scored on what I could see.

| Criterion | A — minimal-truthful | B — enforcement-first | C — user-first |
|---|---|---|---|
| 1. Coverage of the B18-D text | **7**. It covers most items through the card, an outcome report and a log-shaped entry. Stop and the autonomy control are deferred, and the loop's silent refusals stay invisible. | **9**. It covers all ten items, plus Stop, the autonomy control, the silent refusals, P1, P2 and an Undo in chat. | **9**. It covers all ten items in one entry per operation, plus Stop, an explicit-grant Cancel and the autonomy control. |
| 2. The two rules, and whether they are really enforced | **6**. Rule 2 depends on the page holding preview replies. That is display-only and is lost on reload, and no ordering at the protocol level is visible. | **8**. Server ordering, text phases, page quarantine and exclusion from history. **But** text from a step that only reads is classed "interim" and goes into the answer. So "Done, moved R3" written beside the `selection.inspect` call that comes before the move is shown before any grant exists (this follows from its G2-2 rule). | **8**. Holding every text until the run ends closes that gap, and the final text is labelled. But it drops interim text in runs that wait for the human, and it moves the `b09-loop-safety` #24 pin. |
| 3. Minimality | **9**. Log-shaped entry, Undo through the timeline, no change to the event contract, no new route. | **6**. A new persisted `run` field and validator change, a page→editor Undo intent plus moving a predicate into a new module, collapsed notes, and four new components. | **7**. No new event type, log-shaped persistence and Undo through the timeline. But it adds a new message role and an explicit-grant Cancel that almost always loses the race to the immediate auto-run (`PcbEditor.tsx:1604-1622`, C). |
| 4. Testability; CI-green increments | **7**. Gates and tests are named for each increment, and the spec and fixture changes are identified. | **8**. A failing test for each rule (T-R1a–f, T-R2a–d), and CI-list entries for each increment. | **6**. Its receiver anchors are wrong: `execution-grant-events.ts` has 71 lines, but C cites lines 101–150. It leaves the replay-capsule impact U, yet e11 (C) hits the refusals that its `warning.code` would record in the trace. |
| 5. Risk | **7**. A small surface, but the UI-only P2 gate misses the select tool's own Ctrl+Z (`select-move.ts:840-845`, C). | **6**. Heavy churn in `page.tsx`, a persistence change, and a noun guard that includes "footprint" and "board". | **4**. Its P1 rule order sends the blinker bootstrap prompt ("…two-layer PCB…", `catalog.ts:48`, C) to the assistant. That breaks `bootstrapSynchronizedBoard` (`fixture-journey.ts:81-83`, C) and with it every browser spec. |
| **Total** | **36** | **37** | **34** |

**Winner: Design B is the backbone.** Grafted onto it:
- the single execution entry per operation and the labelled final text, from C;
- the log-shaped persistence, the Undo in chat through the project timeline, and the hoisted outcome report, from A and C;
- a P2 gate at the one point every undo path passes through, which replaces all three designs' per-control gates.

**Findings, verified in the code, that decided the scores:**
- Model text is emitted before the step's tool calls are handled: `loop.ts:328` versus `343-662` (C). Both adapters are non-streaming (`adapters.ts:108,154`, C), and the page appends the text to the bubble unmarked (`page.tsx:4474-4477`, C).
- The trace records only `run_started`, `warning` and the terminal events (`loop.ts:245-250`, C). Text is never traced (`loop.ts:325-328`, C). Replay capsules compare the trace digest (`replay-capsule.ts:574`, C). The e11 capsule makes six identical calls, so three reach the silent `repeated_call` refusal (`evaluation-cases.ts:250-260`; `loop.ts:379-381`, C). A new *warning* there would move e11's digest (I); a new untraced event type would not (I).
- Every PCB undo path uses one wrapped history. The select tool, `editorRuntime` and the timeline all receive `bound.history` (`PcbEditor.tsx:1002-1006, 1025, 1047`, C). The callers are the toolbar (`:2485`), Ctrl+Z (`:2073-2074`), the select tool's own Ctrl+Z (`select-move.ts:844-845`), the timeline (`:1025`) and board repair (`repair/transaction.ts:204`) (C). The wrapped `undo` has no guard against a commit in flight (`editor-adapter.ts:790-795`, C).
- "Undo latest" shows a success toast whenever the timeline decision is ok (`page.tsx:3466`, C). So a silently ignored undo would be reported as done (I). A gate needs a refusal inside the timeline.

---

# B18-D — Chat execution UX: final contract (synthesized)

## 0. Honest boundary

**What B18-D shows (P).** For every agent run:
- **What Sirkit understood:** the composer route before sending; for each grant, the family and the digest-bound before/after text.
- **Resolved targets:** reference designators mapped from the grant's object ids, display only.
- **The tier of every tool call and every change**, with wording from `PERMISSION_TIER_TITLES` (`permission-tiers.ts:27-32`, C).
- **The exact operations:** the grant's digest-covered `proposal.operations`.
- **Whether confirmation is required, and why:** from the decision, the autonomy mode and revision, the explicit-request proof, or the minter's note.
- **Progress and cancellation:** the entry's state, the card's Cancel, and a Stop control for the chat run.
- **The committed transaction and revisions, and the server-record state.**
- **The validations that ran:** browser-attested DRC error count and compile warnings.
- **Failures and recovery:** a plain-language headline, whether the board may have changed, the next step, and the raw code in small print.
- **Undo:** a transaction-bound Undo in chat, plus the existing toolbar, Ctrl+Z, timeline and "Undo that.".

**What B18-D never does:**
- It adds no Confirm or Apply control outside the existing card (C: `control-registry.ts:165`).
- Nothing it displays is sent back to the server as authority. The chat body keys stay closed (`b18-b-chat-authority-keys.test.ts:31-52`, C).
- It adds no route, and the ratchet stays at 158 = 155 + 3 + 0 (`b16-1c-invariant-tripwires.test.ts:50`, C).
- It adds no parallel mutation code. Undo is always the history's own undo (`PcbEditor.tsx:1025`, C).
- It never says a board "passes", is "safe", or is "ready" or manufacturable.
- It never touches release, qualification or ordering. The release tool is `agentExposed:false` and `not-callable` (`b16-1c-invariant-tripwires.test.ts:58-59`, C).

**Limits (C/I).**
- **Model prose.** B18-D does not check what model prose *says*. It orders it, classifies it on the server, keeps interim text out of the answer, and labels any final text written before a durable result.
- **Explicit executions.** Once the editor has tendered an explicit grant, it cannot be cancelled. The grant auto-runs at once (`PcbEditor.tsx:1604-1622`, C).
- **Forged grants.** Grant digests have no key (`execution-grant.ts:12-16`, C). A self-consistent forged grant can therefore be *displayed*, but never executed: consume burns it (`consume.ts:113-114`, C).

## 1. The ten items → surface → data source → anchors

In the "CONFIRMED anchors" column, the anchors are C. The surfaces are P.

| # | Item | Surface (P) | Data source | CONFIRMED anchors |
|---|---|---|---|---|
| 1 | What Sirkit understood | A composer route chip (I1). The entry rows "You asked (as recorded)", "Sirkit understood: <family> — <after>" and "Exact request proven" (shown only for `execute_explicit`). The same content on the card, in its context block. | The route from `routeComposerMessage`. The grant's `operation.family` and `preview.before/after`, which are digest-bound. `instruction.excerpt`, which is **not** bound. `instruction.explicit`, which is bound only when explicit. The event `note`. | `page.tsx:206-215`; `execution-grant.ts:113-114, 137, 152-160, 381, 397-398`; `execution-grant-events.ts:27`; `mint.ts:155,166,180` |
| 2 | Resolved objects/nets | "Targets" on the entry and the card. Refs come from the editor-context board captured at send (chat) or the live board (card), falling back to kind plus a short id. Nets are shown as "Nets named: none", never "no nets affected". | `binding.targets.{objectIds,kinds,netIds,resolvedFrom}`. These are internal ids; `netIds` is always `[]`. A replay targets `[transactionId]`. | `execution-grant.ts:122-129, 259-261, 396`; `execution-operations.ts:155`; `mint.ts:144`; `page.tsx:4423-4427` |
| 3 | Tier 0/1/2/3 | A chip on every tool line, on the entry and on the card. A static Tier 3 line in the chat header and a composer hint (§5). | A server-computed `tier` on `tool_started` and `tool_finished` (I2). A grant's tier is always `1`. Proposals are Tier 2 by class. | `permission-tiers.ts:37-53` (imports are type-only, `:20-22`); `loop.ts:356-357, 400, 443-658`; `execution-grant.ts:115, 375`; `contracts.ts:373-374` |
| 4 | Exact proposed operations | "Operations (n)" on the entry and the card. A total formatter converts nm to mm and uses refs. An unknown shape is shown as "operation <kind> (not displayable)". A replay shows "<direction> of transaction <id>; the server selects the operations from the durable record". | `binding.proposal.operations`, which is digest-covered, but its inner shape is not validated. `proposal.replay`. | `execution-grant.ts:139-150, 379, 394-395`; `executor.ts:89-96` |
| 5 | Is confirmation required, and why | An entry row and a card row, e.g. "Required — this project asks before every AI change (proposal_only, rev n)", or "Not required — your whole message was exactly this request (grammar id vX) and the project runs exact requests". The retry-guard note is shown verbatim. | `operation.decision`, `requiresHumanApproval` and `autonomy.{mode,revision}`. The note is null under `proposal_only`, so the reason is derived from the mode. | `execution-grant.ts:113-120, 398-399`; `mint.ts:152-155, 158-167, 176`; `permission-tiers.ts:145` |
| 6 | Progress and cancellation | Entry states: issued → awaiting_confirmation → executing → outcome. The card's "Cancel — change nothing". A **Stop** control for the chat run (I9). The bounds are shown ("the assistant waits up to 60 s for your editor"). | The events, plus a new `onExecutionGrantProgress` fired when busy is set. For Stop: `reader.cancel()` → the route's `cancel()` → loop abort → issued explicit grants retired. | `PcbEditor.tsx:1557, 1595-1601`; `route.ts:517-519`; `loop.ts:695-697`; `execution-grant.ts:75, 78`; no Stop exists today (grep of `page.tsx`) |
| 7 | Committed transaction/revision | An entry row, e.g. "Transaction tx:…; revision <before>… → <after>…; history #n; server record: settled / not yet recorded". The toast stays as the short form. | Explicit: `execution_settled.settlement`. Preview: the ritual's `receipt` plus `settled`, passed up through an extended `onExecutionGrantSettled`. | `contracts.ts:304-311`; `loop.ts:537`; `execution-grant-events.ts:38-58`; `granted-executions.ts:69, 504-509, 519-520`; today only 18 characters in a 6 s toast (`PcbEditor.tsx:1580, 695-699`) |
| 8 | Validations run | "Checks: DRC (<preset>): N errors (browser-attested, errors only)", or "DRC did not run — no DRC claim"; compile warnings. | Explicit: `settlement.validations`. Preview: the ok outcome gains `validations`, computed once (I4). | `granted-executions.ts:137-151, 519`; `loop.ts:556-561`; `execution-grant.ts:137`; the preview DRC is invisible today (`PcbEditor.tsx:1582`) |
| 9 | Failures and recovery | The terminal state gives a headline, either "nothing changed" or "the board MAY have changed", and a next step, with the raw code in small print. The run log shows loop refusals (optional I10). A recovery sweep result updates its entry, in plain words. | Ritual `code/message/changed/serverCode`. Server `status/outcome/reason`. Sweep `action`. | `granted-executions.ts:62-71, 556, 593`; `execution-grant.ts:57-64, 70`; `page.tsx:4570-4574`; `loop.ts:358-397` (silent today); `PcbEditor.tsx:1637` (raw ids today) |
| 10 | Undo action | "Undo this change" on the entry. It is shown only when the entry is committed, `undoEligible` is true, its transaction is the timeline's newest operation, and no hold is active (§4). The entry also says "or say “Undo that.”". The toolbar, Ctrl+Z and timeline stay. The copy follows the undo direction. | The timeline's `undoLatest({ expectTransactionId })` → the PCB store's own `history.undo()`. | `operation-timeline.ts:74-81, 102-112`; `PcbEditor.tsx:1025, 1040`; `mint.ts:83-86`; `loop.ts:562-571`; today's toast claims undo unconditionally (`PcbEditor.tsx:1580`) |

**The entry itself (P, grafted from A and C).**
- **Form.** One `role:"log"` message with id `xlog-<grantId>`, inserted just before this run's assistant bubble. A pure reducer rebuilds it on each transition. It is keyed by `grantId`, so the preview outcome, the explicit settlement and recovery all update the same entry.
- **Persistence.** It persists through the existing log shape: `toStoredChat` and `fromStoredChat` (`page.tsx:2952-2967`), the `StoredChatMessage` type and its validator (`lib/persistence.ts:38-40, 694-708`), and project import (`app/lib/project/file.ts:204`) (C). **No change to the persistence schema.** On reload, a pending entry reads "(interrupted by reload)" (`page.tsx:2963-2964`, C). A reloaded entry is a static record with no live Undo.
- **Disagreement between editor and server.** If they disagree (for example, the editor reports committed while the server reports retired), the entry fails safe to "landed, unverified — check the board and the revision history" (P).

## 2. The two rules → enforcement point → the test that fails if violated

**Rule 1 — "No button may apply an altered proposal."** It holds today (C).
- The receiver drops any grant that fails parsing or coherence, is not issued, or whose decision does not match (`execution-grant-events.ts:21-29`).
- The card is inert (`GrantedExecutionDialog.tsx:22-33, 72-74`).
- The ritual recompiles the operations and byte-matches them against the grant (`granted-executions.ts:349-352`, per the maps).
- Consume burns the grant on `proposal_altered` (`consume.ts:112-114, 119`).
- The browser drops a grant altered in transit (`e2e/agent-execution.spec.ts:260-290`).

B18-D keeps each of these and adds the following.

| Id | Invariant (P) | Enforcement point | Test that fails if violated (P) |
|---|---|---|---|
| R1-1 | There is exactly one Confirm surface: the card's Confirm. Chat gets no Confirm or Apply. | `PcbEditor.tsx:2794` calls `runGrantedExecution("confirm")`, whose only tender is `:1577` (C) | New `app/lib/project/__tests__/b18-d-ui-gates.test.ts`. It source-scans for exactly one `tenderConfirmedExecution(` and one `runGrantedExecution("confirm")`. It asserts that no file under `app/components/chat/**` imports the controller, ritual, transport or journal, and that an injected offender trips the gate (pattern: `b18-b-import-gates.test.ts:101-109`). |
| R1-2 | Chat actions carry identifiers only, never content or grant objects. | The chat Undo sends `transactionId` to the timeline. The timeline compares it with its **own** recorded `ref.transactionId` (`PcbEditor.tsx:1040`, C), so a forged id can only cause a refusal. Stop carries nothing. | `b17-e-operation-timeline` gains a case: `expectTransactionId` does not equal the newest `ref.transactionId` → `NOT_LATEST`, and the store's `undo` is never called. |
| R1-3 | "What changes" is shown only from digest-covered fields: operations, targets and preview; family via the operations digest; explicit proof only when `execute_explicit`. The excerpt, scope, base, origin, autonomy and note go in a separate block labelled "As issued by the server". | `GrantedExecutionDialog` has a change block (`data-testid="granted-execution-change"`) and a context block (`granted-execution-context`) | The dialog test (extended `b18-c-granted-execution-dialog.test.tsx`) asserts that context text never appears inside the change block. It also asserts that a hostile operation `{kind:42}` renders "not displayable" without throwing, and that the partial grant cast at `:15-27` still renders. |
| R1-4 | The card stays inert: no input, textarea, select or contenteditable; Confirm and Cancel take no arguments; its copy stays pinned. | `GrantedExecutionDialog.tsx`; the copy gate at `b18-b-import-gates.test.ts:112-121` (C) | The same dialog test checks that `querySelectorAll("input,textarea,select,[contenteditable]")` is empty and that the Confirm spy gets 0 arguments. It keeps the strings "Nothing has been changed yet", "exactly ONE canonical PCB transaction" and "pcb.move-footprint, 1 operation" (`b18-c-granted-execution-dialog.test.tsx:38`; spec `:166-167`). |
| R1-5 | The chat Undo reverts exactly one AI transaction, and only while it is still the latest one. | The timeline's `undoLatest({expectTransactionId})` plus the §4 hold | The e2e check (Undo reverses a confirmed move exactly; a second click is refused), plus the `NOT_LATEST` unit test above. |
| R1-6 | A forged but coherent grant can be displayed but cannot execute. | Recompile, then consume (C) | Existing coverage: `b18-c-review-3` (recompile-mismatch, per the maps) and `b18-b-mint-consume-decisions` (`proposal_altered`). The new coherent-forgery e2e depends on U1; if Playwright cannot import `stable.ts`, a vitest integration test through `b18c-harness` replaces it. |

**Rule 2 — "No model text may claim success before the transactional result exists."**

**Today it is not enforced (C).**
- A step's text is emitted before its calls are resolved (`loop.ts:328`).
- After a preview grant, the model is continued at once (`loop.ts:505-520, 664`), and only written guidance holds it back (`loop.ts:517`; `prompts.ts:43-45`).
- Grant issuance is shown as "— succeeded" (`page.tsx:4485`).
- Bubble text becomes the next run's history (`page.tsx:4408-4410`).
- A failure message is written only into an empty bubble (`page.tsx:4618`).

| Id | Enforcement (P) | Where | Test that fails if violated (P) |
|---|---|---|---|
| R2-1 | **Protocol ordering.** A step containing a side-effecting call (a resolved descriptor with `operationClass` `mutate` or `propose`, computed the same way as `loop.ts:350-357, 388-389`) emits its text **after** the step's call loop, below `:662` and before `continueWith` at `:664`. Other steps emit in place. If the run boundary fails mid-step, the held text is never emitted. There is no latency cost, because the adapters don't stream. | `app/lib/agent/loop.ts` | New `app/lib/agent/__tests__/b18-d-loop-text-phase.test.ts`. (a) Step 1 = "Done, R3 moved." plus a move grant, explicit and committed → the `text_delta` comes after `execution_settled`. (b) Preview → it comes after `execution_grant_ready`. (c) A proposal → it comes after `proposal_ready`. (d) A read-plus-text step → emitted before `tool_started` (so `b09-loop-safety.test.ts:181-200` #24 stays `["early"]`, C). (e) A boundary failure after a held step → no `text_delta`. (f) A property check over the whole matrix. The existing pins `b18-b-loop-execution.test.ts:126,145` do not move, because their step 1 has no text (C). |
| R2-2 | **Server classification.** `text_delta` gains a required `phase: "interim" \| "final"`. Text from a step with any tool call is `interim`; the text of the final step (no calls) is `final`. | `contracts.ts:372`; `loop.ts:328, 332` | The same suite asserts a phase on every `text_delta`. `tsc` then flags every event built by hand. |
| R2-3 | **Interim text never enters the answer.** The page buffers interim text per run and shows it in the run log as "Assistant note (written before the result): …" **when the run ends**. It is never shown in the bubble and never included in history (the log role is filtered out at `page.tsx:4408-4410`, C). A missing or unknown phase is treated as interim (fail closed). | A new pure `app/lib/project/chat-run-view.ts` reducer; `page.tsx` `applyAgentEvent` | New `app/lib/project/__tests__/b18-d-chat-run-view.test.ts`: interim text never appears in the answer; notes are released only after a terminal event; a missing phase is quarantined. The e2e check S5 is in §7. |
| R2-4 | **Final text is labelled unless a durable committed settlement exists.** The reducer tracks side effects from `tool_finished.status` ∈ {`execution_grant_issued`, `execution_preview_issued`, `proposal_sealed`, `layout_candidate_ready`}, which the server emits (C: `loop.ts:476, 501-503, 602, 625`). It clears them only when an `execution_settled` event (accepted by the safe receiver) reports `settled/committed`. While a side effect is still unresolved, the bubble starts with its own paragraph: "Written before any change was made — the status above is authoritative.", or for proposals "Written before anything was applied — the proposal above awaits your review." | Reducer plus `page.tsx` | Reducer cases: a preview run → labelled; explicit committed → not labelled; not-committed, retired, in flight or unsettled → labelled; a dropped (forged) grant with status `execution_preview_issued` → labelled. |
| R2-5 | **Tool lines are honest.** Only `status === "succeeded"` reads "done". Grant issued → "grant issued — executing in your editor"; preview issued → "change prepared — awaiting your confirmation"; proposal sealed → "proposal sealed — awaiting your review"; layout candidate → "candidate ready — awaiting your review"; view command → "view request sent"; anything else → "finished (<status>)". Each line carries a tier chip. | Reducer label map; `page.tsx:4483-4486` | Reducer test: no label for a non-read status contains "succeeded", "done" or "made". The server events are unchanged, so `b18-b-loop-execution.test.ts:128` holds (C). |
| R2-6 | **History carries the label, never the notes.** The label is part of the bubble content, so the next run sees it. Interim notes live in log messages. | `page.tsx:4408-4410` (unchanged filter) | Reducer: `historyText` equals the label (if any) plus the final text. e2e: the next `/api/chat` body never contains "(fixture interim)". |
| R2-7 | **A failure stays visible.** Because interim text no longer fills the bubble, the empty-bubble condition at `page.tsx:4618` works as intended (I). The entry also shows the failure. | Reducer plus the entry | Reducer: a run that fails after interim text shows the failure text. |

**Test compatibility (I).** `b14-1-production-integration.test.tsx:210,260` and `b15-3-production-integration.test.tsx:121,173` concatenate every `text_delta` on the wire. Text stays on the wire, so they are unaffected. The page-side labels never reach the wire.

## 3. P1 composer routing: fix it in increment I1

**Why (C).**
- The edit verbs are bare prefixes (`page.tsx:211`), so "Add silkscreen text …" goes to the schematic editor and "Draw a dimension …" goes to generation (`:210`).
- The `make R1 …` branch can never run, because the generate test at `:210` matches first.
- The route is only shown, and the user cannot override it (`:5725-5733, 6829-6833`).
- The spec works around this with "Please" (`e2e/agent-execution.spec.ts:17-19, 230, 276`).

Routing is UX only: `ask` reaches the server loop, and `edit`/`generate` only produce proposals (`page.tsx:5714-5717`).

**The change (P).** A new pure module, `app/lib/project/composer-routing.ts`, exporting `routeComposerMessage(text, hasSchematic) → { route, reason, hints }`. The first matching rule wins:

| # | Condition (on the trimmed, lower-cased text) | Route |
|---|---|---|
| 1 | empty | ask |
| 2 | `!hasSchematic` | generate (unchanged; the blinker prompt "Design … two-layer PCB …" keeps generating, `catalog.ts:48`, `fixture-journey.ts:79-83`, C) |
| 3 | `^(generate\|design)\b` | generate |
| 4 | `^(please\s+)?(move\|shift\|nudge\|rotate\|turn\|flip\|put\|undo\|redo)\b` | ask (as today; the grammars are at `explicit-request.ts:35-44`) |
| 5 | starts with an edit verb or `create\|build\|make\|draw`, **and** contains a PCB noun `\b(silk(screen)?\|vias?\|tracks?\|traces?\|dimensions?\|copper\|zones?\|pours?\|keep-?outs?\|courtyards?\|drills?\|layers?\|pcb\|drc\|board outline)\b` ("footprint" and "board" are excluded, taking C's refinement) | ask |
| 6 | `^make\s+(r\|c\|u\|d\|led\|j\|sw)\d+\b` (now reachable) | edit |
| 7 | `^(create\|build\|make\|draw)\b` | generate |
| 8 | `^(edit\|change\|set\|rename\|delete\|remove\|add\|replace\|swap\|connect\|disconnect\|rewire\|fix\|update)\b` (now word-bounded) | edit |
| 9 | anything else | ask |

**Additions to the router (P).**
- **Tier 3 hint.** A display-only hint, `\b(release|publish|order|purchase|buy|qualify|upload|ship)\b`, adds `hints:["tier3-release"]`. It never changes the route.

**UI (P).**
- A static route chip, "Sirkit will: ask the assistant / edit the schematic / generate a schematic". It has no handler, so it adds no B17 site (the scanned attributes are at `control-surface.ts:23-36`, C).
- One override button with the named handler `overrideComposerRoute`. It resets after each submit.
- `handleComposerSubmit` keeps its name, because the b07-4 test slices the page source on that token (`b07-4-project-async-scope.test.ts:387`, C).
- `control-registry.ts:80` `dispatcher.chat-composer` adds `agent.execution-grant` to its `recordIds`, because agent turns can mint grants.
- A new rule, `view.composer-route-override`, goes **before** the generic page rules at `:114, 117` (C).

**Must keep working:**
- "set R1 to 4.7k", "rename U1 to U5" and "delete R3" → edit.
- An empty project and "Design …" → generate.
- "Apply suggestions" calls `handleEditSchematic` directly (`page.tsx:5706`, C).
- Retry through `lastAiRetryRef`.
- "Please add …" → ask.

## 4. P2 Undo/Redo during a granted execution: decision

**Decision: gate it.** Beyond UX, there is a correctness reason (I, not yet tested).

**Window (c).** This is an Undo that lands while the executor write is pending. It is not covered by the review-3 fix, which covered only the replay's envelope write (`safe-mutation-contract.md:253`, item 4, C). The sequence is (C):
1. `runCommit` reads `delegate.committedPresent` and then awaits `executor.execute` (`editor-adapter.ts:651, 675`).
2. The wrapped `undo` pops synchronously and queues its reconcile (`:790-795, 804-805`).
3. `applyExecutionResult` takes the link base from the board that was just undone (`:716`) and replaces the board contents (`:742-744`).
4. `execute` clears the redo stack (`history.ts:228`).

The likely outcome is that the user's Undo is overwritten, their Redo is lost, and the AI entry's own undo also reverts the prior change (I). The order of the reconcile relative to the ritual's postcondition is U3.

**Enforcement at the single choke point (P).** Every PCB undo path shares one wrapped history. Per-control gates would miss the select tool's Ctrl+Z (`select-move.ts:840-845`) and board repair (`repair/transaction.ts:204`) (C).
- **The hold.** `CanonicalEditorSession` gains `holdHistorySteps(reason): () => void`. While a hold is active:
  - the wrapped `undo`/`redo` (`editor-adapter.ts:774-801`) refuse, doing nothing;
  - `canUndo` and `canRedo` read false;
  - subscribers are notified when the hold starts and ends.
- **Who takes it.** The ritual takes the hold just before its drift check and releases it in its `finally` (`granted-executions.ts:541-543`, C).
- **Scope.** The hold is limited to granted executions, so human commits keep their current behaviour.
- **It only refuses.** It adds no mutation path.
- **Window (b) improves too.** An Undo pressed during consume is now refused, instead of burning the grant as `commit-rejected` (`:440, 454`, C).

**Visible reasons (P).**
- **Timeline.** `ProjectStoreBinding` gains an optional `busy(): string | null` (`operation-timeline.ts:49-52`), and `ProjectUndoRefusalCode` gains `STORE_BUSY` (`:35`). `undoLatest` checks `busy` before calling `binding.undo()` (`:74-81`). This is required, because otherwise `page.tsx:3466` would toast a false "Undid…".
- **Toolbar.** `canUndo` becomes `&& !executionGrantBusy`, and the title shows the reason (`PcbEditor.tsx:2485-2488`). The aria-label is unchanged, so the B17 key does not change (I). The conditional title is not captured by the B01 regex (`action-surface.ts:88`, C).
- **Keyboard.** Ctrl+Z shows a toast while the hold is active (`PcbEditor.tsx:2069-2076`).
- **Preview card open, not busy.** Ctrl+Z stays allowed. The live-board check already disables Confirm and shows the reason (`PcbEditor.tsx:1538`, C).

**Tests (P).**
1. **A probe, written first.** `app/lib/engineering/__tests__/b18-d-undo-during-commit.test.ts` holds the executor on a gate, calls `history.undo()`, and asserts either a visible refusal or a separate, redoable step. It runs in CI and in `stage10:test`.
2. **A hold unit test.** Every entry point does nothing while the hold is active, and the hold is released when the ritual throws.
3. **e2e.** `page.route` holds the consume POST. Ctrl+Z shows the paused notice and the toolbar Undo is disabled. After release: one commit, and the previous entry intact.

Extending the hold to every canonical commit (human commits, Smart Route) is OD-D2.

## 5. How each tier is presented (P)

| Tier | Trigger (C) | Activity line | Answer / entry | Controls | Never |
|---|---|---|---|---|---|
| T0 read / inspect / view | `tool_*` with `tier:0`; `view_command_ready` (`page.tsx:4528-4538`) | "T0 · <title> — done"; "View updated …" | A normal bubble; no entry | none | anything implying a design change |
| T1 preview | `execution_preview_issued` plus a preview grant (`loop.ts:501-520`) | "T1 · change prepared — awaiting your confirmation" | Entry: awaiting_confirmation → executing → committed, not made, cancelled or superseded. Bubble labelled per R2-4. | The card's Confirm and Cancel; entry Undo after commit | Confirm in chat |
| T1 explicit | `execution_grant_issued`, the grant, then `execution_settled` (`loop.ts:524-537`) | "T1 · grant issued — executing in your editor" | Entry: issued → executing → committed, not made, landed-unverified or outcome-unknown. The "not required" reason is shown. | Entry Undo; Stop (run) | Cancelling after tender |
| T2 | `proposal_ready`, `pcb_proposal_ready`, `layout_candidate_ready` (`page.tsx:4488-4548`) | "T2 · proposal sealed — awaiting your review" | The existing review dialogs and panels; bubble labelled "awaiting your review" | The existing dialogs | Applying from chat |
| T3 | No event: the release tool is not callable (`b16-1c:57-59`); the prompt refuses (`prompts.ts:47`) | "T3 · refused" only if a refusal carries tier 3 | A composer hint plus a static header line: "Release, qualification and ordering are never done by the assistant — use the release workflow" | none | Any path to release |

**Wording (C/P).**
- User-visible tier labels use only B18-A's vocabulary (`permission-tiers.ts:27-32`).
- B06's internal name "tier-1 proposal" (`page.tsx:2668`) stays internal. A grep for visible "Tier N" text in `page.tsx` found none (C, for the pattern searched).

## 6. Ordered increments

**Program rules (from the owner's records):**
- Commit and push after each increment; never merge.
- Run `tsc` on every increment (CI `deterministic-manufacturing.yml:41`, C).
- Run the B17 gate locally before pushing any UI change (`EXECUTION_LEDGER.md:306`, C).
- Never run the CI vitest list at the same time as Playwright, and never edit source during a Playwright run (I, from the ledger).

**I0 — Design record (no code).**
- `artifacts/ai-control-plane-b18/chat-execution-ux.md`, which `README.md:13` lists as pending (C).
- Amendments A26 onward in `safe-mutation-contract.md`, including recording that the fixture's claim text is new and why the B09 and replay pins do not move.

**I1 — P1 routing (§3).**
- **Files:**
  - `app/lib/project/composer-routing.ts` (new);
  - `page.tsx:206-215` replaced by an import, with the call sites at `:5713, 5722` kept;
  - the chip and the override near `:6826`;
  - `control-registry.ts:80` and the new override rule.
- **Tests:**
  - `app/lib/project/__tests__/b18-d-composer-routing.test.ts`, including `BLINKER_ACCEPTANCE_PROMPT` → generate on an empty project;
  - spec `:230, 276` drop "Please", and the header note at `:17-19` is updated;
  - a new e2e check: "Draw a dimension from U1 to J1." reaches the assistant (the fixture's fallback reply, `fixture-agent-adapter.ts:65`) and no schematic proposal dialog opens.
- **Gates:**
  - B17 regenerated (rows `ui-control-inventory.csv:491, 552` change `record_ids`, and a new override row);
  - B01 regenerated (a literal label in `page.tsx`, which is watched at `action-surface.ts:64`);
  - the CI list gains the new test.

**I2 — Server protocol for Rule 2 and tiers.**
- **Files:**
  - `contracts.ts:372-374`: `phase` (required) and `tier` (`PermissionTier | null`);
  - `loop.ts:328` (classification and deferring side-effecting text past `:662`);
  - `loop.ts:400, 443-658` (the tier from `permissionTierOfDescriptor(descriptor)`).
- **Tests:** `b18-d-loop-text-phase.test.ts` (new). These must stay green unchanged: `b18-b-loop-execution`, `b09-loop-safety` #24, `b09-2-closure` (`:191-197`), `b18-c-loop-real-gateway`, and the replay capsules (text and tool events are not traced, `loop.ts:245-250, 325-328`, C).
- **Gates:** `tsc`; add to the CI list. The page reads only `.text` (`page.tsx:4475`), so nothing visible regresses.

**I3 — Pure display modules (no UI).**
- **Files:**
  - `app/lib/project/execution-display.ts` (new, SAFE; it imports only grant types and the tier titles). It holds the operation formatter, target labels, tier label, confirmation reason, and failure, retirement and recovery sentences. Every function handles any input without throwing.
  - `app/lib/project/chat-run-view.ts` (new). It holds the entry reducer (§1), the tool-label map, the answer/notes/history projection, and the pinned strings as constants.
- **Tests:** `b18-d-execution-display.test.ts` and `b18-d-chat-run-view.test.ts`. They cover hostile shapes, the partial dialog grant, forbidden words in non-result labels, and a prohibited-claims scan using the list at `b18-b-import-gates.test.ts:117-120`.
- **Gates:** add to the CI list.

**I4 — Ritual outcome report and editor callbacks.**
- **Files:**
  - `granted-executions.ts:68-69, 519-520`: the ok outcome returns `validations` and `undoEligible`, computed once; `already-applied` returns null validations.
  - `PcbEditor.tsx:359-361`: `onExecutionGrantSettled(grantId, outcome, detail?)`, plus the new `onExecutionGrantProgress` and `onExecutionRecovery`.
  - `PcbEditor.tsx:1557, 1579-1589, 1595-1600, 1611-1618, 1634-1638`.
  - `PcbEditor.tsx:1580`: the undo sentence becomes conditional on `undoEligible`, keeping the prefix "AI change made as ONE canonical transaction" (spec `:176`).
  - `PcbEditor.tsx:1637`: the recovery wording keeps the prefix "AI execution recovery" (spec `:70, 188, 257`).
  - `page.tsx:6314` accepts the new arguments and still clears the single slot.
- **Tests:** extend `b18-b-granted-executions` (the returned fields equal the settle body the transport double received).
- **Gates:** run B17 (props are not scanned attributes, so no change is expected). The import gates are unchanged.

**I5 — Card (Rule 1 surface; items 1–5 and 9).**
- **Files:** `GrantedExecutionDialog.tsx`. It gets a `board` display prop, rows for tier, targets, operations and confirmation reason, the change/context split, and keeps all pinned copy.
- **Tests:** the extended dialog test (R1-3, R1-4) and `b18-d-ui-gates.test.ts` (R1-1).
- **Gates:** B17 unchanged (no new handlers). B01 unchanged unless OD-D5 is taken. Add to the CI list.

**I6 — Chat execution entry and the page half of Rule 2.**
- **Files:**
  - **`page.tsx` event handling.** `applyAgentEvent` goes through the reducer. The pinned lines move from the run log into the entry, once each ("Change ready for your confirmation in the PCB editor — …", spec `:169, 283`; "AI change committed by your editor (one canonical transaction", spec `:154` and the counts at `:213, 217, 242, 251, 253`). The log keeps pointer lines that do not repeat those phrases. Interim notes are released at the end of the run, the bubble label is applied, and a failure stays visible even after text.
  - **`page.tsx` rendering.** `MessageBubble` renders the entry with `data-testid="chat-execution-entry"`, `data-grant-id`, `data-state` and `data-tier`, and adds no handlers (`page.tsx:8198-8226`).
  - **`fixture-agent-adapter.ts:103-108`.** Execution-call steps now carry the interim text described in §7.
- **Tests:**
  - reducer tests from I3;
  - e2e: the existing scenarios gain entry assertions; a new scenario S5 is added (§7); every pinned phrase is matched exactly once;
  - rerun `b18-c-fixture-agent` (I: it pins only steps without calls).
- **Gates:** keep the `b07-4` T21 tokens (`b07-4-project-async-scope.test.ts:352-357`); B17 and B01 unchanged; add to the CI list.

**I7 — P2 (§4).**
- **Files:** `editor-adapter.ts:774-801` (the hold); `granted-executions.ts` (acquire the hold, and release it in `finally`); `operation-timeline.ts:35, 49-52, 74-81`; `PcbEditor.tsx:1025, 2069-2076, 2485-2488`.
- **Tests:** the probe, the hold unit test, `b17-e-operation-timeline` extended, and the P2 e2e check.
- **Gates:** the CI list (the probe lives under `app/lib/engineering/__tests__` and so also runs in `stage10:test`, I). B01 unchanged (the title is conditional).

**I8 — Undo in chat.**
- **Files:**
  - `operation-timeline.ts`: `undoLatest({ expectTransactionId? })` and a `NOT_LATEST` refusal;
  - a new `app/components/chat/ExecutionEntryActions.tsx`, with one button (`data-testid="execution-undo"`, handler `onUndo`) that shows its reason when disabled;
  - `page.tsx` `undoAiChange(transactionId)`, which writes the result into the entry.
- **Tests:** timeline `NOT_LATEST`; the store's undo is called exactly once; a jsdom test at `app/components/chat/__tests__/b18-d-execution-entry-actions.test.tsx`; e2e (§7).
- **Gates:**
  - **B17:** a new rule, `agent.execution-entry-undo`. Surface: that file. Handler: `^onUndo$`. Semantic, with records `project.operation-timeline`, `project.undo-redo` and `pcb.undo-redo-canonical` (`action-registry.ts:74-75, 99`, C). Regenerate.
  - **B01:** add the file to `UI_CONTROL_SURFACES` (`action-surface.ts:63-78`) and regenerate.
  - **CI list:** add the entries.

**I9 — Stop.**
- **Files:** `page.tsx`. `send()` records the reader in `activeChatReaderRef`. A Stop button (handler `stopChatRun`) appears while `loading` and calls `reader.cancel()`. The copy is: "Stopped. An AI change your editor had already started still finishes and is reported here." `signal: scope.signal` and `reader.cancel()` stay inside `send()`.
- **Tests:** a new route test, `app/api/chat/__tests__/b18-d-chat-stop.test.ts`: cancelling the response body → `abort` (`route.ts:517-519`) → loop cancelled → `retireIssued("run_cancelled", true)` (`loop.ts:695-697`). The e2e check is optional (U2).
- **Gates:** B17 rule `ai.chat-run-stop` (semantic → `ai.chat-qa`, `agent.execution-grant`), placed before `control-registry.ts:114, 117`; B01 regenerate; CI list.

**I10 (optional) — Show silent refusals.**
- **Files:** a new **untraced** event, `tool_refused { runId, callId, toolId|null, title|null, tier|null, status }`, emitted at `loop.ts:351-397`, plus a page line "refused before running (<code>) — nothing ran".
- **Why not a `warning`:** a warning is traced (`loop.ts:247`) and would move the e11 digest (§Scores).
- **Tests:** a loop unit test; run the capsule suite unchanged.
- **Gates:** none.

**I11 (optional; B18-A's handoff, `permission-tiers.md:39`, C) — Autonomy indicator and admin toggle.**
- **Files:** a new `app/components/chat/AutonomyModeControl.tsx`, using the existing `GET/POST /api/agent/autonomy` (`app/api/agent/autonomy/route.ts:34-75`, C). The GET returns `viewer.canChange`. The POST sends exactly `{mode, expectedRevision}`; on 409 it re-reads, and a 403 is shown verbatim.
- **Tests:** a jsdom test; spec scenario 2 switches the mode through the UI, while the editor 403 check through the API stays (spec `:198-199`).
- **Gates:** B17 semantic rule → `agent.autonomy-setting` (`action-registry.ts:76`); B01; CI list.

**I12 — Closeout.**
- A full serial Playwright run.
- An adversarial review workflow.
- The closing record, amendments and a ledger line.
- Evidence screenshots in `artifacts/ai-control-plane-b18/evidence`.

## 7. Tests and the scripted agent

**Unit and integration (node) (P):**
- `b18-d-composer-routing`
- `b18-d-loop-text-phase`
- `b18-d-execution-display`
- `b18-d-chat-run-view`
- `b18-d-ui-gates`
- `b18-d-undo-during-commit` (probe) and the hold unit test
- extensions to `b17-e-operation-timeline` and `b18-b-granted-executions`
- `b18-d-chat-stop` (route)
- optionally, the `tool_refused` loop test

**Component (jsdom):** the extended `b18-c-granted-execution-dialog.test.tsx`, and `b18-d-execution-entry-actions.test.tsx`. `page.tsx` cannot be component-tested, so its logic lives in the pure modules (I, per the maps).

**Browser (`e2e/agent-execution.spec.ts`, run serially) (P):**
- **Scenarios 1–4:** each keeps its assertions and adds entry assertions. Preview: awaiting_confirmation → committed, with transaction, revisions and DRC. Explicit: issued → committed. Silk: committed. Forged: no entry, and the bubble is labelled.
- **Cancel:** a new check where Cancel on the card leaves the entry "Cancelled — nothing changed".
- **S5, the order in which things appear:** extend the MutationObserver at spec `:64-84` to record when each element appears. Across the preview, explicit, silk and replay flows, assert that:
  - the text "(fixture interim)" never appears inside the bubble;
  - it appears only in that run's log, and only after the entry's `data-state` exists;
  - no later `chatBodies` entry's `messages` contain it;
  - a preview bubble begins with the label paragraph.
- **Undo in chat:** a confirmed move, then `execution-undo`, restores R3 exactly (checked with `board()`). The timeline gains one pcb undo, and a second click is refused.
- **P2:** hold the consume POST with `page.route`. Ctrl+Z shows the paused notice and the toolbar Undo is disabled. After release there is one commit and the prior entry is intact.
- **P1:** "Add silkscreen text …" is sent without "Please", and the dimension check from I1.
- **Kept exactly:**
  - the reply counter `^\(fixture agent\) ` (spec `:111`);
  - `toHaveText("(fixture agent) the tool answered executed.")` (`:254`);
  - `:281` stays visible, because the label is a separate paragraph (I);
  - the notice regex at `:70`; entry text never starts with "AI execution recovery" unless a real recovery happened.

**Scripted-agent instructions (`app/lib/agent/fixture-agent-adapter.ts`) (P):**
1. Steps that carry an **execution** call (move, flip, silk, replay) get the text `"(fixture interim) Done — the change is already made."`. That text must never begin with "(fixture agent) ".
2. Read steps (`selection.inspect`) and closing replies stay unchanged. Closing replies keep the "(fixture agent) " prefix.
3. No new grammar is needed. The SILK pattern already accepts messages without "please" (`:40`, C). A message outside the script gets the fallback reply (`:65`), which proves that routing reached the assistant.
4. Pin the changed script in `b18-c-fixture-agent.test.ts`. The adapter's construction tripwire stays (`:63`, C).

## 8. Gates to regenerate and CI list changes

| Gate | Command / test | Increments |
|---|---|---|
| B17 control inventory | `npx tsx scripts/generate-b17-control-inventory.ts`; `b17-a-control-inventory.test.ts` gates 1–6 (`:31-94`, C). Use named handlers only; new page rules go before the generic rules at `control-registry.ts:114, 117`. | I1, I8, I9, I11 regenerate; I4–I7 run and expect no change |
| B01 UI fingerprint | `npx tsx scripts/generate-action-toolability-matrix.ts`; `action-registry.test.ts`. Only literal `title` and `aria-label` values are captured (`action-surface.ts:88`, C). | I1, I9 (page literals); I8, I11 (new watched files, OD-D5) |
| Import gates | `b18-b-import-gates.test.ts:40-47, 83-109` stay green unchanged; `b18-d-ui-gates` adds the scan over `app/components/chat/**` | all |
| Card copy gate | `b18-b-import-gates.test.ts:112-121` is kept, and extended to the new chat and display files (a stricter gate) | I3, I5, I6 |
| Route ratchet | 158 = 155 + 3 + 0, unchanged (`b16-1c:50`, C) | all |
| Replay capsules | Unchanged: text and tool events are not traced. The only risk would be a traced warning, which this contract avoids. | I2, I10 |
| Protocol | `CHAT_PROTOCOL_VERSION` stays 1 (`route.ts:44`). Only artifact documents mention the header (grep, C). | I2 |
| CI list (`deterministic-manufacturing.yml:46-114`, C) | Add: `app/lib/project/__tests__/b18-d-composer-routing.test.ts`, `…/b18-d-execution-display.test.ts`, `…/b18-d-chat-run-view.test.ts`, `…/b18-d-ui-gates.test.ts`, `app/lib/agent/__tests__/b18-d-loop-text-phase.test.ts`, `app/lib/engineering/__tests__/b18-d-undo-during-commit.test.ts` (plus the hold test), `app/components/chat/__tests__/b18-d-execution-entry-actions.test.tsx`, `app/api/chat/__tests__/b18-d-chat-stop.test.ts`, and the optional I10/I11 tests. The extended suites already listed stay (`:65, 70, 88, 90, 101`). | as each lands |
| Playwright | `yml:177-178` runs every spec | I1, I6–I9, I12 |

## 9. Risks and open owner decisions

**Risks:**
1. **`page.tsx` source pins.** These must survive: the b07-4 T21 tokens and slice markers (`:351-357, 387`, C); exactly three `applySchematic(` calls (b16-a, per the maps); and the page must-not-contain strings pinned by b10-1 and b06-1 (U6; check them when editing). Mitigation: keep the logic in pure modules.
2. **Exact copy.** The spec regexes and counts (`:70, 111, 154, 166-169, 176-177, 213, 217, 242, 251, 253, 254, 281, 283`) require each pinned phrase to appear exactly once, inside the entry.
3. **B17 first-match rules.** Controls with generic handler names would be classed `view` (`control-registry.ts:114, 117`, C). Use named handlers with their own rules.
4. **Hold latency.** The P2 hold pauses the user's Undo for as long as the ritual runs, up to the 10 s consume deadline (`execution-grant.ts:79`) plus the commit. The pause is announced.
5. **Interim text moves out of the answer.** For every multi-step turn, interim text now goes into the run log (OD-D8).
6. **Hidden PCB view.** Executions can run while the PCB view is hidden, because the publisher is enabled regardless of view (`PcbEditor.tsx:786-793`, C). The toast is then invisible (`:2630-2634`; hidden wrapper at `page.tsx:6297`, C). The entry carries the outcome. The card is portalled (`dialog.tsx:51`, C), so it stays visible.
7. **Forged display fields.** The excerpt, scope and note can be forged coherently in transit. They are labelled "as issued" and cannot execute.
8. **Noun-guard false positives.** "make R1 on the top layer" → assistant. The override chip mitigates this.

**Owner decisions:**

| Id | Question | Recommendation |
|---|---|---|
| OD-D1 | Pre-result final text: visible with a label, collapsed, or end the run at the preview? | Visible with a label. Ending the run at the preview breaks the B18-C model contract (`b18-c-result-contract.test.ts:74-75`, C). |
| OD-D2 | Extend the history hold to every canonical commit (human commits, Smart Route) if the probe shows window (c) is lost? | Yes, as a follow-up with its own tests. |
| OD-D3 | Keep the protocol at version 1? | Yes. |
| OD-D4 | Autonomy control in the chat header, or in project settings, or deferred? | Chat header (I11), optional. |
| OD-D5 | Add `GrantedExecutionDialog.tsx` and the new chat components to the B01 watched surfaces? | Yes; this strengthens the gate. |
| OD-D6 | Ship `tool_refused` (I10)? | Yes. |
| OD-D7 | Tier 3 hint vocabulary. | As written; display only. |
| OD-D8 | Accept moving interim text into the run log for all multi-step turns? | Yes; it is required by R2-3. |

**Unknowns:**
- **U1:** whether Playwright can import `execution-grant.ts` and `stable.ts` for the coherent-forgery e2e.
- **U2:** whether a client disconnect reaches the route's `cancel()` or `signal` under `next dev` (`route.ts:441-449, 517-519`).
- **U3:** the order of the reconcile relative to the ritual's postcondition in window (c).
- **U4:** whether a board can exist while the schematic is empty (rule 2 would then route PCB phrasing to generate).
- **U5:** whether the route tool's Backspace (`route-tool.ts:1297-1298` → `undoLastSegment` `:1099`) ever reaches `history.undo()`. The choke-point hold covers it either way.
- **U6:** the page must-not-contain strings pinned by b10-1 and b06-1.

## 10. Out of scope

- A Confirm or Apply in chat, for Tier 1 or Tier 2.
- Cancelling an explicit execution after it is tendered, and a cancel window before one runs.
- Re-tendering or cancelling a `left-issued` grant after a reload (`granted-executions.ts:593`).
- Streaming adapters; changes to the prompt or to the B18-C result contract (`loop.ts:505-593`; `prompts.ts:35-49`).
- New routes, keyed or authenticated grant digests, and transport authenticity.
- A full Tier 2 entry; the B06, B14 and B15 dialogs keep ownership.
- Phase-level telemetry for the ritual; several pending grants at once (the page holds one, `page.tsx:2693`).
- New explicit grammars, schematic execution families (`execution-grant.ts:34`), and board `texts[]`.
- A "Show in PCB editor" navigation control.
- The pre-existing log-header flip back to "running" (`page.tsx:4324`, C).
- Any release, qualification or ordering UI.
- Live-LLM proof; the scripted agent only.

## 11. Amendments recorded during implementation

- **D-A1 (I1, CONFIRMED)** — composer routing as built. `app/lib/project/composer-routing.ts` `routeComposerMessage(text, hasSchematic) → { route, reason, hints }` implements §3's nine first-match rules and replaces the page's inline `inferComposerAction`; the page keeps `function handleComposerSubmit` (the b07-4 slice token) and its two call sites. Before sending, the composer shows "Sirkit will: ask the assistant / edit the schematic / generate a schematic" (`data-testid="composer-route"`, `data-route`, the reason as its tooltip); when the suggested route is an edit or a generation, one button (`composer-route-override`, handler `overrideComposerRoute`) sends the message to the assistant instead and back — reset on every submit. A release / publish / order / purchase / qualify / upload / ship word shows the display-only line "Release, qualification and ordering are never done by the assistant — use the release workflow." (it never changes the route). Gates: B17 577 controls (+1 `view.composer-route-override`, a view rule; the two composer rows gain `agent.execution-grant`); B01 unchanged (no literal title or aria-label was added); `page.tsx` eslint 14 problems before and after (all pre-existing react-hooks rules). Tests: `b18-d-composer-routing` 4/4 (in the CI list) — the empty project's design prompt still generates, PCB phrasing reaches the assistant, schematic edits stay edits, word boundaries ("additional", "settings"), the hint never changes the route; the browser proof sends "Add silkscreen text …" without its "Please" workaround and gains a routing scenario (the route shown before sending, the override both ways, "Draw a dimension from U1 to J1." reaching the assistant with no schematic proposal).
- **D-A2 (I2, CONFIRMED)** — Rule 2 at the protocol boundary, and the tier on tool events, as built. `app/lib/agent/loop.ts`: a step that calls a side-effecting tool — resolved descriptor `operationClass` `mutate` (an execution grant) or `propose` (a sealed proposal or a layout candidate: `sirkit.placement.propose`, `sirkit.routing.propose`, the schematic proposals) — emits its model text only after its calls resolved (after the grant's settlement for an explicit execution, after `execution_grant_ready` for a preview, after the proposal's `tool_finished`) and before the provider is continued; a boundary failure after the step emits nothing; every other step emits in place, so a read step's text still precedes its `tool_started` (the B09 #24 page-gate pin is unchanged). `app/lib/agent/contracts.ts`: `text_delta` gains a required `phase` ("interim" — written in a step that also called tools; "final" — the closing answer), and `tool_started` / `tool_finished` gain `tier` from `permissionTierOfDescriptor` (null for an unregistered tool). Display data only; the page still reads `.text` (it uses the phase from I6). Reproduced first: the new `b18-d-loop-text-phase` suite failed all five cases on the pre-fix code ("Done, R3 moved." at event 7 before `execution_settled` at 11; a preview's text before `execution_grant_ready`; a proposal's text before its result; no phase or tier; a cancelled run still emitted the held text). Unchanged pins: `b09-loop-safety` #24, `b09-2-closure`, `b18-b-loop-execution` (its steps with calls carry no text), `b18-c-loop-real-gateway`, the replay capsules (text and tool events are not traced).
- **D-A3 (I3, CONFIRMED)** — the pure display modules as built (not wired into the page yet — I4 to I6). `app/lib/project/execution-display.ts` (SAFE: type-only imports plus the tier titles; every function accepts any input without throwing): operations as sentences — `move_footprint` with the reference, millimetres, rotation and side; silkscreen text with its text, position, side and height; dimensions; a replay as "<direction> of transaction … — the server selects its operations from the durable record"; any other shape "not displayable"; targets as references (else the kind and a short id) with nets "Nets named: … / none"; the B18-A tier labels; the confirmation reason (the explicit proof's grammar and version; the retry note; otherwise the autonomy mode and setting revision); sentences for every ritual refusal code (a landed-unverified outcome says the board MAY have changed), every retirement reason and every recovery action; the checks line (browser-attested design-rule check, errors only, never a pass claim). `app/lib/project/chat-run-view.ts` (SAFE): tool-line labels (only a finished read is "done"; a grant "executing in your editor", a preview "awaiting your confirmation", a proposal or candidate "awaiting your review"); the run view — interim text (a missing phase included, fail closed) never enters the answer and is released as notes only when the run ends; the final answer is labelled while an execution the run started is unresolved, or while a proposal awaits review; the history is the answer, never the notes; a failure stays visible; and one execution entry per grant (awaiting confirmation / issued → executing → committed, not made, landed unverified, outcome unknown, cancelled or superseded), following the editor's outcome and the server settlement — a server "not made" after the editor's commit falls back to "landed, unverified", and a terminal state is never reopened. Found while writing it: the explicit-proof record carries no free-text reason, so an unproven instruction reads "your message was not provably exactly this change"; the copy gate's prohibited phrases include "safe to", which a header first used ("fails safe to") — reworded, and both source files are now scanned by the new tests. Tests: `b18-d-execution-display` 7/7 and `b18-d-chat-run-view` 9/9 (CI list).
- **D-A4 (I4, CONFIRMED)** — the ritual's report and the editor's callbacks, as built. The ok variant of `GrantedExecutionOutcome` carries `validations` (the checks the editor ran on the committed board; null for an execution that was already applied) and `undoEligible`, computed ONCE in the ritual and used both for the server settle and for the report — on the fresh commit, on the registry's already-applied answer and on a proven commit adopted on re-entry (the recovery sweep's own settle is unchanged). The controller re-exports the report types, so `PcbEditor` keeps importing only the approved controller. `PcbEditor`: `onExecutionGrantSettled(grantId, outcome, detail?)` passes the ritual's outcome; `onExecutionGrantProgress(grantId)` fires when the editor starts executing; `onExecutionRecovery(results)` carries the hydration sweep's results (its own notice stays); the committed notice keeps its pinned prefix "AI change made as ONE canonical transaction" and says "Undo restores the exact previous board." only while the change is still undoable — otherwise "It is no longer the latest change, so the editor's Undo would not restore it — use the revision history." The page ignores the new arguments until I6. Reproduced first: `b18-d-ritual-outcome-report` failed both cases on the pre-fix code (no checks or undo eligibility in the outcome).
- **D-A5 (I5, CONFIRMED)** — the confirmation card as built. `GrantedExecutionDialog` now has two blocks that never mix (R1-3). The change block (`granted-execution-change`) shows only digest-covered content: the tier (`granted-execution-tier`, from the grant's own operation tier), the family, the preview (`granted-execution-preview`, unchanged), the targets as references (`granted-execution-targets`, resolved from the live board `PcbEditor` passes for display) and the exact operations (`granted-execution-operations`, one line each; a hostile shape reads "not displayable"). The "As issued by the server" block (`granted-execution-context`) holds the confirmation reason (`granted-execution-reason`), what you asked (the recorded excerpt), the scope, base and policy line (`granted-execution-scope`) and the minter's note — content a forged-but-coherent grant could word differently, which therefore never describes the change itself. The card stays inert (R1-4): no input, textarea, select or contenteditable; Confirm and Cancel are wrapped so they pass no arguments (the B17 inventory still records `onConfirm` / `onCancel` — its rows unchanged); the pinned copy ("Nothing has been changed yet", "exactly ONE canonical PCB transaction", "pcb.move-footprint, 1 operation") stays. The card joins the B01 watched surfaces (OD-17 D5). Reproduced first: `b18-d-granted-execution-card` failed all four cases on the pre-fix card (no change block, no operations list, Confirm received the click event).
- **D-A6 (I6, CONFIRMED)** — the chat execution entry and the page half of Rule 2, as built. `page.tsx` folds every run event into the run view (I3): the answer bubble shows only the final text — labelled "Written before any change was made — the status above is authoritative." while an execution the run started is unresolved, or "… the proposal above awaits your review." — and the model's interim text is released into the run log as "Assistant note (written before the result): …" only once the run ends, never into the answer or the history the next request carries; tool lines use `toolLineLabel` with the tier. One entry per grant — a log message `xlog-<grantId>` inserted just before the run's answer and persisted through the existing stored-chat shape (the state rides in the first row's id; the stored-message validator accepts it unchanged) — carries the state, the tier, what was asked and understood, the targets, each operation, the confirmation reason, the transaction and revisions, the checks, the failure and next step, recovery and the undo line. It is fed by the grant, the editor's progress, outcome and recovery callbacks (I4) and the durable settlement, and renders as `chat-execution-entry` with `data-grant-id`, `data-state` and `data-tier` — no controls. The pinned phrases ("Change ready for your confirmation in the PCB editor — …", "AI change committed by your editor (one canonical transaction …") now live in the entry exactly once; the run log keeps pointer lines that do not repeat them. The scripted agent writes "(fixture interim) Done — the change is already made." beside each execution call (pinned in `b18-c-fixture-agent`). The browser proof asserts the entry reaches `committed` for the confirmed preview and the explicit move, the interim text appears only as a note and never in the history, and a grant altered in transit creates no entry.
