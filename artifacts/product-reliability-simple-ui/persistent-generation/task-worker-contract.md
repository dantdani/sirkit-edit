# Generation task, worker and recovery contract (runbook L.2-L.5)

Status: IMPLEMENTED in increments 2-4 (see progress.md); this contract remains the design reference. Written 2026-10-17 against `codex/astra-foundation` at `5b4a941b` plus the uncommitted 180 s
correction (`build-boundary.ts`, provider-adapter cancellation, `parts-search.ts`). It governs L.8 increments 2-7; L.1's stall
map (`limit-and-stall-map.md`) feeds increment 6. Labels: **CONFIRMED** = read in source at the cited line; **DECIDED** = this
contract's choice, justified from the cited source; **OWNER** = must be decided by the owner before the dependent step ships
(section 11). Nothing here authorizes a paid call, a migration or a database write.

## 0. Verified substrate (CONFIRMED)

| # | fact | source |
|---|---|---|
| F1 | `DurableWorkflowRepository`: scoped `loadHead`/`listHeads`/`loadRecord`/`history`/`getReplay`/`commit`/`claimOutbox`/`completeOutbox`/`failOutbox`/`listOutbox`. No lease renewal. `DurableOutboxEffect` has no `availableAt`. | `app/lib/durable-workflow/types.ts:17-21, 45-56` |
| F2 | `commit` is one transaction: replay lookup first (returns `idempotent: true`), per operation `FOR UPDATE` on the head + `expectedRevision` CAS (`DW_OPTIMISTIC_REVISION_CONFLICT`), record + head write, outbox rows only for an aggregate in the same commit (`DW_OUTBOX_OWNER_NOT_IN_COMMIT`), replay row. At least one operation required. Outbox `availableAt := committedAt`. | `server-repository.ts:20-30` (`:21, :23, :25, :27, :28`) |
| F3 | `claimOutbox`: scope OPTIONAL (a cross-scope claim works today), topic filter, `pending` or `processing` with an expired lease, `availableAt <= now`, oldest first, `FOR UPDATE SKIP LOCKED`; the caller supplies `now` and `leaseUntil`; `attempts + 1`; deterministic lease token. `complete`/`fail` are fenced by owner + token + `processing` (`DW_OUTBOX_LEASE_CONFLICT`). `failOutbox(terminal: false, retryAt)` re-queues with a delay. In-memory twin with fault hooks. | `server-repository.ts:32-34`; `repository.ts:13, 21-38` |
| F4 | `DurableOutboxDispatcher`: 30 s default lease, claims a BATCH then awaits handlers SEQUENTIALLY, unknown handler = terminal, no renewal. `dispatchDurableEffects` selects explicit topics and deliberately leaves other jobs pending; `/api/engineering-effects` is a worker-secret pump over it. | `outbox.ts:16-37`; `effects-runtime.ts:19-23`; `app/api/engineering-effects/route.ts` |
| F5 | Tables exist (no migration needed for this design): heads unique `(tenant, project, branch, type, key)` + `(..., type)` index; record history index `(..., type, key, revision)`; outbox dispatch index leads with `(tenant, project, branch, state, available_at, created_at)` - there is NO topic index, so a cross-scope claim by topic is an unindexed filter; lease CHECK constraint. Manifest ends at 0031. | `app/lib/db/schema.ts:1265-1343`; `app/lib/db/migrations/manifest.ts:31-36` |
| F6 | Retention purges whole aggregates and refuses `mixed_commit` (a replay row referencing records of two aggregates). Generation aggregates are in no retention row. | `durable-workflow/retention.ts:5-12` |
| F7 | Repository is a process singleton; under the fixture runtime it is the in-memory one on `globalThis` of the dev-server process. `getDb()` throws without `DATABASE_URL`. | `durable-workflow/runtime.ts:17-18`; `fixture-runtime/container.ts:19, 32`; `db/client.ts:19-27` |
| F8 | The fixture clock freezes `Date.now()` (timers still run); `unfrozenNowMs()` reads the real clock. | `fixture-runtime/clock.ts:37-55, 75-78` |
| F9 | Fixture generation today: the planner answers "no plan" and every other model request fails `missing_credentials`; the build loop returns `BLINKER_NETLIST` in 0 turns; `searchPartsForAI` has NO fixture branch (`getDb()`, exact `mainCategory` match) while `getPartsByIds` has one. Fixture stores are memory only: there is no server-restart browser case. | `llm/router.ts:26-31`; `build-loop.ts:189-195`; `parts-search.ts:95-97, 281-295`; `b24-d2-restart-pglite.test.ts:19-20` |
| F10 | One request-lifetime clock: `BUILD_BUDGET` 20 turns / 3 loops / 180 s (operator cap may only lower). `runBuildMultiGeneration` starts one clock before planning, awaits the whole block pool, and fails with the deadline sentence. The loop keeps messages, surfaced parts, ERC rejections and turn count only in memory; `MAX_ERC_REJECTIONS = 2`. | `build-result.ts:68-76, 83-87`; `build-multi-generation.ts:190-209, 267-308`; `build-loop.ts:98, 198-207`; `build-boundary.ts:9-45` |
| F11 | The conversation is already provider-neutral: `LLMMessage` = user/assistant with `text`/`tool_call`/`tool_result` parts, no opaque provider state; usage = input/output tokens. Retryable reasons are `rate_limit`/`overloaded`/`timeout`/`network`; no `Retry-After` is carried. | `llm/types.ts:5-33, 67-79, 116-129`; `llm/errors.ts:152-154` |
| F12 | Chat: `DEFAULT_AGENT_BUDGET` 6 steps / 10 tools / 15 s / 120 s / 2 identical calls; a long-running tool gets `min(timeout, remaining run)`; the generation service clamps again and races the port; sealed proposal TTL 10 min; binding pinned to `runBuildMultiGeneration`; descriptor 185 s; port factory. | `agent/contracts.ts:181-188`; `agent/loop.ts:470-476`; `agent/generation-proposals.ts:39, 43, 197-203, 259-271`; `engineering/tool-catalog.ts:1136`; `api/chat/schematic-generation-runtime.ts:30-32` |
| F13 | Agent-exposable classes are `read`/`propose`/`view-session` only; explicit exposure list. Run events are a closed union; outcomes union; the loop emits `generation_proposal_ready`; safe receiver + currency check. | `engineering/agent-exposure.ts:19, 30`; `agent/contracts.ts:350-356, 417`; `agent/loop.ts:728`; `project/generation-proposal-events.ts:24-37, 55-71` |
| F14 | Page: `handleGenerateSchematic` awaits ONE `POST /api/schematic/build-multi`, lays out with `autoLayoutBuildValidated`, refuses a stale base and opens the review dialog; `offerGenerationProposal` brings the agent artifact into the same dialog; the pin is `schematicStateDigest(authoritativeState())`; the pending proposal is persisted per project with its base digest. | `app/page.tsx:4956-4964, 4983, 5116, 5147, 5175, 5235, 5248, 5280-5328`; `project/pending-proposal-store.ts:16-28` |
| F15 | Canonical wrappers `authenticatedJsonRoute`/`authenticatedRoute`/`workerRoute` (each enters `withLlmCallScope`). SSE precedent: authorize before any listener, `querySelector` + `routeParams`. Policy constructors; build-multi row; SPICE rows; worker row. Census 168 = 165 canonical + 3 factories + 0 raw. `API_ROUTE_COVERAGE`. Provider-credit principal rows (32). | `auth/route-handlers.ts:325, 354, 373, 525`; `app/api/spice/runs/[id]/events/route.ts:18`; `auth/route-policy.ts:65-79, 103, 219, 286-292`; `auth/__tests__/b16-1b-auth-composition.test.ts:242-255`; `engineering/action-registry.ts:212, 347`; `auth/abuse-limits.ts:185-193` |
| F16 | Durable patterns to copy: injected repository + composition-root factory with an unavailable fallback; bounded closed-key public events. | `agent/orchestration/store.ts:23-27, 310-317, 338-360`; `api/chat/orchestration-runtime.ts:50`; `agent/orchestration/run-events.ts:25-50, 60, 178` |
| F17 | Not workers: SPICE jobs are `globalThis` Maps; `acquireJobLease` builds a record with a `heartbeatAt` field and runs nothing. | `spice/server/job-store.ts:1-18`; `full-flow/jobs.ts:8`; `full-flow/types.ts:32` |
| F18 | Admission meters are per process (purposes `interactive`/`agent`, agent share 0.25; LLM admission port). Call records need a bound sink and a scope; only `instrumentation.ts` binds the sink, in the Next process. No USD price table in the repository (`live-spend.json` price note: `MODEL_PRICE_TABLE` null, OD-107). | `acquisition/admission-control.ts:26-28, 35-37`; `agent/orchestration/provider-policy.ts:144-156`; `observability/llm-call-record.ts:94, 119`; `llm-call-record-runtime.ts:75` |
| F19 | Revalidation port: `resolveMembershipRepository().loadActiveMembership` returns null when revoked; `membershipRevisionOf`. Worker secret `SIRKIT_WORKFLOW_WORKER_SECRET`, fail closed when unset. | `auth/identity-runtime.ts:42-48, 67`; `auth/project-membership.ts:67, 82-87`; `auth/worker-principal.ts:14, 49-56` |
| F20 | Every `SIRKIT_*` name read in code is inventoried with its owner `file:line` and in the env-name census; the scripted chat agent is the fixture precedent. PGlite suites run only in the database-delivery job by explicit, line-pinned workflow entries. Playwright fixture env assembles fake secrets from parts. | `deployment/flag-inventory.ts:1-17, 67, 72`; `deployment/environment-names.ts:119`; `agent/fixture-agent-adapter.ts:33`; `.github/workflows/deterministic-manufacturing.yml:415-423`; `qualification/__tests__/b24-d0-ci-split.test.ts:579-590`; `playwright.config.ts:40-71` |

