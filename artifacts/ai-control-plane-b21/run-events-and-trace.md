# B21-E2 — the additive run events, the status line and the trace block (E2's first run: the events delivered, the trace block stopped; E2's second run: the trace block applied)

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `3a32317` (the B21-D3 follow-up commit, after B21-E1 `deac588`); written 2026-09-27. This is
a NEW page for B21-E2's first run (items 1 and 2 of the lead's E2 task); `provider-routing-and-failure.md` keeps the E1 sections only (its
suite pins its ten headings), with a dated pointer here. The route-level resume, the composer's routing and the first-turn breaker are
B21-E3's (a later run) [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): the resume landed in B21-E3 (`route-resume.md`), the composer's routing and the first-turn breaker in B21-E4 (`composer-and-first-turn.md`)]. Every `[B21 E2]` statement below is pinned by `b21-e2-page.test.ts` (the event table IS
`ORCHESTRATION_RUN_EVENT_TYPES` with `RUN_EVENT_KEYS`; the statuses, the degraded reasons and the traced types ARE the code's lists; the
status line quoted IS `orchestrationStatusLine`'s; the bounds ARE `RUN_EVENT_BOUNDS`; every citation resolves by content exactly once
and, for every file E2 changed, on the line it states; every suite row carries its real `it(` count) or by the suite it names. No model
is called in any E2 suite: the scheduler suites run the REAL scheduler, loop, gateway and production registry over scripted adapters,
the provider-layer cases the REAL adapters over in-process fake clients, the route suite the production POST with the B21-B scripted
double. [B21 E2 fix, 2026-09-27] The adversarial review's 13 confirmed findings are fixed test-first on this page (section 5, "The
review's findings"); every `[B21 E2 fix: <id>]` statement names the finding it answers. [B21 E2b, 2026-09-27] E2's second run applied
the trace block under the lead's reading of OD-112 (section 3, from 3.2; its texts for the lead at the end of section 6; its citations
C67 onward); every `[B21 E2b]` statement is pinned by `b21-e2b-page.test.ts` or by the suite it names. [B21 E2b fix, 2026-09-27] The
adversarial review's 13 confirmed findings on E2's second run are answered test-first (section 5, "The review's findings (E2b)"; its
citations C97 onward); every `[B21 E2b fix: <id>]` statement names the finding it answers.

## 0. What E2's first run delivers, and where it stopped

Why (runbook B21-E, `discovery.md` §7): "visible partial-result and degraded-mode reporting" on "additive run events and a durable
record, not on provider features" (D21-22), and OD-112's trace block (D21-11's trace half, D21-3's calls).

- **The additive v1 run events (OD-126, D21-22; section 1).** A PINNED list of five - `plan`, `specialist_started`,
  `specialist_finished`, `partial_result`, `degraded` (C2) - each a CLOSED shape (C5, exactly its keys: task id, role, provider, model,
  attempt, status or reason, the budget remaining, all bounded, C7, C8), built by one module (`run-events.ts`, C10-C16, C52) and judged
  by one rule (C17). The scheduler and the runtime emit them IN PLACE of B21-B's warning lines for the plan, a specialist's status and
  the degraded and stand-down facts, each carrying B's own sentence as its `message` (so the run log reads as before, and the
  coordinator's trace records the lines it recorded at HEAD, C9, C29, with the two differences section 1 names); a specialist's refused
  tool call, a merge line and an approval line stay warnings (C25, C36). Three facts are new: `specialist_started` (one per attempt that
  reaches the provider layer, with the budget remaining, C24), `partial_result` (a run whose planned specialists did not all deliver a
  result the merge could use, C35, C60) and the closing `specialist_finished` of a re-run the scheduler promised and withheld (C52-C55).
  Protocol version 1 stands (C45, C46); the chat protocol's closed union is widened in place (C1); the one-terminal rule and the flag-off
  byte identity stand - and an OLDER v1 page loses the lines these events carry (RECORDED, OD-126's owner question, section 2).
  **CONFIRMED** by `b21-e2-run-events.test.ts` (16 cases) and the route suite (7).
- **The run view: pure counters and ONE status line (OD-127; section 2).** `reduceRunView` gains pure counters (scheduled, finished by a
  task's final outcome, degraded notices, the partial result, C38, C39, C63) and `projectRunView` one additive field, the status line (C40,
  C41); the page renders each event as a run-log line (its own sentence) and the status line once, before the notes - two in-place
  lines, no control (C43, C44). An older reducer ignores the events. **CONFIRMED** by `b21-e2-run-view.test.ts` (7 cases), the route
  suite's cases 3 and 7, the B17-A control inventory (regenerated with zero drift: 628 controls) and the B18-D UI gates (no wire added).
- **The trace block (OD-112; section 3): STOPPED under the task's stop condition.** One trace document per specialist task with its own
  run id `<runId>:<taskId>` cannot be accepted by the UNCHANGED v1 trace contract: every task id is `task-<n>-<role>` (C28), and the
  redaction authority's unanchored OpenAI-key pattern (C48), which the trace validator applies to every string of a trace (C47), matches
  its `sk-<n>-<role>` - the recorder then classifies `trace_validation_failure` and hands the document to no sink (C50). Accepting it
  needs an edit to a scanned file or a narrowing of the shared redaction rule, both outside this run's authority. **CONFIRMED** (a probe
  through the real recorder and validator, section 3). The finding is D21-41; the implementation that stopped is held intact for the
  lead (section 3), none of it in the tree. [B21 E2b, 2026-09-27] Applied by E2's second run under the lead's reading (the next bullet).
