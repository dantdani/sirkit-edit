# B15.2.3 — the closed impact-certificate contract

`validateImpactShape` (sealed-pcb-edit-proposal.ts) now validates the
COMPLETE closed impact certificate, aligned with the one authoritative
producer — `compileBoundedPcbEdit` — and still runs BEFORE any digest is
recomputed or trusted.

## Schema

`impact.schema === BOUNDED_EDIT_COMPILE_SCHEMA`
(`sirkit.pcb-bounded-edit-compile.v1`), imported from the producer module —
never "any string".

## Exact key sets (unknown OR missing keys refuse)

- `impact`: schema, changedObjectIds, operationSummaries, drc, connectivity,
  routingCompletion, readiness, ruleChanges, affectedNetIds, affectedLayers,
  candidateBoardDigest, warnings.
- `impact.drc`: beforeErrors, afterErrors, beforeWarnings, afterWarnings,
  newViolationIds, resolvedViolationIds.
- `impact.connectivity`: beforeRoutedNets, afterRoutedNets, beforeTotalNets,
  afterTotalNets, beforeUnrouted, afterUnrouted, beforeShorts, afterShorts.
- `impact.routingCompletion`: beforePercent, afterPercent, delta.
- `impact.readiness`: state, reason — with `state === "unavailable"` exactly
  (the compiler never certifies fabrication readiness, B15.1 §F) and a
  bounded non-empty reason.

## Numeric contracts

- Every count is a finite, SAFE, nonnegative integer (NaN, ±Infinity,
  fractions and negatives refuse).
- `routed ≤ total` on both sides; `beforeUnrouted === beforeTotalNets −
  beforeRoutedNets` and `afterUnrouted === afterTotalNets − afterRoutedNets`
  (exact on safe integers).
- Percentages are finite within 0–100 (the producer emits
  `Math.round(x·1000)/10` — one-decimal values; integrality is deliberately
  NOT required).
- `delta` is finite, within ±100, and EXACTLY `afterPercent − beforePercent`
  — the producer's own IEEE-754 subtraction, which is deterministic, so
  recomputing it from the sealed operands reproduces the sealed value
  bit-for-bit. (For percents already proven within 0–100 the equality
  subsumes the ±100 range; the range check remains as an independent guard.)
- Every `affectedNetIds` entry is a finite, safe, NONNEGATIVE integer —
  nonnegative (not strictly positive) because board-sourced net ids can be 0
  (unassigned copper) on producer paths that read `existing.netId`.

## Bounds — exported by the PRODUCER

`BOUNDED_EDIT_IMPACT_LIMITS` (bounded-edit-compiler.ts) so the verifier can
never invent its own contract:

- `maxArrayEntries = maxOperations × maxArrayLength × 4 = 4096` — the
  largest genuine impact array is `ruleChanges`: one line per (net,
  requested field) for `set_net_class_rule`, 16 ops × 64 net ids × 4 rule
  fields. Every other array is far below (changedObjectIds and
  operationSummaries add exactly one entry per operation).
- `maxTextLength = 1024` — the longest genuine impact string is a
  `set_net_class_rule` summary joining up to 64 net ids (≈620 chars);
  DRC violation ids are `drc_` + 8 hex; the readiness reason is a fixed
  sentence.

Array lengths are validated BEFORE any element is read (`boundedSnapshot`):
a proxy that lies about its `length` can never drive unbounded iteration,
and per-entry checks run on the snapshot.

## Per-entry contracts

- `changedObjectIds`, `newViolationIds`, `resolvedViolationIds`,
  `affectedLayers` entries: the bounded identifier contract (≤128 chars,
  `/^[A-Za-z0-9][A-Za-z0-9._:-]*$/`).
- `operationSummaries`, `ruleChanges`, `warnings`, `readiness.reason`:
  bounded non-empty strings (≤1024).
- `affectedNetIds` entries: the numeric contract above.
- `candidateBoardDigest`: a bounded digest string; its EQUALITY with the
  top-level `candidateDigest` is preserved unchanged at its existing later
  position in `verifyInner`.

## Producer-canonical order — and NO invented order

The producer emits set-derived arrays as `[...set].sort()`, so these must be
STRICTLY ascending (which is simultaneously the uniqueness check):

- `changedObjectIds`, `newViolationIds`, `resolvedViolationIds`,
  `affectedLayers` — lexically (UTF-16 code-unit order, i.e. the default
  `Array.prototype.sort`);
- `affectedNetIds` — numerically.

`operationSummaries`, `ruleChanges` and `warnings` keep SUBMITTED order —
semantically meaningful (per-operation order) — and are never sort-checked.
A permanent test proves a genuine proposal whose summaries are lexically
DESCENDING still verifies. `operationSummaries` must carry exactly one line
per sealed operation (the producer pushes exactly one per operation across
all 13 operation kinds).

`affectedLayers` board MEMBERSHIP is deliberately not checked here: it needs
the LIVE board and is enforced at compile time and again at the serialized
apply position.

## Totality

Validation of the impact remains total under the existing exception
boundary: revoked proxies, throwing getters/ownKeys traps, cycles, sparse
arrays (holes fail the per-entry contract), hostile arrays and proxy-backed
nested objects all REFUSE — never throw, never hang (the lying-length case
is bounded by the length-first snapshot).

## Architectural statement (unchanged)

The proposal digest remains an INTEGRITY CHECKSUM — never authenticity,
never mutation authority. Human approval capability and live
reauthorization remain the authority; the apply path recompiles from the
live board and byte-matches digests. B15.2.3 closes a STRUCTURAL fail-open
hole in front of the checksum; it does not turn the checksum into a
signature.