## 1. The task record (L.2)

### 1.1 Aggregates (DECIDED)

Every head revision copies its whole payload into `durable_workflow_records` (F2), so checkpoints, tool histories and netlists
stay OUT of the head; single-aggregate commits keep per-aggregate retention possible (F6).

| aggregate type | key | writer | commits | bound |
|---|---|---|---|---|
| `schematic.generation-task.v1` (HEAD) | `taskId` | API (control fields), worker (execution fields) | single-aggregate, except start and terminal transitions (with the index) | 64 KB |
| `schematic.generation-task-index.v1` | `project` (one per scope) | API, worker at terminal | with the head at start / terminal; CAS enforces at most ONE non-terminal task per scope | 16 KB (`active` + 20 recent refs) |
| `schematic.generation-task-block.v1` | `${taskId}/${blockId}` | the slice that owns the block | single-aggregate, before the head commit that references it | 384 KB (compaction at 256 KB) |
| `schematic.generation-task-facts.v1` | `taskId` | any owning slice (rebased merge) | single-aggregate | 512 KB (256 parts, 512 lookups, LRU) |
| `schematic.generation-task-result.v1` | `taskId` | merge slice | single-aggregate, before the head commit | 1 MB |
| `schematic.generation-task-activity.v1` | `${taskId}/${sliceId}/a${attempt}` | that attempt only | single-aggregate, at most one per 3 s | 4 KB (last 8 lines) |

Rule (DECIDED): block, facts and result content is read ONLY through the `{recordId, recordDigest}` the head references
(`loadRecord`), never through `loadHead`. A fenced-out late writer can append a revision but can never become referenced content.

### 1.2 Head payload `sirkit.generation-task.v1`

