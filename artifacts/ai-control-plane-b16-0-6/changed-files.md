# B16.0.6 — Changed files

## Analyzer (test-only; imports `typescript`, never in the runtime graph)

`app/lib/auth/__tests__/_boundary-analysis.ts`:

- **§B result contracts**: `UNION_RESULT_TERMINALS` / `BOOLEAN_RESULT_TERMINALS`
  (provenance-keyed), `directTerminalContract`, `boundaryContractOf`
  (+ `contractFromFunctionBody` / `contractOfImportedSymbol`),
  `guardBindingIsAwaited`, `calleeIsAsync`; the awaited-guard and inline-guard
  handling in `analyzeHandlerBody` rewired to require an awaited `.ok` refusal
  for union boundaries and a bare negation for genuine (awaited-if-async) boolean
  boundaries; `unionBindingMatcher` / `booleanBindingMatcher` replace the merged
  matcher; `inlineBoundaryInfo` (with await tracking) replaces `inlineBoundaryGuard`.
- **§C provenance**: the `/^readBounded/` and `/^scoped…Json$/` and bare-name
  reader trust is deleted; `CANONICAL_REQUEST_SINKS` + `resolvesToCanonicalSink`
  (exact module + original symbol).
- **§D fail-closed flow**: `requestFlowViolations`, `safeRequestConsumer`,
  `resolveConsumerFunction` (local / factory-closure / imported), a memoized,
  cycle-rejecting, fixed-point safe-consumer check; `growTaint`/
  `isTaintedRequestExpr` extended for assignment aliases, array containers, and
  destructure-assignment; `directBodyReads` rewritten to report flow violations
  (no depth limit, unresolved ⇒ violation).

## Tests

- `app/lib/auth/__tests__/b16-0-6-analyzer-hardening.test.ts` — NEW; R1–R8 +
  extras + boundary-contract fixtures (union / awaited / boolean / unknown) +
  canonical-provenance (forged prefix, exact-name local, non-canonical module) +
  a deep-chain-converges-safe positive.
- `app/lib/auth/__tests__/b16-0-4-authorization-and-body-gates.test.ts` — the §C
  detection tripwires now assert against the flow-violation reason text (the gate
  reports `flow-violation` + a reason, not an api-name enum); detection is
  unchanged in intent (stronger in fact).
- `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` — the §D test-write
  gate admits the new hardening fixture test via an OS-temp `scratchRoot`
  justification.

## Artifacts / generator

- `artifacts/ai-control-plane-b16-0-6/` — this stage record (13 items).
- `scripts/generate-b16-0-4-artifacts.ts` — re-run post-correction; the auth
  matrix's verdict-detail strings changed (now "→ !a.ok refused (union)" etc.),
  still 121 load-bearing / 32 public / 0 UNBOUNDED; byte-stable ×2; the corrected
  copies are placed in this stage's dir.

## Deleted (disposable)

- `scripts/_b16-0-6-repro.ts` — the pre-edit reproduction probe (outputs in
  [pre-edit-counterexamples.md](pre-edit-counterexamples.md) /
  [post-edit-results.md](post-edit-results.md)).

## Explicitly NOT changed

- Runtime behavior: the B16.0.5 415-before-body-pull, `no-store`, JSON charset
  acceptance, bounded byte/deadline/abort, zero-downstream-on-refusal, wrapper
  raw-Request isolation, and exact wrapper provenance are all untouched — this
  stage only strengthens the STATIC analyzer.
- `C:\Users\robsa\sirkit` — untouched. No route source changed. Exactly 12
  exposed tools, replay pins, authoritative hashes, internal-only release
  preserved.
