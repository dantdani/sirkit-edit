# L.1 — Generation limit and stall map (2026-10-17)

Section L.1 of `artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md`. This was a read-only analysis.
No source, test, configuration or database row was changed, and no paid provider call was made.

**Labels.** CONFIRMED means evidence (call records, the dev log, an existing test). INFERRED means code reading or a
deduction from timing and token counts. UNKNOWN means the data was not retained. VERIFIED means an L.1 source
observation was re-checked at `file:line` in the current tree.

**Tree.** `codex/astra-foundation` at `5b4a941b`, plus the uncommitted 180 s correction (`build-boundary.ts` and the
edits to `build-multi-generation.ts`, `build-loop.ts`, both providers and `parts-search.ts`). Line numbers refer to
that tree.

**Evidence used.**

- **Dev log.** `.next/dev/logs/next-development.log` from the owner's server (pid 8096, started 05:17:47 EDT): 22 lines,
  05:17:56–08:38:58 EDT. Next 16.2.6 patches the server console into this file (`console-file.js`).
  - Route-handler warnings are present (`[pcb-sync]`, `[digikey]`).
  - Request access lines are not.
- **Call records.** ONE read-only SELECT of `durable_workflow_records` rows with
  `aggregate_type = 'llm.call-record.v1'` and `created_at >= 2026-10-17` (782 rows, 6 requests).
  - It read only metadata fields: request ref, seq, route, provider, model, kind, token counts, latency, outcome and
    start time.
  - The records hold no prompt, answer, tool argument or principal (`app/lib/observability/llm-call-record.ts:1-20`).
  - The script ran from the session scratchpad with `SIRKIT_DB_POOL_MAX=1`, and its output was redacted.
- **`.env.local`.** Variable NAMES only.
  - Set: `SIRKIT_OPENAI_MODEL` and `SIRKIT_OPENAI_REASONING_EFFORT` (values not read).
  - Absent: `SIRKIT_BUILD_ITERATION_CAP` and `SIRKIT_DB_POOL_MAX`.

## 1. L.1 source observations

| L.1 observation | where (current tree) | verdict |
|---|---|---|
| Build awaits ONE `POST /api/schematic/build-multi`; only the client sets the status labels | `app/page.tsx:5116` handler; `:5128` "Preparing request"; `:5146` "Generating build netlist"; `:5147-5152` the single awaited fetch (aborted only on project switch or unmount); `:5139` Retry re-runs the whole request | VERIFIED. No server progress feed, no job. |
| `BUILD_BUDGET` is 180 s / 20 turns / 3 concurrent; the env var only lowers the turn cap | `app/lib/schematic/build-result.ts:68-76` (`:70` 20, `:72` 3, `:75` 180_000); `:80-87` `SIRKIT_BUILD_ITERATION_CAP` is clamped to 1..20 | VERIFIED. The deadline and the concurrency cap have no override. |
| One clock starts before planning; the whole block pool is awaited; finished blocks are not durable | `build-multi-generation.ts:191` `startedAt`; `:192` clamp to 1 s..180 s; `:195-196` outer `withinBuildBoundary`; `:217` one `deadlineAt` shared by every loop; `:225` planner; `:267-284` pool, with the in-memory results array at `:168-179`; `:197-207` the deadline/cancel return carries no block data; `:293-294` one block's provider failure discards the others | VERIFIED. A boundary rejection drops every finished block (INFERRED from code). That a provider failure takes precedence over two finished blocks is CONFIRMED by the existing test `generation-recovery.test.ts:305-322`. |
| Loop state lives only in memory | `build-loop.ts:198` `returnedParts`; `:201` ERC rejections; `:205` turn count; `:207` `messages`; `:267` `seenPartIds` (reset every turn) | VERIFIED. Persisting only a final netlist cannot resume a loop. |
| Chat has 6 steps / 10 tools / 15 s per tool / 120 s per run; the 185 s descriptor cannot outlive the run | `app/lib/agent/contracts.ts:181-188`; `loop.ts:315` run timer, `:392` steps, `:422` tool calls, `:448` identical calls, `:473-476` long-running timeout = min(descriptor, remaining run time); `engineering/tool-catalog.ts:1136` 185_000; `generation-proposals.ts:259-260` deadline = min(180 s, timeout − 1 s); `:269` race timer | VERIFIED. A chat generation gets at most about 119 s, minus whatever the turn has already used. |
| Cancellation and late-result guards exist | `build-boundary.ts:9-45`; `build-loop.ts:176-183`, `:213`, `:231`, `:268`, `:324`, `:344`; `openai-provider.ts:181-186`, `:197-198`, `:222`; `anthropic-provider.ts:119-120`, `:145`, `:153-154`, `:185`; `parts-search.ts:655-657` (`assertCatalogLookupCurrent`, called between every stage); `:516-534` (signal passed to the rerank call) | VERIFIED. Running SQL and `embedQuery` (`embeddings.ts:50-53`, no signal) are not cancelled. These guards must be kept. |

