# B11.5 §C — validator totality matrix

> **SUPERSEDED IN PART BY B11.6.** This matrix listed `projectBoardForReplay`
> and `validateBoardShape` as total via "guarded walk + entry-point guard" —
> but the entry-point guard RETURNED THE RAW INPUT on refusal (B11.6 R1), and
> the walker carried caller-owned objects verbatim for wrong-typed slots
> (B11.6 R2). It also did not cover `projectReplayContext` or
> `validateCapturedReplayContext`, both of which threw (B11.6 R3/R4). The
> current, complete matrix is
> [../ai-control-plane-b11-6/exported-boundary-totality-matrix.md](../ai-control-plane-b11-6/exported-boundary-totality-matrix.md).
> The historical record below is retained unchanged as evidence.

## The defect

`findNonPlainJsonPath` guarded **one** preliminary `Reflect.ownKeys` and then
re-enumerated the same value with unguarded `Object.getOwnPropertyNames` and
`Object.getOwnPropertySymbols`, and read child values through `Object.entries`
— which performs ordinary property reads and therefore invokes `get` traps.
B11.5 R3 reproduced five stateful proxies that threw straight out of it.

The principle it violated: **a proxy is not safe because one preliminary trap
invocation succeeded.** Trap behaviour may differ on the next call.

## The fix

`findNonPlainJsonPath` now delegates to `scanPlainJson` — the **identical
guarded walk** `capturePlainJson` uses, in a scan-only mode that reports the
first issue without building a snapshot. One traversal implementation, one set
of guarantees:

* every reflective operation is attempted individually inside a guard;
* values come from `Reflect.getOwnPropertyDescriptor(...).value`, never from a
  property read;
* one `Reflect.ownKeys` result is used for the whole node — no re-enumeration;
* no trap result is trusted to hold for a later call.

`findSecretShapedPath` — exported and documented as accepting untrusted input —
was given the same treatment: guarded `Array.isArray` / `Reflect.ownKeys` /
`Reflect.getOwnPropertyDescriptor`, descriptor-sourced values, symbol-key and
accessor refusal, and redacted labels.

## Audit of every exported boundary that accepts untrusted data

| Function | Strategy | Total |
| --- | --- | --- |
| `capturePlainJson` | guarded walk; every reflective op individually attempted | yes |
| `scanPlainJson` (new) | same walk, scan-only | yes |
| `findNonPlainJsonPath` | delegates to `scanPlainJson` | yes |
| `findSecretShapedPath` | guarded reflective ops; descriptor-sourced values | yes |
| `validateAgentRunTrace` | captures once, validates the snapshot | yes |
| `parseReplayCapsule` | captures once, validates the snapshot | yes |
| `validateReplayCapsule` | wrapper over `parseReplayCapsule` | yes |
| `validateReplayContext` | captures once, validates and returns the snapshot | yes |
| `validateBoardShape` | guarded walk + entry-point guard | yes |
| `projectBoardForReplay` | guarded walk + entry-point guard | yes |

## Result matrix

Eight proxy families × ten boundaries = **80 probes, zero throws**.

| Family | Behaviour |
| --- | --- |
| stateful `ownKeys` (2nd call throws) | refuse or capture cleanly |
| stateful `getPrototypeOf` | refuse or capture cleanly |
| stateful `getOwnPropertyDescriptor` | bounded refusal |
| stateful `get` / `length` | refuse or capture cleanly |
| stateful `has` + `ownKeys` | bounded refusal |
| nested stateful (proxy two levels down) | bounded refusal |
| revoked | `is not reflectable (revoked or hostile proxy)` |
| all-throwing traps | `its own keys are not reflectable (hostile trap)` |

Two further properties are asserted separately:

* **A single successful trap does not confer safety.** A proxy whose `ownKeys`
  succeeds exactly once is either captured cleanly from that one enumeration or
  refused — never throwing, and never trusted for a second call.
* **A hostile caller proxy is never returned as a safe projection.** When
  `validateReplayContext` accepts, the returned context is not the caller's
  object; and a hostile board is refused by `validateBoardShape` before any
  caller can reach a projection of it.

## Cost

`findNonPlainJsonPath` is invoked on already-captured snapshots inside
`validateCapturedCapsule` and `validateCapturedReplayContext` as an independent
assertion. Delegating to the scan keeps that call cheap — it allocates nothing
— while making the exported function sound for external callers passing raw
untrusted input.
