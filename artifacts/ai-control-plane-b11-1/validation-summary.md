# B11.1 validation summary

> **PARTLY SUPERSEDED BY B11.2.** The verdict below predates the six
> counterexamples reproduced in B11.2 (R1–R6). See
> [../ai-control-plane-b11-2/validation-summary.md](../ai-control-plane-b11-2/validation-summary.md)
> for the current battery, the replay-pin comparison, and the current verdict.

Date: 2026-08-10. Workspace: `C:\Users\robsa\Desktop\sirkit-edit` (every
existing working-tree change preserved; no `git checkout`/`reset`/
destructive cleanup; `C:\Users\robsa\sirkit` untouched; GitHub not used as
authority).

## Suites

| Suite | Result |
| --- | --- |
| `app/lib/agent/__tests__/b11-1-trace-integrity.test.ts` | **30 tests** — §A validation completeness (R1) incl. seq contiguity, prototype, accessor, key-name redaction; §B isolation (R2) incl. re-entrancy; §C failure classification (R3) incl. async-sink contract; §D validate-before-persist; §F input normalization; §G capsule contract (R5) incl. near-miss names; §H exposure |
| `app/api/chat/__tests__/b11-1-route-finalization.test.ts` | **9 tests** — R4, R6, cancellation, malformed/throwing sinks, hostile-sink toolset equality, already-aborted request, route stream-terminal guard, pre-stream 400 |
| B11 suite (`b11-trace-replay-evaluation`) | **16 tests**, unchanged and green |

## Batteries (exact counts)

| Battery | Result |
| --- | --- |
| B04–B08 control-plane gates | **316 passed** (18 files) |
| B05/B09/B10/B10.1/B10.2/B11/B11.1 (`b05 app/lib/agent app/api/chat`) | **247 passed** (18 files) |
| `app/lib/engineering/__tests__` | **450 passed** (26 files) |
| PCB lifecycle + readiness | **20 passed** (2 files) |
| Full suite | **2250 passed, 4 failed, 20 skipped** (2274 total; 272/279 files, 3 skipped) |

**Every full-suite failure was reproduced in isolation before
classification, as required — all four pass alone:** auto-place 8/8,
connectivity-board 10/10, pcb-repair-agent 8/8, route-tool 25/25. All four
are the documented timing-budget family. **Zero functional failures; no
performance gate was loosened.**

## Static gates

- `npx tsc --noEmit`: clean.
- Scoped ESLint (`app/lib/agent`, `app/api/chat`,
  `scripts/generate-b11-artifacts.ts`, all changed tests): zero findings.
- Generator: 19/19 evaluation cases, 59/59 checks; byte-stable across
  repeated runs.
- **All 19 committed trace pins are byte-identical to their pre-B11.1
  values** — verified by diff after every change wave. No trace-contract
  version change was required (the digest envelopes were deliberately
  preserved when the recorder was refactored).
- Static agent exposure: exactly **NINE** read/propose tool ids; no
  mutation, release, MCP, or multi-agent surface.

## Adversarial review

After the six required closures, four independent lenses audited the
boundary and four adversarial verifiers tried to refute their claims by
executing them against the real modules. Ten further defects were
CONFIRMED and closed (re-entrancy, prototype-carried fields, secret-bearing
key names, `seq` deletion, a prototype-chain `kind` lookup that CRASHED the
validator on pure JSON, an already-aborted request signal that let
abandoned runs complete, near-miss forbidden names, JSON-quoted credential
blindness, async-sink unhandled rejections, and a missing route-level
stream-terminal guard). Four claims were REFUTED with evidence, including
one — reconciling `step.toolCallCount` with the invocation ledger — that
would have **rejected honest traces**. See
[adversarial-review-findings.md](adversarial-review-findings.md).

## CONFIRMED / INFERRED / PROPOSED / UNKNOWN

**CONFIRMED** — a hostile or broken sink cannot mutate, abort, or corrupt a
run: it receives only deep-frozen independent snapshots, synchronous
re-entrancy is refused and classified, factory/append/complete/clock/digest/
validation failures are all classified without leaking detail, and the run's
authorization, tool outcomes, NDJSON, and terminal are provably unchanged.
Every trace is internally consistent (summary derived from and checked
against its own event ledger) and validated before any sink completion.
Every route path attempts exactly one terminal finalization, including the
unexpected-throw and cancellation paths. Malformed, forbidden-field-bearing,
prototype-carried, and secret-bearing capsules fail before any execution
with a structured classification that never echoes secrets.

**INFERRED** — the four full-suite failures are load-induced timing budgets
only (each reproduced in isolation and green; consistent with the family
documented since B07.4).

**PROPOSED** (not implemented) — writer-capability separation so a sink
holding a recorder reference cannot write via a deferred callback (see the
findings document for why a boolean guard cannot express this and why it
grants no additional authority today); durable trace retention with an
explicit window and operator-access policy; per-tenant digest salting;
provider request-identifier capture.

**UNKNOWN** — live provider model turns; both accounts remain out of
credits. No credits were spent, no provider configuration changed, and the
entire B11/B11.1 surface is provider-free by construction.

## Verdict

B11.1 is COMPLETE per its stop condition. Stopped before B12 — no
placement, routing, repair, mutation, manufacturing release, component
authority, MCP, or multi-agent orchestration was exposed. Awaiting
independent verification.
