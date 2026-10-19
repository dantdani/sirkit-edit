# The generation worker (runbook L.3, increment 3)

Written 2026-10-17 for `codex/astra-foundation` (increment 3 part 2, on top of `c8e53499` and the slice core of part 1). It documents the
process that consumes the queued slices of durable generation tasks, how to start and stop it locally, how a deployment supervises it,
and what it does and does not do yet. The design is `task-worker-contract.md` sections 3-5; this page records the implementation.
Nothing here was qualified against a live provider, a live catalog or the main database: every proof below is offline (fake model and
catalog ports, in-memory and PGlite durable stores, a simulated clock) and is labelled as such.

## 1. What runs where

| piece | file | role |
|---|---|---|
| the process | `scripts/generation-worker.ts` (`pnpm run worker:generation`) | composition root: reads `.env.local` (unless `--no-env-file`), binds the durable LLM call-record sink, runs every slice under `withLlmCallScope({ routeId: "/api/generation-tasks", method: "POST", scope })`, handles SIGINT / SIGTERM / an IPC `shutdown` request, serves `/healthz` |
| the worker | `app/lib/generation-task/worker/worker.ts` | `GenerationWorker`: claims FREE capacity only (`concurrency - running`, 1..3), each slice under its own outbox lease, concurrently; per slice a supervisor renews the lease every 15 s (S2) and polls control every 2 s, and again at every turn boundary |
| the slices | `worker/slices.ts` | plan / block / merge through the slice core (`planGeneration`, `designBlockSlice` / `runBlockSlice`, `mergeAndValidate`) inside `withinBuildBoundary`; one fenced end commit per slice |
| accounting | `worker/accounting.ts` | additive usage per commit, uncertain calls at the worst case, the cached catalog over the task's facts, full-jitter backoff that honours Retry-After, the process LLM meters (purpose `agent`) |
| progress | `worker/progress.ts` | the semantic progress judgement and the strategy ladder S1-S6 |
| composition | `worker/runtime.ts`, `worker/cli.ts` | production ports, the continuation re-check (membership, role, provider), the transports, the command line |
| local launcher | `scripts/dev-with-worker.mjs` (`pnpm run dev:with-worker`) | `next dev` and the worker together, signals forwarded; `pnpm dev` is unchanged. [PR-L, 2026-10-17] increment 4: under the fixture runtime it starts the worker with the pump transport (a per-launch secret shared by the two children only, `--concurrency 1`); the Playwright fixture server starts through it |
| the pump route | `app/api/generation-worker/route.ts` (increment 4) | `POST /api/generation-worker`: the worker secret first (fail closed when unset), then ONE awaited slice in the server's process through `runPumpedSlice` (the same `GenerationWorker` and slice code); an aborted request is a worker shutdown for the slice, never a cancel |

The worker is never a React component, a tab interval, an instrumentation-hosted loop or an unawaited route promise. Closing every
browser changes nothing: the queued slices are rows in the durable outbox and the worker consumes them.

## 2. Local startup and shutdown

Prerequisites: `.env.local` names `DATABASE_URL` (a migrated database: `pnpm run db:migrate`) and the key of the provider a task uses
(`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`). The worker refuses, claiming nothing, when `DATABASE_URL` is absent
(`GENERATION_TASK_STORE_UNAVAILABLE`, exit 2) or under the fixture runtime (`GENERATION_WORKER_NEEDS_PUMP`, exit 2; see section 5).

```text
# terminal 1 - the owner's dev server, as today (untouched)
pnpm dev

# terminal 2 - the worker (direct transport: the durable store through DATABASE_URL)
pnpm run worker:generation
pnpm run worker:generation -- --once                 # one tick: claim, run what was claimed to its settlement, exit 0
pnpm run worker:generation -- --concurrency 1        # slices in flight (1..3, default 3)
pnpm run worker:generation -- --health-port 7071     # GET http://127.0.0.1:7071/healthz
pnpm run worker:generation -- --help
```

[PR-L, 2026-10-17] Increment 4: a worker can also drive a server's store over HTTP - `pnpm run worker:generation -- --transport pump --origin http://localhost:3100`
with `SIRKIT_WORKFLOW_WORKER_SECRET` set in its environment (the server holds the same value) - which is how the fixture runtime is served.

