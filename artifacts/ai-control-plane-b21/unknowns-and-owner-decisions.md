# B21 - unknowns and owner decisions

Labels as in `README.md`: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED**, **RECORDED**,
**UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. State at HEAD `6cff540` (the B21 closeout (1/2)), read from
`artifacts/remaining-builder-program/OWNER_DECISIONS.md` (OD-106 onward), `artifacts/ai-control-plane-b21/discovery.md` (section 4 with every
closure clause, sections 8 to 10) and `artifacts/remaining-builder-program/LIVE_BLOCKERS.md`. Drafted by the lead's read-only generator
(`scratchpad/b21/closeout/generate.py`, discovery section 9) and corrected by hand against those records: the generator's clause parser
reads `CLOSED by B21-<letter>` only, so it missed "CLOSED at the route by B21-E3" (D21-4), "CLOSED AS POLICY by B21-E1" (D21-20), "CLOSED
by the B21 closeout (1/2)" (D21-27, D21-36), the later clauses that finish a "CLOSED IN PART" (D21-3), the open remainder of D21-12, the
resolved UNKNOWN 6 and the closeout (1/2)'s OD-108 amendment. Corrected again after the closeout's adversarial review (2026-09-30):
D21-3 and D21-20 counted in part, D21-33 and D21-35 RECORDED as their clauses close them, UNKNOWN 2's offline half stated as not run,
and the open shortfalls of OD-110, OD-125 and OD-132 named.

## Owner decisions (OD-106 to OD-133)

All 28 numbers drafted in `discovery.md` section 6 are recorded as headings in `OWNER_DECISIONS.md`; none is reserved or a gap
(OD-83..86 and OD-88 stay reserved for the B22-B proposal reversal). "Open" names what the records leave with the owner; every other
entry carries only its "the owner may choose otherwise" options.