The Build route also passes `request.signal` into the generation (`app/api/schematic/build-multi/route.ts:48`, `:54`).
Closing or reloading the tab therefore cancels the generation: the work lives exactly as long as the HTTP request
(INFERRED from code).

## 2. Limit map: every finite limit on the generation path

| layer | limit | value | file:line | what it bounds |
|---|---|---|---|---|
| page | one generation at a time | `isGenerating` | `app/page.tsx:5117` | the client never overlaps requests |
| route | body read | 16 MB, 45 s | `api/schematic/build-multi/route.ts:48` | body reading only (`auth/route-handlers.ts:349-356`), not generation |
| route | request abort | client disconnect | `route.ts:48`, `:54` | a reload or tab close cancels the work |
| generation | wall clock | 180 s; a caller may lower it, floor 1 s | `build-result.ts:75`, `build-multi-generation.ts:192` | planner, all blocks, merge and ERC on one clock |
| generation | loops in flight | 3 | `build-result.ts:72`, `build-multi-generation.ts:267` | a 4th block waits for a free slot |
| generation | planner output | 4,096 tokens | `build-multi-generation.ts:83` | the single forced `submit_plan` |
| loop | turns per block | 20 (env may lower) | `build-loop.ts:92`, `build-result.ts:70`, `:80-87` | model turns per block |
| loop | output per turn | 8,192 tokens, temperature 0 | `build-loop.ts:224-225` | reasoning plus visible output of one turn |
| loop | ERC bounces | 2, then the design is accepted with its findings | `build-loop.ts:98`, `:354-371` | the ERC correction loop |
| loop | results per search / alternates call | 5 / 5 | `build-loop.ts:93-94` | candidates per call; every result carries its full pin list (`:51-58`) |
| loop | context | unbounded; the full history is resent every turn | `build-loop.ts:207`, `:233`, `:382` | no compaction; `seenPartIds` dedups only within one turn (`:267`) |
| search | recall pools | vector 30, lexical 30, authority 12, fused 12; at most 10 tokens; RRF constant 60 | `parts-search.ts:205-213`, `:272` | SQL work per search |
| search | category filter | exact `main_category = <the model's string>` | `parts-search.ts:291-295`, `:409` | a name not in the catalog returns zero rows from all three channels |
| search | generic exclusion | non-generic parts, or parts with a selectable atomic link | `parts-search.ts:305-311`; `parts-normalization.ts:40-81` | generic `Device` symbols (R, C, L, LED, D …) are hidden unless published |
| search | reranker | `claude-haiku-4-5`, 256 tokens; SDK defaults (2 retries, 10 min); failure falls back silently | `parts-search.ts:215-224`, `:496-561` | called on every search with ≥2 candidates; an unavailable reranker is never remembered |
| search | embeddings | `text-embedding-3-small`; SDK defaults; no cache, no signal | `embeddings.ts:11`, `:19-27`, `:33-55` | one paid call per search, even when the query repeats |
| provider | OpenAI main model | `maxRetries: 5`, `timeout: 600_000` per call | `llm/openai-provider.ts:152-156` | one turn; aborted through the signal |
| provider | OpenAI model and effort | default `gpt-5.6-sol`; effort `high` unless the env overrides it | `llm/openai-config.ts:1`, `:41`, `:44-51` | latency per turn (the effort actually configured is UNKNOWN) |
| provider | Anthropic adapter | SDK defaults; `max_tokens` 4,096 if unset | `llm/anthropic-provider.ts:100`, `:108` | not used in these runs |
| DB | pool | `max` 8 (`SIRKIT_DB_POOL_MAX`); connect 15 s; idle 20 s; no `statement_timeout` | `app/lib/db/client.ts:35-43` | each search's 3–4 sequential queries share 8 connections |
| DB | indexes on `parts` | HNSW on the embedding; b-tree on name, library and is_generic; no trigram index | `db/schema.ts:243-250` | `ILIKE '%tok%'` lexical and authority queries scan sequentially |
| chat | run | 6 steps, 10 tools, 15 s per tool, 120 s per run, 2 identical calls, 60 s settlement | `agent/contracts.ts:181-188`, `engineering/execution-grant.ts:83` | the whole chat turn |
| chat | generation tool | 185 s descriptor → min(185 s, remaining run time); the generation gets that minus 1 s; needs ≥5 s to start; prompt ≤4,000 chars | `tool-catalog.ts:1136`, `loop.ts:473-476`, `generation-proposals.ts:45-49`, `:259-260` | chat generation runs at most about 119 s |
| (L.2/L.3) | outbox lease | 30 s lease, 25 events per claim, 8 attempts, 5 s retry, no renewal | `durable-workflow/outbox.ts:16-19` | not a generation worker today |
| (L.2/L.3) | other "job" code | a process-wide `globalThis` store; a typed lease helper only | `spice/server/job-store.ts:60`; `full-flow/jobs.ts:8` | not restart-safe; not a supervised service |

