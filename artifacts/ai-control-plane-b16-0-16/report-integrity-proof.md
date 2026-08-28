# B16.0.16 §D — Report integrity proof (CONFIRMED / by construction)

`/report` migrated to the wrapper; its integrity logic is byte-identical
(covered by the standing calculation domain suite, green).

## Digest verification preserved (unchanged code)

Before `materializeCircuitCalculationReport` runs, the callback verifies:

1. **problem binding** — `graph.problemRevisionId === problem.problemId`;
2. **graph digest** — `graph.deterministicDigest === calculationDigest({ …graph, deterministicDigest: undefined })`;
3. **node digests** — every `graph.nodes[i].deterministicDigest` recomputed;
4. **result / margin / coverage digests** — every certificate's
   `deterministicDigest` recomputed via `calculationDigest`;
5. **scope** — `problem.projectId/branchId === scope.projectId/branchId` and
   `validateCircuitCalculationProblem(problem).length === 0`.

Any mismatch → 422 (`derivation graph integrity or problem binding failed` /
`result, margin, or coverage certificate integrity failed` / `calculation
problem integrity or scope failed`). **No unverified numeric result can enter
the report.**

## Materialization

`materializeCircuitCalculationReport` receives the verified problem, graph,
selected values, results, margins, coverage, solver certificates, unresolved
model report ids, downstream verification obligations, fixed-point evidence, and
the **server-derived actor** (`{ actorId: scope.actorId, actorKind, sessionId,
role }`). Fixed-point evidence and downstream obligations are passed verbatim.

## Boundary

Auth/CSRF/media/body all precede the digest checks (wrapper). A boundary
refusal never reaches materialization. Foreign-scope content → 422 before any
report is produced.