```ts
interface GenerationTaskHead {
  schema: "sirkit.generation-task.v1";
  taskId: string;          // durableWorkflowId("generation-task", { scope, principalId, clientRequestId }) - not authority (section 6)
  scope: { tenantId: string; projectId: string; branchId: string };                  // trusted context, never the body
  initiator: { principalId: string; role: ProjectRole; membershipRevision: string; origin: "build" | "chat"; chatRunId: string | null };
  request: { clientRequestId: string; prompt: string /* 1..4000 */; provider: LLMProviderId; mode: "build"; requestDigest: string }; // immutable
  base: { schematicDigest: string; recipe: "build-pin" | "chat-sheet"; headMark: SchematicCanonicalMark | null; moved: boolean };
  identities: { catalogProfile: "postgres" | "fixture-blinker" | "fixture-scripted"; embeddingModel: string;
                promptDigests: { plan: string; build: string; subsystem: string }; sliceContract: "sirkit.generation-slice.v1" };
  state: TaskState; phase: "planning" | "designing" | "merging" | "validating" | "review" | null;
  plan: { planDigest: string; planner: BuildPlannerStatus; rationale: string /* <=600 */; assumptions: string[] /* <=8 x 200 */; blocks: PlanBlock[] /* <=8 */ } | null;
  blocks: Record<BlockId, BlockState>;
  pending: Record<SliceId, { kind: "plan" | "block" | "merge"; blockId: BlockId | null; notBefore: string; state: "queued" | "running";
                             owner: { attempt: number; fence: number; workerId: string; leaseToken: string; claimedAt: string } | null }>;
  nextSliceSeq: number; fenceCounter: number;
  usage: Usage; reservations: Reservation[] /* <=12 */; allowance: Allowance;                         // section 5
  control: { cancel: ControlStamp | null; pause: ControlStamp | null; applied: ControlStamp[] /* <=16, clientActionId idempotency */ };
  blocker: { code: BlockerCode; message: string; resolution: string; blockId: BlockId | null; evidence: Record<string, string | number> } | null;
  result: { recordId: string; recordDigest: string; resultDigest: string; status: "complete" | "partial"; omittedBlocks: string[] } | null;
  review: { outcome: "applied" | "discarded"; at: string; principalId: string; headMark: SchematicCanonicalMark | null } | null;
  derivedFrom: { taskId: string; reason: "rebase" | "start-from-saved" } | null;
  milestones: Milestone[] /* ring <=48 */; eventSeq: number;                                          // section 6.3
  createdAt: string; updatedAt: string;
}
interface BlockState { blockId: BlockId /* b1..b8, or "main" */; name: string; brief: string; sharedNets: string[]; status: "queued" | "designing"
  | "saved" | "blocked" | "needs-revalidation" | "omitted"; strategy: StrategyId; strategyHistory: Array<{ id: StrategyId; slices: number;
  outcome: "progress" | "stagnant" | "exhausted" | "succeeded" }>; artifactRef: { recordId: string; recordDigest: string } | null;
  turnsUsed: number; stagnantSlices: number; lastProgressKey: string | null; blocker: BlockerCode | null }
```

Validation (DECIDED, pattern of F16): closed key sets at every level, identifiers by the substrate's id rule, every free text
through the run-event redactor (`boundedRunEventText`, `run-events.ts:60`) and bounded, the record digest recomputed on load
(`GENERATION_TASK_RECORD_MISMATCH`), the size bound enforced before commit (`GENERATION_TASK_TOO_LARGE`; never silently cut).
A head that fails validation is never executed: the task is shown `failed` with `invalid_persisted_state`.

### 1.3 Block checkpoint `sirkit.build-loop-checkpoint.v1` (what resume needs, F10/F11)

- `messages: LLMMessage[]` exactly as the loop holds them (`build-loop.ts:207`): only `text`/`tool_call`/`tool_result` parts,
  assistant text <= 2,000 characters and redacted. Checkpoints are taken ONLY at complete turn boundaries (after the tool-results
  or nudge message is appended), so every `tool_result` has its call in the preceding assistant message. An interrupted turn
  is discarded, never synthesized; no provider response is ever fabricated. No private provider continuation state is needed
  (F11): the contract is reconstruction from normalized records.
- `surfaced: Record<partId, { part: AiPartResult; factsDigest }>` (`returnedParts`, `build-loop.ts:198`), `ercRejections`,
  `turnsUsed`, `nudges`, `submissions: Array<{ fingerprint; codes }>` (<=8), `searches: Record<searchKey, { resultDigest; partIds; count }>`.
