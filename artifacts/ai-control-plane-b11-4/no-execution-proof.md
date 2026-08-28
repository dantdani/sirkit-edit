# B11.4 §E — a truthful no-execution proof

> **CARRIED FORWARD BY B11.5, UNCHANGED.** This proof is untouched by the
> B11.5 correction and re-verified green against it; see
> [../ai-control-plane-b11-5/no-execution-proof.md](../ai-control-plane-b11-5/no-execution-proof.md).

## What was wrong

Since B11.1 the claim "an invalid capsule executes nothing" rested on:

```ts
const factory = vi.fn(() => new InMemoryTraceSink());
setAgentTraceSinkFactory(factory);
…
expect(factory).not.toHaveBeenCalled();
```

B11.4 R6 measured it:

```json
{
  "sink factory calls for a VALID capsule": 0,
  "sink factory calls for an INVALID capsule": 0,
  "replayCapsule constructs InMemoryTraceSink directly": true,
  "replayCapsule calls createAgentTraceSink": false
}
```

`replayCapsule` constructs `new InMemoryTraceSink()` directly and never
consults the factory, so the counter is **0 either way**. The assertion could
not fail, and therefore demonstrated nothing about context assembly, resource
construction, discovery, gateway construction, loop execution, adapter
start/continue, tool invocation, or the caller's sink.

## What replaced it

[`b11-4-no-execution.test.ts`](../../app/lib/agent/__tests__/b11-4-no-execution.test.ts)
module-mocks the modules `replay-capsule.ts` imports, **delegating to the real
implementations**, so the production `replayCapsule` is what runs and each
boundary is counted as it is crossed:

| Boundary | Probe |
| --- | --- |
| context assembly | `assembleAgentRunContext` |
| resource construction | `buildAgentResourceBundle` |
| discovery | `buildRunToolset` |
| gateway construction | `createAgentToolGateway` |
| loop execution | `runAgentLoop` |
| registry construction | `sirkitToolRegistry` |
| recorder construction | the injected `clock` (the recorder calls it in its constructor) |
| the caller's sink | `options.sink` |

No production telemetry was added. The probes are module-level test mocks plus
two existing `ReplayOptions` fields (`clock`, `sink`) — narrow dependency
injection that already existed for replay determinism.

**Adapter start/continue** is covered transitively and stated as such: the
scripted adapter is internal to `replay-capsule.ts` and is driven exclusively
by `runAgentLoop`, so a `runAgentLoop` count of 0 entails zero
`adapter.start` / `adapter.continueWith` calls. **Tool invocation** is covered
the same way — the gateway is never constructed and the loop never runs.

## Results

**Control (valid capsule):** all eight probes fire. The test asserts
`observed().sort()` equals the full probe list, so if the instrumentation ever
stopped detecting execution the suite would fail rather than silently pass.

**Invalid capsules:** zero probes fire, for all eight hostile documents —
nested `toJSON`, top-level `toJSON`, nested accessor, unknown board field,
sparse array, revoked proxy, throwing proxy, and a cyclic capsule.

**Mutation test:** a valid capsule is deliberately executed and the *same
guard* is then applied. The test asserts the guard **fails** — proving the
guard is not vacuous, which is exactly the property the B11.1–B11.3 version
lacked.

**Caller's sink:** an invalid capsule leaves a sink passed through
`ReplayOptions` completely untouched.

## One measurement subtlety, recorded

Building a fixture calls `buildEvaluationCases`, which legitimately constructs
the tool registry to compute `registryDigest`. The first version of the test
cleared its counters and *then* built the hostile document, so
`registry-construction` was attributed to `replayCapsule`. The instrumentation
caught it immediately. Fixtures are now materialized before the counters are
cleared, so only `replayCapsule` is under measurement.