## 3. What the records show for each request (times EDT = UTC−4)

All four requests went to `/api/schematic/build-multi` using OpenAI `gpt-5.6-sol`:

- Every main-model call completed, except the calls cancelled at the 180 s boundary.
- Every embedding call completed.
- Every reranker call was refused with `insufficient_quota`.

| request | start (EDT) | code / budget | planner | blocks | block turns | searches (= embedding calls) | reranked | ≤1 candidate | input / output tokens | span |
|---|---|---|---|---|---|---|---|---|---|---|
| `llmr-00f2f28b…` | 05:22:51 | pre-fix, 40 s | 9.4 s | 3 | 7 | 37 | 27 | 10 (27%) | 30,389 / 4,120 | 54.8 s |
| `llmr-908b2df8…` | 05:46:10 | pre-fix, 40 s | 13.1 s | 3 | 8 | 61 | 39 | 22 (36%) | 41,547 / 4,409 | 61.3 s |
| `llmr-93716156…` | 07:24:33 | 180 s | 19.6 s | ≥4 | 27 (2 cancelled) | 139 | 123 | 16 (12%) | 661,543 / 21,318 | 180.0 s |
| `llmr-cbba6336…` | 08:34:48 | 180 s | 12.5 s | 3 | 22 (1 cancelled) | 153 | 133 | 20 (13%) | 744,347 / 25,384 | 180.0 s |

**Which request is which (CONFIRMED).**
- The two 40 s requests came before the 05:50–06:02 correction. They are the owner's "All 3 subsystem blocks failed"
  runs.
  - In the second one, the last turns started at 32.2–32.4 s, and no turn started after 40 s.
  - The old code had no cancellation, so searches already in flight kept running until 61.3 s.
- The 07:24 request is the 180 s retry quoted in L.0.
- The 08:34 request came after section L was written (07:32) and failed the same way. Who started it is UNKNOWN,
  because the records keep no principal.
- The planner's input-token counts were 447 / 447 / 433 / 463, so the prompt text differed between attempts. Which
  attempt used the exact quoted sentence is UNKNOWN.
- Every Retry re-planned from scratch (`page.tsx:5139`).

**Latencies (CONFIRMED).**
- Planner: 9.4–19.6 s.
- Block turns: 2.2–76.1 s (median 7 s in the 180 s runs).
- Embeddings: 151–838 ms (median 226–246 ms).
- Reranker refusals: 119–628 ms each (median 141–153 ms). There were 322 refusals today, 54 s in total.

**Context growth (CONFIRMED).**
- Per-turn input rose to 73,849 and 87,152 tokens in the 180 s runs.
- A single search round added up to 43.6k tokens.
- One turn (08:34 run, 102.3→178.4 s, 61k input) stopped at the 8,192-token output cap.

**Cost (INFERRED).**
- At the ledger's price basis (`../live-spend.json`: 4.00 / 20.00 USD per million tokens), the two 180 s requests
  cost at most about 3.1 and 3.5 USD of main-model tokens. The cached-input share was not recorded.
