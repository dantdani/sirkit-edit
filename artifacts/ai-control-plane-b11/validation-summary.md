# B11 validation summary

> **PARTLY SUPERSEDED BY B11.1 AND B11.2.** See
> [../ai-control-plane-b11-2/validation-summary.md](../ai-control-plane-b11-2/validation-summary.md)
> for the current battery and verdict, including the one changed replay pin.

> **SUPERSESSION NOTE (B11.1).** B11's happy-path suites passed, but six adversarial boundary failures (R1–R6) were independently reproduced afterwards: incomplete trace validation, sink mutation of recorder state, unclassified complete-only failures, a sink-factory failure aborting POST, an unvalidated replay capsule, and an exceptional route path that finalized no trace. All six are closed in B11.1; the historical evidence below is preserved. See artifacts/ai-control-plane-b11-1/validation-summary.md for the authoritative current state.

Date: 2026-08-10. Workspace: `C:\Users\robsa\Desktop\sirkit-edit`
(every existing working-tree change preserved; no git checkout/reset/
destructive cleanup; `C:\Users\robsa\sirkit` untouched; GitHub not used as
authority).

## New suite

`app/lib/agent/__tests__/b11-trace-replay-evaluation.test.ts` — **16 tests,
all pass**: §A trace schema/bounds/redaction (3), §B recorder ordering,
single terminal, sink failure, frozen identity, ledger-computed totals (4),
§C deterministic replay, drift detection, foreign scope/stale resources, no
network (4), §D evaluation matrix, provider parity, committed-matrix
agreement (3), §E exposure invariants + metadata-only trace (2).

## New/changed files

New: `app/lib/agent/trace.ts`, `trace-recorder.ts`, `replay-capsule.ts`,
`evaluation.ts`, `evaluation-cases.ts`,
`scripts/generate-b11-artifacts.ts`, the B11 suite, and this artifact set.
Changed: `app/lib/agent/loop.ts` (optional passive `trace` dep + normalized
event mirroring), `app/api/chat/route.ts` (one recorder per run; finalize +
validate), `app/lib/prompts.ts` (`AGENT_SYSTEM_PROMPT_VERSION`).

## Test batteries (exact counts)

| Battery | Result |
| --- | --- |
| B04–B08 control-plane gates (`b07 b04-tool-registry b08 b06`) | **316 passed** (18 files) |
| B05/B09/B10/B10.1/B10.2/B11 (`b05 app/lib/agent app/api/chat`) | **208 passed** (16 files) |
| `app/lib/engineering/__tests__` | **450 passed** (26 files) |
| PCB lifecycle + readiness | **20 passed** (2 files) |
| Full suite | **2206 passed, 9 failed, 20 skipped** (2235 total; 266/277 files, 3 skipped) |

**Every one of the 9 full-suite failures was reproduced in isolation before
classification, per the stage requirement — all 9 pass isolated:**

| Isolated rerun | Result | Class |
| --- | --- | --- |
| `arrange` | 7/7 | timing budget |
| `auto-place` | 8/8 | timing budget (2 cases) |
| `connectivity-board` | 10/10 | timing budget |
| `pcb-repair-agent` | 8/8 | timing budget |
| `route-tool` | 25/25 | timing budget |
| `run-drc` | 5/5 | timing budget |
| `assignment-queue-panel` | 2/2 | jsdom load flake (documented since B07.3) |
| `b09-3-closure` | 19/19 | filesystem-scan test under parallel load |

The `b09-3-closure` invariant was additionally re-proven by direct
inspection: `grep -rln "schematic-snapshot-resource" app scripts` over
non-test sources returns **no production mentions**. Zero functional
failures; no performance gate was loosened.

## Static gates

- `npx tsc --noEmit`: clean.
- Scoped ESLint (`app/lib/agent`, `app/api/chat`,
  `scripts/generate-b11-artifacts.ts`): zero findings.
- Generator byte stability: three consecutive runs produce identical
  `replay-trace-pins.json`, `evaluation-results.json`, and
  `evaluation-case-matrix.csv` (verified by diff).
- Evaluation: **19/19 cases, 59/59 checks**, report digest
  `eng1-fb2ca9b357aaf6b6`.
- Exposure: static agent exposure remains exactly **NINE** tool ids, all
  `read`/`propose`; no mutation, release, MCP, or multi-agent surface.

## CI gates delivered

Trace schema exactness and bounds · secret-field denylist (record-time
sanitize + document-level refusal) · exactly one terminal record · no
post-terminal append · deterministic trace digest · replay byte stability
against committed pins · registry/prompt/context drift detection (8 drift
shapes) · OpenAI/Anthropic normalized parity · no live provider/network
call in replay or evaluation (stubbed `fetch` asserted never called + no
provider SDK imports) · exact-nine static exposure · no
mutation/release/MCP/multi-agent exposure.

## CONFIRMED / INFERRED / PROPOSED / UNKNOWN

**CONFIRMED** — every agent run can now produce a bounded provider-neutral
trace (production loop + route wired); sanitized capsules replay
deterministically without providers; the evaluation matrix detects
intentional regressions (all 8 drift shapes fail explicitly); runtime tool
exposure is unchanged at nine; recorder/sink failure cannot alter
authorization or the terminal result; the trace contains no board,
schematic, prompt, tool-output, continuation, or secret-shaped content.

Two REAL defects the harness surfaced and closed: proposal sealing was
clock-dependent (replay now injects its deterministic clock into the
gateway); and cycle detection caps identical calls at `maxIdenticalCalls`
before invocation, so the matrix records two traced invocations rather than
the five naively assumed.

**INFERRED** — the 9 full-suite failures are parallel-load artifacts only
(each reproduced in isolation and green; the scan invariant additionally
re-proven by direct grep).

**PROPOSED** (not implemented) — durable trace retention with an explicit
retention window and operator-access policy; provider request-identifier
capture (requires primary-documentation verification and a redaction
review); per-tenant digest salting to prevent dictionary correlation of
`argsDigest`/`outputDigest`; capsule generation from live runs behind an
explicit opt-in.

**UNKNOWN** — live provider model turns (both accounts remain out of
credits). No credits were spent, no provider configuration changed, and no
provider request behavior was altered to collect metadata; the entire B11
surface is provider-free by construction.

## Verdict

B11 is COMPLETE per its stop condition. Stopped before B12 — no placement,
routing, repair, PCB mutation, manufacturing release, component authority,
MCP, or multi-agent orchestration was exposed. Awaiting independent
verification.
