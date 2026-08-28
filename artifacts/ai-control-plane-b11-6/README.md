# B11.6 — Projection Ownership and Complete Exported-Boundary Totality

> **PARTLY SUPERSEDED BY B11.7.** Independent verification found two untested
> contract defects in this stage's projections: the "non-object primitives
> skip capture" shortcut let `undefined`/symbol/bigint/`NaN`/`Infinity` — all
> refused by capture — into `ok: true` results (a bigint made
> `JSON.stringify(result)` THROW; NaN/Infinity silently became `null`;
> undefined/symbol values vanished; `projectReplayContext("x")` returned
> ok:true with EMPTY issues), and `isCapturedRecord` claimed captured-ness for
> any non-array object. Both are closed in
> [../ai-control-plane-b11-7/](../ai-control-plane-b11-7/README.md). Every
> closure described below is retained. Nothing here is deleted — it is the
> historical record of what B11.6 did and claimed.

A narrow corrective stage after B11.5. Independent verification found the
projection surface still violated the B11.5 requirement — *"Never return a
hostile caller proxy as if it were a safe projection"* — and two exported
context boundaries still threw. All five reproduced counterexamples are closed
with permanent regressions, and every prior closure is preserved.

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Exact R1–R5 pre-edit outputs, root causes, closures |
| [projection-ownership-contract.md](projection-ownership-contract.md) | §A/§D the capture-and-project architecture, the ownership registry, and the documented result contract |
| [exported-boundary-totality-matrix.md](exported-boundary-totality-matrix.md) | §B every exported unknown-input boundary with its chosen contract; the 105-probe matrix |
| [parse-once-proof.md](parse-once-proof.md) | The one-capture chain through `replayCapsule`, proven by fast-path identity |
| [no-execution-proof.md](no-execution-proof.md) | The B11.4 boundary instrumentation, carried forward and re-verified |
| [regression-matrix.md](regression-matrix.md) | All 14 required proofs mapped to tests |
| [validation-summary.md](validation-summary.md) | Hashes, battery counts, pins, versioning, honest failure classification, CONFIRMED / INFERRED / PROPOSED / UNKNOWN |

## The five failures

1. **R1** — `projectBoardForReplay(revokedProxy) === proxy`: B11.4's outer
   `try/catch` returned the raw input on refusal.
2. **R2** — a nested hostile proxy survived projection: the walker carried
   wrong-typed values verbatim, which for objects means caller identity;
   reading the "projection" executed the caller's `get` trap.
3. **R3** — `projectReplayContext(revoked)` threw `TypeError` (unguarded
   `isRec` → `Array.isArray`).
4. **R4** — `validateCapturedReplayContext(revoked)` threw the same way, from
   an exported function documenting a public unknown-input contract.
5. **R5** — `findNonPlainJsonPath({}, "$", 33)` returned `null`: the retained
   depth parameter — a security bound — was silently ignored.

## What changed

* **`app/lib/agent/plain-capture.ts`** — the **ownership registry**: every
  captured container is recorded in a module-private `WeakSet` at freeze time;
  `isOwnedCapture` is an unforgeable, trap-free, O(1) proof that a value is
  ours. `scanPlainJson` gained a `startDepth`; `isCapturedRecord` is guarded.
* **`app/lib/agent/pcb-shape-projection.ts`** — `projectBoardForReplay` is now
  **capture-and-project** with a discriminated `BoardProjectionResult`
  (`{ok:true, value, issues} | {ok:false, issues}`); failure is never the raw
  input; `projectCapturedBoard` is the registry-enforced trusted entry;
  `validateBoardShape` shares the single path.
* **`app/lib/agent/replay-context.ts`** — `projectReplayContext` is
  capture-and-project with `ContextProjectionResult`;
  `validateCapturedReplayContext` is registry-enforced (owned → zero-copy fast
  path, foreign → capture-first, hostile → refusal); the round-trip uses the
  internal trusted producer; `isRec` is guarded.
* **`app/lib/agent/trace.ts`** — the `findNonPlainJsonPath` depth parameter is
  threaded into the shared walk as its starting depth.
* **`app/lib/agent/__tests__/b11-6-projection-ownership.test.ts`** (new, 17) —
  including the recursive **identity-walk** and the 105-probe totality matrix.
* Round-trip call sites in `b11-2`, `b11-3`, `b11-5` unwrap the discriminated
  result; the two deliberately exhaustive B11.3 sweeps gained explicit
  timeouts after capture-first made them heavier (assertions untouched).

## Versioning

`sirkit.agent-replay-capsule.v3` and `sirkit.agent-replay-context.v2` are
**unchanged** — a handling/ownership correction; projection results are
in-process values, not wire documents, and every committed capsule validates
and replays to its unchanged pin.

Static exposure remains exactly **NINE** read/propose tools. No live provider
call was made and no credits were spent. B12 was not started.