- These were product runs, not builder tests, and neither one returned a design.

**Dev log (CONFIRMED).** None of the four time windows contains any line from the generation path. Specifically, none of:

- `[build-loop] no tool call … nudging`
- `search_parts failed` or `find_alternates failed`
- `[AI] called find_alternates`
- `ERC rejected submission` or `ERC still failing`
- `[build-loop] The build loop failed`
- `[build-multi] planner failed` or `[build-multi] post-merge ERC`
- `[parts-search] embedding provider unavailable`

Deadline exits and unknown-partId rejections write no log line at all (`build-multi-generation.ts:197-207`,
`build-loop.ts:374-379`), so the log cannot show whether either happened.

## 4. Why each block stalled

The records do not identify blocks. The block chains below were rebuilt from input-token continuity and from start
and end times, so they are INFERRED unless marked otherwise.

**Both 40 s runs.** When 40 s elapsed, all three blocks were at turn 3, inside a search round. Each one returned
`build_budget_exhausted` at its next pre-turn check (`HEAD:build-loop.ts:200-201`;
`HEAD:build-multi-generation.ts:271`). The cause was starvation on the shared clock:

- the planner took 9–13 s;
- each turn took 4–14 s;
- each search round took 1–24 s;
- the final round's catalog stage ran 18.6 s and 24.1 s past its last embedding start.

CONFIRMED by the records and the code.

**180 s run at 07:24**

- **Block H** (4–5 turns). Its last turn ran from 83.3 to 111.1 s (2,553 output tokens). At exactly 111.1 s the pool
  started a 4th block's first turn (1,390 input tokens), so H's loop returned at about 111 s. The call completed, it
  finished before the deadline, and no failure was logged. The only exit left that writes no log line is an accepted
  submission. INFERRED: a **completed block, discarded at 180 s**.
- **Block E** (11 turns, the last one cancelled). Input grew from 1.4k to 73.8k tokens; output stayed at 205–979
  tokens per turn. These were search-only turns, with no output large enough to be a netlist. E was still searching at
  180 s. INFERRED: repeated catalog queries that never reached a valid submit.
- **Block G** (5–6 turns). Its last turn ran from 105.4 to 168.5 s (63.1 s, 6,852 output tokens), and no later turn
  started before 180 s. UNKNOWN: either a submission that was rejected silently, or a search round that outlasted the
  deadline.
- **Block D** (the 4th block). It could start only at 111.1 s because of the concurrency cap of 3. It ran 6 turns
  (1.4k→28.2k input); the 6th was cancelled at 180 s. CONFIRMED timing: starved by the concurrency cap plus the single
  clock.

**180 s run at 08:34**

- **Block Z** (5 turns, at 12.5 / 22.8 / 42.8 / 56.3 / 66.6 s). Its last turn ran 34.3 s, produced 4,412 output
  tokens and ended at 100.9 s; there was no later turn. INFERRED: a **completed block at about 101 s, discarded at
  180 s**.
- **Block Y** (5 turns). One search round added 43.6k tokens. Its last turn ran from 102.3 to 178.4 s (76.1 s) with
  61k input and stopped at the 8,192-token output cap (CONFIRMED). INFERRED: it waited on the provider and then got a
  truncated response. Why a truncated response is dangerous:
  - the adapter ignores `status: "incomplete"` (`openai-provider.ts:103-124`);
  - an unparseable function call becomes `{ _raw }`;
  - `finalizeSubmission` would accept a `_raw` `submit_schematic` as an **empty successful block**
    (`build-loop.ts:428-432`, `:528-532`), because `runErc` reports no error for an empty netlist.
- **Block X** (12 turns, the last one cancelled). Input grew to 87.2k tokens; output stayed at 302–1,357 tokens per
  turn, with no output large enough to be a netlist. X was still searching at 180 s. INFERRED: repeated search turns.

**L.1 checklist**

