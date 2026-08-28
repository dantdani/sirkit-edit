# B12 — validation summary

> **SUPERSESSION NOTE (B12.1).** The CONFIRMED claims below about visible
> application, receipt tamper-evidence, one-shot identity, and recovery
> closure were narrower than stated: counterexamples R1-R4 (UI adoption,
> altered consumed replay, receipt forgeries, retirement during commit)
> were reproduced against this implementation. Corrected battery and
> verdict: `../ai-control-plane-b12-1/validation-summary.md`. Preserved as
> historical evidence.


## Authoritative hashes — unchanged before and after the entire battery

```
app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
artifacts/ai-control-plane-b11/replay-trace-pins.json  939 bytes  sha256=ab36b0c9f5e23cae333ece747fa220e44921d30746f9cfb1e4bf9316f9ea759c
```

**Identical to the B11.7 baseline.** B12 added no PCB type, no descriptor
change, and no replay-pin change. It is purely an engineering-side
approval/execution service plus its UI wiring and tests.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx eslint` over `approved-agent-mutations.ts`, `b12-approved-mutation.test.ts`, `b12-boundary-and-e2e.test.ts` | **clean** (0 errors, 0 warnings) |
| `npx tsx scripts/generate-pcb-shape-descriptor.ts --check` | **OK** — 81 named types from 8 source files; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| `git diff --check` | **clean** (only pre-existing CRLF advisories) |
| `generate-b11-artifacts` twice | all three B11 artifacts byte-identical across both runs and to the committed baseline |

`page.tsx` carries 14 **pre-existing** `react-hooks/refs` lint findings unrelated
to B12 (e.g. `netLabelsRef.current = netLabels`); B12 introduced **zero** new
lint findings.

## Test battery

| Suite | Result |
| --- | --- |
| **B12** `b12-approved-mutation` (new) | **19 / 19 passed** |
| **B12** `b12-boundary-and-e2e` (new) | **13 / 13 passed** |
| B03.2 boundary + B06 schematic/proposal/authority/lineage | **96 / 96 passed** (5 files) |
| Engineering + agent + chat + PCB lifecycle + project | **852 / 852 passed** (58 files) |
| Evaluation matrix | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2405 passed, 20 skipped, 1 flake** (288 files) |

## The one non-pass — classified as a documented wall-clock flake, not a regression

```
FAIL app/lib/pcb/__tests__/route-tool.test.ts
  > route tool — perf > direct live preview avoids catastrophic slowdown with 500 tracks
```

**Isolated reproduction (per the binding constraint — classify only after
isolated reproduction):**

```
run 1:  route-tool.test.ts (25 tests) 1601ms   →  25 passed
run 2:  route-tool.test.ts (25 tests) 1578ms   →  25 passed
run 3:  route-tool.test.ts (25 tests) 1585ms   →  25 passed
```

- The failing assertion is a **wall-clock threshold** ("500 tracks avoids
  catastrophic slowdown"), not a functional/correctness check.
- In isolation it passes **25/25 three consecutive times** at ~1.6 s — the
  threshold is met with wide margin when not competing for CPU.
- It failed **only** under the full 288-file parallel run's CPU contention.
- It is a member of the **documented flake family** (`route-tool`), and B12
  touches **no** PCB routing code — the service is engineering-side only.

**Classification: pre-existing timing flake under suite contention. Not a B12
regression, and not dismissed without the isolated re-run above.**

## Replay pins — all 19 unchanged

Byte-identical to the B11 baseline and stable across two consecutive generator
runs; `replay-trace-pins.json` sha256 unchanged (recorded above).

## Confidence

### CONFIRMED

| Claim | Evidence |
| --- | --- |
| R1–R10 reproduced against production code before any edit | outputs captured verbatim in [pre-edit-reproductions.md](pre-edit-reproductions.md) |
| The one real gap (R4) is closed | §C one-shot registry: concurrent applies converge on ONE transaction; sequential replay returns `already-applied` with the ORIGINAL receipt; durable `idempotent_replay` never double-commits; unverifiable commit poisons the identity |
| Approved apply commits exactly one canonical transaction; undo restores the exact digest | tests R3/R8 against the real session |
| The EXACT sealed operations are applied — never compiled/repaired/reinterpreted | test *the applied schematic reflects the EXACT proposed edit* + `structuredClone(proposal.operations)` |
| Postconditions are verified from the authoritative result, not optimism | §D checks; poison-on-failure |
| The receipt is bounded, total, sound, and content-free | §B tests (hostile input, tampered fields, no schematic/prompt) |
| The model cannot approve or call apply | §G: nine read/propose tools, apply `toolExposure:"none"`, gateway refuses mutate |
| No supported surface can construct the trusted channel | §G import scan aligned to B03.2's four approved importers, with positive exclusions |
| No serialized `/api/chat` claim can authorize execution | R9 tests: top-level + nested lookalike claims → 400 |
| Approval never mutates the finalized run trace | R10: frozen trace, push throws, re-finalize returns same document; outcomes live in the separate audit ledger |
| End-to-end works provider-neutrally with no paid provider | §H: real `runAgentLoop` + real apply service under scripted openai/anthropic adapters; equal `operationsDigest`; no live call, no credits |
| All 19 pins, both authoritative hashes, nine-tool exposure unchanged | recorded above |

### INFERRED

| Claim | Why not CONFIRMED |
| --- | --- |
| The one-shot contract holds under all interleavings | proven over concurrent, sequential-replay, durable-replay, failed-preflight, rejected-command, poison, and not-ready cases; a truly adversarial scheduler is not exhaustively enumerated, but every claim/consume/poison transition is single-writer on an in-process map |
| Totality under all hostile receipt inputs | proven over the named hostile classes plus revoked/hostile proxies via the outer try/catch |

### PROPOSED

| Item | Note |
| --- | --- |
| `originRunId` provenance | metadata only; stored outside the sealed proposal and outside the frozen trace. Trustworthiness of the id itself is out of scope — it never grants authority |

### UNKNOWN

| Item | Note |
| --- | --- |
| Live model behaviour through a real provider | both provider accounts remain out of credits; every proof here is provider-free by construction. **No live call was made; no credits were spent; no provider config was changed.** |

## Verdict

**Ready for independent verification.** The one genuine pre-edit gap — no
idempotent already-applied result and no one-shot consumed guard (R4) — is
closed by an identity+scope-keyed one-shot registry that converges concurrent
applies, returns the original receipt on replay, and fails closed (poison) on
any unverifiable commit. The model's boundary remains exactly nine read/propose
tools; apply is unreachable from the model, the API route, the gateway, and the
tool registry; approval is an independent human action holding a live trusted
session that no serialized claim can mint. Every approved apply is exactly one
verified canonical transaction with a bounded content-free receipt, verified
postconditions, exact undo, and a separate execution audit. All 19 pins, both
authoritative hashes, and the nine-tool exposure are unchanged; the full suite
is green apart from one isolated-passing wall-clock flake in unrelated PCB
routing code.

**B13 has not been started.**