- `compaction: { compactedTurns; summaryDigest } | null`: above 256 KB or 24 turns, the oldest complete turns become ONE
  user-role note built deterministically from the normalized records ("searched ... -> partIds ...; submission rejected for ...;
  ERC feedback ..."). Never a `tool_result`, never model text dressed as tool output.
- When saved: `result: { netlist; explanation; erc }` (the `BuildLoopResult` success fields, `build-loop.ts:113`).

### 1.4 Facts

`parts` (validated `AiPartResult` + `factsDigest` + which blocks surfaced it), `lookups` keyed by
`searchKey = digest(NFC lower-cased query, punctuation to space, tokens sorted and de-duplicated; normalized category;
catalogProfile; embeddingModel)`, and `optional.rerank: { state: "available" | "unavailable"; reason; since; probeAfter }`.
There is no global parts-catalog revision (the only `catalog_revision` column is `constraint_programs`, `schema.ts:736`), so
part facts are revalidated by `factsDigest` in the merge slice (section 3.1).

## 2. States and transitions (L.2)

`queued`, `running`, `waiting-for-provider`, `waiting-for-resource`, `awaiting-review`, `paused`, `cancel-requested` are
non-terminal; `cancelled`, `succeeded`, `failed`, `stale` are terminal. Generated, reviewed and applied stay distinct:
`awaiting-review` = a validated reviewable result exists; `succeeded` = the reviewer acted (`review.outcome` applied or
discarded, page-attested, never authority); the apply itself stays the page's exact-base apply.

| from | to | actor | required evidence |
|---|---|---|---|
| (none) | `queued` | start API | trusted context with an EDITORS role; validated request; provider servable (`schematicGenerationServable`); ONE commit of head rev 1 + index CAS + the first `plan` slice outbox effect |
| `queued` / `waiting-for-provider` | `running` | worker | outbox lease token; head CAS claim commit (fence + owner); live membership re-check (F19); allowance reservation fits |
| `running` | `queued` | worker | end commit with checkpoint refs AND the next slice's outbox effect (yield at a window or turn allowance; never a failure) |
| `running` | `waiting-for-provider` | worker | retryable provider reason (F11) or an admission pause; `notBefore` from `Retry-After` / backoff; a delayed slice effect (S1) |
| `running` | `waiting-for-resource` | worker | closed blocker code + evidence (below); no pending slice; completed blocks untouched |
| `waiting-for-resource` | `queued` | control API | `resume` / `retry-block` / `review-partial` / `extendAllowance`, by an EDITORS role, recorded with principal |
| `running` | `awaiting-review` | merge slice | result aggregate committed; `resultDigest`; non-empty merged netlist; ERC state and shared-net check recorded |
| any non-terminal | `paused` | control API, then worker | pause stamp; running slices yield at the next turn boundary with a checkpoint; state flips when no live owner remains |
| `paused` | `queued` | control API | resume stamp; fresh slice ids scheduled in the same commit |
| any non-terminal except `awaiting-review` | `cancel-requested` | control API | cancel stamp |
| `cancel-requested` | `cancelled` | owning worker, next claimer, or the API when no live lease exists | owners aborted and fenced; late results discarded |
| `awaiting-review` | `succeeded` | control API (`record-review`) | outcome + principal; `resultDigest` matches; for `applied`, the post-apply head mark |
| `awaiting-review` | `stale` | control API (`report-base`) | the page's live base digest (same recipe) differs from `base.schematicDigest` |
| any non-terminal | `failed` | worker / API | `authority_revoked` (membership null or role not permitted), `invalid_persisted_state`, `invalid_request` only |

Blocker codes (closed): `provider_credentials`, `provider_quota`, `provider_access`, `allowance_exhausted`, `no_progress`,
`missing_part`, `missing_evidence`, `platform_failure` (a slice lost its worker `maxAttemptsPerSlice` times), `task_window_elapsed`,
`partial_available` (some blocks saved, one blocked: the user chooses `review-partial` or `retry-block`; partial is never
automatic, OWNER-11). Transient provider failure is never a blocker. A cancelled task is never restarted: `start-from-saved`
and `rebase` create a NEW task (`derivedFrom`) that copies saved block refs after revalidating their facts; `rebase` re-merges
against the current sheet with zero model calls (the generation does not depend on the base content, only the review pin does).

## 3. The slice (L.3)

### 3.1 Kinds and policy (DECIDED; finite slice policy, NOT a task limit)

| kind | does | model calls |
|---|---|---|
| `plan` | the existing planner call (`build-multi-generation.ts:73-104`) once; persist plan, assumptions, stable block ids; one block (or none) becomes block `main` with `BUILD_SYSTEM_PROMPT`; schedule one `block` slice per block in the SAME commit | 1 |
| `block` | resume the block conversation from its checkpoint and run at most `blockTurnsPerSlice` turns inside the slice window; save the block when a submission passes validation and the ERC gate | <= 6 |
| `merge` | load saved blocks by reference; revalidate part facts (`getPartsByIds` digest compare; a mismatch sends that block to `needs-revalidation`); `mergeBuildNetlists`; post-merge ERC; shared-net obligations (every plan shared net labelled in >= 2 blocks, else a finding); component-authority summary; write the result; `awaiting-review` | 0 |

`GENERATION_SLICE_POLICY`: `leaseMs` 45 s, `renewEveryMs` 15 s, `planWindowMs` 90 s, `blockWindowMs` 300 s, `perCallMs`
120 s, `minTurnStartMs` 60 s (no new turn when less window remains), `blockTurnsPerSlice` = min(6, `resolveBuildIterationCap()`),
`mergeWindowMs` 30 s, `controlPollMs` 2 s, `activityMinIntervalMs` 3 s, `workerPickupGraceMs` 15 s, `maxAttemptsPerSlice` 5,
`stagnantSlicesPerStrategy` 3, worker concurrency 3 (`BUILD_BUDGET.concurrencyCap`). Window deadlines are computed with
`Date.now()` because `withinBuildBoundary` measures in that frame (frozen under the fixture, where its timer still fires, F8);
leases and timestamps use the injected task clock (`unfrozenNowMs` under the fixture, `Date.now` otherwise).

### 3.2 One slice, step by step (DECIDED)

1. Claim only free capacity: `claimOutbox({ workerId, now, leaseUntil: now + leaseMs, limit: freeSlots, topics: ["generation-task.slice"] })`
   (no scope, F3). Each claimed slice runs CONCURRENTLY with its own lease (avoids F4's batch-then-sequential lease expiry).
2. Load the head (`event.scope`, `taskId`). Missing or invalid: `failOutbox` terminal. `pending[sliceId]` absent, or the task
   terminal / paused: `completeOutbox` as a no-op. `notBefore > now`: `failOutbox(retryAt = notBefore)` with no work. Previous
   attempts >= `maxAttemptsPerSlice`: commit `waiting-for-resource` / `platform_failure`, complete.
3. Revalidate before any provider call: live membership + role (F19), provider still servable, allowance fits the reservation,
   admission meter open. Each failure is its own state (section 2), never a paid attempt.
4. Claim commit (head CAS, idempotency `${sliceId}:a${attempt}:claim`): `fenceCounter + 1`, `pending[sliceId].owner`,
   reservation, state `running`, milestone. A conflict reloads and repeats steps 2-4 (at most 5 times).
5. Execute inside `withinBuildBoundary(windowDeadline, sliceController.signal)` (`build-boundary.ts:9`) and
   `withLlmCallScope({ routeId: "/api/generation-tasks", method: "POST", scope })` (the route that admitted the task; matches
   `ROUTE_ID`, `llm-call-record.ts:119`). The controller aborts on: a failed lease renewal, a cancel stamp seen by the control
   poll, worker shutdown. Renew every 15 s (S2). Write activity lines at most every 3 s.
6. Checkpoint: block aggregate commit (idempotency `${sliceId}:a${attempt}:block:${n}`), then the head commit referencing it.
7. End commit (idempotency `${sliceId}:a${attempt}:end`): remove `pending[sliceId]`, settle the reservation, append milestones,
   recompute state, and schedule the next slice as an outbox effect of the SAME commit (S1 `availableAt` for backoff).
8. `completeOutbox`. A `DW_OUTBOX_LEASE_CONFLICT` here is ignored: the head already moved on and a re-claim finds no pending slice.

Rebase rule for every head commit after the claim: on CAS conflict reload; continue ONLY if
`pending[sliceId].owner.fence === myFence && leaseToken === mine` and the state is not `cancel-requested`/`cancelled`
(a pause lets the slice finish its checkpoint); re-apply ONLY this slice's delta (its own block entry, additive counters, its own
reservation, appended milestones, its own pending entry and the slices it schedules); at most 8 retries; a fence mismatch
abandons with `GENERATION_SLICE_FENCED` and writes nothing more. Deltas of sibling block slices commute, so concurrent blocks of
one task are safe; the CAS makes "last block saved, schedule `merge`" observable by exactly one commit. A duplicate or stale
outbox event (eventIds are per owner revision, `server-repository.ts:27`) is harmless because step 2 requires the sliceId to be
pending. An ambiguous commit (transport error after commit) is retried with the SAME idempotency key and returns the replay
(F2); model work is never re-run to re-derive a commit.

### 3.3 Identities

| identity | form | role |
|---|---|---|
| `taskId` | `generation-task:<32 hex>` | logical task; attach target |
| `sliceId` | `${taskId}:s${nextSliceSeq}` | one unit of scheduled work; outbox `idempotencyKey` |
| `attempt` | the outbox `attempts` of this claim | distinguishes re-runs of one slice |
| `fence` | head `fenceCounter`, monotonic | ownership token checked on every commit |
| `leaseToken` | from `claimOutbox` | outbox fencing (complete/fail/renew) |
| provider call | the LLM call record (`callId`, `requestRef` per attempt) | billing evidence; exactly-once billing is NOT claimed |
| `blockId` | `b1..b8` / `main` from the persisted plan | block artifact key |
| canonical mutation | none: the task never mutates engineering state | the page's approved apply owns it |

### 3.4 Substrate changes (DECIDED; no schema change, both repositories + the PGlite suite)

- **S1** `DurableOutboxEffect.availableAt?: string` (>= `committedAt`; default `committedAt`) so backoff / `Retry-After`
  scheduling is atomic with the checkpoint.
- **S2** `renewOutboxLease({ scope, eventId, workerId, leaseToken, now, leaseUntil })`: one fenced UPDATE (`processing`, owner,
  token, `lease_expires_at > now`), else `DW_OUTBOX_LEASE_LOST`. A 45 s lease with 15 s renewal gives takeover within a minute
  of a crash without a 5-minute lease that a hung slice could hold.
- **S3** `dispatchDurableEffects` refuses the `generation-task.slice` topic even when asked (the generic dispatcher must never
  treat it as an unknown job and fail it terminally, `outbox.ts:32`; precedent `effects-runtime.ts:21-22`).
- `LLMProviderError` gains optional `retryAfterMs`, filled by both adapters from the SDK error headers when present.

## 4. The worker (L.3)

- A real separate process: `scripts/generation-worker.ts`, `package.json` `"worker:generation": "tsx scripts/generation-worker.ts"`,
  over `app/lib/generation-task/worker/worker.ts` (`GenerationWorker.start()/stop({ graceMs })/tick()`). Loop: tick every 1 s when
  idle, immediately when a slot frees.
- Transport `direct` (default; requires `DATABASE_URL`, fixture off): loads `.env.local` with `loadEnvLocal()` (the
  `scripts/db-migrate.ts:32` pattern), uses `PostgresDurableWorkflowRepository`, binds the call-record sink
  (`bindDurableLlmCallRecordSink`, F18) and `resolveMembershipRepository()`.
- Transport `pump --origin <url>` (required under the fixture runtime, whose store lives only in the dev-server process, F7):
  each tick POSTs `/api/generation-worker` with `Authorization: Bearer $SIRKIT_WORKFLOW_WORKER_SECRET`; the route claims ONE
  slice and runs it to settlement inside the server, awaited and bounded by the slice window (the
  `/api/engineering-effects` precedent, F4). Same slice code in both transports.
- CLI: `--once` (one tick, tests), `--concurrency 1..3`, `--health-port <n>` (127.0.0.1 `GET /healthz` with
  `{ workerId, mode, startedAt, running, lastTickAt }`), `--worker-id`. Secrets and values are never printed.
- Shutdown (SIGINT/SIGTERM): stop claiming; running slices yield at the next turn boundary (checkpoint committed while the lease
  holds); after a 10 s grace their controllers abort; held leases are released with `failOutbox(retryAt = now)` for immediate
  takeover; exit 0. A crash leaves leases to expire (<= 45 s) and any worker resumes from the last checkpoint.
- Local startup: the owner's `pnpm dev` on :3000 is untouched; a second terminal runs `pnpm run worker:generation`.
  `scripts/dev-fixture.mjs --with-worker` spawns `next dev` plus a pump worker with a per-launch random worker secret (never
  printed) and kills it on exit. Deployment: a separately supervised long-lived service (restart always, any replica count:
  fencing makes it safe, health from `/healthz`). Never a React component, a tab interval, an instrumentation-hosted loop or
  an unawaited route promise.
- No worker: the start still commits durably (the queued work is real and runs when a worker starts). The snapshot's `liveness`
  is `no_worker` when the pending slice is unclaimed past `workerPickupGraceMs` AND `listOutbox({ topic, state: "processing" })`
  (global, bounded by workers x concurrency) is empty; `workers_busy` otherwise; `lease_expired` when an owner's lease lapsed
  without a commit. Never `running` without a live lease. local_dev text names the command; production says no generation
  worker is running.
- No storage: normal mode without `DATABASE_URL` answers `503 GENERATION_TASK_STORE_UNAVAILABLE` and accepts nothing (Build
  already needs the database: `searchPartsForAI` calls `getDb()`, F9). No process-local fallback is advertised as recoverable;
  the fixture store is labelled non-durable across a server restart.

## 5. Accounting and no-progress (L.3, L.6)

- `usage`: `slices`, `attempts`, `modelCalls`, `inputTokens`, `outputTokens` (exact, from `LLMResponse.usage`), `catalogSearches`,
  `cacheHits`, `embeddingCalls`, `rerankCalls`, `rerankSkipped` (counted at the catalog port), cumulative across slices, resumes
  and providers.
- `reservations`: the claim commit reserves `turns x 8,192` output tokens and `turns` calls (planner 4,096 x 1); the end commit
  settles actual usage. An attempt that never ends keeps its reservation as `uncertain`, charged at worst case (no
  exactly-once billing claim; reconciliation from call records is later work). Concurrent slices of one task reserve through
  the same CAS head, so they cannot overspend together.
- `allowance` (product spend policy, OWNER-1): proposed default 60 model calls, 480,000 output tokens, 300 catalog searches,
  72 h wall clock per task; an operator variable may only lower it (the `resolveBuildIterationCap` pattern). Exhaustion is
  `waiting-for-resource` / `allowance_exhausted`; `resume` with `extendAllowance: true` adds one unit, at most 4, each recorded
  with the principal. There is no USD figure in the product (F18).
- Admission: each provider call passes the process LLM meter with purpose `agent` (F18); a refusal is `waiting-for-provider`
  until its `retryAtMs`. Meters stay per process (stated limit); the durable allowance is the cross-process bound. Backoff:
  `max(retryAfterMs, full-jitter exponential from 5 s, cap 300 s)` by consecutive failures of the same block.
- No-progress, by semantic operation: an identical `searchKey` returns the cached result (zero embedding/rerank calls) plus a
  tool note; a slice's progress key = digest(new surfaced part ids, accepted connections, validation-code multiset, ERC critical
  count, submission accepted); a slice equal to its predecessor with nothing new surfaced is stagnant; 3 stagnant slices move
  the block to the next strategy; an exhausted ladder is `waiting-for-resource` / `no_progress` with the fingerprints.
