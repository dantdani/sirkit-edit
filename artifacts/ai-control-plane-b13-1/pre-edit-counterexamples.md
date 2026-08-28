# B13.1 — pre-edit counterexamples (verbatim)

Reproduced against current B13 code before any edit with a disposable
probe (`app/lib/engineering/__tests__/__b131probe__.test.ts`, deleted
after capture; run: `6 passed`).

```
B13.1 R1 OBSERVED: resolvedSource=null
B13.1 R3 OBSERVED: writer=board:proj-b131 chatRead=proj-b131:main equal=false
B13.1 R4 OBSERVED: status=loaded exactAuthorityMinted=true
B13.1 R5 OBSERVED: symbol=sym-BINDING mpn=MPN-BINDING (snapshot never cross-checked)
B13.1 R6 OBSERVED: stateWithoutExactAuthority=verified-exact
B13.1 R7 OBSERVED: nullAtDeadline=true sourceKeptRunning=true
```

- **R1** — `resolveComponentAuthoritySource` returns `null` in the normal
  runtime: `sourceFactory` defaults to null and no production code calls
  `setComponentAuthoritySourceFactory`.
- **R2** — activation exists only through injection: a test can wire the
  source, but an ordinary production chat request cannot obtain it
  (corollary of R1; the route path is exercised only when a setter ran).
- **R3** — board identity mismatch: the physical-binding writer
  (PcbEditor `syncIdentity`, and its `bind_atomic_selection` call) uses
  `board:${projectId}`; the B13 chat route queried
  `${projectId}:${branchId}`. A binding written in production could never
  be found by the B13 read path.
- **R4** — invalid durable records accepted: the loader never called
  `validatePhysicalBinding`/`validateBindingSet`, so a binding with a
  TAMPERED `recordDigest`/`technicalDigest` still projected and minted
  `exactAuthority`.
- **R5** — atomic confirmation insufficient: the confirmer returned only
  `{atomicPartRevisionId, published}`, so binding-controlled
  symbol/footprint/mapping/MPN/manufacturer identities entered
  `exactAuthority` with NO cross-check against the published
  `PortableAtomicSnapshot` (`symbol=sym-BINDING`, `mpn=MPN-BINDING` were
  accepted unverified).
- **R6** — misleading classification: `inspectComponentAuthority`
  classified a record with clean facets but NO `exactAuthority` as
  `verified-exact`.
- **R7** — the deadline did not cancel work: `loadRunComponentAuthority`
  returned null at the deadline while the underlying source kept running
  to completion (`sourceKeptRunning=true`) — no `AbortController`, no
  cancellation.
- **R8** — provider parity was not actually tested: the B13 test drew both
  "provider" declarations from the SAME `buildRunToolset` call and merely
  instantiated the adapters, so no real OpenAI/Anthropic adapter
  transformation was compared. (Meta-defect in the test; closed by a real
  parity test in B13.1.)