| candidate cause | verdict |
|---|---|
| waiting on a provider | CONFIRMED, major. Main-model time is about 55% of the busiest chain's wall time (99 s of 180 s). One turn took 76 s. The planner takes 7–11% of the 180 s. |
| repeated or no-result catalog queries | CONFIRMED: 10–36% of searches never reached the reranker. Every embedding succeeded, so vector recall returns rows whenever the filter matches any. INFERRED: in each run one block kept searching for 11–12 turns. The query texts are UNKNOWN (not retained). |
| incorrect category filters | INFERRED, major. The tool's description gives only one example, "e.g. Microcontrollers" (`prompts.ts:229`). The loop passes the model's string through unchanged (`build-loop.ts:255`), and the filter is an exact match (`parts-search.ts:293-295`). The real category names come only from `categorizeLib` (`app/lib/kicad/categories.ts:10-116`; list below the table). Likely model guesses (Resistors, MOSFETs, Motor Drivers, IMU, MCU, Regulators) match none of them. The fixture catalog uses different, singular names (`fixture-runtime/blinker/catalog.ts:100-136`), so fixture tests cannot catch this. The categories actually sent are UNKNOWN. An alternative explanation is a filtered HNSW scan that drops rows after the index lookup. |
| incompatible candidates | INFERRED, major. When the reranker is refused, verified parts are placed above every unverified part regardless of relevance (`parts-search.ts:441-449`). A published resistor, capacitor, LED or header that matches one query token outranks a better-matching MOSFET or MCU. The prompt also says "STRONGLY PREFER a verified part" (`prompts.ts:197`, `:587`), which pushes the model to search again. |
| absent authoritative pins/footprints | INFERRED, contributing. Verified authority exists only for a small published set (21 atomic parts per the 2026-10-11 DB note; not re-queried), so most IC roles have no verified candidate. Catalog parts do have pins; what they lack is footprint authority. |
| invalid submission | UNKNOWN. Rejections for unknown partIds are silent. `returnedParts` belongs to one loop (`build-loop.ts:198`), so a part found by another block is invalid in this one. Accepting a `_raw` submission as an empty block is a latent defect (INFERRED). |
| ERC feedback loop | CONFIRMED absent: no ERC rejection line in any time window. |
| unavailable optional reranker | CONFIRMED. It is called on every search with ≥2 candidates and was refused 322 of 322 times (119–628 ms each, no charge). The refusal is never remembered. Its direct time cost is small, but it removes relevance ranking (row "incompatible candidates"). |
| merge-contract failure | CONFIRMED not reached: no run got as far as merging. The merge cannot throw (`merge-netlists.ts:61-103`). It also never checks that blocks honour their `sharedNets`, or that exactly one block sources each power rail. |
| actual provider/resource refusal | CONFIRMED: none on the critical path. The main model and the embeddings all completed; only the optional reranker refused. |
| catalog SQL latency (not on the L.1 list) | CONFIRMED: rounds of about 0.5–39 s between a chain's turns; the first, uncontended search spent 0.9–2.1 s in SQL. INFERRED cause: parallel searches queue on an 8-connection pool and scan sequentially with `ILIKE`. There are 3 blocks, several searches per turn, and 3–4 sequential queries per search. |

The catalog's category names (from `categorizeLib`): Passive Components, Switches & Relays, Power Sources, Magnetics,
Connectors, Microcontrollers, Op-Amps, Comparators, Voltage References, Voltage Regulators, Power Management, Diodes,
LEDs, Transistors, Sensors, Logic, Memory, Interface ICs, Drivers, RF / Wireless, Timers & Oscillators, FPGAs, Other.

## 5. Root causes beyond the time limit

1. **The work lives inside one request.** It has one HTTP request, one clock and an in-memory pool. Any of these
   discards every finished block:
   - the time window expiring;
   - one block's provider error;
   - a tab reload.

   Both 180 s runs lost a block that had already finished (at about 101 s and about 111 s; sections 1 and 4). Retry
   re-plans and redoes everything.
2. **The search tool contract does not match the catalog.** The model sends a free-text category that must exactly
   match a vocabulary it is never shown. A miss returns a bare `[]` with no hint, and nothing retries without the
   filter.
3. **Relevance collapses when the optional reranker is down.** Verified parts are always hoisted to the top. The
   reranker is known to be unavailable, yet it is called again on every search, because nothing remembers the refusal.
4. **The strategy has pressure but no exit.** "Strongly prefer verified" meets a tiny verified set, and nothing detects
   a lack of progress, so blocks search for 11–12 turns.
5. **The context blows up.**
   - Every result carries its full pin list.
   - Duplicates are removed only within one turn.
   - The full history is resent every turn: up to 87k input tokens per turn and 0.66–0.74 M per request.

   This makes turns slower (up to 76 s) and costlier, and in one case a turn hit the 8,192-token output cap.
