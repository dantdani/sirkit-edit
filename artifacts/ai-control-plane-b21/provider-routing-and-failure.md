# B21-E — provider routing and failure behaviour (E1: the provider layer)

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `a4aba95` (the B21-D3 commit); written 2026-09-27. This page holds the E1 sections; B21-E2
(the run events, the status line, the trace block, the route-level resume, the composer's routing) appends its own. Every `[B21 E1]`
statement below is pinned by `b21-e1-page.test.ts` (the role table IS `ROLE_PROVIDER_POLICY`; the breaker table IS
`LLM_PROVIDER_ADMISSION`; the stop tables ARE what the adapters map and `SPECIALIST_STOP_REASONS`; the refusal lists ARE
`PROVIDER_ROUTE_REFUSALS`, `RESULT_TOOL_REFUSALS` and `PROVIDER_FAILURES_WITHOUT_RETRY`; the family rules are quoted from the rule
objects; every citation resolves by content exactly once and, for every file E1 changed, on the line it states; every suite row carries
its real `it(` count; the A..D3 pages carry their dated E1 notes) or by the suite it names. E1 implements against the dated provider
facts in `provider-reference-notes.md` (OD-118) and the installed SDK packages it records there on 2026-09-27 (no page was fetched: the
run's no-network rule); no model is called in any E1 suite - every provider is an in-process FAKE SDK client injected into the REAL
adapters (the b09-provider-contracts pattern), so the adapters' own request building, output guard, normalisation and error
classification run. [B21 E2, 2026-09-27] E2's first run (the additive run events and the status line; the trace block stopped - D21-41) is on
its own page, `run-events-and-trace.md`; this page keeps the E1 sections. [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): each landed on its own page - the run events, the status line and the trace block B21-E2's (`run-events-and-trace.md`), the route-level resume B21-E3's (`route-resume.md`), the composer's routing and the first-turn gate B21-E4's (`composer-and-first-turn.md`)]

## 0. What E1 delivers, and what it is not

Why (runbook B21-E, `discovery.md` §7): "preferred provider/model by role; compatible fallback only when schemas and task requirements
match; quota/rate-limit circuit breakers; no repeated paid retry storm" over the proven single-agent loop, with specialists' outputs as
structured evidence of zero authority. D21-18 found nothing but the human's restraint between a no-credits provider and a paid retry
storm; D21-19 no server-owned provider/model per role; D21-20 structured output only as a forced tool call the newest Anthropic models
refuse; D21-21 stop reasons passed through untyped and never read.

- **Preferred provider/model by role (OD-117; section 1).** `ROLE_PROVIDER_POLICY` (C1) is data and every role INHERITS: the user's
  provider (the coordinator's) and that provider's one configured model - today's behaviour. Overrides come ONLY from the server
  environment (`SIRKIT_ORCHESTRATION_ROLE_MODELS`, C2, C3) under a closed, bounded schema; a map the schema refuses approves nothing.
  A model outside the pinned family rules - READ from the modules that apply them (C4, C12-C16), never copied - is refused for a role
  until qualified live (LB-9). A specialist's adapter comes from `agentAdapterForRole` (C17): built like `agentAdapterFor`, with
  `maxRetries: 0` (OD-115); the coordinator's adapter is unchanged. A specialist's run carries the provider it runs on, so what it seals
  names that provider (C64). **CONFIRMED** by `b21-e1-provider-policy.test.ts` (7 cases) and `b21-e1-fallback.test.ts` case 5.
- **The llm-provider admission key and breaker (OD-115, D21-18; section 2).** `AdmissionKey` gains `{ kind: "llm-provider"; provider;
  model? }` (C27, a reviewed extension of B20-A0's union): `insufficient_quota` opens the breaker AT ONCE for an hour (C30) unless an
  operator resets it (C32), a rate limit at once for its minute, three transient failures for a minute; every admitted call carries a
  ticket and only its own breaker generation's outcomes count (C65, C66); an abandoned trial is not counted (C67); every specialist call
  is admitted under the agent's share and recorded (C9); the pause is consulted before every specialist attempt (C41, C42) and before
  the follow-up coordinator turn (C49), whose calls are metered too (C69); a window pause is no outage, the coordinator's provider
  paused stops the DAG `provider_paused` (C68, C70, C72); a quota or breaker failure is never offered Retry on either path of the shared
  card, while its "Use <other> instead" still sends the message again (C53, C54, C55, C61, C62). **CONFIRMED** by
  `b21-e1-provider-breaker.test.ts` (14 cases), `b21-e1-retry-card.test.ts` (4) and the route suite (3).
- **The compatible fallback (OD-117; section 3).** A role whose provider is OUT (its breaker open) runs on the other provider only when
  its tools and its result tool render identically on both (C7, C8) - else `provider_unavailable`, no call; the coordinator never switches.
  **CONFIRMED** by `b21-e1-fallback.test.ts` (5 cases).
- **Normalized stop reasons (D21-21; section 4).** A closed `StepStop` (C26) derived inside each real adapter (C21-C24), carried on
  `AgentStep` as ONE new optional field (C25), read on a specialist's run path only (C37, C44): the output limit and the context window
  are escalated with their reason and never parsed; a refusal is escalated and never retried. **CONFIRMED** by
  `b21-e1-stop-reasons.test.ts` (6 cases).
- **The strict result tool (OD-116, D21-20 as policy; section 5) and OD-119.** `sirkit_specialist_result` (C33-C35), advertised to every
  specialist with `tool_choice: auto` on both providers, its ONE call captured (C36) and validated by A's validator (C38, C39); a turn
  without it is `malformed` - the B-era final-text parse is removed. No `text.format`, `output_config` or `background` key; no batch.
  **CONFIRMED** by `b21-e1-result-tool.test.ts` (6 cases).

What E1 is NOT: section 6.

## 1. Preferred provider/model by role (OD-117)

**The role table** (C1): every role's default, as data. The coordinator's row is never read - its adapter is `agentAdapterFor`'s,
unchanged, and it never switches provider mid-run (route.ts, C52).

| role | provider | model |
|---|---|---|
| `coordinator` | inherit | inherit |
| `requirements-analyst` | inherit | inherit |
| `circuit-topology` | inherit | inherit |
| `component-sourcing-evidence` | inherit | inherit |
| `schematic` | inherit | inherit |
| `pcb-placement-routing` | inherit | inherit |
| `verification-critic` | inherit | inherit |
| `manufacturing-readiness-reviewer` | inherit | inherit |
| `cost-latency-router` | inherit | inherit |

`inherit` provider: the coordinator's (the user's chosen brain); `inherit` model: that provider's one configured model
(`SIRKIT_OPENAI_MODEL` or `gpt-5.6-sol`, `SIRKIT_ANTHROPIC_MODEL` or `claude-opus-4-7` - read through `configuredOpenAIModel` and
`configuredAnthropicModel`, the variables the coordinator's adapters read). **CONFIRMED** (policy case 1).

**The server-env override** (C2, C3). `SIRKIT_ORCHESTRATION_ROLE_MODELS` is a JSON object of at most 8 roles in at most 2 048
characters; each entry is exactly `{ "provider": "openai" | "anthropic" | "inherit", "model": "inherit" | <id> }` with a model id of
lowercase letters, digits and `. _ -`; a key must be a specialist role (never the coordinator). Anything else - not JSON, not an object,
over a bound, an unknown role or key, a missing key, a bad provider or model, or a key named TWICE in one object however it is spelled
(C63: `JSON.parse` would keep the last one silently) - REFUSES THE WHOLE MAP: every specialist is refused
`provider_policy_invalid` with the reason, and no specialist runs until it is fixed (never a partial or silently ignored map). The body
can never route a role: the resolver reads only the environment it is handed (C6), the production provider layer hands it
`process.env` (C50), and the chat route's closed body keys have no place for one - `roleModels`, `specialists`, `model`,
`scope.provider`, `editorContext.roleModels` and a message's `model` are each refused 400 before any adapter is built (route case 1,
green at the base too: a pin of the existing closed body). **CONFIRMED** (policy cases 2, 4 and 7, route cases 1 and 2).

**Qualification** (C4, C5). A route's model is qualified when it is its provider's configured model (today's behaviour) or EVERY pinned
family rule of its provider classifies it. The rules are the SAME objects the provider modules apply, named once where they are applied
(C12-C16; before E1 they were inline literals in `openai-config.ts`, `openai-provider.ts` and `anthropic-provider.ts` - moved, never
copied: no literal of a rule is left elsewhere):

- OpenAI: `OPENAI_REASONING_MODEL_FAMILY` = `/^gpt-5\.6(?:-|$)/` (reasoning effort and profiles) and `OPENAI_NO_TEMPERATURE_MODEL_FAMILY`
  = `/^(?:gpt-5|o\d)/` (temperature never sent).
- Anthropic: `ANTHROPIC_TEMPERATURE_MODEL_FAMILY` = `/^claude-3-|^claude-(?:sonnet|opus)-4-[0-5]/` (temperature sent).

A model outside them - `gpt-6-astra` and `claude-opus-5-5`, the models the dated pages now recommend (§1.2 of the discovery), `gpt-5.2`,
`o3`, `claude-sonnet-5` - is refused `model_unqualified` for the role, visibly ("... refused for <role> until it is qualified live
(LB-9)"), and its task is escalated with no call; the default `claude-opus-4-7` is outside the Anthropic rule and qualified only as the
configured model. **CONFIRMED** (policy case 3; breaker case 6 through the scheduler).

**The adapter for a role** (C17, C18). `agentAdapterForRole(role, provider, model?)`: the coordinator's is `agentAdapterFor(provider)`;
under the fixture runtime's explicit opt-in the scripted agent (never a model, never production); otherwise the real adapter for that
provider and model with `maxRetries: 0` - its SDK client built lazily on the first call (a missing key is `missing_credentials`, never
a throw at construction), options `{ apiKey, maxRetries, timeout }` only (OD-45: the B20-A5 T4 AST pin of six constructions stays
green - the retries ride the two existing constructions, C19, C20). The coordinator's OpenAI client keeps `maxRetries: 2`; its Anthropic
client passes `maxRetries: undefined`, which the installed SDK reads as its default 2 (`options.maxRetries ?? 2`, RECORDED) - unchanged.
**CONFIRMED** (policy case 5, with both SDK modules mocked to observe the constructed options; route case 2 through the production POST).

## 2. The llm-provider meters and breaker (OD-115, D21-18)

**The key** (C27): `{ kind: "llm-provider"; provider: "openai" | "anthropic"; model?: string }` - `llm-provider:<provider>` meters the
provider (a minute window and the breaker), `llm-provider:<provider>/model:<model>` the model's own minute window; the agent is held to
its purpose share (OD-40, 25%) on both. The three existing kinds are unchanged (B20-A0's case 1 gains one assertion). The meters live in
this process (the module's stated limit, OD-53).

| `LLM_PROVIDER_ADMISSION` | value | meaning |
|---|---|---|
| `requestsPerMinute` | 240 | each window's size (the provider's and the model's): the agent may use its 25% share, 60 a minute for the WHOLE process - every user and every concurrent request share it (one DAG makes at most 4 x 2 x 6 = 48 specialist calls, so concurrent DAGs can use it up, and a window pause then refuses only the call it meets and escalates only that task); a Sirkit-owned spend guard, not a provider's documented quota (none is recorded) |
| `consecutiveFailuresToOpen` | 3 | consecutive transient failures (overloaded, timeout, network) that open the breaker |
| `rateLimitOpenMs` | 60000 | how long a rate limit, or those failures, keep it open |
| `quotaOpenMs` | 3600000 | how long a provider out of credits keeps it open - the long window - unless an operator resets it first |

**The breaker** (C28-C32). `insufficient_quota` opens it AT ONCE for the long window; `rate_limit` at once for its minute (the existing
`rate_limited` handling); three consecutive transient failures for a minute; a success closes it and resets the count; after the window
ONE trial call goes (half-open) - its success closes it, its failure re-opens it; `resetLlmProviderBreaker` is the operator's reset (no
route exposes it; a restart does the same). The pause sentence names the cause:
`LLM provider "openai" is paused (insufficient_quota) until <ISO> or until an operator resets it; no call is made to it before then (OD-115).`
**CONFIRMED** (breaker cases 1 and 2).

**Tickets: only a call's own generation counts** (C65-C67; `[B21 E1 fix]` regressions-4, security-4, security-2). Every admitted call
carries a TICKET - the breaker GENERATION it was admitted under (every opening and every operator reset starts a new one, drawn from one
counter that never goes back) and whether it is the half-open trial - and its outcome is recorded WITH it. An outcome under an earlier
generation is ignored: a call admitted before the breaker's latest opening says nothing about the provider since, so a late success can
never close a breaker another call opened (before the fix it closed the no-credits hour at once), and it neither re-opens nor counts.
**[B21 E1 lead, 2026-09-27] Except a no-credits answer** (the check's residual): an `insufficient_quota` is a fact about the ACCOUNT, so
from a call admitted under an earlier generation it still opens the breaker for the long window - a rate-limit opening followed by a
no-credits answer from a call admitted before it paused a provider that is out of credits for the rate-limit minute, and the half-open
trial then made another paid-path call; it never shortens a longer opening, and it never undoes an operator reset that came after its
call's admission (`recordStaleNoCredits`, appended; breaker case 14, which failed first on the unfixed breaker and fails again with
the reset guard removed).
Only the trial's own outcome settles the trial: a stale outcome during half-open no longer frees the trial's slot for a second
concurrent trial. An ABANDONED trial - its run's signal aborted first (the client walked away, its deadline passed) - learnt nothing and
is not counted: the breaker stays half-open and the next call is the trial, one at a time (before the fix it re-armed the whole cause
window, so a client closing its tab during the trial after a no-credits hour relocked every tenant's specialists for another hour; the
MCP breaker's re-open for its short cooldown, B20-A1, is deliberately not copied). **CONFIRMED** (breaker cases 2, 8 and 9; case 8
through the DAG: a hung trial settled by the wrapper's abort listener at its task's own deadline, the next task's call the new trial).

**Where it is consulted.** Every specialist call passes through `admittedAdapter` (C9): admitted first under the agent's share - a
refused call is never sent and its pause captured - and its outcome recorded exactly once with its ticket (`llmProviderOutcomeOf`, C11:
a rate limit, no credits, a transient failure, or nothing learnt). Before every specialist ATTEMPT the scheduler consults the
coordinator's provider (C41, C42): while it is paused NO specialist is called and the DAG stops `provider_paused` under one line
(`Orchestration: <n> specialist(s) not started and no follow-up turn can run - the coordinator's LLM provider ...`) - its follow-up turn
could not run either, and it never switches provider; then the role's own route (section 3). A call the meters refuse MID-RUN (C68)
escalates its task `provider_unavailable: <the pause>`, never retried; the DAG stops - `provider_paused` - only when it met the
coordinator's provider's OPEN BREAKER (another request found the provider out); a WINDOW pause (the process-wide agent share used up by
other requests) is no outage and escalates that task only, exactly as a window pause met before the attempt does (section 3) - before
the fix it stopped the whole DAG as `provider_outage` and told the user "the provider failed during the specialists", although nothing
had failed. A provider failure is retried once only when the classifier marks it retryable, it is not `insufficient_quota` and the
route's provider is NOT paused (C45) - so a rate limit is never retried against the provider it just paused; another provider's outage,
or a retry a window pause withheld, stops only its task (C46). `provider_paused` (C72) stands the run down under its own line (C70): "the
coordinator's LLM provider is paused by Sirkit's own llm-provider meters (provider_paused, OD-115) - no further call is made to it, so no
follow-up turn was made ..." - never claiming a failure; `provider_outage` keeps B's line for a real failure. Before the follow-up
coordinator turn the runtime consults the coordinator's provider once more (C49): paused, no follow-up call - the first answer stands
under the stand-down line - and the turn never runs on another provider; the follow-up's own calls are METERED as a person's
(`interactive`, C69), so its 429 opens the breaker for the next request too (before the fix the follow-up was gated but never
recorded). The per-DAG attempt ceiling stays B's: two attempts per task, at most four tasks. **CONFIRMED** (breaker cases 3 to 7 and 10
to 13; route case 3 through the production POST: ONE paid specialist call after the 429, no follow-up turn, and the NEXT request's
specialists make no call at all under the `provider_paused` line). [B21 E4, 2026-09-28] Since D21-39 the NEXT request makes no call at
all - its first turn included - and answers ONE `run_failed` `provider_breaker_open` (route case 3 moved, its reason next to it); the
`provider_paused` line is reached when the breaker opens during a request (`b21-e2-chat-events` case 5 moved; `composer-and-first-turn.md`).

**Not the coordinator's first turn (RECORDED).** E1 meters and gates specialist calls, and gates and meters the follow-up turn; the
coordinator's own first turn of a request is today's path, untouched (a request while the provider is paused still makes that one call -
the human's Retry is no longer offered for it, below). Gating it is a route change for B21-E2 (D21-39). The coordinator's SDK retries
(OpenAI 2, Anthropic the SDK default 2) stay inside its adapter: the follow-up turn is metered as ONE admitted call per model step, and
the SDK's own re-sends of that step are invisible to the meters (RECORDED, OD-115 "not applied"). [B21 E4, 2026-09-28] The first turn
is GATED since B21-E4 (D21-39 closed): the route consults this same pause (`interactive`, the coordinator's provider) before it on the
flag-off and flag-on paths, and a paused provider gets NO call - `run_started` and ONE `run_failed` `provider_breaker_open`, no Retry; a
resumed request's first turn is replayed, never gated. It is gated, not metered: its own outcome still never reaches the breaker
(`composer-and-first-turn.md`) - so the gate never fires on a flag-off process (which meters no call), a no-credits account whose first
turn fails first never opens the breaker, and once opened it holds one window when no metered call follows (D21-42, recorded by the E4
review); a half-open breaker's one trial in flight never gates a first turn (the trial is the metered calls').

**No Retry for quota or an open breaker** (C53-C55, C61, C62). `PROVIDER_FAILURES_WITHOUT_RETRY` = `provider_insufficient_quota`,
`provider_breaker_open` - the ONE list, beside the ONE owned dispatch both paths of the shared card use (`ai-preferences.ts`; the chat
run's settlement re-exports it). The card is still shown (`isRecoverableProviderFailure` unchanged) and the dispatch still carries the
new-run closure, marked `retryOffered: false`: the card's existing Retry reads the flag and renders disabled
(`disabled={!lastAiRetryRef.current || !aiProviderFailure.retryOffered}`, C55), while its "Use <other> instead" hands the same closure to
`performProviderSwitch` (C62), which selects the other provider BEFORE the new run starts (B09.2's contract). The JSON 503 path of the
same card (generate, edit, review, tidy through `throwAiResponseError`, C61) applies the same rule to its body's `reason`. `[B21 E1 fix]`
regressions-1: the first E1 settlement dispatched no closure at all, so after a no-credits failure the Switch only changed the brain and
never re-sent the message - exactly where switching is the recovery; tests-retry-card-claim: the JSON path still offered Retry. The
page.tsx edit is in place (the card's state type, the listener's state line, the Retry's `disabled`; no line moved), adds and removes
no control (the B17-A inventory's key has no `disabled` expression - regenerated with zero drift; the B18-D wires untouched). Before
E1 a no-credits failure was offered Retry (D21-18). No run in E1 ends with `provider_breaker_open` (the coordinator's turn is not
gated); the rule is in place for B21-E2. [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-E4, not E2, the first turn is gated: a request on a paused provider ends with ONE `run_failed` `provider_breaker_open` and no Retry, the Switch still re-sending - `composer-and-first-turn.md` section 2] **CONFIRMED** (retry-card cases 1 to 4; B09.2's recovery case 2 green again at its base
text: a no-credits settlement dispatches the new-run closure).

**The B19-D closure gate's reviewed exemption.** The chat route's model-facing closure now reaches `admission-control.ts` through the
provider layer; B19-D's gate forbade every acquisition module but the source registry. The meters are policy, not vendor data (counts,
windows and breakers; the module fetches, caches, stores and quarantines no vendor data and imports only the source registry at run
time), so the gate exempts exactly that file with the reason next to it (C59), and policy case 6 pins that the exemption bridges to
nothing (its one runtime import is `./source-registry`; `provider-policy.ts` is its one importer in the runtime's closure).

## 3. The compatible fallback (OD-117)

A specialist whose route's provider is OUT - its breaker open - runs on the other provider only when (C7, C8, C10): every declaration its run would be
offered - its role's effective tools and the strict result tool - sits inside the wire subset and renders identically through both
renderers (the three-way parity gate's `renderAgentProviderParity`, reused, and the same rule over the renderers the adapters import:
what each provider is actually sent), the result tool is the SAME strict schema on both, and the other provider's configured model (the
fallback's model, qualified by definition) is not paused. Then it runs there under one line (`Orchestration: specialist <role> (task
<id>) runs on <provider> (<model>) instead of <provider> (<model>) - <the pause> Its tools and its result tool render identically on both
providers: a compatible fallback, degraded and never silent.`) and its outcome's route records where it came from (`fallbackFrom`).
Otherwise its task is dissent `escalated` `provider_unavailable` with both reasons and no call is made; the DAG goes on. A policy
refusal (`model_unqualified`, `provider_policy_invalid`) is not an outage and never falls back, and neither is a WINDOW pause (the
agent's share of a minute used up: the provider is not out) - `provider_unavailable`, no call.

With two providers a role's fallback IS the coordinator's provider, and the scheduler stops the DAG before any specialist while the
coordinator's provider is paused (section 2) - so a fallback happens only for a role the server env routed AWAY from the coordinator's
provider, and the coordinator never switches. Today every declaration renders identically (the renderers share one strict schema), so
the incompatible branch is proven by a renderer drift injected into the module both the rule and the adapters import. **CONFIRMED**
(fallback cases 1 to 4).

**What a routed specialist seals names the provider it ran on** (C64; `[B21 E1 fix]` regressions-2, security-1). The scheduler hands
the specialist's loop the provider its ROUTE runs on (before the fix: the coordinator's, whatever adapter ran), and the gateway seals
that value as the artifact's provenance - a Tier 1 or replacement proposal's `provenance.provider`, a PCB proposal's
`provenance.provider` and `actor` (`agent:<provider>`) - so the sealed artifact the human approves, the outcome's `provider` and route,
and the merge's source all name the same provider; a compatible fallback seals under the provider it fell back to. **CONFIRMED**
(fallback case 5: a circuit and a PCB specialist routed to anthropic under an openai coordinator seal `anthropic`; a fallback seals
`openai`).

**One provider, one source - whatever model or adapter** (`[B21 E1 fix]` coverage-merge-one-adapter-premise). Since E1 every specialist
runs on its OWN adapter and the server env may route a role to another model of its provider, so the merge's stated premise "this run's
one adapter per provider" is gone; its rule stands, re-worded in place (C71, the D page's D8 row, the streamed escalation sentence,
the runtime's comment): one provider is ONE source whatever model or adapter its specialists ran on. OD-132 said B21-E would key sources by the provider and model its per-role table dispatches with - that keying is re-deferred (to the owner, with B21-F's evaluations): E1 keeps the provider as the key, the conservative choice that never presents two models of one vendor as independent sources. **CONFIRMED** (page case 11; the D suites' source cases unchanged).

## 4. Normalized stop reasons (D21-21)

`STEP_STOPS` (C26) = `end_turn`, `max_tokens`, `refusal`, `pause_turn`, `context_exceeded`, `incomplete`, `unknown`, derived INSIDE each
real adapter from its provider's own field (C21-C24) and carried on `AgentStep` as ONE new optional field, `stop` (C25; the raw
`stopReason` still passes through) - a pinned addition (stop case 1). A scripted double that reports no stop is read as before.

| provider value | `StepStop` |
|---|---|
| Anthropic `end_turn` | `end_turn` |
| Anthropic `tool_use` | `end_turn` |
| Anthropic `max_tokens` | `max_tokens` |
| Anthropic `refusal` | `refusal` |
| Anthropic `pause_turn` | `pause_turn` |
| Anthropic `model_context_window_exceeded` | `context_exceeded` |
| Anthropic `stop_sequence` (Sirkit sets none), null, anything new | `unknown` |
| OpenAI `completed` | `end_turn` |
| OpenAI `completed` with an output message's `refusal` part | `refusal` |
| OpenAI `incomplete` with `incomplete_details.reason` `max_output_tokens` | `max_tokens` |
| OpenAI `incomplete` otherwise (`content_filter`, none) | `incomplete` |
| OpenAI `failed`, `cancelled`, `queued`, `in_progress`, none | `unknown` |

Read on a SPECIALIST's run path only (the specialist's adapter wrapper, C37, and the scheduler, C44 - never the coordinator's loop,
which is unchanged in E1: a coordinator turn that stops at its output limit completes as before, stop case 6): a turn with any stop but
`end_turn` is captured, its calls dropped (a truncated result call is never parsed, a registry call never runs), and the task is
escalated with that stop's reason - never parsed, never retried (a stop is not a provider failure), never run on another provider:

| `StepStop` | the task's dissent reason (`escalated`) |
|---|---|
| `max_tokens` | stop_max_tokens: the provider stopped the specialist's turn at its output limit; nothing of that turn was parsed |
| `refusal` | stop_refusal: the model refused the specialist's turn; a refusal is never retried, on this model or another (the dated notes: not retryable on another model) |
| `pause_turn` | stop_pause_turn: the provider paused the specialist's turn (a server-side tool, which Sirkit never offers); nothing of that turn was parsed |
| `context_exceeded` | stop_context_exceeded: the specialist's turn exceeded the model's context window; nothing of that turn was parsed |
| `incomplete` | stop_incomplete: the provider left the specialist's turn incomplete; nothing of that turn was parsed |
| `unknown` | stop_unknown: the provider ended the specialist's turn with a stop Sirkit does not map; nothing of that turn was parsed |

**CONFIRMED** (stop cases 2 to 5, each mapping on both providers through the REAL adapters; page cases 3 and 9 run this table's
Anthropic and OpenAI rows through the REAL adapters - `[B21 E1 fix]` tests-page-openai-stop-rows; an OpenAI context-window stop has no fact -
UNKNOWN, `provider-reference-notes.md`, 2026-09-27).

## 5. The strict result tool (OD-116, D21-20 as policy) and OD-119

**The declaration** (C33-C35). `sirkit_specialist_result` (both providers' tool-name grammar; no registry tool renders to it), Sirkit id
`orchestration.specialist-result` (deliberately not a registry id): the result's content keys - `role` (an enum of the run's one role),
`summary`, `assumptions`, `evidence`, `requiredTools`, `risks`, `unresolvedQuestions`, `validationRequests`, `confidence` - through
`toStrictSchema` inside the common wire subset: every object closed (`additionalProperties: false`), every property required,
optionality only as `null` (`extractionMethod`, `mitigation`), no bound keyword (the 4 000 / 1 000 characters and 32 entries are the
server's, stated in the descriptions). The server writes the schema id and an empty `proposedActions` - a proposing specialist's
proposals are attached from its own run's seals (B21-D2). It renders identically on both providers (`renderAgentProviderParity`, the
canonical schemas equal). **CONFIRMED** (result case 1).

**Advertised with `tool_choice: auto`** (C56, C57). The specialist's adapter wrapper appends it, last, to every call's tools; the adapters'
own `tool_choice` is `auto` on OpenAI and `{ type: "auto", disable_parallel_tool_use: true }` on Anthropic - never `required` / `any`
(the dated Anthropic page records a 400 for forced tool use on the newest models). The request key sets stay the pinned eleven and six
(`b20-a5-provider-request-shape`, C58): no `text.format`, no `output_config` (reviewed OD-90 pin moves E does not make), and - OD-119 -
no `background`, no batch: the fake clients' batch, file and beta surfaces throw when touched and are never touched; options `{ signal }`
only. **CONFIRMED** (result case 2, through the REAL adapters on both providers).

**The ONE call, validated by A** (C36, C38, C39). The wrapper captures the result call and hands the loop a step with no tool call (the
run completes; its final text is the call's arguments, which only the relay double of the B21-D suites reads - the scheduler reads the
CAPTURE). The arguments are ONE JSON object composed with the schema id and an empty `proposedActions`, a strict `null` for the one
optional field dropped, then judged by A's `validateSpecialistResult` and bound to the task's role - so a malformed call is refused in
A's own vocabulary (`result_refused: <refusal> at <path>`), a result for another role `result_role_mismatch`, a model-written proposed
action D2's `proposal_not_sealed_in_run`. The closed refusals of the call, in the order judged:

| refusal | when |
|---|---|
| `result_tool_not_called` | the specialist ended its turn without the call - even a perfectly valid document written as text is never parsed |
| `result_tool_not_alone` | the call came beside another call in one step - nothing of that step ran |
| `result_tool_arguments_invalid` | the arguments are not one JSON object, or exceed the contracts' 1 000 000-character bound |
| `result_refused` | A's validator refused the composed document (its refusal and path ride along) |
| `result_role_mismatch` | the document names another role |

**The B-era "parse the final text as JSON" path is REMOVED** (`parseSpecialistResult` is gone; the scheduler source holds no
`result.finalText`): B's page C16 and D2's page C17 are re-pinned, B's scheduler case 9 moved (its prose is now
`result_tool_not_called`), and every scripted double of the B21 suites answers through the tool (section 7). **CONFIRMED** (result cases
3 to 6; the moved suites fail against the E1 code with their B-era doubles - `e1-moved-failing-first.log`: 98 of 277).

**A per-run synthetic declaration, not an exposed tool.** It has no descriptor, exposure entry, discovery row, gateway dispatch or
grant; it is added by the specialist's wrapper only, after the loop's toolset - so the registry (42), the exposure list (33), the
MCP-exposed set (9), the B09.1 fixture declaration count and every per-run declaration count the pins read are unchanged (result case 1;
the B20-C1 three-way parity, B04, B17-F and B18-C exposure suites green). The coordinator is never offered it (stop case 6).

**OD-108's deviation stands (RECORDED).** B recorded that the specialists' results enter the follow-up turn as its user message and that
"B21-E's strict result tool closes it". The result tool is the SPECIALIST's output channel; the coordinator's follow-up turn still
receives the merge's view as its user message (no coordinator tool call exists to attach it to without a new exposed tool) - the
deviation stands for the owner.

## 6. What E1 does NOT do

- No evaluations (B21-F); no new exposed tool, descriptor or route (the census stays 165 = 162 canonical + 3 factories + 0 raw); no UI
  control (the card's existing Retry reads the dispatch's `retryOffered` - an in-place page.tsx edit); no new run event (the stand-down, fallback and pause facts ride
  warning lines until B21-E2's events); no request key outside the pinned sets (no `text.format`, no `output_config`, no `background`, no
  batch); no edit to the nine B11-scanned files (the provider literal and the orchestration-identifier tripwires untouched); no trace
  block (B21-E2); no route-level resume or `userMessageDigest` ledger (B21-E2); no composer routing (B21-E2, D21-38). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): the resume and the ledger were delivered by B21-E3 (`route-resume.md`) and the composer routing by B21-E4 (D21-38, `composer-and-first-turn.md`), not by B21-E2]
- No provider SDK outside the adapters (the policy names none: A's gate, policy case 6); no new SDK client construction (the retries ride
  the existing two); no new runtime dependency; no change to the coordinator's adapter, the loop, the gateway or the router. No per-tenant
  or per-run sub-ceiling of the agent share (a window pause escalates only the task it refuses; recorded for the owner under OD-115).
- No reserved-file edit (their texts are in section 8).

## 7. Suites, evidence, the pin moves, gates

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-e1-provider-policy.test.ts` | 7 | the role table inherits; the closed env schema, applied or refusing everything; the family rules read, never copied, and qualification; the body cannot route; `agentAdapterForRole`'s client options (retries 0) with the SDKs mocked; the two modules' closures and the B19-D exemption bridging to nothing; [fix] a key named twice refuses the map |
| `app/lib/agent/orchestration/__tests__/b21-e1-provider-breaker.test.ts` | 14 | the key and its windows with the agent's share; the breaker's openings, trial, reset; a 429 no-credits opens it and no second paid call follows, in the DAG or a later one; a rate limit's retry refused without a call, then the trial after the window; a hanging call at the task's own deadline; provider and model on every outcome; no follow-up turn against a paused provider, never another provider; [fix] an abandoned trial not counted (through the DAG: a hung trial settled by the abort listener); a stale outcome never moves the breaker; a mid-run refusal (window: the task only; breaker: `provider_paused`); the transient failures through the adapter's classification; another provider's outage stops only its task; the follow-up turn metered |
| `app/lib/agent/orchestration/__tests__/b21-e1-fallback.test.ts` | 5 | the rule both ways (a non-wire declaration, a renderer drift); the compatible fallback runs visibly; the incompatible one is `provider_unavailable` with no call; no fallback that would be the coordinator switching; a policy refusal never falls back; [fix] a routed or fallen-back specialist seals under the provider it ran on |
| `app/lib/agent/orchestration/__tests__/b21-e1-stop-reasons.test.ts` | 6 | the vocabulary and the one new field; each stop mapped on both providers; a specialist's output-limit and context-window stops escalated, never parsed; a refusal never retried; the coordinator's loop unchanged |
| `app/lib/agent/orchestration/__tests__/b21-e1-result-tool.test.ts` | 6 | the strict declaration identical on both providers; advertised with `auto`, the key sets pinned, no background or batch (OD-119); a valid call accepted exactly as A judges it; a malformed call refused in A's vocabulary; no call is `result_tool_not_called` (the final-text parse removed); a call beside another is refused and nothing runs |
| `app/lib/agent/orchestration/__tests__/b21-e1-retry-card.test.ts` | 4 | no Retry for quota or an open breaker, the card still shown; the list and the withheld Retry pinned; [fix] the Switch re-sends the message on the other provider after a no-credits failure; the JSON 503 path withholds Retry the same way |
| `app/lib/agent/orchestration/__tests__/b21-e1-page.test.ts` | 11 | this page; [fix] the OpenAI stop rows through the real adapter, every B21 page's rows into files E1 changed current, the merge's re-worded source rule |
| `app/api/chat/__tests__/b21-e1-chat-provider.test.ts` | 3 | the body refused; the production provider layer bound by the route; a no-credits 429 through the POST - one paid specialist call, no follow-up, the next request's specialists make none |
| `app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts` | 7 | A's cases; cases 1, 3 and 5 moved (the two E1 modules in the entry set) |
| `app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts` | 14 | B's cases; the double answers through the result tool; case 9's prose moved to `result_tool_not_called` |
| `app/lib/agent/orchestration/__tests__/b21-d-merge.test.ts` | 25 | D's cases; case 22's reviewer double answers through the result tool |
| `app/lib/agent/orchestration/__tests__/b21-d2-provenance.test.ts` | 9 | D2's cases; case 9 parses through the result tool's arguments parse |
| `app/api/chat/__tests__/b21-b-chat-router.test.ts` | 18 | B's cases; the mock exports `agentAdapterForRole`, answers through the result tool, records registry tools; the meters reset per case; [fix] the role policy's env pinned per case |
| `app/api/chat/__tests__/b21-d-chat-merge.test.ts` | 7 | D's cases; the same mock moves and env pin |
| `app/api/chat/__tests__/b21-d2-chat-proposals.test.ts` | 7 | D2's cases; the same mock moves and env pin |
| `app/api/chat/__tests__/b21-d3-chat-replacement.test.ts` | 7 | D3's cases; the same mock moves and env pin |

**Test-first.** The seven E1 suites ran first against the base with only the test files present (`b21/e1-failing-first.log`: seven
files failing - five on the missing modules, the route suite's cases 2 and 3 and both retry-card cases on their own assertions; route
case 1 passed at the base by design, a pin of the existing closed body); then the code; then green. The moved suites' failing-first
evidence is the same suites with their B-era doubles restored from `a4aba95` over the E1 code (`b21/e1-moved-failing-first.log`: 14 files,
98 of 277 failing - `result_tool_not_called` wherever a double answered with text, the removed `parseSpecialistResult` in D2's
provenance suite); the migrated doubles were then restored and verified by hash (`b21/e1-migrated-backup/migrated.sha256`). The page's
suite ran first against the tree without this page (`b21/e1-page-failing-first.log`: 7 of 8 failing; case 7, the other pages' dated
notes, passing by design).

**The adversarial review's fix round (`[B21 E1 fix]`, 2026-09-27).** Twenty-one confirmed findings (several the same defect seen by two or
three lenses), each fixed test-first: the reproducing cases ran against the first-round E1 code (`b21/fix-red-1.log`: 7 files, 18 of 48
failing, each on its own assertion - page case 5 on the new `it(` counts only; `b21/fix-red-ambient-env.log`: the four migrated route
suites with `SIRKIT_ORCHESTRATION_ROLE_MODELS` exported in the shell, 24 of 39 failing); then the fixes; then green (`b21/fix-green-1.log`
82 of 82; `b21/fix-green-ambient-env.log` 42 of 42 with the same shell variable). A test-strength finding's case was proven against a
deliberate breakage of the source, restored after and verified by sha256 (`b21/fix-mut-<name>.log`, the script `b21/fix/mutate.py`).

| finding(s) | the reproducing case | failure observed before the fix | the fix |
|---|---|---|---|
| regressions-1, coverage-switch-loses-rerun, tests-switch-run-dropped-after-quota | retry-card cases 1, 2, 3; B09.2 recovery case 2 back at its base text | no closure dispatched for a no-credits failure: the Switch started no run (`[]`), B09.2's `retry` undefined | the settlement dispatches the new-run closure with `retryOffered: false`; the card's Retry reads it (C54, C55, C62) |
| tests-retry-card-claim-wider-than-suite | retry-card case 4 | the JSON 503 path left `retryOffered` undefined for `insufficient_quota` | the same rule on `throwAiResponseError` (C61); B07.5's pin moved |
| regressions-2, security-1, coverage-env-routed-seal-provenance | fallback case 5 | a Tier 1 and a PCB proposal sealed by anthropic specialists named `openai` | the loop gets the route's provider (C64) |
| regressions-3, security-3, coverage-window-pause-midrun-outage, tests-admitted-adapter-refusal-unexercised | breaker case 10; breaker case 3, fallback case 4 and route case 3 (the coordinator-paused stop) | a window pause mid-run stopped the DAG `provider_outage` (the next task never ran); the coordinator-paused stop read "the provider failed during the specialists" | `provider_paused` (C72) with its own stand-down (C70); a window pause escalates its task only (C68, C46); mutations `admission-always-allowed`, `admission-purpose`, `capture-block-deleted` each fail case 10 |
| regressions-4, security-4 | breaker case 9 | a late success of a call admitted before a no-credits opening closed the hour at once | tickets and generations (C65, C66) |
| security-2 | breaker cases 2 and 8 | an abandoned trial re-armed the no-credits hour | an abandoned trial is not counted (C67) |
| tests-hang-abort-settle-not-discriminating | breaker case 8 | (passes on the fixed code) | mutations `hang-listener`, `hang-failure` each fail case 8 (case 5 stayed green under both - the finding) |
| tests-transient-failure-mapping-unexercised | breaker case 11 | (the mapping was right) | mutation `transient-inconclusive` fails case 11 |
| tests-other-provider-outage-branch-unexercised | breaker case 12 | (the branch was right) | mutation `other-provider-stop` fails case 12 |
| coverage-followup-not-metered | breaker case 13 | the follow-up's no-credits 429 left the breaker closed | the follow-up turn's adapter behind the meters as `interactive` (C69) |
| coverage-merge-one-adapter-premise | page case 11 | `merge.ts` still said "this run's one adapter per provider" | the rule, its D8 row and the streamed sentence re-worded in place (C71); OD-132's provider-and-model keying re-deferred (section 3) |
| coverage-override-duplicate-keys | policy case 7 | a role named twice was applied last-wins | a key named twice refuses the map (C63) |
| tests-migrated-route-suites-read-ambient-env | the four migrated route suites under an exported shell variable | 24 of 39 failing | each pins the role policy's env per case |
| tests-page-openai-stop-rows-unpinned | page case 9 | (the rows were right) | mutation `page-openai-row` fails case 9, case 3 green under it |
| regressions-5 | page case 10 | B's C30 stated 145 (now 147); the notes cited the family rules at their old lines | C30 re-pinned; a dated re-pointing note in `provider-reference-notes.md` |

**Pin moves, each with its reason written next to it in the suite.**
- `b21-a-import-gates.test.ts` cases 1, 3 and 5: `provider-policy.ts` and `result-tool.ts` join the orchestration gate's entry set (7 ->
  9) the day they are written; their closures are walked by case 2.
- The scripted doubles answer THROUGH the strict result tool when it is offered and record the offered tools without that synthetic
  declaration (`_result-tool.ts`, a test helper): `_role-fixtures.ts`, `_merge-fixtures.ts`, `_d2-fixtures.ts`, `b21-b-scheduler.test.ts`,
  `b21-d-merge.test.ts` case 22 and the four route suites' mocks, which also export `agentAdapterForRole` (the route's provider layer
  builds every specialist's adapter through it) and reset the process meters before and after each case; `_seal-relay.ts`'s note (the
  final text it relays IS the result call's arguments).
- `b21-b-scheduler.test.ts` case 9: prose without the result tool is `result_tool_not_called` (B's `result_not_json` parse removed); its
  other two reasons unchanged. `b21-d2-provenance.test.ts` case 9: the result tool's arguments parse takes the same document.
- `b09-2-recovery.test.tsx` case 2: the first round's move (its reason `provider_network`) is REVERTED by the fix round - the case is
  back at its base text, green: a no-credits settlement dispatches the new-run closure (the Switch needs it), and only the card's Retry
  is withheld (`retryOffered: false`).
- `b07-5-async-ownership-closure.test.ts`: the pinned JSON-path dispatch line moved (the same provider, retry closure and ownership, plus
  the withheld Retry for an out-of-credits body), the reason next to it.
- The four migrated route suites pin `SIRKIT_ORCHESTRATION_ROLE_MODELS`, `SIRKIT_OPENAI_MODEL` and `SIRKIT_ANTHROPIC_MODEL` per case (the
  route's provider layer reads `process.env`; B's rule: the shell never decides an outcome).
- `b20-a0-admission-by-server-and-tool.test.ts` case 1: one assertion for the llm-provider key string (the union's reviewed extension);
  its three assertions unchanged.
- `b19-d-external-text-injection-route.test.ts`: the reviewed exemption of `admission-control.ts` (section 2).
- Pages: B's C14 (the retry rule), C16 (the arguments parse), C24 (the call site with the provider layer) and C52 (the coordinator's
  retries) re-anchored; D2's C17 re-anchored; every B..D3 row citing `scheduler.ts` or `orchestration-runtime.ts` re-pinned to its
  current line (75 rows; anchors unchanged); dated `[B21 E1, 2026-09-27]` notes on B's Results bullet, its `attemptsPerTask` row and its
  UNKNOWN on the JSON document, and on D2's `attachSealedArtifacts` sentence. The fix round: B's C30 re-pinned (145 -> 147, the gate
  test's E1 comment) and `provider_paused` noted beside B's stops; D3's C36 re-anchored (line unchanged: the run carries its route's
  provider); the D page's D8 row re-worded with `MERGE_RULES` and dated notes on its Sources bullet and its OD-132 entry; a dated
  re-pointing note in `provider-reference-notes.md`. Every edit to `scheduler.ts`, `orchestration-runtime.ts`, `merge.ts`, `page.tsx`
  and `ai-preferences.ts` is in place or appended, so no other cited line moved.

**CI.** The seven orchestration suites ride the `app/lib/agent/orchestration/__tests__` filter; the route suite is ONE explicit
`prompt-to-gerber` entry next to D3's (C60), admitted by the guard's `[B21 A]` case; no suite starts PGlite; none lives under
`app/lib/engineering/__tests__`.

**Gates** (one heavy job at a time, through the lock runner; figures in the implementer's report, re-run by the lead): every B21 suite
and the five B21 route suites; `app/api/chat/__tests__` in full (the B19-D closure gate with its exemption); `app/lib/agent/__tests__`
in full; `app/lib/llm/__tests__`; `app/lib/acquisition/__tests__` (the CI guard, the admission suites); `app/lib/mcp` and
`app/api/mcp/__tests__` in full (the B20 pages' citations into `adapters.ts`, `admission-control.ts` and `run-consumer.ts`: every edit is
in place or appended, so no cited line moved; the request-shape pin, the SDK-construction pin and the output guard green); the
engineering exposure / tier suites; the B07.5 ownership suite (its moved pin); the B17-A control inventory and the B18-D UI gates (no
control; the fix round's in-place page.tsx edit changes no inventory key - the B17-A generator re-run with zero drift); tsc; eslint on
every new and changed TypeScript file. No descriptor, route, UI control, request key or other generator input changed.

Live behaviour with a real model: **BLOCKED-LIVE-QUALIFICATION** (LB-9) - whether a live specialist calls the result tool, a live 429's
exact body, a live refusal or context-window stop. **UNKNOWN**: an OpenAI context-window stop (no fact names one).

## 8. For the lead — the reserved texts, in full

Each `### OD-…` below is the entry for `OWNER_DECISIONS.md` (as `## OD-…`), in its format (OD-115, OD-116, OD-117 and OD-119 are not yet
in it; the OD-132 amendment is one bullet appended to that existing entry). Then the README row, the ledger paragraph, the PROGRAM_STATE
texts, the discovery closure clauses and the §10 amendment line. Every text below already includes the adversarial review's fix round.

### OD-115 — Provider spend controls for the DAG, as applied (B21-E1, 2026-09-27)

- **Question:** what stops a paid retry storm against a provider that is out (D21-18)?
- **Applied:** the admission key gains the `llm-provider` kind (`{ provider, model? }`, a reviewed extension of B20-A0's union) with
  the process's meters: a minute window per provider and per model, the agent held to its 25% share (OD-40) - 60 calls a minute for the
  whole process, shared by every user and concurrent request - and a breaker per provider that opens AT ONCE on `insufficient_quota`
  for an hour (`quotaOpenMs` 3 600 000) unless an operator resets it (`resetLlmProviderBreaker`; a restart resets it too), at once on a
  rate limit for a minute, and after three consecutive transient failures for a minute, with one half-open trial after the window.
  Every admitted call carries a ticket (the breaker generation it was admitted under, whether it is the trial): an outcome under an
  earlier generation never moves the breaker (a late success cannot close an opening) - except a no-credits answer, a fact about the
  account, which still opens the long window unless an operator reset came after its call's admission ([B21 E1 lead]) - only the
  trial's own outcome settles the trial,
  and an abandoned trial (its run's signal aborted first) is not counted - the breaker stays half-open, never re-armed for an hour by a
  call nobody finished. Every specialist call is admitted and recorded; the pause is consulted before every specialist attempt (the
  coordinator's provider paused: no specialist call, the DAG stops `provider_paused` visibly, never claiming a failure); a call the
  meters refuse mid-run escalates its task, and stops the DAG `provider_paused` only on the coordinator's open breaker (a window pause is
  no outage); before the follow-up coordinator turn (paused: no call, the first answer stands), whose calls are metered as a person's;
  a retry is never made against a paused provider; the per-DAG attempt ceiling stays B's (2 per task, 4 tasks). Specialist adapters are
  built with `maxRetries: 0` (`agentAdapterForRole`) inside OD-45's `{ apiKey, maxRetries, timeout }`; the coordinator keeps its SDK
  retries (OpenAI 2, Anthropic the SDK default 2). The recovery card - on both of its paths, the chat run's settlement and the JSON 503
  body - withholds Retry for `provider_insufficient_quota` / `insufficient_quota` and `provider_breaker_open` (`retryOffered: false`,
  its Retry disabled) while its "Use <other> instead" still sends the message again on the other provider. The chat closure's B19-D gate
  exempts `admission-control.ts` exactly (policy, not vendor data). Proven by `b21-e1-provider-breaker.test.ts`,
  `b21-e1-retry-card.test.ts`, `b21-e1-chat-provider.test.ts`.
- **Not applied (recorded):** the coordinator's own first turn is not metered or gated (D21-39, for B21-E2); the coordinator's SDK
  retries (its first and follow-up turns) re-send a step invisibly to the meters (the follow-up is metered as one admitted call per
  step); the meters are per process; the agent share has no per-tenant or per-run sub-ceiling (a window pause escalates only the task
  it refuses).
- **The owner may choose otherwise:** other window sizes or open durations; a durable shared meter across instances; gating the
  coordinator's first turn (a route change); a per-tenant or per-run sub-ceiling of the agent share; `maxRetries: 0` for the coordinator
  too, with Sirkit-owned metered retries.

### OD-116 — The structured-output mechanism for `SpecialistResult`, as applied (B21-E1, 2026-09-27)

- **Question:** how does a specialist return its `SpecialistResult` (D21-20)?
- **Applied:** ONE strict function tool, `sirkit_specialist_result` - a per-run synthetic declaration, never an exposed tool - whose
  schema is the result's content keys through `toStrictSchema` inside the wire subset, identical on both providers, advertised beside
  the role's tools with the adapters' own `tool_choice: auto` (never `required` / `any`); its ONE call is captured by the specialist's
  wrapper and its arguments validated server-side by A's `validateSpecialistResult` (the server writes the schema id and attaches the
  run's own seals); a turn without the call is `malformed` (`result_tool_not_called`) - the B-era final-text parse is removed; no
  `text.format` / `output_config` key (each a reviewed OD-90 pin move E does not make); thinking is never enabled. Proven by
  `b21-e1-result-tool.test.ts`.
- **The owner may choose otherwise:** `output_config.format` / `text.format` structured outputs (an OD-90 key-set move per adapter, and
  per the dated page not documented for `claude-opus-4-7`).

### OD-117 — The per-role provider/model table and its default, as applied (B21-E1, 2026-09-27)

- **Question:** which provider and model does each role run on (D21-19)?
- **Applied:** `ROLE_PROVIDER_POLICY` is data and every role inherits the coordinator's provider and that provider's one configured model
  (today's behaviour); overrides come only from the server env `SIRKIT_ORCHESTRATION_ROLE_MODELS` under a closed schema (at most 8 roles,
  2 048 characters, exactly `provider` / `model` per role), and a refused map approves nothing (`provider_policy_invalid` for every
  specialist, visibly); never from the request body. A model outside its provider's pinned family rules (read from `openai-config.ts` /
  `anthropic-config.ts`, where the providers apply them) and not the configured model is refused `model_unqualified` for the role until
  qualified live (LB-9); a key named twice in the map (however spelled) refuses it too. A provider that is OUT (its breaker open) falls
  back to the other only when the role's tools and the result tool render identically on both and the other provider is not paused
  (`provider_unavailable` otherwise; a window pause never falls back); with two providers that other provider is the coordinator's, so
  only an env-routed role ever falls back; the coordinator never switches provider. Every outcome records its route (provider, model,
  source, SDK retries 0, a fallback's origin), and a specialist's run carries the provider it runs on, so what it seals names that
  provider. Proven by `b21-e1-provider-policy.test.ts`, `b21-e1-fallback.test.ts`, `b21-e1-provider-breaker.test.ts` case 6,
  `b21-e1-chat-provider.test.ts` case 2.
- **The owner may choose otherwise:** a committed table instead of the env, qualifying a model live (its family rule extended), or
  letting a policy refusal fall back to inherit.

### OD-119 — OpenAI background mode / Anthropic Message Batches for specialist work, as applied (B21-E1, 2026-09-27)

- **Question:** background mode or batches for interactive specialist work?
- **Applied:** never: background mode keeps response data about 10 minutes even under `store: false`, and batches are asynchronous up
  to 24 h (the dated notes). No request carries `background`, and no adapter touches a batch surface - pinned by
  `b21-e1-result-tool.test.ts` case 2 (the pinned key sets; the fake clients' batch, file and beta surfaces throw when touched).
- **The owner may choose otherwise:** batches for an opt-in offline evaluation at half price (B21-F), never interactive.

### OD-132 — amendment (B21-E1, 2026-09-27): one bullet appended to the existing OD-132 entry

- **Amended by B21-E1:** since B21-E1 every specialist runs on its own adapter and a role may run on a routed model of its provider, so
  "one adapter per provider" no longer holds; the source rule stands, re-worded: one provider is ONE source whatever model or adapter
  its specialists ran on. "B21-E ... will key sources by the provider and model" is RE-DEFERRED (to the owner, with B21-F's
  evaluations): E1 keeps the provider as the key - conservative, it never presents two models of one vendor as independent sources. The
  trace block is B21-E2's (OD-112).

### The README row (`artifacts/ai-control-plane-b21/README.md`, a new row "B21-E1" after B21-D3)

| B21-E1 provider routing and failure behaviour: the provider layer | `provider-routing-and-failure.md` (E1 sections); code `app/lib/agent/orchestration/provider-policy.ts` and `result-tool.ts` (new), `app/lib/agent/orchestration/scheduler.ts` (the attempt's route, the chain, the stop and the result call - in the attempt, re-pinned on the pages; helpers appended), `app/api/chat/orchestration-runtime.ts` (the providers into the scheduler, the follow-up pause - in place; the production layer appended), `app/api/chat/route.ts` (line 520 in place), `app/lib/agent/adapters.ts` (the stop and the retries in place; the mappers and `agentAdapterForRole` appended), `app/lib/agent/contracts.ts` (`stop?` in place; `STEP_STOPS` appended), `app/lib/acquisition/admission-control.ts` (the key union in place; the meters appended), `app/lib/agent/run-consumer.ts` (the settlement in place; the list re-exported, appended), `app/lib/ai-preferences.ts` (the withheld Retry on the owned dispatch and the JSON path in place; the list appended), `app/page.tsx` (the card's Retry reads the flag - in place, no control), `app/lib/agent/orchestration/merge.ts` (the source rule's wording, in place), `app/lib/llm/{openai-config,openai-provider,anthropic-provider}.ts` and `anthropic-config.ts` (the family rules named once) | CONFIRMED (every role inheriting the coordinator's provider and its configured model, overrides only from the server env under a closed schema that refuses everything when it refuses anything, a model outside its provider's pinned family rules refused until qualified live; a specialist's adapter built like the coordinator's with `maxRetries: 0`; the `llm-provider` admission key with the agent's process-wide share and a breaker that opens at once on no credits for an hour and on a rate limit for a minute, every call's outcome counted only under the breaker generation it was admitted in and an abandoned trial never counted, consulted before every specialist attempt and the follow-up turn (whose calls are metered too) - one paid specialist call after a no-credits 429 through the production POST and none in the next request, which stands down `provider_paused`; a window pause mid-run escalates only its task; no Retry offered for quota or an open breaker on either path of the card, its Switch still re-sending the message; what a routed specialist seals names the provider it ran on; the compatible fallback only when the tools and the result tool render identically on both providers, never the coordinator switching; the closed StepStop derived inside each adapter, a specialist's output-limit, context-window and refusal stops escalated and never parsed or retried; the strict result tool with `tool_choice: auto` on both providers validated by A, the B-era final-text parse removed; no background or batch (OD-119); OD-115, OD-116, OD-117, OD-119 applied; D21-18, D21-19, D21-20 (as policy) and D21-21 closed; D21-39 and D21-40 found, low; the adversarial review's 21 confirmed findings fixed test-first; 56 new cases in eight suites; pin moves in A's gate, B's scheduler and route suites, D's merge and route suites, D2's provenance and route suites, D3's route suite, B20-A0's key, B19-D's closure gate and B07.5's JSON-path pin, with the B..D3 pages re-pinned and noted; no generator input changed, the B17-A inventory regenerated with zero drift) |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-E1 — provider routing and failure behaviour: the provider layer (2026-09-27 local; increment workflow + lead; this commit)

- Test-first: the seven E1 suites ran against the base with only the tests present (`e1-failing-first.log`: five on the missing
  modules, the route's cases 2 and 3 and both retry-card cases on their assertions; route case 1 green by design); the moved suites
  with their B-era doubles against the E1 code (`e1-moved-failing-first.log`: 98 of 277 failing); then green.
- Code: `provider-policy.ts` (the role table, the closed env schema, qualification against the rule objects, the fallback rule over
  both renderers, the meters' port and the admitted adapter, the route decision), `result-tool.ts` (the strict declaration, the
  specialist's wrapper capturing the one call and the stop, the arguments parse through A, the stop reasons), `scheduler.ts` (per
  attempt: the coordinator's pause, the route, the chain, the stop and the captured call; no retry against a paused provider; another
  provider's outage stops only its task; `parseSpecialistResult` removed), `orchestration-runtime.ts` (the providers handed on, the
  follow-up pause, `productionSpecialistProviders`), `route.ts` (line 520), `adapters.ts` (the stop per step, the retries per adapter,
  `agentAdapterForRole`), `contracts.ts` (`stop?`, `STEP_STOPS`), `admission-control.ts` (the `llm-provider` kind and meters),
  `run-consumer.ts` and `ai-preferences.ts` (no Retry for quota or an open breaker on either path of the card, the Switch's new run
  kept), `page.tsx` (the card's Retry reads the flag, in place), the family rules named once in `openai-config.ts` and the new
  `anthropic-config.ts`; the workflow's one explicit entry. No route, descriptor, UI control, request key or generator input changed;
  census 165/162/3/0.
- Fix round (the adversarial review's 21 confirmed findings, test-first: `fix-red-1.log` 18 of 48 failing, `fix-red-ambient-env.log` 24
  of 39; green `fix-green-1.log` 82 of 82, `fix-green-ambient-env.log` 42 of 42; five test-strength findings proven by source mutations
  restored by sha256): the Switch re-sends after a no-credits failure (the closure dispatched with `retryOffered: false`) and the JSON
  path withholds Retry too; a routed specialist's seals name its provider; `provider_paused` for the coordinator's provider paused by
  the meters, a window pause mid-run escalating only its task; tickets and breaker generations (no stale outcome moves the breaker, an
  abandoned trial is not counted); the follow-up turn metered; a key named twice refuses the role map; the merge's source rule re-worded
  (OD-132's provider-and-model keying re-deferred); the migrated route suites pin the role env; B's C30 re-pinned, D3's C36 re-anchored,
  the provider notes re-pointed.
- Pin moves with their reasons: A's gate cases 1, 3 and 5; the scripted doubles through the result tool (the role, merge and D2
  fixtures, B's scheduler double, D's case 22 double, the four route mocks with `agentAdapterForRole` and the meters reset); B's scheduler
  case 9 and D2's provenance case 9; B20-A0's key case 1 (an added assertion); B19-D's closure gate (the meters' exemption); B07.5's
  JSON-path pin (the fix round); B09.2's recovery case 2 moved in the first round and restored to its base text by the fix round; the
  B..D3 pages' 75 rows into the scheduler and the runtime re-pinned, B's C14, C16, C24, C52 and D2's C17 re-anchored, B's C30 re-pinned
  and D3's C36 re-anchored, dated notes on B, D and D2.
- Findings: D21-39 (low: the coordinator's first turn is not gated by the breaker - a request while its provider is paused still makes
  that one call; for B21-E2), D21-40 (low: the scripted fixture agent answers no specialist through the result tool - with orchestration
  on under the fixture runtime every specialist would be `malformed`; for B21-F's per-role scripts). RECORDED: OD-108's deviation
  stands (the result tool is the specialist's channel; the follow-up turn's input is unchanged).
- Gates re-run one job at a time (the lead re-runs them): every B21 suite and the route suites with the CI guard; `app/api/chat/__tests__`
  in full; `app/lib/agent/__tests__` in full; `app/lib/llm/__tests__`; `app/lib/acquisition/__tests__`; `app/lib/mcp` and
  `app/api/mcp/__tests__`; the exposure / tier suites; the B17-A inventory and the B18-D UI gates; tsc; eslint - figures in the report.
- Records: `provider-routing-and-failure.md` (E1 sections); `provider-reference-notes.md` (the installed packages' facts, 2026-09-27);
  OD-115, OD-116, OD-117, OD-119 applied; D21-18, D21-19, D21-20 (as policy), D21-21 closed; D21-39, D21-40 found. Live: every B21
  behaviour with a real model BLOCKED-LIVE-QUALIFICATION (LB-9).

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-E1 committed on chapter/b21-specialist-orchestration: the provider layer - every role inheriting the
coordinator's provider and its one configured model, server-env overrides only under a closed schema, a model outside the pinned family
rules refused until qualified live; specialists on their route's own adapter with maxRetries 0 behind the llm-provider breaker (no
credits opens it at once for an hour, a rate limit for a minute; only a call's own breaker generation counts, an abandoned trial never;
consulted before every specialist attempt and the follow-up turn, which is metered too; provider_paused when the meters stop the DAG;
no Retry for quota or an open breaker, the Switch still re-sending; a routed specialist's seals name its provider); the compatible
fallback only when the tools and the result tool render identically, never the
coordinator switching; normalized stop reasons with a specialist's output-limit, context-window and refusal stops escalated, never
parsed; the strict result tool with tool_choice auto on both providers validated by A, the final-text parse removed; no background or
batch; next B21-E2". `nextAction`: "B21-E2 test-first: the additive run events and the status line (OD-126, OD-127), the trace block in
a new module (OD-112, D21-11's trace half, D21-3's calls), the route-level resume with the userMessageDigest ledger (OD-122, D21-4 at the
route; D21-16's route half; D21-17's live-head half), the composer's kind swap (D21-38), and gating the coordinator's first turn by the
breaker (D21-39)". The report line for the closeout: `MULTI-AGENT STATUS: contracts and durable record (B21-A), the deterministic
router, the no-provider path and the bounded sequential scheduler with the store bound (B21-B), the nine roles with least-privilege
subsets and the no-elevation proof (B21-C), the deterministic merge with escalation and verification by the families' and the
deterministic verifiers (B21-D), proposing specialists whose artifacts are their own runs' gateway seals with the one accepted proposal
presented for human approval (B21-D2), scenario 17's timer replacement structural through the production POST (B21-D3), and the
provider layer - per-role routing, the llm-provider breaker, normalized stops and the strict result tool (B21-E1) - delivered offline
behind SIRKIT_ORCHESTRATION_ENABLED; the run events, the trace block, the route-level resume and evaluations pending (B21-E2..F); live
disagreement / fallback / quota BLOCKED-LIVE-QUALIFICATION under LB-9`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect; §10 gains a B21-E1 amendment)

- **D21-18 (no provider-level circuit breaker, quota or Sirkit-owned retry)** — CLOSED by B21-E1 (OD-115): the `llm-provider` admission
  key and breaker (no credits open it at once for an hour, a rate limit for a minute, three transient failures for a minute; one trial
  after the window; an operator reset), every specialist call admitted under the agent's share and recorded, the pause consulted before
  every specialist attempt and before the follow-up turn (whose calls are metered too), outcomes counted only under the breaker
  generation their call was admitted in and an abandoned trial never, a window pause mid-run escalating only its task and the
  coordinator's paused provider stopping the DAG `provider_paused`, no retry against a paused provider, specialists' SDK retries 0 (every
  retry the scheduler's own, counted and metered), and no Retry offered for `provider_insufficient_quota` or `provider_breaker_open` on
  either path of the card while its Switch still re-sends the message (`b21-e1-provider-breaker.test.ts` cases 1 to 13,
  `b21-e1-retry-card.test.ts` cases 1 to 4, `b21-e1-chat-provider.test.ts` case 3: one paid specialist call after a no-credits 429
  through the production POST, none in the next request). RECORDED: the coordinator's own first turn is not gated (D21-39); live 429
  behaviour BLOCKED-LIVE-QUALIFICATION.
- **D21-19 (no server-owned provider/model-by-role policy)** — CLOSED by B21-E1 (OD-117): `ROLE_PROVIDER_POLICY` inheriting by default,
  server-env overrides only under a closed schema (a key named twice refuses it), a model outside its provider's pinned family rules
  (now named once in the config modules the providers apply them from) refused until qualified live, the compatible fallback only when
  the role's tools and the result tool render identically on both providers, never the coordinator switching, and a routed specialist's
  seals naming the provider it ran on (`b21-e1-provider-policy.test.ts`, `b21-e1-fallback.test.ts`).
  The loop's "no fallback here" comment and route.ts:13-15 stand: the coordinator never restarts on another provider.
- **D21-20 (structured output only as a forced tool call)** — CLOSED AS POLICY by B21-E1 (OD-116): the strict result tool with
  `tool_choice: auto` on both providers, validated server-side by A, no `text.format` / `output_config` key (`b21-e1-result-tool.test.ts`).
  Whether a live model calls it, and whether Anthropic's strict mode accepts the schema live: BLOCKED-LIVE-QUALIFICATION (LB-9).
- **D21-21 (stop reasons not normalized)** — CLOSED by B21-E1: the closed `StepStop` derived inside each real adapter (Anthropic's seven
  stop reasons, OpenAI's status with its incomplete reason and refusal part - the dated notes and the installed packages, 2026-09-27),
  carried on `AgentStep` as one optional field, read on a specialist's run path only - the output limit and the context window escalated
  and never parsed, a refusal escalated and never retried - the coordinator's loop unchanged (`b21-e1-stop-reasons.test.ts`).
- **D21-39 (new, low) — the coordinator's first turn is not gated by the llm-provider breaker.** E1 meters and gates specialist calls
  and the follow-up turn only; a request made while the coordinator's provider is paused still makes its first turn's call (one paid call
  per request, never a storm: no Retry is offered for quota or an open breaker). **CONFIRMED** (`b21-e1-chat-provider.test.ts` case 3).
  Closes: B21-E2 (the route gates the first turn, with a `provider_breaker_open` terminal the card already declines to retry).
- **D21-40 (new, low) — the scripted fixture agent answers no specialist through the result tool.** `FixtureAgentAdapter` (Playwright's
  scripted agent) plans single-agent instructions only; with orchestration enabled under the fixture runtime every specialist would end
  `result_tool_not_called`. **INFERRED** (the flag is off in `playwright.config.ts`, so no browser run reaches it). Closes: B21-F (the
  per-role scripted specialists answer through the tool).
- **§10, B21-E1 amendment:** OD-115, OD-116, OD-117 and OD-119 applied as `provider-routing-and-failure.md` states them; D21-18, D21-19,
  D21-20 (as policy) and D21-21 closed; D21-39 and D21-40 found (low); OD-108's deviation recorded as standing; A's gate, the scripted
  doubles and route mocks, B's scheduler case 9, D2's provenance case 9, B20-A0's key case 1 and B19-D's closure gate moved with their
  reasons; the B..D3 pages re-pinned (75 rows) and B's C14, C16, C24, C52 and D2's C17 re-anchored, with dated
  notes; the installed packages' facts recorded in `provider-reference-notes.md` (2026-09-27, no page fetched). The adversarial review's
  fix round: 21 confirmed findings fixed test-first (`provider-routing-and-failure.md` section 7) - B09.2's recovery case 2 restored to
  its base text, B07.5's JSON-path pin moved, `provider_paused` added to B's stops, B's C30 re-pinned, D3's C36 re-anchored, the D page's
  D8 row and OD-132 amended (the provider-and-model source key re-deferred), the provider notes re-pointed.

## 9. Citations, as of base a4aba95

The anchor is what is checked (it occurs exactly once in its file). For every file E1 changed the line is the CURRENT line and page case 5
checks it; for every other file the line is as of the base. C61-C72 and the re-anchored C46, C53, C54 and C55 are the fix round's.

| # | file | line | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/agent/orchestration/provider-policy.ts` | 37 | — | `export const ROLE_PROVIDER_POLICY:` | the role table: every role inherits |
| C2 | `app/lib/agent/orchestration/provider-policy.ts` | 39 | — | `export const ROLE_MODELS_ENV = "SIRKIT_ORCHESTRATION_ROLE_MODELS" as const;` | the one server-env source |
| C3 | `app/lib/agent/orchestration/provider-policy.ts` | 51 | — | `export function parseRoleModelOverrides(` | the closed, bounded schema; a refused map approves nothing |
| C4 | `app/lib/agent/orchestration/provider-policy.ts` | 84 | — | `export const MODEL_FAMILY_RULES:` | the pinned rules, the providers' own objects |
| C5 | `app/lib/agent/orchestration/provider-policy.ts` | 86 | — | `export function qualifiedModel(` | qualified: the configured model, or every rule of its provider |
| C6 | `app/lib/agent/orchestration/provider-policy.ts` | 104 | — | `export function resolveRoleRoute(` | a role's route from the table and the server env only |
| C7 | `app/lib/agent/orchestration/provider-policy.ts` | 123 | — | `export function fallbackCompatibility(` | the compatible-fallback rule |
| C8 | `app/lib/agent/orchestration/provider-policy.ts` | 128 | — | `const parity = renderAgentProviderParity(offered)` | the three-way parity gate's rule, reused |
| C9 | `app/lib/agent/orchestration/provider-policy.ts` | 170 | — | `export function admittedAdapter(` | every specialist call admitted and recorded once |
| C10 | `app/lib/agent/orchestration/provider-policy.ts` | 228 | — | `export function decideSpecialistRoute(` | the role's route, the fallback, or `provider_unavailable` |
| C11 | `app/lib/agent/orchestration/provider-policy.ts` | 158 | — | `export function llmProviderOutcomeOf(` | what a failure tells the breaker |
| C12 | `app/lib/llm/openai-config.ts` | 60 | — | `export const OPENAI_REASONING_MODEL_FAMILY = ` | the OpenAI reasoning family, named once |
| C13 | `app/lib/llm/openai-config.ts` | 61 | — | `export const OPENAI_NO_TEMPERATURE_MODEL_FAMILY = ` | the OpenAI no-temperature family, named once |
| C14 | `app/lib/llm/anthropic-config.ts` | 11 | — | `export const ANTHROPIC_TEMPERATURE_MODEL_FAMILY = ` | the Anthropic temperature family, named once |
| C15 | `app/lib/llm/openai-provider.ts` | 161 | — | `const supportsTemperature = !OPENAI_NO_TEMPERATURE_MODEL_FAMILY.test(this.model);` | the provider applies the named rule |
| C16 | `app/lib/llm/anthropic-provider.ts` | 105 | — | `const supportsTemperature = ANTHROPIC_TEMPERATURE_MODEL_FAMILY.test(this.model);` | the provider applies the named rule |
| C17 | `app/lib/agent/adapters.ts` | 321 | — | `export function agentAdapterForRole(` | a role's adapter; the coordinator's is agentAdapterFor's |
| C18 | `app/lib/agent/adapters.ts` | 312 | — | `export const SPECIALIST_SDK_MAX_RETRIES = 0;` | a specialist's SDK retries |
| C19 | `app/lib/agent/adapters.ts` | 112 | — | `maxRetries: this.maxRetries, timeout: 120_000` | the OpenAI client's retries per adapter (the coordinator's 2) |
| C20 | `app/lib/agent/adapters.ts` | 213 | — | `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: this.maxRetries })` | the Anthropic client's retries per adapter (the coordinator's SDK default) |
| C21 | `app/lib/agent/adapters.ts` | 87 | — | `stop: openAIStepStop(response, items)` | the OpenAI step's stop, from the judged list |
| C22 | `app/lib/agent/adapters.ts` | 189 | — | `stop: anthropicStepStop(message.stop_reason)` | the Anthropic step's stop |
| C23 | `app/lib/agent/adapters.ts` | 278 | — | `function openAIStepStop(` | OpenAI's status, incomplete reason and refusal part |
| C24 | `app/lib/agent/adapters.ts` | 291 | — | `function anthropicStepStop(` | Anthropic's seven stop reasons |
| C25 | `app/lib/agent/contracts.ts` | 231 | — | `stop?: StepStop;` | the one new optional field of AgentStep |
| C26 | `app/lib/agent/contracts.ts` | 465 | — | `export const STEP_STOPS = Object.freeze(` | the closed vocabulary |
| C27 | `app/lib/acquisition/admission-control.ts` | 50 | — | `{ kind: "llm-provider"; provider: "openai"` | the key union's reviewed extension |
| C28 | `app/lib/acquisition/admission-control.ts` | 341 | — | `export const LLM_PROVIDER_ADMISSION = Object.freeze({` | the windows and the breaker's durations |
| C29 | `app/lib/acquisition/admission-control.ts` | 414 | — | `export function recordLlmProviderOutcome(` | how an admitted call's outcome moves the breaker |
| C30 | `app/lib/acquisition/admission-control.ts` | 433 | — | `if (outcome === "insufficient_quota") return open("insufficient_quota", LLM_PROVIDER_ADMISSION.quotaOpenMs);` | no credits: open at once, the long window |
| C31 | `app/lib/acquisition/admission-control.ts` | 406 | — | `export function currentLlmProviderPause(` | the pause, per purpose, reserving nothing |
| C32 | `app/lib/acquisition/admission-control.ts` | 443 | — | `export function resetLlmProviderBreaker(` | the operator's reset |
| C33 | `app/lib/agent/orchestration/result-tool.ts` | 29 | — | `export const SPECIALIST_RESULT_TOOL_NAME = "sirkit_specialist_result" as const;` | the result tool's name |
| C34 | `app/lib/agent/orchestration/result-tool.ts` | 45 | — | `export function specialistResultToolSchema(role: SpecialistRole): JsonSchema {` | its source schema: the result's content keys |
| C35 | `app/lib/agent/orchestration/result-tool.ts` | 71 | — | `const inputSchema = toStrictSchema(specialistResultToolSchema(role));` | strict through toStrictSchema, then the wire subset |
| C36 | `app/lib/agent/orchestration/result-tool.ts` | 97 | — | `export function specialistRunAdapter(` | the specialist's wrapper: the declaration appended, the call captured |
| C37 | `app/lib/agent/orchestration/result-tool.ts` | 104 | — | `if (step.stop !== undefined && step.stop !== "end_turn") {` | a stopped turn captured, its calls dropped |
| C38 | `app/lib/agent/orchestration/result-tool.ts` | 127 | — | `export function specialistResultFromCapture(` | not called, not alone, or the arguments' parse |
| C39 | `app/lib/agent/orchestration/result-tool.ts` | 138 | — | `export function parseSpecialistResultArguments(argumentsText: string, role: SpecialistRole): SpecialistResultParse {` | the arguments judged by A's validator |
| C40 | `app/lib/agent/orchestration/result-tool.ts` | 166 | — | `export const SPECIALIST_STOP_REASONS:` | a stop's dissent reason |
| C41 | `app/lib/agent/orchestration/scheduler.ts` | 493 | — | `const routing = deps.providers ? routeAttempt(` | every attempt routed through the provider layer |
| C42 | `app/lib/agent/orchestration/scheduler.ts` | 494 | — | `if (routing?.kind === "coordinator-paused")` | the coordinator's provider paused: no specialist call |
| C43 | `app/lib/agent/orchestration/scheduler.ts` | 546 | — | `const specialist = specialistRunAdapter(admitted?.adapter ?? deps.adapter, specialistResultToolDeclaration(task.role));` | the chain: the route's adapter, the meters, the result tool |
| C44 | `app/lib/agent/orchestration/scheduler.ts` | 588 | — | `if (result.status === "completed" && specialist.capture.stop !== null) {` | a stopped turn escalated, never parsed |
| C45 | `app/lib/agent/orchestration/scheduler.ts` | 626 | — | `const retry = retryable && paused === null;` | no retry against a paused provider |
| C46 | `app/lib/agent/orchestration/scheduler.ts` | 633 | — | `if ((!route || route.provider === coordinator.provider) && !(retryable && paused?.reason === "quota_exhausted")) stop = "provider_outage";` | only the coordinator's provider's outage stops the DAG; another provider's, or a retry a window pause withheld, stops only its task |
| C47 | `app/lib/agent/orchestration/scheduler.ts` | 796 | — | `function routeAttempt(` | the attempt's routing |
| C48 | `app/lib/agent/orchestration/scheduler.ts` | 344 | — | `specialistResultToolRule(task.role), ...specialistResultRules(task.role),` | the frame's result rule |
| C49 | `app/api/chat/orchestration-runtime.ts` | 265 | — | `const followUpPause = input.providers ?` | the follow-up turn never made against a paused provider |
| C50 | `app/api/chat/orchestration-runtime.ts` | 496 | — | `export function productionSpecialistProviders(): SpecialistProviders {` | the production provider layer: agentAdapterForRole, the meters, process.env |
| C51 | `app/api/chat/route.ts` | 520 | — | `providers: productionSpecialistProviders()` | the route binds it |
| C52 | `app/api/chat/route.ts` | 14 | — | `No silent cross-provider fallback exists;` | the coordinator never switches provider (stands) |
| C53 | `app/lib/ai-preferences.ts` | 193 | — | `export const PROVIDER_FAILURES_WITHOUT_RETRY = Object.freeze(` | the failures without Retry: the ONE list, beside the owned dispatch |
| C54 | `app/lib/agent/run-consumer.ts` | 42 | — | `retry: input.startNewRun, ownership: input.ownership, ...(providerRetryOffered(input.reason) ? {} : { retryOffered: false as const })` | the chat settlement: the new-run closure kept, the Retry withheld |
| C55 | `app/page.tsx` | 6859 | — | `disabled={!lastAiRetryRef.current || !aiProviderFailure.retryOffered}` | the card's existing Retry reads the withheld flag |
| C56 | `app/lib/agent/adapters.ts` | 122 | — | `tool_choice: tools.length > 0 ? "auto" : undefined,` | OpenAI: `auto` |
| C57 | `app/lib/agent/adapters.ts` | 224 | — | `tool_choice: tools.length > 0 ? { type: "auto", disable_parallel_tool_use: true } : undefined,` | Anthropic: `auto`, never `any` / `tool` |
| C58 | `app/lib/mcp/__tests__/b20-a5-provider-request-shape.test.ts` | 52 | — | `const OPENAI_PARAM_KEYS = ` | the pinned request key sets, untouched |
| C59 | `app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts` | 128 | — | `admission-control\.ts$` | the closure gate's reviewed exemption of the meters |
| C60 | `.github/workflows/deterministic-manufacturing.yml` | 149 | — | `app/api/chat/__tests__/b21-e1-chat-provider.test.ts` | the route suite's one explicit CI entry |
| C61 | `app/lib/ai-preferences.ts` | 176 | — | `typeof data.reason === "string" && providerRetryWithheld(` | the shared card's JSON 503 path withholds Retry the same way |
| C62 | `app/page.tsx` | 6875 | — | `startNewRun: lastAiRetryRef.current,` | the Switch hands the kept closure to performProviderSwitch (it re-sends on the other provider) |
| C63 | `app/lib/agent/orchestration/provider-policy.ts` | 61 | — | `const duplicate = duplicateKeyOf(raw);` | a key named twice refuses the whole map |
| C64 | `app/lib/agent/orchestration/scheduler.ts` | 550 | — | `{ runId, provider: route?.provider ?? coordinator.provider, history: [],` | the run carries the provider it runs on: its seals name it |
| C65 | `app/lib/acquisition/admission-control.ts` | 400 | — | `const trial = state.openUntil !== 0 && state.openUntil <= now;` | an admitted call's ticket: its generation, whether it is the trial |
| C66 | `app/lib/acquisition/admission-control.ts` | 416 | — | `if (ticket.generation !== generationOf(meterKey)) { recordStaleNoCredits(` | an outcome under an earlier generation never moves the breaker - [B21 E1 lead] except a no-credits answer, a fact about the account: it still opens the long window unless an operator reset came after its call's admission |
| C67 | `app/lib/acquisition/admission-control.ts` | 436 | — | `if (outcome === "inconclusive") return;` | an abandoned call, the trial included, is not counted |
| C68 | `app/lib/agent/orchestration/scheduler.ts` | 585 | — | `if (admitted.capture.paused.reason === "breaker_open" && route?.provider === coordinator.provider) stop = "provider_paused";` | a mid-run refusal stops the DAG only on the coordinator's open breaker |
| C69 | `app/api/chat/orchestration-runtime.ts` | 267 | — | `const followUpMeters = input.providers ? admittedAdapter(` | the follow-up turn's calls metered |
| C70 | `app/api/chat/orchestration-runtime.ts` | 254 | — | `if (outcome.stop === "provider_paused") return standDown(` | the paused stand-down, never claiming a failure |
| C71 | `app/lib/agent/orchestration/merge.ts` | 310 | — | `const sourceOf = (task: SpecialistTaskOutcome): string =>` | the provider is the source, whatever model or adapter |
| C72 | `app/lib/agent/orchestration/scheduler.ts` | 88 | — | `"provider_outage", "provider_paused",` | the stop the meters make |