- **The trace block (OD-112 as the lead read it; section 3.2 onward): APPLIED by E2's second run (B21-E2 2/2).** One trace document per
  specialist task, its run id `<runId>:<n>-<role>` - the coordinator's run id, a colon, the task's INDEX and role - and the closed block
  `{ taskIndex, role, providerId, modelId, parentRunId, decision? }` on every step and tool invocation of it, never the literal task id
  (which the unchanged v1 validator still reads as a key: D21-41 closed with no rule narrowed); ONE rule for the validator and the
  cascade (the B20-A4 `external` precedent's shape); the specialist's tool calls on its own durable trace record beside the orchestration
  run's (D21-3's calls; D21-11's trace half); the 256-event cap per document; a retry on ONE provider in one document with one
  terminal ([B21 E2b fix] an attempt on another provider opens the task's next document); a document that cannot be recorded one
  visible warning line, whole on the coordinator's trace; [B21 E2b fix] a call refused before it ran one closed line on its task's
  document, no control, format or separator character or lone surrogate in a stored document, the record bound to its scope; no
  string of a per-task trace holding `task-<n>-`; the nine scanned files and `redaction.ts` byte-identical. **CONFIRMED** by
  `b21-e2b-trace-attribution.test.ts` (16 cases), `b21-e2b-task-identity.test.ts` (3) and the route suite's cases 8 to 10.

What E2's first run is NOT: section 4.

## 1. The additive v1 run events (OD-126, D21-22)

**The pinned list and the closed shapes** (C2, C5, C8). Each event is exactly these keys (the builders write them in this order and the
judge refuses anything else):

| event | keys | emitted by |
|---|---|---|
| `plan` | `type`, `runId`, `rule`, `tasks`, `scheduled`, `notRun`, `parallelism`, `wallTimeMs`, `outputTokenCeiling`, `message` | the scheduler, once, before the first task (C19) |
| `specialist_started` | `type`, `runId`, `taskId`, `role`, `provider`, `model`, `attempt`, `wallTimeRemainingMs`, `outputTokensRemaining`, `message` | the scheduler, per attempt that reaches the provider layer, with the budget remaining (C24, C64) |
| `specialist_finished` | `type`, `runId`, `taskId`, `role`, `provider`, `model`, `attempt`, `status`, `reason`, `resultDigest`, `runsAgain`, `message` | the scheduler, per attempt outcome, a replay, a stale committed result (C21, C26) and the closing event of a withheld re-run (C52-C55) |
| `partial_result` | `type`, `runId`, `planned`, `usable`, `unusable`, `mergeWithheld`, `notStarted`, `handedOn`, `message` | the runtime, once, when the planned specialists did not all deliver a result the merge could use (C30, C35, C37, C60) |
| `degraded` | `type`, `runId`, `reason`, `taskId`, `role`, `provider`, `model`, `message` | the scheduler (a role with no tools, a fallback, the coordinator's paused provider, the held artifact) and the runtime (every stand-down) |

`role` is a specialist role (never the coordinator); `provider` / `model` name what served the attempt (the route's provider; the model
the provider reported, or the route's model at start), never a secret - and ([B21 E2 fix: coverage-2]) `provider` is null, with
`model`, on a `replayed` or `stale` result, whose provenance the record does not keep (the merge's `UNRECORDED_SOURCE`, provider null,
C61): the judge requires null there and a provider everywhere else (C62). `attempt` is the task attempt; `runsAgain` says the scheduler
will run the task again (a retry, or a stale committed result) - and ([B21 E2 fix: regressions-1, coverage-6]) a promise it then
withholds (the DAG wall time, the coordinator's paused provider or a record failure stopping it first) is CLOSED by one final
`specialist_finished` for that task: the same attempt and outcome, `runsAgain` false, its line saying the task was not run again
(`<stop>`) (`notRunAgainEvent`, C52; the scheduler's `settle`, C53-C55), so every `runsAgain: true` is followed by a later
`specialist_finished` for its task. `wallTimeRemainingMs` / `outputTokensRemaining` on `specialist_started` ([B21 E2 fix: coverage-5])
are the budget remaining when the attempt reaches its provider: the DAG wall time left and the output-token ceiling not yet used
(reported, never priced or enforced, OD-107). `mergeWithheld` on `partial_result` ([B21 E2 fix: security-1]) counts the results the
scheduler accepted and the deterministic merge withheld (judged malformed, stale, expired or contradicted, C60) - never usable; null
when no merge judged them (a stand-down before the merge, or a merge that could not record). A task is counted ONCE (a task listed not
started that also has an outcome - a withheld retry - is counted by its outcome, C65) and `planned` is the plan's task count; the judge
refuses parts that exceed it. The statuses of `specialist_finished` (C3): `accepted`, `malformed`, `escalated`, `replayed`, `stale`. The
bounds (C7): a message at most 1 500 characters and a reason at most 1 000, each through the model-bound redactor with every control,
format and separator character a space (C10) - the model-bound redactor, because the diagnostics' unanchored key pattern would read every
task id as a key (section 3); a model id at most 100 characters; counts bounded. A `reason` is the scheduler's dissent reason, server
text, with ONE model-chosen part withheld ([B21 E2 fix: security-2]; [B21 E2 lead] generalized): A's refusal names the PATH it refused
(`result_refused: <code> at <path>`), and a path can run through a key the model chose - an undeclared key, a reasoning-shaped key
name A refuses (`forbidden_key_name`), a key inside an artifact's payload - so a path made only of the documents' DECLARED key names
and array indices (`SPECIALIST_DECLARED_KEYS`, appended to `contracts.ts`) is kept, and any other path is replaced whole by
`UNDECLARED_KEY_WITHHELD` in the event's `reason` and its line (C56, C57; run-events case 16, which failed first on the
undeclared-key-only rule); the durable record's dissent reason keeps A's path, as it has since B21-E1
(RECORDED). `model` is the id the provider reported: provider text, bounded and clean - display data, never authority. The judge (C17)
never throws on a hostile object and refuses an unknown type, an extra or missing key, the coordinator as a specialist, another provider,
a provider named for an unrecorded provenance, a status or reason outside its vocabulary, a control character, a key-shaped value, an
unbounded count, a partial result that is not partial or whose parts exceed the plan, and a task named without its role.

**The degraded reasons** (C4), every one a visible run-log line:

| reason | the fact | from |
|---|---|---|
| `role_has_no_tools` | a planned specialist not run: its tools and the run's reads have nothing in common (never scheduled) | the scheduler (C20) |
| `compatible_fallback` | a specialist runs on the other provider (OD-117), naming the provider and model it runs on | the scheduler (C23) |
| `coordinator_artifact_held` | the coordinator's own turn holds the run's artifact (OD-122): the specialists read only | the scheduler (C19) |
| `provider_paused` | the coordinator's provider is paused by the llm-provider meters (OD-115): no further call | the scheduler (C22) and the runtime's stand-down |
| `provider_outage` | the coordinator's provider failed during the specialists | the runtime's stand-down (C33) |
| `no_specialist_ran` | the scheduler refused the plan | the runtime's stand-down (C32) |
| `no_usable_result` | nothing usable to hand on | the runtime's stand-down |
| `merge_unrecorded` | the merge could not record its decisions | the runtime's stand-down |
| `follow_up_paused` | no follow-up turn: its provider is paused | the runtime's stand-down |
| `follow_up_failed` | the follow-up turn did not complete | the runtime's stand-down (C34) |

**B21-B's lines, as the stream now carries them** (each event's `message` IS the line; the refusal, merge and approval lines stay
warnings):

| B21-B's line (its opening) | now |
|---|---|
| `Orchestration: <n> specialist(s) scheduled after this turn` | `plan` |
| `Orchestration: specialist <role> accepted` / `malformed` / `escalated` / `not run (<code>` / `replayed from the record` | `specialist_finished` |
| `Orchestration: specialist <role> committed result (...) is STALE` | `specialist_finished` (`stale`, runs again) |
| (new) `Orchestration: specialist <role> (task <id>) was not run again (<stop>)` | `specialist_finished` (the closing event of a withheld re-run) |
| `Orchestration: specialist <role> not run (role_has_no_tools` | `degraded` (`role_has_no_tools`) |
| `Orchestration: specialist <role> (task <id>) runs on <provider> (<model>) instead of` | `degraded` (`compatible_fallback`) |
| `Orchestration: <n> specialist(s) not started and no follow-up turn can run` | `degraded` (`provider_paused`) |
| `Orchestration: the coordinator's own turn already handed the human an artifact` | `degraded` (`coordinator_artifact_held`) |
| `Orchestration: no specialist ran` / `the provider failed during the specialists` / `the coordinator's LLM provider is paused` / `no specialist result to hand on` / `the merge could not record` / `no follow-up turn was made` / `the follow-up coordinator turn did not complete` | `degraded` (the stand-down reasons) |
| `Orchestration: specialist <role> (task <id>, attempt <n>) tool <id> refused: <status>` | `warning` (unchanged) |
| a merge line, `Orchestration: presented for approval` / `nothing from the specialists is presented` | `warning` (unchanged) |

**The coordinator's trace is what it was at HEAD** (C9, C29), with two recorded differences ([B21 E2 fix]): the closing line of a withheld
re-run (a line HEAD never wrote - its stream left the promise open) and an undeclared key's model-chosen name withheld from a refused
result's line: the runtime records the message of a `plan`, `specialist_finished` or `degraded` event exactly as it recorded the warning
it replaces - the first `ORCHESTRATION_TRACE_LINES_MAX` (12) status lines (events and refusal warnings on ONE budget, in stream order)
and every stand-down line, within the recorder's 32-warning bound - while `specialist_started` and `partial_result`, which replace no B
line, are stream-only. **CONFIRMED** (route case 1: the route's sink receives ONE trace, the coordinator's, holding those lines, the
record's history unchanged; [B21 E2 fix: tests-3] route case 6: more than fourteen orchestration lines before a stand-down - the trace holds
exactly the first twelve and the stand-down line past the cap, never a started or partial-result line; breakages m3 and m4 fail it).

**Protocol version 1, one terminal, flag off identical** (C45, C46). Every event rides the v1 envelope `{ v: 1, runId, seq, ... }`; no
event is a terminal and none collides with HEAD's fourteen types; the stream still has one `run_started` and ONE terminal, last; with
the flag off the four recorded streams are HEAD's byte for byte (B21-B's recordings; [B21 E2 fix: tests-7] the case sets the flag off
itself, never trusting the shell). **CONFIRMED** (run-events case 1; route cases 1, 4 and 5).

## 2. The run view: pure counters and one status line (OD-127)

`reduceRunView` (C38) gains `orchestrated`, `specialistsScheduled` (the plan's `scheduled`), `specialistsFinished` (a task by its FINAL
outcome, C39: an outcome event with `runsAgain` false that is not `stale` - [B21 E2 fix: tests-2, coverage-6] a withheld retry is
counted once by its closing event, a stale result never run again is not finished, the partial result counting it not started),
`specialistsDegraded` (the degraded NOTICES, run-wide or of one specialist - the log's own count: a stand-down after the scheduler's
paused line is two notices, by design) and `partialResult` (usable of planned) - display only, never authority; a forged count
(negative, fractional, huge) is ignored. The fold is appended to the file (C63; the reducer's `default` hands it the five, C38), so
every line the discovery cites in `chat-run-view.ts` holds what it held at the base ([B21 E2 fix: tests-5], page case 10).
`projectRunView` gains ONE field, `status` (C41): null for every run that carried no orchestration event (every single-agent run is
unchanged), otherwise the one line (C40), for instance, with three scheduled, three finished, one degraded notice and three of four
usable:

`Specialists: 3 scheduled · 3 finished · degraded mode (1 notice in the log above) · partial result: 3 of 4 usable`

**An older reducer ignores the events**: they change none of the answer, the notes, the label, the history or the failure (a stream
with and without them projects identically but for `status`), and the page's pre-E2 switch has no case for them - they reach its
`default`, where HEAD wrote nothing. **So an older v1 page LOSES lines** ([B21 E2 fix: coverage-3, tests-4], RECORDED as OD-126's
owner question): a tab still running the pre-E2 bundle against this server renders the refusal, merge and approval warnings but none of
the plan, status or stand-down lines it rendered at HEAD - they now arrive as types its `default` drops, so degraded mode is silent
THERE, and protocol version 1 cannot tell it (run-view case 6 folds both streams and names exactly the lines lost). The page and the
route ship together and the DAG sits behind the off-by-default flag, so the case needs a version skew with the flag on; the owner's
options are in OD-126 (section 6). **The page gains no control**: the default branch renders the event's own sentence as a run-log row
through the existing step (C43; "running" for a started specialist, settled by the next row), and the status line is written once,
before the notes (C44) - two in-place lines, no JSX, no handler, no `disabled` (the control markup counts are HEAD's; the B17-A inventory
regenerated with zero drift; the B18-D UI gates' wires untouched; no file under `app/components/chat` touched). **CONFIRMED** (run-view
cases 1 to 7; route case 3 folds the real stream, route case 7 the merge-withheld one).

## 3. The trace block (OD-112): STOPPED - D21-41, then APPLIED (B21-E2 2/2)

### 3.1 The stop, as E2's first run recorded it

[B21 E2b, 2026-09-27] This subsection is E2's first run's record, kept whole. E2's second run applied the block under the lead's reading
of OD-112 (3.2 to 3.7): D21-41's finding stands (the literal task id is still refused, 3.2), its consequence does not.

**What was asked.** A new module `app/lib/agent/orchestration/trace-attribution.ts` with an optional closed `orchestration` block
`{ taskId, role, providerId, modelId, parentRunId, decision? }`, pattern-bound and denylist-checked, attached to the step and tool events
of ONE trace document PER SPECIALIST TASK - its own run id `<runId>:<taskId>`, its parent the coordinator's run - so the 256-event cap is
per document and the specialist's tool calls are persisted on its own trace record; the nine scanned files untouched; "STOP and report -
never weaken a pin - if the trace block cannot be accepted without editing one of the nine scanned files".

**What stops it.** The per-task document's mandated run id is refused by the UNCHANGED v1 trace contract. The scheduler's task ids are
`task-<n>-<role>` (C28) and a specialist's run id is `<coordinatorRunId>:<taskId>` (C27); the redaction authority keeps an UNANCHORED
OpenAI-key pattern for diagnostics (C48, `sk-` followed by eight or more key characters - B19-D anchored it for model-bound text only,
C49), and the trace validator scans every string of a document with it (C47) - so `task-1-circuit-topology` reads as the key
`sk-1-circuit-topology`. The recorder classifies the document `trace_validation_failure` and hands it to no sink (C50); the same
pattern already renders every task id in the coordinator's trace warnings as `ta[redacted]` (at HEAD, since B21-B). The probe - the
REAL `AgentTraceRecorder` and `validateAgentRunTrace`, a run id of the route's own shape, 2026-09-27 - **CONFIRMED**:

| run id | the v1 validator | recorder diagnostics |
|---|---|---|
| `run-7f7c3c52-0d0b-4d8e-9a57-6c1b3b0d8e11:task-1-circuit-topology` | `trace.runId: contains secret-shaped content` | `trace_validation_failure` |
| `run-7f7c3c52-0d0b-4d8e-9a57-6c1b3b0d8e11:task-3-schematic` | `trace.runId: contains secret-shaped content` | `trace_validation_failure` |
| `run-7f7c3c52-0d0b-4d8e-9a57-6c1b3b0d8e11` | (valid) | (none) |

Every way through is outside this run's authority: editing the validator's scan (a scanned file: forbidden, D21-27 / OD-113);
anchoring the diagnostics' key pattern in `redaction.ts` (not a scanned file, but it narrows a shared secret check the chapter may not
weaken on its own - B19-D kept the diagnostics unanchored on purpose); a per-task run id other than `<runId>:<taskId>` (a deviation from
OD-112's wording); or a task-id grammar without `task-` (every B21 record key, suite and page moves). **D21-41** records it (section 6)
with the options; the lead or the owner decides.

**What was built and is HELD, not in the tree** (the scratchpad `b21/e2/trace-block-held/`, sha256 in `held.sha256`): the module (the
block and its ONE rule shared by the validator and the attribution cascade - the B20-A4 `external` precedent's shape; the orchestration
trace document carrying an unchanged v1 trace plus a block per step and tool invocation by sequence number; the durable trace record
`agent.orchestration-trace.v1` beside the orchestration run's on the same repository, reached through the record's own store; the book
that wraps the injected loop so a specialist records into its task's own document, its terminal held across a retry, closed by the
task's final `specialist_finished` with the scheduler's verdict), its suite (8 cases), the runtime's and the record's wiring and the
route case, and the probe with its log. Before the stop its suite passed cases 1 (the block and its rule) and 8 (the nine scanned files
byte-identical to HEAD, the v1 contract refusing a block placed INSIDE an event) and failed cases 2 to 7 on exactly this refusal (their
fixtures build run ids of the route's shape) - the held code is otherwise **UNVERIFIED**. The events of section 1 need none of it:
`specialist_started` and `specialist_finished` are the hooks the book reads. [B21 E2b, 2026-09-27] Applied, adapted and verified by E2's
second run (3.2 to 3.7): the held files' sha256 verified before use, the run id and the block moved to the task's index and role, and the
book closing each document with its task's last outcome once the scheduler returns (3.4: the runtime line that streams the events, C31,
is untouched).

### 3.2 The lead's reading of OD-112 (D21-41) [B21 E2b]

The lead's decision (discovery section 10, "B21-E2, run 1 of 2"): neither narrowing the diagnostics' key pattern (option A - B19-D kept
it unanchored on purpose) nor editing a scanned file (option D). Option B as E2's first run drafted it would still fail, because the v1
validator scans EVERY string of a trace, so a block carrying the literal task id `task-<n>-<role>` is refused like the run id. The lead's
reading, applied here: (1) the per-task trace document's run id is `<runId>:<n>-<role>` - the coordinator's run id, a colon, the task's
INDEX and role (C72) - and its `parentRunId` is the coordinator's run id; (2) the block carries the task's INDEX (a positive integer) and
its role, never the literal task id, beside `providerId`, `modelId`, `parentRunId` and the optional `decision`; the task id
`task-<n>-<role>` is reconstructed from index and role (`specialistTaskId`, C70, 3.3) and every scheduler task id round-trips
(`b21-e2b-task-identity.test.ts` case 1); (3) no string of a per-task trace holds `task-<index>-` (3.6). So no string of the trace reads
as a key and no rule is narrowed: through the REAL recorder and validator the literal run id `<runId>:<taskId>` is still
`trace_validation_failure` for every task of every DAG, and the index-and-role run id validates with no diagnostic (case 2); the
coordinator trace's task ids keep reading `ta[redacted]` (its lines are diagnostics under the unanchored rule - RECORDED, the lead's
decision; option A would make them legible and is the owner's). **CONFIRMED**.

### 3.3 The block, its one rule and the task identity

The block (`app/lib/agent/orchestration/trace-attribution.ts`, a NEW module outside the nine scanned files), closed: the five keys below
required, `decision` optional (C67), attached to `step` and `tool_invocation` only; the index bound is `MAX_TASK_INDEX` (32), the plan
record's bound on its tasks (C69):

| key | value | the rule |
|---|---|---|
| `taskIndex` | the task's index in the plan (`planTasks`' n) | a safe integer 1..32 - never the task id |
| `role` | the task's specialist role | one of the eight specialist roles, never `coordinator` |
| `providerId` | the provider the task's attempt ran on | `openai` or `anthropic`, and the trace's own provider |
| `modelId` | the step's model (a tool invocation: the model of the step that asked for it) | at most 100 characters, no control, format or separator character and no lone surrogate (a `?` in its place), not key-shaped |
| `parentRunId` | the coordinator's run id | the orchestration id grammar and the v1 trace's own secret rule (C74) |
| `decision` | the scheduler's verdict on the task's last outcome, on the last attributed event of the task's last document only (a document with no step or tool invocation, or closed at a provider switch, carries none: 3.4) | one of `accepted`, `malformed`, `escalated` (C68; inside OD-114's vocabulary) |

ONE rule, two callers - the B20-A4 `external` precedent's shape: `orchestrationBlockIssue` (C75) judges a block; the validator
`validateOrchestrationTrace` (C78) and the cascade `attributeSpecialistTrace` (C79) both use it, so the cascade never builds a block the
validator refuses. The document is `sirkit.orchestration-trace.v1` with exactly `schema`, `trace`, `attribution`: an UNCHANGED v1 trace
and one `{ seq, orchestration }` entry per step and tool invocation - the block rides BESIDE the events, since the v1 contract refuses an
unknown key inside an event (`b21-e2b-trace-attribution.test.ts` case 8). The validator captures the document, runs the trace's OWN v1
validator over the embedded trace, requires its run id to be `<parentRunId>:<n>-<role>` (C76), passes the attribution through the
trace's secret rule (C77), [B21 E2b fix: security-1] passes every key and string of the WHOLE document - the embedded trace included -
through the trace's string rule (`forbiddenTextPath`, C98, C103: no control, format or separator character and no lone
surrogate, `TEXT_FORBIDDEN`, C97 - stricter than the orchestration record's rule, which admits TAB and LF [B21 E2b lead]; the v1 validator checks a trace's strings for length and secret shape only), and requires every
step and tool invocation attributed exactly once and nothing else, each block naming the
run id's task (index, role, parent), the trace's provider and its step's model, and the decision on the last attributed event only; it
never throws on a hostile object. The cascade refuses an identity the rule refuses or one that is not the task of the trace's run id
(`identity_invalid`, C80) and a trace the v1 validator refuses (`trace_invalid` - a trace recorded under the literal `<runId>:<taskId>`
among them), drops a decision outside the three or with no event to carry it (`normalized`), [B21 E2b fix: security-1] replaces every
control, format or separator character and every lone surrogate of every string of the finalized trace with a `?` and adds the
recorder's own closed diagnostic `trace_input_normalized` (`cleanTraceText`, C99, C104 - one `?` per replaced character, so a string's
length never grows (an astral format character, two code units, becomes one `?`) and every v1 bound holds [B21 E2b lead]; before the fix a NUL or a lone surrogate in a model id, a requested tool's name or a call id made the durable commit fail, since
jsonb refuses both, and the book named it `trace_store_unavailable`, while a bidirectional override was persisted verbatim;
`b21-e2b-trace-attribution.test.ts` case 14 against a repository that refuses what jsonb refuses), and registers only its own
validated snapshot (a clone is never vouched for).

