# B11.1 — Trace Integrity, Hostile-Sink Isolation, Exact Replay-Capsule Validation, and Exceptional-Path Finalization

> **PARTLY SUPERSEDED BY B11.2.** Three B11.1 claims did not hold under
> adversarial input: opaque-fixture capsule validation (R1/R2/R3), the
> serialized-only trace secret scan (R4), and recorder totality (R5); a
> missing `recorderDiagnostics` bound (R6) allowed unbounded validator work.
> All six are closed in
> [../ai-control-plane-b11-2/](../ai-control-plane-b11-2/README.md).
> Nothing below is deleted — it is the historical record of what B11.1 did and
> claimed.

Corrective stage over B11 (implemented, not accepted). Six adversarial
boundary failures were independently reproduced against production code,
closed, and made permanent regressions. B11's happy-path behaviour,
contracts, schemas, and all 19 committed trace pins are preserved
unchanged.

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Exact R1–R6 pre-edit evidence |
| [trace-validation-closure.md](trace-validation-closure.md) | §A complete, internally consistent trace validation |
| [hostile-sink-isolation.md](hostile-sink-isolation.md) | §B/§C/§D isolation, failure classification, validate-before-persist |
| [exceptional-finalization-results.md](exceptional-finalization-results.md) | §E one terminal finalization attempt on every route path |
| [replay-capsule-validation.md](replay-capsule-validation.md) | §G exact recursive capsule contract + forbidden names |
| [regression-matrix.md](regression-matrix.md) | §H all 16 required proofs mapped to tests |
| [adversarial-review-findings.md](adversarial-review-findings.md) | 10 further defects found by adversarial review, plus 4 evidenced refutations |
| [validation-summary.md](validation-summary.md) | Battery counts, adversarial review, verdict |

## What changed

- **`app/lib/agent/trace.ts`** — `validateAgentRunTrace` rewritten as an
  internal-consistency validator (summary must equal the event ledger;
  exactly one `run_started` first and one terminal last; exact nested keys
  incl. `terminal.usage`; timeline sanity; outcome/reason semantics;
  unique closed-vocabulary diagnostics; bounded output). The diagnostic
  vocabulary grew to eight classifications.
- **`app/lib/agent/trace-recorder.ts`** — deep-frozen independent
  snapshots for every sink hand-off and for the returned document;
  identity copied then frozen; total input normalization (tokens, ids,
  model, status, terminal reason, cyclic payloads, hostile clocks);
  ordered finalize (construct → validate → classify-or-persist → return);
  `createAgentTraceSink()` never throws and falls back to an isolated
  in-memory sink.
- **`app/api/chat/route.ts`** — the route opens the trace itself, and one
  idempotent `finalizeTrace` funnel is invoked on the normal path, the
  outer `stream_error` path (after recording the terminal), and the
  `finally` block.
- **`app/lib/agent/replay-capsule.ts`** — `validateReplayCapsule` (exact
  recursive keys, hard bounds, forbidden field names, whole-capsule secret
  denylist) plus `ReplayCapsuleInvalidError`, thrown before any execution.
- **`app/lib/agent/evaluation.ts`** — a refused capsule scores as a failed
  case instead of crashing the suite.

## Ten further defects found by adversarial review

After the six required closures were implemented, four independent audit
lenses plus four adversarial verifiers (each required to REFUTE by
execution) found ten more real defects — including a validator CRASH
reachable from pure JSON (`"kind":"constructor"`), an already-aborted
request signal that let abandoned runs complete and bill, prototype-carried
fields that hid from both exact-key validation and the secret scan, and an
async sink leaking unhandled rejections. All ten are closed and
regression-tested; one confirmed item (deferred sink callbacks) is
deliberately left to a PROPOSED capability split, with the reasoning stated
in full. See [adversarial-review-findings.md](adversarial-review-findings.md).

## Three defects the work itself surfaced

1. **`??` coerced a legitimate `null`.** Deriving the terminal summary with
   `terminalEvent?.failureReason ?? "internal_error"` rewrote a completed
   run's null reason into a failure reason; the evaluation matrix caught it
   across eight cases within seconds.
2. **The B11 evaluation matrix contained a secret-shaped fixture.** The new
   capsule validator refused `e15-redaction`, which had embedded
   `sk-live-…` as a selection ref id. Repurposed; the secret-refusal proof
   moved to the B11.1 suite.
3. **Completeness validation + validate-before-persist together exposed an
   ordering bug**: an exceptional route path produced a trace with no
   `run_started`, which was correctly refused and therefore persisted
   nothing. Fixed by having the route open the trace — not by relaxing
   validation.

Static exposure remains exactly NINE read/propose tools. No mutation,
release, MCP, or multi-agent surface was added. B12 was not started.
