# B11.5 — Capture Exactness, Diagnostic Redaction, and True Validator Totality

> **PARTLY SUPERSEDED BY B11.6.** Independent verification found the
> projection surface still violated this stage's own requirement — "Never
> return a hostile caller proxy as if it were a safe projection":
> `projectBoardForReplay(revokedProxy)` returned THE PROXY (the B11.4
> try/catch returned raw input), a nested hostile proxy survived in a
> projected board and its `get` trap fired on read, `projectReplayContext` and
> `validateCapturedReplayContext` still THREW on a revoked proxy, and the
> retained `findNonPlainJsonPath` depth parameter was silently ignored. All
> five are closed in
> [../ai-control-plane-b11-6/](../ai-control-plane-b11-6/README.md). Every
> closure described below is retained. Nothing here is deleted — it is the
> historical record of what B11.5 did and claimed.

A corrective stage for B11.4. The independent verifier confirmed the B11.4
tests pass and then reproduced three failures against current production code.
All three are closed here, with permanent regressions, and every B11.4 closure
is preserved.

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Exact R1–R3 pre-edit outputs, root causes, closures |
| [exact-capture-contract.md](exact-capture-contract.md) | §A why `defineProperty` onto a null-prototype destination, and why preservation rather than prohibition |
| [diagnostic-redaction-proof.md](diagnostic-redaction-proof.md) | §B the extracted redaction authority and the marker-absence proof |
| [validator-totality-matrix.md](validator-totality-matrix.md) | §C the audit of every exported boundary and the 8 × 10 probe matrix |
| [no-execution-proof.md](no-execution-proof.md) | The B11.4 boundary instrumentation, carried forward and re-verified |
| [regression-matrix.md](regression-matrix.md) | All 12 required proofs mapped to tests |
| [validation-summary.md](validation-summary.md) | Hashes, battery counts, 19 pins, versioning decision, CONFIRMED / INFERRED / PROPOSED / UNKNOWN |

## The three failures

1. **`__proto__` data loss and prototype injection.** `captureObject` assigned
   onto `{}`, which invokes the legacy `__proto__` setter. A numeric value was
   **silently discarded** while capture reported `ok: true`; an object value
   **replaced the snapshot's prototype**. Through production validation, a
   `footprint.padNets` Record (`Record<string, number>`, which permits the key)
   was accepted with the key gone — contradicting the documented invariant that
   no accepted field is silently discarded.
2. **Diagnostic credential leakage.** `plain-capture.ts` carried its own
   ASCII-only `safeKeyName`, so a synthetic marker in an untrusted key name
   reached capture issues, `validateReplayCapsule` issues, and
   `ReplayCapsuleInvalidError.message` verbatim.
3. **Stateful proxies still threw.** `findNonPlainJsonPath` guarded one
   preliminary `Reflect.ownKeys` and then re-enumerated with unguarded
   `Object.*` calls and read values through `Object.entries`. Five stateful
   proxy families threw straight out of it.

## What changed

* **`app/lib/agent/redaction.ts`** (new) — the dependency-neutral redaction
  authority: `sanitizeTraceText`, `containsSecretShapedText`,
  `isCredentialShapedName`, `foldFieldName`, and the new `redactPathSegment`.
  It imports nothing, which is what lets `plain-capture.ts` share it without a
  cycle. `trace.ts` re-exports it, so there is still exactly one definition.
* **`app/lib/agent/plain-capture.ts`** — objects are built on a null-prototype
  destination with `Object.defineProperty`, then given `Object.prototype` back;
  key names go through `redactPathSegment`; the new `scanPlainJson` exposes the
  same guarded walk in scan-only mode.
* **`app/lib/agent/trace.ts`** — `findNonPlainJsonPath` delegates to
  `scanPlainJson`; `findSecretShapedPath` is now total and descriptor-only;
  `safeKey` uses the shared authority; the redaction primitives are re-exported
  from `redaction.ts`.
* **`app/lib/agent/replay-context.ts`**, **`pcb-shape-projection.ts`**,
  **`replay-capsule.ts`** — `defineProperty` for untrusted keys, and the shared
  redaction authority for diagnostic path segments.
* **`app/lib/agent/__tests__/b11-5-capture-exactness.test.ts`** (new, 18).
* **`b11-1-trace-integrity.test.ts`** — two message-shape assertions re-worded
  to the stronger redaction; both now prove refused **and** not leaked.

## Versioning

`sirkit.agent-replay-capsule.v3` and `sirkit.agent-replay-context.v2` are
**unchanged**. This is a handling correction that does not narrow the accepted
document set — `__proto__` preservation widens what survives capture, redaction
changes refusal text, and totality converts throws into refusals. The full
reasoning is in [validation-summary.md](validation-summary.md), and a
regression pins both strings.

Static exposure remains exactly **NINE** read/propose tools. No live provider
call was made and no credits were spent. B12 was not started.