The task identity (3.2's rule 2): `specialistTaskId` gives `task-<n>-<role>` from an index and a role - exactly what the scheduler's
`planTasks` mints (C28) - and `specialistTaskIdentity` is its inverse (null for anything else: an index 0, a leading zero, an index over
32, the coordinator, an unknown role); `specialistTraceRunId` gives `<parentRunId>:<n>-<role>` and `specialistTraceIdentity` is its
inverse (the parent is everything before the LAST colon and must pass the id grammar and the v1 secret rule). **CONFIRMED** by
`b21-e2b-trace-attribution.test.ts` cases 1 to 3 and `b21-e2b-task-identity.test.ts` cases 1 and 2.

### 3.4 One trace document per specialist task: the book

`specialistTraceBook` (C85) is bound by the composition root (`specialistTraceBookFor`, C95; the runtime binds it at C92, the E2 fixture
the same way): it wraps the INJECTED loop (C93 - the scheduler is unchanged), so an attempt whose request run id is the scheduler's
`<runId>:<taskId>` of a planned task records into that task's own recorder, whose run id is `<runId>:<n>-<role>` (C86), whose provider
is the attempt's and whose prompt digest is the digest of the specialist's own system text. The recorder handed to the loop HOLDS the
terminal (C87), so a retry's attempts on ONE provider write ONE document with one `run_started` and ONE terminal (the retry's). [B21
E2b fix: security-3, coverage-3] An attempt on ANOTHER provider is reachable - the scheduler routes every attempt again (its route is
decided inside the attempt loop: the compatible fallback while the role's provider is paused, the role's own provider once the pause's
window has elapsed) - and never joins a one-provider document: that document is closed at the switch with its held terminal and NO
verdict, and the attempt opens the task's next document under the same per-task run id (C88; the durable record's next revision, 3.5).
So no attempt runs untraced and no verdict is stamped on another provider's events (`b21-e2b-trace-attribution.test.ts` case 10; the
text before the fix called this unreachable, ran such an attempt untraced and stamped the task's verdict on the first provider's last
event). Once the scheduler returns, the runtime settles the book with the scheduler's outcomes (C94, C89): the task's last document is
closed with the verdict of the task's LAST outcome - the verdict its final `specialist_finished` carries (`accepted`, `malformed` or
`escalated`) - on its last step or tool invocation. [B21 E2b fix: regressions-1, coverage-1] A document with no step or tool invocation
(a task that failed before its first step: a provider outage, no credits, a meter refusal) has no event to carry it: it carries no
verdict and names no model (none was reported; the trace's `model` is empty) - its terminal keeps the failure, the cascade reports the
dropped verdict as `normalized`, and the orchestration record keeps the verdict as the task's dissent (case 16; the text before the fix
said every document carries its task's verdict). Each document is attributed, validated and appended to the durable trace record (3.5)
before anything is handed on. Adapted from the held code, stated: the held book closed a document on the task's final
`specialist_finished` event, which needed the runtime line that streams the scheduler's events (C31) edited; settling with the outcome
keeps that line and closes each document with the same verdict. [B21 E2b fix: coverage-2] A call the loop refuses BEFORE it runs
(`unknown_tool`, `budget_exhausted`, `invalid_input`, `repeated_call`, `proposal_exists`, `execution_exists` - an untraced `tool_refused`
event, D21-12) is ONE closed line on its task's own document (`refusedCallLine`, C102, C106, C107: the registry's tool id or none, and
the closed status - never a task id, never the arguments), beside the loop's own unknown-tool line (case 15); the loop is unchanged.
[B21 E2b lead] These lines share the document's 32-warning bound with the loop's own warnings - an unknown tool costs two lines, the
loop's and this one - so past the bound a refused call's line is dropped and the document carries `trace_event_capacity_reached`
(RECORDED; each refused call is persisted within the bound, never silently beyond it).
The 256-event and 32-warning bounds are PER DOCUMENT (a task that records past them fills only its own document, case 7). A task that
never ran (no tools, not started, replayed) has no document. A document that cannot be recorded (a cascade refusal, a store refusal, a
store that throws: case 11) is ONE visible warning line (`traceUnrecordedLine`, C96): each task by role and index with its closed
reason, never a driver message, ALWAYS recorded on the coordinator's trace (past the 12-line orchestration cap, within the recorder's
32-warning bound) and WHOLE - [B21 E2b fix: regressions-3, tests-5] at most the recorder's 300-character warning bound
(`DEFAULT_REDACTION_CHARS`) by construction (C108: whole task entries while they fit, the rest counted as `+N more`, its closing clause
never cut; the trace holds exactly the stream's line, route case 10) - the specialists' results, the merge and the follow-up turn stand. A
durable record that is not the durable store (a test double, the unavailable default) has no trace store: then no book, and the
specialists run exactly as before. The input field `systemPromptVersion` (the trace identity's `promptVersion`) is so named because
`b21-d3-pin-facts.test.ts` case 1 reads the runtime's text from `specialistGatewayOptions(` to the end of the file and forbids the
gateway option's name there (the specialist gateway gets no prompt version; the book is no gateway). **CONFIRMED** by
`b21-e2b-trace-attribution.test.ts` cases 4, 5, 7, 10, 11, 15 and 16 and the route suite's cases 8 to 10.

### 3.5 The durable trace record (D21-3's calls)

`DurableOrchestrationTraceStore` (C82) on the aggregate `agent.orchestration-trace.v1` (C81), one aggregate per per-task trace run id,
beside the orchestration run's `agent.orchestration-run.v1` on the SAME repository: every `DurableOrchestrationRunStore` binds its trace
store in its constructor (C90) and hands out that store and nothing else of the repository (`orchestrationTraceStoreOf`, C91; a test
double or the unavailable default has none). A record is `sirkit.orchestration-trace-record.v1` with exactly the keys `schema`, `runId`,
`parentRunId`, `taskIndex`, `role`, `traceId`, `revision`, `at`, `digest`, `document` (C83) - the parent run and the task's index and
role, read from the trace's run id, never the task id. An append is a compare-and-set commit of a document the cascade validated
(identity-checked; a clone is `unvalidated_document`), idempotent by its trace id (`orchestration-trace:<runId>:<traceId>`), with no
outbox effect; a re-run of the same task (a resume) appends its next revision, and so does an attempt on another provider (3.4); every
load recomputes both digests, re-validates the document and refuses any disagreement with the one sentence
`AGENT_ORCHESTRATION_TRACE_MISMATCH` (C84) - [B21 E2b fix: tests-3] a changed `at`, `traceId`, document digest or record digest is each a
mismatch though the document itself stays valid (`b21-e2b-trace-attribution.test.ts` case 12). [B21 E2b fix: regressions-2] A record
is BOUND to its scope, as a stored orchestration request is to its run's (`orchestration-contracts.md`, "Bound to the run"): an append
whose document's trace names another scope than the one it is appended under is `invalid_record` and writes nothing (C100), and a load
refuses a record whose document's trace names another scope than the one it is loaded under (C101; `sameTraceScope`, C105) - the
validated-snapshot map is process-wide, so the store never vouches for another scope's trace (case 13). The orchestration run's own
history is unchanged (its records and revisions are what they were). So a specialist's tool CALLS - its gateway invocations as every
trace holds them: call id, tool id and version, operation class, argument and output digests, outcome class, status - and [B21 E2b
fix: coverage-2] each call refused before it ran as its closed line (3.4) are persisted on its own record: the carrier OD-111 named for
D21-3's calls half. Retention and access audit stay as OD-111 records them (RECORDED). **CONFIRMED** by
`b21-e2b-trace-attribution.test.ts` cases 4, 6, 10, 12, 13 and 15 and the route suite's case 8.

### 3.6 No string of a per-task trace holds `task-<n>-`

Proven over the WHOLE finalized document of real specialist runs - the REAL scheduler, loop, gateway, registry, recorder and validator,
one specialist calling a read and one an unadvertised tool (`b21-e2b-task-identity.test.ts` case 3) - and through the production POST
over every durable record (route case 8): no string or key holds `task-<n>-`. The specialist's INPUTS do carry the task id - its loop
request's run id is the scheduler's `<runId>:<taskId>`, and its system text names `Task: <taskId>` and `Task run: <runId>:<taskId>` -
and none of it reaches the trace but as below; nothing was rewritten, and nothing but the run id and the block is derived for the trace
(by this module). Where each string of a per-task document comes from:

| field | where it comes from | the task id? |
|---|---|---|
| `schema` | the v1 constant | no |
| `runId` | the book: `<runId>:<n>-<role>` (`specialistTraceRunId`) | no - the task's index and role |
| `traceId` | the book: a fresh `trace-<uuid>` | no |
| `provider`, `model` | the attempt's provider; the last step's model as the provider reported it (bounded, redacted; empty when no step was recorded) | no |
| `promptVersion`, `promptDigest`, `registryDigest` | the system prompt's version; the digest of the specialist's system text - the text naming `Task: <taskId>` enters ONLY as the prompt digest; the role registry's digest | no |
| `scope`, `contextDigests` | the request's tenant, project and branch; the derived context's digests | no |
| `startedAt`, `endedAt` | the clock | no |
| `events` | `run_started`; each step (its model and token counts); each tool invocation (call id, tool id and version, operation class, status, verification and the argument and output DIGESTS - the objective and the tool arguments and results never enter); the terminal | no |
| `terminal` | the task's one terminal (held across a retry): the outcome, a closed failure reason, the totals | no |
| `warnings` | the loop's own lines (its toolset lines, an unknown tool's name) and [B21 E2b fix: coverage-2] the book's closed line per call refused before it ran (`refusedCallLine`: the registry's tool id or none, the closed status), each through the recorder's redactor | no |
| `recorderDiagnostics` | the closed diagnostic vocabulary | no |
| `attribution` | this module: per step and tool invocation `{ seq, orchestration }` - the index, the role, the provider, the step's model, the parent run id, the verdict | no |

[B21 E2b fix: security-1] Every string of every row is then held to the orchestration string rule: a control, format or separator
character or a lone surrogate - reachable only through a provider's model id, a requested tool's name or a call id - is a `?` in the
stored document, with the recorder's own `trace_input_normalized` (3.3; `b21-e2b-trace-attribution.test.ts` case 14).
A task id could reach a per-task trace only through a string the recorder does not redact; the v1 validator reads any `task-<n>-<role>`
as a key anyway, so such a document would be refused and never stored. The coordinator's trace, which the scheduler's lines reach, keeps
reading task ids as `ta[redacted]` (3.2, RECORDED).

### 3.7 What stands unchanged, and the pins that stay green

- The nine B11-scanned files, byte-identical to HEAD 41330e6 (sha256): `app/lib/agent/trace.ts` `ad933eb059dff859cc0fe910aa82d0eb2ef24f14eedab1bef94c510a7dd60ba5`, `app/lib/agent/trace-recorder.ts` `61cff587cea51da0dd343a0dfd8c1171f2503acf57fc278dba3b352e3bea914b`, `app/lib/agent/replay-capsule.ts` `77958c9488b43d490b012aa10638df6b93e1dd2aaf704dee11aac206ea41f1b1` ([B21 F, 2026-09-28] a reviewed pin move: B21-F extended this file to the capsule v4 - per-task step lists and scripted stalls, `evaluation-matrix.md` section 2 - so it is no longer byte-identical to 41330e6; its sha256 since F is `7080ecc24ab874889dd9754e17ffc97e65d73d2635cfde3a0d7e7ab29e4039eb`; the other eight files and `redaction.ts` below are unchanged), `app/lib/agent/replay-context.ts` `fcdc9a7d0d6c6f9c09a56732ac643d59503695dc224734a76b030c38261fbbff` ([PR-J, 2026-10-22] a reviewed pin move (runbook J, OD-255 item 1): the replay key lists carry the optional schematic sheet fields - `sheets` on the state, `sheetId` on components, wires, labels and KiCad instances, a label's `scope`, `portId` and `childSheetId` - so a multi-sheet project is never flattened in a replay capsule and the B11.2 drift gate still equals the production types; its sha256 since section J is `4fc6f406d6f1a41c199350052c3d39b85521f1498998fcd01cc13d795d502a55`; it still carries no orchestration identifier; [PR-J1 integration, 2026-10-22] moved again (review J1-PERS-6): the optional sheet tree is projected field by field and key-checked at every depth instead of carried whole, so its sha256 since is `172cdb2518baa8c78cdc8cd07f68345dd80673368bc1d245a39c9f3f15c8a79f`; still no orchestration identifier), `app/lib/agent/evaluation.ts` `9d948da7726e6ee5ed8dd266f064d5a35cda25f18c337f70d8b740245d1b1b19`, `app/lib/agent/evaluation-cases.ts` `ad8e1df67c73d229eb0c0234dde7ffafe6bb7ff1822e509780826f00a96388f1` ([PR-M, 2026-10-17] moved again: the schematic-instance inspection joined the expected discovered tools wherever the missing-facts read is; was `1754c1316c2cbcd986ae2f49b562ce0d543dc4955ddeb9574eb72512286df959`) ([PR-F, 2026-10-17] moved again: the missing-facts read, the draft request, the module-contract and stackup proposals joined the expected discovered tools) ([B24-D2, 2026-10-09] a reviewed pin move (OD-213, OD-235): B24-D2 added one line to `ALL_READS`, the paged board read `sirkit.pcb.board-page-inspect`, discovered wherever via-inspect is - so this file is no longer byte-identical to 41330e6; its sha256 since B24-D2 is `2b392c0ac18c4f37bfa35e7d8098cd2b67fdd7d949c6f954d3d2d7d257a6f4b9`; it still carries no orchestration identifier; [PR-D, 2026-10-17] a reviewed pin move (OD-244): PR-D's Tier 0 Schematic-to-PCB preflight read `sirkit.pcb-sync.preflight`, discovered wherever a validated schematic is (no board needed), joins the expected discovered tools - a `PREFLIGHT` constant after `PROPOSE` and the `discoveredTools` / `toolsExactly` lists of e02-e16 - so its sha256 since PR-D was `9caa5395f8637105d99af76b4c26b8133f82566b5e39bba9feef3614c7d763bb`, and since PR-F fB (2026-10-17, the `MISSING_FACTS` and `DRAFT_REQUEST` constants beside `PREFLIGHT` and the same lists: the missing-facts read wherever a validated schematic is, the draft request wherever a head mark is) `d0492f5208331a0882bd37d7b5b3d96161fa704e93d38c9a809f19fb2ec8305a`; it still carries no orchestration identifier and imports nothing under orchestration), `app/lib/agent/pcb-shape-projection.ts` `e6a58afbd30cb46f9da28b9e43768c7d0a524822adf0b47746eb1fa3ddd44750`, `app/lib/agent/pcb-shape-types.ts` `b46e801bcb00138aaa5d2c0c8de0b092be50cbd48e2eda43699055d2301bd590`, `app/lib/agent/generated/pcb-shape-descriptor.ts` `69dc94fcfc6fb939ce22d8ce5e08739f0be6ab3b192b52a496aa183fa3538cfb`.
- `app/lib/agent/redaction.ts`, byte-identical to HEAD 41330e6 (sha256 `c42672c6e1d3bfbcf5c1daed611b32a347d06f66b8bc0ef1e7c79f46c782c0e8`): its diagnostic patterns untouched, the
  unanchored `sk-` pattern kept (C48).
- The v1 trace contract (its schema, its exact event keys, its closed outcome classes, the provider literal
  `provider: "openai" | "anthropic";` in the recorder); the coordinator's trace (the route's sink still receives ONE trace per run, the
  coordinator's); the five pinned run events `plan`, `specialist_started`, `specialist_finished`, `partial_result`, `degraded` and their
  shapes; the orchestration record's history; protocol version 1 and the flag-off byte identity.
- The pins that stay green, re-run by E2b: `b20-a4-trace-attribution.test.ts` case 7 (the nine files, `/mcp/i`, the provider literal),
  `b20-b2-import-gates.test.ts` (the nine files and the literal), `b11-1-trace-integrity.test.ts` and `b11-trace-replay-evaluation.test.ts`
  (the scanned files' regex, the replay pins), `b18-b-loop-execution.test.ts` (the outcome classes), `b21-a-import-gates.test.ts` case 4
  (no scanned file imports orchestration; no orchestration module but tripwires names one) and case 2 (the new module's closure reaches
  no forbidden family and no provider SDK), `b21-d3-pin-facts.test.ts` case 1 (the specialist gateway's text: no prompt version), the
  A..E2 page suites.

## 4. What E2's first run does NOT do

- No trace block, no per-task trace document, no durable trace record (section 3: stopped; D21-11's trace half and D21-3's calls stay
  open); no route-level resume or `userMessageDigest` ledger, no composer routing, no first-turn breaker (B21-E3); no evaluations (B21-F). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): the composer routing and the first-turn breaker are B21-E4's (`composer-and-first-turn.md`), the resume and the ledger B21-E3's]
  [B21 E2b, 2026-09-27] The trace block, the per-task documents and the durable trace record: applied by E2's second run (3.2 to 3.7);
  D21-11's trace half and D21-3's calls closed there.
- No new UI control (two in-place page lines; the B17-A inventory regenerated with zero drift; no B18-D wire); no new route (the census
  stays 165 = 162 canonical + 3 factories + 0 raw); no new exposed tool; no request key; no change to protocol version 1; no new terminal.
- No edit to the nine B11-scanned files (byte-identical to HEAD); no change to the redaction authority; no change to the coordinator's
  trace but the two section 1 records (a withheld re-run's closing line, an undeclared key's name withheld); no change to the
  orchestration record (its history and revisions are what they were; a dissent reason keeps A's path, RECORDED).
- No reserved-file edit (their texts are in section 6); no line cited by an A..E1 page moved (every edit to a cited file is in place or
  appended; the A..E1 page suites green); [B21 E2 fix: tests-5] no line the discovery cites in `chat-run-view.ts` moved (the run view's
  additive code appended, page case 10).
- **What E2's second run does NOT do** ([B21 E2b], 2026-09-27): no edit to the nine B11-scanned files and no change to `redaction.ts`
  (its diagnostic patterns untouched; both byte-identical to HEAD 41330e6, 3.7); no new run-event type (the five stand) and no change to
  the coordinator's trace, the stream's events or the orchestration record's history; no UI change (no page line, no control); no
  route, descriptor or request-key change (the census stays 165 = 162 canonical + 3 factories + 0 raw); no new runtime dependency; no
  reserved-file edit (the texts are at the end of section 6); no route-level resume, composer routing or first-turn breaker (B21-E3 [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): the composer routing and the first-turn breaker are B21-E4's, the resume B21-E3's]); no
  retention or access-audit setting for the trace records (OD-111's deferral stands, RECORDED); no line cited by an A..E2 page moved (every
  edit to a cited file in place or appended; the A..E2 page suites green).