- Strategy ladder (each a genuinely different start, never a replay of the same prompt): S1 baseline; S2 fresh conversation
  seeded from checkpointed facts + explicit failure constraints; S3 catalog-guided pre-search with categories normalized to the
  catalog's ACTUAL category names (the exact-match filter of F9); S4 alternates-guided for each rejected part; S5 block split (a
  planner sub-plan for this block); S6 K's missing-part path (work item, review, then `missing_part` until resolved). Provider
  failover is off (OWNER-9). A reranker known unavailable is skipped until `probeAfter`, then probed once.

## 6. The API (L.4)

### 6.1 Routes (DECIDED) - six methods, all canonical wrappers

| method and path | wrapper | policy row | body / query | answers |
|---|---|---|---|---|
| `POST /api/generation-tasks` | `authenticatedJsonRoute({ maxBytes: 64_000, deadlineMs: 10_000 })` | `propose`, EDITORS, `providerCredit: true` | `{ clientRequestId (uuid), prompt, provider?, base: { schematicDigest, recipe, headMark? } }` | `202 { task, attached }`; `409 GENERATION_TASK_ACTIVE { activeTask }`; `409 IDEMPOTENCY_KEY_REUSED`; `503 GENERATION_TASK_STORE_UNAVAILABLE` / `GENERATION_PROVIDER_UNAVAILABLE` (nothing accepted) |
| `GET /api/generation-tasks` | `authenticatedRoute` | `read`, all members | selector headers | `{ active, recent }` from the index |
| `GET /api/generation-tasks/[id]` | `authenticatedRoute({ routeParams: ["id"], query: true })` | `read` | `include=result` | snapshot (+ result in `awaiting-review`/`succeeded`/`stale`) |
| `GET /api/generation-tasks/[id]/events` | `authenticatedRoute({ querySelector: true, routeParams: ["id"], query: true, safeHeaders: ["accept", "last-event-id"], exposeAbortSignal: true })` | `read` | `after=<seq>&limit<=50` | JSON page, or SSE (section 6.3) |
| `POST /api/generation-tasks/[id]/control` | `authenticatedJsonRoute({ routeParams: ["id"], maxBytes: 8_000, deadlineMs: 10_000 })` | `mutate`, roles = EDITORS (whoever may start may stop) | `{ action, clientActionId, blockId?, extendAllowance?, review?, liveBase? }` | snapshot; `201` with the new ref for `rebase`/`start-from-saved`; `409 GENERATION_TASK_STATE_CONFLICT` |
| `POST /api/generation-worker` | `workerRoute({ unauthorized: { code: "GENERATION_WORKER_UNAUTHORIZED", noStore: true }, exposeAbortSignal: true })` | `worker` | none | `{ ran: { sliceId, outcome } | null }` |