Or, INSTEAD of `pnpm dev` (never beside it on the same port): `pnpm run dev:with-worker` (`-- --port 3005` for another port,
`-- --dry-run` to print the two commands). It spawns both children with node directly (no shell); on Ctrl+C or SIGTERM, or when either
child exits, it asks the worker to shut down over its IPC channel, sends next dev SIGTERM, and ends whatever still runs after the grace
(`taskkill /T` on Windows).

Shutdown (Ctrl+C = SIGINT, SIGTERM, or the IPC request): the worker stops claiming; every running slice yields at its next complete turn
boundary with its checkpoint committed and its continuation queued; after `--grace-ms` (default 10 s) the rest are aborted and their
leases RELEASED for immediate takeover (`releaseSlice`: the attempt's reservation stays uncertain); the pending call records are drained
(at most 5 s); exit 0. A second signal exits at once (130). A crash or `kill -9` releases nothing: each lease lapses within 45 s and any
worker then resumes the slice from its last committed checkpoint (attempt + 1). Restarting the worker resumes every task from the durable
state alone (`l3-worker-process` case 2, `l3-crash-resume`).

`/healthz` answers `{ mode, workerId, startedAt, running, lastTickAt, stopping, slicesSettled }`, bound to 127.0.0.1 only. Nothing the
worker prints carries a secret: no environment value is printed, and an error's text is redacted and stripped of the database URL's
credentials.

## 3. Deployment supervision contract

A separately supervised, long-lived service running `pnpm run worker:generation` (or `tsx scripts/generation-worker.ts`) with
`NODE_ENV=production`, `DATABASE_URL`, the provider keys, and the production identity settings the membership adapter needs.

- Restart policy: always. Any replica count is safe: every claim is a fenced CAS on the task head (`fence + 1`, the lease token), so two
  workers never commit for one slice; a late or fenced-out worker writes nothing (`l3-fencing` case 2).
- Liveness: `/healthz` (bind a sidecar or the platform's probe to 127.0.0.1); a worker that stops renewing loses its leases within 45 s.
- Stop: SIGTERM with at least the grace (10 s) plus one provider call bound before SIGKILL, or the slices are simply resumed elsewhere.
- Capacity: each process runs at most 3 slices; the process LLM meters (purpose `agent`, 60 requests per minute per provider) are per
  process, so N replicas admit up to N times that - the durable per-task allowance is the cross-process bound (OD-252).
- No worker running: a start still commits durably; the work waits and runs when a worker starts (increment 4's snapshot reports
  `no_worker`; the routes are increment 4).

## 4. What one slice does (contract section 3.2)

1. Claim (the store's `claimSlices`): free capacity only, no scope (cross-scope), then per event: the head loaded; a stale or duplicate
   event completed as a no-op; a cancelling or pausing task's slice dropped; an event lost `maxAttemptsPerSlice` (5) times becomes the
   `platform_failure` blocker; BEFORE any provider call the initiating principal's live membership and editor role are read again
   (revoked or demoted: the task `failed` / `authority_revoked`) and the provider must be servable (`provider_credentials`); the
   worst-case reservation (turns x 8 192 output tokens) must fit the allowance (`allowance_exhausted`); then the fenced head claim.
2. Run under the slice's controller (`withinBuildBoundary` with the slice window; the controller aborts on a cancel seen by the control
   poll, a lost lease, a fence taken by another owner, or the end of the shutdown grace):
   - plan: one planner call (`planGeneration`, at most 8 blocks, one correction attempt for a cut or unreadable plan, which is then
     designed as one block with `planner.state = failed_fallback`); window 90 s;
   - block: at most the slice's RESERVED turns (`min(6, SIRKIT_BUILD_ITERATION_CAP)`), window 300 s, no turn starts with under 60 s
     left, each provider call bounded at 120 s; at every complete turn boundary the checkpoint, the usage since the last boundary and the
     facts learnt are committed (fenced), the lease renewed when due and control polled; a pause or a shutdown yields there;
   - merge: the saved blocks read by reference, their parts' identity facts (name, MPN, category, pins) revalidated against the catalog,
     `mergeAndValidate` (deterministic merge, post-merge electrical check, shared-net obligations), the result aggregate; window 30 s.
3. End: ONE fenced commit that removes the slice, settles its reservation, applies its delta and schedules what follows as outbox
   effects of the same commit (S1 `availableAt` for a delay). Outcomes:

| slice outcome | what is committed | task state |
|---|---|---|
| plan ready | plan, stable block ids, one block slice per block | queued |
| block saved | the saved checkpoint (netlist, explanation, check) at once; the merge only by the end that sees no other block open | queued / running |
| window or turn allowance reached | the continuation (now); never a failed block | queued / running |
| transient provider failure (rate limit, overloaded, timeout, network) or an admission pause | the continuation at `max(Retry-After, full jitter from 5 s doubling to 300 s)` | waiting-for-provider when every pending slice is delayed |
| credentials / quota / model access refused | the block `blocked` with `provider_credentials` / `provider_quota` / `provider_access` | waiting-for-resource (partial_available when blocks are saved) |
| no progress through the ladder | the block `blocked`: `missing_part` (S6, with the empty searches named) or `no_progress` | waiting-for-resource |
| result | the result aggregate (`complete`, or `partial` only after an explicit `review-partial`) | awaiting-review |
| cancel | `settleCancel` with what the attempt spent | cancelled once no live owner remains |
| shutdown after grace, lost lease, unexpected failure | `releaseSlice` (re-queued now, reservation uncertain) | queued |
| fenced (another owner) | nothing | unchanged |

## 5. Accounting, no-progress and the strategy ladder (contract section 5)

- Usage is additive and cumulative across slices, resumes and workers: exact settled `modelCalls` and tokens; `catalogSearches` that
  reached the catalog (alternates lookups included); `cacheHits` answered from the task's facts with no catalog, embedding or reranker
  call; `embeddingCalls` (one per uncached search under the `postgres` profile: `searchPartsForAI` embeds every query it is asked);
  `rerankCalls` / `rerankSkipped` from the search outcome. A started call whose completion is unknown is `uncertainModelCalls` and
  `uncertainOutputTokens` at one turn's bound; a dead attempt's remaining reservation stays `uncertain` (worst case). Exactly-once
  model billing is not claimed.
- Progress is semantic: a slice that ran its allowance and surfaced no new part is stagnant when its progress key equals its
  predecessor's or it did nothing a judge could see (no submission, no validation code); 3 stagnant slices end a strategy. A repeated
  search, in any punctuation or word order, is answered from the facts and surfaces nothing new.
- The ladder, each a fresh conversation (never a replay of the same prompt): S1 baseline; S2 seeded from the block's checkpointed facts
  and the constraints its submissions taught; S3 catalog-guided (the block's empty searches re-run against the catalog's own category
  names, bypassing the cache); S4 alternates for the parts submissions were rejected with; S5 one planner call splits the block into
  sub-functions; S6 the missing-part path - zero model calls, the block waits for the part its empty searches name. Without such
  evidence an exhausted ladder is `no_progress`. A `retry-block` after S6 restarts at S3 (the part may now exist), after `no_progress`
  at S2. Seeds put catalog text in front of the model only under `untrustedCatalogText`, bounded (B19-D I5e).

## 6. Evidence (offline; 2026-10-17)

| suite | proves (L.7) |
|---|---|
| `app/lib/generation-task/__tests__/l3-continuation.test.ts` | item 1: 24 turns and 22 simulated minutes in one block (> 20 turns, > 180 s) over 5 windowed slices; every window end queues a continuation; a complete validated result; a window-cut turn is discarded and redone |
| `l3-long-task.test.ts` | item 2: 26 simulated hours of an overloaded provider with Retry-After 1 h, a worker restart, no browser, cursor replay; the backoff schedule; Retry-After through both adapters; the allowance park and extensions |
| `l3-fencing.test.ts` | item 3: a hung call abandoned at its bound; lease expiry, a second consumer and a late first worker that commits nothing; duplicate events; five lost workers -> `platform_failure`; revocation -> `authority_revoked`; free-capacity concurrent claims; cancel mid-call; S3; pause and graceful shutdown |
| `l3-crash-resume.test.ts` | item 4: a crash inside a call, in memory and on PostgreSQL (PGlite) with fresh modules: no repeated search or saved block, the dead call uncertain; an ambiguous commit applied once; a crash at acknowledgement; a facts delta beyond the facts bound dropped (the facts are a cache) without wedging the slice |
| `l3-strategies.test.ts` | item 5: S1-S4 fail differently and S5 succeeds; an identical loop stops at `no_progress`; a missing part at S6 kept as partial-available, then found by S3 after a retry; partial only by review; a quota refusal |
| `l3-worker-process.test.ts` | the REAL process (tsx) against PGlite over a loopback wire bridge and an in-test model endpoint: `--once` consumes the plan slice and records the call under `/api/generation-tasks`; a restarted worker resumes from durable state, serves `/healthz` and shuts down on request; the store-unavailable refusal |
| `app/api/generation-tasks/__tests__/l4-routes.test.ts` | [PR-L, 2026-10-17] increment 4: the pump route behind the worker secret (fail closed), one awaited slice per request to a reviewable result, the pump transport against the route (case 6); the fixture composition through the real slice core (case 8); `dev-with-worker.mjs` starts a pump worker under the fixture runtime instead of refusing, the secret never printed (case 9); the browser run of `e2e/l4-generation-task.spec.ts` uses that launcher |

`l3-crash-resume` and `l3-worker-process` start PGlite: their CI admission belongs to the database-delivery job (a line-pinned workflow
edit, F20), with the other `l2-*` / `l3-*` suites in increment 7.

## 7. Limits and seams (stated, not hidden)

- [PR-L, 2026-10-17] Implemented in increment 4 (was the seam below): `createPumpTransport` POSTs `/api/generation-worker` and refuses only
  without the worker secret (`GENERATION_WORKER_SECRET_UNSET`); `l4-routes` case 6 drives it against the route. The superseded text:
  SEAM - the HTTP pump transport (`createPumpTransport`) refuses with `GENERATION_WORKER_PUMP_UNAVAILABLE`: under the fixture runtime the
  store lives in the dev server's process and needs `POST /api/generation-worker`, which increment 4 builds with the other routes.
- SEAM - S6 records the missing-part facts (the empty searches, in the block's checkpoint, the task's facts and the milestone) but does
  not yet open K's missing-part work item; that integration is increment 6.
- The store's API lets a merge slice patch no block, so a saved block whose catalog facts changed cannot be sent to
  `needs-revalidation` from the merge: the merge parks the task as `missing_evidence` naming the block (a store change for the lead).
- A provider refusal of a malformed request, an unrequested output or an unclassified failure has no code of its own in the closed
  blocker list; it is recorded as `platform_failure` (the provider's reason is in the worker's log line).
- The planner's one correction attempt can spend one call more than the plan slice's 1-call reservation; the next claim's allowance
  check counts it. [PR-L6 integration, 2026-10-19] SPEND-2: superseded - the plan slice now reserves both planner calls (2 x 4,096 output tokens, `GENERATION_SLICE_POLICY.planAttempts`), since a release, lapse or cancel settled from release drops the measured usage and only the reservation stays charged.
- The LLM admission meters are per process; the durable allowance is the cross-process bound.
- The task's facts are a cache: a delta the facts aggregate cannot hold (512 KB; parts with very long pin lists) is dropped and logged,
  and the commit is made without it - a later identical search then reaches the catalog again.
- The provider SDKs retry 429 / 5xx themselves (`maxRetries`) before the worker sees a failure; the worker's backoff applies after them. [PR-L6 integration, 2026-10-19] SPEND-1: superseded for every metered slice call - `MeteredLlmPort` sends `maxProviderRetries: 0` (the SDKs' per-call `maxRetries`), so one metered call is one billed attempt and the slice's own provider wait re-admits and re-charges a retry; the post-approval Tidy and Review routes send 0 too. Every other caller keeps the client default.
- The backoff's count of consecutive provider waits is read from the head's milestone ring (48 entries): a longer run reads short.

## 8. [PR-L6, 2026-10-19] Operator allowance, input admission and `--scope` (OD-252 item 1, OD-253 item 6; offline only)

- **Operator unit.** `SIRKIT_GENERATION_ALLOWANCE_MODEL_CALLS`, `_OUTPUT_TOKENS`, `_CATALOG_SEARCHES`, `_WALL_CLOCK_MS` (each an integer
  that only LOWERS the default field; zero, signs, fractions, text and values at or above the default are ignored) and
  `_INPUT_TOKENS` (1..100,000,000; adds the optional input dimension). `resolveGenerationAllowanceUnit` (contracts.ts) is read once per
  resolved runtime in the composition root (generation-task/runtime.ts) and handed to `GenerationTaskService`, so Build and chat
  starts share it; a start body can never carry it (the closed START_KEYS). The unit is set by the SERVER that accepts the start,
  not by the worker. `GENERATION_TASK_ALLOWANCE_UNIT` itself is unchanged.
- **Input dimension.** Optional `allowance.unit.inputTokens`, optional `usage.uncertainInputTokens`, optional reservation
  `inputTokens` (persisted heads without them stay valid). Every limit multiplies by `units`, so "Continue with another allowance" adds
  one input unit too; a claim is refused (`allowance_exhausted`, no model call) once settled + uncertain + in-flight input reaches the
  limit. With saved blocks beside the stopped one (`partial_available`, cause `allowance_exhausted`), the snapshot offers
  `extend-allowance` and `review-partial` (no retry of the stopped block).
- **Pre-call admission** (`MeteredLlmPort`, plan and both block ports): bound = UTF-8 bytes of the composed instructions + JSON(tools)
  + JSON(toolChoice) + JSON(messages) + 1,024 per call + 16 per message + 8 per part + 64 per tool (`generationRequestInputBound`;
  the framing overhead is INFERRED). A call whose bound does not fit the slice's remaining input is never sent (code
  `sirkit_input_allowance_exhausted` -> `allowance_exhausted`, the last turn-boundary checkpoint kept). Before an admitted call is sent,
  `store.admitCall` records on the attempt's held reservation everything the attempt has charged and not committed (that call's bound
  plus earlier uncommitted input), so a process that dies inside the call leaves it charged (uncertain) for the next claimer. A call
  whose completion is unknown stays charged at its bound; a reported input above its bound stops the slice before any further call
  (`sirkit_input_bound_exceeded` -> `platform_failure`, logged with both numbers). The bound holds per process for ONE worker at
  `--concurrency 1`; durable cross-slice input reservations for concurrent slices remain a follow-up. [PR-L6 integration, 2026-10-19] F2: superseded - `store.admitCall` refuses (`GENERATION_INPUT_ALLOWANCE_EXHAUSTED` -> `sirkit_input_allowance_exhausted` -> `allowance_exhausted`, never sent) when settled + uncertain + every slice's in-flight input bound would exceed the task's limit; the fenced head commit serializes admissions across slices and worker processes (`l6-input-concurrency`).
