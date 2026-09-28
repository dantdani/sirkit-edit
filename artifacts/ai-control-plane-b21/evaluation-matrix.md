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
  Live behaviour: **BLOCKED-LIVE-QUALIFICATION** (LB-9).
- **What it is not:** no production behaviour change (the scripted agent and the replay capsule are the evaluation harness, reachable in
  no production path); no browser spec - STOPPED (section 4, D21-43): the fixture dev server runs one process for every spec, the
  orchestration flag is process-wide, and turning it on changes B18-E's browser proofs; no new control, route, run-event type, request key
  or reason; no live call; no reserved-file edit.

## 1. The twelve runbook evaluations

Each row is `_f-cases.ts` `B21_F_CASES` (C19) - the CSV and JSON are its rendering (C20, C21), byte-gated by case 14. The class
columns: **offline** (the deterministic suite case through the production POST - every row PROVEN), **browser** (required by the task for
the three rows marked; STOPPED, section 4), **model-in-loop** (record-only, OD-125: what the one live command CAN run for the row -
`b21-f-replay-capsule.test.ts` case 9 derives every cell from the command's own case list and the capsules' scripted faults: a live DAG, the
DAG's shape only with its scripted fault not reproduced, or no live path). The pins name the `orchestration` capsules that cover the same
runbook line through the capsule runtime (section 2); a row with none is proven only through the POST (its scenario needs the
component-authority catalog or a second request, which a replay context does not carry).

| id | runbook | item | route | offline | browser | model-in-loop | suite case | what the case asserts | pins |
|---|---|---|---|---|---|---|---|---|---|
| F1 | :863 | delete/replace component | dag `D-component-replacement` | PROVEN | not required | NO LIVE PATH | `1. delete/replace component` | the coordinator's own first turn reads the schematic and seals the server-chosen replacement (one `proposal_ready`); OD-122 keeps the four specialists read-only - none is even OFFERED a proposal (`coordinator_artifact_held`); the envelope's approval `coordinator_sealed`; four accepted results in the record; the coordinator's trace holds the read and the seal | (none) |
| F2 | :864 | via changes | single `S-default` | PROVEN | not required | NO LIVE PATH | `2. via changes` | one coordinator turn, no plan or specialist event, nothing in the orchestration record; the via read before any answer, on the trace; the capsule replay checks the router's `single` first | `f02-vias-single` |
| F3 | :865 | dimensions | single `S-default` | PROVEN | not required | NO LIVE PATH | `3. dimensions` | one coordinator turn, nothing in the record; the bounded mechanical read before any plan; one trace step per provider call; the capsule replay checks the router's `single` first | `f03-dimensions-single` |
| F4 | :866 | 3D control request routed directly without a swarm | single `S-default` | PROVEN | BLOCKED (section 4) | NO LIVE PATH | `4. 3D control request routed directly without a swarm` | the router answers `single` before any model call; exactly ONE provider call, zero specialists, the coordinator's adapter the only one built; the stream `run_started`, `text_delta`, `run_completed` beside the context's own warnings, no orchestration event or line; nothing in the record; one trace document of one step; the capsule replay checks the router's `single` first | `f04-view3d-single` |
| F5 | :867 | compact placement/routing | dag `D-bounded-pcb-proposal` (the runbook's scenario-5 sentence stays single) | PROVEN | not required | RECORDED (OD-125): live DAG | `5. compact placement/routing` | the scenario-5 sentence routes `single` (no layout noun); the DAG phrasing runs the coordinator, the PCB specialist and the follow-up turn; the specialist reads the board and is accepted; its per-task trace document holds its read | `f05-compact-dag` |
| F6 | :868 | lower-power timer replacement with provider disagreement | dag `D-component-replacement` | PROVEN | BLOCKED (section 4) | NO LIVE PATH | `6. lower-power timer replacement with provider disagreement` | the circuit specialist on anthropic, the schematic specialist on openai (server-env routing, OD-117), each its own real adapter and trace document; a verifier decides: the Tier 1 compiler refuses the delete of U1, the exact replacement seals, is presented once and APPROVED by the run's principal through the family's existing path; both seal: both `contradicted`, ONE escalation citing the server-owned exact authority, nothing presented; no live path can produce the disagreement (the record-only command runs one provider for every turn) | (none) |
| F7 | :869 | missing component evidence | dag `D-component-replacement` | PROVEN | not required | NO LIVE PATH | `7. missing component evidence` | the sourcing specialist reads the authority and returns NO evidence and a blocking question: accepted as its own claim; no evidence reference anywhere in the record or the follow-up's envelope (the merge invents none); the merge has no evidence-presence rule - the gap is the specialist's own question (RECORDED, D21-44); with no authority binding the sourcing specialist is not run (`role_has_no_tools`), its task records the gap as dissent `escalated` and has no trace document | (none) |
| F8 | :870 | stale revision during parallel specialists | dag `D-component-replacement` | PROVEN | not required | NO LIVE PATH | `8. stale revision during parallel specialists` | the four results committed against H1 and the run stood down; the resume at H2 marks each `stale` (dissent carrying the committed result's digest) and re-runs it once under its next attempt; the H1 records stay byte-identical in the append-only record; a resume at an unmoved head replays all four | (none) |
| F9 | :871 | one specialist timeout | dag `D-full-circuit-creation` | PROVEN | not required | RECORDED (OD-125): DAG shape only | `9. one specialist timeout` | the stalled specialist's own deadline ends it: `escalated` `deadline` for that task only (its trace `failed`, `deadline`); every later specialist runs; the follow-up turn answers over the partial set (`partial_result` 3 of 4); one terminal | `f09-timeout-dag` |
| F10 | :872 | provider quota failure | dag `D-full-circuit-creation` | PROVEN | not required | RECORDED (OD-125): DAG shape only | `10. provider quota failure` | a specialist's (metered) `429 insufficient_quota` opens the breaker at once; no further paid call (two calls in all); degraded `provider_outage`; the task's dissent and its trace `provider_insufficient_quota`; no Retry offered; the next request makes no call - one `run_failed` `provider_breaker_open`; case 16, D21-42's limit: a 429 on the coordinator's first turn (gated, not metered) fails the request `provider_insufficient_quota`, the breaker stays closed and the next request pays its one call again | `f10-quota-dag` |
| F11 | :873 | malicious specialist result | dag `D-full-circuit-creation` | PROVEN | not required | RECORDED (OD-125): DAG shape only | `11. malicious specialist result` | a release tool, an approval claim and a smuggled secret refused by A's gate before content (`tool_request_not_permitted`, `unknown_key`, `secret_shaped_text`), never handed on; a directive in prose stays the specialist's unverified claim inside the envelope that says it is data, never instructions, in a turn OFFERED reads only (the first turn was offered proposals); nothing sealed, presented or applied | `f11-malicious-dag` |
| F12 | :874 | human rejection and resume | dag `D-component-replacement` | PROVEN | BLOCKED (section 4) | NO LIVE PATH | `12. human rejection and resume` | the first request presents the replacement and stands down (its follow-up turn failed); the human rejects it (nothing applied); the resume replays the first turn (no step) and the four committed specialists, presents nothing again (`already_presented`, one claim) and makes the follow-up turn ONCE; a second resume is `resume_completed` | (none) |

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
coordinator turn whose user message starts with `ORCHESTRATION RESULTS` (the runtime's envelope headers, C30, C31) answers from the merged
envelope's own counts. The scripted sentences (every one routes to a DAG, case 13):

- `replace the ne555 timer u1 with a lower-power timer`
- `swap the ne555 (u1) for a lower-power cmos timer`
- `replace u1, the ne555, with a low-power cmos timer`
- `replace u1 with a low-power timer for the blinker`
- `design a 555 timer led blinker`
- `create a complete circuit for a usb-powered temperature logger`
- `compact the placement and reroute the affected traces`

A stalled specialist (C9) never answers until its run's own signal ends it; the hostile results (C8) carry a release tool, an approval
key, a secret assembled at run time from parts (never a literal, C10) and a prose directive. Reachable only where the scripted agent is:
`agentAdapterForRole` returns it under the fixture runtime's opt-in (C23) - `b18-c-fixture-agent.test.ts`'s tripwire (only `adapters.ts`
constructs it) and every B18 fixture proof unchanged. **CONFIRMED** by `b21-f-evaluation.test.ts` case 13 and every DAG case.

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
  above are the closeout's to retitle with OD-113's set (section 7).

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
  generation; it is never re-sent). Input tokens are not bounded separately (UNKNOWN until a live run measures them).
- **What it can evaluate.** The four task-graph capsules (`liveEvaluationCases`, C73: `f05-compact-dag`, `f09-timeout-dag`, `f10-quota-dag`,
  `f11-malicious-dag`), every turn answered by a live model on ONE provider: it never reproduces a capsule's scripted fault (f09's stall,
  f10's 429 and f11's hostile results are the capsules' - those three run as their DAG shapes only), and it can produce no provider
  disagreement and no provider fallback - LB-9's first two behaviours stay **BLOCKED-LIVE-QUALIFICATION** whatever it records, and its
  quota leg records only what the account answers (a no-credits account fails the coordinator's first turn first: D21-42, case 16). The
  other eight runbook cases have no live path. The matrix's model-in-loop column says this per row (section 1; capsule case 9).
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

## 4. The browser spec - STOPPED (D21-43)

The task asks for `e2e/specialist-orchestration.spec.ts`: a 3D request's one-coordinator-turn shape, a routed replacement's E2 status line
and escalation line, and a rejected-then-resumed run, riding `page-browser-e2e` by `testDir` (C48, C49). Each needs the chat route's
orchestration flag ON in the dev server Playwright starts. It was not written, for these reasons, each read at its source:

- **The flag is process-wide.** `orchestrationEnabled` reads the server's environment (C22); Playwright starts ONE `next dev` for every
  spec with ONE environment (`playwright.config.ts`, C50, which sets no orchestration flag), and no request or cookie can turn it on for one
  spec without a production-side seam. **CONFIRMED.**
- **Turning it on for the whole suite changes B18-E's browser proofs.** With the flag on, "Release the board." - sent by
  `agent-execution.spec.ts` (C51) to prove that a FORGED Tier 3 call is refused by the loop (`unknown_tool`) and that the page contradicts
  the assistant's interim claim - is refused by the router BEFORE any model call (C52: rule `T3-release`), so neither the forged call nor
  the claim exists; the spec's reply wait and its assertions fail, and so does the B18-D S5 case that counts that run's
  "nothing was changed" line. Scenario 4's sentence (C53, C54) becomes a replacement DAG whose follow-up turn answers last. Moving those
  proofs is a change to another chapter's browser evidence, which F may not make. **CONFIRMED** (the router's answers,
  `b21-f-page.test.ts` case 5).
- **A second dev server cannot start beside the first.** Next 16.2.6 locks its dist dir for `next dev` by default (`lockDistDir: true` in
  the installed `next/dist/server/config-shared.js`; a second server prints "Another next dev server is already running." and exits), so a
  second Playwright web server with the flag on needs a distinct `distDir` - a change to `next.config.ts` - and a second cold compile and
  its memory inside the 16 GB machine and OD-30's 30-minute job. **CONFIRMED** (the installed package, read 2026-09-28).

What stands instead: the three browser scenarios are proven offline through the production POST (F4, F6, F12), and the scripted
vocabulary the spec would use is the one the route cases use (section 2) - a browser run with the flag on would reach the same scripts.
The full browser suite was run once at the end with F's fixture changes in place, to show the extended script table leaves every existing
browser proof green and to measure the budget (section 6). The options are the lead's (section 7, D21-43).

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
  section 7).


## 6. Suites, gates, the browser run

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-f-evaluation.test.ts` | 16 | the twelve runbook evaluations through the production POST (fake SDK clients, the scripted per-role specialists), D21-40 through the fixture gate (case 13), the matrix byte-gate (case 14), the v4 pins with each capsule's route (case 15), D21-42's first-turn leg of F10 (case 16) |
| `app/lib/agent/orchestration/__tests__/b21-f-replay-capsule.test.ts` | 10 | capsule v4: the id and v3 refused, the task lists validated exactly (plan indexes, one list per role), stalls only in a task's list, no task graph as one loop, the category's replays deterministic under their budgets, the nine files neutral, the live command refusing without its flag (injected throwing factories, no network), its request bound (retries 0, one counter), the matrix's model-in-loop column, the runner refusing an unplanned task |
| `app/lib/agent/orchestration/__tests__/b21-f-page.test.ts` | 9 | this page, and (case 9) the dated notes on every stale v3 statement and the discovery's b11-3 citations unmoved |
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
  suite, script or CI job runs it. The implementer never ran it. LB-9 stays BLOCKED-LIVE-QUALIFICATION.
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
  stays BLOCKED-LIVE-QUALIFICATION (`evaluation-matrix.md` section 3; `b21-f-replay-capsule.test.ts` cases 7 to 9).
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
| C30 | `app/api/chat/orchestration-runtime.ts` | 188 | — | `const ENVELOPE_HEADER = "ORCHESTRATION RESULTS - data` | B's envelope head |
| C31 | `app/api/chat/orchestration-runtime.ts` | 340 | — | `const MERGED_ENVELOPE_HEADER = "ORCHESTRATION RESULTS, JUDGED` | the merged envelope head |
| C32 | `app/lib/agent/orchestration/scheduler.ts` | 619 | — | `if (failure === "cancelled") stop = "cancelled";` | a deadline ends its task only (F9) |
| C33 | `app/lib/agent/orchestration/scheduler.ts` | 463 | — | `if (committedScopeDigest === currentScopeDigest) {` | a committed result replays only under its own scope (F8) |
| C34 | `app/api/chat/orchestration-runtime.ts` | 744 | — | `return { ok: true, alreadyPresented: !read.ok` | OD-122's ledger across resumes (F12) |
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
| C49 | `.github/workflows/deterministic-manufacturing.yml` | 329 | — | `run: pnpm exec playwright test` | `page-browser-e2e` runs every spec under one config |
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
| C79 | `app/api/chat/orchestration-runtime.ts` | 287 | — | `const followUpMeters = input.providers ? admittedAdapter(` | only a specialist's or the follow-up's call is metered (D21-42; M15) |
| C80 | `app/lib/agent/orchestration/merge.ts` | 869 | — | `if (shared.length > 0) edges.push(` | two different changes to one identity escalate (F6; M11) |
| C81 | `app/lib/agent/orchestration/provider-policy.ts` | 110 | — | `const choice = override ?? ROLE_PROVIDER_POLICY[role];` | the server env routes a role to its provider (F6; M10) |