| OD | title (as recorded) | state at the close of B21 | open for the owner |
|---|---|---|---|
| OD-106 | `POST /api/schematic/build-multi` is scoped out of B21 and tripwired (B21-A, 2026-09-24) | applied (A); amended by B: the route hash-pinned and untouched (`b21-b-chat-router` case 6, `b21-b-page` case 3) | options only: retire it (a census move, 165 -> 164) or route it through the DAG |
| OD-107 | The DAG caps (B21-A records; B21-B applies) (2026-09-24) | applied (B: 4 specialists, parallelism 1, DAG wall time 300 s, one retry, the output-token ceiling reported by construction, cost unpriced); amended by C (the full-circuit list trimmed to four by a fixed priority), D3 (the replacement DAG's two proposing roles) and E3 (the approval window across resumes) | options only: raise the cap or the parallelism (a concurrency cap on the long-running engines first); a longer DAG (the proposal TTLs move) |
| OD-108 | How a `SpecialistResult` enters the coordinator's provider conversation (B21-A, 2026-09-24) | recorded (A); applied as a DEVIATION by B (the specialists' outcomes, since D the merge's view `mergedResultsEnvelope`, enter the read-only follow-up turn as its user message); amended by the closeout (1/2): B21-E did NOT close the deviation (the strict result tool is the specialist's output channel only) | **open**: the deviation stands for the owner (a structured `history` entry kind, or the user-message form accepted) |
| OD-109 | Specialists never hold the three availability facts (B21-A records; B21-C proves) (2026-09-24) | applied (C); amended by D2 (a proposing role holds exactly its sealer's fact) and D3 (the specialist gateway holds the route's published pin-facts reads, nothing else) | options only: a sourcing specialist reading through the external port; withdraw the pin-facts option |
| OD-110 | The deterministic no-provider path (B21-A records; B21-B builds) (2026-09-24) | applied **in part** (B): the Tier 3 head-verb refusal with no provider call; the Tier 0 read-by-grammar clause recorded, not built | **open**: a no-model answer for a Tier 0 read (a grammar per read and a rendering; no B21 increment planned it); the head-verb rule's recorded cost - with the flag on, a simple ask whose leading imperative is a Tier 3 verb used in another sense ("ship the schematic to my inbox") is refused with no model |
| OD-111 | The durable orchestration record (B21-A, 2026-09-24; corrected 2026-09-26) | applied (A; bound by B's runtime); amended by E3 (the sibling resume record `agent.orchestration-resume.v1`, which holds the coordinator's first-turn final text) | **open**: a retention bound (PROPOSED: no longer than the run record's; the answer purged once the run is finished), purge and access audit; member read access (a route or read tool: a census or pin move) |
| OD-112 | Per-specialist provider/model and task identity on the trace: NOT applied - stopped (B21-E2, 2026-09-27) | stopped by E2 (1/2) (D21-41); applied by E2 (2/2) under the lead's reading of option B (per-task run id `<runId>:<n>-<role>`, the block's index and role, never the literal task id) | **open**: option A (anchor the diagnostics' `sk-` prefix in `redaction.ts`; the coordinator trace's task ids still read `ta[redacted]`); C not recommended; D refused (OD-113) |
| OD-113 | The B11/B20 tripwires and titles ("carry no MCP or multi-agent identifier"), as applied (B21 closeout (1/2), 2026-09-29) | applied as its default: kept verbatim; 36 stale titles retitled; the tripwire `b21-closeout-statements.test.ts` | options only: re-scope the B11/B20 tripwires (a pin move of two chapters' suites) |
| OD-114 | Merge decisions and dissent as closed records, as applied (B21-D, 2026-09-26) | the record half applied (D); addendum by F3 (one non-rejecting code, `evidence-missing`); the per-task trace block carries the scheduler's `decision` per step since E2 (2/2) (OD-112) | options only: a separate record kind per verdict; a traced verdict event |
| OD-115 | Provider spend controls for the DAG, as applied (B21-E1, 2026-09-27) | applied (E1: the `llm-provider` key and breaker, specialists `maxRetries: 0`, no Retry for quota or an open breaker); amended by E4 (the coordinator's first turn gated, not metered) | **open** (D21-42): record the first turn's no-credits and rate-limit answers to the breaker (one tenant's billing answer then pauses every tenant on that provider); bound the process-wide window per principal; window sizes; a durable shared meter; `maxRetries: 0` for the coordinator |
| OD-116 | The structured-output mechanism for `SpecialistResult`, as applied (B21-E1, 2026-09-27) | applied (E1): the strict result tool, `tool_choice: auto`, validated server-side; whether a live model calls it and Anthropic's strict mode accepts it live: BLOCKED-LIVE-QUALIFICATION (LB-9) | options only: `output_config.format` / `text.format` (an OD-90 key-set move per adapter) |
| OD-117 | The per-role provider/model table and its default, as applied (B21-E1, 2026-09-27) | applied (E1): every role inherits; closed server-env overrides; a model outside its provider's family rules refused until qualified live | options only: a committed table; a model qualified live |
| OD-118 | The official documentation hosts for execution-time re-checks (B21-A, 2026-09-24) | applied (A); the pages read live once (2026-09-24); E1 read the installed SDK packages only (2026-09-27, no page fetched) | options only: a pinned documentation snapshot |
| OD-119 | OpenAI background mode / Anthropic Message Batches for specialist work, as applied (B21-E1, 2026-09-27) | applied: never for interactive specialist work | options only: batches for an opt-in offline evaluation |
| OD-120 | Which of the 33 exposed tools each role may be offered, as applied (B21-C, 2026-09-26) | applied (C); addendum by D; amended by D2 (the live and dormant proposals) and D3 (the replacement live for the schematic role) | **open**: the dormant row entries (keep or cut); the `cost-latency-router` has no policy input (it holds no tool and never runs); the layout proposals live for the PCB specialist |
| OD-121 | How the role allowlist is enforced, as applied (B21-C, 2026-09-26) | applied: a post-discovery intersection that only narrows, plus the wrapper's per-call refusal | options only: a discovery-level role field |
| OD-122 | The artifact ledger scope for "must not duplicate committed work", as applied (B21-B, 2026-09-26; revised after the review) | applied (B); amended by D2 (one accepted action presented, `incomplete`) and E3 (the ledger across resumes keyed by `userMessageDigest`, `already_presented`) | **open**: D3's question (a verifier-contradicted loser beside a verified winner withholds the presentation; the conservative default kept - `discovery.md` section 10, B21-D3); E3's options (a ledger across runs, at-least-once presentation, re-present a stale artifact, a shorter lease) |
| OD-123 | `schematic.set-property` / `schematic.move-rotate` in `EXECUTION_FAMILIES` (B21-C, 2026-09-26) | recorded: reserved and unchanged | options only: remove the two families; open schematic execution (reverses OD-15) |
| OD-124 | CI admission for the B21 suites (B21-A, 2026-09-24) | applied: `CHAPTERS` b21-, one directory filter, explicit entries elsewhere | options only: one explicit entry per suite |
| OD-125 | The model-in-loop track, as applied (B21-F, 2026-09-28) | applied: record-only - one command behind `SIRKIT_LIVE_ORCHESTRATION_EVALUATION=1`, 40 provider requests, never run, not a test | **open**: credits with a spend limit (LB-2 / LB-9) - alone they qualify only the four DAG shapes on one provider (4 of the 12 cases, no scripted fault reproduced); a two-provider live capsule for disagreement and fallback (a harness change) |
| OD-126 | The chat protocol for orchestration events, as applied (B21-E2, 2026-09-27) | applied: five additive v1 events, pinned | **open**: an OLDER v1 page loses the plan, status and stand-down lines (the warning beside the event, or a protocol v2) |
| OD-127 | UI placement of orchestration status, as applied (B21-E2, 2026-09-27) | applied: run-log lines and one status line, no control | options only: a specialist panel with per-specialist stop or reject |
| OD-128 | `LIVE_BLOCKERS.md` LB-9 (B21-A, 2026-09-24) | applied: LB-9 BLOCKED-LIVE-QUALIFICATION | options only: credits with a spend limit (unblocks as LB-2) |
| OD-129 | The only accepted readiness evidence kind, as applied (B21-D, 2026-09-26) | applied | options only: a structured readiness field; a verifier of the report |
| OD-130 | A candidate part is evidence, never a replacement target, as applied (B21-D, 2026-09-26) | applied (D); its part review reachable from a production POST since E3 (D21-16) | options only: an evidence-only candidate-part kind |
| OD-131 | Provider text persisted inside a `SpecialistResult` (B21-A, 2026-09-24; corrected 2026-09-26) | applied (fail-closed value and character rules, with their recorded availability cost) | options only: a longer summary; redact instead of refuse |
| OD-132 | Provider and model per result live in the envelope, never in the sealed schemas, as applied (B21-D, 2026-09-26) | applied (D); amended by E1: one provider is one source whatever model or adapter; keying sources by provider and model RE-DEFERRED to the owner | **open**: key sources by provider and model; persist provider and model with each result record so a replay keeps them (today a replayed result's source reads `(replayed: provenance not recorded)`, short of the runbook's B21-D :843); version the sealed schemas |
| OD-133 | Scope on the layout candidate, as applied (B21-D, 2026-09-26) | applied (the candidate wrapped in its request's scope); the candidate's own `base` is D21-34 | options only: a v2 layout candidate carrying its own scope |

Amendments recorded under existing headings (21): B21-B x4 (OD-106, OD-107, OD-108, OD-110), B21-C x2 (OD-107, OD-109), B21-D x1
(OD-120), B21-D2 x3 (OD-109, OD-120, OD-122), B21-D3 x3 (OD-107, OD-109, OD-120), B21-E1 x1 (OD-132), B21-E2 (2/2) x1 (OD-112),
B21-E3 x3 (OD-107, OD-111, OD-122), B21-E4 x1 (OD-115), B21-F3 x1 (OD-114), B21 closeout (1/2) x1 (OD-108).

## Discovery defects D21-1..48

Severity as the defect states it; for D21-34..41, which state none, as `discovery.md` section 10 and the README record it. "Closed"
means every clause of the defect is closed; a RECORDED residual that a closure clause names is listed beside it. "Closed in part" means
a clause leaves part of the defect open (D21-12, D21-20) or part of its finding stays true with no clause naming it (D21-3, INFERRED by
this closeout).

| defect | severity | title | state | by | live |
|---|---|---|---|---|---|
| D21-1 | high | No orchestration contracts exist (SpecialistRequest, SpecialistResult, ProposedAction, ToolRequest). | closed | A |  |
| D21-2 | medium | No provider-neutral `EvidenceReference` shape; the B19 evidence-class rules are not reusable as a merge weighting. | closed | A |  |
| D21-3 | high | No agent-run record is persisted anywhere; there is no "immutable trace" to resume from. | **closed in part**: by A (plans, requests, results with their evidence, decisions, dissent), the calls half by E2 (2/2) (each specialist task's trace record); the reading back after a refresh is D21-4's (E3). Open, a residual no closure clause names (INFERRED by this closeout): the finding's run-local sink and discarded digest stay true for the coordinator - its own trace, its tool calls included, stays in B11's run-local in-memory sink (`app/api/chat/route.ts:437`, `trace-recorder.ts:108-113`; no production sink factory) and its digest is computed and discarded (`route.ts:463`) - B11's retention deferral, with OD-111's retention question | A, E2 (2/2) |  |
| D21-4 | high | Resume does not exist: a retry is a NEW run that restarts from the user message, so committed specialist work would be redone and re-paid; the single-artifact ledger and the mint key are scoped to one runId. | closed: in part by B (the scheduler), at the route by E3. RECORDED: the mint key stays per run and call; a message sent again without the key is a new run; a run cut by the refresh itself (in flight) is not offered | B, E3 |  |
| D21-5 | high | No task-complexity router on the chat path; the only fan-out in the repository is a live model-judged `Promise.all`. | closed | B |  |
| D21-6 | high | Nothing caps agents, parallelism, tokens or cost; the trace holds 256 events; long-running engines have no concurrency cap. | closed; cost unpriced by decision (OD-107) | B |  |
| D21-7 | high | No per-role tool subset exists on the agent channel, and the discovery vocabulary that would carry one is pinned. | closed | C |  |
| D21-8 | high | Nothing distinguishes a coordinator run from a specialist run; elevation is stopped only by where the minter is built, and no layer resolves the role of an approving actor. | closed; RECORDED: the approver's-role gap below the executor stays unreached by construction | C |  |
| D21-9 | medium | Any new agent-exposed descriptor moves at least seven pins and the B04/B01 byte artifacts. | RECORDED (the pin-move rule; B21 added no descriptor) | C |  |
| D21-10 | high | No proposal-to-proposal comparison exists; the only comparator is transaction-vs-history in an in-memory session. | closed: the capability by D, the production half by D2 (D3's addendum: three DAGs); a disagreement in prose is carried as unverified claims, never escalated | D, D2 |  |
| D21-11 | high | Provider/model identity is recorded once per run, closed to `openai \| anthropic`, pinned literally, and not carried uniformly by the artifacts a merge layer would compare. | closed: the envelope half by D (OD-132), the trace half by E2 (2/2) (OD-112) | D, E2 (2/2) |  |
| D21-12 | medium | Pre-invocation refusals are untraced, `verification` is free text, and no traced field carries assumptions, evidence, decisions, dissent or a source/model correlation key. | **closed in part**: the dissent records by D (OD-114); a specialist's pre-invocation refusals traced as closed lines by E2 (2/2). Open as its addendum states: the coordinator's own refusals stay untraced `tool_refused` events, `verification` stays free text, and no traced field carries assumptions, evidence, dissent or a correlation key (the per-task block carries provider, model and the scheduler's `decision` per step) | D, E2 (2/2) |  |
| D21-13 | medium | The layout candidate carries no tenant/project/branch/lineage scope. | closed (wrapped, OD-133); the candidate's own `base` is D21-34 | D |  |
| D21-14 | medium | Deterministic verification is complete for PCB claims and thin for circuit/topology claims, and no exposed tool verifies a sibling specialist's sealed artifact before apply. | RECORDED: no ERC exists; a topology contradiction in prose is neither detected nor escalated (D2's addendum: two SEALED conflicting Tier 1 edits escalate) | D, D2 |  |
| D21-15 | medium | A readiness claim has no carrier in any proposal. | closed for the manufacturing-readiness reviewer (OD-129); RECORDED: another role's readiness prose is not detected | D |  |
| D21-16 | medium | A component can be replaced only by its one server-owned exact authority target; a sourcing specialist cannot propose an alternative part through any existing tool. | closed (OD-130; the route half by E3); RECORDED: a part named only in prose is not detected | D, D3, E3 |  |
| D21-17 | medium | Artifact lifetimes are fixed and inconsistent with a DAG's wall time; a parallel specialist finishing after any commit is deterministically stale. | closed: the wall-time clause by B, the stale clause by D, the live-head half by E3. RECORDED: a commit that lands DURING one request's DAG is not seen by that request's merge (every apply re-verifies against its live head) | B, D, E3 |  |
| D21-18 | high | No provider-level circuit breaker, quota or Sirkit-owned retry exists; the only thing preventing a paid retry storm is the human not clicking Retry. | closed (OD-115); E4's addendum: the first turn gated; what opens the breaker is D21-42's (open) | E1, E4 | BLOCKED-LIVE (live 429 behaviour) |
| D21-19 | high | No server-owned provider/model-by-role policy; the model-family rules are pinned to gpt-5.x / claude-4.x; fallback after the first tool result is forbidden. | closed (OD-117) | E1 |  |
| D21-20 | high | The only structured-output mechanism is a forced tool call, and the live Anthropic documentation contradicts the code's assumptions for the newest models; the propose routes' strict schemas carry keywords the strict subset lists as unsupported. | **closed in part**: AS POLICY for the specialists' result tool by E1 (OD-116: the strict result tool, `tool_choice: auto`), its live acceptance BLOCKED-LIVE-QUALIFICATION. Open - the title's last clause, which E1's clause does not reach: the propose routes (B16's, unchanged by B21) still send `strict: true` schemas carrying `maxLength` with a forced tool choice on both providers (`b16-0-17-2-adapter-schema-parity`); UNKNOWN 2's planned offline check over them was not run | E1 | BLOCKED-LIVE |
| D21-21 | medium | Stop reasons are not normalized and the loop ignores them. | closed (specialist runs); the RECORDED residual its clause names: the coordinator's loop unchanged | E1 |  |
| D21-22 | high | Every vocabulary a DAG would need is closed and pinned: no event for a plan, a specialist, a per-specialist provider/model, a partial result, a budget remaining or a degraded mode; provider streaming has no production caller. | closed (OD-126, OD-127); RECORDED: provider streaming still has no production caller | E2 |  |
| D21-23 | medium | The scripted and fake adapters cannot express the B21-F scenarios. | closed | F |  |
| D21-24 | medium | The replay capsule scripts one provider and one ordered step list, and the evaluation harness has no orchestration category. | closed; RECORDED: disagreement, missing evidence, parallel staleness and rejection-then-resume proven through the POST, not as capsules | F |  |
| D21-25 | medium | No model-in-loop opt-in exists; every live evaluation is blocked; `LIVE_BLOCKERS.md` has no row for specialist disagreement or provider fallback. | RECORDED: LB-9 (OD-128) and the record-only command (OD-125), never run | A, F | BLOCKED-LIVE |
| D21-26 | medium | CI admission: the job-scope guard covers `b19-`/`b20-` only, no directory filter covers `app/lib/agent/__tests__`, `app/lib/engineering/__tests__` (in prompt-to-gerber), `app/components/chat` or `app/lib/project/__tests__`, and the B11 trace/replay/ evaluation suites do not run in CI at all. | closed (OD-124) | A |  |
| D21-27 | medium | Seven "no multi-agent" tripwire cases, the pinned provider literal, three test titles, two stale "ELEVEN" titles, three single-agent code headers and about a hundred artifact lines become stale or constraining when B21 lands. | closed (OD-113) | closeout (1/2) |  |
| D21-28 | low | If B21 persists records through the durable-workflow substrate, its outbox event types have no handler and the fixture repository is process-local; no test exercises a durable trace sink's failure classification. | RECORDED (no outbox effect) | A |  |
| D21-29 | low | The documentation hosts named by the task and the runbook no longer serve the pages; the Agent SDK pages and the OpenAI reference defaults were not read. | RECORDED (OD-118; UNKNOWNs 3 and 4 below) | A |  |
| D21-30 | low | No browser observable proves that a direct Tier 0/1 command never recruits specialists. | closed (the browser half, F2's test 1) | F, F2 |  |
| D21-31 | low | `EXECUTION_FAMILIES` declares two schematic Tier 1 families that nothing can route to. | RECORDED (OD-123) | C |  |
| D21-32 | low | The durable-workflow production runtime reaches the OpenAI SDK. | found; a follow-up outside B21 (move `EMBEDDING_DIMENSIONS` to a dependency-free module) | A |  |
| D21-33 | low | The loop's own import closure reaches the fab presets. | RECORDED, as its clause closes it (the scheduler takes the loop by injection; no follow-up, no owner decision) | B |  |
| D21-34 | low | The layout candidate's own `base` carries no tenant/project/branch/lineage scope. | found; a follow-up outside B21 (a v2 candidate) | D |  |
| D21-35 | low | The layout family's module reaches the executor. | RECORDED, as its clause closes it (the verifier injected); a follow-up outside B21 may move the pure verifier (optional) | D |  |
| D21-36 | low | B's `specialistResultsEnvelope` has no production caller. | closed (retired; 34 other exports with no production caller RECORDED, none retired) | closeout (1/2) |  |
| D21-37 | medium | A specialist cannot seal a component replacement. | closed; RECORDED: a `contradicted` loser beside a presented winner does not exist under OD-122's order (OD-122's open question) | D3 |  |
| D21-38 | low | The composer sends the runbook's scenario-17 sentence to the schematic editor. | closed; RECORDED: a swap naming only an MPN ("Replace U1 with a TLC555.") stays `single` | E4 |  |
| D21-39 | low | The coordinator's first turn is not gated by the llm-provider breaker. | closed (gated, not metered - D21-42) | E4 |  |
| D21-40 | low | The scripted fixture agent answers no specialist through the result tool. | closed (the browser clause met by F2) | F |  |
| D21-41 | medium | The v1 trace contract refuses every per-task run id `<runId>:<taskId>`. | closed (option B as the lead read it); RECORDED: the coordinator trace's task ids still read `ta[redacted]` (option A the owner's) | E2 (2/2) |  |
| D21-42 | medium | The llm-provider breaker is armed only by metered calls: the first-turn gate never fires on a flag-off process, and a no-credits account whose first turns fail first never opens the breaker. | **open** - the owner's OD-115 option | - |  |
| D21-43 | low | The fixture browser server cannot observe an orchestrated run: the orchestration flag is process-wide, and turning it on for the suite changes B18-E's browser proofs. | closed (the lead's decision: a second, flag-on Playwright config run after the existing suite); its remainder closed as D21-45 | F2 |  |
| D21-44 | low | The merge records no evidence gap: a specialist result that cites no evidence is accepted as its own claim. | closed (option (a)); RECORDED residual: what the coordinator's answer says of the gap is model judgment, and no deterministic human-facing line exists (the lead's decision) | F3 |  |
| D21-45 | low | No browser run presents a proposal and then stands down: the scripted follow-up turn never fails, so F12's rejected presentation and already_presented are observed only offline. | closed (option (a), spec test 4) | F2b |  |
| D21-46 | low | The merge's view names a record the store does not hold after a replayed verdict. | closed | D4 |  |
| D21-47 | low | A human's rejection of a presented proposal never reaches the run: a resume then tells the human the action they rejected "stays listed for the human, who decides". | **open** - a later product increment ((a) the Cancel recorded on the resume record, or (b) the resumed line narrowed) | - |  |
| D21-48 | low | The merged envelope's header states the proposal bound per proposing specialist, not per run. | **open** - a later increment (model-facing text is a behaviour change) | - |  |

Counts: 48 defects - 32 closed (each with the RECORDED residuals its row names), 3 closed in part (D21-3, D21-12, D21-20), 8 RECORDED
(D21-9, D21-14, D21-25, D21-28, D21-29, D21-31, D21-33, D21-35), 2 found as follow-ups outside B21 (D21-32, D21-34), 3 open (D21-42
medium, D21-47 and D21-48 low).

## Unknowns and blocked items named by the discovery (section 8)

1. **UNKNOWN** - Anthropic's credit / quota state: still unrecorded (no Anthropic live call in any ledger entry; LB-9). Resolves by an
   owner statement or one operator-run call under a spend limit.
2. **UNKNOWN** - whether Anthropic rejects `strict: true` tools whose schemas carry `maxLength` / `maxItems`: not resolved, offline or
   live. The discovery's planned offline half - the propose-route schemas through `validateWireSubset`, recording the violations - was
   not run by any increment; the propose routes (B16's) are unchanged (`b16-0-17-2-adapter-schema-parity` still pins `strict: true`, the
   nested `maxLength 4096` and the forced tool choice on both adapters), so D21-20 is counted in part. What B21 holds inside the common
   wire subset is its own schemas - the specialist result tool and each role's offered tools (`validateWireSubset` in `result-tool.ts`
   and `provider-policy.ts`, `b21-e1-result-tool.test.ts`), which carry no `maxLength`; live, BLOCKED-LIVE-QUALIFICATION (LB-9,
   `provider-routing-and-failure.md` "whether Anthropic's strict mode accepts the schema live").
3. **UNKNOWN** - the OpenAI reference defaults for `parallel_tool_calls` and `store`, the full `tool_choice` union, and whether `gpt-6-*`
   models reject `temperature`: still UNKNOWN (no page re-read after 2026-09-24; B21-E1 read only the installed SDK packages, 2026-09-27).
4. **UNKNOWN** - the OpenAI Agents SDK handoff / agents-as-tools mechanics and the Anthropic Agent SDK subagent pages: still UNKNOWN,
   and moot in B21 - no handoff or agents-as-tools optimisation is used; every result serializes into the canonical contracts.
5. **UNKNOWN** - which generators a descriptor change moves: moot - B21 added no exposed tool (D21-9 recorded as the pin-move rule).
6. **Resolved** by the lead (discovery section 9): the closeout generator is the lead's read-only scratchpad script, reused for this
   closeout with `BASE = 6fd5a7b`.
7. **UNKNOWN** - `benchmark-core`'s budget for B21 suites under `app/lib/engineering/__tests__`: moot - no B21 suite lives there (58
   vitest suites under `app/lib/agent/orchestration/__tests__`, `app/api/chat/__tests__` and `app/lib/project/__tests__`; one browser
   spec under `e2e-orchestration/`).
