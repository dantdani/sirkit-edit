# J.7 workload limits: what changed, what was measured, what remains

Runbook J.7, increment J7-1 (OD-255 item 10). Branch `codex/astra-foundation`, 2026-10-22. **Fixture proof only**: a scripted provider, the
in-memory durable repository and a simulated clock. No paid call, no database, no network. The US$5 cumulative allowance is unchanged
(`live-spend.json`: 1.3628 spent, 2.66 held for resuming LR-3, 0.9772 provable remainder; the provider answers `insufficient_quota`), and
J.7 authorizes no new spend.

## What changed (no limit VALUE changed)

| change | before | after | why it is safe |
|---|---|---|---|
| plan_ready message when the planner proposes more than 8 blocks on both attempts (`app/lib/generation-task/worker/slices.ts:249`, text in `planLimitMessage` at the file's end) | "The plan could not be read; designing the request as one circuit." (false: the plan was read and was too big) | "The planner proposed more than 8 subsystem blocks (a design task holds at most 8), so the whole request is designed as one circuit. To design subsystems as separate blocks, ask for at most 8 or group related ones." (8 = `GENERATION_TASK_BOUNDS.blocks`) | text only; the one-block fallback was already kept and still designs the WHOLE request (`designPrompt`), so nothing is dropped; other fallbacks keep their text |
| task card status sentence while blocks design (`app/lib/project/generation-task-client.ts:420`, `generationQueueClause` at the file's end; rendered by `GenerationTaskStatus.tsx`, no page change) | `Running: designing "A", "B", "C".` | `Running: designing "A", "B", "C"; 5 more block(s) queued for a free worker slot.` A queued block whose latest milestone is the provider's wait is counted as `... waiting for the model provider` instead | byte-identical when nothing is queued; pure client text from the snapshot and milestones already sent |
| the durable worker's slot count (`app/lib/generation-task/contracts.ts:135`) | `BUILD_BUDGET.concurrencyCap` (the deprecated synchronous route's pool) | `3`, its own documented constant | same value; the deprecated route's pool can no longer silently move the durable queue (the J.7 suite moves that pool to 5 and the worker stays at 3) |

Not changed, and why (each is a real resource, spend or authority bound, not a product ceiling on subsystems or sheets):

| # | limit | value (unchanged) | kind | where | where the user meets it |
|---|---|---|---|---|---|
| C1 | orchestration specialists | 4 + coordinator, run one at a time, 300 s | read-only reviewers per chat message (flag off by default) | `app/lib/agent/orchestration/scheduler.ts:58-75` | not on the generation path since L; raising it is OD-107 |
| C2 | full-circuit role trim | 6 roles trimmed to 4 | same as C1 | `app/lib/agent/orchestration/router.ts:59` | same as C1 |
| C4 | subsystem blocks per design task | 8 | logical work | `app/lib/generation-task/contracts.ts:96`; planner `maxBlocks` at `worker/slices.ts:224` | the plan_ready message above; dependent bounds pinned together by `j7-queue-beyond-slots` case 7 |
| C5 | slices in flight per worker | 3 (clamped 1..3) | concurrent workers | `contracts.ts:135`; `worker/worker.ts:258`; `worker/cli.ts:53`; `worker/pump-transport.ts:75` | the queued count above; more throughput = more worker processes |
| C6 | catalog slots | min(4, pool - 3) = 4 with the default pool of 8 | DB connections | `app/lib/schematic/catalog-slots.ts:22`; `app/lib/db/client.ts:41` | none (internal queue) |
| C7 | slice limits | 6 turns per slice, 5 attempts per slice, 3 stalled slices per strategy | finite execution | `contracts.ts:128`, `:133`, `:134` | yields and strategy milestones; `platform_failure` blocker |
| C8 | allowance unit | 60 model calls, 480,000 output tokens, 300 searches, 72 h; up to 4 extensions by an editor | spend | `contracts.ts:150`, `:106` | the `allowance_exhausted` blocker and "Continue with another allowance" |
| C9 | one active task per project branch | 1 | isolation | `app/lib/generation-task/store.ts:525` (`GENERATION_TASK_ACTIVE`) | the 409 answer carries the running task |
| C10 | trace, event and context bounds | ring 48, 8 activity lines, head 64 KB, checkpoint 384 KB | storage | `app/lib/generation-task/events.ts:22-29`; `contracts.ts:88`; `checkpoint.ts:30` | none |
| C11 | qualification sizes | Astra 50 instances; autonomous PCB 25 components | qualification, not sheets | `app/lib/engineering/module-contract.ts:45`; `app/lib/pcb/autonomous/capability-profile.ts:14` | their own refusals; never a sheet limit |

## The queue proof (permanent test)

`app/lib/generation-task/__tests__/j7-queue-beyond-slots.test.ts` runs the PRODUCTION `GenerationTaskStore`, `GenerationWorker` and
`runGenerationSlice` on the drone planned as eight blocks (`EIGHT_BLOCKS` in `_l3-worker-fixtures.ts`). The worker is asked for 5 slots
and holds 3.

| measured (one worker, its own `start()` loop, default allowance) | value |
|---|---|
| blocks planned / saved / omitted | 8 / 8 / 0; the merge read 8 block references, 16 parts |
| peak slices in flight; peak provider calls in flight | 3; 3 |
| blocks queued while the slots were full | 5 (the card read `...; 5 more block(s) queued for a free worker slot.`) |
| slices (plan + blocks + merge); claims | 10; 10 (one outbox event each, each claimed once) |
| model calls (provider count = `usage.modelCalls`) | 25 (1 plan + 8 x 3) |
| peak committed (spent + held + uncertain) | 34 of 60 model calls; 148,656 of 480,000 output tokens |
| peak held reservations | 3 (6 calls x 8,192 tokens each) |
| largest head revision | 14,758 bytes of 65,536 |
| allowance at the end | 1 unit, no extension, no reservation held |

The cases: (1) the queue and the card's sentence; (2) no spawning beyond one pending slice per block and no plan after the plan; (3)
committed within the allowance on every head revision; (4) initiator, request, identities and allowance never change, every claim is
revalidated, and a demotion to viewer while five blocks are queued stops the next claim (`authority_revoked`, no further call, the queued
blocks never ran); (5) two workers of 3 slots: no slice twice, every block saved once; (6) a 9-block plan on both attempts is one circuit
from the whole request with the limit message; (7) the block limit, block ids, event counts, the store's plan refusal and the browser
reader's block list agree.

## Remaining bounds and open items

- **J7-2, allowance contention (open).** A block slice reserves 6 calls x 8,192 tokens at its claim, and the claim check counts the held
  reservations of running siblings. With the default unit the eight-block run peaks at 34 of 60 calls, so it never parks; an operator unit
  below the concurrent peak but above the sequential need (for example 30 calls for this run) would park a queued block with
  `allowance_exhausted` and ask for "Continue with another allowance". The fix (re-queue under a fresh slice id with a backoff when only
  live siblings' held reservations fill the unit; the same for the pre-call input admission; a per-block signal so the card does not call
  that wait "a free worker slot") touches the store, the slice runner, the waiting vocabulary and the L6 input-concurrency pin, so it was
  not small enough for this increment.
- **J7-3** blocks kept as sheets (increment J5, builder D). **J7-4** more than 8 blocks: shrink the head first, then move every bound case 7
  pins. **J7-5** the orchestration cap (OD-107). **J7-6** an editor-chosen workload size (owner cost decision). **J7-7** a workload view in
  the task card from the snapshot. **J7-8** more than 3 slots only after measuring the pool, the catalog slots and the provider's rate.
