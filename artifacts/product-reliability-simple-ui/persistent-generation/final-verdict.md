# Final verdict — section L, the persistent circuit-building task (2026-10-20)

[PR-L7, 2026-10-20] Branch `codex/astra-foundation` at `deaf15ca` (increment 7's evidence and CI admission uncommitted when this was
written). Governing text: `artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` L.7 (`:661-676`), L.8 and its stop
condition (`:678-696`). Commands and exit codes: `validation.md`. This verdict covers section L only; it does not claim the application
or the program complete.

## Verdict: PARTIAL

The request-lifetime generation is replaced. A Build or chat request now starts (or attaches to) one durable task; a separate worker runs
finite slices that checkpoint, yield and continue; completed blocks are saved as they finish; Stop design, Pause, Resume, Retry block and
Continue with another allowance are durable actions; the result reaches the same review dialog and nothing is applied without the
human's Approve. All of that is proven by permanent tests over the production task service, worker and receivers (fake provider and
catalog seams, in-memory and PGlite stores) and in the fixture browser. Live, the one bounded run (LR-3) showed the same path in normal
mode up to the provider's refusal: a planned design with disclosed assumptions, one saved block, two slices that yielded and continued,
then the owner's OpenAI account answered `insufficient_quota`. No live run has yet reached a reviewable four-motor design, so L stays
PARTIAL until that same task resumes to one.

## L.7, item by item

| # | L.7 item | verdict | permanent test (production path) | evidence class; reason |
|---|---|---|---|---|
| 1 | a 3-block design longer than 180 s and the old allowances reaches a reviewable proposal; window expiry queues continuation | CONFIRMED | `app/lib/generation-task/__tests__/l3-continuation.test.ts` ("[L.7-1] a design longer than any single slice …"); `app/lib/schematic/__tests__/l3-block-slice.test.ts` | fake-backed. Live corroboration: LR-3's blocks b1 and b2 each ran 4 turns, yielded at the slice allowance and were queued again |
| 2 | a 24-hour-plus logical task across many slices, worker restart, browser disconnect / reconnect | CONFIRMED | `l3-long-task` ("[L.7-2] a task longer than a day …"); `l3-worker-process` case 2 (a restarted real process resumes from durable state); `app/lib/project/__tests__/l4-task-client.test.ts` (unsubscribe only stops observing); `e2e/l4-generation-task.spec.ts` case 1 (reload reattaches the same task, one start) | fake-backed + fixture browser; lifecycle, not engineering quality |
| 3 | hung turn times out; ownership, lease expiry, duplicate consumers, late completion and cancel fence an old worker; repeated failure becomes an honest state | CONFIRMED | `l3-fencing` ("[L.7-3] …"); `l2-generation-task-pglite` (a fence mutant is killed); `l2-task-store` | fake-backed, PGlite |
| 4 | saved blocks, facts, counters, strategy, spend and reservations survive a crash; no repeated paid work; ambiguous completion honest | CONFIRMED | `l3-crash-resume` ("[L.7-4] …", incl. the PostgreSQL case and the input crash); `l3-input-allowance`; `l6-plan-reservation`; `l6-sdk-retries` (one metered call is one billed attempt); `l6-input-concurrency` | fake-backed, PGlite. Live: LR-3's plan, saved block and charged usage persisted after the worker and server were stopped; a live resume has not run |
| 5 | four different failed strategies then success; identical no-progress loops stop; a real missing / evidence / permission / quota blocker keeps progress with an actionable resolution | CONFIRMED | `l3-strategies` cases 1-5 (S1-S4 fail without progress and S5 succeeds; an identical loop stops; a missing part ends at S6 and a retry finds it; a quota refusal blocks the block while saved blocks are kept); `l6-repeat-turns`; `l6-missing-role`; `l6-unfilled-role-same-turn` | fake-backed. Live: LR-3's `provider_quota` blocker kept the saved block and the card stated it ("Restore the provider quota or credit, then resume the design.") |
| 6 | startup replay, ordered event replay, cursor pagination, subscriber disconnect, missing worker and missing storage are truthful | CONFIRMED | `app/api/generation-tasks/__tests__/l4-routes.test.ts` (cases 2, 4-6); `l4-task-client`; `l6-liveness-scope`; `l3-worker-process` case 3 (no `DATABASE_URL`: exit 2, nothing claimed) | fake-backed; an accepted job with no worker reads "waiting for a worker", never running |
| 7 | Cancel stops work and late intake; Stop answer vs Stop design; refresh / project switch; revocation, foreign ids, stale bases refuse | CONFIRMED | `l4-routes` cases 3 and 7; `e2e/l4-generation-task.spec.ts` cases 2 and 4; `e2e/l5-chat-task.spec.ts` case 3; `app/lib/agent/__tests__/l5-generation-task-tool.test.ts` case 5 | fake-backed + fixture browser |
| 8 | Build and chat start / inspect / control the same task, real progress, the same review flow; manuals and coverage match | CONFIRMED | `l5-generation-task-tool`; `e2e/l5-chat-task.spec.ts`; `l6-inspect-bound`; the drift gates `pr-d-tool-manuals` and `pr-d-coverage-matrix` | fake-backed + fixture browser; no live chat start was made |
| 9 | a fresh-browser four-motor request: real subsystem content, a catalog-resolved schematic, review, save / reload, the PCB-preparation handoff, truthful checks | PARTIAL | `e2e/l7-drone-vertical-slice.spec.ts`; `app/api/generation-tasks/__tests__/l7-fixture-vertical-slice.test.ts` ("[L.7-9] …"); `app/lib/fixture-runtime/__tests__/l7-scripted-policy.test.ts`, `l7-generation-catalog.test.ts` | fixture browser CONFIRMED: the owner's sentence verbatim -> 4 saved blocks, 41 instances each with a published exact revision, ERC passed (0 critical, 2 warnings), review, Approve, reload (Missing parts 0), Prepare PCB through the binding review to awaiting qualification, release disabled. Not covered: routing and DRC (no router recording for this board, OD-253 (5)); the fixture parts' pinouts come from the KiCad files, not manufacturer datasheets. Live BLOCKED: LR-3 stopped at the owner's OpenAI quota |
| 10 | another ordinary circuit through the same path; fake / live evidence labelled separately | CONFIRMED | `e2e/l7-second-circuit.spec.ts` (555 PWM LED dimmer, 14 instances; the blinker still yields its recorded design); `l7-scripted-policy` (quad op-amp, quad SPI, quad-core, BLDC, brushless and mixed requests are not read as the drone); `l7-fixture-vertical-slice` ("[L.7-10] …") | fixture browser: the designs are the scripted provider's per-request recipes over the committed catalog; live-model generality is not proven (LR-3 did not complete) |

