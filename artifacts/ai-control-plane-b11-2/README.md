# B11.2 — Recursive Replay-Fixture Validation, Complete Secret Scanning, Total Recorder Inputs, and Bounded Trace Validation

> **PARTLY SUPERSEDED BY B11.3.** B11.2's board exactness stopped at the
> `PcbBoard` top level; five nested counterexamples still validated and
> executed. All are closed in
> [../ai-control-plane-b11-3/](../ai-control-plane-b11-3/README.md), which
> replaces the hand-written key lists with a descriptor GENERATED from the
> TypeScript declarations and adds a `--check` CI drift gate. Nothing below is
> deleted — it is the historical record of what B11.2 did and claimed.

Narrow corrective stage over B11.1 (implemented, not independently accepted).
Six adversarial boundary failures were reproduced against production code
**before any edit**, closed in production, and made permanent regressions.
B11/B11.1 behaviour, schemas, and 18 of the 19 committed trace pins are
preserved unchanged.

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Exact R1–R6 pre-edit outputs, root cause, and closure |
| [replay-context-schema.md](replay-context-schema.md) | §A `sirkit.agent-replay-context.v1` — producer/consumer, round-trip proof, drift gate, and the residual gap |
| [recursive-redaction-results.md](recursive-redaction-results.md) | §B/§C one shared credential classifier, pre-serialization scanning, carriers proven refused |
| [recorder-totality-results.md](recorder-totality-results.md) | §D the total recorder boundary and its 17 hostile-input probes |
| [bounded-validation-results.md](bounded-validation-results.md) | §E hard bounds, and why *order* was the defect |
| [regression-matrix.md](regression-matrix.md) | §F all 13 required proofs mapped to tests |
| [validation-summary.md](validation-summary.md) | Battery counts, replay-pin comparison, confidence, verdict |

## What changed

* **`app/lib/agent/replay-context.ts`** (new) — `sirkit.agent-replay-context.v1`:
  one shared producer (`projectReplayContext`) and one shared consumer
  (`validateReplayContext`). Key-exhaustive validation through the existing
  canonical authorities, a **projection round-trip** that refuses anything the
  producer would discard, plain-JSON/value/bounds discipline, a recursive
  credential scan, and reported (never invented) authority verdicts.
* **`app/lib/agent/replay-capsule.ts`** — schema bumped to
  `sirkit.agent-replay-capsule.v2`; `context` is now the versioned contract;
  the name-only `scanOpaqueFixture` is **retired**; `isForbiddenCapsuleKey`
  delegates to the shared credential classifier; the whole capsule is scanned
  **before** serialization.
* **`app/lib/agent/trace.ts`** — `foldFieldName`, `isCredentialShapedName`,
  and the bounded recursive `findSecretShapedPath`; the whole-trace scan now
  inspects original key names and string values; `maxRecorderDiagnostics`,
  `maxSerializedChars`, `maxScanNodes`, and `maxScanDepth` added, with the
  diagnostics length bound checked **before** any scan or `Set` construction.
* **`app/lib/agent/trace-recorder.ts`** — a `total()` boundary around every
  public method, `safeRead()` for every field of every argument, non-string
  warnings refused rather than coerced, out-of-vocabulary outcome classes
  normalized with a diagnostic, and a `finalize` with no throwing path
  (`finalizeInternal` → guarded `compose` → `emergencyTrace`).
* **`app/lib/agent/evaluation-cases.ts`** — two fixtures corrected to satisfy
  the stricter transport contract, each preserving its case's meaning exactly.
* **`app/lib/agent/__tests__/b11-2-replay-context.test.ts`** (new) — 20
  permanent regressions.

## The honest boundary

`board` content **below its top level** is validated by the authoritative
whole-board validator and constrained by the global plain-JSON,
credential-name, value-type, and size/depth disciplines — but it is **not**
key exhaustive. Hand-writing an exhaustive key list for the whole PCB element
type system is precisely the "competing PCB definition" this stage forbids;
closing that gap needs a projection **generated** from the type declarations,
recorded as **PROPOSED**. The reproduced counterexample was a top-level board
key and is closed. This is stated in the module header, in
[replay-context-schema.md](replay-context-schema.md), and in
[validation-summary.md](validation-summary.md) rather than being quietly
absorbed into a broader claim.

Static exposure remains exactly **NINE** read/propose tools. No mutation
execution, manufacturing release, MCP, provider expansion, or multi-agent
surface was added. B12 was not started.