6. **Truncated provider output is not handled.** `status: "incomplete"` is ignored, and a `_raw` submit would pass as an
   empty block.
7. **Catalog throughput is limited.** An 8-connection pool is shared by many parallel searches of 3–4 queries each.
   The `ILIKE` scans are sequential, and nothing bounds concurrent searches per task.
8. **The stall is invisible.** Block identity, turn number, candidate counts, validation codes and exit reasons are not
   recorded. Deadline exits and silent rejections log nothing.

## 6. Deterministic offline reproduction (design only; the implementation round writes the test)

Build it on the real `runBuildMultiGeneration` and the real `runBuildToolLoop`, with no network access.

**Provider seam.** Mock `@/app/lib/llm/router` with a scripted provider, as
`schematic/__tests__/generation-recovery.test.ts:14-34` already does.

- The planner returns three blocks with `sharedNets` (VBAT, +5V, +3V3, GND, PWM1-4):
  - Power;
  - Motor drivers ×4;
  - Flight controller.
- Each block's script is keyed by `Block: <name>` and the turn index.
- Each answer resolves after a virtual latency taken from `llmr-cbba6336`:
  - planner: 12.5 s;
  - Z-like turns: 10 / 5 / 9 / 8 / 34 s;
  - Y-like turns: 14 / 5 / 13 / 12 / 76 s;
  - X-like turns: 5–17 s.
- Each answer reports `usage` input tokens computed from the serialized length of `messages`, so the test asserts real
  context growth rather than scripting it.

**Catalog seam (preferred): the REAL `searchPartsForAI` over PGlite.**

- Use `app/lib/db/disposable-postgres.ts` (pgvector, pg_trgm, migrations), and mock `@/app/lib/db/client` `getDb` to
  return drizzle over PGlite.
- Seed:
  - libraries named by `categorizeLib`: Microcontrollers, Sensors, Transistors, Drivers, Voltage Regulators,
    Connectors, Passive Components, Other;
  - about 40 parts with realistic pin counts: a 64-pin MCU, a 14–24-pin IMU, 3-pin N-MOSFETs, a motor-driver IC, an
    LDO, a 2-pin JST;
  - about 5 selectable atomic links (R, C, LED, header), so the verified-first path runs.
- Mock `@/app/lib/embeddings.embedQuery` to return a deterministic hashed vector, and count the calls.
- Mock `@anthropic-ai/sdk` `messages.create` to reject with an Anthropic-shaped HTTP 400, "credit balance is too low".
  It is classified `insufficient_quota` (`llm/errors.ts:114-121`). Count these calls too.
- Use real timers with time scaled 1:100, so the caller's `deadlineMs` of 1,800 ms stands for 180 s. Fake timers do
  not mix with PGlite I/O.

**Faster unit tier.** Mock `@/app/lib/parts-search` with an in-memory fake that keeps the same contract:

- exact category equality over the `categorizeLib` names;
- generic exclusion;
- the verified-first partition;
- a refused reranker;
- an 8-slot semaphore with a virtual cost per query, so search rounds grow from 2 to 24 s as in the records.

`parts-search-cancellation.test.ts`'s proxy ignores `WHERE`, so it cannot reproduce category misses.

**Scripted model policy.** It is deterministic, and it is not a hard-coded answer:

1. Turn 1 searches with categories outside the vocabulary ("Motor Drivers", "MOSFETs", "Resistors", "IMU") and gets
   `[]`.
2. Turn 2 searches without a category.
3. If the top result's `mainCategory` does not fit the role, or the result is unverified where a verified part is
   "preferred", the block searches again with a reworded but equivalent query.
4. Power then submits a valid netlist at about 101 virtual seconds.
5. Motor drivers keeps looping through search turns.
6. Flight controller receives one `status: "incomplete"` turn whose `submit_schematic` argument string is truncated.

**Assertions on the current tree.** They document today's defects; L.3 and L.6 will flip them on purpose.

1. The outcome is 503 `build_budget_exhausted`, stage `design`, even though the Power loop returned `ok` (observed
   through the provider seam). The finished block is discarded.
2. `embedQuery` is called once per search, including for repeated equivalent queries.
3. The reranker is called on every search with ≥2 candidates, and every call is refused. None is skipped after the
   first refusal.