Evidence labels for items 9-10: **fixture** = scripted provider, committed fixture catalog, no router, no network; **LR-3** = live model
(gpt-5.6-sol), live catalog (the owner's database; 69 embedding calls), no router; no live-router evidence exists for either.

## LR-3, told plainly

On 2026-10-20 (00:44-01:02 UTC) the owner's four-motor sentence went through the real page in normal mode, on the builder's own server
and worker, with the owner's OpenAI key and main database, in a new synthetic project. 3.83 USD was reserved first (the provable worst
case of the task's allowance unit plus the bounded post-approval passes). The start answered 202 at once. The plan slice planned three
blocks and the card listed the plan's assumptions and requested coverage. The block "Four brushed-motor drivers" was designed and saved.
The other two blocks each worked four turns, yielded, and were queued again. Then OpenAI refused: "Flight controller, IMU, and radio" was
blocked on `provider_quota` (`insufficient_quota`) and "Battery input and regulated power" waited on a `rate_limit` with a scheduled
retry. The card kept the saved block and said what it was waiting for. 1.17 USD was spent (confirmed from the durable call records). The
builder stopped the worker and server with no slice in flight; the task is durable in the owner's database and can be resumed — the same
task, without retyping the request — once the owner's OpenAI quota is restored. Nothing was approved, so no Tidy or Review pass ran.
Screenshots: `screenshots/lr3-card-plan-assumptions.jpg`, `screenshots/lr3-card-provider-quota.jpg`.

## The L.8 stop condition, assessed

| clause (`:694`) | live (LR-3) | fixture / fake only |
|---|---|---|
| the request no longer dies because 40 / 120 / 180 s or a small slice allowance elapsed | PROVEN for Build: two block slices hit the 4-turn allowance and continued; 18 minutes with no deadline failure | chat: `l5-generation-task-tool` case 5 (the turn's deadline ends the turn, never the task) |
| real work is persisted and progresses through a real worker | PROVEN: the plan and one block persisted in the owner's database through the real worker process | — |
| cancellable / resumable | not exercised live (Stop design and Pause were offered) | PROVEN: `e2e/l4-generation-task.spec.ts` cases 2-3, `l3-worker-process` case 2 |
| reaches a valid reviewable artifact OR a specific genuine blocker without losing completed work | PROVEN on the blocker branch: `provider_quota` with the saved block kept | PROVEN on the artifact branch: `e2e/l7-drone-vertical-slice.spec.ts`, `e2e/l7-second-circuit.spec.ts` |
| the owner sees actual progress and can recover without retyping | progress PROVEN (blocks, assumptions, the waiting sentence); recovery offered, not yet exercised | PROVEN: resume and retry of the same task in the l4 and l5 specs |
| no hidden unlimited spend, discarded validation, automatic approval, fabricated component, false success or exposed private reasoning | spend bounded and confirmed (1.17 of 3.83 reserved; SDK retries 0; pre-call input admission); nothing approved; the card said "waiting" and "blocked", never done | `l6-input-concurrency`, `l6-post-apply-admission`; Approve only by a click; the scripted provider selects only returned parts; the inspection allowlist (`l5-generation-task-tool` case 3) carries no prompt, message or reasoning |

The stop condition holds live on its blocker branch and fixture-backed on its reviewable-artifact branch. Its strongest form — the
owner's own request resumed live to a reviewable design — waits on one external resource: the owner's OpenAI quota.

## What this verdict does not claim

Not that the application or the remaining program is complete; not engineering quality, firmware or flight qualification of any drone
design; not routing, DRC or release of the four-motor board; not exactly-once provider billing beyond the stated bounds. Open items:
`../remaining-blockers.md`.