8. The open design questions carried to the owner table: every OD above, with its state.
9. **BLOCKED-LIVE-QUALIFICATION** - every live provider turn, real specialist disagreement, real quota failure and real timeout, and the
   OpenAI / Anthropic structured-output and forced-tool rules on live models (LB-2, LB-7, LB-9): recorded, never converted into a claim.

Other UNKNOWN / BLOCKED items the increments recorded:

- **UNKNOWN** - an OpenAI context-window stop (no status names one) and whether the default `claude-opus-4-7` ever answers
  `model_context_window_exceeded` or `refusal` live (`provider-reference-notes.md`, the 2026-09-27 E1 note; BLOCKED-LIVE-QUALIFICATION).
- **BLOCKED-LIVE-QUALIFICATION** - whether a live model calls the strict result tool (D21-20, OD-116); live 429 and breaker behaviour
  (D21-18, D21-42); the four DAG shapes the record-only command could run (OD-125) - never run; disagreement and fallback, which it
  cannot produce (LB-9).

## Live blockers

| LB | check | classification | B21's relation |
|---|---|---|---|
| LB-1 | Production Supabase authentication browser E2E | BLOCKED-LIVE-QUALIFICATION | unchanged |
| LB-2 | Real LLM provider turn (OpenAI / Anthropic) | UNKNOWN | unchanged: OpenAI answered 429 no-credits for both configured keys (2026-09-24); Anthropic unrecorded |
| LB-3 | Live routing in CI | local-only | unchanged |
| LB-4 | Database-backed tests | dead external resource [superseded 2026-10-10 by B24-E (D24-33, OD-217): LB-4 is QUALIFIED (2026-09-24, migrations and the nine DB-gated suites on two empty databases of a non-isolated server, the PostgreSQL 17.6 server of the main Supabase project) in OD-217's form; isolated staging stays BLOCKED-LIVE-QUALIFICATION (LB-14)] | unchanged; offline the orchestration store runs on the fixture runtime's in-memory repository, independent of the shell's `DATABASE_URL` (B21-B) |
| LB-5 | Physical fabrication | not attempted | unchanged |
| LB-6 | Local container PostgreSQL | BLOCKED-LIVE-QUALIFICATION | unchanged |
| LB-7 | A real model's chat execution | BLOCKED-LIVE-QUALIFICATION | unchanged; the scripted fixture agent now also drives every specialist (B21-F) |
| LB-8 | A routed board in a browser journey | BLOCKED-LIVE-QUALIFICATION | unchanged |
| LB-9 | Real specialist disagreement / provider fallback / quota failure with live models | BLOCKED-LIVE-QUALIFICATION | **added by B21-A (OD-128)**; every B21 live behaviour is recorded under it; unblocks as LB-2 |

## Owner questions open at the close of B21 (one list)

OD-108 (the user-message deviation), OD-110 (the no-model Tier 0 read; the Tier 3 head-verb rule's false refusals), OD-111 (retention
of the orchestration and resume records, purge, access audit), OD-112 (option A), OD-115 (D21-42's first-turn metering and the
process-wide window), OD-120 (the dormant rows; the cost-latency router's policy input), OD-122 (D3's loser-beside-winner question; E3's
across-runs, at-least-once, stale-artifact and lease options), OD-125 (credits for the one record-only run; a two-provider live capsule
for disagreement and fallback), OD-126 (the older v1 page), OD-132 (keying sources by provider and model; persisting them per result so a
replay keeps them), and D21-47's two product options. Every other OD carries only "the owner may choose otherwise" options.
