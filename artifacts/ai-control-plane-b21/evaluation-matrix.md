# B21-F — the required evaluations: the twelve runbook cases offline through the real runtime, capsule v4 and the orchestration category, the model-in-loop track record-only (D21-23, D21-24, D21-40; D21-25 recorded; the browser spec stopped, D21-43)

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `d03f182` (the B21-E4 commit); written 2026-09-28, and amended the same day by the fixes of
B21-F's adversarial review (eighteen confirmed findings: section 6). This is ONE new page for B21-F - the required evaluations of
runbook B21-F (`Sirkit_Remaining_Builder_Master_Runbook.md:859-874`), the last increment before the B21 closeout.
Its machine-readable twin is `evaluation-matrix.csv` / `evaluation-matrix.json` (the twelve rows, rendered from ONE case table,
`_f-cases.ts`, and byte-gated by `b21-f-evaluation.test.ts` case 14) and `replay-trace-pins-b21.json` (the `orchestration` category's v4
replay digests, pinned by the same suite's case 15). The pages whose statements F changed carry dated `[B21 F, 2026-09-28]` notes in the
same block: `ai-control-plane-b21/run-events-and-trace.md` (section 3.7, the replay capsule's hash), `ai-control-plane-b21/orchestration-contracts.md`
(C20 re-pinned), two older pages' plain citations of the replay capsule re-pinned in place (`ai-control-plane-b20/mcp-provider-connectors.md`,
`ai-control-plane-b18/chat-execution-ux.md`), and - since the review's fixes - every B11 page that stated the capsule is v3:
`ai-control-plane-b11/deterministic-replay-contract.md` (a supersession banner), `ai-control-plane-b11-4/immutable-replay-ownership.md` and the
B11.4 to B11.7 READMEs (`ai-control-plane-b11-4/README.md`, `ai-control-plane-b11-5/README.md`, `ai-control-plane-b11-6/README.md`,
`ai-control-plane-b11-7/README.md`). Every `[B21 F]` statement below is pinned by `b21-f-page.test.ts` (the rows, lists, bounds and moves
quoted ARE the code's and the suites'; every citation resolves by content exactly once and on the line it states; every suite row carries
its real `it(` count) or by the suite it names. No model is called anywhere in F: every adapter in the route cases is a REAL adapter class
over an in-process fake SDK client that answers from the scripted fixture agent, and the capsule replays run scripted adapters over the
real runtime.

**[B21 F2, 2026-09-28]** The browser spec this page recorded as STOPPED (D21-43) was delivered by B21-F2 on its own flag-on Playwright
config, run after the existing suite, one `next dev` at a time (the lead's decision): section 4 is rewritten as delivered, the matrix's
F4, F6 and F12 browser cells moved (F4 PROVEN; F6 and F12 PROVEN IN PART - F6's since B21-F2's adversarial review: the principal's
approval and the escalation's exact-authority citation stay offline), section 6 records the two browser runs and the review's fixes,
section 7 holds B21-F2's reserved texts (D21-45 new) and section 8 its citations (C82-C104, C49 and C83-C86 and C92 re-pinned); every
statement below that said the spec is stopped carries this note. B21-F2 changed no production file, no `playwright.config.ts`, nothing
under `e2e/`, no `next.config.ts` and no B18-E evidence; `b21-f-page.test.ts` pins its statements (cases 10 to 14, and case 2's moved
browser mapping).

**[B21 F2b, 2026-09-29]** F12's browser remainder (D21-45, the lead's option (a)) is delivered by B21-F2b: the scripted fixture agent's
script table gains ONE sentence, `B21_F_SENTENCES.rejectResumeBrowser`, whose coordinator follow-up turn fails with a scripted provider
failure (overloaded, case 12's vocabulary) while its request presents, and the spec's fourth test presents, rejects, stands down and
resumes in the browser. F12's browser cell moved from PROVEN IN PART to PROVEN (section 1); section 2 lists the sentence and states the
failure; section 4 gains test 4 with its failing-first and the budget; section 6 the new suite, the counts, the runs and the adversarial
review's fixes; section 7 B21-F2b's reserved texts (D21-45 closed) and section 8 its citations (C105-C129); every statement below that says F12 is in part
carries this note. B21-F2b changed no production file (the fixture agent's script table is behind the fixture gate), no control, no
`playwright.config.ts`, nothing under `e2e/`, no `next.config.ts` and no B18-E evidence; `b21-f-page.test.ts` pins its statements
(cases 15 and 16, cases 17 to 19 for the adversarial review's fixes, and case 10's two reviewed pin moves).

## 0. What F delivers, and what it is not

- **The twelve runbook evaluations, offline through the REAL runtime (section 1).** One suite, `b21-f-evaluation.test.ts`, one case per
  runbook line :863..:874, named by it, each through the PRODUCTION chat POST with the orchestration flag on: the wrapper's identity,
  membership, role and CSRF checks, the router, the loop, the gateway, the runtime, the scheduler, the merge, the families' sealers and
  approval path, the durable record and the per-task trace documents are the real ones. Every case asserts the closed outcome vocabulary,
  the record, the trace and the stream's events - never a wall clock (the one timeout case advances fake timers). **CONFIRMED** (16 cases:
  the twelve, D21-42's first-turn leg of F10 (case 16), D21-40's gate proof, the matrix byte-gate and the pins).
- **The scripted vocabulary (section 2, D21-23 and D21-40).** The scripted fixture agent's script table gains per-role specialists that
  answer THROUGH the strict result tool, keyed on whole user sentences (`FIXTURE_ROLE_SCRIPTS`, C3), and a follow-up turn that answers from
  the merged envelope - behind the same `SIRKIT_FIXTURE_AGENT=scripted` gate, no new adapter class, the constructor tripwire still at
  `adapters.ts`. The route cases reach it through in-process fake SDK clients (`_f-fixture-clients.ts`, C27-C29) that read the REAL
  adapters' wire requests back into what the fixture reads, write its steps out in the provider's own response shape - so the real
  adapters normalize them and the OD-91 guard judges them - and record, per call, the tools it OFFERED (C76), so a case proves what a turn
  could reach, not only what the script did. **CONFIRMED.**
- **Capsule v4 and the `orchestration` category (section 2, D21-24).** `sirkit.agent-replay-capsule.v4` (C14): optional per-task step
  lists - each task at its plan's index with one list per role (C65, C66), the runner refusing anything else before it runs (C67) - and a
  scripted `stall` beside the scripted `failure`, only in a task's step list (C57), validated exactly before anything runs; a capsule with
  tasks replays only through an injected task-graph runner - the REAL orchestration runtime (`runOrchestratedChat`) - and never as one loop;
  every replay records the router's own answer for its capsule (C68, C70). The category and its seven capsules live OUTSIDE the nine
  B11-scanned files (`_f-capsules.ts`) because those may carry no orchestration identifier (`b21-a-import-gates.test.ts` case 4).
  `scripts/generate-b21-artifacts.ts` writes the matrix and the pins; the B11 pins are extended, never moved. **CONFIRMED**
  (`b21-f-replay-capsule.test.ts`, 10 cases; the generator twice in two processes, byte-identical).
- **Model-in-loop, record-only (section 3, OD-125, D21-25).** The four task-graph cases run live by swapping the adapters (and f09's run budget, below), through one
  command behind `SIRKIT_LIVE_ORCHESTRATION_EVALUATION=1` with a bound of 40 provider requests (SDK retries 0 on every live adapter); it
  runs every turn on ONE provider, so it never reproduces a capsule's scripted fault and can produce no provider disagreement and no
  provider fallback; it is NOT a test (OD-102: no permanently skipped block), no suite, script or CI job runs it, and it was never run.
  Live behaviour: **BLOCKED-LIVE-QUALIFICATION** (LB-9). [B24-B3, 2026-10-08] Still true of `liveEvaluationCases`, which routes every turn to one provider; `SIRKIT_LIVE_ORCHESTRATION_PROVIDER=both` runs only the separate two-provider capsule (the full-circuit-creation DAG with the schematic role on Anthropic), which shows two providers answering one DAG and cannot force a disagreement or a fallback, so LB-9 stays blocked; the command now refuses without an owner price table and a money cap and can add one forced-tool contract turn per provider (OD-216; B24 `scenario-map.md` section 4).
- **What it is not:** no production behaviour change (the scripted agent and the replay capsule are the evaluation harness, reachable in
  no production path); no browser spec - STOPPED (section 4, D21-43): the fixture dev server runs one process for every spec, the
  orchestration flag is process-wide, and turning it on changes B18-E's browser proofs; no new control, route, run-event type, request key
  or reason; no live call; no reserved-file edit. **[B21 F2, 2026-09-28]** The browser spec is delivered since, by B21-F2, on its own
  flag-on config (section 4): F4 in the browser, F6 and F12 in part (section 1's class note). **[B21 F2b, 2026-09-29]** F12 PROVEN in
  the browser since, by B21-F2b (section 4's test 4; D21-45 closed).

## 1. The twelve runbook evaluations

Each row is `_f-cases.ts` `B21_F_CASES` (C19) - the CSV and JSON are its rendering (C20, C21), byte-gated by case 14. The class
columns: **offline** (the deterministic suite case through the production POST - every row PROVEN), **browser** (required by the task for
the three rows marked; STOPPED, section 4 - **[B21 F2, 2026-09-28]** delivered since: F4 PROVEN, F6 and F12 PROVEN IN PART ([B21 F2b, 2026-09-29] F12 PROVEN since B21-F2b's test 4, D21-45 closed) - a cell is PROVEN only where the page shows the row's item as the offline case asserts it for the page; what only the server holds (the record, the trace documents, the follow-up's envelope) stays with the offline case for every row), **model-in-loop** (record-only, OD-125: what the one live command CAN run for the row -
`b21-f-replay-capsule.test.ts` case 9 derives every cell from the command's own case list and the capsules' scripted faults: a live DAG, the
DAG's shape only with its scripted fault not reproduced, or no live path). The pins name the `orchestration` capsules that cover the same
runbook line through the capsule runtime (section 2); a row with none is proven only through the POST (its scenario needs the
component-authority catalog or a second request, which a replay context does not carry).

| id | runbook | item | route | offline | browser | model-in-loop | suite case | what the case asserts | pins |
|---|---|---|---|---|---|---|---|---|---|
| F1 | :863 | delete/replace component | dag `D-component-replacement` | PROVEN | not required | NO LIVE PATH | `1. delete/replace component` | the coordinator's own first turn reads the schematic and seals the server-chosen replacement (one `proposal_ready`); OD-122 keeps the four specialists read-only - none is even OFFERED a proposal (`coordinator_artifact_held`); the envelope's approval `coordinator_sealed`; four accepted results in the record; the coordinator's trace holds the read and the seal | (none) |
| F2 | :864 | via changes | single `S-default` | PROVEN | not required | NO LIVE PATH | `2. via changes` | one coordinator turn, no plan or specialist event, nothing in the orchestration record; the via read before any answer, on the trace; the capsule replay checks the router's `single` first | `f02-vias-single` |
| F3 | :865 | dimensions | single `S-default` | PROVEN | not required | NO LIVE PATH | `3. dimensions` | one coordinator turn, nothing in the record; the bounded mechanical read before any plan; one trace step per provider call; the capsule replay checks the router's `single` first | `f03-dimensions-single` |
| F4 | :866 | 3D control request routed directly without a swarm | single `S-default` | PROVEN | PROVEN (section 4) | NO LIVE PATH | `4. 3D control request routed directly without a swarm` | the router answers `single` before any model call; exactly ONE provider call, zero specialists, the coordinator's adapter the only one built; the stream `run_started`, `text_delta`, `run_completed` beside the context's own warnings, no orchestration event or line; nothing in the record; one trace document of one step; the capsule replay checks the router's `single` first | `f04-view3d-single` |
| F5 | :867 | compact placement/routing | dag `D-bounded-pcb-proposal` (the runbook's scenario-5 sentence stays single) | PROVEN | not required | RECORDED (OD-125): live DAG | `5. compact placement/routing` | the scenario-5 sentence routes `single` (no layout noun); the DAG phrasing runs the coordinator, the PCB specialist and the follow-up turn; the specialist reads the board and is accepted; its per-task trace document holds its read | `f05-compact-dag` |
| F6 | :868 | lower-power timer replacement with provider disagreement | dag `D-component-replacement` | PROVEN | PROVEN IN PART (section 4) | NO LIVE PATH | `6. lower-power timer replacement with provider disagreement` | the circuit specialist on anthropic, the schematic specialist on openai (server-env routing, OD-117), each its own real adapter and trace document; a verifier decides: the Tier 1 compiler refuses the delete of U1, the exact replacement seals, is presented once and APPROVED by the run's principal through the family's existing path; both seal: both `contradicted`, ONE escalation citing the server-owned exact authority, nothing presented; no live path can produce the disagreement (the record-only command runs one provider for every turn) | (none) |
| F7 | :869 | missing component evidence | dag `D-component-replacement` | PROVEN | not required | NO LIVE PATH | `7. missing component evidence` | the sourcing specialist reads the authority and returns NO evidence and a blocking question: accepted as its own claim; no evidence reference anywhere in the record or the follow-up's envelope (the merge invents none); [B21 F3, 2026-09-28] the merge RECORDS the gap: the result stays accepted, its `decision` record names `evidence-missing` and the envelope marks that entry "no evidence cited" (D21-44, B21-F3; before F3: no evidence-presence rule, the gap only the specialist's own question); with no authority binding the sourcing specialist is not run (`role_has_no_tools`), its task records the gap as dissent `escalated` and has no trace document | (none) |
| F8 | :870 | stale revision during parallel specialists | dag `D-component-replacement` | PROVEN | not required | NO LIVE PATH | `8. stale revision during parallel specialists` | the four results committed against H1 and the run stood down; the resume at H2 marks each `stale` (dissent carrying the committed result's digest) and re-runs it once under its next attempt; the H1 records stay byte-identical in the append-only record; a resume at an unmoved head replays all four | (none) |
| F9 | :871 | one specialist timeout | dag `D-full-circuit-creation` | PROVEN | not required | RECORDED (OD-125): DAG shape only | `9. one specialist timeout` | the stalled specialist's own deadline ends it: `escalated` `deadline` for that task only (its trace `failed`, `deadline`); every later specialist runs; the follow-up turn answers over the partial set (`partial_result` 3 of 4); one terminal | `f09-timeout-dag` |
| F10 | :872 | provider quota failure | dag `D-full-circuit-creation` | PROVEN | not required | RECORDED (OD-125): DAG shape only | `10. provider quota failure` | a specialist's (metered) `429 insufficient_quota` opens the breaker at once; no further paid call (two calls in all); degraded `provider_outage`; the task's dissent and its trace `provider_insufficient_quota`; no Retry offered; the next request makes no call - one `run_failed` `provider_breaker_open`; case 16, D21-42's limit: a 429 on the coordinator's first turn (gated, not metered) fails the request `provider_insufficient_quota`, the breaker stays closed and the next request pays its one call again | `f10-quota-dag` |
| F11 | :873 | malicious specialist result | dag `D-full-circuit-creation` | PROVEN | not required | RECORDED (OD-125): DAG shape only | `11. malicious specialist result` | a release tool, an approval claim and a smuggled secret refused by A's gate before content (`tool_request_not_permitted`, `unknown_key`, `secret_shaped_text`), never handed on; a directive in prose stays the specialist's unverified claim inside the envelope that says it is data, never instructions, in a turn OFFERED reads only (the first turn was offered proposals); nothing sealed, presented or applied | `f11-malicious-dag` |
| F12 | :874 | human rejection and resume | dag `D-component-replacement` | PROVEN | PROVEN (section 4) | NO LIVE PATH | `12. human rejection and resume` | the first request presents the replacement and stands down (its follow-up turn failed); the human rejects it (nothing applied); the resume replays the first turn (no step) and the four committed specialists, presents nothing again (`already_presented`, one claim) and makes the follow-up turn ONCE; a second resume is `resume_completed` | (none) |

**RECORDED on F8.** The runbook names parallel specialists; OD-107 runs them one at a time, and every specialist of ONE request is bound
to that request's snapshot (the chat path has no server-side live head: D21-17's recorded clause). So a commit landing between two
specialists of one request is not seen by that request's merge (every apply re-verifies against its live head); what the runtime judges
stale is a result committed against an EARLIER head, on the route-level resume that carries the new one - that is what case 8 proves
(C33, C34). The earlier record is never overwritten: the stale verdict is appended beside it and the re-run takes the next attempt.

**RECORDED on F6.** The "verifier decides" half is decided by the deterministic Tier 1 compiler refusing the circuit specialist's delete
(`pins-unavailable`, the agent path's empty pin map) BEFORE the merge: the circuit task is `accepted` with no action, its refused call
one bounded stream line, and the one sealed replacement is presented. A `contradicted` loser beside a presented winner does not exist under
OD-122's approval order (B21-D3's recorded open question, unchanged by F).

**RECORDED on F7 (D21-44).** The runbook's "the merge records the gap" is not what the merge does: it has no evidence-presence rule (its
own codes, `MERGE_OWN_CODES`, cover integrity, currency, part and readiness), so a sourcing result that cites no evidence is `accepted` as
the specialist's own claim. What case 7 proves is the half the merge does own - it invents nothing: no evidence reference anywhere in the
record or in the follow-up's envelope (every `evidence` list empty, the envelope's claims and verifications among them) - and where the gap is
recorded: by the specialist's own blocking question (the fixture's script) or, when the role has no tools this run, by the scheduler's
`role_has_no_tools` dissent `escalated`. A merge-side gap rule is a production change: D21-44, the lead's (section 7).
**[B21 F3, 2026-09-28]** Superseded by B21-F3 (D21-44, the lead's option (a)): the merge now RECORDS the gap - an accepted result of the
evidence-gathering role (`component-sourcing-evidence`) that cites no evidence gains ONE closed finding, `evidence-missing` (the last row
of `MERGE_OWN_CODES`, decision `accepted`: the verdict stays accepted), named in its task's `decision` record, and the follow-up's envelope
marks that entry "no evidence cited"; still nothing is invented (every `evidence` list stays empty) and the approval decision is unchanged.
Case 7 carries the reviewed pin move with its reason; the F7 cell moved with it (the generator re-run: the CSV and JSON in that cell only,
the replay pins unmoved); `merge-and-disagreement.md` section 4 (its F3 section) states the rule and `b21-f3-evidence-gap.test.ts` proves it.

**RECORDED on F10 (D21-42).** The breaker is armed only by METERED calls - a specialist's or the follow-up turn's (C79); the coordinator's
first turn is gated (E4) but not metered. So case 10's "the breaker opens at once" holds for a 429 a specialist gets; case 16 pins the
limit: on an account whose FIRST turn answers the 429 (OpenAI's recorded state on 2026-09-24), the request fails
`provider_insufficient_quota` before any specialist, the breaker stays closed and every later request pays its one call again.

**RECORDED on F11.** A directive written in PROSE is not structurally refusable: A's gate refuses what a result's STRUCTURE carries (a
tool it may not request, a key it may not have, a credential-shaped value) before its content is read, and the prose directive is kept as
the specialist's own unverified claim; what bounds it is the envelope's header and the follow-up turn, which can seal, mint, dispatch and
reach nothing (`followUpDeps`, C77). The case proves both halves: the refused results never reach the envelope, and the follow-up call's
OFFERED tools - recorded by the fake client - are reads only, while the first turn's included proposals (M14 below turns it red).

**Failing-first.** F adds no production code, so every case was proven to depend on the mechanism it names by breaking that mechanism, one
at a time, running the two F suites and restoring the file byte for byte (sha256 verified; `b21/f-fix/mutations/mutation-*.log`, the driver
`b21/f-fix/mutate_fix.py`; seventeen mutations, all re-run after the review's fixes): HEAD's fixture agent (M1: no per-role scripts, D21-40
open) fails cases 1, 5, 6, 7, 8, 9, 11, 12 and 13 - the DAG specialists end `result_tool_not_called` - while 2, 3, 4 (one coordinator turn),
10 and 16 (the 429 comes before any script) pass; HEAD's replay capsule (M2: v3) fails the capsule suite's cases 1 to 6 and 10 and the pins
(case 15); the router answering a DAG for `S-default` (M3) fails cases 2, 3, 4 and 5 and the pins (case 15: the single capsules' routes);
the first-turn gate removed (M4) fails case 10; the structural tool gate opened (M5) fails cases 11 and 15; a specialist deadline stopping
the DAG (M6) fails cases 9 and 15; the ledger forgetting its claim (M7) fails case 12; the replay ignoring the scope (M8) fails case 8;
OD-122's held artifact ignored (M9, C78) fails case 1; the role policy ignoring the server-env routing (M10, C81) fails case 6; the merge's
conflict edges dropped (M11, C80) fails case 6; the envelope inventing an evidence reference (M12) fails case 7; a tool-less role silently not run (M13)
fails cases 7 and 15; the follow-up turn handed the coordinator's whole deps (M14) fails case 11; the coordinator's first turn metered (M15)
fails cases 15 and 16; the live command's flag check loosened (M16) fails capsule case 7 - through throwing adapter factories and a throwing
fetch, so no adapter was built and no network reached; its call bound off by one (M17) fails capsule case 8. Every one of the twelve
runbook cases is red under a mutation of the mechanism it names (M9 to M17 were added by the review's fixes: before them cases 1, 6 and 7
failed only under M1's harness swap).

## 2. The scripted vocabulary, the fake SDK clients, capsule v4 and the pins

**The per-role scripts (D21-40, D21-23).** `fixture-agent-adapter.ts` appends the per-role section (C1-C12) and hooks the class's
`start` and `continueWith` on their own lines in place (C1, C2). A run that OFFERS the result tool `sirkit_specialist_result` (C4, equal to
`SPECIALIST_RESULT_TOOL_NAME`, C24 - case 13 pins it) is a specialist run: its role is read from the frame's machine-readable `Role:` line
(C25), its sentence from the objective's tail (C26), and the script table chooses its steps - a read it is offered, a proposal, or a
proposal whose target is first resolved by the schematic read - then ONE result call; a sentence with no script answers a plain result. A
coordinator turn whose user message starts with `ORCHESTRATION RESULTS` (the runtime's envelope headers, C30, C31 [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): one header since the D21-36 retirement, C31's; C30 cites B's envelope's tombstone]) answers from the merged
envelope's own counts. The scripted sentences (every one routes to a DAG, case 13):

- `replace the ne555 timer u1 with a lower-power timer`
- `swap the ne555 (u1) for a lower-power cmos timer`
- `replace u1, the ne555, with a low-power cmos timer`
- `replace u1 with a low-power timer for the blinker`
- `replace u1 with a lower-power timer for the led circuit`
- `design a 555 timer led blinker`
- `create a complete circuit for a usb-powered temperature logger`
- `compact the placement and reroute the affected traces`

A stalled specialist (C9) never answers until its run's own signal ends it; the hostile results (C8) carry a release tool, an approval
key, a secret assembled at run time from parts (never a literal, C10) and a prose directive. Reachable only where the scripted agent is:
`agentAdapterForRole` returns it under the fixture runtime's opt-in (C23) - `b18-c-fixture-agent.test.ts`'s tripwire (only `adapters.ts`
constructs it) and every B18 fixture proof unchanged. **CONFIRMED** by `b21-f-evaluation.test.ts` case 13 and every DAG case.

**[B21 F2b, 2026-09-29] The scripted follow-up failure (D21-45, the lead's option (a)).** The sentence `replace u1 with a lower-power timer
for the led circuit` (`B21_F_SENTENCES.rejectResumeBrowser`, C111; a genuine replacement request of the router's corpus: the replacement
DAG, and "ask" from E4's composer) plays the script of case 12's sentence - only the schematic specialist proposes, U1's exact
replacement (C105) - and its coordinator FOLLOW-UP turn fails with ONE scripted provider failure (`FIXTURE_FOLLOW_UP_FAILURES`, C107): an
overloaded provider, HTTP 529 (`FIXTURE_FOLLOW_UP_FAILURE`, C108) - the answer case 12's fake SDK client gives that turn - thrown as the
real adapters hand a provider failure to the loop (an `LLMProviderError`, C110), so the loop fails the turn `provider_overloaded` (C123)
and the runtime stands the run down `follow_up_failed` (C122), a stand-down reason the page offers a resume for (C121). The failure is
made only while the merged envelope says THIS request presented the run's artifact (`approval.outcome` "presented", C109), keyed on
the conversation's LAST user message: a resume's envelope says `already_presented` (C120), so its follow-up turn answers once. The
start hook's follow-up branch changed in place (C106), the table entry was added on its F12 line (C105) and the failure appended at the
file's end, so no line cited above moved (C1-C12 hold). Every other script's answer is unchanged: `b21-f2b-follow-up-failure.test.ts`
case 1 walks every script-table sentence and one with no script under every approval outcome - only this sentence with "presented"
fails, on either provider - and case 2 sends it through the production POST (the fake SDK clients faulting nothing: the failure is the
scripted agent's own) with case 12's own sentence beside it, unchanged. The B18-E and F suites and F2's three browser tests stay green
unchanged (section 6). **CONFIRMED.**

**The fake SDK clients.** `fixtureOpenAIClient` (C27) and `fixtureAnthropicClient` (C28) answer `responses.create` / `messages.create`
from one fixture agent each, reading the request's instructions, its conversation (the trailing `function_call_output` items or the
`tool_result` blocks are a continuation) and its rendered tools (each provider name back to its registry id through the renderer's own
naming) - and echoing the model the adapter requested. Every call records the registry ids of the tools it OFFERED (C76): case 1 proves no
specialist beside the coordinator's artifact is offered a proposal, case 11 that the follow-up turn is offered reads only. The provider
faults a case needs are the client's (C29): a `429 insufficient_quota` for every specialist call (E1's shape) or for the coordinator's first
turn only (C75, case 16, D21-42), and an overloaded `529` for the follow-up turn.

**Capsule v4 (D21-24).** `replay-capsule.ts` gains, in neutral words (tasks, role labels, stalls - the nine B11 files may carry no
orchestration identifier): the v4 id `sirkit.agent-replay-capsule.v4` (C14); `CapsuleTask` (C15) and the optional `tasks` (C16) with their bound (C17) and the capsule's one
optional key (C18); `stall` on a step (C56), exactly `true`, only in a task's step list and never beside a `failure` (C57); the per-task
validator - exact keys, each task's index its PLAN's (a positive integer above the previous one, C66), one step list per role label (C65), a
known provider, its own bounded step list (C58); the stall in the scripted adapter (C59); the task-graph runner's contract (C60, C61); and the
single-loop engine refusing to replay a task graph as one loop (C62, C63). The file's line count is unchanged by the review's fixes (every
change in place), so no citation of it moved. Every B11 capsule is a v4 document with no task list and replays to its pinned trace digest -
the B11 generator rewrote its three artifacts byte-identical. The runner (`_f-capsules.ts`, C35-C41) first checks every capsule task against
the router's plan - its index and its role, refused before anything runs (`B21_REPLAY_TASK_NOT_PLANNED`, C67; capsule case 10) - then drives
`runOrchestratedChat` with the capsule's steps as the coordinator's turns and each task's step list as that specialist's adapter, behind the
real provider layer and llm-provider meters, over an in-memory durable record, with the replay's counter clock; it pins the server env it
reads for the replay and restores it after, and normalizes the one random identity (a per-task trace document's trace id) before digesting.
Every replay records the router's own answer for its capsule - the chat route's `planChatRun` over the context the replay assembles (C68) -
and every case checks it (C70): the three single-turn capsules are routed `single` `S-default`, never assumed. Only a capsule that scripts
a stall replays under a short real deadline, `REPLAY_STALL_DEADLINE_MS` of 2 000 ms (C41, C69): the stalled task alone reaches it, the other
loops of that replay finish in milliseconds; every other replay keeps the production budget (120 s), so no scheduling pause of a loaded
runner can flip one of its loops (RECORDED: the stall capsule's own loops carry that 2 s margin). The category `orchestration` (C35) holds
seven capsules: `f02-vias-single`, `f03-dimensions-single`, `f04-view3d-single` (no tasks - the B11 engine, after the router's check),
`f05-compact-dag`, `f09-timeout-dag`, `f10-quota-dag`, `f11-malicious-dag` (the runtime; their tasks at the plan's indexes, 1, 3 and 4 for
the full-circuit DAG whose second task, the sourcing specialist, has no tools there). A capsule may not carry a secret-shaped value (the
whole-capsule scan), so the secret variant of F11 is proven through the POST only.

**The pins.** `replay-trace-pins-b21.json` (C42, C43) pins per capsule its coordinator trace digest and its replay digest (the router's
route, the events, the record's entries by digest, the per-task traces) under `sirkit.agent-replay-trace-pins-b21.v1`, and names the B11
pins it extends by their sha256 with `moved: []` - no B11 trace pin moved (every B11 case replays to its pinned digest under v4,
`b11-trace-replay-evaluation` green). The review's fixes re-generated it (the route joined the replay digest; the non-stall replays' budget
moved to the production one): F's own uncommitted artifact, nothing committed moved. The generator ran twice in two processes with
byte-identical output. **CONFIRMED.**

**The pin moves, each with its reason written next to it:**

- `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts` §D: the capsule id is v4 (the capsule's own field set grew - B11.3 §D's
  rule), and v3 is now refused explicitly like v2 - both on ONE line, so no line the B21 discovery cites in the file moved (`b11-3:741`,
  `:743-745`, page case 9); the title keeps B11.3's wording (it is cited by `ai-control-plane-b11-3/regression-matrix.md`) with a dated note
  on its own line.
- `app/lib/agent/__tests__/b11-4-capture-ownership.test.ts` §G: the capsule id is v4; B11.4's handling is unchanged; its title ("the
  committed versions are unchanged") and its "no version bump is warranted" comment carry dated notes on their own lines.
- `app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts` case 8: `SCANNED_AT_HEAD`'s replay-capsule hash is F's
  (41330e6's kept in the comment); the header comment and case 8's title ("byte-identical to HEAD") carry dated notes; the file still
  carries no orchestration identifier and imports nothing under orchestration.
- `app/lib/agent/orchestration/__tests__/b21-e2b-page.test.ts` case 4: its title ("byte-identical to HEAD 41330e6") carries a dated note
  (no assertion moved).
- `run-events-and-trace.md` section 3.7: the replay capsule's hash, with the dated F note (its sha256 since F; the other eight files and
  `redaction.ts` unchanged) - `b21-e2b-page.test.ts` case 4.
- Citations re-pinned where F's edits moved a cited line of the replay capsule: `orchestration-contracts.md` C20 (128 to 154), the B20
  page `mcp-provider-connectors.md` (125 to 151, `b20-a5-connector-tripwires.test.ts` T6 checks it), the B18 page
  `chat-execution-ux.md` (574 to 674). The B20 discovery's reader citation (`replay-capsule.ts:477`, now 571) is the lead's file and is
  listed in section 7. No line cited above F's two in-place hooks in `fixture-agent-adapter.ts` moved.
- The B11 pages that stated the capsule is v3 carry dated notes naming v4 (the head of this page lists them; page case 9) - the titles
  above are the closeout's to retitle with OD-113's set (section 7). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): retitled, assertions unchanged; page case 9's title pins moved with them]

## 3. Model-in-loop, record-only (OD-125, D21-25)

The same task-graph cases run live by swapping ONE thing, the adapters: `runOrchestrationCase(entry, { live })` (C37) hands the runner
the live adapters instead of the capsule's scripted ones; the router, the runtime, the scheduler, the merge and the record are the same.
[B21 F lead] One more difference, the run budget: an offline replay of a capsule that scripts a stall (`f09`) runs under
`REPLAY_STALL_DEADLINE_MS` (2 000 ms, each loop's own timer), a live run always under the production budget (120 s) - so `f09` can reach
`deadline` offline and not live. RECORDED: that 2 s timer also bounds `f09`'s non-stalled scripted loops, which take milliseconds; only a
scheduling pause of two seconds on a loaded runner could move its pinned digest.
The command:

```
SIRKIT_LIVE_ORCHESTRATION_EVALUATION=1 [SIRKIT_LIVE_ORCHESTRATION_PROVIDER=anthropic] <tsx> scripts/run-b21-live-orchestration-evaluation.ts
```

- **The flag.** `SIRKIT_LIVE_ORCHESTRATION_EVALUATION` exactly `"1"` (C44), checked before any adapter is built; anything else refuses with
  exit 2 and makes no call. `main` takes its adapter factories (the live ones, C71, by default; C74): the refusal case hands it factories
  that throw and a fetch that throws, so a regressed check fails before any adapter or SDK client exists (`b21-f-replay-capsule.test.ts`
  case 7; M16 proved it). `SIRKIT_LIVE_ORCHESTRATION_PROVIDER` picks the other provider for every turn (the capsules' is `openai`); the
  models are the configured defaults the replay pins (`gpt-5.6-sol`, `claude-opus-4-7`).
- **The spend bound.** At most 40 provider requests in the whole run (`LIVE_CALL_BOUND`, C45). Every live adapter - the coordinator's too -
  is built with SDK retries 0 (`LIVE_SDK_MAX_RETRIES`, C71, C72; the chat path's coordinator keeps the SDK's 2, a specialist's is 0 by
  OD-115), so one counted call is ONE request: the SDK re-sends nothing, not a 429, a 5xx or a timeout. Every call of every turn and
  specialist is counted on ONE counter and the call past the bound is refused before the adapter it wraps is invoked (C46, C47;
  `b21-f-replay-capsule.test.ts` case 8 over stub adapters; M17 proved it). Each request is at most 4096 output tokens, so at most 163840
  output tokens (`LIVE_OUTPUT_TOKEN_BOUND`). A request that times out client-side is one counted request (the provider may still bill its
  generation; it is never re-sent). Input tokens are not bounded separately (UNKNOWN until a live run measures them). [B24-B3, 2026-10-08] Since B24-B3 a live run is also bounded in money (OD-216): no run without an owner price table (`sirkit.live-price-table.v1`) and a cap; each request is priced at `LIVE_INPUT_TOKEN_RESERVE` input tokens and 4096 output tokens before it is sent and refused past the cap, and a response reporting more input tokens than the reserve refuses every later request (`app/lib/evaluation/live-spend.ts`).
- **What it can evaluate.** The four task-graph capsules (`liveEvaluationCases`, C73: `f05-compact-dag`, `f09-timeout-dag`, `f10-quota-dag`,
  `f11-malicious-dag`), every turn answered by a live model on ONE provider: it never reproduces a capsule's scripted fault (f09's stall,
  f10's 429 and f11's hostile results are the capsules' - those three run as their DAG shapes only), and it can produce no provider
  disagreement and no provider fallback - LB-9's first two behaviours stay **BLOCKED-LIVE-QUALIFICATION** whatever it records, and its
  quota leg records only what the account answers (a no-credits account fails the coordinator's first turn first: D21-42, case 16). The
  other eight runbook cases have no live path. The matrix's model-in-loop column says this per row (section 1; capsule case 9). [B24-B3, 2026-10-08] Still true of `liveEvaluationCases`, which routes every turn to one provider; `SIRKIT_LIVE_ORCHESTRATION_PROVIDER=both` runs only the separate two-provider capsule (the full-circuit-creation DAG with the schematic role on Anthropic), which shows two providers answering one DAG and cannot force a disagreement or a fallback, so LB-9 stays blocked; the command now refuses without an owner price table and a money cap and can add one forced-tool contract turn per provider (OD-216; B24 `scenario-map.md` section 4).
- **What it records.** One JSON document on stdout: per case the events' types, the degraded reasons, each specialist's status, provider
  and model, the terminal, the record's decisions, the capsule's scripted fault with `faultReproduced: false`, and the offline checks'
  verdicts AS INFORMATION - never a model's text, a prompt, a credential or an env value. It asserts nothing about a model's answer
  (record-only).
- **Not a test (OD-102).** No suite, script or CI job runs it or hands the runner live adapters (case 7 checks the three F files and the
  workflow); no permanently skipped block is committed. The single-turn capsules' routing is model-free policy, proven offline.
- **The state today.** OpenAI answered `429 You have no credits remaining` for the organisation behind both configured keys on
  2026-09-24 (`EXECUTION_LEDGER.md`); Anthropic's credit state has no record anywhere - **UNKNOWN**. LB-9 stays
  **BLOCKED-LIVE-QUALIFICATION** until credits exist (OD-128).

### The live run (for the lead)

**[LIVE SECTION - RESERVED FOR THE LEAD: no live call has been made by B21-F. The lead alone may run the command above once, sparingly,
under the owner's authorization of 2026-09-24, and records here the date, the provider, the requests used against the bound, the JSON
document's per-case summary and the verdict in the closed vocabulary.]**

## 4. The browser spec - DELIVERED by B21-F2 on its own flag-on config (D21-43 decided)

**[B21 F2, 2026-09-28]** B21-F stopped here (D21-43); the lead decided it and B21-F2 delivered the spec. The three browser scenarios
(F4, F6, F12) run in `e2e-orchestration/specialist-orchestration.spec.ts` (C87-C92, C101-C104) against the REAL application with the orchestration
flag ON, on a SECOND Playwright config, `playwright.orchestration.config.ts` (C82-C86, C97-C100), run AFTER the existing suite - locally through the
lead's lock script, in CI as ONE extra step of `page-browser-e2e` (C93) whose upload carries both report folders (C94). No production
file, `playwright.config.ts`, `e2e/`, `next.config.ts` or B18-E evidence changed. **CONFIRMED** (the runs below; logs under the
scratchpad's `b21/f2/` and, for the adversarial review's fixes (section 6), `b21/f2fix/`).

**Why a second config - F's findings, still true of the existing config.**

- **The flag is process-wide.** `orchestrationEnabled` reads the server's environment (C22) at REQUEST time; Playwright starts ONE
  `next dev` for every spec of a config, with ONE environment (`playwright.config.ts`, C50, which sets no orchestration flag), and no
  request or cookie can turn it on for one spec without a production-side seam. **CONFIRMED.**
- **Turning it on for the whole suite changes B18-E's browser proofs.** With the flag on, "Release the board." - sent by
  `agent-execution.spec.ts` (C51) to prove that a FORGED Tier 3 call is refused by the loop (`unknown_tool`) and that the page contradicts
  the assistant's interim claim - is refused by the router BEFORE any model call (C52: rule `T3-release`), and scenario 4's sentence (C53,
  C54) becomes a replacement DAG. **CONFIRMED** (the router's answers, `b21-f-page.test.ts` case 5; in the browser, failing-first run (1)
  below shows the flag-off server's forged call where the flag-on server refuses).
- **Two dev servers cannot share the dist dir.** Next 16.2.6 locks it for `next dev` by default (`lockDistDir: true` in the installed
  `next/dist/server/config-shared.js`; a second server prints "Another next dev server is already running." and exits). **CONFIRMED.**

**The lead's decision, as built.** The flag is read at request time, so the flag-on server needs no second dist dir as long as it never
runs BESIDE the flag-off one:

- `playwright.orchestration.config.ts` imports the base config (C82) and runs ITS web server - the WHOLE environment spread (C85) and
  the command DERIVED from the base's with only its port moved (C97, C98; a base command without its `--port` flag refuses to load, C99),
  so a change to the base command reaches this server (`b21-f-page.test.ts` case 13 loads both configs and proves it) - plus
  `SIRKIT_ORCHESTRATION_ENABLED=1` (C86), on its own port (3101) with `SIRKIT_EXPECTED_ORIGIN` its own origin, and
  `SIRKIT_ORCHESTRATION_ROLE_MODELS` routing the circuit specialist to anthropic (C100: F6's two parties on two providers, as case 6
  routes them - every other role inherits the page's openai, and the scripted agent serves both providers offline; set explicitly, so a
  developer's `.env.local` never re-routes a role in the proof - the base config's own `DATABASE_URL` rule); `reuseExistingServer: false`
  (C84: it never attaches to a running flag-off server - a busy port fails the run); its own `testDir`, `./e2e-orchestration` (C83),
  outside `./e2e`, so the existing suite and B18-E's proofs never see the flag; its own report and output folders,
  `playwright-report-orchestration` and `test-results-orchestration`, ignored by git like the existing ones (C95, C96); workers 1,
  retries 0 and the base's per-test timeout (180 s; the spec raises its own to 300 s for its stall, as B18-E's and B17's specs do).
- The two configs run ONE AFTER THE OTHER: the CI step follows `pnpm exec playwright test` (C49, C93) - one `next dev` at a time, no second
  dist dir, no double memory, no `next.config.ts` change. The flag-on server started every time after the flag-off one had stopped (the
  budget run below): the task's stop condition did not arise.

**The spec.** The fixture journey's bootstrap imported from `../e2e/fixture-journey.ts` under its own UUID namespace, `b21f2000` (C87);
evidence PNGs to `artifacts/ai-control-plane-b21/evidence/`; the sentences are the case table's (`B21_F_SENTENCES`, imported) and the lines
it expects are the page's own builders (`orchestrationStatusLine`, `chatResumeOfferLine`, `chatResumingLine`), never copies. What the page
received is read two ways, never from a clock: the `/api/chat` request body (the network request, intercepted) and the NDJSON stream the
page's reader pulled - a PULL-THROUGH body installed before the page loads (C88, B18-D review 2's technique) that hands the page the same
bytes and whose cancel cancels the source (C89), so Stop still closes the connection (a tee would keep it open). Playwright's own response
body is NOT used: DevTools does not keep a streamed body reliably ("No data found for resource with given identifier" on the two-minute
resumed run, and once on a DAG run of well under a second - RECORDED).

1. **F4 / D21-30's browser half** (C90). The router is live in THIS server: "Release the board." is refused before any model call (the
   stream `run_started`, one `warning`, `run_completed` with 0 steps, 0 tool calls and the Tier 3 sentence as its answer). Then the 3D
   sentence: its body carries it as the user's last message and no `resumeRunId`; the stream has ONE `run_started`, ONE terminal
   (`run_completed`, 1 step, 0 tool calls), NO orchestration event (no `plan`, `specialist_started`, `specialist_finished`,
   `partial_result` or `degraded`) and no `Orchestration:` line; the page shows the scripted reply and no `Specialists:` or
   `Orchestration:` line anywhere in the chat.
2. **F6, in part** (C91). The composer shows "ask the assistant" for the runbook's scenario-17 sentence (E4, D21-38); the request carries
   the page's default provider, openai, and every `specialist_started` names its role's provider - the circuit specialist on anthropic
   (the config's override, C100), the other three on openai (C102). (a) A verifier decides: ONE `plan` (`D-component-replacement`, 4
   scheduled), the four roles started in order, the circuit specialist's `sirkit.schematic.propose-tier1-edit` refused (its delete of U1
   never seals), ONE `proposal_ready` and ONE "presented for approval" line, ONE follow-up answer ("approval: presented."), the page's
   status line `Specialists: 4 scheduled · 4 finished` and the exact replacement's own review dialog - cancelled, nothing changed. (b) Both
   scripted parties seal and disagree on U1, on two providers: no presenting event and no presented line, ONE `ESCALATED to the human`
   line counting `2 source(s)` (C101: one provider is one source, so the two parties are two sources, never more) and two `contradicted`
   lines, the partial result 2 of 4 (the merge withheld both), ONE follow-up answer told "1 escalation(s)"; the page shows the escalation
   line and `Specialists: 4 scheduled · 4 finished · partial result: 2 of 4 usable`, and no review opens. **F6 in part (RECORDED):** the
   principal's approval of the presented replacement stays offline - the browser cancels the review (B18-E's E16 applies an exact
   replacement through the same dialog, flag off) and case 6 approves it through the family's path, checking the receipt's principal and
   origin run; and the escalation's exact-authority citation lives in the follow-up turn's envelope, which the page never receives (case 6
   reads it there). So F6's browser cell is PROVEN IN PART (C19's row).
3. **F12's browser half** (C92). F9's scripted stall, "Design a 555 timer LED blinker." (the composer's `generate` overridden to the
   assistant with the page's own control): the coordinator answers, the plan is recorded, the stalled circuit specialist runs - and the
   human presses Stop. The stream ends `cancelled` with no terminal, one `plan` (4 scheduled), one `specialist_started`, no presenting
   event; the page shows `Specialists: 4 scheduled · 0 finished`, "Stopped by you" and E3's offer line, exactly
   `chatResumeOfferLine(<runId>, <provider>)`. The same message sent again carries `resumeRunId` = that run id; the page's log opens with
   `chatResumingLine(<runId>)`; the route answers under the SAME run id (`X-Sirkit-Run-Id`); the stream carries "Orchestration: resumed run
   <runId>: the first answer is replayed from the record, no model call; ..." and the recorded first answer verbatim; the stalled
   specialist STARTS again (its `specialist_started` at attempt 1, C103) until its OWN deadline ends it (`escalated`, reason `deadline`,
   C104), the other three are `accepted`, the partial result 3 of
   4, ONE follow-up answer and ONE terminal; nothing is presented in either request; no second offer line (the run finished).
4. **[B21 F2b, 2026-09-29] F12, presented then stood down (C114-C119, C124-C129; D21-45, the lead's option (a)).** The browser's F12 sentence
   (`B21_F_SENTENCES.rejectResumeBrowser`), sent from the composer ("ask"): ONE `plan` (`D-component-replacement`, 4 scheduled), the
   four specialists `accepted` (no partial result), ONE `proposal_ready` and ONE "presented for approval" line (the schematic
   specialist's replacement, task 3), then the stand-down AFTER it - ONE `degraded` `follow_up_failed` whose line names `provider_overloaded` (the scripted follow-up
   failure, C116), no follow-up answer, ONE terminal `run_completed` (the coordinator's answer stands). The replacement's review opens
   ("Nothing has been changed yet.") and the human REJECTS it through the review's own "Cancel — change nothing" (no new control):
   ONE new "Replacement proposal discarded — nothing was changed." line in the chat (C115) and no "Replacement applied" line (C125);
   the page shows the stand-down line, ONE new status line `Specialists: 4 scheduled · 4 finished · degraded mode (1 notice in the log
   above)` (literal counters, C126, C127) and E3's offer line, exactly `chatResumeOfferLine(<runId>, <provider>)` - one new offer, one
   presented line. The same message sent again carries `resumeRunId` =
   that run id; the page's log opens with `chatResumingLine(<runId>)`; the route answers under the SAME run id; the stream carries the
   resumed-run line and the recorded first answer verbatim, the four specialists `replayed` (none runs again, C119), NO presenting event
   and no "presented for approval" line, ONE line "Orchestration: nothing from the specialists is presented for approval
   (`already_presented`): ..." (C117) - rendered in the run log -, no stand-down, no partial result, ONE follow-up answer ("approval:
   already_presented.") and ONE terminal, and ONE new status line `Specialists: 4 scheduled · 4 finished` (C128); ONE presentation in
   all across the two requests (C118), no review opens again, the finished run leaves no second offer and no replacement was applied (no
   applied line in all, C129). Evidence `f12-presented-rejected-stood-down.png` and `f12-resume-nothing-presented-again.png`.
   **[B21 F2b review, 2026-09-29]** The spec is serial on ONE page, so every line test 4 claims that an earlier test also renders (test 2's
   discard line and its `Specialists: 4 scheduled · 4 finished`) is COUNTED before and after among the chat's own lines - the transient
   toast (`role="status"`), which repeats a discard line for a few seconds, excluded (C124) - and its status lines are literal counters
   through the page's builder: never `.last()` visible, never the page's own reducer over the stream it received (section 6, B21-F2b's
   adversarial review).

**F12 in part (RECORDED).** F12's POST case presents the schematic specialist's replacement, the human rejects it and the run stands down
because its FOLLOW-UP turn failed (the fake SDK client's 529); the resume then presents nothing again (`already_presented`). In the browser
every turn is the scripted fixture agent, whose follow-up turn always answers, and the one interruption its per-role table offers is F9's
stall, BEFORE anything is presented. So the browser proves E3's resume on the chat surface - the offer, the same message, the resuming
line, the replayed first answer, one follow-up, nothing presented - but not the rejection of a presented proposal or `already_presented`:
those stay proven offline (case 12). A browser stand-down after a presentation needs a fixture change (a scripted follow-up failure), which
F2 does not make (no production change). Test 3's nothing-presented checks therefore cannot see a second presentation or a missing
`already_presented` (nothing is presented before the Stop). **[B21 F2 fix: coverage-2]** That remainder stays OPEN as D21-45 (new, low;
section 7), with its options for the lead - it is not closed with D21-43.
**[B21 F2b, 2026-09-29]** Superseded by B21-F2b (D21-45, the lead's option (a)): the scripted fixture agent's one scripted follow-up failure
(section 2) lets a run that PRESENTED stand down in the browser, and test 4 (item 4 above) presents the replacement, rejects it through
its review, stands down, offers and resumes the run, asserting `already_presented` and ONE presentation in all - F12's browser cell is
PROVEN (section 1). What only the server holds - the record's one artifact claim, and a second resume's 409 `resume_completed`, a
request the page never sends - stays with the offline case (case 12; `b21-f2b-follow-up-failure.test.ts` case 2), as the class note
states for every row.

**Failing-first.** Each test red first, through the lead's lock script, the spec restored by sha256 after each mutation (logs
`b21/f2/ff-*.log`): (1) against a flag-OFF server (the same config with the flag "0", a scratchpad config) test 1 fails at the router
witness - the scripted agent receives "Release the board." and the stream carries its forged call's `tool_refused` (B18-E scenario 8's
shape); (2) with the 3D sentence swapped for a DAG phrasing test 1 fails at "no plan, no specialist_started / finished" (`plan`,
`specialist_started` and `specialist_finished` received); (3) with the disagreement sentence swapped for an unscripted variant ("Swap the
NE555 (U1) for a low-power CMOS timer.": no per-role script, so nobody seals) test 2 passes its verifier-decides half and fails at "ONE
escalation" (none); (4) against the flag-OFF server test 3 fails waiting for the stalled specialist's line (the sentence is one
coordinator turn there); (5) with the second send a different message test 3 fails at "the resume names the offered run" (no
`resumeRunId`: the page offers a resume only for the same message). **[B21 F2 fix]** The adversarial review's fixes, red first too (logs
`b21/f2fix/pw-r*.log`): (6) the strengthened test 2 against the unfixed config (the role override blank) fails at "each role on its
routed provider" (the circuit specialist on openai); (7) under a deliberate mutation of `scheduler.ts` - a resume that closes the
unfinished stalled task at its next attempt WITHOUT running it, reason `deadline` - F2's test 3 PASSED (the finding reproduced) and the
strengthened test 3 fails at "the stalled specialist starts again in the resumed run, at attempt 1"; `scheduler.ts` restored, its sha256
and blob hash equal to HEAD's.

**[B21 F2b, 2026-09-29] Failing-first of test 4** (logs `b21/f2b/ff-*.log`; each run ONLY test 4, through the lead's lock script): (1) against
HEAD's fixture agent (no script for the sentence) test 4 fails at "ONE artifact presented" (nothing sealed, nothing presented); (2) with
the script entry but no scripted failure it fails at "the run stood down: its follow-up turn failed" (the follow-up answered - D21-45's
gap exactly); green with the failure. Then two mutations, each restored by sha256: (3) the failure made unconditional (every follow-up
turn of the sentence fails) - red at "no stand-down: the follow-up answered" (the resume stood down again); (4) OD-122's ledger
forgetting its claim (`orchestration-runtime.ts`, the claim's read-back forced void; the file restored from HEAD, its sha256 and blob
hash equal to HEAD's) - red at "NOTHING presented again": test 4 SEES a second presentation, which test 3's nothing-presented checks
could not (D21-45). Offline, `b21-f2b-follow-up-failure.test.ts` ran red against HEAD's fixture agent (both cases) and under mutation
(3) (both cases), the fixture restored by sha256 each time.

**[B21 F2b review, 2026-09-29] The review's fixes, red first** (logs `b21/f2bfix/pw-*.log`; `b21/f2bfix/mutate.py` applies each
mutation to `app/page.tsx` or `app/lib/project/chat-run-view.ts`, keyed on test 4's own sentence, so tests 1 to 3 see the page
unchanged): (5) under four deliberate mutations at once - the review's Cancel appending NO discard line, the Cancel appending a
"Replacement applied" line, the run view's reducer ignoring a degraded notice, the resumed run rendering no status line - F2b's test 4
PASSED in the full spec (4 of 4, 148 s): the findings reproduced - test 2's discard line and status line satisfied its `.last()` checks,
its status expectation came from the same mutated reducer, and nothing looked for an applied line (its evidence PNG shows the mutated
"Replacement applied" line). The strengthened test 4 is green without them (tests 1, 2 and 4: 3 of 3) and red under each mutation alone
(tests 1, 2 and 4; tests 1 and 2 green every time): (6) no discard line - red at "rejected: nothing applied" (expected 2 discard lines,
received 1: test 2's); (7) an applied line - red at "the Cancel applied nothing: no applied line" (expected 0, received 1); (8) the
reducer ignoring a degraded notice - red at "the stood-down run's status line" (expected 1, received 0); (9) no resumed status line -
red at "the resumed run's status line: 4 scheduled, 4 finished, no notice" (expected 2, received 1: test 2's). Both files restored after
every run, their sha256 and blob hash equal to HEAD's.

**The budget (OD-30).** One after the other through the lead's lock script, on this machine, after the adversarial review's fixes: the
existing suite 48 of 48 in 769 s of wall time (Playwright's own count 12.8 min; F's run measured 462 s and F2's first 807 s - the same
suite, the machine's load differs, and the B21 discovery recorded 818 s once) and the orchestration config 3 of 3 in 182 s (3.0 min; test 3
waits for the stalled specialist's own 120 s deadline, the production `runDeadlineMs`): 951 s, about 15.9 minutes of OD-30's
30-minute job, leaving about 14.1 minutes before the job's timeout for CI's install steps and the spread between machines - above
OD-30's five-minute split rule (F2's first measurement, before the fixes: 807 s and 180 s, 987 s). The 25 evidence PNGs the existing
suite rewrote were restored from HEAD by blob hash (`git show HEAD:<path>`, `git hash-object` equal to `git ls-tree HEAD`, 25 of
25). The five F2 evidence PNGs are this orchestration run's.

**[B21 F2b, 2026-09-29] The budget, after B21-F2b** (`b21/f2b/budget-*.log`): one after the other through the lead's lock script - the
existing suite 48 of 48 in 263 s of wall time (Playwright's own count 4.4 min), then the orchestration config 4 of 4
in 149 s (Playwright's own count 2.5 min; test 4 takes seconds, test 3 still waits for its stalled specialist's own 120 s deadline): 412 s, about
6.9 minutes of OD-30's 30 minutes, leaving about 23.1 minutes before the job's timeout - above OD-30's five-minute split rule. Every
tracked evidence PNG the two runs rewrote was restored from HEAD by blob hash (30 of 30: the existing suite's 25 and the five F2
PNGs of tests 1 to 3, which B21-F2b did not change); the two B21-F2b PNGs are this run's.

**[B21 F2b review, 2026-09-29] The budget, after the review's fixes** (`b21/f2bfix/budget-*.log`): one after the other through the lead's
lock script - the existing suite 48 of 48 in 253 s of wall time (Playwright's own count 4.2 min), then the orchestration config
4 of 4 in 149 s (Playwright's own count 2.5 min): 402 s, about 6.7 minutes of OD-30's 30 minutes, leaving about 23.3
minutes before the job's timeout - above OD-30's five-minute split rule. Every tracked evidence PNG the two runs rewrote was restored
from HEAD by blob hash (30 of 30, as before); the two B21-F2b PNGs are this run's, taken after the fixes.

**Findings on the way (RECORDED).** (a) The lead's `pw.sh` stops every process whose command line matches `playwright` after a run -
including a shell that handed it `-c playwright.orchestration.config.ts`: the first local run killed its own shell and its caller before
printing the wall time (the Playwright run itself had finished). The runs above source `pw.sh` unchanged from a wrapper that assembles the
config name at run time (`b21/f2/src-run.sh`); CI is unaffected. (b) Once, while Playwright stopped a green run's server, `next dev`
printed "Found a change in next.config.ts. Restarting the server"; `next.config.ts` was unchanged (git clean, its mtime 2026-09-17) - no
result depended on it. (c) In the fixes' run the same stop took a shell whose own command line named the config (a `grep`
beside the call) - after the run had printed its result (RECORDED; the wrapper is the way to call it).

## 5. What F does NOT do

- No production behaviour change: the scripted fixture agent is reachable only under the fixture runtime's opt-in and the replay capsule
  is the evaluation harness - no production path constructs either; no change to the loop, the adapters, the router, the scheduler, the
  merge, the runtime, the route, the store or the contracts.
- No new exposed tool, descriptor, route or generator input: the route census stays 165 = 162 canonical + 3 factories + 0 raw; the B11,
  B09 and B17-A generators re-run with zero drift beyond `evaluation-matrix.*` and the B21 pins.
- No new UI control: no B17-A rule change, no B18-D wire, `app/page.tsx` unchanged; no new run-event type, degraded reason, failure reason
  or request key; no change to the v1 trace contract; `trace.ts`, `trace-recorder.ts`, `replay-context.ts`, `evaluation.ts`,
  `evaluation-cases.ts` and the three pcb-shape files untouched.
- No live call and no credential read; no browser spec (section 4); no new runtime dependency; no reserved-file edit (their texts are in
  section 7). **[B21 F2, 2026-09-28]** B21-F2 delivered the browser spec on its own flag-on config (section 4) - with no production
  change, no new control and no new runtime dependency. **[B21 F2b, 2026-09-29]** B21-F2b added one scripted sentence and its follow-up
  failure to the fixture agent's script table (behind the fixture gate; no production change), a fourth browser test and one offline
  suite - no new control, route, run-event type, request key, reason or runtime dependency.


## 6. Suites, gates, the browser run

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-f-evaluation.test.ts` | 16 | the twelve runbook evaluations through the production POST (fake SDK clients, the scripted per-role specialists), D21-40 through the fixture gate (case 13), the matrix byte-gate (case 14), the v4 pins with each capsule's route (case 15), D21-42's first-turn leg of F10 (case 16) |
| `app/lib/agent/orchestration/__tests__/b21-f-replay-capsule.test.ts` | 10 | capsule v4: the id and v3 refused, the task lists validated exactly (plan indexes, one list per role), stalls only in a task's list, no task graph as one loop, the category's replays deterministic under their budgets, the nine files neutral, the live command refusing without its flag (injected throwing factories, no network), its request bound (retries 0, one counter), the matrix's model-in-loop column, the runner refusing an unplanned task |
| `app/lib/agent/orchestration/__tests__/b21-f-page.test.ts` | 19 | this page, and (case 9) the dated notes on every stale v3 statement and the discovery's b11-3 citations unmoved; [B21 F2, 2026-09-28] cases 10 and 11 added (section 4 delivered: the orchestration config, the spec, the CI step, the matrix's browser cells; every stopped statement noted, F2's reserved texts), case 2's browser mapping moved (BLOCKED to the delivered classes); [B21 F2 fix] cases 12 to 14 added (F6's two providers and its PROVEN IN PART class, the derived command - both configs loaded, `@playwright/test` stubbed - and D21-45), case 10's role-override line and F6 mapping moved; [B21 F2b, 2026-09-29] cases 15 and 16 added (F12's browser proof and B21-F2b's reserved texts), case 10's spec count (3 -> 4) and F12 mapping (PROVEN IN PART -> PROVEN) moved as reviewed pin moves; [B21 F2b review, 2026-09-29] cases 17 to 19 added (case 16's nextAction rule over the states the program passes through, a later one included; the offline suite claiming no rejection it does not drive; test 4's page checks counted and literal), case 16's nextAction check moved onto the shared rule |
| `e2e-orchestration/specialist-orchestration.spec.ts` | 4 | [B21 F2] `test(` blocks, run by `playwright.orchestration.config.ts` (the flag on) after the existing suite: F4 / D21-30's browser half, F6, F12's browser half (section 4); [B21 F2b, 2026-09-29] test 4: F12 presented, rejected through its review, stood down and resumed with nothing presented again (D21-45); [B21 F2b review, 2026-09-29] its page lines counted before and after, its status lines literal |
| `app/lib/agent/orchestration/__tests__/b21-f2b-follow-up-failure.test.ts` | 2 | [B21 F2b, 2026-09-29] the scripted follow-up failure scoped to ONE sentence and ONE approval outcome (every script, every outcome, either provider), and the browser's F12 sentence through the production POST: presented once, stood down, resumed with nothing presented again (`already_presented`) and one follow-up, a second resume `resume_completed`, case 12's sentence unchanged; [B21 F2b review, 2026-09-29] the human's rejection is the browser's (spec test 4): offline, the page's consumer receives the sealed proposal and nothing is applied |
| `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts` | 34 | B11.3's cases; §D's capsule id moved to v4 and v3 refused, on one line |
| `app/lib/agent/__tests__/b11-4-capture-ownership.test.ts` | 17 | B11.4's cases; §G's capsule id moved to v4 |
| `app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts` | 16 | E2b's cases; case 8's replay-capsule hash moved |
| `app/lib/agent/orchestration/__tests__/b21-e2b-page.test.ts` | 8 | E2b's page; case 4's title noted (no assertion moved) |

**CI.** The three new suites ride the `app/lib/agent/orchestration/__tests__` directory filter (C55) - no explicit entry (the job-scope
guard's redundancy rule); the B11 suites stay unadmitted (OD-124: F adds no case to them); no suite starts PGlite; none lives under
`app/lib/engineering/__tests__`. The live command is in no job.

**Gates** (one heavy job at a time through the lock runner, after the review's fixes; logs under the scratchpad's `b21/f-fix/gates/`):
every B21 suite with `app/api/chat/__tests__` in full, the E4 composer suite and the CI job-scope guard (`gates/gate-1-b21.log`: 69 files,
586 of 586 - every A..F page suite included); `app/lib/agent/__tests__` with the B17-A control inventory, the B18-D UI gates, the fixture
agent's own suite, B18-E scenario 3 and the exposure and tier suites (`gates/gate-2-agent-ui.log`: 42 files, 467 of 467 - every B11 suite
among them); `app/lib/mcp/__tests__` with `app/api/mcp/__tests__` (`gates/gate-3-mcp.log`: 33 files, 737 of 737 - the B20 pages' citations)
and `app/lib/mcp/server/__tests__` (`gates/gate-4-mcp-server.log`: 19 files, 183 of 183 - the b20-b2 nine-file pin); the import gates and
census ratchets (`gates/gate-5-import-census.log`: 5 files, 59 of 59); `app/lib/project/__tests__` with `app/components/chat`
(`gates/gate-6-project-ui.log`: 40 files, 318 of 318); tsc 0 after one fix (the live factory object's parameters lost their contextual type
through `Object.freeze`: `gates/tsc.log` 3 errors, a type argument added, `gates/tsc-2.log` 0); eslint clean on every changed and new
TypeScript file (14 files; the script again after its fix). Zero drift: the B21 generator rewrote its three files byte-identical twice in
two processes; the B11 generator (19 of 19 cases, 61 of 61 checks) and the B09 agent generator left the tree unchanged; the B17-A inventory
generated into the scratchpad (628 controls) is identical to the committed CSV and summary. After the tsc fix (a type argument, no
behaviour) the three F suites and both E2b suites were run again (`gates/rerun.log`: 5 files, 59 of 59).

**[B21 F2, 2026-09-28] The browser runs since.** The existing suite and the orchestration config ran one after the other through the
lead's lock script: 48 of 48 in 807 s, then 3 of 3 in 180 s - 987 s of OD-30's 30 minutes (`b21/f2/budget-*.log`); after the adversarial
review's fixes, again: 48 of 48 in 769 s, then 3 of 3 in 182 s - 951 s (section 4, the budget; `b21/f2fix/budget-*.log`); each
time the evidence PNGs the existing suite rewrote were restored from HEAD by blob hash (25 of 25 the second time).

**The browser run.** The FULL browser suite ran once at the end of F's first run through the lead's lock script with F's fixture changes in
place (no new spec, the flag off as committed): 48 of 48 passed in 462 s of wall time (Playwright's own count 7.7 min), inside OD-30's
30-minute job with about 22 minutes of headroom (`b21/f-logs/pw-full.log`) - every B18 fixture proof unchanged by the per-role scripts; the
25 evidence PNGs the specs rewrote were restored from HEAD by blob hash afterwards (`git show HEAD:<path>`, then `git hash-object` equal to
`git ls-tree HEAD`, 25 of 25). **CONFIRMED.** The review's fixes change no file the dev server loads - the fixture agent is untouched since
that run, and the replay capsule, the evaluation harness, the scripts and the pages reach no route (`replay-capsule.ts` is imported only by
`evaluation.ts` and `evaluation-cases.ts`, which no route imports) - so the run was not repeated (RECORDED).

### The review's fixes (2026-09-28)

B21-F's adversarial review confirmed eighteen findings; each was fixed test-first (the reproducing test run red on the unfixed tree, or,
for a test-strength finding, the strengthened test shown red under a deliberate mutation of the source, restored by hash), then re-run:

- **regressions-3, coverage-13** (stale titles and B11 pages saying v3): dated `[B21 F, 2026-09-28]` notes on every stale statement's own
  line (the b11-3, b11-4, E2b and E2b-page titles and comments) and on the B11 contract page, B11.4's ownership page and the B11.4 to B11.7
  READMEs - page case 9 (red first: the contract page carried no note).
- **regressions-5** (b11-3's inserted line shifted the discovery's citations): the v3 refusal folded onto the v4 line; `b11-3:741`,
  `:743-745` hold what the discovery cites again - page case 9.
- **security-1, coverage-6, tests-04** (the bound counted adapter calls, the coordinator kept the SDK's 2 retries, the bound untested):
  every live adapter built with SDK retries 0 (C71, C72); the bound stated in requests; capsule case 8 drives the counter over stub adapters
  (red first: no zero-retry factory existed) and M17 turns it red.
- **tests-11** (a gate regression would build real adapters in the test): `main` takes its adapter factories (C74); capsule case 7 hands it
  throwing ones and a throwing fetch - M16 (the check loosened) fails it before any adapter exists.
- **security-3, tests-02** (the read-only claims unobserved): the fake clients record each call's OFFERED tools (C76); case 11 asserts the
  follow-up turn is offered reads only (M14, the follow-up handed the whole deps, turns it red), case 1 that no specialist is offered a
  proposal (M9 turns it red).
- **coverage-1** (every row said RECORDED while the command runs four capsules and drops their faults): the model-in-loop column per row
  (C19's rows; capsule case 9, red first: F1 said RECORDED); section 3 and OD-125 state what the command cannot produce.
- **coverage-2** (D21-42 not exercised by F): the fake client's coordinator first-turn 429 (C75) and case 16 (red first: the harness could
  not script it); the F10 row and its RECORDED note state the limit; M15 (the first turn metered) turns case 16 red.
- **coverage-3, tests-05** (F7's merge records no gap; the envelope's evidence unasserted): case 7 walks every `evidence` list in the record
  and the envelope (M12, an invented reference, turns it red); the RECORDED note on F7 and D21-44 (new, the lead's).
- **coverage-8** (cases 1, 6 and 7 red only under the harness swap): M9 to M13 break their own mechanisms (section 1).
- **coverage-9** (250 ms real timers under every replay; a stall allowed on the run's own steps): only a stall capsule runs under the short
  deadline, now 2 000 ms (C69); a stall is refused outside a task's step list (C57) - capsule cases 3 and 5 (red first).
- **coverage-12, tests-09** (the task index was only a list position; duplicate or unplanned tasks silently unused): the index is the
  plan's (C66), one list per role (C65), the runner refuses an unplanned task before it runs (C67) - capsule cases 2 and 10 (red first).
- **tests-03** (the single capsules never met the router): every replay records the router's answer (C68) and every case checks it (C70) -
  case 15 (red first: no route); M3 now also turns case 15 red.

### [B21 F2, 2026-09-28] B21-F2's adversarial review, fixed

B21-F2's review confirmed six findings (one of them three times); each was fixed test-first - the reproducing test red on the unfixed
tree, or, for a test-strength finding, the strengthened test red under a deliberate mutation of the source, restored by hash - then
re-run:

- **security-1, coverage-1, tests-01** (F6's browser cell said PROVEN while the browser ran every role on one provider - the escalation
  counted one source - and cancelled the review): the config routes the circuit specialist to anthropic (C100), test 2 asserts every
  role's provider (C102) and `2 source(s)` (C101) - red first against the blank override (section 4, failing-first 6) - and F6's cell is
  its own PROVEN IN PART class naming what stays offline (the principal's approval, the escalation's exact-authority citation in the
  envelope); page case 12 (red first: the override parsed to no route).
- **coverage-2** (F12's browser remainder left untracked once D21-43 closes): D21-45 opened (section 7), named by D21-43's closure, the §10
  line, PROGRAM_STATE's `nextAction`, section 4 and F12's cell; page case 14 (red first: no D21-45).
- **tests-02** (the resumed stalled specialist pinned only by status and attempt): test 3 asserts its resumed `specialist_started` at
  attempt 1 (C103) and the `deadline` reason (C104); a scheduler mutation closing the unfinished task unrun kept F2's test 3 green and
  turns the strengthened test red (section 4, failing-first 7).
- **tests-05** (the config re-templated the base command, so the "never copied" claim was false for it and a base change would not reach
  the orchestration server): the command is derived from the base's with only the port moved (C97-C99); page case 13 loads both configs
  with `@playwright/test` stubbed and a probe appended to the base command (red first: the orchestration command lacked it).

Gates after the fixes (one heavy job at a time through the lock runner; `b21/f2fix/gates/`): every B21 suite with the route suites, the E4
composer suite and the CI job-scope guard (`gates/gate-1-b21.log`: 55 files, 513 of 513); `app/api/chat` and `app/lib/acquisition` in
full (37 files: 359 passed, the opt-in live file's 2 skipped as before); `app/lib/agent` with the B17-A inventory and the B18-D UI gates
(63 files, 646 of 646); `app/lib/project` with `app/components/chat` (40 files, 318 of 318); the fixture agent and the B18-C/B18-E suites
(16 files, 108 of 108); the import gates, census ratchets and route matrices (10 files, 104 of 104; census 165/162/3/0); `app/lib/mcp`
with `app/api/mcp` (33 files, 737 of 737 - the B20 pages' citations) and `app/lib/mcp/server` (19 files, 183 of 183 - the b20-b2
nine-file pin); tsc 0; eslint clean on the four changed and new TypeScript files; the B09, B11, B21 and B17-A generators with zero drift
(24 files byte-identical on the re-run, 628 controls identical, the tree's status unchanged); the browser pair above (48 of 48, then 3 of 3).

### [B21 F2b, 2026-09-29] B21-F2b's runs and gates

- **Browser.** Test 4 alone through the lead's lock script while iterating (section 4's failing-first: four red runs, one green); at
  the end the existing suite and the orchestration config one after the other: 48 of 48 in 263 s, then 4 of 4 in 149 s - 412 s
  of OD-30's 30 minutes (30 tracked evidence PNGs restored from HEAD by blob hash; `b21/f2b/budget-*.log`).
- **Gates**, one heavy job at a time through the lock runner (`b21/f2b/gates/`): every B21 suite with the eight route suites, the E4 composer suite and
  the CI guard (58 files, 534 of 534 - every A..F page suite included, the F page's 16 cases and the F2b suite's 2); `app/api/chat` and `app/lib/acquisition` in full (37 files: 359 passed, the opt-in live file's 2 skipped as before); `app/lib/agent` with the exposure and tier suites, the B11
  suites, the B17-A inventory and the B18-D UI gates (63 files, 646 of 646); `app/lib/project` with `app/components/chat` (40 files, 318 of 318); the fixture agent and every
  B18-C/B18-E scenario suite (16 files, 108 of 108); the import gates, census ratchets and route matrices (10 files, 104 of 104; census 165/162/3/0, no route added);
  `app/lib/mcp` with `app/api/mcp` (33 files, 737 of 737 - the B20 pages' citations) and `app/lib/mcp/server` (19 files, 183 of 183 - the b20-b2 nine-file pin); tsc 0;
  eslint clean on the five changed and new TypeScript files; the generators with zero drift beyond F12's browser cell (B11 19 of 19 cases and 61 of 61 checks; the B09, B11 and B21 outputs, 24 files, byte-identical on the gate's re-run - against HEAD only F12's browser cell of `evaluation-matrix.csv` and `.json` moved, `replay-trace-pins-b21.json` byte-identical; B17-A 628 controls, CSV and summary identical; the tree's status and every changed file unchanged during the gates).

### [B21 F2b review, 2026-09-29] B21-F2b's adversarial review, fixed

B21-F2b's review confirmed six findings on three defects; each was fixed test-first - the reproducing test red on the unfixed tree, or,
for a test-strength finding, the strengthened test red under a deliberate mutation of the source (restored by hash) that the unfixed
test let through - then re-run:

- **regressions-1, tests-1** (page case 16 compared the live PROGRAM_STATE's `nextAction` with F2b's reserved text for good once its
  B21-F2b clause was gone, so the closeout's own state update would turn it red): the rule is one module-scope function that, as
  `b21-d-page.test.ts` case 9 rules it, compares word for word only while the applied `nextAction` still leads with its B21-F2b clause
  and afterwards accepts F2b's or any LATER state, failing only a reserved text that brings a B21-F2b clause back; page case 17 drives it
  over the states the program passes through (red first: the later state failed the old rule, "the applied nextAction is not the
  reserved one").
- **regressions-2, tests-2, tests-3** (test 4's discard-line and status-line checks took `.last()` visible on the ONE shared page, so
  test 2's lines satisfied them; its status expectations came from the page's own reducer over the stream; nothing checked that the
  Cancel applied nothing): test 4 counts every line an earlier test also renders before and after, among the chat's own lines (the
  transient toast excluded, C124), expects ONE new discard line (C115) and no applied line after the Cancel and at the end (C125,
  C129), and states both status lines as literal counters through the page's builder (C126-C128); page case 19 pins it (red first: four
  `.last()` in test 4). In the browser (section 4's failing-first (5) to (9)): F2b's test 4 PASSED under four mutations of the page's
  source at once; the strengthened test 4 fails under each alone.
- **tests-4** (the offline suite's case 2 said the human rejects and the Cancel applies nothing, but drives no rejection): its title,
  comment and header say what it asserts - the page's consumer receives the sealed proposal and nothing is applied - and that the
  human's rejection (the review's own Cancel) is page-side, proven in the browser by spec test 4; page case 18 pins the wording and the
  two server-side assertions (red first: the title and the comment claimed the rejection). **RECORDED:** the same wording in
  `b21-f-evaluation.test.ts` case 12 (F's, committed; the matrix's F12 row quotes it) is left as it stands - F12's rejection is the
  browser's since B21-F2b (section 1's browser cell).

Gates after the fixes, one heavy job at a time through the lock runner (`b21/f2bfix/gates/`): every B21 suite with the eight route suites, the E4
composer suite and the CI guard (58 files, 537 of 537 - every A..F page suite included, the F page's 19 cases and the F2b suite's 2);
`app/api/chat` and `app/lib/acquisition` in full (37 files: 359 passed, the opt-in live file's 2 skipped as before); `app/lib/agent`
with the exposure and tier suites, the B11 suites, the B17-A inventory and the B18-D UI gates (63 files, 646 of 646); `app/lib/project`
with `app/components/chat` (40 files, 318 of 318); the fixture agent and every B18-C/B18-E scenario suite (16 files, 108 of 108); the
import gates, census ratchets and route matrices (10 files, 104 of 104; census 165/162/3/0, no route added); `app/lib/mcp` with
`app/api/mcp` (33 files, 737 of 737 - the B20 pages' citations) and `app/lib/mcp/server` (19 files, 183 of 183 - the b20-b2 nine-file
pin); tsc 0; eslint clean on the five changed and new TypeScript files; the generators with zero drift (B11 19 of 19 cases and 61 of 61
checks; the B09, B11 and B21 outputs, 24 files, byte-identical on the re-run - `evaluation-matrix.csv` and `.json` byte-identical to
B21-F2b's, against HEAD only F12's browser cell, and `replay-trace-pins-b21.json` byte-identical to HEAD's; B17-A 628 controls, CSV and
summary identical); the tree's status and every changed file unchanged during the gates; the browser pair (section 4: 48 of 48 in
253 s, then 4 of 4 in 149 s). No production file changed: `app/page.tsx` and `app/lib/project/chat-run-view.ts` equal HEAD's blobs after
every mutation run.

## 7. For the lead — the reserved texts, in full

Each `### OD-…` below is the entry for `OWNER_DECISIONS.md` (as `## OD-…`), in its format. Then the README row, the ledger paragraph, the
PROGRAM_STATE texts, the discovery closure clauses (D21-43 and D21-44 are new defects) and the §10 amendment line.

### OD-125 — The model-in-loop track, as applied (B21-F, 2026-09-28)

- **Question:** how B21-F evaluates the orchestration with live models while OpenAI answers `429 no credits` and Anthropic's credit state
  is unrecorded (D21-25).
- **Default applied:** record-only until credits exist. The offline suites are structured so the four task-graph cases (`f05`, `f09`,
  `f10`, `f11`) run live by swapping the adapters (and, for `f09`, the run budget: 2 s offline, 120 s live): `runOrchestrationCase(entry, { live })` over the `orchestration`
  capsules, run by ONE command, `scripts/run-b21-live-orchestration-evaluation.ts`, behind `SIRKIT_LIVE_ORCHESTRATION_EVALUATION=1` (exactly
  "1"; anything else exits 2 before any adapter is built), with a spend bound of 40 provider REQUESTS - every live adapter, the
  coordinator's too, built with SDK retries 0, so a counted call is one request (163840 output tokens at most) - recording the closed
  vocabulary only (never a model's text, a prompt, a credential or an env value) and asserting nothing about a model's answer. What it can
  evaluate is narrow and stated per row (the matrix's model-in-loop column): it runs every turn on ONE provider from a live model, so it
  never reproduces a capsule's scripted fault (the stall, the 429 and the hostile results run as their DAG shapes only) and it can produce
  no provider disagreement and no provider fallback - LB-9's disagreement and fallback stay BLOCKED-LIVE-QUALIFICATION whatever a live run
  records; eight of the twelve runbook cases have no live path. It is NOT a test: no permanently skipped block is committed (OD-102); no
  suite, script or CI job runs it. The implementer never ran it. LB-9 stays BLOCKED-LIVE-QUALIFICATION. [B24-B3, 2026-10-08] Still true of `liveEvaluationCases`, which routes every turn to one provider; `SIRKIT_LIVE_ORCHESTRATION_PROVIDER=both` runs only the separate two-provider capsule (the full-circuit-creation DAG with the schematic role on Anthropic), which shows two providers answering one DAG and cannot force a disagreement or a fallback, so LB-9 stays blocked; the command now refuses without an owner price table and a money cap and can add one forced-tool contract turn per provider (OD-216; B24 `scenario-map.md` section 4).
- **Evidence:** `evaluation-matrix.md` section 3; `b21-f-replay-capsule.test.ts` cases 7 (the refusal, no adapter built), 8 (the request
  bound) and 9 (the column).
- **The owner may choose otherwise:** supply credits with a spend limit and have the lead run the command once (LB-2 / LB-9) - it records
  the four DAG shapes, not disagreement or fallback; build a two-provider live capsule for disagreement and fallback (a component-authority
  catalog in the replay context, per-role routing kept live - a harness change); a flag-gated live block in a suite (a permanently skipped
  test on every CI run, which OD-102 declined); or a live run under Anthropic's Message Batches at half price (OD-119 declined batches for
  interactive work; an offline evaluation could use them).

### The README row (`artifacts/ai-control-plane-b21/README.md`, replacing the planned row "B21-F")

| B21-F the required evaluations: the twelve runbook cases offline through the real runtime; capsule v4 and the orchestration category; model-in-loop record-only | `evaluation-matrix.md`, `evaluation-matrix.{csv,json}`, `replay-trace-pins-b21.json`; code `app/lib/agent/fixture-agent-adapter.ts` (the per-role scripted specialists and the follow-up turn, appended; the class's two hooks in place), `app/lib/agent/replay-capsule.ts` (capsule v4: per-task step lists at their plan's indexes, stalls only in a task's list, the task-graph runner's contract), `scripts/generate-b21-artifacts.ts`, `scripts/run-b21-live-orchestration-evaluation.ts` (record-only, never run) | CONFIRMED (the twelve runbook evaluations through the production POST with the flag on - the real adapters over in-process fake SDK clients answering from the scripted fixture agent's per-role specialists, every case asserting the closed outcome vocabulary, the record, the trace, the events and what each turn was OFFERED; D21-42's first-turn leg of F10; each of the twelve red under a mutation of the mechanism it names - seventeen mutations, one at a time, sources restored by hash; the scripted agent answers every specialist through the result tool (D21-40 closed); capsule v4 validated exactly and replayed through the real runtime with the router's answer checked, the `orchestration` category's seven capsules pinned, the B11 pins extended and unmoved; the matrix byte-gated; zero generator drift; the model-in-loop track record-only (OD-125), bounded in requests, never run, and unable to produce disagreement or fallback (LB-9 stays blocked on both); the merge records no evidence gap (D21-44, the lead's); the browser spec STOPPED - the orchestration flag is process-wide in the one fixture dev server and turning it on changes B18-E's browser proofs (D21-43, the lead's decision); the full browser suite green with F's fixture changes; live behaviour BLOCKED-LIVE-QUALIFICATION, LB-9) |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-F — the required evaluations (2026-09-28 local; increment workflow + lead; this commit)

- The twelve runbook evaluations (:863-:874) offline in `b21-f-evaluation.test.ts` (16 cases) through the production POST with the flag
  on: the real adapter classes over in-process fake SDK clients (`_f-fixture-clients.ts`, recording what each call OFFERED) answering from
  the scripted fixture agent, whose script table gained per-role specialists answering through the strict result tool and a follow-up turn
  (D21-40 closed); D21-42's first-turn leg of F10 (case 16); the case table rendered into `evaluation-matrix.{csv,json}` and byte-gated.
- Failing-first: F adds no production code, so each case was broken by one mutation of the mechanism it names and restored byte for byte -
  seventeen (HEAD's fixture agent, HEAD's v3 capsule, the router's default, the first-turn gate, the structural tool gate, the deadline
  rule, the ledger's claim, the replay's scope check, OD-122's held artifact, the role routing, the merge's conflict edges, the envelope's
  evidence, the tool-less dissent, the follow-up's narrowed deps, the first turn's metering, the live flag check, the live bound) - each
  failed exactly the cases it should (`evaluation-matrix.md` section 1).
- Capsule v4 (`sirkit.agent-replay-capsule.v4`: per-task step lists at their plan's indexes, one per role, scripted stalls only there, a
  task-graph runner injected, never replayed as one loop) in neutral words inside the nine B11 files, line count unchanged by the fixes;
  the `orchestration` category, its seven capsules and the runner (the REAL `runOrchestratedChat`, refusing an unplanned task, recording the
  router's answer) outside them (`_f-capsules.ts`); `scripts/generate-b21-artifacts.ts` writes the matrix and `replay-trace-pins-b21.json`
  (byte-identical across two processes); the B11 pins extended, never moved (19 of 19, 61 of 61).
- Pin moves with their reasons: B11.3 §D (one line: v4, v3 refused) and B11.4 §G (the capsule id v4), E2b's case 8 and the E2 page's
  section 3.7 (the replay capsule's hash); dated notes on every stale title, comment and B11 page that said v3; the replay capsule's shifted
  citations re-pinned on `orchestration-contracts.md` (C20), the B20 connector page and the B18 chat page.
- Model-in-loop record-only (OD-125): one command behind `SIRKIT_LIVE_ORCHESTRATION_EVALUATION=1` with a bound of 40 requests (SDK retries
  0 on every live adapter), not a test, never run, able to run four DAG shapes only (no scripted fault, no disagreement, no fallback);
  OpenAI 429 no-credits (2026-09-24), Anthropic UNKNOWN; LB-9 BLOCKED-LIVE-QUALIFICATION.
- The adversarial review's eighteen confirmed findings fixed test-first (`evaluation-matrix.md` section 6); D21-44 opened (the merge records
  no evidence gap).
- The browser spec STOPPED (D21-43 opened): the orchestration flag is process-wide in the one fixture dev server, turning it on for the
  suite changes B18-E's scenario-8 and scenario-4 browser proofs, and Next 16's dev lock forbids a second server without a `distDir`
  change; the full browser suite ran once green with F's fixture changes (48 of 48 in 462 s of OD-30's 30 minutes), the 25
  evidence PNGs restored by blob hash.
- Gates, one job at a time: every B21 suite with `app/api/chat` in full (69 files, 586 of 586), `app/lib/agent` with the B17-A inventory
  and the B18-D UI gates (42 files, 467 of 467), `app/lib/mcp` and `app/api/mcp` (33 files, 737 of 737), `app/lib/mcp/server` (19 files,
  183 of 183), the import gates and census (5 files, 59 of 59), `app/lib/project` with `app/components/chat` (40 files, 318 of 318);
  tsc 0; eslint clean; the B11, B09, B17-A and B21 generators with zero drift. Census 165/162/3/0.
- Records: `evaluation-matrix.md`; OD-125 applied; D21-23, D21-24 and D21-40 closed; D21-25 recorded; D21-30 stays open (the browser
  half) under D21-43; D21-44 opened. Live: BLOCKED-LIVE-QUALIFICATION (LB-9) - no model is called.

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-F committed on chapter/b21-specialist-orchestration: the twelve runbook evaluations offline through the real
runtime (the production POST, the real adapters over fake SDK clients, the scripted fixture agent's per-role specialists answering
through the result tool - D21-40 closed), each red under a mutation of its mechanism (seventeen, sources restored by hash); capsule v4 and
the orchestration category replayed through the real runtime and pinned, the B11 pins extended and unmoved; the evaluation matrix
byte-gated; the model-in-loop track record-only (OD-125), bounded in requests, never run and unable to produce disagreement or fallback;
the browser spec STOPPED (D21-43: the orchestration flag is process-wide in the one fixture dev server and turning it on changes B18-E's
browser proofs); D21-44 opened (the merge records no evidence gap); next the B21 closeout".
`nextAction`: "The lead decides D21-43 (move B18-E's scenario-8 and scenario-4 browser proofs under a suite-wide flag, a fixture-only
per-request flag seam, or a second dev server with its own distDir) and D21-44 (a merge-side evidence-gap rule, or the runbook line
recorded as met by the specialist's question and the tool-less dissent), and the one live run under OD-125 if credits exist (it records
four DAG shapes; disagreement and fallback stay blocked); then the B21 closeout (commit 1/2 the single-agent statements superseded - with
the stale titles `evaluation-matrix.md` section 7 lists - commit 2/2 the records and the verdict; PR #11 undrafted after green CI);
OD-126's older-page question, OD-112's option A, OD-122's across-runs, at-least-once and stale-artifact options, OD-111's retention
question and OD-115's first-turn options stay with the owner".
The report line for the closeout: `MULTI-AGENT STATUS: ...; the twelve B21-F evaluations delivered offline through the real runtime -
fake-backed (fake SDK clients and the scripted fixture agent), named as such - with capsule v4 and the orchestration category pinned; the
browser half stopped (D21-43); live disagreement / fallback / quota / timeout BLOCKED-LIVE-QUALIFICATION under LB-9 (the model-in-loop
command record-only, never run, and unable to produce disagreement or fallback)`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect; D21-43 and D21-44 are new defects after D21-42; §10 gains a B21-F amendment)

- **D21-23 — The scripted and fake adapters cannot express the B21-F scenarios.** — CLOSED by B21-F: the scripted fixture agent's script
  table gains per-role specialists keyed on whole sentences (a read, a proposal, a resolve-then-propose, a stall, hostile results, then
  ONE result call) and a follow-up turn answering from the merged envelope, behind the same fixture gate and with no new adapter class;
  in-process fake SDK clients drive the REAL adapter classes from it and record what each call was offered (a 429 `insufficient_quota` for
  the specialists or for the coordinator's first turn, and an overloaded follow-up, are the client's faults); the twelve runbook
  scenarios - a second provider, a disagreement, a timeout, a quota failure, a hostile result, a rejected-then-resumed run - run through the
  production POST (`evaluation-matrix.md` sections 1 and 2; `b21-f-evaluation.test.ts` cases 1 to 13 and 16).
- **D21-24 — The replay capsule scripts one provider and one ordered step list, and the evaluation harness has no orchestration
  category.** — CLOSED by B21-F: `sirkit.agent-replay-capsule.v4` carries per-task step lists (each with its role label and provider, at its
  plan's index, one per role - the runner refusing any other task before it runs) and scripted stalls beside scripted failures (a stall only
  in a task's list), validated exactly before anything runs; a capsule with tasks replays only through an injected task-graph runner - the
  real orchestration runtime - never as one loop; every replay records and checks the router's own answer for its capsule; the
  `orchestration` category (seven capsules: the three single-turn cases routed `single` and replayed by the B11 engine; the compact DAG, the
  per-specialist timeout, the quota failure and the malicious results replayed through the runtime) lives outside the nine B11-scanned
  files, whose tripwire forbids the word; its digests are pinned in `replay-trace-pins-b21.json`, extending the B11 pins unmoved
  (`b21-f-replay-capsule.test.ts` cases 1 to 6 and 10, `b21-f-evaluation.test.ts` case 15). RECORDED: provider disagreement, missing
  evidence, parallel staleness and a rejected-then-resumed DAG need the component-authority catalog or a second request, which a replay
  context does not carry - they are proven through the POST (cases 6, 7, 8 and 12), not as capsules; a stall capsule replays under a real
  2 s deadline its other loops finish well inside.
- **D21-25 — No model-in-loop opt-in exists; every live evaluation is blocked; `LIVE_BLOCKERS.md` has no row for specialist disagreement
  or provider fallback.** — RECORDED by B21-F (OD-125): the opt-in exists as ONE record-only command behind
  `SIRKIT_LIVE_ORCHESTRATION_EVALUATION=1` with a spend bound of 40 provider requests (SDK retries 0 on every live adapter), swapping the
  adapters (and `f09`'s run budget) over the same capsule runtime; it is not a test (OD-102) and was never run; it runs the four task-graph capsules with every
  turn on ONE provider, so it cannot reproduce their scripted faults and cannot produce specialist disagreement or provider fallback -
  those stay BLOCKED-LIVE-QUALIFICATION explicitly; OpenAI answered 429 no-credits on 2026-09-24 and Anthropic's state is unrecorded; LB-9
  stays BLOCKED-LIVE-QUALIFICATION (`evaluation-matrix.md` section 3; `b21-f-replay-capsule.test.ts` cases 7 to 9). [B24-B3, 2026-10-08] Still true of `liveEvaluationCases`, which routes every turn to one provider; `SIRKIT_LIVE_ORCHESTRATION_PROVIDER=both` runs only the separate two-provider capsule (the full-circuit-creation DAG with the schematic role on Anthropic), which shows two providers answering one DAG and cannot force a disagreement or a fallback, so LB-9 stays blocked; the command now refuses without an owner price table and a money cap and can add one forced-tool contract turn per provider (OD-216; B24 `scenario-map.md` section 4).
- **D21-30 — No browser observable proves that a direct Tier 0/1 command never recruits specialists.** — addendum by B21-F: NOT closed.
  The one-coordinator-turn shape of a 3D request is proven through the production POST with the flag on (one provider call, zero
  specialists, no orchestration event, nothing recorded - `b21-f-evaluation.test.ts` case 4) and by the `f04-view3d-single` capsule, whose
  replay checks the router's `single` for the sentence before its one loop (case 15), but no browser spec observes it: the fixture dev
  server cannot run with the orchestration flag on for one spec (D21-43).
- **D21-40 — The scripted fixture agent answers no specialist through the result tool.** — CLOSED by B21-F: under the fixture runtime's
  opt-in `agentAdapterForRole` hands every specialist the scripted agent, which answers THROUGH `sirkit_specialist_result` - a run that
  offers the result tool is a specialist run, its role read from the frame's `Role:` line, its sentence from the objective - and the
  coordinator's follow-up turn answers from the merged envelope (`b21-f-evaluation.test.ts` case 13 through the gate; every DAG case
  through the fake SDK clients; with HEAD's agent those cases end `result_tool_not_called`). RECORDED: no browser run reaches it until
  D21-43 is decided.
- **D21-43 — The fixture browser server cannot observe an orchestrated run: the orchestration flag is process-wide, and turning it on for
  the suite changes B18-E's browser proofs.** Requirement: B21-F "browser tests" (`:861`), "3D control request routed directly without a
  swarm" (`:866`); D21-30. Finding: `orchestrationEnabled` reads the server environment; Playwright starts ONE `next dev` for every spec
  (`playwright.config.ts`, no orchestration flag); with the flag on, "Release the board." (B18-E scenario 8, `agent-execution.spec.ts`) is
  refused by the router before any model call, so the forged-call proof and the page's contradiction of the interim claim disappear (and
  the B18-D S5 count with them), and scenario 4's sentence becomes a replacement DAG; Next 16.2.6's `lockDistDir` (default on) forbids a
  second dev server in the same dist dir. Severity low (every scenario is proven through the production POST offline). **CONFIRMED**
  (`evaluation-matrix.md` section 4; `b21-f-page.test.ts` case 5). Closes: the lead's decision - (a) turn the flag on for the whole browser
  suite and move B18-E's scenario-8 and scenario-4 browser proofs to the router's refusal and the DAG (a reviewed move of another chapter's
  evidence; the loop-level `unknown_tool` proof stays in vitest), then write the spec; (b) a fixture-only, local_dev-only per-request
  orchestration switch (a production-side seam, owner-approved); (c) a second Playwright web server with the flag on and its own `distDir`
  (a `next.config.ts` change, a second cold compile inside OD-30's budget and the memory bound). Source: B21-F.
- **D21-44 — The merge records no evidence gap: a specialist result that cites no evidence is accepted as its own claim.** Requirement:
  B21-F "missing component evidence" (`:869`; the task's "the merge records the gap, nothing is invented"). Finding: the merge has no
  evidence-presence rule - its own codes (`MERGE_OWN_CODES`) cover integrity, currency, part and readiness - so a sourcing specialist's
  result with `evidence: []` is `accepted`; the gap is recorded only by the specialist's own blocking question or, when the role has no
  tools this run, by the scheduler's `role_has_no_tools` dissent; the merge invents nothing (no evidence reference anywhere in the record or
  the follow-up's envelope, pinned). Severity low (nothing is invented and the envelope marks every claim unverified). **CONFIRMED**
  (`b21-f-evaluation.test.ts` case 7; `evaluation-matrix.md` section 1, RECORDED on F7). Closes: the lead's decision - (a) a merge-side gap
  rule (an accepted result of an evidence-gathering role that cites no evidence gains a finding and the envelope names the gap: a production
  change with a new code, its page and its pins) or (b) the runbook line recorded as met by the question and the tool-less dissent. Source:
  B21-F's adversarial review (coverage-3, tests-05).
- **§10, B21-F (recorded by the lead, 2026-09-28):** Section 4: D21-23, D21-24 and D21-40 closed; D21-25 recorded (OD-125); D21-30's
  browser half stays open; D21-43 opened (low); D21-44 opened (low). Section 6: OD-125 applied as `evaluation-matrix.md` section 3 states it
  (record-only; one command behind its flag with a bound of 40 requests, SDK retries 0; not a test; never run; four DAG shapes, no
  disagreement or fallback). Section 7, B21-F: as built - the twelve runbook evaluations through the production POST with the real adapters
  over fake SDK clients and the scripted fixture agent's per-role specialists; capsule v4 in neutral words inside the B11 file and the
  `orchestration` category outside the nine scanned files, replayed through the real runtime with the router's answer checked, and pinned
  (the B11 pins extended, unmoved); the matrix byte-gated; the browser spec stopped (D21-43). Section 8: F added no production code, so its
  failing-first evidence is one mutation per mechanism, seventeen, each restored by hash; the adversarial review's eighteen findings fixed
  test-first; the lead decides D21-43 and D21-44.

For the lead's own file, the B20 discovery (`artifacts/ai-control-plane-b20/discovery.md:124`, a reader citation) names
`replay-capsule.ts:477` for the registry-drift check, now line 571; and `discovery.md` (B21) cites `replay-capsule.ts:59-107`,
`:123-131`, `:156`, `:400-424` and `:530-552` as of `6fd5a7b` - since F they are `:68-133`, `:149-157`, `:182`, `:459-484` and `:626-652`
(RECORDED; dated citations, left as written; the review's fixes changed the file in place, its line count unchanged). Its citations into
b11-3 (`b11-3:741`, `b11-3:743`, `b11-3-generated-pcb-shape.test.ts:743-745`) did NOT move: F's §D change is one line in place (page case 9).

The stale test titles the closeout retitles with OD-113's set (each carries its dated note on its own line; the `it(` counts unchanged):
`b11-4-capture-ownership.test.ts` §G8 "the wire contract did NOT change: the committed versions are unchanged"; `b11-3-generated-pcb-shape.test.ts`
§D "the context is v2 and the capsule v3; older versions refuse EXPLICITLY"; `b21-e2b-trace-attribution.test.ts` case 8 "the nine B11-scanned
files are byte-identical to HEAD ..."; `b21-e2b-page.test.ts` case 4 "... (byte-identical to HEAD 41330e6) ..." (`b21-f-page.test.ts` case 1, F's own new suite, was
retitled "ten pages" by the lead before the commit).
[B21 F2b, 2026-09-29] And `b21-f-page.test.ts` case 10 "... the spec's three tests send the case table's sentences under their own namespace ...": four
tests since B21-F2b (its count's pin moved with its reason beside it; the title kept, never retitled, for the closeout's set). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): the five titles above retitled, assertions unchanged and every `it(` count unchanged; page case 9's title pins moved with them]

### B21-F2 — the reserved texts, in full (the lead's to apply)

B21-F2 adds no owner decision (the lead decided D21-43; OD-30's rule is applied, not changed); it opens ONE new defect, D21-45 (low),
for the lead (its adversarial review's coverage-2). Its texts for the lead's files:

#### The README rows (`artifacts/ai-control-plane-b21/README.md`)

In the B21-F row, the clause "the browser spec STOPPED - the orchestration flag is process-wide in the one fixture dev server and turning
it on changes B18-E's browser proofs (D21-43, the lead's decision)" gains, after it: "; [B21 F2] delivered by B21-F2 (the row below)".
A new row after B21-F:

| B21-F2 the browser spec on its own flag-on Playwright config, run after the existing suite | `evaluation-matrix.md` section 4 (and the matrix's F4, F6 and F12 browser cells), `evaluation-matrix.{csv,json}`, `evidence/f4-view3d-one-coordinator-turn.png`, `evidence/f6-verifier-decides-presented-once.png`, `evidence/f6-disagreement-escalated-nothing-presented.png`, `evidence/f12-resume-offer-after-stop.png`, `evidence/f12-resumed-run-finished.png`; code (no production file) `playwright.orchestration.config.ts` (the base config's web server imported - its environment spread, its command derived with only the port moved - plus `SIRKIT_ORCHESTRATION_ENABLED=1` and the circuit specialist routed to anthropic, its own port, test dir and folders, never reusing a server), `e2e-orchestration/specialist-orchestration.spec.ts` (three tests), one `page-browser-e2e` step and the upload's two folders, `.gitignore` | CONFIRMED (the flag-on browser proof, run AFTER the existing suite, one `next dev` at a time - no second dist dir, no `next.config.ts`, `playwright.config.ts`, `e2e/` or B18-E evidence change; F4 PROVEN: a 3D control request is one coordinator turn - one `run_started`, one terminal, no orchestration event, no specialist line - with the router live in that server (D21-30's browser half closed); F6 in part: the scenario-17 sentence from the composer, each role on its routed provider (the circuit specialist on anthropic, the others on the page's openai), the E2 status line, the one sealed replacement presented once where a verifier decides (the review cancelled), and where both scripted parties seal the escalation line counting two sources with nothing presented - the principal's approval and the escalation's exact-authority citation stay offline (case 6); F12 in part: E3's offer after the human's Stop during F9's scripted stall, the same message resumed under the same run id with the first answer replayed, the stalled specialist started again until its own deadline, one follow-up, nothing presented - the rejected presentation and `already_presented` stay offline (case 12: the scripted follow-up never fails in the browser), tracked as D21-45; each test red first (a flag-off server, a DAG sentence, an unscripted disagreement, a different second message) and the adversarial review's six findings fixed test-first (a blank role override and a scheduler mutation red in the browser, three page cases red); both runs 769 s (48 of 48) and 182 s (3 of 3) one after the other, 951 s of OD-30's 30 minutes; D21-43 closed, D21-45 opened) |

#### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-F2 — the browser spec on its own flag-on Playwright config (2026-09-28 local; increment workflow + lead; this commit)

- D21-43 as the lead decided it: `playwright.orchestration.config.ts` runs the base config's fixture web server - imported, its whole
  environment spread and its command derived from the base's with only the port moved (a base command without its port flag refuses to
  load) - plus `SIRKIT_ORCHESTRATION_ENABLED=1` and `SIRKIT_ORCHESTRATION_ROLE_MODELS` routing the circuit specialist to anthropic (F6's
  two parties on two providers, as case 6 routes them; set explicitly against a developer's `.env.local`) on its own port (3101),
  `reuseExistingServer: false`, its own `testDir` (`./e2e-orchestration`) and report/output folders (git-ignored), workers 1, retries 0,
  the base's per-test timeout; the two configs run one after the other (locally through the lead's lock script; in CI one extra
  `page-browser-e2e` step after `pnpm exec playwright test`, the upload carrying both report folders). No production file,
  `playwright.config.ts`, `e2e/`, `next.config.ts` or B18-E evidence changed.
- `e2e-orchestration/specialist-orchestration.spec.ts` (namespace `b21f2000`, the fixture journey's bootstrap, the case table's sentences,
  evidence under `artifacts/ai-control-plane-b21/evidence/`, what the page received read from the intercepted body and a pull-through
  stream observer that keeps Stop's cancellation): F4 PROVEN (one coordinator turn for a 3D request, the router live - D21-30's browser
  half); F6 in part (each role's provider, the E2 status line; presented once where a verifier decides; the escalation line counting two
  sources and nothing presented where both parties seal - the principal's approval and the escalation's exact-authority citation stay
  offline, case 6); F12 in part (E3's offer after a Stop during F9's scripted stall, the resume under the same run id, the first answer
  replayed, the stalled specialist started again until its own deadline, one follow-up, nothing presented; the rejected presentation and
  `already_presented` stay offline - the scripted follow-up never fails - and are D21-45).
- Failing-first: five red runs, the spec restored by sha256 after each mutation - a flag-off server (tests 1 and 3), a DAG sentence for
  the 3D request, an unscripted disagreement sentence, a different second message.
- The adversarial review's six confirmed findings, fixed test-first (`b21/f2fix/`): F6's browser cell said PROVEN while the browser ran
  one provider and cancelled the review (security-1, coverage-1, tests-01) - the config routes the circuit specialist to anthropic, test 2
  asserts every role's provider and `2 source(s)` (red first against the blank override), F6 is PROVEN IN PART with its own class naming
  what stays offline (page case 12, red first); F12's browser remainder untracked once D21-43 closed (coverage-2) - D21-45 opened (page case
  14, red first); test 3 pinned the resumed specialist only by status and attempt (tests-02) - it asserts the resumed `specialist_started`
  and the `deadline` reason (a scheduler mutation closing the unfinished task unrun kept F2's test 3 green and turns the strengthened one
  red; `scheduler.ts` restored, sha256 and blob hash equal to HEAD's); the config re-templated the base command (tests-05) - it derives it
  (page case 13 loads both configs: a change to the base command reaches the orchestration server; red first).
- Budget (OD-30): the existing suite 48 of 48 in 769 s of wall time and the orchestration config 3 of 3 in 182 s, one after the
  other: 951 s, about 15.9 of OD-30's 30 minutes (about 14.1 minutes of headroom, above the five-minute split rule); the
  25 evidence PNGs the existing suite rewrote restored from HEAD by blob hash (F2's first measurement: 807 s and 180 s).
- Pins moved (reviewed, reasons beside them): `b21-f-page.test.ts` case 2's browser-cell mapping (BLOCKED -> the delivered classes) and
  case 10's role-override line (`""` -> the circuit specialist on anthropic) and F6 mapping (PROVEN -> PROVEN IN PART); the matrix's F4,
  F6 and F12 browser cells (`_f-cases.ts`, in place, its line count unchanged so C19-C21 hold; the generator re-run, only those three cells
  moved and `replay-trace-pins-b21.json` byte-identical); the page's C49 anchor (`- run: pnpm exec playwright test`: F2's step line
  contains the old anchor) and C83-C86 and C92 re-pinned; cases 10 to 14 added.
- Findings (RECORDED): the lead's `pw.sh` stops any process whose command line matches `playwright`, including a shell handed `-c
  playwright.orchestration.config.ts` (the first run killed its own caller before printing the wall time); the runs source `pw.sh`
  unchanged from a wrapper that assembles the config name at run time. DevTools does not keep a long streamed response body, so the spec
  reads the stream in the page.
- Gates, one heavy job at a time through the lock runner (`b21/f2fix/gates/`): every B21 suite with the eight route suites, the E4 composer suite and the CI guard (55 files, 513 of 513 - every A..F page suite
  included, the F page's 14 cases); `app/api/chat` and `app/lib/acquisition` in full (37 files: 359 passed, the opt-in live file's 2
  skipped as before); `app/lib/agent` with the exposure and tier suites, the B11 suites, the B17-A inventory and the B18-D UI gates (63
  files, 646 of 646); `app/lib/project` with `app/components/chat` (40 files, 318 of 318); the fixture agent and every B18-C/B18-E
  scenario suite (16 files, 108 of 108); the import gates, census ratchets and route matrices (10 files, 104 of 104; census 165/162/3/0,
  no route added); `app/lib/mcp` with `app/api/mcp` (33 files, 737 of 737) and `app/lib/mcp/server` (19 files, 183 of 183); tsc 0;
  eslint clean on the four changed and new TypeScript files; the generators with zero drift beyond the three browser cells (B11 19 of 19
  cases and 61 of 61 checks; the B09, B11 and B21 outputs, 24 files, byte-identical on the gate's re-run; B17-A 628 controls, CSV and
  summary identical; the tree's status unchanged); the browser: the existing suite 48 of 48 and the orchestration config 3 of 3 one
  after the other, after the fixes (769 s + 182 s).
- Records: `evaluation-matrix.md` section 4 (DELIVERED); D21-30's browser half and D21-43 closed; D21-40's browser clause met; D21-45
  opened (low). Live: BLOCKED-LIVE-QUALIFICATION (LB-9) - no model is called.

#### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-F2 committed on chapter/b21-specialist-orchestration: the browser spec on its own flag-on Playwright config
(`playwright.orchestration.config.ts`, the base web server - its command derived, its environment spread - plus the orchestration flag
and the circuit specialist routed to anthropic, its own port, test dir and folders), run after the existing suite, one next dev at a time
(D21-43 closed): F4 PROVEN, a 3D request is one coordinator turn with the router live (D21-30's browser half closed); F6 in part, each role
on its routed provider, the status line, presented once where a verifier decides and the escalation line counting two sources with
nothing presented where both parties seal (the approval and the exact-authority citation offline); F12 in part (E3's resume on the chat
surface after a Stop during the scripted stall, the stalled specialist started again until its own deadline; the rejected presentation
and already_presented stay offline: D21-45 opened, low); each test red first and the adversarial review's six findings fixed test-first;
both browser runs 951 s (769 + 182) of OD-30's 30 minutes; next B21-F3 (the merge's evidence gap, D21-44), then the B21
closeout".
`nextAction`: "B21-F3: the merge records the evidence gap (D21-44, option a); D21-45 (F12's browser remainder: a presented run that stands
down and resumes in the browser) for the lead's decision - (a) a scripted follow-up failure in the fixture agent's script table and a
browser test, or (b) recorded as met by E3's browser resume and case 12; then the B21 closeout (commit 1/2 the single-agent statements
superseded - with the stale titles `evaluation-matrix.md` section 7 lists - commit 2/2 the records and the verdict; PR #11 undrafted after
green CI); the one live run under OD-125 if credits exist; OD-126's older-page question, OD-112's option A, OD-122's across-runs,
at-least-once and stale-artifact options, OD-111's retention question and OD-115's first-turn options stay with the owner".

#### Discovery closure clauses (`discovery.md` §4, appended to each defect; D21-45 is a new defect after D21-44; §10 gains a B21-F2 amendment)

- **D21-30 — No browser observable proves that a direct Tier 0/1 command never recruits specialists.** — CLOSED by B21-F2 (the browser half): `e2e-orchestration/specialist-orchestration.spec.ts` test 1, on the flag-on config,
  observes a 3D control request as ONE coordinator turn - the `/api/chat` body intercepted; the stream the page received with one
  `run_started`, one terminal and no orchestration event (no `plan`, no `specialist_started`); no specialist or orchestration line in
  the run log - with the router live in that server (a Tier 3 ask refused before any model call); red first against a flag-off server
  and with the sentence swapped for a DAG phrasing (`evaluation-matrix.md` section 4). The offline half stays `b21-f-evaluation.test.ts`
  case 4 and the `f04-view3d-single` capsule.
- **D21-40 — The scripted fixture agent answers no specialist through the result tool.** — addendum by B21-F2: the browser run reaches it - under the flag-on config every specialist of the F6 and F12 scenarios that
  answers does so through the result tool, from the scripted agent's per-role table, on either provider (`accepted` in the stream the
  page received; the circuit specialist on anthropic through the config's role override; the stalled one is ended by its own deadline)
  (`evaluation-matrix.md` section 4).
- **D21-43 — The fixture browser server cannot observe an orchestrated run: the orchestration flag is process-wide, and turning it on for the suite changes B18-E's browser proofs.** — CLOSED by B21-F2 (the lead's decision, none of the three listed options): a SECOND Playwright config,
  `playwright.orchestration.config.ts`, runs the same fixture web server (the base config's, imported; its command derived with only the
  port moved) with `SIRKIT_ORCHESTRATION_ENABLED=1` on its own port, never reusing a server, with its own `testDir`
  (`./e2e-orchestration`) and report and output folders; it runs AFTER the existing suite, one `next dev` at a time (locally through the
  lead's lock script; in CI one extra `page-browser-e2e` step, the upload carrying both folders) - no production, `playwright.config.ts`,
  `e2e/`, `next.config.ts` or B18-E evidence change; the flag-on server started after the flag-off one had stopped; F4 PROVEN in the
  browser, F6 and F12 in part (F6: the principal's approval and the escalation's exact-authority citation stay offline, case 6); the
  existing suite unchanged (48 of 48); both runs 951 s (769 + 182) of OD-30's 30 minutes. RECORDED: F12's rejected
  presentation and `already_presented` stay offline (case 12) - the scripted follow-up turn never fails in the browser, so a run that
  presented cannot stand down there without a fixture change; that remainder is D21-45 (new, open), not closed here.
- **D21-45 — No browser run presents a proposal and then stands down: the scripted follow-up turn never fails, so F12's rejected presentation and already_presented are observed only offline.**
  Requirement: B21-F "human rejection and resume" (`:874`) and "browser tests" (`:861`); task-F.md item 3's "a rejected-then-resumed
  run" and task-F2's "nothing presented twice" in the browser. Finding: the scripted fixture agent's follow-up turn always answers
  (`followUpAnswer`) and its per-role table's one interruption is F9's stall, BEFORE anything is presented; so the browser's resume
  (`specialist-orchestration.spec.ts` test 3) presents nothing in either request, its nothing-presented checks cannot see a second
  presentation or a missing `already_presented`, and a presented-then-stood-down run - the human's rejection, then a resume that presents
  nothing again - is proven only through the production POST (`b21-f-evaluation.test.ts` case 12, where the fake SDK client fails the
  follow-up turn). Severity low (case 12 proves OD-122's ledger across resumes offline; the browser proves E3's resume on the chat
  surface). **CONFIRMED** (`evaluation-matrix.md` section 4, F12 in part; `b21-f-page.test.ts` case 14). Closes: the lead's decision - (a)
  a scripted follow-up failure keyed on F12's sentence in the fixture agent's per-role script table (B21-F's harness scope behind
  `SIRKIT_FIXTURE_AGENT=scripted`; a change to `fixture-agent-adapter.ts`, which B21-F2's task did not allow), then a browser test that
  presents, rejects in the review, stands down and resumes, asserting `already_presented` and one presentation in all; or (b) runbook
  :874's browser half recorded as met by E3's resume on the chat surface and case 12 offline. Source: B21-F2's adversarial review
  (coverage-2).
- **§10, B21-F2 (recorded by the lead, 2026-09-28):** Section 4: D21-43 closed; D21-30's browser half closed (D21-30 closed); D21-40's
  browser clause met; D21-45 opened (low: no browser run presents a proposal and then stands down). Section 7, B21-F: amended - the
  browser spec delivered by B21-F2 on its own flag-on Playwright config after the existing suite (F4; F6 and F12 in part), no production
  change; the B21-F bullet's `e2e/specialist-orchestration.spec.ts` is `e2e-orchestration/specialist-orchestration.spec.ts` (its own test
  dir, the lead's decision). Section 8: F2's failing-first is five red browser runs (a flag-off server twice, three spec mutations, the
  spec restored by sha256); its adversarial review's six confirmed findings fixed test-first (two more red browser runs - a blank role
  override, a scheduler mutation restored by hash - and three red page cases); the budget measured one run after the other.

### B21-F2b — the reserved texts, in full (the lead's to apply)

[B21 F2b, 2026-09-29] B21-F2b closes D21-45 (the lead's option (a)) with a fixture-only change - one scripted sentence and its follow-up failure
in the scripted fixture agent's script table, behind the fixture gate - a fourth browser test and one offline suite, and adds no owner
decision (OD-30's rule applied, not changed). These texts are pinned by `b21-f-page.test.ts` case 16 (its `nextAction` rule by case 17).

#### The README row (`artifacts/ai-control-plane-b21/README.md`, a new row "B21-F2b" after B21-F2)

| B21-F2b the browser half of human rejection and resume (D21-45, the lead's option (a)) | `evaluation-matrix.md` (section 4's test 4, its failing-first and the budget; F12's browser cell PROVEN; section 2's scripted follow-up failure; dated [B21 F2b] notes; B21-F2b's reserved texts in section 7; citation rows C105-C129; the adversarial review's fixes in section 6), `evaluation-matrix.{csv,json}` (F12's browser cell), `evidence/f12-presented-rejected-stood-down.png`, `evidence/f12-resume-nothing-presented-again.png`; code (no production file) `app/lib/agent/fixture-agent-adapter.ts` (the browser sentence's script entry on the F12 line and the start hook's follow-up branch, in place; the scripted follow-up failure appended - no cited line moved), `e2e-orchestration/specialist-orchestration.spec.ts` (test 4), `app/lib/agent/orchestration/__tests__/b21-f2b-follow-up-failure.test.ts` (new), `_f-cases.ts` (the sentence and F12's class, in place), `b21-f-page.test.ts` (cases 15 to 19) | CONFIRMED (the scripted fixture agent's script table gains ONE sentence, playing case 12's script, whose coordinator follow-up turn fails with ONE scripted provider failure - overloaded, 529, case 12's vocabulary - only while its envelope says the request presented; no other script's answer changed; in the browser, with the orchestration flag on, test 4 presents the schematic specialist's replacement once, the human rejects it through the review's own Cancel (no new control), the run stands down and the page offers the resume; the same message resumes under the same run id - the first answer and the four specialists replayed, nothing presented again (`already_presented`), one follow-up answer, one terminal - ONE presentation in all; red first against HEAD's fixture and without the failure, and under two mutations (the failure unconditional; OD-122's ledger forgetting its claim - a second presentation seen); the offline suite through the production POST; F12 PROVEN in the browser; the adversarial review's six findings fixed test-first (test 4 counts every line an earlier test also renders and states its status lines literally - F2b's first test 4 passed under four mutations of the page's source that the strengthened one fails; page case 16's `nextAction` rule tolerates a later state; the offline suite claims no rejection it does not drive); both browser runs 402 s (253 + 149) of OD-30's 30 minutes; D21-45 closed) |

#### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-F2b — the browser half of human rejection and resume (2026-09-28/29 local; increment workflow + lead; this commit)

- D21-45 as the lead decided it (option (a)): the scripted fixture agent's script table (`app/lib/agent/fixture-agent-adapter.ts`,
  behind `SIRKIT_FIXTURE_AGENT=scripted`, no new adapter class, the constructor tripwire still at `adapters.ts`) gains ONE sentence,
  "Replace U1 with a lower-power timer for the LED circuit." (`B21_F_SENTENCES.rejectResumeBrowser`; a genuine replacement request of
  the router's corpus - the replacement DAG, "ask" from the composer) playing case 12's script (the schematic specialist seals U1's
  exact replacement), and ONE scripted follow-up failure (`FIXTURE_FOLLOW_UP_FAILURES`): its coordinator follow-up turn fails with an
  overloaded provider (HTTP 529, an `LLMProviderError` - case 12's vocabulary, `provider_overloaded`) only while the merged envelope says
  that request presented the run's artifact, so the run stands down after presenting and a resume's follow-up turn (its envelope
  `already_presented`) answers. The entry added on the F12 line and the start hook's follow-up branch changed in place, the failure
  appended: no cited line moved; no other script's answer changed.
- `e2e-orchestration/specialist-orchestration.spec.ts` test 4 (the spec's namespace, no new control): the sentence from the composer;
  one plan, the four specialists accepted, ONE `proposal_ready` and ONE presented line, then ONE `degraded` `follow_up_failed`
  (`provider_overloaded`) and one terminal; the human rejects the replacement through the review's own "Cancel — change nothing" (one new discard
  line, no applied line); the page shows the stand-down line, the status line (literal counters: 4 scheduled, 4 finished, one degraded
  notice) and E3's offer; the same message resumes under the same run id - the resuming line, the first answer and the four specialists
  replayed, nothing presented again (the run log's `already_presented` line), one follow-up answer, one new status line (4 and 4), one
  terminal; ONE presentation in all, no second review or offer, no applied line - every line an earlier test also renders counted
  before and after (the adversarial review's fix). Evidence `f12-presented-rejected-stood-down.png`,
  `f12-resume-nothing-presented-again.png`.
- Offline: `b21-f2b-follow-up-failure.test.ts` (2 cases): the failure scoped to ONE sentence and ONE approval outcome over every script
  and every outcome, on either provider; the sentence through the production POST (the fake SDK clients faulting nothing): presented
  once (the page's consumer receives the sealed proposal; nothing applied - the human's rejection is the browser's, spec test 4), stood
  down, resumed with nothing presented again and one follow-up, a second resume `resume_completed`, case 12's sentence unchanged.
- Failing-first: four red browser runs of test 4 alone (`b21/f2b/ff-*.log`) - HEAD's fixture agent (nothing presented), the entry
  without the failure (no stand-down: D21-45's gap), the failure made unconditional (the resume stood down again) and OD-122's ledger
  forgetting its claim (a second presentation SEEN; `orchestration-runtime.ts` restored from HEAD, sha256 and blob hash equal); the
  offline suite red against HEAD's fixture agent and under the unconditional failure; every mutated source restored by sha256.
- The adversarial review (six confirmed findings on three defects), fixed test-first (`b21/f2bfix/`): page case 16's `nextAction`
  check follows b21-d-page case 9's rule (compare only while the B21-F2b clause stands; a later state passes) - page case 17, red first
  on a later state; test 4 counts every line an earlier test on the shared page also renders (the chat's own lines, the toast excluded),
  expects one new discard line and no applied line, and states its status lines as literal counters - F2b's test 4 PASSED under four
  mutations of `app/page.tsx` and `chat-run-view.ts` at once (no discard line, an applied line, the reducer ignoring a degraded notice,
  no resumed status line), the strengthened test 4 fails under each alone, both files restored (sha256 and blob hash equal to HEAD's),
  page case 19 pins it; the offline suite's case 2 claims no rejection it does not drive - page case 18.
- Pins moved (reviewed, reasons beside them): `b21-f-page.test.ts` case 10's spec test count (3 -> 4) and F12 mapping (PROVEN IN
  PART -> PROVEN), the F12 browser label added; the matrix's F12 browser cell (`_f-cases.ts`, in place, its line count unchanged so
  C19-C21 hold; the generator re-run: only that cell moved, `replay-trace-pins-b21.json` byte-identical); page cases 15 and 16 added,
  and 17 to 19 for the adversarial review's fixes (case 16's `nextAction` check moved onto their shared rule); section 6's counts (the
  spec 3 -> 4, the page suite 14 -> 19, the new suite 2); citation rows C105-C129 (C115-C119 re-pinned by the review's fixes). Case 10's title ("the
  spec's three tests") kept for the closeout's retitling (section 7's list). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): retitled "the spec's four tests (three when written ...)"]
- Budget (OD-30), after the review's fixes: the existing suite 48 of 48 in 253 s of wall time and the orchestration config 4 of 4
  in 149 s, one after the other: 402 s, about 6.7 minutes of OD-30's 30 minutes (about 23.3 minutes of headroom, above the
  five-minute split rule; before the fixes 412 s, 263 + 149); the 30 tracked evidence PNGs the runs rewrote restored from HEAD by blob
  hash (the existing suite's 25 and F2's five).
- Gates after the review's fixes, one heavy job at a time through the lock runner (`b21/f2bfix/gates/`): every B21 suite with the eight route suites, the E4
  composer suite and the CI guard (58 files, 537 of 537 - every A..F page suite included, the F page's 19 cases and the F2b suite's 2);
  `app/api/chat` and `app/lib/acquisition` in full (37 files: 359 passed, the opt-in live file's 2 skipped as before); `app/lib/agent`
  with the exposure and tier suites, the B11 suites, the B17-A inventory and the B18-D UI gates (63 files, 646 of 646); `app/lib/project`
  with `app/components/chat` (40 files, 318 of 318); the fixture agent and every B18-C/B18-E scenario suite (16 files, 108 of 108); the
  import gates, census ratchets and route matrices (10 files, 104 of 104; census 165/162/3/0, no route added); `app/lib/mcp` with
  `app/api/mcp` (33 files, 737 of 737 - the B20 pages' citations) and `app/lib/mcp/server` (19 files, 183 of 183 - the b20-b2 nine-file
  pin); tsc 0; eslint clean on the five changed and new TypeScript files; the generators with zero drift (B11 19 of 19 cases and 61 of 61
  checks; the B09, B11 and B21 outputs, 24 files, byte-identical on the re-run - `evaluation-matrix.csv` and `.json` byte-identical to
  B21-F2b's, against HEAD only F12's browser cell, and `replay-trace-pins-b21.json` byte-identical to HEAD's; B17-A 628 controls, CSV and
  summary identical); the tree's status and every changed file unchanged during the gates.
- Records: `evaluation-matrix.md` (dated [B21 F2b] notes on the head, section 0, section 1's class note and F12 row, section 2's list
  and the failure, section 4's test 4, failing-first and budget, section 5, section 6, the section-7 stale-title list and these texts,
  section 8's rows); D21-45 closed. Live: BLOCKED-LIVE-QUALIFICATION (LB-9) - no model is called.

#### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-F2b committed on chapter/b21-specialist-orchestration: the browser half of human rejection and resume
(D21-45 closed, the lead's option (a)) - the scripted fixture agent's script table gains one sentence whose coordinator follow-up turn
fails with a scripted provider failure (overloaded, case 12's vocabulary) only while its request presents, and the orchestration spec's
fourth test presents the schematic specialist's replacement once, rejects it through its review's own Cancel, stands down, offers and
resumes the run under the same run id - the first answer and the four specialists replayed, nothing presented again
(already_presented), one follow-up; F12's browser cell PROVEN; no production change, no control; red first (four browser runs, the
offline suite); the adversarial review's six findings fixed test-first (test 4's page checks counted and literal, red under four
mutations of the page's source; page case 16's nextAction rule tolerating a later state; the offline suite claiming no rejection);
both browser runs 402 s (253 + 149) of OD-30's 30 minutes; next the B21 closeout".
`nextAction`: "The B21 closeout (commit 1/2: the single-agent statements superseded, the stale titles retitled, B's
specialistResultsEnvelope retired (D21-36), a tripwire; commit 2/2: the four validation artifacts, the verdict, README, ledger and
state; PR #11 undrafted, green CI, a normal merge); the one live run under OD-125 if credits exist; OD-126's older-page question,
OD-112's option A, OD-122's across-runs, at-least-once and stale-artifact options, OD-111's retention question and OD-115's
first-turn options stay with the owner".

#### Discovery closure clauses (`discovery.md` §4, appended to D21-45 and D21-43; §10 gains a B21-F2b amendment)

- **D21-45 — No browser run presents a proposal and then stands down: the scripted follow-up turn never fails, so F12's rejected presentation and already_presented are observed only offline.** — CLOSED by B21-F2b (the lead's option (a)): the scripted fixture
  agent's script table (behind `SIRKIT_FIXTURE_AGENT=scripted`, no new adapter class) gains ONE sentence - "Replace U1 with a
  lower-power timer for the LED circuit.", playing case 12's script - whose coordinator follow-up turn fails with ONE scripted
  provider failure (overloaded, 529 - case 12's vocabulary, `provider_overloaded`) only while its merged envelope says the request
  presented, so no other script's answer changes (`b21-f2b-follow-up-failure.test.ts` case 1: every script under every approval
  outcome); `e2e-orchestration/specialist-orchestration.spec.ts` test 4, on the flag-on config, presents the schematic specialist's
  replacement once, the human rejects it through the review's own Cancel (no new control), the run stands down (`follow_up_failed`)
  and the page shows E3's offer; the same message resumes it under the same run id - the first answer and the four committed
  specialists replayed, NOTHING presented again (the run log's `already_presented` line), one follow-up answer, one terminal: ONE
  presentation in all (`evaluation-matrix.md` section 4, F12's browser cell PROVEN), every line an earlier test also renders counted
  before and after and the status lines literal counters (the adversarial review's fixes); red first against HEAD's fixture agent and
  without the failure, and under OD-122's ledger forgetting its claim (a second presentation seen), and the strengthened checks under
  four mutations of the page's source that the first test 4 let through; offline through the production POST
  (`b21-f2b-follow-up-failure.test.ts` case 2). RECORDED: the record's one claim and a second resume's `resume_completed` (a request the
  page never sends) stay the server's, case 12.
- **D21-43 — The fixture browser server cannot observe an orchestrated run: the orchestration flag is process-wide, and turning it on for the suite changes B18-E's browser proofs.** — addendum by B21-F2b: its RECORDED remainder (F12's
  rejected presentation and `already_presented` offline only) is closed as D21-45 by B21-F2b's scripted follow-up failure and the
  spec's test 4, on the same flag-on config.
- **§10, B21-F2b (recorded by the lead, 2026-09-29):** Section 4: D21-45 closed (the lead's option (a)); D21-43's RECORDED remainder
  met. Section 6: no owner decision. Section 7, B21-F: amended - the browser spec's fourth test (F12 PROVEN in the browser) and ONE
  scripted sentence with its follow-up failure in the fixture agent's script table (behind the fixture gate; no production change).
  Section 8: failing-first - four red browser runs of test 4 (HEAD's fixture agent, the entry without the failure, the failure
  unconditional, OD-122's ledger forgetting its claim; every mutated source restored by sha256) and the offline suite red against
  HEAD's fixture agent; the adversarial review's six findings fixed test-first (the first test 4 green under four mutations of the
  page's source, the strengthened test 4 red under each; page case 16's nextAction rule tolerating a later state); the budget measured
  one run after the other.

## 8. Citations, as of base d03f182

The anchor is what the tests check - it occurs exactly once in its file - and the line stated is the CURRENT line for every row (page
case 6 checks it; the review's fixes re-pinned the rows whose lines moved in F's own helpers and scripts, and added C64 to C81).

| # | file | line | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/agent/fixture-agent-adapter.ts` | 421 | — | `const roleStep = await scriptedRoleStart(this, input); if (roleStep) return roleStep;` | the start hook, in place on its own line |
| C2 | `app/lib/agent/fixture-agent-adapter.ts` | 462 | — | `const roleStep = scriptedRoleContinue(this, input); if (roleStep) return roleStep;` | the continue hook, in place |
| C3 | `app/lib/agent/fixture-agent-adapter.ts` | 546 | — | `export const FIXTURE_ROLE_SCRIPTS:` | the per-role script table, keyed on whole sentences |
| C4 | `app/lib/agent/fixture-agent-adapter.ts` | 512 | — | `export const FIXTURE_RESULT_TOOL_NAME = "sirkit_specialist_result";` | a run that offers it is a specialist run |
| C5 | `app/lib/agent/fixture-agent-adapter.ts` | 514 | — | `export const FIXTURE_FOLLOW_UP_HEAD = "ORCHESTRATION RESULTS";` | the follow-up turn's envelope head |
| C6 | `app/lib/agent/fixture-agent-adapter.ts` | 635 | — | `async function scriptedRoleStart(` | the start of a role run |
| C7 | `app/lib/agent/fixture-agent-adapter.ts` | 655 | — | `function scriptedRoleContinue(` | a role run's next step |
| C8 | `app/lib/agent/fixture-agent-adapter.ts` | 571 | — | `requiredTools: [{ toolId: "sirkit.manufacturing.release"` | a hostile result naming a release tool |
| C9 | `app/lib/agent/fixture-agent-adapter.ts` | 568 | — | `"design a 555 timer led blinker": { "circuit-topology": { stall: true } },` | the stalled specialist |
| C10 | `app/lib/agent/fixture-agent-adapter.ts` | 539 | — | `function hostileSecret(): string {` | a secret assembled at run time, never a literal |
| C11 | `app/lib/agent/fixture-agent-adapter.ts` | 620 | — | `function followUpAnswer(userMessage: string): string {` | the follow-up turn answers from the envelope's counts |
| C12 | `app/lib/agent/fixture-agent-adapter.ts` | 646 | — | `the stalled turn was ended by the run's signal` | a stall ends only by the run's own signal |
| C13 | `app/lib/agent/replay-capsule.ts` | 154 | — | `"client", "sdk", "openai", "anthropic",` | the capsule denylist, unchanged (A's C20, re-pinned) |
| C14 | `app/lib/agent/replay-capsule.ts` | 68 | — | `export const AGENT_REPLAY_CAPSULE_SCHEMA = "sirkit.agent-replay-capsule.v4" as const;` | capsule v4 |
| C15 | `app/lib/agent/replay-capsule.ts` | 88 | — | `export interface CapsuleTask {` | one task's step list |
| C16 | `app/lib/agent/replay-capsule.ts` | 109 | — | `tasks?: CapsuleTask[];` | the optional task lists |
| C17 | `app/lib/agent/replay-capsule.ts` | 131 | — | `maxTasks: 8,` | their bound |
| C18 | `app/lib/agent/replay-capsule.ts` | 186 | — | `const CAPSULE_OPTIONAL_KEYS = ["tasks"] as const;` | the capsule's one optional key |
| C19 | `app/lib/agent/orchestration/__tests__/_f-cases.ts` | 56 | — | `export const B21_F_CASES: readonly B21FCase[] = Object.freeze([` | the case table the matrix renders |
| C20 | `app/lib/agent/orchestration/__tests__/_f-cases.ts` | 75 | — | `export function evaluationMatrixCsv(): string {` | the CSV rendering |
| C21 | `app/lib/agent/orchestration/__tests__/_f-cases.ts` | 80 | — | `export function evaluationMatrixJson(): string {` | the JSON rendering |
| C22 | `app/api/chat/orchestration-runtime.ts` | 43 | — | `return environment[ORCHESTRATION_ENABLED_ENV] === "1";` | the flag: the server's environment, process-wide |
| C23 | `app/lib/agent/adapters.ts` | 323 | — | `if (fixtureRuntimeEnabled() && process.env[FIXTURE_AGENT_ENV]?.trim() === FIXTURE_AGENT_SCRIPTED) return agentAdapterFor(provider);` | a specialist gets the scripted agent under the fixture opt-in |
| C24 | `app/lib/agent/orchestration/result-tool.ts` | 29 | — | `export const SPECIALIST_RESULT_TOOL_NAME = "sirkit_specialist_result" as const;` | the result tool's provider name |
| C25 | `app/lib/agent/orchestration/scheduler.ts` | 339 | — | `Role: ${task.role}` | the frame's machine-readable role line |
| C26 | `app/lib/agent/orchestration/scheduler.ts` | 330 | — | `address this request with reads and, only where a change is warranted, ONE sealed proposal of your role` | the objective quotes the user's sentence last |
| C27 | `app/lib/agent/orchestration/__tests__/_f-fixture-clients.ts` | 56 | — | `export function fixtureOpenAIClient(` | the OpenAI fake client over one fixture agent |
| C28 | `app/lib/agent/orchestration/__tests__/_f-fixture-clients.ts` | 87 | — | `export function fixtureAnthropicClient(` | the Anthropic fake client |
| C29 | `app/lib/agent/orchestration/__tests__/_f-fixture-clients.ts` | 49 | — | `function fault(log: FixtureClientLog, role: string, followUp: boolean): void {` | the two provider faults, the client's |
| C30 | `app/api/chat/orchestration-runtime.ts` | 189 | — | `specialistResultsEnvelope RETIRED (D21-36)` | B's envelope head; [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): retired with B's envelope (D21-36) - this row cites its one-line tombstone; the one envelope head is C31's] |
| C31 | `app/api/chat/orchestration-runtime.ts` | 320 | — | `const MERGED_ENVELOPE_HEADER = "ORCHESTRATION RESULTS, JUDGED` | the merged envelope head |
| C32 | `app/lib/agent/orchestration/scheduler.ts` | 619 | — | `if (failure === "cancelled") stop = "cancelled";` | a deadline ends its task only (F9) |
| C33 | `app/lib/agent/orchestration/scheduler.ts` | 463 | — | `if (committedScopeDigest === currentScopeDigest) {` | a committed result replays only under its own scope (F8) |
| C34 | `app/api/chat/orchestration-runtime.ts` | 724 | — | `return { ok: true, alreadyPresented: !read.ok` | OD-122's ledger across resumes (F12) |
| C35 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 46 | — | `export const ORCHESTRATION_EVALUATION_CATEGORY = "orchestration" as const;` | the category, outside the nine files |
| C36 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 188 | — | `return runOrchestratedChat({` | the task-graph runner: the real runtime |
| C37 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 227 | — | `export async function runOrchestrationCase(` | one case, offline or (record-only) live |
| C38 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 223 | — | `const PINNED_ENV: Readonly<Record<string, string>> =` | the server env a replay pins and restores |
| C39 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 247 | — | `digest: agentRunTraceDigest({ ...trace, traceId:` | the one random identity, normalized |
| C40 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 137 | — | `export function buildOrchestrationEvaluationCases(): OrchestrationEvaluationCase[] {` | the seven capsules |
| C41 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 53 | — | `export const REPLAY_STALL_DEADLINE_MS = 2_000;` | the real deadline of a replay that scripts a stall (every other replay keeps the production budget) |
| C42 | `scripts/generate-b21-artifacts.ts` | 22 | — | `writeFileSync(join(outDir, "evaluation-matrix.csv"), evaluationMatrixCsv());` | the generator writes the matrix |
| C43 | `scripts/generate-b21-artifacts.ts` | 33 | — | `writeFileSync(join(root, B21_REPLAY_PINS_FILE), replayPinsDocument(pins, b11));` | and the pins |
| C44 | `scripts/run-b21-live-orchestration-evaluation.ts` | 76 | — | `if (environment[LIVE_FLAG] !== "1") {` | the live command refuses first |
| C45 | `scripts/run-b21-live-orchestration-evaluation.ts` | 35 | — | `export const LIVE_CALL_BOUND = 40;` | the spend bound |
| C46 | `scripts/run-b21-live-orchestration-evaluation.ts` | 54 | — | `export function boundedLiveAdapters(` | every live call counted |
| C47 | `scripts/run-b21-live-orchestration-evaluation.ts` | 58 | — | `if (calls >= bound) throw new LLMProviderError(adapter.provider, "unknown");` | the call past the bound is never sent |
| C48 | `playwright.config.ts` | 20 | — | `testDir: "./e2e",` | the browser suite's one test dir |
| C49 | `.github/workflows/deterministic-manufacturing.yml` | 371 | — | `- run: pnpm exec playwright test` | `page-browser-e2e`'s existing step: every spec of `playwright.config.ts` under one config ([B21 F2, 2026-09-28] re-pinned: F2's step line, C93, contains the old anchor `run: pnpm exec playwright test`; the orchestration config runs after this step) [SEC-1, 2026-10-01] re-pinned +1: SEC-1's suite entry at `:225` [B22-A1, 2026-10-01] re-pinned +1: B22-A1's directory filter `app/lib/computation/__tests__` at `:226` [B23-A1, 2026-10-02] re-pinned +1: B23-A1's directory filter `app/lib/manufacturing-providers/__tests__` at `:227` [B23-B2, 2026-10-04] re-pinned +1: B23-B2's database-delivery entry `app/lib/manufacturing-providers/database/__tests__/b23-b-exchange-ledger-pglite.test.ts` at `:301` [B24-A1, 2026-10-06] re-pinned +1: B24-A1's directory filter `app/lib/qualification/__tests__` at `:228` [B24-A4, 2026-10-08] re-pinned +4: B24-A4's four database-delivery entries (`app/lib/qualification/database/__tests__/b24-a4-*.test.ts`) at `:303-306` [B24-B2, 2026-10-08] re-pinned +32: B24-B2's 32 prompt-to-gerber entries (the 23 B09-B11 suites, the four B16.0 byte pins, `pin-pad-mapping`, the `app/lib/footprint-resolver/__tests__` filter and the three opt-in live suites) at `:260-291` [B24-B3, 2026-10-08] re-pinned +1: B24-B3's prompt-to-gerber entry `app/lib/spice/__tests__/worker-integration.test.ts` at `:292` (the one live suite no job selected, OD-222) |
| C50 | `playwright.config.ts` | 58 | — | `SIRKIT_FIXTURE_AGENT: "scripted",` | the one web server's environment: the scripted agent, no orchestration flag |
| C51 | `e2e/agent-execution.spec.ts` | 776 | — | `await chat("Release the board.");` | B18-E scenario 8's forged Tier 3 call |
| C52 | `app/lib/agent/orchestration/router.ts` | 83 | — | `{ family: "release", words: ["release"], aliases: [], pattern: headVerb("release") },` | with the flag on, refused before any model call |
| C53 | `e2e/agent-execution.spec.ts` | 975 | — | `test("[B18-E E16] scenario 4 in the browser` | B18-E scenario 4 in the browser |
| C54 | `app/lib/agent/orchestration/router.ts` | 177 | — | `if (facts.hasSchematic && partKindSwap(message, userMessage)) return dag("D-component-replacement"` | with the flag on, scenario 4's sentence is a DAG |
| C55 | `.github/workflows/deterministic-manufacturing.yml` | 132 | — | `app/lib/agent/orchestration/__tests__` | the directory filter the new suites ride |
| C56 | `app/lib/agent/replay-capsule.ts` | 191 | — | `const CAPSULE_STEP_OPTIONAL_KEYS = ["failure", "stall"] as const;` | a step may be a scripted failure or a scripted stall |
| C57 | `app/lib/agent/replay-capsule.ts` | 399 | — | `if (step.stall !== undefined) { if (!stallAllowed)` | a stall only in a task's step list, exactly `true`, never beside a failure |
| C58 | `app/lib/agent/replay-capsule.ts` | 406 | — | `function validateCapsuleTasks(tasks: unknown, issues: CapsuleIssues): void {` | the task lists, validated exactly |
| C59 | `app/lib/agent/replay-capsule.ts` | 469 | — | `if (scripted.stall) return stalled(signal);` | a stall answers nothing until the run's signal ends it |
| C60 | `app/lib/agent/replay-capsule.ts` | 525 | — | `export type TaskGraphRunner = ` | the task-graph runner's contract |
| C61 | `app/lib/agent/replay-capsule.ts` | 535 | — | `taskGraph?: TaskGraphRunner;` | injected by the caller, never imported |
| C62 | `app/lib/agent/replay-capsule.ts` | 625 | — | `if (tasks.length > 0 && !options?.taskGraph) failures.push(` | never a task graph as one loop |
| C63 | `app/lib/agent/replay-capsule.ts` | 487 | — | `function unrunTaskGraph(` | a task graph with no runner: started and failed, no step |
| C64 | `app/lib/agent/replay-capsule.ts` | 411 | — | `const roles = new Set<string>(); let previous = 0; for (const [position, item] of tasks.entries()) {` | the task list is walked with its roles and its last plan index |
| C65 | `app/lib/agent/replay-capsule.ts` | 418 | — | `else if (typeof task.role === "string" && roles.has(task.role))` | one step list per role |
| C66 | `app/lib/agent/replay-capsule.ts` | 417 | — | `if (!Number.isSafeInteger(task.index) || (task.index as number) <= previous)` | a task's index is its plan's: a positive integer above the previous one |
| C67 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 181 | — | `B21_REPLAY_TASK_NOT_PLANNED: capsule task` | the runner refuses a task its plan does not schedule there, before anything runs |
| C68 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 207 | — | `export function routeOfCapsule(capsule: ReplayCapsule)` | the router's answer for a capsule, over the context the replay assembles |
| C69 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 56 | — | `export function replayBudget(capsule: ReplayCapsule, live = false): AgentRunBudget {` | the production budget unless the capsule scripts a stall |
| C70 | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | 132 | — | `const routed = (kind: string, rule: string) => check(` | every case checks its route |
| C71 | `scripts/run-b21-live-orchestration-evaluation.ts` | 43 | — | `export const LIVE_ADAPTER_FACTORIES: LiveOrchestrationAdapters = Object.freeze<LiveOrchestrationAdapters>({` | the live adapters, SDK retries 0 |
| C72 | `scripts/run-b21-live-orchestration-evaluation.ts` | 46 | — | `if (adapter instanceof OpenAIAgentAdapter) return new OpenAIAgentAdapter(undefined, undefined, undefined, LIVE_SDK_MAX_RETRIES);` | the live coordinator rebuilt with no SDK retry |
| C73 | `scripts/run-b21-live-orchestration-evaluation.ts` | 71 | — | `export function liveEvaluationCases(provider: "openai" | "anthropic"): OrchestrationEvaluationCase[] {` | the four task-graph capsules, every turn on one provider |
| C74 | `scripts/run-b21-live-orchestration-evaluation.ts` | 75 | — | `export async function main(environment: Record<string, string | undefined> = process.env, factories: LiveOrchestrationAdapters = LIVE_ADAPTER_FACTORIES)` | the command takes its adapter factories |
| C75 | `app/lib/agent/orchestration/__tests__/_f-fixture-clients.ts` | 51 | — | `if (log.quotaForCoordinator && role === "coordinator" && !followUp) throw quotaError();` | the coordinator's first-turn 429 (D21-42, case 16) |
| C76 | `app/lib/agent/orchestration/__tests__/_f-fixture-clients.ts` | 68 | — | `provider: "openai", role, turn: outputs.length > 0 ? "continue" : "start", model: String(params.model), followUp, tools:` | every call records the tools it offered |
| C77 | `app/api/chat/orchestration-runtime.ts` | 178 | — | `export function followUpDeps(deps: AgentLoopDeps, specialistGateway: AgentToolInvocationGateway): AgentLoopDeps {` | the follow-up turn's narrowed deps (F11; M14) |
| C78 | `app/lib/agent/orchestration/scheduler.ts` | 399 | — | `coordinator.artifactHeld === true ? deriveSpecialistContext(context) : specialistContextFor(context, task.role)` | OD-122: no proposal beside the coordinator's artifact (F1; M9) |
| C79 | `app/api/chat/orchestration-runtime.ts` | 267 | — | `const followUpMeters = input.providers ? admittedAdapter(` | only a specialist's or the follow-up's call is metered (D21-42; M15) |
| C80 | `app/lib/agent/orchestration/merge.ts` | 869 | — | `if (shared.length > 0) edges.push(` | two different changes to one identity escalate (F6; M11) |
| C81 | `app/lib/agent/orchestration/provider-policy.ts` | 110 | — | `const choice = override ?? ROLE_PROVIDER_POLICY[role];` | the server env routes a role to its provider (F6; M10) |
| C82 | `playwright.orchestration.config.ts` | 15 | — | `import base from "./playwright.config";` | [B21 F2] the base config imported: its web server, never copied |
| C83 | `playwright.orchestration.config.ts` | 26 | — | `testDir: "./e2e-orchestration",` | [B21 F2] its own test dir, outside `./e2e` |
| C84 | `playwright.orchestration.config.ts` | 42 | — | `reuseExistingServer: false,` | [B21 F2] never attaches to a running (flag-off) server |
| C85 | `playwright.orchestration.config.ts` | 44 | — | `...baseServer.env,` | [B21 F2] the base web server's whole environment, spread ([B21 F2 fix] C83-C86 re-pinned: three lines above them derive the command) |
| C86 | `playwright.orchestration.config.ts` | 48 | — | `SIRKIT_ORCHESTRATION_ENABLED: "1",` | [B21 F2] the flag on |
| C87 | `e2e-orchestration/specialist-orchestration.spec.ts` | 32 | — | `const UUID_NAMESPACE = "b21f2000";` | [B21 F2] the spec's own id namespace |
| C88 | `e2e-orchestration/specialist-orchestration.spec.ts` | 124 | — | `return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });` | [B21 F2] the pull-through body: the stream the page's reader pulled, observed |
| C89 | `e2e-orchestration/specialist-orchestration.spec.ts` | 120 | — | `finish("cancelled");` | [B21 F2] its cancel cancels the source: Stop still closes the connection |
| C90 | `e2e-orchestration/specialist-orchestration.spec.ts` | 174 | — | `test("[B21 F2] F4 / D21-30:` | [B21 F2] test 1: one coordinator turn for a 3D request (D21-30's browser half) |
| C91 | `e2e-orchestration/specialist-orchestration.spec.ts` | 203 | — | `test("[B21 F2] F6:` | [B21 F2] test 2: the status line; presented once; escalated, nothing presented |
| C92 | `e2e-orchestration/specialist-orchestration.spec.ts` | 254 | — | `test("[B21 F2] F12's browser half:` | [B21 F2] test 3: E3's offer, the resume under the same run id, nothing presented ([B21 F2 fix] re-pinned: test 2 gained six lines) |
| C93 | `.github/workflows/deterministic-manufacturing.yml` | 374 | — | `run: pnpm exec playwright test -c playwright.orchestration.config.ts` | [B21 F2] the one extra `page-browser-e2e` step, after the existing one (C49) [SEC-1, 2026-10-01] re-pinned +1: SEC-1's suite entry at `:225` [B22-A1, 2026-10-01] re-pinned +1: B22-A1's directory filter `app/lib/computation/__tests__` at `:226` [B23-A1, 2026-10-02] re-pinned +1: B23-A1's directory filter `app/lib/manufacturing-providers/__tests__` at `:227` [B23-B2, 2026-10-04] re-pinned +1: B23-B2's database-delivery entry `app/lib/manufacturing-providers/database/__tests__/b23-b-exchange-ledger-pglite.test.ts` at `:301` [B24-A1, 2026-10-06] re-pinned +1: B24-A1's directory filter `app/lib/qualification/__tests__` at `:228` [B24-A4, 2026-10-08] re-pinned +4: B24-A4's four database-delivery entries (`app/lib/qualification/database/__tests__/b24-a4-*.test.ts`) at `:303-306` [B24-B2, 2026-10-08] re-pinned +32: B24-B2's 32 prompt-to-gerber entries (the 23 B09-B11 suites, the four B16.0 byte pins, `pin-pad-mapping`, the `app/lib/footprint-resolver/__tests__` filter and the three opt-in live suites) at `:260-291` [B24-B3, 2026-10-08] re-pinned +1: B24-B3's prompt-to-gerber entry `app/lib/spice/__tests__/worker-integration.test.ts` at `:292` (the one live suite no job selected, OD-222) |
| C94 | `.github/workflows/deterministic-manufacturing.yml` | 383 | — | `playwright-report-orchestration` | [B21 F2] the upload carries the new report folder [SEC-1, 2026-10-01] re-pinned +1: SEC-1's suite entry at `:225` [B22-A1, 2026-10-01] re-pinned +1: B22-A1's directory filter `app/lib/computation/__tests__` at `:226` [B23-A1, 2026-10-02] re-pinned +1: B23-A1's directory filter `app/lib/manufacturing-providers/__tests__` at `:227` [B23-B2, 2026-10-04] re-pinned +1: B23-B2's database-delivery entry `app/lib/manufacturing-providers/database/__tests__/b23-b-exchange-ledger-pglite.test.ts` at `:301` [B24-A1, 2026-10-06] re-pinned +1: B24-A1's directory filter `app/lib/qualification/__tests__` at `:228` [B24-A4, 2026-10-08] re-pinned +4: B24-A4's four database-delivery entries (`app/lib/qualification/database/__tests__/b24-a4-*.test.ts`) at `:303-306` [B24-B2, 2026-10-08] re-pinned +32: B24-B2's 32 prompt-to-gerber entries (the 23 B09-B11 suites, the four B16.0 byte pins, `pin-pad-mapping`, the `app/lib/footprint-resolver/__tests__` filter and the three opt-in live suites) at `:260-291` [B24-B3, 2026-10-08] re-pinned +1: B24-B3's prompt-to-gerber entry `app/lib/spice/__tests__/worker-integration.test.ts` at `:292` (the one live suite no job selected, OD-222) |
| C95 | `.gitignore` | 65 | — | `/playwright-report-orchestration/` | [B21 F2] the new report folder, ignored by git |
| C96 | `.gitignore` | 66 | — | `/test-results-orchestration/` | [B21 F2] the new output folder, ignored by git |
| C97 | `playwright.orchestration.config.ts` | 22 | — | `const BASE_URL = new URL(String(baseServer.url));` | [B21 F2 fix: tests-05] the base's readiness url and its port flag, read from the base |
| C98 | `playwright.orchestration.config.ts` | 40 | — | `command: baseServer.command.replace(BASE_PORT_FLAG,` | [B21 F2 fix: tests-05] the base's command, only its port moved |
| C99 | `playwright.orchestration.config.ts` | 23 | — | `!BASE_PORT_FLAG.test(baseServer.command)) throw new Error(` | [B21 F2 fix: tests-05] a base command without its port flag refuses to load ([B21 F2 lead] a default port included, never a prefix of a longer one) |
| C100 | `playwright.orchestration.config.ts` | 50 | — | `SIRKIT_ORCHESTRATION_ROLE_MODELS: JSON.stringify({ "circuit-topology": { provider: "anthropic", model: "inherit" } }),` | [B21 F2 fix: security-1] F6's two parties on two providers, as case 6 routes them |
| C101 | `e2e-orchestration/specialist-orchestration.spec.ts` | 242 | — | `toContain("; 2 source(s);")` | [B21 F2 fix: security-1] the escalation counts two sources |
| C102 | `e2e-orchestration/specialist-orchestration.spec.ts` | 207 | — | `const providers = [["circuit-topology", "anthropic"],` | [B21 F2 fix: tests-01] each role's provider, asserted in both requests |
| C103 | `e2e-orchestration/specialist-orchestration.spec.ts` | 302 | — | `event.role === "circuit-topology").map((event) => event.attempt)` | [B21 F2 fix: tests-02] the stalled specialist STARTS again on the resume, at attempt 1 |
| C104 | `e2e-orchestration/specialist-orchestration.spec.ts` | 304 | — | `[event.status, event.attempt, event.reason]` | [B21 F2 fix: tests-02] and its own deadline ends it (`deadline`) |
| C105 | `app/lib/agent/fixture-agent-adapter.ts` | 566 | — | `"replace u1 with a lower-power timer for the led circuit": { schematic: { steps: [U1_REPLACEMENT] } },` | [B21 F2b] the browser's F12 sentence plays case 12's script (the schematic specialist's replacement), added on the F12 line: no line moved |
| C106 | `app/lib/agent/fixture-agent-adapter.ts` | 638 | — | `? scriptedFollowUp(adapter, input) : null;` | [B21 F2b] the start hook's follow-up branch, in place: the envelope's answer or the scripted failure |
| C107 | `app/lib/agent/fixture-agent-adapter.ts` | 687 | — | `export const FIXTURE_FOLLOW_UP_FAILURES: readonly string[] = Object.freeze(["replace u1 with a lower-power timer for the led circuit"]);` | [B21 F2b] ONE sentence whose follow-up turn fails |
| C108 | `app/lib/agent/fixture-agent-adapter.ts` | 690 | — | `export const FIXTURE_FOLLOW_UP_FAILURE = Object.freeze({ reason: "overloaded", status: 529 } as const);` | [B21 F2b] the scripted failure: overloaded, 529 - case 12's vocabulary |
| C109 | `app/lib/agent/fixture-agent-adapter.ts` | 705 | — | `followUpApprovalOutcome(input.userMessage) === "presented") throw new LLMProviderError(` | [B21 F2b] only while the envelope says this request presented |
| C110 | `app/lib/agent/fixture-agent-adapter.ts` | 681 | — | `import { LLMProviderError } from "../llm/errors";` | [B21 F2b] the failure is the normalized provider error the real adapters hand the loop (the import appended: hoisted) |
| C111 | `app/lib/agent/orchestration/__tests__/_f-cases.ts` | 25 | — | `rejectResumeBrowser: "Replace U1 with a lower-power timer for the LED circuit.",` | [B21 F2b] the browser's F12 sentence, on case 12's line |
| C112 | `app/lib/agent/orchestration/__tests__/_f-cases.ts` | 31 | — | `export const BROWSER_PROVEN_F12 = "PROVEN: e2e-orchestration/specialist-orchestration.spec.ts tests 3 and 4` | [B21 F2b] F12's browser class, on the classes' line |
| C113 | `app/lib/agent/orchestration/__tests__/_f-cases.ts` | 68 | — | `browser: BROWSER_PROVEN_F12,` | [B21 F2b] F12's row: PROVEN in the browser |
| C114 | `e2e-orchestration/specialist-orchestration.spec.ts` | 328 | — | `test("[B21 F2b] F12 / D21-45:` | [B21 F2b] test 4: presented, rejected, stood down, resumed |
| C115 | `e2e-orchestration/specialist-orchestration.spec.ts` | 375 | — | `"rejected: nothing applied"` | [B21 F2b] the human rejects through the review's own Cancel - ONE new discard line, counted ([B21 F2b review, 2026-09-29] re-pinned: test 4's counts added lines above it) |
| C116 | `e2e-orchestration/specialist-orchestration.spec.ts` | 364 | — | `"the run stood down: its follow-up turn failed"` | [B21 F2b] the stand-down after the presentation ([B21 F2b review, 2026-09-29] re-pinned: test 4's counts added lines above it) |
| C117 | `e2e-orchestration/specialist-orchestration.spec.ts` | 406 | — | `"Orchestration: nothing from the specialists is presented for approval (already_presented): "` | [B21 F2b] the resume presents nothing again: the run log's `already_presented` line ([B21 F2b review, 2026-09-29] re-pinned: test 4's counts added lines above it) |
| C118 | `e2e-orchestration/specialist-orchestration.spec.ts` | 414 | — | `"one presentation across both requests"` | [B21 F2b] ONE presentation in all ([B21 F2b review, 2026-09-29] re-pinned: test 4's counts added lines above it) |
| C119 | `e2e-orchestration/specialist-orchestration.spec.ts` | 402 | — | `"every committed specialist replayed, none run again"` | [B21 F2b] the four committed specialists replayed ([B21 F2b review, 2026-09-29] re-pinned: test 4's counts added lines above it) |
| C120 | `app/api/chat/orchestration-runtime.ts` | 450 | — | `decision.outcome === "already_presented" ? "an earlier request of this run presented this user message` | [B21 F2b] the `already_presented` line the page renders (E3's ledger) |
| C121 | `app/lib/project/chat-run-view.ts` | 596 | — | `export const CHAT_RESUME_STAND_DOWN_REASONS = Object.freeze(["follow_up_failed"` | [B21 F2b] a failed follow-up is a stand-down the page offers a resume for |
| C122 | `app/api/chat/orchestration-runtime.ts` | 292 | — | `return standDown(down("follow_up_failed", ` | [B21 F2b] the runtime stands the run down when the follow-up turn fails |
| C123 | `app/lib/agent/loop.ts` | 767 | — | `provider_${error.reason}` | [B21 F2b] a provider error fails the turn `provider_<reason>`: `provider_overloaded` |
| C124 | `e2e-orchestration/specialist-orchestration.spec.ts` | 340 | — | `.and(page.locator('xpath=//*[not(ancestor-or-self::*[@role="status"])]'))` | [B21 F2b review, 2026-09-29] the chat's own lines, the transient toast excluded: every line an earlier test also renders is counted before and after (regressions-2, tests-2, tests-3) |
| C125 | `e2e-orchestration/specialist-orchestration.spec.ts` | 376 | — | `"the Cancel applied nothing: no applied line"` | [B21 F2b review, 2026-09-29] the Cancel applied nothing: no applied line appears (tests-3) |
| C126 | `e2e-orchestration/specialist-orchestration.spec.ts` | 343 | — | `specialistsDegraded: 1 })!;` | [B21 F2b review, 2026-09-29] the stood-down run's status line as literal counters: 4 scheduled, 4 finished, ONE degraded notice (tests-2) |
| C127 | `e2e-orchestration/specialist-orchestration.spec.ts` | 380 | — | `"the stood-down run's status line"` | [B21 F2b review, 2026-09-29] that status line, one new (regressions-2, tests-2) |
| C128 | `e2e-orchestration/specialist-orchestration.spec.ts` | 412 | — | `toHaveCount(resumedStatusBefore + 1);` | [B21 F2b review, 2026-09-29] the resumed run's status line `Specialists: 4 scheduled · 4 finished`, one new - test 2's does not satisfy it (regressions-2, tests-2) |
| C129 | `e2e-orchestration/specialist-orchestration.spec.ts` | 418 | — | `"nothing applied in all: no applied line"` | [B21 F2b review, 2026-09-29] no applied line in all, after the resume (tests-3) |
