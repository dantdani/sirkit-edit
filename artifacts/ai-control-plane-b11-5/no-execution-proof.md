# B11.5 — the no-execution proof, unchanged and re-verified

B11.5 is a **handling correction**. It adds no execution path and removes no
boundary, so the truthful no-execution proof built in B11.4 §E is carried
forward intact rather than rebuilt.

Suite: [`b11-4-no-execution.test.ts`](../../app/lib/agent/__tests__/b11-4-no-execution.test.ts) — **4 / 4 passing** after every B11.5 change.

## What it instruments

Eight real boundaries, via module mocks that delegate to the real
implementations so the **production** `replayCapsule` is what runs:

| Boundary | Probe |
| --- | --- |
| context assembly | `assembleAgentRunContext` |
| resource construction | `buildAgentResourceBundle` |
| discovery | `buildRunToolset` |
| gateway construction | `createAgentToolGateway` |
| loop execution | `runAgentLoop` (which is what calls `adapter.start` / `continueWith`) |
| registry construction | `sirkitToolRegistry` |
| recorder construction | the injected `clock` |
| the caller's sink | `options.sink` |

## Why it still holds after B11.5

The B11.5 changes are all **inside** the parse step, which runs before any of
those boundaries:

* capture now installs keys with `defineProperty` — same call site, same
  ordering;
* diagnostics are redacted — a string change in the refusal, not a control-flow
  change;
* `findNonPlainJsonPath` delegates to the shared walk — same position in
  `validateCapturedCapsule`.

`replayCapsule` still parses on its first statement and throws
`ReplayCapsuleInvalidError` before constructing anything.

## Re-verified results

* **Control capsule** — all eight probes fire, so the test can still detect
  execution.
* **Eight hostile documents** — nested `toJSON`, top-level `toJSON`, nested
  accessor, unknown board field, sparse array, revoked proxy, throwing proxy,
  cyclic capsule — zero probes fire.
* **Mutation test** — a valid capsule is deliberately executed and the same
  guard is applied; the test asserts the guard **fails**, proving it is not
  vacuous.
* **Caller's sink** — untouched for an invalid capsule.

## Newly-refused documents also reach no boundary

The B11.5 regressions add hostile documents that the parse step now refuses for
new reasons — a credential-shaped key name with a function value, and every
stateful-proxy family. Each is refused with `ReplayCapsuleInvalidError` from
`parseReplayCapsule`, i.e. at the same first statement, so the same
no-execution argument covers them without a second instrumentation pass.
