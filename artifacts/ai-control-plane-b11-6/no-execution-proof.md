# B11.6 — the no-execution proof, unchanged and re-verified

B11.6 changed how projections are produced and how exported boundaries refuse
— all inside or before the parse step. It added no execution path and moved no
boundary, so the truthful no-execution proof built in B11.4 §E is carried
forward intact.

Suite: [`b11-4-no-execution.test.ts`](../../app/lib/agent/__tests__/b11-4-no-execution.test.ts)
— **4 / 4 passing** after every B11.6 change.

## Why it still holds

`replayCapsule` still parses on its first statement. The B11.6 changes
(ownership registry, capture-and-project, total context boundaries) all run
inside `parseReplayCapsule` / `validateCapturedCapsule`, which precede every
instrumented boundary:

| Boundary | Probe | Invalid capsule |
| --- | --- | --- |
| context assembly | `assembleAgentRunContext` | never reached |
| resource construction | `buildAgentResourceBundle` | never reached |
| discovery | `buildRunToolset` | never reached |
| gateway construction | `createAgentToolGateway` | never reached |
| loop execution | `runAgentLoop` | never reached |
| registry construction | `sirkitToolRegistry` | never reached |
| recorder construction | injected `clock` | never reached |
| caller's sink | `options.sink` | never reached |

The control capsule fires all eight; the mutation test still proves the guard
is not vacuous.

## New hostile families

A top-level revoked proxy and a revoked proxy nested inside plain data are
asserted (in `b11-6-projection-ownership` §D test 12) to refuse with
`ReplayCapsuleInvalidError` from the parse step — the same position the
instrumentation already covers, so the same argument extends to them without a
second instrumentation pass.