## 5. Suites, evidence, the pin moves, gates

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-e2-run-events.test.ts` | 16 | the pinned list and the closed statuses, reasons and key sets; every builder bounded and clean (a task id never read as a key); the judge refuses every shape outside the five; the REAL scheduler emits them in place of B's lines, a refused tool call still a warning; the retry, the not-run role, the held artifact, a replay and a stale result as events; the provider layer's paused coordinator and compatible fallback as `degraded` events naming what served; [fix] a withheld re-run closed and counted once (cases 9, 10), an unrecorded provenance named as none (11), an undeclared key's name withheld (12), the budget remaining (13), every other scheduler site pinned by its event type (14, 15) |
| `app/lib/agent/orchestration/__tests__/b21-e2-run-view.test.ts` | 7 | the counters and the one status line over the REAL scheduler's events; an older reducer ignores the events (every pre-E2 field and the projection but `status` identical); the page's pre-E2 switch has no case for them; an event's run-log line; no new control; [fix] what an older page loses (6), the finished counter on a task's final outcome (7) |
| `app/lib/agent/orchestration/__tests__/b21-e2-page.test.ts` | 10 | this page; [fix] the A..E1 pages' dated E2 notes (8), the review's facts (9), `chat-run-view.ts` line-neutral where the discovery cites it and no raw control byte (10); [E2b] case 1's section-3 heading pin moved (the stop AND the application) |
| `app/api/chat/__tests__/b21-e2-chat-events.test.ts` | 10 | [E2b] the per-task trace records through the production POST (8), a failed specialist's document and an unrecorded document's one line (9); [E2b fix] that line past the 12-line cap and whole, bounded by construction (10); through the production POST: one stream with the events, B's lines on the coordinator's trace and the record unchanged; a stand-down as `degraded` with the partial result; a refused call still a warning and the page's reducer over the real stream; flag off byte-identical to HEAD (the flag set off by the case); [fix] every runtime stand-down by its reason (5), the trace's 12-line cap and the stand-down past it (6), the partial result counting what the merge withheld (7) |
| `app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts` | 7 | A's cases; cases 1, 3 and 5 moved (run-events.ts in the entry set, 9 -> 10); [E2b] moved again (trace-attribution.ts, 10 -> 11), each in place with its reason |
| `app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts` | 14 | B's cases; the lines helper and cases 1 and 14 moved |
| `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts` | 10 | C's cases; the lines helper moved |
| `app/lib/agent/orchestration/__tests__/b21-d2-approval.test.ts` | 10 | D2's cases; case 8's line moved |
| `app/lib/agent/orchestration/__tests__/b21-d2-proposing-roles.test.ts` | 9 | D2's cases; case 9's lines moved |
| `app/lib/agent/orchestration/__tests__/b21-d2-provenance.test.ts` | 9 | D2's cases; case 1's stream check moved |
| `app/lib/agent/orchestration/__tests__/b21-d3-scenario17.test.ts` | 8 | D3's cases; the lines helper moved |
| `app/lib/agent/orchestration/__tests__/b21-e1-provider-breaker.test.ts` | 14 | E1's cases; cases 7 and 13's lines moved |
| `app/lib/agent/orchestration/__tests__/b21-e1-fallback.test.ts` | 5 | E1's cases, unchanged (the fixture's lines moved) |
| `app/lib/agent/orchestration/__tests__/b21-e1-stop-reasons.test.ts` | 6 | E1's cases, unchanged (the fixture's lines moved) |
| `app/api/chat/__tests__/b21-b-chat-router.test.ts` | 18 | B's cases; the lines helper moved |
| `app/api/chat/__tests__/b21-d-chat-merge.test.ts` | 7 | D's cases; the lines helper moved |
| `app/api/chat/__tests__/b21-d2-chat-proposals.test.ts` | 7 | D2's cases; the lines helper moved |
| `app/api/chat/__tests__/b21-d3-chat-replacement.test.ts` | 7 | D3's cases; the lines helper moved |
| `app/api/chat/__tests__/b21-e1-chat-provider.test.ts` | 3 | E1's cases; the lines helper moved |
| `app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts` | 16 | [E2b] the held suite adapted: the block and its one rule (1), the validator (2), the cascade and a literal task id's trace refused (3), the REAL scheduler with the book (4), a retry in one document (5), the durable trace record (6), 256 events per document (7), the nine files byte-identical and the v1 contract unchanged (8); [E2b fix] a specialist on another provider (9), a retry on another provider in the task's next document (10), every unrecorded document named (11), both digests on load (12), the record bound to its scope (13), hostile text cleaned and refused (14), a refused call a line on its task's document (15), the verdict a document carries (16) |
| `app/lib/agent/orchestration/__tests__/b21-e2b-task-identity.test.ts` | 3 | [E2b] every scheduler task id round-trips through index and role (1); the literal run id still refused and the index-and-role run id accepted through the REAL recorder and validator, `redaction.ts` byte-identical (2); the whole finalized document of real specialist runs and its durable record hold no `task-<n>-` (3; [E2b fix] its warning lines include the book's refused-call line) |
| `app/lib/agent/orchestration/__tests__/b21-e2b-page.test.ts` | 8 | [E2b] this page's section 3.1 to 3.7, its E2b citations, suites and texts for the lead; [E2b fix] the review's facts (8) |
| `app/lib/agent/orchestration/__tests__/b21-a-store.test.ts` | 15 | A's cases; [E2b] case 12's import list moved (+ `./trace-attribution`), in place with its reason |

**Test-first.** The three E2 suites ran against the base with only the tests present (`b21/e2/e2-final-failing-first.log`: three files
failing on the missing module); then with the new module and the contracts in place and the scheduler, the runtime, the run view and
the page at HEAD (`b21/e2/e2-final-failing-first-wiring.log`: 13 of 17 failing on their assertions - the scheduler emits warnings, the
runtime and the page render no event; the 4 passing by design are run-events cases 1 to 3, which judge the new module alone, and the
route's flag-off pin); then the wiring, green (`b21/e2/e2-green-1.log` 17 of 17). The moved suites failed against the E2 code with their
HEAD helpers (`b21/e2/b21-all-1.log`: 33 of 315 failing, the three A-gate cases included) and pass moved (`b21/e2/b21-all-2.log`: 37
files, 319 of 319, every A..E1 page suite included). The production files were swapped by copy and restored by sha256
(`b21/e2/swap-final.sh`; never a checkout, stash or reset). The page's suite ran first against the tree without this page
(`b21/e2/e2-page-failing-first.log`).

**The review's findings** ([B21 E2 fix], 2026-09-27; the adversarial review's 13 confirmed findings, each fixed test-first). The new
cases ran first against the unfixed code (`b21/e2fix/red-1.log`: 14 of 39 failing in the four E2 suites, each on its finding); the
test-strength findings were proven by a deliberate breakage of the source, run, then restored byte for byte (sha256, `b21/e2fix/mut/`);
every fix re-ran green (section 5, gates).

| finding (severity) | reproducing test | failure observed first | fix | re-run |
|---|---|---|---|---|
| `regressions-1`, `security-3`, `tests-2` (low, low, medium) | run-events case 9; run-view case 7 | case 9: no closing event (`[[0, "escalated", true]]`); the pre-fix probe (`b21/e2fix/red-regressions1-probe-prefix.log`, the pre-fix files swapped in and restored by sha256): "0 of 2 planned" for a plan of ONE and "0 of 3" for a plan of two, finished 0 | `partialResultEvent` counts a task once and `planned` is the plan's count, the judge refusing parts over the plan (C16, C65); the scheduler CLOSES a withheld re-run (`notRunAgainEvent`, `settle`, C52-C55); the finished counter reads a task's final outcome (C39) | green |
| `coverage-6` (low; part b) | run-events case 10 | the stream ended `specialist_finished:true`, `degraded:provider_paused` with no closing event | the same closing event (C53-C55); part a (two notices for one pause) is the log's own count, by design, stated in section 2 | green |
| `security-1`, `coverage-1` (low, low) | route case 7 | no `partial_result` at all for the readiness reviewer the merge judged malformed (`expected [] to match object`) | `partialOutcomeEvent` reads the merge's decisions where the merge ran (the success path and the two post-merge stand-downs, C58-C60): a withheld result is `mergeWithheld`, never usable | green |
| `coverage-2` (low) | run-events case 11 | the replayed event named `provider: "openai"` | `provider` (and `model`) null on `replayed` and `stale`, the judge requiring it (C14, C62; C61 the merge's rule) | green |
| `security-2` (low) | run-events case 12 | the reason carried the model's key name | the undeclared key's path withheld from the reason and the line (`UNDECLARED_KEY_WITHHELD`, C56, C57); the header claims no more (page case 9) | green |
| `coverage-5` (low) | run-events case 13; page case 9 | `specialist_started` carried no budget (`[undefined, undefined]`) | `wallTimeRemainingMs` and `outputTokensRemaining` on `specialist_started` (C24, C64); D21-22 quoted verbatim and closed item by item (section 6) | green |
| `coverage-3`, `tests-4` (low, low) | run-view case 6; page case 9 | case 6 green by design (it records what the older page loses); page case 9: OD-126 did not say it | RECORDED: section 2 and OD-126's owner question (the warning beside the event, or a protocol v2); the stream is not changed (the task's "in place of B's warning lines" stands) | green |
| `tests-1` (medium) | run-events cases 14, 15; route case 5 | route case 5 red on the new `mergeWithheld` key; cases 14, 15 green by design (they pin the sites); breakage m1 (the parsed-malformed site back to a warning) fails run-events cases 12 and 15; m2 (merge_unrecorded's literal swapped) fails route case 5 | every site pinned by its event type, status or reason, with no warning carrying its line | green |
| `tests-3` (low) | route case 6 | green by design (the code was right); breakage m3 (`report(reason)` without its `always`) and m4 (untraced events spending the budget) each fail it | the cap and the stand-down override proven through the production POST | green |
| `tests-5` (low) | page case 10 | `chat-run-view.ts:115` onward moved by the E2 fields | the run view's additive code APPENDED (the reducer's `default` hands it the five, C38, C63); every discovery citation of the file holds its base content | green |
| `tests-6` (low) | page case 10 | breakage m5 (the raw U+2028 back in the run-events suite) fails it | the separator written with `String.fromCharCode(0x2028)`; no raw control, format or separator byte in any E2 file | green |
| `tests-7` (low) | route case 4 | `SIRKIT_ORCHESTRATION_ENABLED=1` in the shell failed it (`b21/e2fix/red-tests7-shell-flag.log`) | the case stubs the flag off itself and asserts it; the suite's title no longer claims per-task trace records | green |
| `regressions-3` (low) | page case 8 | B's 'Not in B' paragraph carried no dated E2 note | dated `[B21 E2, 2026-09-27]` notes on B's three blocks, C's not-run bullet and D2's held-artifact bullet, each appended to its block's last line (no line moved) | green |

**Pin moves, each with its reason written next to it.**
- `b21-a-import-gates.test.ts` cases 1, 3 and 5: `run-events.ts` joins the orchestration gate's entry set (9 -> 10) the day it is
  written; its closure (the agent contracts, the redactor, the orchestration contracts) is walked by case 2. Line 147 (B's C30) unmoved.
- The run-log-lines helpers - B21-B's plan, status and stand-down lines are now the `plan` / `specialist_finished` / `degraded` events
  carrying the same sentence, so each helper reads those events' messages with the warnings, in stream order: `b21-b-scheduler.test.ts`
  (the helper, case 1's line list, cases 1 and 14's "nothing of a specialist run reaches the stream" now "nothing but warnings and the
  scheduler's own events"), `b21-c-least-privilege.test.ts`, `b21-d2-approval.test.ts` case 8, `b21-d2-proposing-roles.test.ts` case 9,
  `b21-d2-provenance.test.ts` case 1, `b21-d3-scenario17.test.ts`, `b21-e1-provider-breaker.test.ts` cases 7 and 13, `_e1-fixtures.ts`
  (the E1 fallback, breaker and stop suites read its lines), and the five route suites' `warningsOf`. Every one in place (no line added),
  no assertion loosened: the lines asserted are the same sentences; [B21 E2 fix: tests-1] what the helpers no longer tell apart (a line
  as a warning or as an event, and which reason) the E2 cases now pin site by site.
- [B21 E2 fix] E2's own suites (not committed before): run-events case 1's key sets gain the budget remaining and `mergeWithheld`, case 2
  builds a stale event without a provider and passes the not-started tasks as a list, case 3's partial fixture carries `mergeWithheld`;
  run-view cases 1 and 2 pass the not-started tasks as a list; the route suite's scripted double is the original adapters module with its
  two factories wrapped (as E1's route suite), its case 4 sets the flag off itself - each with its reason beside it.
- The CI workflow: ONE explicit `prompt-to-gerber` entry for the route suite (C51), after E1's; the three orchestration suites ride the
  `app/lib/agent/orchestration/__tests__` filter; no suite starts PGlite.
- `provider-routing-and-failure.md`: one dated pointer to this page at the end of its header paragraph (its headings unchanged);
  [B21 E2 fix: regressions-3] `task-complexity-router.md`, `specialist-roles.md` and `specialist-proposals.md`: dated E2 notes appended
  to the last line of the blocks E2 made untrue (no line moved; their page suites green).

**Gates** (one heavy job at a time, through the lock runner; after the review's fixes, logs under `b21/e2fix/`): every B21 suite
with the six route suites (`gate-b21.log`: 38 files, 341 of 341, every A..E2 page suite included); `app/api/chat/__tests__` in full (20
files, 127 of 127); `app/lib/agent/__tests__` in full (36 files, 415 of 415 - the b20-a4 trace attribution case 7 among them);
`app/lib/project/__tests__` with `app/components/chat` (39 files, 312 of 312 - the B18-D UI gates and the B18-D/B18-E run-view suites
among them); the B17-A control inventory with the engineering exposure and tier suites (10 files, 130 of 130); `app/lib/llm/__tests__`
with `app/lib/acquisition/__tests__` (22 files, 235 of 235, one opt-in live file skipped as before - the CI job-scope guard among them);
`app/lib/mcp` with `app/api/mcp/__tests__` (52 files, 920 of 920 - the B20 pages' citations into `route.ts` and `page.tsx`, the b20-b2
nine-file pin); tsc 0 (`tsc-1.log` after the fixes, `tsc-2.log` on the finished tree); eslint on the 25 changed and new TypeScript files:
clean but for `app/page.tsx`'s 14 pre-existing `react-hooks/refs` errors (lines 1266 to 7792, none of E2's three lines 62, 4693, 4740);
the B17-A generator re-run with zero drift (628 controls, `gen-b17.log`). No descriptor, route, request key or other generator input
changed; the nine scanned files byte-identical to HEAD.

Live behaviour with a real model: **BLOCKED-LIVE-QUALIFICATION** (LB-9) - the events are built from the scheduler's own outcomes, never
from provider output.

**E2's second run** ([B21 E2b], 2026-09-27; logs under the scratchpad's `b21/e2b/`, one heavy job at a time through the lock runner).
The held work was verified against `held.sha256` (all eight files OK) and applied adapted (3.2 to 3.4).

**Test-first (E2b).** The two new suites and the route suite's two new cases ran against HEAD 41330e6 with only the tests and the
fixture present (`e2b-failing-first-tests-only.log`: three files failing on the missing module); then with the module in place and the
store and runtime at HEAD (`e2b-failing-first-module-no-wiring.log`: 7 of 20 failing, each on the missing wiring - the record's trace
store - and 13 passing by design: the module's own cases, trace-attribution 1 to 3 and task-identity 1 and 2, and the route suite's
cases 1 to 7); then the wiring (`e2b-green-1.log`: 19 of 20 - the one failure was the new whole-document case's own over-narrow
expectation of a specialist's warning lines, which also holds the loop's toolset lines: the expectation corrected, never the code);
then `e2b-green-2-with-A-pins.log` (the three suites 20 of 20; A's gate cases 1, 3 and 5 and A's store case 12 failing on their pins
before the moves) and `b21-all-1.log` (every B21 suite with the six route suites, 353 of 355: `b21-d3-pin-facts.test.ts` case 1 on the
book input's field name - renamed `systemPromptVersion`, no pin moved, 3.4 - and E2 page case 5 on this page's route-suite count, 7 ->
9). The page's suite ran first against the page without E2b's sections (`e2b-page-failing-first.log`: 6 of 7 failing; case 7, the files'
hygiene, green by design).

**Pin moves (E2b), each with its reason written next to it, each in place (no line added above a cited line).**
- `b21-a-import-gates.test.ts` cases 1, 3 and 5: `trace-attribution.ts` joins the orchestration gate's entry set (10 -> 11) the day it
  is written; its closure (the trace contract and recorder, the capture, the redactor, the durable substrate's pure modules, the
  orchestration contracts) is walked by case 2 and reaches no forbidden family and no provider SDK.
- `b21-a-store.test.ts` case 12: the store's import list gains `./trace-attribution` (every durable record binds the per-task trace store
  on its own repository); the rest of the case (no durable runtime, one mismatch sentence, no forbidden subject) unchanged and green.
- `b21-e2-page.test.ts` case 1: section 3's heading names the stop AND the application (the stop's record stays whole as 3.1; case 6's
  claims on it unchanged and green).
- Not pin moves: the route suite gains cases 8 and 9 (its header and describe comments updated, no title changed; its scripted double
  gains a read-then-result branch); the E2 fixture gains the read-then-result behaviour and the `traced` option (the book bound as the
  runtime binds it); A's page gains one dated note (the calls' carrier now exists); the rows above.

**Gates (E2b)**, one heavy job at a time through the lock runner (logs under `b21/e2b/`): every B21 suite with the six route suites
(`gate-b21.log`: 41 files, 362 of 362, every A..E2b page suite included); `app/api/chat/__tests__` in full (20 files, 129 of 129);
`app/lib/agent/__tests__` in full (36 files, 415 of 415 - the b20-a4 trace attribution case 7, the b11 trace suites and the b18-b loop
suite among them); `app/lib/project/__tests__` with `app/components/chat` (39 files, 312 of 312 - the B18-D UI gates among them); the
B17-A control inventory with the engineering exposure and tier suites (10 files, 130 of 130); `app/lib/llm/__tests__` with
`app/lib/acquisition/__tests__` (22 files, 235 of 235, one opt-in live file skipped as before - the CI job-scope guard among them);
`app/lib/mcp` with `app/api/mcp/__tests__` (52 files, 920 of 920 - the B20 pages' citations, the b20-b2 nine-file pin); tsc 0
(`tsc-1.log`, `tsc-2.log` on the finished tree); eslint on the 11 changed and new TypeScript files: clean (`eslint-1.log`). No
descriptor, route, request key, run-event type, UI line or generator input changed; the nine scanned files and `redaction.ts`
byte-identical to HEAD.

**The review's findings (E2b)** ([B21 E2b fix], 2026-09-27; the adversarial review of E2's second run: 13 confirmed findings, each
answered test-first; logs under the scratchpad's `b21/e2b-fix/`). The new cases ran first against the unfixed code (`red-1.log`: 5 of
26 failing in the trace-attribution and route suites, each on its finding); the test-strength findings were proven by a deliberate
breakage of the fixed source, run, then restored byte for byte (sha256, `mutate.py`, `mut-*.log`); every fix re-ran green
(`green-1.log`: 29 of 29 in the two E2b code suites and the route suite).

| finding (severity) | reproducing test | failure observed first | fix | re-run |
|---|---|---|---|---|
| `regressions-1`, `coverage-1`, `tests-2` (low, low, low) | trace-attribution case 16 (and case 5's title) | green by design (the code dropped a zero-step document's verdict; the page and case 5's title claimed it); breakage m5 (settle drops `escalated`) fails case 16 | the claims corrected (3.3, 3.4, the D21-11 clause, case 5's title): a document with no step or tool invocation carries no verdict and names no model; case 16 pins `escalated` on a document with a step and the zero-step document's `normalized` | green |
| `regressions-2` (low) | trace-attribution case 13 | `{ ok: true }` for a document appended under another tenant | the record bound to its scope on append (`invalid_record`) and on load (mismatch): `sameTraceScope` (C100, C101, C105) | green |
| `regressions-3` (low) | route case 10 | "3 failing: expected 326 to be less than or equal to 300" | `traceUnrecordedLine` bounded to `DEFAULT_REDACTION_CHARS` by construction: whole entries, `+N more` (C108) | green |
| `security-1` (low) | trace-attribution case 14, against a repository that refuses what jsonb refuses | `{ recorded: 0, failures: ["circuit-topology task 1: trace_store_unavailable"] }` | the whole-document string rule in the validator (C97, C98, C103) and the cascade's `?` with `trace_input_normalized` (C99, C104) | green |
| `security-3`, `coverage-3` (low, low) | trace-attribution case 10, through the REAL scheduler and provider layer | `failures: ["circuit-topology task 1: provider_switched"]`, `recorded: 1` - attempt 1 WAS routed to anthropic and ran untraced, the accepted verdict on openai's event | the document closed at the switch without a verdict; the attempt opens the task's next document (C88); 3.4's "not reachable" claim corrected | green |
| `coverage-2` (low) | trace-attribution case 15; task-identity case 3 | the document held only the loop's unknown-tool line (1 of the 4 expected) | `withRefusalLines` and `refusedCallLine` (C102, C106, C107); D21-12's addendum (section 6) | green |
| `tests-1` (medium) | trace-attribution case 9 | green by design; breakage m1 (a constant provider on the recorder and the handle) fails cases 9 and 10 | the case: a role on anthropic by the server override through the REAL adapters, the other task on openai | green |
| `tests-3` (low) | trace-attribution case 12 | green by design; breakage m2 (the load's digest check neutralized in place) fails case 12 | the case: four tampers the validator accepts | green |
| `tests-4` (low) | trace-attribution cases 10 and 11 | case 10 as above; case 11 green by design; breakages m3 (a store refusal recorded nowhere) and m4 (a cascade refusal recorded nowhere) each fail case 11 | the cases; 3.4's reachability claim corrected | green |
| `tests-5` (low) | route case 10 | green by design for the cap; breakage m6 (the line's `always` dropped) fails it | the case: two specialists fill the 12-line cap with refused calls first | green |

Not pin moves (E2b's own, uncommitted suites): trace-attribution case 5's title no longer claims a verdict it never asserted (the
earlier title was false, regressions-1); task-identity case 3's warning-line expectation admits the book's refused-call line and its
title names it (coverage-2); the page's suite rows move with the new cases (16, 10 and 8 `it(` blocks). No A..E2 pin moved; no line
cited by an A..E2 page moved (`trace-attribution.ts` and `orchestration-runtime.ts` edited in place or appended; the E2b rows C67 to C96
re-pinned where a cited line changed: C88's anchor, C96's line).

**Gates after the review's fixes (E2b)**, one heavy job at a time through the lock runner (logs under `b21/e2b-fix/`): every B21
suite with the six route suites (`gate-b21.log`: 41 files, 372 of 372, every A..E2b page suite included); `app/api/chat/__tests__` in
full (20 files, 130 of 130); `app/lib/agent/__tests__` in full (36 files, 415 of 415 - the b20-a4 trace attribution case 7, the b11
trace suites and the b18-b loop suite among them); `app/lib/project/__tests__` with `app/components/chat` (39 files, 312 of 312 - the
B18-D UI gates among them); the B17-A control inventory with the engineering exposure and tier suites (10 files, 130 of 130);
`app/lib/llm/__tests__` with `app/lib/acquisition/__tests__` (22 files, 235 of 235, one opt-in live file with 2 cases skipped as before -
the CI job-scope guard among them); `app/lib/mcp` with `app/api/mcp/__tests__` (52 files, 920 of 920 - the B20 pages' citations, the
b20-b2 nine-file pin); tsc 0 (`tsc.log`); eslint on the 11 changed and new TypeScript files: clean (`eslint.log`). Zero drift, each
output snapshotted by sha256 first: the B11 generator re-run (19 of 19 cases, 61 of 61 checks; its 21 files byte-identical - it runs
the loop and the recorder), the B09 agent artifacts re-run (byte-identical) and the B17-A inventory generated into the scratchpad
(628 controls, both files identical to the committed ones); the tree's status unchanged by the generators. No descriptor, route,
request key, run-event type, UI line or generator input changed; the nine scanned files and `redaction.ts` byte-identical to HEAD.

## 6. For the lead — the reserved texts, in full

Each `### OD-…` below is the entry for `OWNER_DECISIONS.md` (as `## OD-…`), in its format (OD-126 and OD-127 are not yet in it;
OD-112 stays open: its entry here records the stop and the owner's question). Then the README row, the ledger paragraph, the
PROGRAM_STATE texts, the discovery closure clauses and the §10 amendment line, and the dated note for discovery §0. [B21 E2 fix,
2026-09-27] Every text below includes the adversarial review's fixes (section 5, "The review's findings").

### OD-126 — The chat protocol for orchestration events, as applied (B21-E2, 2026-09-27)

- **Question:** how does a DAG run report its plan, its specialists, its partial result and its degraded modes on the chat stream
  (D21-22)?
- **Applied:** five events under protocol v1 - `plan`, `specialist_started`, `specialist_finished`, `partial_result`, `degraded` -
  PINNED as `ORCHESTRATION_RUN_EVENT_TYPES` in the agent contracts beside the other run events, each a CLOSED shape (task id, role,
  provider, model, attempt, status or reason, the budget remaining on a start, a bounded message) built by `run-events.ts` and judged by
  one rule; emitted by the scheduler and the runtime IN PLACE of B21-B's warning lines for the plan, a specialist's status and the
  degraded and stand-down facts, each carrying B's own sentence as its `message` (a specialist's refused tool call, a merge line and an
  approval line stay warnings); a re-run the scheduler promised (`runsAgain`) and then withheld is closed by one final
  `specialist_finished`; a replayed or stale result names no provider (its provenance is unrecorded); the partial result counts each
  planned task once and, once the merge judged them, counts a result the merge withheld as not usable (`mergeWithheld`); a reason never
  repeats an undeclared key's model-chosen name. The coordinator's trace records the lines it recorded at HEAD, plus a withheld re-run's
  closing line (`specialist_started` and `partial_result` are stream-only); the closed union widened in place; protocol version 1, one
  run_started and one terminal, the flag-off stream byte-identical; an older reducer ignores the five. NOT harmless for an OLDER v1 page:
  a tab still running the pre-E2 bundle against this server renders the refusal, merge and approval warnings but loses the plan, status
  and stand-down lines it rendered at HEAD (they arrive as types its `default` drops), so degraded mode is silent there and protocol
  version 1 cannot tell it (RECORDED; `b21-e2-run-view.test.ts` case 6 names the lines lost; the page and the route ship together and
  the DAG is behind the off-by-default flag, so it needs a version skew with the flag on). Proven by `b21-e2-run-events.test.ts`,
  `b21-e2-chat-events.test.ts`, `b21-e2-run-view.test.ts`.
