# B11.6 §B — exported-boundary totality matrix

> **EXTENDED BY B11.7.** Two rows below were corrected: the projectors now
> capture-first for EVERY foreign value (the primitive shortcut let non-JSON
> primitives into ok:true results), and `isCapturedRecord`'s runtime test now
> requires ownership-registry membership, matching its TypeScript claim. The
> updated surface is
> [../ai-control-plane-b11-7/exported-boundary-matrix.md](../ai-control-plane-b11-7/exported-boundary-matrix.md).

Every exported B11.x function that accepts `unknown` or caller-owned input,
with its chosen contract. "Total" means: no reflective operation, iterator,
array length read, `Object.*` enumeration, property access, or recursion step
operates unguarded on caller-owned input; a revoked, stateful, nested, or
trap-throwing proxy never escapes as an exception or a returned projection.

## The stage's minimum audit set

| Boundary | Contract | Mechanism |
| --- | --- | --- |
| `projectBoardForReplay` | **public/untrusted, total** | capture-and-project; explicit failure result (R1/R2 closed) |
| `projectReplayContext` | **public/untrusted, total** | capture-and-project; explicit failure result (R3 closed) |
| `validateCapturedReplayContext` | **captured-only, runtime-ENFORCED, total** | ownership-registry check → zero-copy fast path for owned snapshots, capture-first for everything else (R4 closed); an accepted foreign context is a captured copy, never the caller's object |
| `projectCapturedBoard` | **captured-only, runtime-ENFORCED, total** | same registry check; misuse routes through the public capture-first path |
| `validateBoardShape` | **public/untrusted, total** | `projectBoardForReplay(raw).issues` — one path, one set of guarantees |
| `findNonPlainJsonPath` | **public/untrusted, total** | delegates to `scanPlainJson`; the `depth` parameter is now threaded as the walk's starting depth (R5 closed) |
| `isCapturedRecord` | **public/untrusted, total** | `Array.isArray` guarded — it throws on a revoked proxy |

## The remaining exported B11.x surface

| Boundary | Contract | Mechanism |
| --- | --- | --- |
| `capturePlainJson` / `scanPlainJson` | public/untrusted, total | every reflective op individually guarded; descriptor-only reads (B11.4/5) |
| `isOwnedCapture` | public/untrusted, total | `WeakSet.has` — identity-based, trap-free |
| `validateReplayContext` | public/untrusted, total | capture-first (B11.4), owned fast path (B11.6) |
| `parseReplayCapsule` / `validateReplayCapsule` | public/untrusted, total | capture-first (B11.4) |
| `replayCapsule` | public/untrusted, total at its parse step | parses once, executes the snapshot (B11.4) |
| `validateAgentRunTrace` | public/untrusted, total | capture-first (B11.4) |
| `findSecretShapedPath` | public/untrusted, total | guarded reflection, descriptor-sourced values (B11.5) |
| `sanitizeTraceText` / `containsSecretShapedText` / `foldFieldName` / `isCredentialShapedName` / `redactPathSegment` | public, total trivially | string-only inputs |
| `isValidFailureReason` | public, total trivially | string-only |
| `agentRunTraceDigest` | **internal/trusted, documented** | serializes with `canonicalJson`; production callers pass recorder-finalized or captured traces only. Making it capture-first would touch the digest path that all 19 pins depend on for zero benefit — no untrusted data reaches it in production |
| recorder methods (`AgentTraceRecorder.*`) | public/untrusted, total | the B11.2 `total()`/`safeRead()` boundary |
| `runEvaluationCase` / `runEvaluationSuite` / `buildEvaluationCases` | internal/trusted, documented | consume in-repo authored fixtures; the capsule inside each case is still parsed by `replayCapsule`'s total boundary before anything executes |
| B09/B10 boundaries (`assembleAgentRunContext`, `parseSelectionRef`, `proveAgentNetlist`, `validateAgentNetlistProjection`) | out of B11 scope, noted | in the replay path they receive only registry-owned snapshot data; in the route path they receive `JSON.parse` output, which cannot contain proxies, accessors, or functions by construction |

## Proof

`b11-6-projection-ownership` §B drives **7 hostile families × 15 boundaries =
105 probes** with `not.toThrow()`:

families — revoked, stateful `ownKeys`, stateful `getPrototypeOf`, stateful
`getOwnPropertyDescriptor`, stateful `get`/`length`, stateful `has`, and a
nested hostile (a revoked proxy two levels down inside plain data).

boundaries — the fifteen public functions listed above (both projector entries,
both captured entries, both validators, the capsule pair, trace, the three
scan/capture functions, and the two predicates).

Combined with B11.5's 8 × 10 matrix, every claimed-total boundary now has
stateful-proxy coverage in two independent suites.

## One test-harness finding, recorded

While writing the identity assertions we found that vitest's `toBe(x)` probes
its argument for asymmetric matchers — which itself fires a `get` trap on a
hostile proxy. Assertions that compare against a live proxy therefore use
`Object.is(a, b)` wrapped in `expect(...)`, never the proxy as a matcher
argument. This is a property of the test harness, not of production code, and
is noted so future tests do not reintroduce it.
