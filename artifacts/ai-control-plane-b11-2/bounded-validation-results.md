# B11.2 §E — hard trace bounds

> **UNCHANGED BY B11.3, and re-proven.** The total recorder boundary and the
> hard trace bounds are untouched by B11.3; their suites remain green.

Closes **R6**.

## Bounds added

```ts
export const TRACE_BOUNDS = Object.freeze({
  // … B11/B11.1 bounds unchanged …
  maxValidationIssues: 12,        // B11.1
  maxRecorderDiagnostics: 16,     // B11.2
  maxSerializedChars: 1_000_000,  // B11.2
  maxScanNodes: 20_000,           // B11.2
  maxScanDepth: 32,               // B11.2
});
```

`REPLAY_CONTEXT_BOUNDS` adds the same discipline to the fixture contract:
`maxSerializedChars` 1 000 000, `maxDepth` 24, `maxNodes` 100 000,
`maxStringChars` 20 000, `maxArrayEntries` 20 000, `maxIssues` 12.

## Order is the point

R6's defect was not the absence of a number — it was that the work happened
**before** any check. `validateAgentRunTrace` now reads:

```ts
if (!Array.isArray(diagnostics)) issues.push("…must be an array");
else if (diagnostics.length > TRACE_BOUNDS.maxRecorderDiagnostics) {
  // checked BEFORE any scanning or Set construction
  issues.push(`trace.recorderDiagnostics: at most ${…} entries`);
} else {
  // vocabulary scan + uniqueness Set only inside the bound
}
```

The regression asserts the ordering observably: a 50 000-entry array yields
**exactly one** issue — the length bound — proving neither the
`Array.prototype.some` vocabulary scan nor the `Set` construction ran.

`maxRecorderDiagnostics = 16` sits just above the closed vocabulary size
(10), so an honest recorder can never reach it; the regression pins that
relationship so a future vocabulary addition cannot silently outgrow the
bound.

## Total document size and traversal work

* Serialized size is bounded at 1 000 000 characters and checked before the
  serialized secret scan.
* `findSecretShapedPath` carries a shared node budget and a depth counter.
  Exceeding either short-circuits with a single bounded issue
  (`exceeds the maximum scannable node count` / `exceeds maximum scan
  depth`), never a partial or unbounded walk. Both limits are proven by
  direct regressions (a `maxScanNodes + 10`-key object and a
  `maxScanDepth + 5`-deep chain).
* `validateReplayContext`'s `walkDiscipline` carries the same budget/depth
  discipline over the fixture.

## Validator output stays bounded

`maxValidationIssues = 12` (B11.1) is preserved and re-asserted: a hostile
document with an oversized warning produces a bounded issue list. Every loop
in the validator and in both scanners short-circuits on the issue cap, the
node budget, or the depth limit, so no input can drive unbounded work or
unbounded output.

## Measured safely

Every bound was exercised with a **safe test size** (50 000 entries,
~1.2 MB of warning text, 20 010 keys, depth 37). No resource-exhaustion
condition was created at any point.