4. Categories outside the vocabulary return `[]`, and the count of empty searches equals embedding calls minus
   reranker calls.
5. For a MOSFET query, a verified passive outranks every MOSFET.
6. A part's full pin list is sent again in a later turn.
7. The `_raw` submission yields a zero-component block that counts as a "success".
8. With a 4-block plan, block 4 cannot start until a slot frees.
9. With the env keys stubbed to placeholders, no SDK reaches the network.

**Chat variant.** Run the same seams through `SchematicGenerationProposalService.invoke` with a 120 s run. The
generation gets at most 119 s, and the service refuses with `timeout` / `budget_exhausted`.

**Not usable as the reproduction.** The fixture runtime short-circuits the planner (`llm/router.ts:26-30`) and the loop
(`build-loop.ts:189-195`) to the recorded blinker design, so a fixture browser run can never show a multi-block stall.

## 7. What L.6 (and L.3) need, by root cause

1. **Request lifetime (cause 1 → L.2/L.3).**
   - Checkpoint each block as soon as its loop returns: netlist, surfaced-part and pin facts, normalized tool results,
     validation state.
   - When a slice window expires, queue a continuation instead of failing.
   - Keep finished blocks when another block hits a provider failure.
   - A reload detaches the viewer; it does not cancel the work.
   - Retry resumes the existing work instead of re-planning.
2. **Category contract (cause 2).**
   - Version the category vocabulary with the catalog, and expose it as an enum or through a listing tool.
   - Normalize case, plurals and common aliases: Resistors/Capacitors → Passive Components; MOSFET → Transistors;
     Motor Driver → Drivers; LDO/Regulator → Voltage Regulators; IMU/Accelerometer → Sensors;
     MCU → Microcontrollers.
   - When a category matches nothing, retry without the filter and say so in the result (`categoryApplied: false`,
     plus the valid names) instead of returning `[]`.
3. **Reranker (cause 3).**
   - Remember a non-retryable refusal (`insufficient_quota`, `authentication`, `model_access`) per task, and
     process-wide keyed by configuration, and skip the reranker after it.
   - Probe again after a configuration change or a TTL.
   - Keep the fallback relevance-preserving: boost verified parts inside the relevant top-K, never hoist them
     unconditionally.
4. **Caches.**
   - Cache query embeddings by normalized query and model within the task.
   - Cache search results by normalized query, category and catalog/authority version within the task.
   - Share surfaced candidates and pin facts across the blocks of one task (today `returnedParts` belongs to one loop).
5. **Strategy (cause 4).** Add a per-block no-progress detector: a semantic fingerprint of each query, no new candidate
   IDs, consecutive search-only turns. When it fires, the block must change strategy instead of looping. It can:
   - accept the best unverified candidate, flagged as blocked for the PCB;
   - open a K missing-part work item;
   - expose the exact blocker.

   Also rewrite the "only when no verified part can fill the role" rule so the decision is made after a single search.
6. **Context (cause 5).**
   - Return pin counts and the key pins, with full pins on demand. The build loop has no `get_part_pins` tool today.
   - Remove duplicates across turns, not only within one.
   - Compact older tool results while keeping their provenance.
7. **Truncation and submission checks (cause 6).**
   - Treat `incomplete` / `max_output_tokens` as its own state.
   - Reject `_raw` and empty submissions, with feedback to the model.
   - Check shared-net obligations before accepting a block: each block labels its `sharedNets`, and exactly one block
     sources each rail.
8. **Catalog throughput (cause 7).**
   - Bound concurrent catalog queries per task to below the pool size.
   - Set a `statement_timeout` for catalog reads.
   - Trigram or full-text indexes on `parts` need an authorized migration under the migration-delivery rules; do not
     apply one without that authorization.
9. **Visibility (cause 8).** Emit bounded, redacted stage events per block: block id, turn, operation, candidate
   counts, whether the category filter applied, validation code, exit reason and timings. Include no prompts and no
   tool arguments. The same events feed L.4's progress display.

## 8. Unknowns that remain

- The exact query strings, categories, candidates, submissions and validation errors of every turn.
- Which attempt used the exact quoted sentence.
- The configured reasoning effort.
- The cached-input share.
- The live count of published atomic parts.

None of these blocks L.2–L.6, and the reproduction in section 6 makes the pattern deterministic.
