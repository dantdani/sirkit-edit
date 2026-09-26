# B21-B — the task-complexity router, the deterministic no-provider path, the bounded sequential scheduler, the store binding

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `4b6d0e2` (the B21-A commit); written 2026-09-26, revised the same day after the
adversarial review (the review's confirmed findings and what changed for each are in section 6). Every `[B21 B]` statement below is
pinned by `b21-b-page.test.ts` (the rule table and the caps table are compared to the router's and the scheduler's data, the
vocabularies are quoted from the code, every citation resolves by content exactly once, the cited line of every new module is current,
every suite row carries its real `it(` count) or by the suite it names. B implements against the provider facts recorded in
`provider-reference-notes.md` (OD-118) and touches no provider feature (no request key, no adapter behaviour, no model choice; the
adapters' `MAX_OUTPUT_TOKENS` is now exported as data only), so no page was re-read in this increment; no model is called anywhere in
B's suites — every provider is a scripted in-process adapter behind the existing provider-neutral runtime.

## 0. What B delivers, and what it is not

- `app/lib/agent/orchestration/router.ts` — the deterministic task-complexity router (OD-110): a pure function over the user message
  and five server-derived run facts (a schematic, a board, the actor's role, the autonomy setting, the selection) returning a closed
  `RoutePlan` — `single` (today's one-coordinator-turn path, unchanged), `refused` (a Tier 3 ask, NO provider call) or `dag` (one of the
  runbook's complex shapes with its role list pinned as data). The grammar is a closed set of phrase rules (section 1); no model, no
  randomness, no clock, no environment read, no tool id (the suite reads the module as text); the replacement rule is the composer's
  own pairing, imported (C35). **CONFIRMED** by `b21-b-router.test.ts` (7 cases; every case failed before the module existed:
  `Cannot find module '../router'`, `b-failing-first.log`; the review's cases failed first in `b-fix-failing-first.log`).
- `app/api/chat/orchestration-runtime.ts` — the one runtime seam (OD-110, OD-111), OUTSIDE the gated prefix by design: the production
  factory binds `DurableOrchestrationRunStore` to `getDurableWorkflowRepository()` (PostgreSQL in production; under the fixture runtime
  the in-memory repository the dev server hosts — proven by route case 7), a test setter, a reset, a never-throwing resolve that yields
  A's UNAVAILABLE store when the factory throws; the router and the scheduler are resolved through the same pattern (one factory per
  seam, the four sibling `*-runtime.ts` files' pattern). It builds the SPECIALIST gateway with no minter, no port and no prompt version
  (C46), narrows the follow-up coordinator turn's deps by construction (C44) and drives the DAG path (section 4). This closes A's stated
  deviation ("no runtime binds the store in A"). **CONFIRMED** (route cases 4, 5, 7, 9, 14).
- `app/lib/agent/orchestration/scheduler.ts` — the bounded, sequential scheduler (OD-107, OD-122): specialists ONE AT A TIME as separate
  loop runs under `<coordinatorRunId>:<taskId>`, each under a `SpecialistRequest` A's contracts validate whose `allowedToolIds` IS the
  advertised set, every plan / request / result / dissent written to the record BEFORE the next task starts under the attempt-keyed
  idempotency key; resume with a revision check, cancellation, the caps, the retry rule, the DAG wall time, the per-task deadline, the
  reported token ceiling and the per-attempt meter (section 3). **CONFIRMED** by `b21-b-scheduler.test.ts` (14 cases, over the REAL
  loop, the REAL gateway and the production registry through the B18-C harness composition, with the in-memory durable repository;
  every case failed before the module existed, and every review case failed first).
- The chat route wiring, minimal and flag-gated (section 4): the router runs BEFORE the adapter is built; `refused` answers with no
  provider call; `single` is exactly today's call; `dag` runs the coordinator turn as today, then the specialists, then one READ-ONLY
  follow-up coordinator turn — one stream, one `run_started`, one terminal event that reports the run's totals, no new run event. Flag
  off, the route is byte-identical to HEAD. **CONFIRMED** by `app/api/chat/__tests__/b21-b-chat-router.test.ts` (15 cases; the flag-off
  streams were RECORDED from HEAD `4b6d0e2` before the route changed, `b-record-head.log`, and pinned as literals and digests; the suite
  empties `DATABASE_URL` before every request so the shell it runs in never decides an outcome, C53).
- `POST /api/schematic/build-multi` untouched and tripwired (OD-106; section 5): its source hash pinned against HEAD in this page and in
  the route suite; A's import gate already forbids importing it from an orchestration module. **CONFIRMED** (route case 6).
- This page, pinned by `b21-b-page.test.ts` (7 cases), with the reserved texts written out in section 7.

Closes **D21-5** (the task-complexity router on the chat path; `build-multi` scoped out and tripwired — OD-106), **D21-6** (the caps:
agents, parallelism, tokens reported, wall time — OD-107) and **D21-17**'s wall-time clause (the DAG wall time 300 000 ms ≤ the
10-minute proposal TTL minus the 2-minute approval window, so nothing the DAG produces expires before the human sees it); closes
**D21-4 IN PART** — at the scheduler: a scheduler started again for the SAME coordinator run id and scope replays committed results and
never re-runs them (scheduler cases 5 and 13); the chat route mints a fresh run id per POST and never resumes one, so the human's Retry
after an outage is a NEW run whose specialists run (and are paid) again — the route-level resume stays open for B21-E (section 4);
closes A's deviation (the store is bound by the composition root); finds **D21-33** (section 5): the loop's own import closure reaches
`app/lib/pcb/fab/presets` through the read bindings, so the scheduler takes the loop by injection.

**Not in B** (the B21-B task; the increment plan §7): no per-role tool subset and no `deriveSpecialistContext` hardening beyond the
scheduler's own narrowing (B21-C — in B a specialist can only READ), no merge or comparator (B21-D), no provider routing, no breaker,
no strict result tool, no new run events and no trace block (B21-E — here the run log's `warning` channel carries one line per
scheduled specialist, one plan line and a bounded line per refused specialist tool call), no evaluations (B21-F), no UI, no new route,
no new exposed tool, no reserved-file edits (their texts are in section 7). **No generator input changed** — no descriptor, no route
(the flag is an env variable, not a route), no UI control — so the route census stays 165 = 162 canonical + 3 factories + 0 raw and
every generated artifact (the B04 registry CSVs, the B20 manifests and parity JSON, the B17-A control inventory) is byte-identical; no
generator was re-run; the B16.1C control-inventory and B18-D UI gates are untouched. **CONFIRMED** (`git status` at the end of the
increment lists only the files named in section 6).

**Zero authority by construction.** The router never widens a role's permissions and never names a tool. The specialist gateway is
BUILT by the composition root with no execution-grant minter, no external port, no MCP port and no prompt version (C46: nothing but a
read can succeed in it — a granted execution through it is `execution_unavailable`, an external or MCP read `authority_unavailable`;
route case 14 proves it structurally by counting the request's two gateway constructions); the scheduler wraps it read-only
(`role_not_permitted_tool` for every non-read invocation, defense in depth), advertises reads only through a READ-ONLY REGISTRY VIEW
(C37: the persisted `allowedToolIds` IS the set the model was offered), over a derived context whose three availability facts are
false, with no head mark, no PCB basis and no view; the coordinator cannot elevate a specialist (it holds nothing to hand on); the
follow-up coordinator turn runs over the same read-only registry and gateway, without the minter and with its authority withdrawn
(C44, C39), so text that originated in a specialist can reach no proposal seal, grant, view command or port; a specialist's result is a
SHAPE-VALIDATED, UNVERIFIED `sirkit.specialist-result.v1` document with ZERO standing that reaches the coordinator as bounded,
sanitized DATA naming its provider and model (C45), entering a turn that can seal, mint, dispatch and reach nothing (route case
12b: a follow-up turn steered by a specialist's text to seal a proposal gets `unknown_tool`); deterministic validation
outranks it by construction (the merge is B21-D); no chain of thought is stored (the record holds validated documents and closed
dissent reasons only); the provider identity is the coordinator's (`X-Sirkit-AI-Provider`, `run_started.provider`), recorded without
secrets, and every specialist attempt records its provider and model; provider fallback stays human-driven and truthful (a provider
failure is a visible dissent, never a silent switch; degraded mode is a visible warning naming the closed reason only); a provider
outage among the specialists makes no further paid call (C47). The B18 grants, the B19 evidence rules, B20's OD-45/90/91/92 provider
rules and OD-81's directive matcher stand unchanged (the matcher is neither edited nor reused: it lives in the MCP module the B19-D
closure gate keeps out of the chat route, section 4).

## 1. The router: the rule table (rule → runbook line → role list)

The router normalizes the message (one line, collapsed whitespace, lower case, no trailing sentence punctuation) and applies the rules
below in order; the first match wins (C4). A message that matches no DAG rule is `single` by construction: simple work stays direct.
The table equals `ROUTER_RULES` (C1) and the role lists equal `DAG_ROLE_LISTS` (C2); `b21-b-page.test.ts` case 2 compares them. The
DAG shapes and their lists: `bounded-schematic-proposal` → `coordinator`, `schematic`; `bounded-pcb-proposal` → `coordinator`,
`pcb-placement-routing`; `component-replacement` → `coordinator`, `circuit-topology`, `component-sourcing-evidence`, `verification-critic`;
`full-circuit-creation` → `coordinator`, `circuit-topology`, `component-sourcing-evidence`, `schematic`, `verification-critic`;
`full-circuit-layout` → `coordinator`, `circuit-topology`, `component-sourcing-evidence`, `pcb-placement-routing`, `verification-critic`;
`manufacturing-readiness` → `coordinator`, `manufacturing-readiness-reviewer`. [B21 C] The two full-circuit lists are the runbook's six
trimmed to OD-107's cap of four by a fixed priority, and the layout variant is a sixth shape with its own rule
(`specialist-roles.md` section 4; B built one full-circuit list of six, which the scheduler refused).

| rule | kind | runbook | roles |
|---|---|---|---|
| `T3-release` | refused | :141, :148, :811 | — |
| `T3-publish` | refused | :141, :148, :811 | — |
| `T3-publication` | refused | :141, :148, :811 | — |
| `T3-upload` | refused | :141, :148, :811 | — |
| `T3-order` | refused | :141, :148, :811 | — |
| `T3-purchase` | refused | :141, :148, :811 | — |
| `T3-qualify` | refused | :141, :148, :811 | — |
| `T3-ship` | refused | :141, :148, :811 | — |
| `T3-deliver` | refused | :141, :148, :811 | — |
| `S-explicit` | single | :806 | — |
| `S-role` | single | :806, :829 | — |
| `D-component-replacement` | dag | :809 | `coordinator`, `circuit-topology`, `component-sourcing-evidence`, `verification-critic` |
| `D-full-circuit-layout` | dag | :810 | `coordinator`, `circuit-topology`, `component-sourcing-evidence`, `pcb-placement-routing`, `verification-critic` |
| `D-full-circuit-creation` | dag | :810 | `coordinator`, `circuit-topology`, `component-sourcing-evidence`, `schematic`, `verification-critic` |
| `D-manufacturing-readiness` | dag | :811 | `coordinator`, `manufacturing-readiness-reviewer` |
| `D-bounded-pcb-proposal` | dag | :807 | `coordinator`, `pcb-placement-routing` |
| `D-bounded-schematic-proposal` | dag | :807 | `coordinator`, `schematic` |
| `S-default` | single | :766, :806 | — |

- **The Tier 3 rules** (`T3-*`, one per family of the tiers' own `TIER3_FAMILY_PATTERN` (C6): `release`, `publish`, `publication`,
  `upload`, `order`, `purchase`, `qualify` / `qualification`, `ship`, `deliver`, plus the composer's alias `buy` under `T3-purchase`)
  are HEAD-VERB rules: the leading imperative of the whole message after a polite prefix ("please", "can you", "let's", …), with
  "start / run / submit … the publication", "place an order" and "run the qualification" as the noun forms. A family word elsewhere in a
  sentence ("in order to clear the hole", "the release checklist", "parts on order") is not a Tier 3 ask (router case 1), and — after
  the review — "order <things> by <attribute>" is a SORT, not a purchase ("Order the resistors by value." is `single`; "Order 10 boards
  from the fab by Friday." is still refused: router case 4). The plan is `{ kind: "refused", reason }` with the fixed sentence (C3):
  "This assistant never releases, publishes, uploads, orders, purchases, qualifies, ships or delivers anything (Tier 3): a human performs it through the product's own authorized path. No model was called for this message."
  — refused for EVERY role, before any other judgement. **Recorded cost (deliberate, fail-closed):** any other head verb used in
  another sense ("ship the schematic to my inbox") is refused without a model. The refusal is a shortcut, never the safety boundary:
  no Tier 3 tool is agent-exposed, so a message that reaches the coordinator can still order, release or ship nothing.
- **`S-explicit`** (C5): a message that begins with one of the explicit-request grammars' head verbs — move / shift / nudge / rotate /
  turn / flip / put / undo / redo (explicit-request.ts C34; the composer's `EXECUTION_VERB`, C8) — is a direct Tier 0/1 command and stays
  one coordinator turn, whatever else it says ("Rotate the 3D view to isometric" included).
- **`S-role`** (C7): a role outside `TIER1_EXECUTE_ROLES` (not `pcb_editor`, not `project_admin`) never recruits specialists: a viewer,
  a commenter or a reviewer asking for a replacement gets one coordinator turn, as today (router case 5).
- **`D-component-replacement`** (runbook :809; the composer's 5b pairing ITSELF — `REPLACE_PART` is exported from composer-routing.ts
  (C9) and imported by the router (C35), one grammar, never a wider copy): a replace / swap / substitute verb with, in the same clause,
  a word naming the thing swapped IN (part, component, MPN, alternate, alternative, chip), with a schematic present. "Delete U1 and
  replace it with the approved lower-power part while preserving compatible nets." (scenario 4's sentence) is this shape; "Replace R1
  with 4.7k.", "Replace the 10k resistor with a 4.7k resistor." and "Swap the 100nF capacitor for a 1uF capacitor." name no part (a
  generic component type is not the thing swapped in) and stay `single` — exactly the messages the composer routes to a schematic
  edit (router case 7 pins the two grammars' agreement). Before the review the router carried its own wider noun list (resistors,
  capacitors, timers, …), which recruited three specialists for a value change; that copy is gone.
- **`D-full-circuit-creation`** (:810): design / generate / create / build / make / draw at the head, NOT naming a PCB object (via,
  track, trace, silkscreen, copper, zone, …, the composer's rule 5), NOT a geometry, annotation or size ask (box, line, label, outline,
  wider, "50 mm", …, C36 — "Make the board 50 mm wide." and "Draw a box around U1." are `single`) and NOT "make <reference designator>"
  (rule 6). Every phrasing the suite routes here the composer routes to `generate`. As built in B its list named six specialists (the
  runbook's "requirements, architecture/circuit, component, schematic, PCB and verifier as needed"), which exceeds OD-107's cap of four,
  so the scheduler refused the plan (section 7 — the lead decided). [B21 C] **The runbook's six are trimmed to the cap of four** by a
  fixed priority — `circuit-topology`, `component-sourcing-evidence`, `schematic`, `verification-critic`; the requirements analysis
  folds into the coordinator's own turn; `D-full-circuit-layout` (its own layout ask, with a board) puts `pcb-placement-routing` in
  place of `schematic` — so a routed plan never exceeds four and `plan_exceeds_specialist_cap` stays a guard (router case 8;
  `specialist-roles.md` section 4). [B21 C fix] With the list now runnable, the head verb alone no longer recruits it (review: "Make
  the LED brighter." or "Make the placement more compact." would have run four paid specialists): the rule needs a NEW circuit named
  from words — an indefinite object (a / an) with a circuit-kind noun inside it — so an ordinary edit is the bounded PCB proposal
  (a layout-quality ask; `tidier` and `neater` joined its verbs) or one coordinator turn, and the layout variant needs its own layout
  ask (with / and a placement, layout, routing or footprints), never a selection word (router case 9; `specialist-roles.md` section 4).
- **`D-manufacturing-readiness`** (:811): a manufacturing word (manufacturing / manufacturability / fabrication / fab / production /
  DFM) with a review word (ready / readiness / review / check / assess / audit / evaluate), with a board present — deterministic checks
  first, then the reviewer, never an autonomous release agent; "Release the board to manufacturing" is `T3-release` first.
- **`D-bounded-pcb-proposal`** (:807): a layout-quality verb (compact, tighten, optimize, clean up, tidy, reorganize, rearrange,
  reroute, autoroute, autoplace, densify, shrink — "improve" is no longer one) with a LAYOUT noun (placement, routing, layout, traces,
  tracks, footprints, selection), with a board present; a selection-scoped ask needs a selection (`selectionCount > 0`). The Tier 1
  arrange / align / distribute commands are not here ("Align R1, R2 and R3 to the left edge." is `single`), and neither is a BOM tidy
  or a label touch-up ("Clean up the parts list.", "Improve the labels on the board." are `single`: parts / components / board / pcb
  left the noun list after the review).
- **`D-bounded-schematic-proposal`** (:807): a circuit-level rework verb at the head (redesign, rework, revise, refactor, simplify,
  rethink, improve, strengthen, harden) with a circuit noun (circuit, stage, network, filter, regulator, supply, section, subcircuit,
  block, schematic, topology, bias, feedback, decoupling), with a schematic present; the relevant specialist is `schematic` (OD-120).
- **`S-default`** (:766, :806): everything else — a plain question, a 3D/view control request ("Open the 3D view, hide the top
  silkscreen, focus on J1, and switch to an isometric view."), an edit the runbook does not name — stays one coordinator turn.
- **Facts** (`RouterFacts`): `hasSchematic`, `hasBoard`, `actorRole`, `selectionCount` gate the shapes above; `autonomyMode` is
  carried for the record and read by no B21-B rule (Tier 1 execution decisions stay the loop's, B18-C). Every fact is derived by the
  route from the assembled context (`routerFactsOf`), never from the body.
- **Determinism** (router case 6): the same input yields an identical plan every time; the module text carries no clock, no random
  source, no environment read, no timer and no tool id; every rule has a unique id, a kind, a runbook line and (for a DAG) a role list
  that starts with `coordinator` and lies inside `SPECIALIST_ROLES`.

## 2. The proof order (discovery §9), as proven

Before any specialist ran in a chat, the router suite and the route suite showed that a Tier 0/1 command, a 3D/view request and a Tier 3
name each produce exactly today's single-agent run shape or a refusal with no provider call, and that with the flag off the route is
byte-identical to HEAD:

1. **A Tier 0/1 command** — `b21-b-router.test.ts` case 2: the explicit-request grammar's own examples ("Move R3 2 mm to the right.",
   "rotate U1 90 degrees clockwise", "Flip C3 onto the bottom.", "undo", "redo the last change", "Put R2 onto the bottom layer.") are
   `{ kind: "single", rule: "S-explicit" }`; `b21-b-chat-router.test.ts` case 2: with the flag ON, "Move R3 2 mm to the right." produces
   the one-coordinator-turn shape — the adapter called exactly once, the stream byte-identical to the flag-off stream.
2. **A 3D/view request** — router case 2: the B17-C sentence and two more phrasings are `single`; route case 2: with the flag ON the
   3D request is one coordinator turn, byte-identical to the flag-off stream.
3. **A Tier 3 name** — router case 1: three phrasings for each of the nine family words are `refused` with the fixed sentence; route
   case 3: with the flag ON, "Release the board to manufacturing." yields `run_started`, one `warning` ("Refused before any model call:
   …"), `run_completed` with the fixed final sentence, zero steps, zero tool calls, zero usage and an empty model — the adapter is never
   invoked (no provider call) — and the trace is a completed run whose only events are `run_started` and `terminal`.
4. **Flag off** — route case 1: the four bodies (the simple command, the 3D request, the replacement request, the Tier 3 ask) produce
   streams byte-identical to HEAD's recorded streams (digests `eng1-656c2588b836c043`, `eng1-07aaf2589736c9f7`, `eng1-bf8822508f100b13`,
   `eng1-9fbc41d4ee249877`), the adapter called once per request; `"0"`, `""`, `"true"` and `"1 "` are all off.

Only then does route case 4 run specialists in a chat (the replacement request under the flag).

## 3. The scheduler: caps, resume, cancellation, failures

| cap | value | meaning |
|---|---|---|
| `maxSpecialists` | 4 | specialists per coordinator run; a longer plan is refused (`plan_exceeds_specialist_cap`), never truncated — scheduler case 2 (a five-specialist plan and the six-specialist full-circuit list) |
| `parallelism` | 1 | one specialist at a time (scheduler case 1 measures at most one adapter call in flight) |
| `dagWallTimeMs` | 300 000 | from the coordinator's start (the lead's OD-107 value; ≤ 8 minutes = the 10-minute proposal TTL minus the 2-minute approval window, D21-17) |
| `attemptsPerTask` | 2 | one attempt plus one retry on a provider failure the classifier marks retryable (C14, C32: `rate_limit`, `overloaded`, `timeout`, `network`), never on `insufficient_quota` — counted ABOVE the adapter's own SDK retries (the coordinator's adapter is reused: `maxRetries: 2` on the OpenAI client, C52, the SDK default 2 on Anthropic), so a retryable failure can cost up to 6 HTTP attempts per step; the breaker and `maxRetries: 0` are B21-E's (OD-115) |
| `coordinatorTurns` | 2 | the coordinator's turn before the specialists and its follow-up turn after them: the two loop calls the runtime makes |
| `outputTokensPerStep` | 4 096 | the adapters' `MAX_OUTPUT_TOKENS` as data, pinned equal to the exported constant (C51, scheduler case 2): the reported per-DAG ceiling is 6 × (2 + 2 × specialists) × 4 096 output tokens (C17) — the DAG's maximum by construction over both coordinator turns and every attempt of every specialist — never priced, never enforced (enforcement would be vacuous: nothing can exceed a maximum by construction) |
| `minTaskMs` | 1 000 | a task is not started with less wall time than this |
| `maxRefusalLinesPerAttempt` | 4 | refused tool calls of one specialist attempt shown on the coordinator's stream; one more line says the rest are not shown (C43) |

- **Tasks and run ids.** The plan's tasks are its non-coordinator roles in order, `task-<n>-<role>`; a specialist run's id is
  `<coordinatorRunId>:<taskId>` (scheduler case 1). Every specialist runs the REAL loop with the coordinator's adapter behind a METER
  (C38: every step the provider answered is counted — steps, tool calls, usage, the last model — whether or not the attempt then
  completed, so a failed attempt is paid for and reported; case 14), the READ-ONLY REGISTRY VIEW (C37), a derived context and the
  read-only wrapper over the specialist gateway; its own `AbortSignal` composes the coordinator's signal with the DAG's backstop timer
  (C15: one grace period after the wall time); its `runDeadlineMs` is bounded to the remaining wall time, so a specialist whose deadline
  passes fails `deadline` on its own timer — `deadline` for THAT TASK ONLY: the next task still runs while wall time remains (case 12,
  after the review; before it, one task's deadline stopped the whole DAG with most of the wall time unused); the wall time itself stops
  everything (case 7: a scheduler started with 1.1 s left runs one task to its bounded deadline and stops `deadline` with the rest not
  started; a scheduler started after the wall time is refused `dag_deadline_elapsed`).
- **The request per task** (case 3): a `SpecialistRequest` A's contracts validate — bound to the run's scope and verified revision
  (`canonicalRevisionDigest`; the head mark and PCB basis as labels when present), `contextRefs` = the coordinator's engineering-digest
  context pins, `allowedToolIds` = the reads the derived context advertises through the read-only registry, sorted (A4L; never a
  granted execution, a view-session control or a proposal — and, after the review, EQUAL to the set the specialist's model was offered:
  the layout proposals `sirkit.placement.propose` / `sirkit.routing.propose`, which need only a verified board, were advertised and
  refused only at the wrapper before; now nothing outside the record is advertised, cases 3 and 4), a budget at or under
  `DEFAULT_AGENT_BUDGET` with `maxOutputTokens` = steps × 4 096 and `maxInputTokens` = 4 × that (reported, not enforced),
  `requiredOutputs` = the six non-artifact outputs, `deadlineAt` = min(task deadline, DAG deadline); the objective carries the user's
  message bounded to 700 characters. A request the contracts refuse is dissent `malformed` (`request_invalid: <refusal> at <path>`) and
  the task does not run.
- **The record, before the next task** (case 1): the plan record (`plan:0:plan`), then per task its request and its result, under the
  attempt-keyed idempotency key `orchestration:<runId>:<taskId>:<attempt>:<kind>`; the adapter of task n+1 is called only after task
  n's result is committed (the case reads the record from inside the adapter). Every append passes the current revision as
  `expectedRevision`; a compare-and-set conflict (`stale_revision`) or a store that throws after a task started stops the DAG as
  `store_conflict` / `store_unavailable` — single writer, never written over: the entries committed before stay exactly as they were,
  the running task ends `escalated` (`<stop>: the result was not committed` — its result is never handed on) and the next task is not
  started (case 11, after the review; the proof mutates the scheduler to swallow a lost CAS and the case fails).
- **Results** (B): the specialist run's final text is parsed as ONE JSON document (C16), validated by `validateSpecialistResult` and
  bound to the task's role; accepted → the `result` record (with its whole-body digest); anything else → dissent `malformed` with a
  bounded closed reason (`result_not_json: …`, `result_refused: <refusal> at <path>`, `result_role_mismatch: …`) and the DAG continues
  (case 9: prose, a result naming `sirkit.manufacturing.release` as a tool request, a result for another role). B21-E replaces this
  with the strict result tool. No decision record is written in B (decisions are B21-D's merge).
- **Failures**: `cancelled` → dissent `escalated` / `cancelled` and nothing further (case 6: aborting the coordinator's signal aborts the
  running specialist's signal; the record's last entry is `{ kind: "dissent", decision: "escalated", reason: "cancelled" }`; the
  coordinator's minter is never called — the scheduler never hands it on, so the cancelled loop had nothing to retire); `deadline` →
  dissent `escalated` / `deadline` for that task, the next task runs (case 12; C41 is where only `cancelled` stops the DAG);
  `provider_<reason>` → dissent `escalated` with the reason and either one retry (C14) or `provider_outage` and nothing further (case 5:
  `network` twice; case 8: `insufficient_quota` once, never retried; `rate_limit` retried once and accepted); `max_steps`,
  `toolset_invalid`, `internal_error` → dissent `escalated` and the next task still runs (case 8). Nothing the provider said enters the
  record — only the loop's closed reason tokens. Every outcome carries `steps`, `toolCalls`, `usage`, `provider` and `model` (case 14).
- **Resume** (cases 5 and 13; D21-4 closed at the scheduler): a scheduler started again for the same coordinator run reads the record
  first (C13); a task whose `result` record exists is `replayed` — its adapter is never called again, its digest is the committed one —
  ONLY when the request that result answered was bound to this very scope and revision (C40: the request's `RevisionBoundProjectScope`
  compared by digest; after the review); a committed result from another scope or revision is dissent `stale` (with the stale result's
  digest as its subject, keyed by the RESUMING attempt so that a second resume under a third scope records its own dissent instead of
  replaying the first under an identical key - lead correction 2026-09-26) and the task RUNS AGAIN at the next attempt - [B21 D] the one
  after its stale dissent, so the merge's verdict on the re-run has a key of its own - never replayed as current evidence (case 13: the
  same run id resumed against a moved revision re-runs all three tasks at attempt 2, and a third resume records the attempt-2 results
  stale in turn); a task without a result runs at the next free attempt number; a different
  plan for the same run is refused `plan_mismatch`. **What resume is NOT in B:** the chat route mints `run-<uuid>` per POST (C54) and
  the body carries no prior run id, so a Retry (C55: always a NEW run) or a re-sent message after an outage starts a new record and
  runs the specialists again; the scheduler-level replay is reachable today only by a direct `runSpecialistDag` caller (B21-C/D) — the
  route-level resume is B21-E's ("resume from immutable trace after refresh"). The record keeps what was committed; nothing is written
  over.
- **Refusals before anything runs**: `plan_empty`, `plan_exceeds_specialist_cap`, `no_verified_state` (a specialist needs the
  coordinator's verified canonical state), `dag_deadline_elapsed`, `store_unavailable` (A's UNAVAILABLE store or a repository that
  throws), `store_refused` (a malformed scope, an `invalid_record`), `store_conflict`, `plan_mismatch` (case 10). Stops after a start:
  `completed`, `cancelled`, `deadline`, `provider_outage`, `store_unavailable`, `store_refused`, `store_conflict`. Task statuses:
  `accepted`, `malformed`, `escalated`, `replayed`. **A store failure's detail** (`refused.detail`, a write's `detail`) is rendered
  through the redaction authority `renderUnknownError` (C42, C50: credentials and connection strings redacted, 120 characters at most —
  case 10 proves a driver message carrying a connection string loses it); the runtime never puts even that on the stream (section 4).
- **The derived context and the read-only narrowing** (case 4; OD-109, OD-122): `withdrawAuthority` (C39) copies the coordinator's
  context and withdraws its AUTHORITY only — `executionGrantsAvailable` false, the external and MCP facts absent and their authorities
  withdrawn, no grant field (`grantableCapabilities`, `grantLineageId`), `riskCeiling` `propose`, `approvalsAvailable` empty — so the
  gateway's integrity check still holds; `deriveSpecialistContext` (C11) narrows further: no head mark (no schematic proposal), no PCB
  basis (no bounded PCB proposal), no view and no editor surface (no view control) — and it passes `verifyAgentContextIntegrity`
  unchanged (the suite asserts it). `readOnlySpecialistGateway` (C12) refuses every invocation whose descriptor is not `read` with
  `role_not_permitted_tool` before the gateway is asked (defense in depth: through the read-only registry no proposal is even
  advertised; a `board-inspect` read passes through and answers); the coordinator's context object is never mutated. In B a specialist
  can only READ; B21-C narrows the toolset per role (OD-120/121) and proves the gateway refusal of a context that claims grantability.
- **Warnings**: the run log's `warning` channel carries one plan line ("N specialist(s) scheduled after this turn, one at a time
  (parallelism 1; DAG wall time 300 s; output-token ceiling X reported, not priced) under rule …"), one line per scheduled specialist
  with its outcome, a `… is STALE …` line per stale replay, and — after the review — one bounded line per REFUSED specialist tool call
  ("Orchestration: specialist <role> (task <id>, attempt n) tool <toolId> refused: <status>.", at most four per attempt and then one
  "further refused tool calls are not shown" line, C43; case 14), so a specialist's refused calls are never silent; nothing else of a
  specialist run reaches the coordinator's stream (case 1). B21-E adds the events and the per-task trace.

## 4. The store binding, the flag and the route wiring

- **The binding A deferred** (C19, C28, C29): `app/api/chat/orchestration-runtime.ts` (outside the gated prefix) holds the production
  factory `new DurableOrchestrationRunStore(getDurableWorkflowRepository())` — under `SIRKIT_FIXTURE_RUNTIME=blinker` (non-production,
  local_dev) the in-memory repository the dev server hosts, in production PostgreSQL — a test setter, a reset and a never-throwing
  resolve that falls back to A's `resolveOrchestrationRunStore()` (the UNAVAILABLE store, every call fails closed). Route case 7 proves
  the fixture binding (a plan written through the resolved store is a head of `fixtureContainer().durableRepository`) and that without a
  database the resolved store fails closed on use with the one `DATABASE_URL is not set` sentence (`getDb()` throws lazily; the
  scheduler turns any throw into `store_unavailable`) — never a connection attempt: the SQL client is a process-wide singleton (C53)
  that a later stub cannot undo, so the route suite empties `DATABASE_URL` before EVERY request (a live URL in a developer shell would
  otherwise carry case 5's scheduler writes into that database; the proof ran the suite under an exported, unreachable URL: 15/15 in
  450 ms, where 11 cases had timed out before the hardening). The gate walks the orchestration modules' imports, not who imports them,
  so the runtime file may import the durable runtime (whose production closure reaches the OpenAI SDK through the database schema,
  D21-32); gate case 3 records that its closure holds the durable runtime, the router, the scheduler and the store.
- **The flag** (C18): `SIRKIT_ORCHESTRATION_ENABLED` exactly `"1"` enables the DAG path; it defaults to off, and `"0"`, `""`, `"true"`,
  `"1 "` are all off (route case 1). Off, `planChatRun` answers `{ kind: "single", rule: "flag-off" }` for every message WITHOUT
  consulting the router, so with the flag off the route is byte-identical to HEAD (route case 1: the four streams RECORDED from HEAD).
  The flag is an env variable, not a route: no generator input changed.
- **The route** (C23, C24): the plan is computed from the assembled context's server-side facts right before the adapter is built
  (deterministic policy BEFORE any model judgment, OD-110); `refused` → `emitRefusedRun` (C20): `run_started`, one `warning`
  ("Refused before any model call: <the sentence>"), `run_completed` with the fixed final sentence, zero steps, zero tool calls, zero
  usage and an empty model — the shape of a zero-step run, the trace's closed failure vocabulary untouched (no new reason: the run
  completes), the adapter never invoked, the trace finalized as a completed run with no step (route case 3); `single` → exactly today's
  `runAgentLoop` call with today's request and deps; `dag` → `runOrchestratedChat` (C21), below.
- **The DAG path, as built after the review.** The coordinator turn runs as today with its terminal HELD (the loop's own guard is
  private, so the recorder is wrapped by `holdTraceTerminal` (C22) and the stream's terminal by the emit wrapper) and its warning lines
  remembered; a first turn that does not complete runs NO specialist (its own `run_failed` is the one terminal, the trace fails, the
  record stays empty — route case 10, whose proof deletes the guard and fails). Then the SPECIALIST gateway is built with no option at
  all (C46) and the scheduler runs (section 3). Then the stand-down rules: a refused plan → the first turn's terminal stands under
  "Orchestration: no specialist ran (<reason>); the assistant's answer above stands." — the CLOSED REASON ONLY: a record failure's
  driver text (`DATABASE_URL …`, a host, a user, `ECONNREFUSED`) reaches neither the stream nor the trace (route cases 5 and 13; before
  the review the raw `error.message` was interpolated into the client-visible warning); a cancelled DAG → the run ends `run_failed
  cancelled` with a cancelled trace terminal, the running specialist's signal aborted, the record ending `escalated`/`cancelled`, no
  further specialist and no follow-up turn (route case 11: Stop during the second specialist); a provider outage among the specialists
  (`provider_outage`: an `insufficient_quota`, or a retryable failure twice) → NO further provider call (C47): the first turn's completed
  answer is the one terminal under "Orchestration: the provider failed during the specialists (provider_outage); no follow-up turn was
  made and the assistant's answer above stands. N specialist result(s) are committed in the record." (route case 8 — before the review
  the runtime made a second paid call against the exhausted provider, whose `run_failed` replaced the completed answer and invited a
  Retry that re-ran everything); a plan with no accepted or replayed result → the first answer stands under a warning naming the stop.
  Otherwise ONE follow-up coordinator turn, READ-ONLY by construction (`followUpDeps`, C44: no execution-grant minter, the specialist
  gateway behind the read-only wrapper, the read-only registry view — it advertises reads only, route case 4 — and the coordinator's
  context with its authority withdrawn, C39), under the same run id, with the conversation so far plus the first turn's answer as its
  history and the specialists' outcomes as its user message (the envelope, below); its `run_started` is dropped (one per run), a
  warning line the first turn already carried is dropped (C48: the loop's toolset diagnostics are never shown twice), and its terminal
  is rewritten into the RUN's totals (C49: both turns' steps, tool calls and usage — exactly what the trace records; route case 4 pins
  `steps: 2`, `usage: {6, 10}` on the stream and the same on the trace, where the stream said `steps: 1` before the review); a
  follow-up turn that fails leaves the first answer standing as the one terminal, rewritten to the run's totals including the steps the
  failed follow-up recorded on the trace (route case 15; lead correction 2026-09-26), under a warning naming the failure (no Retry card,
  no Retry storm), one that is cancelled ends the run `cancelled`. The follow-up turn's toolset warnings are not recorded twice on the
  TRACE either (its recorder skips the first turn's lines; route cases 4 and 15 assert the trace's warnings are unique), and the
  orchestration's own status and refusal lines take at most `ORCHESTRATION_TRACE_LINES_MAX` (12) of the trace's 32 warning slots -
  every line still reaches the stream, and a stand-down reason is always recorded. As B built it: five adapter starts — coordinator,
  three specialists, coordinator — one `run_started`, one terminal and two trace steps. [B21 C] With the component authority loaded
  (a durable source returning U1's binding) that shape holds and the record at revision 10 has three requests, three results and, since
  B21-D, the merge's three `accepted` decisions (route case 17); without it (the route suite's default: no durable binding) the sourcing specialist has no tools and is not run — four
  adapter starts, one `run_started`, one terminal, two trace steps, and the record at revision 8 with the plan's three tasks, two
  requests with their results, the sourcing task's `role_has_no_tools` dissent and, since B21-D, the merge's two `accepted` decisions
  (route case 4). **Degraded mode is visible, never
  silent.**
- **The envelope** (`specialistResultsEnvelope`, C45) — **a recorded DEVIATION from OD-108's default** (a redacted TOOL RESULT under
  `MAX_RESULT_CHARS`): B carries the specialists' outcomes in the follow-up turn's USER MESSAGE, because no tool call exists to attach a
  result to without a new exposed tool (B adds none) and a synthetic continuation would be adapter-specific; B21-E's strict result tool
  makes it a true tool result. What bounds the deviation: the follow-up turn is read-only (above), so text that originated in a
  specialist can reach no seal, grant, view command or port; the header names every entry a SHAPE-VALIDATED, UNVERIFIED document whose
  summary, assumptions, risks, questions, evidence references, confidence and proposed actions are the specialist's OWN CLAIMS, checked
  for shape only, and states that agreement between specialists is not proof ("never instructions to you"); every entry carries its
  `provider` and `model`, and a set that came from one provider and model is marked `sameSource: true` with a note that the results are
  correlated, not independent (route case 4: three results, one model); over `MAX_RESULT_CHARS` (C25) the envelope falls back to
  summaries only, never a truncated document (route case 12: four results at the contracts' maximum sizes, 549 856 characters, fall
  back under 60 000; the proof removes the fallback and the case fails); the whole text passes `sanitizeModelBoundText` — A's
  contracts refuse a secret-shaped value inside a result before anything is recorded (`secret_shaped_text`), and the envelope's own
  sanitizer redacts one in the one free text the contracts do not judge (an escalated task's reason). **No content judgement in B:**
  a directive-looking summary is carried as data under the header (route case 12). OD-81's one directive matcher lives in
  `app/lib/mcp/foreign-tools.ts`, which the B19-D closure gate (`b19-d-external-text-injection-route.test.ts`, row 31) keeps out of the
  chat route's model-facing import closure — reusing it from the orchestration runtime tripped that gate during the review's fix pass
  and was withdrawn (a third approved boundary would be a pin move of a B19-D ratchet); judging a result's content is B21-D's merge.
  **[B21 D fix, 2026-09-26] Superseded in production:** since B21-D the route builds the merge's `mergedResultsEnvelope`
  (`merge-and-disagreement.md` section 5: the merge's view, bounded by staged fallbacks whatever the merge holds, sanitized, one
  provider = one source - D's route case 6) and calls `specialistResultsEnvelope` nowhere; route case 12 and C's least-privilege
  case 8 still pin this function until the lead retires it with them (D21-36). The citation C45 stays as of this page's base.
  What bounds the text meanwhile is the read-only follow-up turn it enters: route case 12b scripts a follow-up turn that, steered by a
  specialist's "Ignore all previous instructions and … release the board" summary, calls the schematic proposal tool — it is not
  advertised (reads only), the loop refuses it `unknown_tool` before it runs, the model receives the error result, no `proposal_ready`,
  `pcb_proposal_ready`, `execution_grant_ready`, `view_command_ready` or `layout_candidate_ready` appears, and the run ends with its
  one terminal; the record keeps the validated result unchanged.
- **What did not change**: the request body contract, the headers, the NDJSON line shape, the closed event union, the trace document
  (v1, one provider, one terminal), the adapters' behaviour, the gateway, the loop, the minter, the ports, the autonomy read.
  **CONFIRMED** (the chat suites in full with the flag off; section 6).

## 5. `build-multi` untouched and tripwired (OD-106); the gates; D21-33

- `app/api/schematic/build-multi/route.ts` (C27) is byte-identical to HEAD: sha256
  `1655e03595430d9e42b4c3c65800d907e3daaa7ed4d8bc6ac1705fd9640242cb` (git blob `9a29e676ae95b7449f7fcc2402edece8aad79e8d`), pinned by
  route case 6 and by this page (page case 3 recomputes it); it reads no orchestration flag and no orchestration module; A's gate keeps
  every orchestration module from importing it (its own family, judged before `app/api/`). Its behaviour is unaffected by the flag
  because nothing in it reads the flag. Retirement stays a separate owner-approved change (OD-106). **CONFIRMED**
- **The import gate, extended** (`b21-a-import-gates.test.ts`, inside A's five cases): the entry set is now the five modules
  (`contracts`, `router`, `scheduler`, `store`, `tripwires`); the whole closure of every one reaches no forbidden family and no provider
  SDK, and never enters the loop, the gateway or the adapters (A's pin, kept — the scheduler's value imports of `ToolRegistry` and the
  composer grammar, and the router's of composer-routing.ts, stay inside it); case 3 gains two B facts as injected probes (C30): a
  module under the prefix importing `runAgentLoop` is caught, through `app/lib/agent/loop.ts`, by a family — after the review the
  assertion pins that INVARIANT (caught once, through the loop, `RELEASE` today) and no longer the exact hops below the loop, so an
  unrelated refactor of the read bindings or the snapshot cannot fail the orchestration gate (the proof removes the RELEASE family and
  cases 1 and 3 fail); a type-only import of the loop's types is erased and not caught; the runtime file's closure holds the durable
  runtime and the three orchestration modules.
- **D21-33 (new, low) — the loop's own import closure reaches `app/lib/pcb/fab/presets/index.ts`** (C26: `loop.ts -> tool-bindings-readonly.ts
  -> pcb/ai/snapshot.ts -> fab/presets`, the chain as measured on 2026-09-26, RECORDED here and not pinned), which A's gate holds as the
  RELEASE family with no preset exemption (no orchestration module consumes a fab preset). Consequence: the scheduler imports only the
  loop's TYPES and takes `runAgentLoop` / `buildRunToolset` by injection from the composition root (`SchedulerDeps.runLoop` /
  `buildToolset`), where the route already imports the loop. Severity low. **CONFIRMED** (measured by the gate's probe;
  `b-probe-closure.log`). Closes: recorded here; no owner decision needed (the injection is the composition-root pattern the four
  sibling runtimes already use). A follow-up outside B21 may move the read bindings' preset consumption behind a dependency-free module.
- **CI admission** (OD-124): the four orchestration suites ride the `app/lib/agent/orchestration/__tests__` directory filter; the
  route suite is ONE explicit `prompt-to-gerber` entry (C31; the guard's `[B21 A]` case admits it, the redundancy rule is untouched); no
  suite starts PGlite; none lives under `app/lib/engineering/__tests__`. The review added cases to existing suites only — no new suite
  file, no workflow change.

## 6. Suites, evidence, the review and gates

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-b-router.test.ts` | 9 | every runbook branch with three phrasings; the nine Tier 3 families (each word matches the tiers' pattern, every stem covered); a 3D/view request, a plain question and the explicit grammar's examples single; the fact gates; determinism and the module-text scans; the role lists pinned; the review's negatives (a value change, a geometry or size ask, a BOM tidy, a label touch-up, a sort ask); the composer grammar reused, both routers agreeing; [B21 C] case 8: the full-circuit trim, and case 3's list pinned to it; case 9: the full-circuit grammar (a new circuit named from words; the layout variant's own ask) |
| `app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts` | 14 | sequential order and ids; the caps and the `MAX_OUTPUT_TOKENS` pin; the validated request per task equal to the advertised reads; the derived context and the read-only narrowing; resume after an outage; cancellation mid-DAG; the DAG wall time; the retry rule; malformed results; the store failing closed with a redacted detail; a mid-DAG CAS conflict or store failure; the per-task deadline with time left; the stale replay re-run; the per-attempt meter, provenance and refusal lines |
| `app/api/chat/__tests__/b21-b-chat-router.test.ts` | 18 | flag off byte-identical to HEAD; flag on: single for the simple and 3D bodies, the refusal with no provider call, the replacement DAG in one stream with the run's totals and no repeated warning ([B21 C] the sourcing specialist not run without a loaded component authority, its task's dissent recorded and shown to the follow-up turn), reason-only visible degradation, the build-multi hash, the fixture-runtime binding without a connection attempt; a provider outage makes no further call; the follow-up turn narrowed by construction; a failed coordinator turn runs no specialist; Stop mid-DAG; the envelope bounded and sanitized, a steered follow-up turn sealing nothing; a driver error never leaks; the specialist gateway built without the minter and the ports; [B21 C] case 16: per role, the loop deps' closed key set, no minter key, the role's own list enforced at the gateway, two gateway constructions whatever the roles and the bare one handed to the scheduler by identity; case 17: all three specialists with the component authority loaded (revision 10 since B21-D: the merge's three decisions) |
| `app/lib/agent/orchestration/__tests__/b21-b-page.test.ts` | 8 | this page, the cited lines of the new modules current; [B21 C] case 8: the run shapes stated here equal the route suite's pins |
| `app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts` | 7 | A's gate over the five modules, with B's two probes; [B21 C] six modules, case 6 (role-tools.ts); [B21 D] seven modules, case 7 (merge.ts) |

Test-first: every B case failed before the code — the four B suites at import (`Cannot find module '../router'`,
`'@/app/lib/agent/orchestration/router'`, `'@/app/api/chat/orchestration-runtime'`) and the gate's cases 1, 3 and 5 on the absent
modules (`expected [ …(3) ] to deeply equal [ …(5) ]`) — `b-failing-first.log`; the flag-off streams were recorded from HEAD before the
route changed (`b-record-head.log`); then green with the code (`b-impl-1.log`: router 6, scheduler 10, route 7, gate 5). **The
adversarial review (2026-09-26)** confirmed 28 findings over the B tree; every one was fixed test-first: the strengthened and added
cases were run against the pre-fix code first (`b-fix-failing-first.log`: 23 of 48 cases failing — scheduler 1, 2, 3, 4, 10, 11, 12,
13, 14; route 4, 5, 8, 9, 11, 12, 12b, 13; router 4, 7; page 3, 5, 6, 7), then the code, then green (`b-fix-green-1.log`,
`b-fix-green-2.log`); the four test-strength findings were proven by deliberate breakages of the source restored by hash
(`b-fix-mutation.log`: the scheduler swallowing a lost CAS fails scheduler case 11, the runtime without the first-turn guard fails
route case 10, the envelope without its fallback fails route case 12; `b-fix-gate-mutation.log`: the gate without its RELEASE family
fails gate cases 1 and 3; `b-fix-dburl-proof.log` / `b-fix-dburl-proof-2.log`: under an exported, unreachable `DATABASE_URL` the
un-stubbed store factory attempts a live connection and eleven route cases time out, and after the suite-wide stub the suite is 15/15
in 450 ms). Files of the increment: `app/lib/agent/orchestration/{router,scheduler}.ts`, `app/api/chat/orchestration-runtime.ts`,
`app/api/chat/route.ts` (one import, the plan before the adapter, the three-way call site), `app/lib/project/composer-routing.ts`
(`REPLACE_PART` exported, one line), `app/lib/agent/adapters.ts` (`MAX_OUTPUT_TOKENS` exported, one line), the four new suites, the
gate's edits, the workflow's one explicit entry, this page. Gates re-run one job at a time (figures in the report): the new suites and
the A suites; `app/api/chat/__tests__` in full; `app/lib/agent/__tests__` (b09-*, b11-*, b18-*, b20-a4-*); the engineering exposure /
tier suites (b04, b17-f, b18-a-permission-tiers, b18-c-*); the MCP gates (b20-b1, b20-b2, b20-d3); the chat closure ratchets; the CI
guard; tsc; eslint on every new and changed file. Live behaviour with a real model: **BLOCKED-LIVE-QUALIFICATION** (LB-9); **UNKNOWN**:
how a live model answers the specialist frame with one JSON document (B21-E's strict result tool removes the question); **INFERRED**:
the up-to-six HTTP attempts per step under a retryable failure (the SDK's `maxRetries` read from the constructor, never exercised live).

## 7. For the lead — the reserved texts, in full

Each `### OD-…` below is the entry for `OWNER_DECISIONS.md` (as `## OD-…`), in its format; OD-107, OD-110 and OD-122 are the "as
applied" texts that replace A's "records; B applies" entries, OD-106 gains B's tripwire statement, OD-108 records B's deviation.

### OD-106 — `POST /api/schematic/build-multi` is scoped out of B21 and tripwired (B21-A records; B21-B tripwires) (2026-09-26)

- **B's tripwire statement:** the route is byte-identical to HEAD `4b6d0e2` — sha256
  `1655e03595430d9e42b4c3c65800d907e3daaa7ed4d8bc6ac1705fd9640242cb` (git blob `9a29e676ae95b7449f7fcc2402edece8aad79e8d`) — pinned by
  `b21-b-chat-router.test.ts` case 6 and recomputed by `b21-b-page.test.ts` case 3; it reads no orchestration flag and no orchestration
  module; A's import gate keeps every orchestration module from importing it. Its behaviour is unaffected by
  `SIRKIT_ORCHESTRATION_ENABLED` because nothing in it reads the flag. Retirement stays a separate owner-approved change.

### OD-107 — The DAG caps, as applied (B21-B, 2026-09-26; revised after the review)

- **Applied:** `SPECIALIST_CAPS` in `app/lib/agent/orchestration/scheduler.ts`: at most 4 specialists per coordinator run (a longer
  plan is refused `plan_exceeds_specialist_cap`, never truncated); parallelism 1 (sequential; the suite measures at most one adapter
  call in flight); each specialist bounded by `DEFAULT_AGENT_BUDGET` or less with its run deadline bounded to the remaining DAG wall
  time; the DAG wall time 300 000 ms (300 s) from the coordinator's start as the scheduler's own timer composed into every specialist's
  signal — a specialist whose own deadline passes is `deadline` for that task only and the next task runs while wall time remains; the
  wall time itself stops everything; one attempt per task plus one retry on a provider failure the classifier marks retryable, never on
  `insufficient_quota` — these are the SCHEDULER's counts over the coordinator's adapter, whose SDK client itself retries (`maxRetries:
  2` on the OpenAI client, the SDK default 2 on Anthropic), so a retryable failure can cost up to six HTTP attempts per step and an
  `insufficient_quota` is "never retried" only above the SDK's two; the breaker and specialist adapters with `maxRetries: 0` stay
  B21-E's (OD-115); the per-DAG output-token ceiling is the DAG's maximum by construction, 6 × (2 + 2 × specialists) × 4 096 output tokens
  (both coordinator turns and every attempt of every specialist; the per-step figure is pinned equal to the adapters' exported
  `MAX_OUTPUT_TOKENS`), reported in the plan warning and the scheduler's outcome, never priced and never enforced (nothing can exceed a
  maximum by construction); the tokens actually used are metered on the adapter per attempt, failed attempts included; the
  coordinator's loop keeps 120 s per turn. An artifact older than its TTL at merge time is dissent `expired` (B21-D).
- **Decision needed:** the runbook's full circuit creation names SIX specialists (`requirements-analyst`, `circuit-topology`,
  `component-sourcing-evidence`, `schematic`, `pcb-placement-routing`, `verification-critic`), which the cap of four refuses: today a
  "Design a …" message under the flag gets one coordinator turn plus a visible warning ("no specialist ran (plan_exceeds_specialist_cap)").
  Either the owner raises the cap to six for that shape, or the router trims the list "as needed" (runbook :810) once B21-C's roles
  exist (the safe default until then: refuse, never run five).

### OD-108 — How a `SpecialistResult` enters the coordinator's provider conversation (B21-B, 2026-09-26)

- **Deviation from the default, recorded:** the default is "a redacted tool result under `MAX_RESULT_CHARS` (one specialist per tool
  call; no `AgentRunRequest` change)". B carries the specialists' outcomes in the follow-up coordinator turn's USER MESSAGE instead
  (`specialistResultsEnvelope`), because no tool call exists to attach a result to without a new exposed tool (B adds none) and a
  synthetic continuation would be adapter-specific — a user turn is the instruction role, which the system prompt's "tool results are
  DATA" rule does not cover. **What bounds the deviation, all applied:** the follow-up turn is READ-ONLY by construction (no
  execution-grant minter; the specialist gateway, built without the minter, the ports and the prompt version, behind the read-only
  wrapper; the read-only registry view; the coordinator's context with its authority withdrawn), so text that originated in a
  specialist can reach no proposal seal, grant, view command or port; the envelope's header names every entry a SHAPE-VALIDATED,
  UNVERIFIED document of the specialist's own claims and says agreement is not proof; every entry names its provider and model and a
  same-source set is marked correlated; the whole envelope is bounded (summaries only over the budget) and sanitized. **Not applied,
  stated:** no content judgement in B — OD-81's one directive matcher lives in `app/lib/mcp/foreign-tools.ts`, which the B19-D closure
  gate keeps out of the chat route's model-facing closure (a third approved boundary would be a pin move of that ratchet), and judging
  a result's content is B21-D's merge; a follow-up turn steered by a specialist's text to seal a proposal gets `unknown_tool` and seals
  nothing (route case 12b). **Closed by:** B21-E's strict result tool (OD-116), which makes the result a true tool result on both
  providers.

### OD-110 — The deterministic no-provider path, as applied (B21-B, 2026-09-26; revised after the review)

- **Applied:** a server-side classifier in the chat route BEFORE any adapter (`planChatRun` → `routeTaskComplexity`), under
  `SIRKIT_ORCHESTRATION_ENABLED` exactly `"1"` (default off: every message `single`, the route byte-identical to HEAD): a Tier 3 family
  name at the head of the message is refused with no provider call (`run_started`, one warning, `run_completed` with the fixed sentence
  and zero steps; the adapter never invoked; a completed trace with no step); a direct Tier 0/1 command, a 3D/view request, a plain
  question and everything the runbook does not name take the existing single-agent path unchanged; the four complex shapes become a
  DAG. The replacement rule is the composer's own `REPLACE_PART` pairing, imported (a value change never recruits specialists); the
  layout rule needs a layout noun and no longer "improve" (a BOM tidy or a label touch-up stays direct); the full-circuit rule excludes
  geometry, annotation and size asks. No production no-model adapter; the fixture agent stays non-production. **Not applied from the
  draft:** "a request whose only need is a Tier 0 read named by grammar is answered from the read binding" — no read is answered
  without a model in B (a read-only no-model answer needs a grammar per read and a rendering, which no B21 increment plans);
  recorded, not built.
- **Recorded cost (narrowed after the review):** the Tier 3 rules are head-verb rules; "order <things> by <attribute>" is now a sort,
  not a purchase (the owner may revert that narrowing by a rule edit pinned by the router suite); any other head verb used in another
  sense ("ship the schematic to my inbox") is still refused without a model. The refusal is a shortcut, never the safety boundary: no
  Tier 3 tool is agent-exposed.

### OD-122 — The artifact ledger scope for "must not duplicate committed work", as applied (B21-B, 2026-09-26; revised after the review)

- **Applied:** in B a specialist never seals a proposal or mints a grant: its gateway is BUILT by the composition root without the
  execution-grant minter, without the external and MCP ports and without the prompt version (a granted execution through it is
  `execution_unavailable`, an external or MCP read `authority_unavailable` — structural, proven by counting the request's gateway
  constructions), wrapped read-only (`role_not_permitted_tool` for every non-read invocation); its context is derived with the three
  availability facts false, no head mark, no PCB basis and no view; its registry is a read-only view, so nothing outside the persisted
  `allowedToolIds` is ever advertised. **One side-effecting artifact per user message holds in B because the follow-up coordinator turn
  is READ-ONLY:** only the coordinator's first turn can seal the one proposal or mint the one grant; the follow-up turn runs without
  the minter, over the read-only registry and the read-only gateway wrapper, with its authority withdrawn. Committed specialist work is
  never duplicated by a resumed SCHEDULER: every result is persisted before the next task starts and a scheduler resumed for the same
  coordinator run and scope replays it instead of re-running it (a moved revision re-runs it as `stale`). **Not applied in B, stated:**
  the chat route mints a fresh run id per POST and carries no prior run id, so the human's Retry after an outage is a new run whose
  specialists run again — the `userMessageDigest`-keyed cross-run ledger and the route-level resume are B21-E's (with B21-C's per-role
  subsets); specialists producing proposal artifacts the coordinator merges are B21-C/D's.

### The README row (`artifacts/ai-control-plane-b21/README.md`, replacing the planned B21-B row)

| B21-B task-complexity router, the no-provider path, the bounded scheduler, the store binding | `task-complexity-router.md`; code `app/lib/agent/orchestration/{router,scheduler}.ts`, `app/api/chat/orchestration-runtime.ts`, `app/api/chat/route.ts` (+ one exported constant each in `composer-routing.ts` and `adapters.ts`) | CONFIRMED (the deterministic router as a closed rule table — nine Tier 3 head-verb rules refused with no provider call, the explicit grammar's verbs and every unnamed ask single, the four runbook shapes with their role lists pinned as data, the replacement rule the composer's own imported pairing, five server-derived facts, no clock / randomness / environment / tool id; the flag-gated route wiring — `SIRKIT_ORCHESTRATION_ENABLED` exactly "1", default off, the route byte-identical to HEAD with the flag off (four streams recorded from HEAD and pinned), the refusal as a zero-step completed run, the DAG as the coordinator turn plus sequential specialists plus one READ-ONLY follow-up turn in one stream with one terminal reporting the run's totals, reason-only visible degradation, no further provider call after a provider outage; the bounded sequential scheduler — at most 4 specialists, parallelism 1, DAG wall time 300 s, a per-task deadline for that task only, one retry on a retryable provider failure and never on insufficient_quota (above the SDK's own retries), the token ceiling reported over both coordinator turns and every attempt, every attempt metered and attributed to its provider and model, every plan / request / result / dissent persisted before the next task under the attempt-keyed key, resume that never re-runs a committed task of the same scope and re-runs a stale one, cancellation as `escalated`/`cancelled` with nothing further, a store conflict never written over, the derived read-only specialist context passing the gateway's integrity check, the read-only registry view making the advertised set the recorded set, the read-only gateway wrapper, refused specialist tool calls visible as bounded lines; the specialist gateway built without the minter, the ports and the prompt version; the store bound by the composition root to the production durable repository (the fixture runtime's in-memory one proven, the suite independent of the shell's DATABASE_URL), closing A's deviation; the loop injected into the scheduler (D21-33: the loop's closure reaches the fab presets); build-multi untouched and hash-pinned (OD-106); OD-107, OD-110, OD-122 as applied, OD-108 as a recorded deviation; D21-5, D21-6 and D21-17's wall-time clause closed, D21-4 closed at the scheduler only (the route-level resume B21-E's), D21-33 found; 43 cases in four suites plus A's gate extended; the adversarial review's 28 confirmed findings fixed test-first; no generator input changed) |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-B — the task-complexity router, the no-provider path, the bounded sequential scheduler, the store binding (2026-09-26 local; increment workflow + adversarial review + lead; this commit)

- Test-first: the four B suites (router 6, scheduler 10, route 7, page 6) and A's extended gate all failed before the code
  (`b-failing-first.log`: the suites at import — `Cannot find module '../router'` / `'@/app/api/chat/orchestration-runtime'`; the
  gate's cases 1, 3 and 5 on the absent modules); the flag-off streams were RECORDED from HEAD `4b6d0e2` before the route changed
  (`b-record-head.log`: digests `eng1-656c2588b836c043`, `eng1-07aaf2589736c9f7`, `eng1-bf8822508f100b13`, `eng1-9fbc41d4ee249877`) and
  pinned as literals; then green with the code (`b-impl-1.log`). The adversarial review confirmed 28 findings (regressions 1-7, 9-11;
  security 1-8; coverage 1-10; tests 1-6); every one was fixed test-first — the strengthened and added cases (router 7, scheduler 14,
  route 15, page 7) ran against the pre-fix code first (`b-fix-failing-first.log`: 23 of 48 failing), then green (`b-fix-green-1.log`,
  `b-fix-green-2.log`), the four test-strength findings proven by deliberate source breakages restored by hash (`b-fix-mutation.log`,
  `b-fix-gate-mutation.log`, `b-fix-dburl-proof.log`, `b-fix-dburl-proof-2.log`).
- Proof order (discovery §9) honoured: the router suite and the route suite show a Tier 0/1 command, a 3D/view request and a Tier 3
  name each produce today's single-agent run shape or a refusal with no provider call, and the flag-off route is byte-identical to
  HEAD, before route case 4 runs specialists in a chat.
- Code: `app/lib/agent/orchestration/router.ts` (the rule table, the five facts, the nine Tier 3 families with the sort-ask
  narrowing, the four DAG shapes with their role lists, the composer's `REPLACE_PART` imported, the geometry exclusion, the layout
  nouns narrowed), `app/lib/agent/orchestration/scheduler.ts` (the caps incl. `coordinatorTurns` and `maxRefusalLinesPerAttempt`, the
  read-only registry view, `withdrawAuthority` / `deriveSpecialistContext`, the read-only gateway wrapper, the metered adapter, the
  request per task equal to the advertised reads, results before the next task, resume with the scope/revision check and `stale`
  dissent, the per-task deadline, cancellation, the retry rule, the DAG timer, the token ceiling over both coordinator turns and every
  attempt, uncommitted results escalated, store details redacted, refused specialist calls as bounded warning lines; the loop by
  injection), `app/api/chat/orchestration-runtime.ts` (the store binding A deferred, the router and scheduler seams, the flag, the
  refused run, the DAG driver: the held terminal, the specialist gateway built bare, the stand-down rules incl. no further call after a
  provider outage and reason-only warnings, the read-only follow-up turn via `followUpDeps`, warning dedupe, the terminal as the run's
  totals, the envelope with provenance, correlation, the summaries-only fallback and the sanitizer),
  `app/api/chat/route.ts` (one import, the plan before the adapter, the three-way call site), `app/lib/project/composer-routing.ts`
  (`REPLACE_PART` exported) and `app/lib/agent/adapters.ts` (`MAX_OUTPUT_TOKENS` exported) — one line each, no behaviour change — the
  workflow's one explicit entry, A's gate extended in place (entries 5; the loop probe pinned as an invariant; the runtime file's
  closure). No route, descriptor, UI or generator input changed; census 165/162/3/0; the B04/B20/B17-A artifacts byte-identical.
- Findings: D21-33 (low): the loop's closure reaches `app/lib/pcb/fab/presets` through the read bindings, so the scheduler takes the
  loop by injection (measured by the gate's probe). Decision for the owner: the six-specialist full-circuit list versus the cap of four
  (OD-107). Deviation recorded: OD-108 (the results enter the follow-up turn as its user message, bounded by the read-only follow-up
  turn, the header, the provenance note and the sanitizer — no content judgement in B, since OD-81's matcher sits behind the B19-D
  closure gate; B21-E's strict result tool closes it). Deferred and
  stated: the Tier 0 read-by-grammar answer (OD-110), the route-level resume and the `userMessageDigest` ledger (D21-4 closed at the
  scheduler only; B21-E with B21-C), proposal-producing specialists (B21-C/D), the breaker and `maxRetries: 0` (B21-E, OD-115), the
  strict result tool (B21-E).
- Gates re-run one job at a time (the lead re-runs them): the four B suites and A's five; `app/api/chat/__tests__` in full;
  `app/lib/agent/__tests__` (b09-*, b11-*, b18-*, b20-a4-*); the engineering exposure / tier suites (b04-tool-registry,
  b17-f-agent-exposure, b18-a-permission-tiers, b18-c-*); the MCP gates (b20-b1, b20-b2, b20-d3); the chat closure ratchets
  (b18-b-import-gates, b16-0-24 confinement, b20-b2-route-tree); the CI guard; tsc; eslint on every new and changed file — figures in
  the report.
- Records: `task-complexity-router.md`; OD-106 (tripwire), OD-107, OD-110, OD-122 as applied, OD-108 as a recorded deviation; D21-5,
  D21-6 closed, D21-17's wall-time clause closed, D21-4 closed in part (at the scheduler), A's deviation closed, D21-33 found. Live:
  every B21 behaviour with a real model BLOCKED-LIVE-QUALIFICATION (LB-9).

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-B committed on chapter/b21-specialist-orchestration: the task-complexity router, the no-provider path, the
bounded sequential scheduler, the store binding (flag SIRKIT_ORCHESTRATION_ENABLED=1, default off; flag off byte-identical to HEAD;
the follow-up coordinator turn read-only; the adversarial review's 28 findings fixed); next B21-C". `nextAction`: "B21-C test-first:
the nine roles' least-privilege tool subsets (OD-120) intersected in buildRunToolset after every existing gate (OD-121),
deriveSpecialistContext hardened and the specialistGateway refusing a context that claims grantability (OD-109), the no-elevation
proof; the route-level resume and the userMessageDigest ledger stay B21-E's (OD-122)". The report line for the closeout:
`MULTI-AGENT STATUS: contracts and durable record (B21-A) and the deterministic router, the no-provider path and the bounded
sequential scheduler with the store bound (B21-B) delivered offline behind SIRKIT_ORCHESTRATION_ENABLED; roles, merge, provider routing
and evaluations pending (B21-C..F); live disagreement / fallback / quota BLOCKED-LIVE-QUALIFICATION under LB-9`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect; §10 gains a B21-B amendment)

- **D21-4 (resume does not exist)** — CLOSED IN PART by B21-B, at the scheduler: `scheduler.ts` (`b21-b-scheduler.test.ts` cases 5 and
  13): every specialist result is persisted before the next task starts under `orchestration:<runId>:<taskId>:<attempt>:<kind>`; a
  scheduler started again for the SAME coordinator run id and scope replays a committed result and never calls that task's adapter
  again, and a committed result from another scope or revision is dissent `stale` and runs again. OPEN at the route: the chat route
  mints a fresh run id per POST and carries no prior run id, so a human Retry or a re-sent message after an outage is a NEW run whose
  specialists run and are paid again — the route-level resume (re-attaching a coordinator run id after a refresh or Retry) stays open
  for B21-E ("resume from immutable trace after refresh"), with the `userMessageDigest` ledger (OD-122) and B21-C's subsets.
- **D21-5 (no task-complexity router on the chat path)** — CLOSED by B21-B: `router.ts` (`b21-b-router.test.ts`, 7 cases) and the
  flag-gated route wiring (`b21-b-chat-router.test.ts`, 15 cases); `build-multi` scoped out and hash-pinned (OD-106).
- **D21-6 (nothing caps agents, parallelism, tokens or cost)** — CLOSED by B21-B: `SPECIALIST_CAPS` (4 specialists, parallelism 1,
  300 000 ms, 2 attempts above the SDK's retries, the token ceiling as the DAG's maximum by construction reported never priced, every
  attempt metered; scheduler cases 1, 2, 7, 8, 12, 14). Cost stays unpriced by decision (OD-107); the breaker is B21-E (D21-18).
- **D21-17 (artifact lifetimes versus the DAG's wall time)** — the wall-time clause CLOSED by B21-B: the DAG wall time 300 000 ms is
  ≤ 8 minutes = the 10-minute proposal TTL minus the 2-minute approval window, so nothing the DAG produces expires before the human sees
  it (OD-107); the stale-as-regenerate-signal clause stays B21-D's (B's scheduler already treats a committed result from a moved
  revision as `stale` and re-runs it, never as a merge input).
- **A's stated deviation (no runtime binds the store in A)** — closed by B21-B: `app/api/chat/orchestration-runtime.ts` binds the
  production repository (the fixture runtime's in-memory one proven, route case 7); D21-3's "closed in part" is unchanged (tool calls
  are still not persisted; B21-E — a specialist's refused tool calls are visible as bounded warning lines meanwhile).
- **D21-33 (new, low) — the loop's own import closure reaches the fab presets.** `app/lib/agent/loop.ts -> app/lib/engineering/tool-bindings-readonly.ts
  -> app/lib/pcb/ai/snapshot.ts -> app/lib/pcb/fab/presets/index.ts` (measured 2026-09-26; the gate pins the invariant, not the hops),
  the RELEASE family of A's gate (no preset exemption). Consequence: an orchestration module may never import `runAgentLoop` /
  `buildRunToolset`; the scheduler takes both by injection from the composition root (`SchedulerDeps.runLoop` / `buildToolset`).
  Severity low. **CONFIRMED** (gate case 3's `evil-loop` probe). Closes: recorded; no owner decision needed. Source: B21-B.
- **§10, B21-B amendment:** OD-107, OD-110, OD-122 applied as this page states and OD-108 recorded as a deviation; the full-circuit
  list (six specialists) versus the cap of four is an open owner decision under OD-107; the Tier 0 read-by-grammar clause of OD-110 is
  recorded, not built; the "order … by …" narrowing of the Tier 3 rule is the increment's, revertible; OD-81's matcher is not reused
  by the orchestration runtime (the B19-D closure gate, `b19-d-external-text-injection-route.test.ts` row 31, forbids
  `app/lib/mcp/foreign-tools.ts` in the chat route's closure — an attempt during the fix pass tripped it and was withdrawn, the
  ratchet unchanged); the adversarial review's 28 confirmed findings are fixed test-first (section 6 of the page).

## 8. Citations, as of base 4b6d0e2

The anchor is what is checked (it occurs exactly once in its file). For the three new modules (the router, the scheduler, the runtime
file) the line is the CURRENT line and page case 7 checks it; for every other file the line is as of the base for the reader and is
never checked (`composer-routing.ts`, `adapters.ts` and the gate test gained lines in this increment: their cited lines are current too).

| # | file | line | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/agent/orchestration/router.ts` | 146 | — | `export const ROUTER_RULES: readonly RouterRule[] = Object.freeze([` | the rule table as data |
| C2 | `app/lib/agent/orchestration/router.ts` | 45 | — | `export const DAG_ROLE_LISTS = Object.freeze({` | the role lists as data ([B21 C] six: the full-circuit trim and its layout variant) |
| C3 | `app/lib/agent/orchestration/router.ts` | 67 | — | `export const TIER3_REFUSAL_SENTENCE = ` | the fixed refusal sentence |
| C4 | `app/lib/agent/orchestration/router.ts` | 168 | — | `export function routeTaskComplexity(userMessage: string, facts: RouterFacts): RoutePlan {` | the router: first match wins |
| C5 | `app/lib/agent/orchestration/router.ts` | 175 | — | `if (EXPLICIT_VERB.test(message)) return single("S-explicit");` | a direct Tier 0/1 command stays single before any DAG rule |
| C6 | `app/lib/engineering/permission-tiers.ts` | 36 | — | `export const TIER3_FAMILY_PATTERN = ` | the tiers' family pattern the Tier 3 rules are pinned to |
| C7 | `app/lib/engineering/permission-tiers.ts` | 131 | — | `export const TIER1_EXECUTE_ROLES: readonly ProjectRole[] = Object.freeze(["pcb_editor", "project_admin"]);` | the roles that may recruit specialists |
| C8 | `app/lib/project/composer-routing.ts` | 36 | — | `const EXECUTION_VERB = ` | the composer's explicit verbs the router mirrors |
| C9 | `app/lib/project/composer-routing.ts` | 42 | — | `export const REPLACE_PART = ` | the composer's replacement pairing, exported for the router (B21-B) |
| C10 | `app/lib/agent/orchestration/scheduler.ts` | 57 | — | `export const SPECIALIST_CAPS = Object.freeze({` | the caps as data |
| C11 | `app/lib/agent/orchestration/scheduler.ts` | 194 | — | `export function deriveSpecialistContext(context: AgentRunContext): AgentRunContext {` | the derived, narrowed specialist context |
| C12 | `app/lib/agent/orchestration/scheduler.ts` | 290 | — | `export function readOnlySpecialistGateway(` | the read-only narrowing |
| C13 | `app/lib/agent/orchestration/scheduler.ts` | 470 | — | `const committed = history.filter((entry) => entry.taskId === task.taskId && entry.record.kind === "result").at(-1);` | resume: the last committed result of the task |
| C14 | `app/lib/agent/orchestration/scheduler.ts` | 590 | — | `const retry = providerReason !== "insufficient_quota" && isRetryableReason(providerReason) && offset + 1 < SPECIALIST_CAPS.attemptsPerTask;` | the retry rule |
| C15 | `app/lib/agent/orchestration/scheduler.ts` | 461 | — | `const dagTimer = setTimeout(() => dagController.abort(), Math.max(0, dagDeadline + SPECIALIST_CAPS.minTaskMs - now()));` | the DAG's own timer |
| C16 | `app/lib/agent/orchestration/scheduler.ts` | 360 | — | `export function parseSpecialistResult(finalText: string, role: SpecialistRole): ParsedResult {` | B: the final text as one JSON document |
| C17 | `app/lib/agent/orchestration/scheduler.ts` | 167 | — | `export function dagOutputTokenCeiling(` | the reported token ceiling |
| C18 | `app/api/chat/orchestration-runtime.ts` | 39 | — | `export const ORCHESTRATION_ENABLED_ENV = "SIRKIT_ORCHESTRATION_ENABLED";` | the flag |
| C19 | `app/api/chat/orchestration-runtime.ts` | 50 | — | `const productionStoreFactory: StoreFactory = () => new DurableOrchestrationRunStore(getDurableWorkflowRepository());` | the binding A deferred |
| C20 | `app/api/chat/orchestration-runtime.ts` | 132 | — | `export function emitRefusedRun(` | the refused run with no provider call |
| C21 | `app/api/chat/orchestration-runtime.ts` | 215 | — | `export async function runOrchestratedChat(` | the DAG driver |
| C22 | `app/api/chat/orchestration-runtime.ts` | 146 | — | `export function holdTraceTerminal(` | the trace terminal held for the driver |
| C23 | `app/api/chat/route.ts` | 426 | — | `const plan = planChatRun(userMessage, routerFactsOf(runContext));` | the plan before the adapter |
| C24 | `app/api/chat/route.ts` | 520 | — | `result = plan.kind === "dag" ? await runOrchestratedChat({ request, deps, plan, startedAt: Date.now() }) : await runAgentLoop(request, deps);` | the three-way call site |
| C25 | `app/lib/agent/loop.ts` | 54 | — | `export const MAX_RESULT_CHARS = 60_000;` | the model transfer bound the envelope respects |
| C26 | `app/lib/agent/loop.ts` | 25 | — | `import { resolveReadBinding } from "../engineering/tool-bindings-readonly";` | D21-33: the first hop of the loop's chain to the fab presets |
| C27 | `app/api/schematic/build-multi/route.ts` | 73 | — | `export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody }): Promise<Response> => {` | the untouched route |
| C28 | `app/lib/durable-workflow/runtime.ts` | 18 | — | `if (fixtureRuntimeEnabled()) return fixtureContainer().durableRepository;` | the fixture runtime's in-memory repository |
| C29 | `app/lib/agent/orchestration/store.ts` | 348 | — | `export function resolveOrchestrationRunStore(): OrchestrationRunStore {` | A's unavailable default the runtime falls back to |
| C30 | `app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts` | 145 | — | `injected.set(at("evil-loop"), ` | the gate's loop probe (D21-33), pinned as an invariant |
| C31 | `.github/workflows/deterministic-manufacturing.yml` | 145 | — | `app/api/chat/__tests__/b21-b-chat-router.test.ts` | the one explicit CI entry |
| C32 | `app/lib/llm/errors.ts` | 151 | — | `export function isRetryableReason(reason: LLMProviderFailureReason): boolean {` | the classifier's retryable set |
| C33 | `app/lib/agent/contracts.ts` | 185 | — | `runDeadlineMs: 120_000,` | the coordinator's 120 s per turn |
| C34 | `app/lib/engineering/explicit-request.ts` | 35 | — | `const MOVE_PATTERN = ` | the explicit-request grammar the S-explicit rule mirrors |
| C35 | `app/lib/agent/orchestration/router.ts` | 23 | — | `import { REPLACE_PART } from "../../project/composer-routing";` | the replacement rule IS the composer's pairing |
| C36 | `app/lib/agent/orchestration/router.ts` | 115 | — | `const GEOMETRY_ASK = ` | a geometry, annotation or size ask is not a circuit |
| C37 | `app/lib/agent/orchestration/scheduler.ts` | 267 | — | `export function readOnlyToolRegistry(registry: ToolRegistry): ToolRegistry {` | the read-only registry view: the advertised set is the recorded set |
| C38 | `app/lib/agent/orchestration/scheduler.ts` | 309 | — | `export function meteredAdapter(` | the per-attempt meter on the adapter |
| C39 | `app/lib/agent/orchestration/scheduler.ts` | 173 | — | `export function withdrawAuthority(context: AgentRunContext): AgentRunContext {` | the authority withdrawn for the follow-up turn ([B21 C] a specialist's context is built field by field, `deriveSpecialistContext`) |
| C40 | `app/lib/agent/orchestration/scheduler.ts` | 475 | — | `if (committedScopeDigest === currentScopeDigest) {` | a replay only for the same scope and revision; otherwise `stale` |
| C41 | `app/lib/agent/orchestration/scheduler.ts` | 585 | — | `if (failure === "cancelled") stop = "cancelled";` | only a cancellation stops the DAG; a deadline is that task's |
| C42 | `app/lib/agent/orchestration/scheduler.ts` | 391 | — | `const detailOf = (error: unknown): string => renderUnknownError(error, MAX_STORE_DETAIL_CHARS);` | a store failure's detail redacted and bounded |
| C43 | `app/lib/agent/orchestration/scheduler.ts` | 545 | — | `if (event.type !== "tool_refused" && !(event.type === "tool_finished" && !event.ok)) return;` | a specialist's refused tool call becomes a bounded warning line |
| C44 | `app/api/chat/orchestration-runtime.ts` | 178 | — | `export function followUpDeps(deps: AgentLoopDeps, specialistGateway: AgentToolInvocationGateway): AgentLoopDeps {` | the follow-up turn narrowed by construction |
| C45 | `app/api/chat/orchestration-runtime.ts` | 195 | — | `export function specialistResultsEnvelope(outcome: Extract<SchedulerOutcome, { kind: "ran" }>): SpecialistResultsEnvelope {` | the envelope: bounded, sanitized, attributed, withholding |
| C46 | `app/api/chat/orchestration-runtime.ts` | 260 | — | `const specialistGateway = createAgentToolGateway(deps.registry);` | the specialist gateway built with no option: no minter, no port, no prompt version |
| C47 | `app/api/chat/orchestration-runtime.ts` | 275 | — | `if (outcome.stop === "provider_outage") return standDown(` | no further provider call after a provider outage |
| C48 | `app/api/chat/orchestration-runtime.ts` | 296 | — | `if (event.type === "warning" && firstWarnings.has(event.message)) return;` | the follow-up turn never repeats a warning line |
| C49 | `app/api/chat/orchestration-runtime.ts` | 312 | — | `emit({ ...completed, steps, toolCalls, usage });` | the one terminal reports the run's totals |
| C50 | `app/lib/agent/redaction.ts` | 103 | — | `export function renderUnknownError(value: unknown, maxChars: number = DEFAULT_REDACTION_CHARS): string {` | the redaction authority the store detail is rendered through |
| C51 | `app/lib/agent/adapters.ts` | 62 | — | `export const MAX_OUTPUT_TOKENS = 4096;` | the per-step figure the caps are pinned to (exported as data, B21-B) |
| C52 | `app/lib/agent/adapters.ts` | 113 | — | `maxRetries: 2, timeout: 120_000` | the SDK retries under the scheduler's counts |
| C53 | `app/lib/db/client.ts` | 21 | — | `if (sqlClient) return sqlClient;` | the process-wide SQL client singleton the route suite must never build |
| C54 | `app/api/chat/route.ts` | 367 | — | `run-${randomUUID()}` | a fresh run id per POST: no route-level resume in B |
| C55 | `app/lib/agent/run-consumer.ts` | 19 | — | `export function isRecoverableProviderFailure(reason: string): boolean {` | Retry is always a new run |
