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
| J7-2 review (2026-11-04): seven confirmed findings (C1, C2, C3, R1, R2, T1, T2; "J7-2 review" below) | a claimer's park beside a provider-delayed slice could be refused and orphan its slice (wedged `queued`); a lapsed slice's own re-delivery parked; a contended seeded strategy paid its seed on every re-queue; a sibling ending while liveness was read could park a block; a released waiter read "waiting for a running block's allowance" | the claimer never asks for a state it has no rule to, and a refusal the head did not take keeps its event; a lapsed slice re-queues like an unowned one; the seeded conversation is kept; the allowance is judged again on the head the commit lands on; the card marks a waiter only while its delay runs | no limit value, transition rule or bound moved; each fix has a case in `j7-allowance-review` that is red with the fix edited back |
| J7-9 (2026-11-04): an end that leaves only a sibling's provider-delayed slice pending (store `endSlice`, contracts `generationWorkerSettledState`; pending `providerWait`) | the end's commit was refused (`wait-provider` needs a reason; the reason was the sibling's, recorded nowhere); the saved block was released and redone, its reservation charged uncertain, and repeated refusals became `platform_failure` | the delayed slice carries the provider's reason (`providerWait`, set by the end that scheduled it, dropped at its claim) and the end attests it: the task waits for the provider with that reason | the transition table is unchanged (`j7-provider-wait-sibling-end` case 2 still sees a reason-less move refused); a sibling's reason is borrowed only when EVERY delayed slice carries one, so an end that delays its own next slice without a reason is still refused (`l2` scenario G), and a head persisted before `providerWait` keeps the earlier refusal |

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
  2026-11-04: none moved (every edit before a cited line is in place; new code is appended). [J7-2 review, 2026-11-04] The crashed
  slice ITSELF, re-delivered while only live siblings hold, now re-queues too (C2 below); a waiter beside it still counts its lapsed
  reservation as committed spend.
- **J7-2 review (DONE, 2026-11-04; fixture proof, `j7-allowance-review`, 12 cases over the production store - R1 over the production
  worker and slice runner - each red with its fix edited back, the files restored byte for byte).** The seven confirmed findings:
  - **C1 (MEDIUM).** A woken waiter whose re-claim is a genuine exhaustion beside a sibling's provider-delayed slice: the claimer's park
    derived `waiting-for-provider` from `queued` (no rule), so the commit was refused, yet the event was completed - the slice stayed
    pending with no outbox event and the task wedged in `queued`. Now a worker commit keeps `queued` / `waiting-for-provider` between
    themselves (`generationWorkerSettledState`: the head invariant judges them alike, and the snapshot's liveness reads the delay - the
    card says "Waiting for the model provider"), so the park commits; and a refusal the head did not take is judged again with its event
    kept (at most `claimRetries` rounds, then the lease lapses and the event is re-delivered), never completed beside a pending slice.
    Measured: C1's trace (unit 13: two re-queues, the third claim parks) ends `waiting-for-resource` with nothing pending; with the fix
    edited back the third claim never settles. C1b: a refusal commit that lost 9 compare-and-sets in a row lands on the next round.
  - **C2 (LOW).** A slice whose earlier attempt lapsed, re-delivered while only live siblings' reservations fill the allowance, re-queues
    instead of parking: the re-queue commit marks the lapsed attempt's reservation uncertain (still charged: unit 20, 1 spent + 6 lapsed +
    6 + 6 held = 19) and puts the block back to `queued` (its old claim had left it `designing`); the lapsed attempt's late end is fenced.
  - **R1 (MEDIUM; needs an operator input limit).** A block on a seeded strategy whose first core call is contended now keeps the seeded
    conversation: its first checkpoint (0 turns, the seed as its first message) rides the allowance-wait end, and a strategy a retry
    restarted is recorded as begun (history entry, strategy, a fresh progress count). Measured over two contended re-queues: S5's planner
    seed paid once (was once per re-queue: 2 by the second); a restarted S2 said "Retrying block" once (was once per re-queue).
  - **R2 (LOW).** Liveness read after a head could take a sibling that had fully ended in between for a lapsed holder and park the block.
    The claim's park is now judged again on the head its commit lands on (liveness read after that head; the compare-and-set proves it
    current), and an admission's EXHAUSTED holds only on a head that did not move while liveness was read (else judged again, at most
    `rebaseRetries` times). Measured: a sibling ending inside the window - the claim runs (was parked), the admission admits (was EXHAUSTED).
  - **C3 (LOW, display).** The card marks a block waiting for a running block's allowance only while its re-queue delay runs; a waiter
    claimed and handed back for takeover (`releaseSlice`, due now) keeps its count by design but reads as a queued block.
  - **T1, T2 (LOW, tests).** The bound is reached at the claim and at the admission: counts 1..12, waits 5, 10, 20, 40 s and 8 x 60 s, the
    13th parks `allowance_exhausted`; beside a live sibling, a claim whose own need does not fit (the catalog-search dimension) parks and
    an admission at 1 100 of 1 000 without the sibling's bound is EXHAUSTED, at 950 CONTENDED. Each mutation the review named turns a case red.
  No limit value, transition rule, bound or cited line moved (every edit before a cited line is in place; new code is appended).
- **J7-9, a sibling's end beside a provider wait (DONE, 2026-11-04; fixture proof, `j7-provider-wait-sibling-end`, 2 cases, case 1 red
  with the fix edited back).** Pre-existing, not J7-2: when a block ends (e.g. saved) while the only other pending slice is a block delayed
  by a provider wait, the end commit derived `waiting-for-provider` without a waiting reason and was refused (`GENERATION_TASK_TRANSITION_
  REFUSED`): the reason was the sibling's and was recorded nowhere. Root cause fixed, the rule unchanged: the delayed slice carries the
  provider's reason (`providerWait`, written only when the slice is in fact delayed, dropped at its claim) and such an end attests it
  (`generationWorkerSettledState`) - only when every delayed slice carries one, so a reason-less delay is still refused (`l2` scenario G
  unchanged; a head persisted before `providerWait` keeps the earlier refusal until its sibling is due). Measured (drone, 3 slots, one `rate_limit` with Retry-After 30 s on Power's first call): with the fix
  edited back the last running block's save was refused on all 5 attempts (each released and redone, its reservation uncertain) and ended
  `platform_failure` beside 2 saved blocks; with the fix 3 of 3 blocks are saved once each, 6 slices are each claimed once, 6 outbox
  events each leased once, 13 model calls (the drone's 12 and the rate-limited one), the task waits for the provider (`rate_limit`) from
  head revision 14 of 22, nothing is charged uncertain, and the result is reached. [J7-2 review, 2026-11-04] The earlier note "allowance waiters never
  reach it (a real end wakes them)" was wrong in its reason: a woken waiter genuinely exhausted at its re-claim reached the claimer's twin
  of this refusal (C1 above).
- **J7-3** blocks kept as sheets (increment J5, builder D). **J7-4** more than 8 blocks: shrink the head first, then move every bound case 7
  pins. **J7-5** the orchestration cap (OD-107). **J7-6** an editor-chosen workload size (owner cost decision). **J7-7** a workload view in
  the task card from the snapshot. **J7-8** more than 3 slots only after measuring the pool, the catalog slots and the provider's rate.
