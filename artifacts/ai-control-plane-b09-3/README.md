# B09.3 — Lineage Integrity, Semantic Provider-Schema Validation, and Control-Plane Truth Closure

Corrective stage over B09.2. Independent verification found four additional
boundary/truth gaps after B09.2's seven counterexamples were closed; all
four were reproduced pre-edit, closed in production code, and are permanent
regression tests in `app/lib/agent/__tests__/b09-3-closure.test.ts` (19
tests).

## Documents

| Document | Section | Content |
| --- | --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | — | Exact R1–R4 reproduction outputs captured BEFORE any edit |
| [lineage-integrity-results.md](lineage-integrity-results.md) | A | Lineage sealed into actor/discovery context integrity |
| [provider-schema-semantic-validation.md](provider-schema-semantic-validation.md) | C | Semantic (not merely container-shape) schema validation |
| [registered-resource-path-results.md](registered-resource-path-results.md) | B | Snapshot bypass removed; reads return to the registered boundary |
| [catalog-runtime-truth.md](catalog-runtime-truth.md) | D | Catalog/manifest runtime truth + CI tripwires |
| [validation-summary.md](validation-summary.md) | — | Full battery counts, UNKNOWNs, B10 readiness |

## Invariants after B09.3

- **Lineage is part of context integrity.** Discovery carries the VALIDATED
  schematic head mark's lineage (empty without one); the stored mark is
  revalidated inside `verifyAgentContextIntegrity`; a foreign lineage, a
  mark with an empty discovery lineage, a lineage without a mark, or a
  post-assembly-tampered mark all refuse `context_integrity` on every
  gateway path (reads, proposals, direct invocations) before execution.
  Digest domains stay separate: canonical project revision, schematic-state
  digest, and session head digest are never equated.
- **The proposal descriptor is truthfully lineage-gated.**
  `sirkit.schematic.propose-tier1-edit` declares `requiresLineage: true`
  (and keeps `requiresExpectedRevision: true`) — discovery itself excludes
  it (`lineage_required` / `revision_required`) when the anchors are absent.
- **No fictitious resource, no read bypass.** `invokeSchematicSnapshot` and
  every claim of a `…schematic-snapshot-resource…` are gone. Without a
  complete validated canonical project resource, EVERY read — schematic
  inspection included — is withheld from the toolset and refuses
  `authority_unavailable` at the gateway. The only read path is the
  registered B05/B05.1 `ReadToolInvocationService` boundary. A zero-tool
  conversational run is a truthful outcome.
- **Provider schemas are semantically valid.** A parameters root must be an
  explicit object schema; keyword value types, type/keyword compatibility,
  type-array discipline (one non-null base + optional null), finite
  JSON-safe enum/const values checked against the declared type, no
  unconstrained empty schemas, no meaningless combinations (anyOf with
  sibling constraints, enum+const). Validated before AND after
  normalization; the source is never mutated; all eight exposed schemas
  render deterministically for both providers.
- **Generated truth matches runtime.** Manifest v2 distinguishes static
  exposure from per-run availability; pre-B10 browser runs (no board in the
  chat request) are recorded as: all canonical reads withheld, proposal
  conditional on validated schematic + head mark, otherwise zero tools. CI
  tripwires fail on the confirmed stale phrases; the sourceEvidence gate is
  preserved.

The static exposed registry remains exactly EIGHT tool ids. No B10 board
bridge, no autonomous mutation, no live provider credits required.
