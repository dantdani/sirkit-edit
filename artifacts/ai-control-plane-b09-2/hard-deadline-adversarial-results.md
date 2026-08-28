# Section C — hard-deadline enforcement (adversarial results)

## Defect

The run deadline armed an AbortController but every `await` on the adapter,
continuation, and gateway trusted the callee to honor the signal. A provider
that ignored it and resolved after the deadline had its result consumed and
emitted as a COMPLETED run (R4: events `run_started, warning, text_delta,
run_completed` after a 40 ms deadline).

## Production changes (`app/lib/agent/loop.ts`)

- A `BOUNDARY` sentinel and `guard(work)` wrapper race EVERY awaited
  adapter/continuation/gateway operation against the run boundary
  (deadline timer + external cancellation):
  - a late NORMAL resolution loses the race and is discarded;
  - a late REJECTION is pre-swallowed (`work.catch(() => undefined)`) so it
    can never surface as an unhandled rejection;
  - a pre-aborted signal resolves BOUNDARY immediately — the provider is
    never called;
  - the abort listener is removed when the race settles.
- After every guarded await, consumption re-checks
  `runSignal.aborted || deadlineExceeded()` before using the step.
- `boundaryFailure()` distinguishes `deadline` from `cancelled` via the
  deadline-expired flag.
- ONE outer `try/finally`: the toolset build is inside it; the `finally`
  clears the deadline timer and the external abort listener on every exit
  path (success, failure, toolset-invalid, throw).
- Terminal emission is single-shot (`emitOnce` declared before the first
  emission; the earlier TDZ hazard is gone): exactly one of
  `run_completed`/`run_failed` per run, and nothing after it.

## Adversarial test results (`b09-2-closure.test.ts` §C)

All use vitest fake timers and deterministic deferreds — no wall-clock
dependence; each scenario advances virtual time far past every late timer and
asserts nothing further is emitted.

| Scenario | Result |
| --- | --- |
| `start` ignores signal, resolves 5× past deadline (R4) | `failed/deadline`, 1 terminal event, no text/completion |
| Continuation ignores signal, resolves late | `failed/deadline`, 1 terminal event |
| Gateway ignores signal, resolves late | `failed/deadline`, 1 terminal event |
| Provider resolves 1 ms after the deadline timer | discarded; `failed/deadline` |
| Provider REJECTS after the race settled | `failed/deadline`; no unhandled rejection |
| Request pre-aborted before start | `cancelled`; adapter `start` NEVER called (0 calls) |
| Toolset-invalid exit | 1 `run_failed`; advancing 10 s more emits NOTHING (timer/listener cleared) |

Note on the toolset-invalid scenario: the registry/discovery layer already
refuses every representable descriptor defect itself (e.g. an over-long
provider name is excluded as `provider_name_length` during discovery), so the
loop's cleanup branch is driven by a registry whose enumeration throws — the
branch under test is the loop's settlement, and it emits exactly one terminal
event with all timers cleared.