- **`--scope <tenant>/<project>/<branch>`** (direct transport only; the pump refuses it): the worker claims only that scope's slices of
  BOTH topics (generation and component resolution, `claimOutbox({ scope })`); the branch may contain `/`. Without it, every scope as
  before. [PR-L6 integration, 2026-10-19] F7: a scoped worker claims generation slices under the owner `<worker id>#scope:<16-hex scope tag>`, and liveness counts its live lease toward `workers_busy` only for its own scope (another scope's due task reads `no_worker`; `l6-liveness-scope`). Evidence: `l3-worker-scope` (in-memory and PGlite), `l3-worker-process` case 4 (the real process).
- **Bounded run launch (for the lead; no run made here):** the builder's own server with the operator unit, e.g.
  `SIRKIT_GENERATION_ALLOWANCE_MODEL_CALLS=24 SIRKIT_GENERATION_ALLOWANCE_OUTPUT_TOKENS=57344 SIRKIT_GENERATION_ALLOWANCE_INPUT_TOKENS=450000
  SIRKIT_GENERATION_ALLOWANCE_CATALOG_SEARCHES=120 SIRKIT_GENERATION_ALLOWANCE_WALL_CLOCK_MS=21600000`, and its worker with
  `--no-env-file --concurrency 1 --scope <the run's tenant>/<project>/main`. `SIRKIT_CATALOG_SEARCH_CONCURRENCY` may lower the catalog
  slots (`min(4, max(1, SIRKIT_DB_POOL_MAX - 3))`).
- Evidence (offline, fake provider and catalog): `l6-allowance-operator`, `l3-input-allowance`, `l3-crash-resume` case 5 (PGlite),
  `l3-long-task` cases 4-5, `l3-worker-scope`, `l3-worker-process` case 4.
