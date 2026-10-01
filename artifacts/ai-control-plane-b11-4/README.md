# B11.4 — Hook-Free Immutable Replay Capture, Total Validators, Truthful No-Execution Proofs, and Non-Mutating Drift Tests

> **PARTLY SUPERSEDED BY B11.5.** An independent verifier confirmed these
> tests pass and then reproduced three failures against the same production
> code: `capturePlainJson` assigned onto `{}`, so an own `__proto__` key was
> silently DISCARDED (numeric) or REPLACED THE SNAPSHOT'S PROTOTYPE (object);
> capture diagnostics carried untrusted key content verbatim because
> `plain-capture.ts` had its own ASCII-only `safeKeyName`; and
> `findNonPlainJsonPath` still threw for STATEFUL proxies because it guarded
> one preliminary `Reflect.ownKeys` and then re-enumerated unguarded. All three
> are closed in [../ai-control-plane-b11-5/](../ai-control-plane-b11-5/README.md).
> Every closure described below is retained. Nothing here is deleted — it is
> the historical record of what B11.4 did and claimed.

The final narrow B11 boundary closure. B11.3's generated recursive PCB
projection is retained and its five nested-board counterexamples stay closed;
the seven problems addressed here occur **before** that projection (how the
document is read) and **after** it (who owns the executed data, and what the
tests actually prove).

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Exact R1–R7 pre-edit outputs, root causes, closures |
| [hook-free-capture-contract.md](hook-free-capture-contract.md) | §A the shared descriptor-only capture: what it refuses, the serialization rule, how "never invoked" is proven |
| [immutable-replay-ownership.md](immutable-replay-ownership.md) | §B parse once, execute the snapshot; the versioning decision and its counter-argument |
| [total-validator-results.md](total-validator-results.md) | §C/§D proxy totality and the aligned board validator |
| [no-execution-proof.md](no-execution-proof.md) | §E eight real boundaries, a control capsule, and a mutation test |
| [isolated-drift-gate.md](isolated-drift-gate.md) | §F the in-memory overlay builder; nothing is written |
| [regression-matrix.md](regression-matrix.md) | §G all 12 required proofs mapped to tests |
| [validation-summary.md](validation-summary.md) | Hashes, battery counts, 19 pin comparisons, confidence, verdict |

## What changed

* **`app/lib/agent/plain-capture.ts`** (new) — `capturePlainJson`: reads only
  through `Reflect.ownKeys` / `Reflect.getOwnPropertyDescriptor` /
  `descriptor.value`; refuses accessors, functions (including `toJSON`, without
  invoking it), `undefined`/`symbol`/`bigint`, cycles, foreign prototypes,
  symbol keys, non-enumerable properties, sparse arrays and non-index array
  properties; bounded during capture; produces an independent deep-frozen
  snapshot; never throws.
* **`app/lib/agent/replay-capsule.ts`** — `parseReplayCapsule` returns
  `{ ok, value: DeepReadonly<ReplayCapsule> }`; `validateReplayCapsule` is a
  compatibility wrapper over it; `replayCapsule` captures once and executes the
  snapshot, referencing its `untrustedCapsule` parameter exactly once.
* **`app/lib/agent/replay-context.ts`** — `validateReplayContext` captures
  first and returns the **capture**, not a cast of the caller's object;
  `validateCapturedReplayContext` is the shared validation half.
* **`app/lib/agent/trace.ts`** — `validateAgentRunTrace` captures first;
  `findNonPlainJsonPath` guards every reflective call.
* **`app/lib/agent/pcb-shape-projection.ts`** — `validateBoardShape` refuses
  sparse arrays, foreign prototypes, symbols, non-enumerable indices and index
  accessors, and is total against hostile proxies.
* **`scripts/pcb-shape-descriptor-build.ts`** (new) — the filesystem-pure
  builder with an in-memory source overlay and a virtual `CompilerHost` whose
  `writeFile` is disabled.
* **`scripts/generate-pcb-shape-descriptor.ts`** — reduced to a CLI shell.
* **`app/lib/agent/__tests__/b11-4-capture-ownership.test.ts`** (new, 17) and
  **`b11-4-no-execution.test.ts`** (new, 4).
* **`app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts`** — drift gates
  rewritten fully in memory; the suite now imports only
  `{ existsSync, readFileSync }` from `node:fs`.

## Versioning

`sirkit.agent-replay-capsule.v3` and `sirkit.agent-replay-context.v2` are
**unchanged**. B11.4 changed how a document is handled, not what a conforming
document looks like; the newly-refused shapes (`toJSON` hooks, accessors,
functions, cycles, sparse arrays, proxies) are JavaScript artifacts that cannot
exist in a serialized wire document. The full reasoning, including the
counter-argument for bumping, is in
[immutable-replay-ownership.md](immutable-replay-ownership.md), and a
regression pins both strings.

> [B21 F, 2026-09-28] True for B11.4's own stage; superseded for the capsule by
> B21-F: the capsule is now `sirkit.agent-replay-capsule.v4` - its own field
> set grew (optional per-task step lists of a task graph, each task at its
> plan's index with one list per role, and a scripted stall only in a task's
> step list); a capsule with no tasks replays exactly as v3 did and a v3
> document is refused explicitly; the context stays
> `sirkit.agent-replay-context.v2`. See
> `artifacts/ai-control-plane-b21/evaluation-matrix.md` section 2.

Static exposure remains exactly **NINE** read/propose tools. B12 was not
started.