Actions: `cancel`, `pause`, `resume`, `retry-block`, `review-partial`, `record-review`, `report-base`, `rebase`,
`start-from-saved`; the snapshot lists the actions valid now (server computed). Start idempotency: `taskId` is derived from
(scope, principal, `clientRequestId`); the commit's idempotency key is `start:${taskId}` under
`durableScopeKey(scope, "generation-task-start")`; a replay or an existing head with the same `requestDigest` answers the same
task (`attached: true`), a different digest answers 409. A lost 202 is recovered by retrying with the same `clientRequestId`.
A new user request gets a new `clientRequestId`; while a task is active it is refused with the active ref (one active task
per project and branch, enforced by the index CAS).

Scoping: every load uses the trusted context's scope (F1 loads are scoped); an unknown or foreign id is a uniform
`404 GENERATION_TASK_NOT_FOUND`, `no-store`; a guessed id is never access.

Ratchet moves (each a reviewed pin move): census 168 -> 174 (171 canonical, 3 factories, 0 raw) at
`b16-1b-auth-composition.test.ts:242-255`; `route-policy.ts` rows; `API_ROUTE_COVERAGE` entries mapped to
`schematic.generate`; `PRINCIPAL_CREDIT_ROWS` 32 -> 33 (+ `POST /api/generation-tasks`); `route-resource-classification.ts`;
the regenerated `auth-route-coverage.csv`. The build-multi route stays as a DEPRECATED synchronous composition of the same
slice primitives under `BUILD_BUDGET` (its PR-C contract and tests stand); the page stops calling it (OWNER-8: removal).

### 6.2 Snapshot `sirkit.generation-task-snapshot.v1`

`taskId`, `scope`, `state`, `phase`, `origin`, `provider`, `createdAt`, `updatedAt`, `serverNow`, plan blocks with status /
strategy / turns / parts surfaced / blocker, `assumptions`, `liveness`, `blocker`, `usage`, allowance remaining, `result`
summary, `review`, `control`, `actions`, `eventCursor`. Never messages, tool outputs, model text beyond the bounded milestone
lines, credentials or hidden reasoning. The prompt is returned only by `GET [id]` to project members.

### 6.3 Events