- **The owner may choose otherwise:** the warning beside the event (B's warning line emitted too, the E2 page skipping a warning equal to
  a message it rendered - an older page keeps every line it showed; the coordinator's trace unchanged); or a protocol v2 with typed
  events only (the page composes the line; an older client refuses the version instead of dropping lines); or the specialist's started
  line on the coordinator's trace (it would consume the 12-line orchestration budget).

### OD-127 — UI placement of orchestration status, as applied (B21-E2, 2026-09-27)

- **Question:** where does the page show the DAG's status?
- **Applied:** run-log lines (each event's own sentence, through the existing run-log step) plus ONE additive status line built by
  `projectRunView` from pure counters (scheduled; finished, by a task's FINAL outcome - a withheld retry counted once by its closing
  event, a stale result never run again not finished; the degraded notices; the partial result) and written once, before the notes, when
  the run ends; null for every run with no orchestration event. The run view's additive code is appended to `chat-run-view.ts` (no line
  the discovery cites moves). No control: two in-place page lines, no JSX, no handler; the B17-A inventory regenerated with zero drift
  (628 controls), no B18-D wire, nothing under `app/components/chat`. Proven by `b21-e2-run-view.test.ts`, the route suite's cases 3 and
  7, the B17-A and B18-D gates.
- **The owner may choose otherwise:** a specialist panel with per-specialist stop or reject (a B17-A rule, a regenerated inventory and a
  B18-D gate); a status line that updates while the run streams.

### OD-112 — Per-specialist provider/model and task identity on the trace: NOT applied - stopped (B21-E2, 2026-09-27)

- **Question (as drafted):** widen the trace's provider vocabulary, or an optional closed `orchestration` block in a new module with one
  trace document per specialist task (run id `<runId>:<taskId>`, linked by `parentRunId`)?
- **Stopped:** the default cannot be accepted by the UNCHANGED v1 trace contract: every task id `task-<n>-<role>` matches the redaction
  authority's unanchored OpenAI-key pattern that the trace validator applies to every string, so a per-task document with that run id is
  `trace_validation_failure` and reaches no sink (D21-41; the probe through the real recorder and validator). The run's stop condition
  ("if the trace block cannot be accepted without editing one of the nine scanned files") applied; the implementation is held in the
  scratchpad, none of it in the tree.
- **The owner decides one of:** (A) anchor the diagnostics' `sk-` key prefix at a token start in `redaction.ts` (the B19-D model-bound
  form): the nine files untouched, the held implementation applies as written, and the coordinator trace's task ids stop reading
  `ta[redacted]` - but it narrows a shared secret check (a key embedded after a letter would no longer be flagged in diagnostics);
  (B) the per-task trace run id `<runId>:<n>-<role>` (the task id without its `task-` prefix) with the block carrying the exact task id:
  no rule narrowed, OD-112's wording amended, the held code's run-id rule adjusted; (C) a task-id grammar without `task-`: every B21
  record key, suite and page moves - not recommended; (D) editing the scanned validator: refused by D21-27 / OD-113.
- **Recommended by E2:** (B) for E2's next run - the smallest change and no rule narrowed; (A) if the owner also wants the coordinator's
  trace lines legible.

### The README row (`artifacts/ai-control-plane-b21/README.md`, a new row "B21-E2 (1/2)" after B21-E1)

