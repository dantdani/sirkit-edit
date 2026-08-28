# B11.7 — Primitive JSON Discipline and Truthful Captured-Data Guards

The final narrow corrective stage after B11.6. Independent verification found
two untested contract defects; both are closed with permanent regressions, and
every prior closure is preserved. The full suite finished **completely green**.

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Exact R1–R2 pre-edit outputs, root causes, closures |
| [primitive-discipline-contract.md](primitive-discipline-contract.md) | §A capture-first for every foreign value; the uniform discriminated semantics |
| [captured-record-guard-contract.md](captured-record-guard-contract.md) | §B the registry-backed predicate and the captured-vs-projected distinction |
| [successful-result-json-invariant.md](successful-result-json-invariant.md) | §C the reusable ok:true invariant and everything it runs against |
| [exported-boundary-matrix.md](exported-boundary-matrix.md) | The full exported surface, updated from B11.6 |
| [regression-matrix.md](regression-matrix.md) | All 12 required proofs mapped to tests |
| [validation-summary.md](validation-summary.md) | Hashes, battery counts (full suite 0 failed), pins, versioning, CONFIRMED / INFERRED / PROPOSED / UNKNOWN |

## The two defects

1. **R1 — non-JSON primitives bypassed capture.** B11.6's projections skipped
   capture for non-object primitives, so `undefined`, symbols, bigints, `NaN`,
   and `±Infinity` — all refused by capture — reached `ok: true` results: a
   bigint made `JSON.stringify(result)` throw, non-finite numbers silently
   serialized as `null`, `undefined`/symbol values vanished, and
   `projectReplayContext("x")` / `(null)` returned `ok: true` with **empty**
   issue lists.
2. **R2 — `isCapturedRecord` was unsound.** The exported predicate claimed
   `value is Record<string, PlainJsonValue>` for any non-array object — `{}`,
   frozen caller objects, `Date`s, and benign proxies all passed.

## What changed

* **`pcb-shape-projection.ts` / `replay-context.ts`** — the primitive fast
  path is removed: the only capture bypass is registry-proven ownership.
  `projectCapturedContextValue` gained an explicit refusal channel and a
  deterministic structural issue for non-record roots.
* **`plain-capture.ts`** — `isCapturedRecord` requires ownership-registry
  membership, so its runtime test matches its TypeScript claim; the
  captured-vs-projected distinction is documented and asserted in both
  directions.
* **`b11-7-primitive-discipline.test.ts`** (new, 10) — including the reusable
  `assertJsonInvariant` run over primitives, boards, contexts, all 19
  committed evaluation contexts, and the `__proto__`/`constructor`/`prototype`
  special keys.

## Versioning

`sirkit.agent-replay-capsule.v3` and `sirkit.agent-replay-context.v2`
**unchanged** — an in-process handling/type-guard correction; non-JSON
primitives cannot exist in a serialized wire document at all.

Static exposure remains exactly **NINE** read/propose tools. No live provider
call was made and no credits were spent. B12 was not started.