Milestones (durable, ordered): `sirkit.generation-task-event.v1` `{ seq, at, type, phase, blockId, message (<=240, redacted),
data (closed per type) }`, appended only by head commits; types `task_accepted`, `worker_claimed`, `plan_ready`,
`block_started`, `block_saved`, `slice_yielded`, `waiting_provider`, `waiting_resource`, `strategy_changed`,
`merge_started`, `validation_result`, `result_ready`, `paused`, `resumed`, `cancel_requested`, `cancelled`, `stale`,
`review_recorded`, `failed`. Live activity (the current attempt's last 8 lines: "checking catalog candidates for 'logic-level
N-MOSFET' (5 found, 2 new)", "pin contract checked: 2 issues", "ERC feedback: 1 critical", "saving block") comes from the
activity aggregate, replaced as it updates. Cursor = `seq`; a cursor older than the ring answers `gap: true` with the snapshot
(bounded replay). SSE: `id: <seq>`, events `milestone` / `activity` / `snapshot`, the server polls the store each second
(cross-process by construction), a heartbeat comment every 15 s (liveness only, never invented progress), closes at a terminal
state or after 120 s; the client reconnects with `after`. Polling fallback: the JSON page every 2 s. A subscriber disconnect
only stops that poll; it never cancels the task.

## 7. The UI in `app/page.tsx` (L.4)

- New browser-safe client `app/lib/project/generation-task-client.ts`: `startGenerationTask`, `fetchTask`, `fetchEvents`,
  `subscribeTask` (EventSource with polling fallback and backoff), `controlTask`, and a pure reducer `reduceTaskView`.
- `handleGenerateSchematic` Build branch: replace the fetch at `page.tsx:5147` with start (the `clientRequestId` is kept in
  sessionStorage until accepted, so a lost response retries the same id), then `attachGenerationTask(task, { logId, scope })`,
  which returns at once. Busy state = "this project has a non-terminal task" (not "a request is open"); Generate becomes Stop
  while one runs.
- The activity entry shows phase, elapsed time (server timestamps + `serverNow` offset), block chips (queued / designing /
  saved / blocked), counts (model turns, catalog searches), one updating live line and the milestones. No percentage, no
  scripted narration, no debug wall. Buttons: Stop design, Pause, Resume, Retry block, Review partial, Re-offer on current
  sheet, Start again from saved work, each shown only when listed in `actions`; each is classified in the B17 control registry.
- Result: `awaiting-review` triggers `offerGenerationTaskResult(taskId)` once per `(taskId, resultDigest)` (sessionStorage +
  the pending-proposal record gains optional `taskId`/`resultDigest`): fetch `include=result`, recompute the base with the
  task's `base.recipe`; a mismatch reports `stale` and offers Re-offer instead; otherwise run the code now inside
  `handleGenerateSchematic` after the fetch (`page.tsx:5155-5248`: completeness and ERC notes, `ensurePartLoaded`,
  `autoLayoutBuildValidated`, integrity, exact-base pin, `setPendingReplace`, `savePendingProposal`), extracted into one shared
  `offerBuildResult(...)`. Approve / discard report `record-review`. Nothing is applied because the worker finished.
- Reload and project switch: opening a project calls `GET /api/generation-tasks` and reattaches its active task (or offers its
  unoffered result) under that project's scope; the existing `ProjectAsyncScope` guard drops events of a project no longer
  current; leaving a project only unsubscribes.

## 8. Chat parity (L.5)

- One service, `GenerationTaskService` (`app/lib/generation-task/service.ts`: start / attach / inspect / control / collect over
  the injected repository), used by the routes AND by the chat port; `schematic-generation-runtime.ts` binds it (composition
  root, F16). The chat closure imports only the service and the domain modules, never the worker-side slice code (which may reach
  acquisition modules forbidden there, `b19-d-external-text-injection-route.test.ts:128`).
- `sirkit.schematic.generate-proposal@2.0.0` (propose): arguments exactly one of `{ prompt }` (start or attach; `clientRequestId`
  derived from run id + call id; base recipe `chat-sheet`) or `{ taskId }` (collect). Start returns a new outcome kind
  `generation-task` and run event `generation_task_ready { runId, toolId, task }` within milliseconds; collect on
  `awaiting-review` seals `sirkit.schematic-generation-proposal.v2` (v1 + `task: { taskId, resultDigest }`) as the existing
  `generation_proposal_ready`; the receiver accepts v1 and v2 and routes a v2 into `offerGenerationTaskResult` (one offer per
  result). The descriptor drops 185 s to an `interactive` 15 s; the binding constant moves to the service.
- `sirkit.schematic.generation-task-inspect@1.0.0` (read): the snapshot without the prompt.
- `sirkit.schematic.generation-task-control@1.0.0` (propose, `proposal-artifact`): a sealed control request
  (`generation_task_control_ready`) that the page shows as a confirm chip; only the human's click calls the control route.
  Direct agent control would need a reviewed exposure change (OWNER-6).
- Stop answer = the chat's existing Stop (`page.tsx:4862`): ends the run only; the line says the design keeps running. Stop
  design = the task's `cancel`. A chat run's 120 s end never touches the task. Shared manuals, exposure list, coverage matrix,
  MCP parity artifacts and the scripted fixture agent (`fixture-agent-adapter.ts:33`) are updated in the same increment.

## 9. Test plan (L.7)

Seams: a fake `BuildLlmPort` (scripted tool calls, controllable latency, hangs, provider errors), a fake catalog port, the
in-memory repository with fault hooks (F3), a PGlite repository (`b24-c1`/`b24-d2` pattern: `vi.mock` of `getDb`, restart by
`vi.resetModules()`), an injected task clock plus fake timers, the real worker process for lifecycle. Zero paid calls.

| L.7 | proof | seam |
|---|---|---|
| 1 | three blocks, one needing 24 turns over >= 4 slices and > 180 simulated s, reach `awaiting-review`; the result passes `offerBuildResult`'s pure part | fake LLM / catalog, in-memory repo, simulated clock |
| 2 | a 26 h simulated task through intermittent `overloaded`, three worker replacements and an events reconnect stays valid | same + PGlite restart variant |
| 3 | hung call aborted at `perCallMs`; two workers race one slice; a delayed old owner commits nothing (`GENERATION_SLICE_FENCED`); five lost attempts become `platform_failure` | fake LLM with deferred promises, two `GenerationWorker` instances |
| 4 | crash after each fault phase: blocks, facts, counters, uncertain reservations survive; resume repeats no cached search and no saved block's model call; ambiguous commit replays | in-memory fault hooks; PGlite |
| 5 | S1-S4 fail with distinct fingerprints, S5 succeeds; an identical loop stops at `no_progress` with bounded calls; missing part, quota and revocation produce their states | fake LLM / catalog / membership |
| 6 | start replay and mismatch, cursor pages and `gap`, SSE and polling, disconnect, `no_worker`, missing `DATABASE_URL` -> 503 with nothing stored | route handlers through the canonical wrappers |
| 7 | cancel freezes further calls and late intake; Stop answer leaves the task running; reload / project switch neither duplicate nor misattach; foreign id 404; stale base `stale` | route tests, reducer unit tests, fixture browser spec |
| 8 | Build and chat start, inspect and control through the same service and reach the same review path; manuals and matrix byte-match | gateway tests; existing generator gates |
| 9 | fresh browser, the owner's four-motor sentence, scripted fixture provider: plan with MCU, power and four motor-driver channels from fixture catalog parts; progress; Pause / Resume; worker killed (`no_worker`) then restarted; reload reattaches; review, approve, save / reload, Prepare PCB handoff with truthful unresolved / authority state | Playwright, `SIRKIT_FIXTURE_GENERATION=scripted`, spec-spawned pump worker |
| 10 | a second ordinary circuit (e.g. a USB-powered 3.3 V regulator with power LED) through the same spec; the script is chosen by feature classification, not the exact sentence | same; live evidence separate (OWNER-10) |

New PGlite suite `l2-generation-task-pglite.test.ts` needs a database-delivery workflow entry (a pinned-line move, F20).

## 10. Implementation plan (L.8 order)

Gates for every increment: `pnpm exec tsc --noEmit`, eslint on changed files, the targeted suites, then the affected ratchets.
Delete in-repo `playwright-report/` and worktrees before broad vitest runs; browser proofs run in the verification worktree,
never against the owner's :3000.

1. **I2 contracts and persistence** - `durable-workflow/types.ts`, `repository.ts`, `server-repository.ts` (S1, S2);
   `generation-task/contracts.ts` (schemas, states, transition table, bounds, validators), `events.ts`, `checkpoint.ts`
   (checkpoint validator, compaction), `store.ts` (create/attach with index CAS, fenced head commits with the rebase rule,
   by-reference artifacts). Tests: `l2-task-contracts`, `l2-task-store` (in-memory), `l2-generation-task-pglite`;
   `repository-outbox.test.ts` extended for S1/S2. Gates: durable-workflow suites, b24-c2 retention PGlite, CI admission.
2. **I3 worker** - `schematic/build-loop-slice.ts` (resumable core extracted from `build-loop.ts:186-408`; `runBuildToolLoop`
   becomes a wrapper so edit-build and PR-C tests stand); `build-multi-generation.ts` split into `planGeneration`,
   `designBlockSlice`, `mergeAndValidate` (the legacy function composes them); `generation-task/worker/{slices,accounting,
   progress,worker,runtime}.ts`; `scripts/generation-worker.ts` + package script; `dev-fixture.mjs --with-worker`; `llm/errors.ts`
   + adapters (`retryAfterMs`); `effects-runtime.ts` (S3). Tests: L.7 1-5 + a process test that spawns the real script with
   `--once` against an in-test HTTP pump. Gates: PR-C / PR-D generation suites, `generation-recovery`, cancellation suites.
3. **I4 API and UI** - the six routes, policy rows, coverage, abuse rows, resource classification, regenerated CSVs;
   `project/generation-task-client.ts`; `page.tsx` (start/attach, activity, controls, `offerBuildResult`, reattach);
   control registry; `pending-proposal-store.ts` optional fields. Tests: L.7 6-7, `e2e/l4-generation-task.spec.ts`. Gates: b16
   auth composition / migration ratchet / route coverage, B17 control inventory, coverage matrix.
4. **I5 chat parity** - `agent/generation-proposals.ts` v2, `contracts.ts` outcome + events, `loop.ts`, chat runtime,
   `tool-catalog.ts`, `tool-manual.ts`, `agent-exposure.ts`, `project/generation-proposal-events.ts`, page chat cases,
   scripted agent; regenerate manuals, matrix, tool registry and MCP artifacts. Tests: L.7 8. Gates: PR-D, B21, b19-d closure.
5. **I6 bottlenecks and vertical slice** - catalog port with category normalization, lookup cache, rerank memo
   (`parts-search.ts` option), facts reuse, strategy ladder S3-S6 with K's work items, shared-net check; fixture scripted
   provider + extended fixture catalog behind `SIRKIT_FIXTURE_GENERATION=scripted` (flag inventory, env census, Playwright env).
   Tests: L.7 9-10. Live qualification only within the ledger (OWNER-10).
6. **I7 regression and handoff** - full CI-equivalent gates, secret scan, pin moves recorded, evidence package and verdict in
   this folder, progress ledger closed.

## 11. Owner decisions

| id | decision | default until decided |
|---|---|---|
| OWNER-1 | per-task allowance values and extension cap (product spend policy; no USD table exists) | the section 5 proposal, operator may lower |
| OWNER-2 | store generation tasks in the main Supabase project's EXISTING durable tables and run the direct worker against it (no migration) | fixture and PGlite only |
| OWNER-3 | optional migration 0032: outbox index `(topic, state, available_at, created_at)` for the cross-scope claim (F5) | not created; unindexed filter |
| OWNER-4 | retention class for generation aggregates; start / terminal commits are `mixed_commit` and are refused by the purge (F6) | retained, not purged |
| OWNER-5 | whether `pnpm dev` also starts the worker | separate `worker:generation` |
| OWNER-6 | direct agent cancel / pause / resume instead of a confirm chip | confirm chip |
| OWNER-7 | `POST /api/generation-worker` enabled in production deployments | enabled behind the worker secret, fail closed when unset |
| OWNER-8 | remove the deprecated `POST /api/schematic/build-multi` | kept, unused by the UI |
| OWNER-9 | provider failover inside a task | off |
| OWNER-10 | a bounded live four-motor qualification within the US$5 builder ledger (re-read `../live-spend.json`) | fixture evidence only |
| OWNER-11 | automatic partial result when a block is blocked | explicit `review-partial` |