| B21-E2 (1/2) the additive run events and the status line; the trace block stopped | `run-events-and-trace.md`; code `app/lib/agent/orchestration/run-events.ts` (new), `app/lib/agent/contracts.ts` (the union widened in place; the pinned list and the shapes appended), `app/lib/agent/orchestration/scheduler.ts` (the plan, status and degraded lines as events, a withheld re-run closed - in place; the import appended), `app/api/chat/orchestration-runtime.ts` (the events streamed and traced as B's lines, the stand-downs as `degraded`, the partial result judged against the merge - in place; the helper appended), `app/lib/project/chat-run-view.ts` (the counters and the status line - appended, the fields in place), `app/page.tsx` (two in-place lines and the import, no control), the workflow's one explicit entry | CONFIRMED (five additive v1 events pinned, each a closed bounded shape carrying B21-B's sentence, emitted in place of B's plan, status and stand-down warning lines while the refusal, merge and approval lines stay warnings; a withheld re-run closed by one final event; the budget remaining on every start; a replayed or stale result naming no provider; the partial result counting each task once and what the merge withheld; an undeclared key's model-chosen name withheld from every reason; the coordinator's trace B's lines plus a withheld re-run's closing line, the orchestration record unchanged; protocol 1, one terminal, flag off byte-identical; pure counters and ONE status line, older reducers ignoring the events - an OLDER page losing the plan, status and stand-down lines, RECORDED as OD-126's owner question; no control - the B17-A inventory regenerated with zero drift, the B18-D wires untouched; OD-126 and OD-127 applied; D21-22 closed; the adversarial review's 13 confirmed findings fixed test-first; 40 new cases in four suites; the moved run-log-lines helpers of twelve suites and E1's fixture and A's gate entry set, every cited line unmoved - the A..E1 pages' and the discovery's; dated E2 notes on the B, C and D2 pages) - STOPPED: the trace block (OD-112) cannot be accepted by the unchanged v1 trace contract - every task id reads as an OpenAI key to the redaction authority's unanchored pattern (D21-41, new, medium); D21-11's trace half and D21-3's calls stay open for the owner's option |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-E2 (1/2) — the additive run events and the status line; the trace block stopped (2026-09-27 local; increment workflow + lead; this commit)

- Test-first: the three E2 suites against the base with only the tests present (`e2-final-failing-first.log`: three files on the missing
  module); with the new module and the contracts but the wiring at HEAD (`e2-final-failing-first-wiring.log`: 13 of 17 failing on their
  assertions, 4 green by design); the moved suites against the E2 code with their HEAD helpers (`b21-all-1.log`: 33 of 315 failing); then
  green.
- Code: `run-events.ts` (the bounded builders, the one judge, the traced types, the closing event, the withheld key), the contracts (the
  pinned list, the statuses, the degraded reasons, the closed shapes; the union widened in place), `scheduler.ts` (the plan, a
  specialist's start with the budget remaining and its outcome, a stale result, a role with no tools, a fallback, the paused coordinator
  and the held artifact as events, a withheld re-run closed - in place), `orchestration-runtime.ts` (the events streamed and their lines
  traced as B's warnings were, every stand-down a `degraded` event, the partial result judged against the merge where it ran),
  `chat-run-view.ts` (the counters and the one status line, appended; an event's run-log line), `page.tsx` (two in-place lines: the
  run-log row and the status line; no control), the workflow's one explicit entry. No route, descriptor, UI control, request key or
  generator input changed; census 165/162/3/0; the nine scanned files byte-identical to HEAD.
- Adversarial review: 13 confirmed findings fixed test-first (`b21/e2fix/`: the new cases red first on the unfixed code, 14 of 39 in
  `red-1.log`; the pre-fix partial result reproduced by a probe on the swapped-in pre-fix files, restored by sha256; the shell-flag
  reproduction of route case 4; breakages m1-m5 of the source each failing its strengthened case, restored by sha256): the partial
  result counting a task once and what the merge withheld, a withheld re-run closed, an unrecorded provenance named as none, an
  undeclared key's name withheld, the budget remaining, every scheduler and runtime site pinned by its type and reason, the trace cap
  proven, the older page's loss recorded (OD-126), `chat-run-view.ts` made line-neutral, the flag-off case independent of the shell, the
  A..E1 pages' dated notes.
- Stopped: the trace block (OD-112) - the per-task document's run id `<runId>:<taskId>` is refused by the unchanged v1 trace contract
  (`trace.runId: contains secret-shaped content`: every task id `task-<n>-<role>` matches the diagnostics' unanchored `sk-` key pattern);
  the implementation, its suite and the probe held in the scratchpad (`b21/e2/trace-block-held/`, sha256 listed), nothing of it in the
  tree; D21-41 found with the owner's options.
- Pin moves with their reasons: A's gate cases 1, 3 and 5 (run-events.ts in the entry set, 9 -> 10); the run-log-lines helpers of
  B's scheduler, C's least privilege, D2's approval, proposing-roles and provenance, D3's scenario 17, E1's breaker and fixtures and the
  five route suites (B's lines are now the events' messages; the same sentences asserted); a dated pointer on E1's page; dated E2 notes on
  the B, C and D2 pages.
- Gates re-run one job at a time (the lead re-runs them): every B21 suite and the six route suites; `app/api/chat/__tests__` in full;
  `app/lib/agent/__tests__` in full; `app/lib/project/__tests__` with the B17-A inventory; `app/lib/llm/__tests__` and
  `app/lib/acquisition/__tests__`; `app/lib/mcp` and `app/api/mcp/__tests__`; the exposure / tier suites; tsc; eslint; the B17-A
  generator with zero drift - figures on the page.
- Records: `run-events-and-trace.md`; OD-126 and OD-127 applied (OD-126 with the older page's loss as the owner's question); OD-112 open
  with the stop; D21-22 closed; D21-41 found. Live: every B21 behaviour with a real model BLOCKED-LIVE-QUALIFICATION (LB-9).

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-E2 (1/2) committed on chapter/b21-specialist-orchestration: the additive v1 run events - plan,
specialist_started, specialist_finished, partial_result, degraded, pinned, each a closed bounded shape carrying B21-B's sentence,
emitted in place of B's plan, status and stand-down warning lines (refusal, merge and approval lines stay warnings), a withheld re-run
closed by one final event, the budget remaining on every start, the partial result judged against the merge, the coordinator's trace
B's lines plus that closing line and the orchestration record unchanged, protocol 1 with one terminal, flag off byte-identical - and the
run view's pure counters with ONE status line, no control; an older page's loss of the plan, status and stand-down lines recorded as
OD-126's owner question; the adversarial review's 13 findings fixed; the trace block STOPPED (D21-41: the unchanged v1 trace contract
reads every task id as an OpenAI key), held for the owner's option; next B21-E2 (2/2) after the owner's OD-112 option, then B21-E3".
`nextAction`: "The owner chooses OD-112's option (recommended: B, the per-task trace run id <runId>:<n>-<role>) and answers OD-126's
older-page question (the warning beside the event, or a protocol v2, or neither); then B21-E2 (2/2) applies the held trace block (the
block, the validator and cascade, the durable trace record, the book) test-first; then B21-E3: the route-level resume with the
userMessageDigest ledger (OD-122, D21-4 at the route; D21-16's route half; D21-17's live-head half), the composer's kind swap (D21-38),
and the coordinator's first turn behind the breaker (D21-39)". The report line for the closeout: `MULTI-AGENT STATUS: ...; the additive
run events and the status line (B21-E2 1/2) delivered offline behind SIRKIT_ORCHESTRATION_ENABLED; the trace block stopped for the owner
(D21-41); the route-level resume and evaluations pending (B21-E3..F); live disagreement / fallback / quota BLOCKED-LIVE-QUALIFICATION
under LB-9`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect; §10 gains a B21-E2 amendment)

- **D21-22 — Every vocabulary a DAG would need is closed and pinned: no event for a plan, a specialist, a per-specialist
  provider/model, a partial result, a budget remaining or a degraded mode; provider streaming has no production caller.** — CLOSED
  by B21-E2 (OD-126, OD-127), item by item: a plan is the `plan` event; a specialist is its `specialist_started` and
  `specialist_finished` events (a withheld re-run closed by one final `specialist_finished`); the per-specialist provider/model is on
  every `specialist_started` and every `specialist_finished` of an attempt that ran (null on a replayed or stale result, whose provenance
  the record does not keep - the merge's rule); a partial result is the `partial_result` event (each planned task counted once, a result
  the merge withheld not usable); a budget remaining is `wallTimeRemainingMs` and `outputTokensRemaining` on every `specialist_started`
  (the DAG wall time left and the output-token ceiling not yet used - reported, never priced or enforced); a degraded mode is the
  `degraded` event (ten closed reasons). A pinned list, each a closed bounded shape carrying B21-B's sentence, emitted by the scheduler
  and the runtime in place of B's plan, status and stand-down warning lines (the refusal, merge and approval lines stay warnings); the
  coordinator's trace B's lines plus a withheld re-run's closing line, the record unchanged; protocol 1, one terminal, flag off
  byte-identical; `reduceRunView`'s pure counters and ONE status line from `projectRunView`, rendered as run-log rows with no control;
  older reducers ignore the events - an older PAGE loses the plan, status and stand-down lines (OD-126's owner question)
  (`b21-e2-run-events.test.ts`, `b21-e2-run-view.test.ts`, `b21-e2-chat-events.test.ts`). RECORDED: provider streaming still has no
  production caller (the events are built from the scheduler's own outcomes, never from provider output).
- **D21-11 (provider/model identity recorded once per run, closed, pinned)** — addendum by B21-E2: the trace half is NOT closed - the
  trace block stopped (D21-41); per-specialist provider and model now reach the STREAM on every `specialist_started` and on every
  `specialist_finished` of an attempt that ran (a replayed or stale result names none: its provenance is unrecorded), never the trace.
- **D21-3 (no agent-run record persisted; tool calls not persisted)** — addendum by B21-E2: the calls half stays open - the per-task trace
  record (OD-111's carrier) stopped with the trace block (D21-41).
- **D21-41 (new, medium) — the v1 trace contract refuses every per-task run id `<runId>:<taskId>`.** The scheduler's task ids are
  `task-<n>-<role>`; the redaction authority keeps an unanchored OpenAI-key pattern (`sk-` and eight or more key characters) for
  diagnostics - B19-D anchored it for model-bound text only - and the trace validator applies it to every string, so a trace whose run
  id carries a task id is `trace_validation_failure` and never reaches a sink; the same pattern already renders every task id in the
  coordinator's trace warnings as `ta[redacted]` (since B21-B). **CONFIRMED** (the probe through the real recorder and validator,
  `run-events-and-trace.md` section 3). Blocks OD-112's per-task trace document as drafted. Closes: the owner's OD-112 option (A: anchor
  the diagnostics' key prefix in `redaction.ts`; B: a per-task trace run id without the `task-` prefix; C: a new task-id grammar - not
  recommended), then B21-E2 (2/2).
- **§10, B21-E2 (1/2) amendment:** OD-126 and OD-127 applied as `run-events-and-trace.md` states them (OD-126 with the older page's loss
  as the owner's question); D21-22 closed item by item; D21-11's trace half and D21-3's calls recorded open with the stop; D21-41 found
  (medium); A's gate entry set (run-events.ts) and the run-log-lines helpers of twelve suites and E1's fixture moved with their reasons;
  the trace block's implementation held for the owner's option; the adversarial review's 13 confirmed findings fixed test-first; the
  run view's additive code appended so every discovery citation of `chat-run-view.ts` holds its base content; the B17-A inventory
  regenerated with zero drift.
- **§0, "Unknown NDJSON events" (the dated note the lead appends to that bullet):** [B21 E2, 2026-09-27] Since B21-E2 the reducer's
  `default` (`chat-run-view.ts:147-148`) hands the five orchestration events to its appended fold and the page's `default`
  (`page.tsx:4692-4693`) renders their run-log line - no longer empty (`run-events-and-trace.md` C38, C43, C63); every other unknown type
  still changes nothing, and an older page loses the lines the five carry (OD-126's owner question).

### E2's second run (2/2): the reserved texts

[B21 E2b, 2026-09-27] The texts above are E2's first run's, as the lead applied them (e19033f, 41330e6). E2's second run's texts follow;
its OD-112 entry REPLACES the stopped one in `OWNER_DECISIONS.md`, and its README row, ledger paragraph, PROGRAM_STATE texts, discovery
clauses and section-10 lines are new.

### OD-112 — Per-specialist provider/model and task identity on the trace, as applied (B21-E2 2/2, 2026-09-27)

- **Question (as drafted):** widen the trace's provider vocabulary (breaking the b20-a4 / b20-b2 literal pins and OD-72/OD-80), or an
  optional closed `orchestration` block in a new module outside the nine scanned files, with one trace document per specialist task?
- **Applied (the default, under the lead's reading of discovery section 10, "B21-E2, run 1 of 2"):** the block, in the new module
  `app/lib/agent/orchestration/trace-attribution.ts`, with ONE trace document per specialist task. The document's run id is
  `<runId>:<n>-<role>` - the coordinator's run id, a colon, the task's index and role - and its `parentRunId` the coordinator's run id;
  the block is `{ taskIndex, role, providerId, modelId, parentRunId, decision? }`: the task's INDEX (1..32, the plan record's bound) and
  role, never the literal task id `task-<n>-<role>`, which the v1 validator reads as an OpenAI key (D21-41); the task id is
  reconstructed from index and role (`specialistTaskId`, its inverse `specialistTaskIdentity`; every scheduler task id round-trips).
  Pattern-bound and denylist-checked by ONE rule the validator and the cascade share (the B20-A4 `external` precedent's shape); the block
  rides beside the events of an unchanged v1 trace (the v1 contract refuses it inside an event); the schema stays v1 and the
  coordinator's trace keeps its closed provider literal; the 256-event cap is per document; a retry's attempts on one provider are one
  document with one terminal and an attempt on another provider opens the task's next document; the specialist's tool calls - and a
  closed line per call refused before it ran - persist on its own durable trace record `agent.orchestration-trace.v1` beside the
  orchestration run's aggregate on the same repository, bound to its scope (OD-111's carrier, D21-3's calls). No rule is narrowed: the
  redaction authority's diagnostic patterns and the nine scanned files are byte-identical to HEAD (OD-113); every string of a stored
  document is held to the orchestration string rule (a hostile character a `?`). No string of a per-task document holds the literal
  task id (proven over the whole finalized document of real specialist runs); a document that cannot be recorded is one visible warning
  line, whole on the coordinator's trace. A document with no step carries no verdict and names no model (none was reported). Proven by
  `b21-e2b-trace-attribution.test.ts`, `b21-e2b-task-identity.test.ts` and `b21-e2-chat-events.test.ts` cases 8 to 10 (the adversarial
  review's 13 findings answered test-first, section 5).
- **The owner may choose otherwise:** (A) anchor the diagnostics' `sk-` key prefix in `redaction.ts` - the coordinator trace's task ids
  would read legibly instead of `ta[redacted]`, at the cost of narrowing a shared secret check (the per-task documents need none of it);
  (C) a task-id grammar without `task-` - every B21 record key, suite and page moves, not recommended; (D) editing the scanned validator -
  refused by D21-27 / OD-113. The lead's reading of (B) stands until the owner says otherwise.

### The README row (2/2) (`artifacts/ai-control-plane-b21/README.md`, a new row "B21-E2 (2/2)" after B21-E2 (1/2))

| B21-E2 (2/2) the trace block: one trace document per specialist task | `run-events-and-trace.md` (section 3.2 onward); code `app/lib/agent/orchestration/trace-attribution.ts` (new), `app/lib/agent/orchestration/store.ts` (every durable record binds its trace store - the constructor in place, the rest appended), `app/api/chat/orchestration-runtime.ts` (the book bound - four lines in place, one of them the redaction import the review's fix widened, the helpers appended) | CONFIRMED (OD-112 applied under the lead's reading: the per-task run id `<runId>:<n>-<role>` and the block carrying the task's index and role, never the task id - D21-41 closed with no rule narrowed; one rule for the validator and the cascade; one document per specialist task with its tool calls on its own durable trace record beside the run's - D21-3's calls and D21-11's trace half closed; a retry on one provider in one document with one terminal, an attempt on another provider in the task's next document; the 256-event cap per document; a failed task's document keeping its failure (no step: no verdict, no model); a call refused before it ran a closed line on its task's document; a hostile character never stored; the record bound to its scope; an unrecorded document one visible line, whole on the coordinator's trace; no string of a per-task trace holding a task id, over the whole document of real runs; the nine scanned files and `redaction.ts` byte-identical; the coordinator's trace, the stream's events and the orchestration record unchanged; 27 new cases in three suites and three route cases, the adversarial review's 13 findings answered test-first; A's gate and store pins and the E2 page's heading pin moved in place with their reasons) |

### The ledger paragraph (2/2) (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-E2 (2/2) — the trace block: one trace document per specialist task (2026-09-27 local; increment workflow + lead; this commit)

- Held work: the E2 run-1 trace-block files verified against `held.sha256` (eight OK) and applied adapted to the lead's reading of OD-112.
- Test-first: the two new suites and the route suite's two new cases against HEAD 41330e6 with only the tests
  (`e2b-failing-first-tests-only.log`: three files on the missing module); with the module but the store and runtime at HEAD
  (`e2b-failing-first-module-no-wiring.log`: 7 of 20 failing on the missing wiring, 13 green by design); then green; the moved pins
  failing first on their old values (`e2b-green-2-with-A-pins.log`, `b21-all-1.log`); the page suite against the page without E2b's
  sections (`e2b-page-failing-first.log`: 6 of 7).
- Code: `trace-attribution.ts` (new: the task identity and its round trip, the closed block and its one rule, the validator, the cascade,
  the durable trace record, the book), `store.ts` (every durable record binds its trace store on its own repository; the constructor in
  place, the rest appended), `orchestration-runtime.ts` (the book bound, the injected loop wrapped, every document appended before
  anything is handed on, an unrecorded document one visible line - four lines in place, one the redaction import the review's fix
  widened, the helpers appended). No route, descriptor,
  request key, run-event type, UI or generator input changed; census 165/162/3/0; the nine scanned files and `redaction.ts`
  byte-identical to HEAD.
- Pin moves with their reasons: A's gate cases 1, 3 and 5 (trace-attribution.ts in the entry set, 10 -> 11); A's store case 12 (its
  import list + `./trace-attribution`); the E2 page's case 1 (section 3's heading names the stop and the application); the E2 page's
  route-suite row (7 -> 10).
- Review (E2b fix): the adversarial review's 13 confirmed findings answered test-first (`b21/e2b-fix/red-1.log`: 5 of 26 failing on
  their findings; six deliberate breakages each caught and restored by sha256; `green-1.log` 29 of 29): an attempt on another provider
  opens the task's next document (reachable - the scheduler routes every attempt again) instead of running untraced; every string of a
  stored document held to the orchestration string rule (a NUL or lone surrogate no longer fails the jsonb commit); the record bound to
  its scope; a call refused before it ran one closed line on its task's document (D21-12's addendum); the unrecorded line whole on the
  coordinator's trace (bounded by construction); the zero-step document's verdict and model claims corrected; eight new trace-attribution
  cases, one route case, one page case.
- Gates re-run one job at a time after the review's fixes (the lead re-runs them): every B21 suite with the six route suites (41
  files, 372 of 372); `app/api/chat/__tests__` (130 of 130); `app/lib/agent/__tests__` (415 of 415); `app/lib/project/__tests__` with
  `app/components/chat` (312 of 312); the B17-A inventory with the exposure and tier suites (130 of 130); `app/lib/llm` and
  `app/lib/acquisition` (235 of 235, one opt-in live file skipped); `app/lib/mcp` and `app/api/mcp/__tests__` (920 of 920); tsc 0;
  eslint clean on the 11 changed and new TypeScript files; the B11, B09 and B17-A generators with zero drift - figures on the page.
- Records: `run-events-and-trace.md` (section 3.1 to 3.7, E2b's rows and citations, these texts); OD-112 applied under the lead's
  reading; D21-11's trace half, D21-3's calls half and D21-41 closed. Live: BLOCKED-LIVE-QUALIFICATION (LB-9) - no model is called.

### PROGRAM_STATE.json (2/2) (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-E2 (2/2) committed on chapter/b21-specialist-orchestration: the trace block under the lead's reading of
OD-112 - one trace document per specialist task, its run id <runId>:<n>-<role>, the closed block carrying the task's index and role and
never the task id (D21-41 closed, no rule narrowed), one rule for the validator and the cascade, the specialist's tool calls on its own
durable trace record beside the orchestration run's (D21-3's calls, D21-11's trace half), a retry on one provider in one document and
an attempt on another in the task's next, a call refused before it ran a closed line, 256 events per document, an unrecorded document
one visible line, every stored string held to the orchestration string rule, the nine scanned files and redaction.ts byte-identical;
the adversarial review's 13 findings answered; next B21-E3".
`nextAction`: "B21-E3: the route-level resume with the userMessageDigest ledger (OD-122, D21-4 at the route; D21-16's route half;
D21-17's live-head half), the composer's kind swap (D21-38), and the coordinator's first turn behind the breaker (D21-39); OD-126's
older-page question and OD-112's option A (legible task ids on the coordinator's trace) stay with the owner". The report line for the
closeout: `MULTI-AGENT STATUS: ...; the additive run events and the status line (B21-E2 1/2) and the per-task trace documents with the
specialists' tool calls on their own durable records (B21-E2 2/2) delivered offline behind SIRKIT_ORCHESTRATION_ENABLED; the route-level
resume and evaluations pending (B21-E3..F); live disagreement / fallback / quota BLOCKED-LIVE-QUALIFICATION under LB-9`.

### Discovery closure clauses (2/2) (`discovery.md` §4, appended to each defect; §10 gains a "B21-E2, run 2 of 2" amendment)

- **D21-11 — Provider/model identity is recorded once per run, closed to `openai | anthropic`, pinned literally, and not carried
  uniformly by the artifacts a merge layer would compare.** — the trace half CLOSED by B21-E2 (2/2) (OD-112 as the lead read it): every
  specialist task that ran has its own v1 trace document, run id `<runId>:<n>-<role>`, whose provider is the one its attempt ran on and
  whose every step and tool invocation carries the closed block `{ taskIndex, role, providerId, modelId, parentRunId, decision? }` -
  the provider and the model per specialist on the trace, linked to the coordinator's run - a specialist on another provider than the
  coordinator records on its own (case 9), and an attempt on another provider opens the task's next document (case 10); a document with
  no step or tool invocation names no model and carries no verdict (none was reported: its terminal keeps the failure and the
  orchestration record the verdict, case 16); the coordinator's trace keeps its closed provider literal (the b20-a4 / b20-b2 pins green,
  OD-72/OD-80 unchanged) (`b21-e2b-trace-attribution.test.ts` cases 1 to 5, 9, 10 and 16, `b21-e2-chat-events.test.ts` case 8).
- **D21-3 — No agent-run record is persisted anywhere; there is no "immutable trace" to resume from.** — the calls half CLOSED by
  B21-E2 (2/2): each specialist task's tool calls (identities and digests, as every trace holds them) and each call its loop refused
  before it ran (a closed line) are persisted on its own durable trace record `agent.orchestration-trace.v1` beside
  `agent.orchestration-run.v1` on the same repository - validated, digest-bound, bound to its scope, idempotent by trace id, re-validated
  on every load, no outbox effect; the run's own record unchanged (`b21-e2b-trace-attribution.test.ts` cases 4, 6, 12, 13 and 15, route
  case 8). The route-level resume that reads records back after a refresh stays B21-E3's (D21-4).
- **D21-12 — Pre-invocation refusals are untraced, `verification` is free text, and no traced field carries assumptions, evidence,
  decisions, dissent or a source/model correlation key.** — addendum by B21-E2 (2/2): a SPECIALIST's pre-invocation refusals are traced
  now - each call its loop refused before it ran is ONE closed line on its task's own per-task trace document (`refusedCallLine`: the
  registry's tool id or none and the closed status, never a task id or the arguments; `b21-e2b-trace-attribution.test.ts` case 15),
  persisted on its durable trace record; the coordinator's own loop's refusals stay untraced `tool_refused` events (`loop.ts` unchanged),
  `verification` stays free text, and no traced field carries assumptions, evidence, decisions, dissent or a correlation key beyond the
  block's provider and model per step - those stay open.
- **D21-41 — The v1 trace contract refuses every per-task run id `<runId>:<taskId>`.** — CLOSED by B21-E2 (2/2) under the lead's
  reading of option B: the per-task run id is `<runId>:<n>-<role>` and the block carries the task's index and role, never the literal task
  id, which is reconstructed from them (`specialistTaskId`; every scheduler task id round-trips); no rule narrowed and no scanned file
  edited - the literal run id is still refused through the real recorder and validator for every task of every DAG and the index-and-role
  run id accepted, and no string of a real specialist's finalized trace or durable record holds `task-<n>-`
  (`b21-e2b-task-identity.test.ts` cases 1 to 3). RECORDED: the coordinator trace's task ids still read `ta[redacted]` (option A is the
  owner's).
- **§10, "B21-E2, run 2 of 2" (recorded by the lead, 2026-09-27):** Section 4: D21-11's trace half, D21-3's calls half and D21-41 closed.
  Section 6: OD-112 applied as `run-events-and-trace.md` section 3.2 states it (the lead's reading: the per-task run id
  `<runId>:<n>-<role>`, the block's index and role). Section 7, B21-E2 (2/2): as built - the held trace block applied adapted
  (`trace-attribution.ts`; the record's trace store; the book in the runtime, settled with the scheduler's outcome after it returns, so
  the runtime line that streams the events is untouched); A's gate and store pins and the E2 page's heading pin moved in place with their
  reasons. Section 8: the book input's `systemPromptVersion` (D3's pin-facts case reads the runtime from `specialistGatewayOptions(` to
  its end and forbids the gateway option's name there). The adversarial review of E2's second run: 13 confirmed findings answered
  test-first (`run-events-and-trace.md` section 5, "The review's findings (E2b)") - an attempt on another provider is reachable and
  opens the task's next document; every stored string held to the orchestration string rule; the trace record bound to its scope; a
  specialist's pre-invocation refusals traced as closed lines (D21-12's addendum); the unrecorded line whole on the coordinator's trace;
  a document with no step carries no verdict and names no model.

## 7. Citations, as of base 3a32317

The anchor is what is checked (it occurs exactly once in its file). For every file E2 changed the line is the CURRENT line and page
case 5 checks it; for every other file the line is the base's (unchanged by E2). [B21 E2b] Rows C67 onward are E2's second run's, their
lines current in E2b's tree; `b21-e2b-page.test.ts` case 5 checks them for every production file E2b changed.

| # | file | line | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/agent/contracts.ts` | 447 | — | `OrchestrationRunEvent; /** [B21 E2] the five additive v1 events` | the chat protocol's closed union, widened in place by the five |
| C2 | `app/lib/agent/contracts.ts` | 475 | — | `export const ORCHESTRATION_RUN_EVENT_TYPES = Object.freeze(` | the PINNED list of the five additive v1 events |
| C3 | `app/lib/agent/contracts.ts` | 479 | — | `export const SPECIALIST_FINISHED_STATUSES = Object.freeze(` | a finished attempt's closed statuses |
| C4 | `app/lib/agent/contracts.ts` | 482 | — | `export const DEGRADED_REASONS = Object.freeze([` | the closed degraded reasons |
| C5 | `app/lib/agent/contracts.ts` | 489 | — | `export type OrchestrationRunEvent =` | the five closed shapes |
| C6 | `app/lib/agent/contracts.ts` | 496 | — | `export function isOrchestrationRunEventType(` | the one membership test the run view and the page read |
| C7 | `app/lib/agent/orchestration/run-events.ts` | 25 | — | `export const RUN_EVENT_BOUNDS = Object.freeze({` | the bounds every builder applies |
| C8 | `app/lib/agent/orchestration/run-events.ts` | 39 | — | `export const RUN_EVENT_KEYS:` | each type's closed key set |
| C9 | `app/lib/agent/orchestration/run-events.ts` | 50 | — | `export const RUN_EVENT_TRACE_TYPES:` | the events whose line the coordinator's trace records, as B recorded the warning |
| C10 | `app/lib/agent/orchestration/run-events.ts` | 60 | — | `export function boundedRunEventText(` | one run-log line: the model-bound redactor, one line, bounded |
| C11 | `app/lib/agent/orchestration/run-events.ts` | 82 | — | `export function planEvent(` | the plan event |
| C12 | `app/lib/agent/orchestration/run-events.ts` | 93 | — | `export function specialistStartedEvent(` | one attempt reaching its provider |
| C13 | `app/lib/agent/orchestration/run-events.ts` | 106 | — | `export function specialistFinishedEvent(` | an attempt's outcome, B's status line as its message |
| C14 | `app/lib/agent/orchestration/run-events.ts` | 111 | — | `export function staleResultEvent(` | a committed result the resume runs again |
| C15 | `app/lib/agent/orchestration/run-events.ts` | 131 | — | `export function degradedEvent(` | a degradation, run-wide or of one planned specialist |
| C16 | `app/lib/agent/orchestration/run-events.ts` | 143 | — | `export function partialResultEvent(` | the partial result: per task its last attempt decides |
| C17 | `app/lib/agent/orchestration/run-events.ts` | 178 | — | `export function orchestrationRunEventIssue(` | the judge: exact keys, ids, roles, bounds, no credential-shaped value |
| C18 | `app/lib/agent/orchestration/scheduler.ts` | 395 | — | `const report = (event: OrchestrationRunEvent): void => { deps.emit(event);` | the scheduler's event channel beside its warning channel (it also tracks the task's open re-run promise) |
| C19 | `app/lib/agent/orchestration/scheduler.ts` | 440 | — | `report(planEvent({ runId: coordinator.runId, rule: plan.rule, tasks,` | the plan line as the plan event; the held artifact as a degraded event |
| C20 | `app/lib/agent/orchestration/scheduler.ts` | 432 | — | `for (const task of toolless) report(degradedEvent(` | a planned role with no tools: degraded, never scheduled |
| C21 | `app/lib/agent/orchestration/scheduler.ts` | 473 | — | `report(staleResultEvent(coordinator.runId,` | a stale committed result: specialist_finished stale, runs again |
| C22 | `app/lib/agent/orchestration/scheduler.ts` | 494 | — | `report(degradedEvent(coordinator.runId, "provider_paused", coordinatorPausedLine(` | the coordinator's paused provider: one run-wide degraded event |
| C23 | `app/lib/agent/orchestration/scheduler.ts` | 504 | — | `if (route?.fallbackFrom) report(degradedEvent(coordinator.runId, "compatible_fallback",` | a compatible fallback: degraded, naming the provider and model it runs on |
| C24 | `app/lib/agent/orchestration/scheduler.ts` | 548 | — | `report(specialistStartedEvent({ runId: coordinator.runId, taskId: task.taskId,` | one specialist_started per attempt that reaches the provider layer |
| C25 | `app/lib/agent/orchestration/scheduler.ts` | 562 | — | `refused: ${event.status}.` | a refused tool call of a specialist stays a WARNING line |
| C26 | `app/lib/agent/orchestration/scheduler.ts` | 631 | — | `, retry));` | a retried attempt: runsAgain |
| C27 | `app/lib/agent/orchestration/scheduler.ts` | 163 | — | `export function specialistRunId(coordinatorRunId: string, taskId: string): string {` | the specialist run id <coordinatorRunId>:<taskId> (the trace block's mandated run id); [E2b] the per-task TRACE run id is <runId>:<n>-<role> instead (C72) |
| C28 | `app/lib/agent/orchestration/scheduler.ts` | 161 | — | `return roles.filter((role) => role !== "coordinator").map((role, index) => ({ taskId:` | task ids are task-<n>-<role> |
| C29 | `app/api/chat/orchestration-runtime.ts` | 201 | — | `let traceLines = 0; const report = (event: OrchestrationRunEvent, always = false): void =>` | the runtime's event channel: the event streamed, its line traced exactly as B's warning was |
| C30 | `app/api/chat/orchestration-runtime.ts` | 231 | — | `if (reason !== null) report(reason, true); const partial = ranOutcome ?` | a stand-down: its degraded event, then the run's partial result |
| C31 | `app/api/chat/orchestration-runtime.ts` | 246 | — | `else if (isOrchestrationRunEvent(event)) report(event);` | the scheduler's events streamed through the runtime |
| C32 | `app/api/chat/orchestration-runtime.ts` | 251 | — | `return standDown(down("no_specialist_ran",` | no specialist ran: degraded |
| C33 | `app/api/chat/orchestration-runtime.ts` | 255 | — | `return standDown(down("provider_outage",` | a provider outage: degraded |
| C34 | `app/api/chat/orchestration-runtime.ts` | 292 | — | `return standDown(down("follow_up_failed",` | the follow-up turn failed: degraded |
| C35 | `app/api/chat/orchestration-runtime.ts` | 294 | — | `const partial = partialOutcomeEvent(request.runId, plan, outcome, true, merged); if (partial) report(partial);` | the follow-up answered over a partial set: said so before the terminal |
| C36 | `app/api/chat/orchestration-runtime.ts` | 262 | — | `for (const line of merged.lines) warn(line);` | a merge line stays a warning |
| C37 | `app/api/chat/orchestration-runtime.ts` | 511 | — | `export function partialOutcomeEvent(` | the partial result against the plan's tasks, judged against the merge's decisions where it ran |
| C38 | `app/lib/project/chat-run-view.ts` | 148 | — | `// [B21 E2] the additive v1 orchestration events (OD-126): counters only` | the reducer's default hands the five to the appended fold (C63) |
| C39 | `app/lib/project/chat-run-view.ts` | 555 | — | `return event.runsAgain === false && event.status !== "stale" ?` | finished counts a task by its FINAL outcome (a stale result never run again is not finished) |
| C40 | `app/lib/project/chat-run-view.ts` | 573 | — | `export function orchestrationStatusLine(state: RunViewState)` | the ONE status line (OD-127) |
| C41 | `app/lib/project/chat-run-view.ts` | 183 | — | `status: orchestrationStatusLine(state),` | the projection's additive field |
| C42 | `app/lib/project/chat-run-view.ts` | 585 | — | `export function orchestrationRunLogLine(` | an event's run-log line: its own sentence |
| C43 | `app/page.tsx` | 4926 | — | `{ const line = orchestrationRunLogLine(event); if (line) appendActivityStep(logId, line.text, line.status); return; }` | the page's default branch: a run-log line, no control |
| C44 | `app/page.tsx` | 4973 | — | `for (const note of [...(projected.status ? [projected.status] : []), ...projected.notes]) appendActivityStep(logId, note, "done");` | the status line, once, before the notes |
| C45 | `app/api/chat/route.ts` | 48 | — | `export const CHAT_PROTOCOL_VERSION = 1;` | protocol version 1 stands |
| C46 | `app/api/chat/route.ts` | 491 | — | `JSON.stringify({ v: CHAT_PROTOCOL_VERSION, seq, ...event })` | every event, the five included, in the v1 envelope |
| C47 | `app/lib/agent/trace.ts` | 626 | — | `const secretPath = findSecretShapedPath(trace, "trace");` | the v1 trace validator scans every string (the run id included) |
| C48 | `app/lib/agent/redaction.ts` | 20 | — | `/sk-[A-Za-z0-9_-]{8,}/g, // OpenAI-style keys` | the UNANCHORED key prefix the diagnostics keep: it matches task-1-... |
| C49 | `app/lib/agent/redaction.ts` | 44 | — | `const MODEL_BOUND_SECRET_PATTERNS: readonly RegExp[]` | the anchored variant (B19-D), for model-bound text only |
| C50 | `app/lib/agent/trace-recorder.ts` | 586 | — | `if (issues.length > 0) {` | an invalid trace is classified and never handed to a sink |
| C51 | `.github/workflows/deterministic-manufacturing.yml` | 151 | — | `app/api/chat/__tests__/b21-e2-chat-events.test.ts` | the route suite's one explicit CI entry [B24-D1, 2026-10-09] re-pinned +1: B24-D1's prompt-to-gerber start step at `:32` (OD-30) |
| C52 | `app/lib/agent/orchestration/run-events.ts` | 117 | — | `export function notRunAgainEvent(` | [fix] a re-run promised and withheld: the same outcome, final (runsAgain false) |
| C53 | `app/lib/agent/orchestration/scheduler.ts` | 395 | — | `const settle = (why: SchedulerStop): void => { if (open) report(notRunAgainEvent(open, why)); };` | [fix] the scheduler closes an open promise with the stop that withheld it |
| C54 | `app/lib/agent/orchestration/scheduler.ts` | 451 | — | `for (const task of tasks) { settle(stop);` | [fix] the previous task's withheld re-run closed before anything of the next |
| C55 | `app/lib/agent/orchestration/scheduler.ts` | 647 | — | `settle(stop); return { kind: "ran", tasks: outcomes,` | [fix] the last task's withheld re-run closed before the outcome returns |
| C56 | `app/lib/agent/orchestration/run-events.ts` | 52 | — | `export const UNDECLARED_KEY_WITHHELD =` | [fix] what an undeclared key's path reads in a reason and a line |
| C57 | `app/lib/agent/orchestration/run-events.ts` | 71 | — | `function withoutModelKey(text: string): string {` | [fix; lead] a refusal path not made only of declared key names replaced whole (a model-chosen key name never repeated) |
| C58 | `app/api/chat/orchestration-runtime.ts` | 218 | — | `let judged: Extract<MergeOutcome, { kind: "merged" }>` | [fix] the merge's outcome once it recorded (the post-merge stand-downs read it) |
| C59 | `app/api/chat/orchestration-runtime.ts` | 262 | — | `for (const line of merged.lines) warn(line); judged = merged;` | [fix] set where the merge recorded its decisions |
| C60 | `app/api/chat/orchestration-runtime.ts` | 512 | — | `const withheld = merged ? merged.tasks.filter((task) => task.decision !== "accepted")` | [fix] a result the merge did not accept is withheld, never usable |
| C61 | `app/lib/agent/orchestration/merge.ts` | 945 | — | `provider: entry.task.status === "replayed" ? null : entry.task.provider` | the merge's rule: a replayed result's provider is unrecorded (null) |
| C62 | `app/lib/agent/orchestration/run-events.ts` | 207 | — | `const unrecorded = type === "specialist_finished" && (record.status === "replayed"` | [fix] the judge: no provider for an unrecorded provenance, a provider for an attempt that ran |
| C63 | `app/lib/project/chat-run-view.ts` | 550 | — | `function reduceOrchestrationEvent(state: RunViewState, event: Record<string, unknown>): RunViewState {` | [fix] the run view's orchestration fold, appended (no discovery-cited line moves) |
| C64 | `app/lib/agent/orchestration/scheduler.ts` | 548 | — | `wallTimeRemainingMs: remainingMs, outputTokensRemaining: Math.max(0, outputTokenCeiling - outputTokensUsed)` | [fix] the budget remaining on every start (D21-22) |
| C65 | `app/lib/agent/orchestration/run-events.ts` | 151 | — | `const notStarted = new Set(input.notStarted.map((task) => task.taskId).filter((taskId) => !last.has(taskId))).size;` | [fix] a task counted once: not started only when it has no outcome |
| C66 | `app/lib/agent/orchestration/run-events.ts` | 226 | — | `return "counts: the parts exceed the planned tasks";` | [fix] the judge refuses a partial result whose parts exceed the plan |
| C67 | `app/lib/agent/orchestration/trace-attribution.ts` | 47 | — | `export const ORCHESTRATION_TRACE_BLOCK_KEYS = Object.freeze(` | [E2b] the block's closed keys: the task's index and role, never its id |
| C68 | `app/lib/agent/orchestration/trace-attribution.ts` | 50 | — | `export const TRACE_BLOCK_DECISIONS = Object.freeze(` | [E2b] the scheduler's three verdicts a document ends with |
| C69 | `app/lib/agent/orchestration/trace-attribution.ts` | 63 | — | `export const MAX_TASK_INDEX = ORCHESTRATION_BOUNDS.maxArrayEntries;` | [E2b] the index bound: the plan record's bound on its tasks |
| C70 | `app/lib/agent/orchestration/trace-attribution.ts` | 84 | — | `export function specialistTaskId(` | [E2b] the task id reconstructed from index and role |
| C71 | `app/lib/agent/orchestration/trace-attribution.ts` | 89 | — | `export function specialistTaskIdentity(` | [E2b] its inverse: every scheduler task id round-trips |
| C72 | `app/lib/agent/orchestration/trace-attribution.ts` | 95 | — | `export function specialistTraceRunId(` | [E2b] the per-task trace run id <runId>:<n>-<role> |
| C73 | `app/lib/agent/orchestration/trace-attribution.ts` | 101 | — | `export function specialistTraceIdentity(` | [E2b] its inverse (the parent before the last colon) |
| C74 | `app/lib/agent/orchestration/trace-attribution.ts` | 99 | — | `const isParentRunId = ` | [E2b] the parent run id: the id grammar and the v1 trace's own secret rule |
| C75 | `app/lib/agent/orchestration/trace-attribution.ts` | 123 | — | `export function orchestrationBlockIssue(` | [E2b] the ONE rule the validator and the cascade share |
| C76 | `app/lib/agent/orchestration/trace-attribution.ts` | 158 | — | `if (!identity) return ["document.trace.runId: is not <parentRunId>:<taskIndex>-<role>"];` | [E2b] the validator: the trace's run id names the task |
| C77 | `app/lib/agent/orchestration/trace-attribution.ts` | 161 | — | `const secretPath = findSecretShapedPath(attribution, "document.attribution");` | [E2b] the attribution under the trace's own secret rule |
| C78 | `app/lib/agent/orchestration/trace-attribution.ts` | 204 | — | `export function validateOrchestrationTrace(` | [E2b] the validator |
| C79 | `app/lib/agent/orchestration/trace-attribution.ts` | 221 | — | `export function attributeSpecialistTrace(` | [E2b] the cascade |
| C80 | `app/lib/agent/orchestration/trace-attribution.ts` | 226 | — | `if (trace.runId !== specialistTraceRunId(identity.parentRunId, identity.taskIndex, identity.role))` | [E2b] the cascade attributes only the task of the trace's run id |
| C81 | `app/lib/agent/orchestration/trace-attribution.ts` | 254 | — | `export const ORCHESTRATION_TRACE_AGGREGATE_TYPE = ` | [E2b] the durable trace aggregate |
| C82 | `app/lib/agent/orchestration/trace-attribution.ts` | 278 | — | `export class DurableOrchestrationTraceStore implements` | [E2b] the durable trace record (D21-3's calls) |
| C83 | `app/lib/agent/orchestration/trace-attribution.ts` | 293 | — | `const record: OrchestrationTraceRecord = {` | [E2b] a record names the parent run, the task's index and role - never its id |
| C84 | `app/lib/agent/orchestration/trace-attribution.ts` | 272 | — | `throw new Error("AGENT_ORCHESTRATION_TRACE_MISMATCH");` | [E2b] the one mismatch sentence of a load |
| C85 | `app/lib/agent/orchestration/trace-attribution.ts` | 349 | — | `export function specialistTraceBook(` | [E2b] the book: one document per specialist task |
| C86 | `app/lib/agent/orchestration/trace-attribution.ts` | 364 | — | `runId: specialistTraceRunId(input.coordinatorRunId, task.taskIndex, task.role), traceId: input.newTraceId()` | [E2b] a task's own recorder under the per-task run id |
| C87 | `app/lib/agent/orchestration/trace-attribution.ts` | 374 | — | `if (property === "recordTerminal") return` | [E2b] the held terminal: a retry's attempts in one document |
| C88 | `app/lib/agent/orchestration/trace-attribution.ts` | 409 | — | `if (handle && handle.provider !== request.provider) { close(handle, undefined); handle = undefined; }` | [E2b; fix: security-3, re-anchored] an attempt on another provider closes the task's document without a verdict and opens its next one |
| C89 | `app/lib/agent/orchestration/trace-attribution.ts` | 419 | — | `close(handle, status !== undefined` | [E2b] settle: the task's last document closed with its task's last outcome |
| C90 | `app/lib/agent/orchestration/store.ts` | 268 | — | `constructor(private readonly workflow: DurableWorkflowRepository) { TRACE_STORES.set(this, new DurableOrchestrationTraceStore(workflow)); }` | [E2b] every durable record binds its trace store on the same repository (in place) |
| C91 | `app/lib/agent/orchestration/store.ts` | 372 | — | `export function orchestrationTraceStoreOf(` | [E2b] the record's trace store, and nothing else of the repository (appended) |
| C92 | `app/api/chat/orchestration-runtime.ts` | 239 | — | `const book = specialistTraceBookFor({ request, context: deps.context, plan` | [E2b] the runtime binds the book (in place of a comment line) |
| C93 | `app/api/chat/orchestration-runtime.ts` | 247 | — | `runLoop: book ? book.loop(runAgentLoop) : runAgentLoop` | [E2b] the injected loop wrapped (in place) |
| C94 | `app/api/chat/orchestration-runtime.ts` | 250 | — | `const traced = book ? await book.settle(outcome.kind === "ran" ? outcome.tasks : []) : null;` | [E2b] every document appended before anything is handed on; a failure one line (in place of a comment line) |
| C95 | `app/api/chat/orchestration-runtime.ts` | 529 | — | `export function specialistTraceBookFor(` | [E2b] the book on the record's own repository (appended) |
| C96 | `app/api/chat/orchestration-runtime.ts` | 541 | — | `export function traceUnrecordedLine(` | [E2b] the one line of documents not recorded (appended; [fix] re-pinned: its comment grew) |
| C97 | `app/lib/agent/orchestration/trace-attribution.ts` | 114 | — | `const TEXT_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;` | [E2b fix: security-1] the one text rule: control, format, separator, lone surrogate (in place) |
| C98 | `app/lib/agent/orchestration/trace-attribution.ts` | 162 | — | `const textPath = forbiddenTextPath(document, "document");` | [E2b fix: security-1] the validator holds the WHOLE document to it (in place) |
| C99 | `app/lib/agent/orchestration/trace-attribution.ts` | 223 | — | `const trace = cleanTraceText(recorded);` | [E2b fix: security-1] the cascade attributes the cleaned trace (in place) |
| C100 | `app/lib/agent/orchestration/trace-attribution.ts` | 285 | — | `!sameTraceScope(input.document.trace.scope, scope)` | [E2b fix: regressions-2] an append bound to its scope (in place) |
| C101 | `app/lib/agent/orchestration/trace-attribution.ts` | 318 | — | `!sameTraceScope(record.document.trace.scope, traceScope(scope))` | [E2b fix: regressions-2] a load bound to its scope (in place) |
| C102 | `app/lib/agent/orchestration/trace-attribution.ts` | 411 | — | `emit: withRefusalLines(handle.recorder, deps.emit)` | [E2b fix: coverage-2] the attempt's events: a refused call a line on its document (in place) |
| C103 | `app/lib/agent/orchestration/trace-attribution.ts` | 434 | — | `function forbiddenTextPath(` | [E2b fix: security-1] the first key or string breaking the text rule (appended) |
| C104 | `app/lib/agent/orchestration/trace-attribution.ts` | 447 | — | `function cleanTraceText(` | [E2b fix: security-1] every such character a `?`, `trace_input_normalized` added (appended) |
| C105 | `app/lib/agent/orchestration/trace-attribution.ts` | 455 | — | `function sameTraceScope(` | [E2b fix: regressions-2] a trace's scope IS the record's (appended) |
| C106 | `app/lib/agent/orchestration/trace-attribution.ts` | 464 | — | `export function refusedCallLine(` | [E2b fix: coverage-2] a call refused before it ran: one closed line (appended) |
| C107 | `app/lib/agent/orchestration/trace-attribution.ts` | 468 | — | `function withRefusalLines(` | [E2b fix: coverage-2] each `tool_refused` recorded as its line, passively (appended) |
| C108 | `app/api/chat/orchestration-runtime.ts` | 544 | — | `while (shown > 0 && line(shown).length > DEFAULT_REDACTION_CHARS) shown -= 1;` | [E2b fix: regressions-3] the unrecorded line bounded by construction (appended) |
