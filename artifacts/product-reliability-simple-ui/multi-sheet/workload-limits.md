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
| J7-2 (2026-11-04): a claim, or a pre-call input admission, refused ONLY by live siblings' held reservations (store `waitForAllowance`, `admitCall` -> `GENERATION_INPUT_ALLOWANCE_CONTENDED`, slices `endAllowanceWait`) | the block parked `allowance_exhausted` and asked for "Continue with another allowance" | re-queued under a fresh slice id (pending `wait: {reason: "allowance", requeues}`), woken at once by a sibling's real end; the card says `N more block(s) waiting for a running block to release its reserved allowance` (snapshot block `waiting`) | nothing is reserved while it waits, so committed never exceeds the unit; authority is revalidated before every contention check; a genuine exhaustion (own need does not fit, or no live holder) parks exactly as before |

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

- **J7-2, allowance contention (DONE, 2026-11-04; fixture proof, `j7-allowance-contention`, 7 cases, each shown red with the fix
  reverted).** When only live siblings' held reservations (or their in-flight input bounds) refuse a claim or a pre-call admission, the
  block re-queues (row above) instead of parking. Measured, eight blocks, three slots:

  | run | saved / omitted | peak committed | re-queues | calls |
  |---|---|---|---|---|
  | unit 30 calls, tick by tick (the default unit peaks at 31 on this run; sequential need 28) | 8 / 0, never `allowance_exhausted` | 28 of 30 | 1 | 25 |
  | unit 30 calls, the worker's own loop | 8 / 0, never `allowance_exhausted` | 28 of 30 | 3 | 25 |
  | unit 20 calls (below the sequential need) | 5 saved, 3 parked `allowance_exhausted`, each only once its own need (spent + uncertain + 6) exceeded 20 | 19 of 20 | 4 | 16; one extension finishes it at 25 |
  | three-block drone, input limit 55,760 (every call order fits one at a time) | 3 / 0 | 55,362 input | 3 (admission) | 12 |

  Every slice was claimed at most once, every outbox event leased at most once, no turn asked twice; a demotion during a wait stops the next
  claim (`authority_revoked`, the waiter never ran), a cancel during a wait settles `cancelled`. The L6 input-concurrency pin is unchanged
  (a dated note there records the new path). Remaining bounds: waits 5 s doubling to 60 s, at most 12 consecutive re-queues with no
  sibling end (their 555 s outlast the 465 s a live sibling can hold without ending), then `allowance_exhausted`; a LAPSED sibling's
  reservation still counts as committed spend, so a waiter beside a crashed slice parks rather than waits. Cited line numbers re-checked
  2026-11-04: none moved (every edit before a cited line is in place; new code is appended).
- **J7-9, a sibling's end beside a provider wait (open, found 2026-11-04).** Pre-existing, not J7-2: when a block ends (e.g. saved) while
  the only other pending slice is a block delayed by a provider wait, the end commit derives `waiting-for-provider` without a waiting
  reason and is refused (`GENERATION_TASK_TRANSITION_REFUSED`), so the finished slice is released and redone (its reservation charged
  uncertain). Reproduced offline (drone, 3 slots, one `rate_limit`); allowance waiters never reach it (a real end wakes them).
- **J7-3** blocks kept as sheets (increment J5, builder D). **J7-4** more than 8 blocks: shrink the head first, then move every bound case 7
  pins. **J7-5** the orchestration cap (OD-107). **J7-6** an editor-chosen workload size (owner cost decision). **J7-7** a workload view in
  the task card from the snapshot. **J7-8** more than 3 slots only after measuring the pool, the catalog slots and the provider's rate.
