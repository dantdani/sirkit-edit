# B12.4 — authoritative receipt linkage, monotonic replay journaling, and atomic project-transition rollback

> **SUPERSESSION NOTE (B12.5).** Superseded IN PART: the receipt
> linkage, strict validation and monotonic state machine documented here
> remain in force, but the PRODUCTION boundaries around them were
> corrected by B12.5 — the localStorage journal store (pseudo-CAS, R1;
> colliding scope keys, R4) was replaced by an atomic IndexedDB store,
> project activation became transactional after the ignored
> pointer-failure defect (R2), and the transition coordinator's
> settlement loop closed the reentrant leased-interlock abandonment
> (R3). See `../ai-control-plane-b12-5/README.md`. Preserved as
> historical evidence.


Corrective stage over B12.3. Five counterexamples were reproduced pre-edit,
verbatim, in [pre-edit-counterexamples.md](pre-edit-counterexamples.md):

| # | Failure | Closure |
| --- | --- | --- |
| R1 | A checksum-valid MODIFIED receipt (completedAt changed, both public digests recomputed) was returned as the byte-identical original | §A — field-by-field authoritative linkage (proposal + canonical record + chain-protected commitment + re-derived after-digest); unprovable → `recovery-required`, no receipt data |
| R2 | The journal accepted structurally malformed checksum-valid records with no scope/state coherence | §B — strict, total, capture-first validation: closed key sets, exact types/patterns/bounds, scope-vs-instance matching, per-state invariants |
| R3 | `prepare()` downgraded committed/finalized entries to `prepared`, erasing durable receipt inputs | §C — monotonic transitions only; idempotent identical re-prepare; conflicting/downgrading writes fail closed; CAS-versioned documents |
| R4 | A failed switch left the surviving project's interlock RETIRED (mutation capability lost) | §D — post-barrier reactivation with a fresh ACTIVE interlock; a real approved apply works again without a successful switch |
| R5 | `sirkit:currentProjectId` moved at LOAD time — a failed/superseded switch left the pointer on a project that never installed | §E — the pointer commits exactly once, inside the WINNING install; load/create/import never activate |

**A publicly recomputable digest is a consistency checksum, not
authentication** — receipt authority now flows from the captured
authenticated proposal, the canonical durable transaction record (envelope
integrity chain), and a receipt commitment carried INSIDE that record
(`provenance.candidateId` = `sirkit.approved-mutation-receipt-commitment.v1`
over `{identityKey, originRunId, completedAt}`). Receipts whose
non-canonical fields predate the commitment protocol are LEGACY and fail
closed as `recovery-required` — v1 receipts are never silently
reinterpreted.

## Artifacts

| File | Contents |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | R1–R5 verbatim + causes |
| [authoritative-receipt-linkage.md](authoritative-receipt-linkage.md) | §A — the linkage rule, the commitment, legacy dispositions |
| [strict-journal-schema.md](strict-journal-schema.md) | §B — closed key sets, per-state invariants, scope coherence |
| [monotonic-journal-state-machine.md](monotonic-journal-state-machine.md) | §C — legal transitions, idempotency, CAS versioning |
| [concurrent-replay-evidence.md](concurrent-replay-evidence.md) | two-tab evidence: one transaction, one receipt |
| [transition-failure-rollback.md](transition-failure-rollback.md) | §D — reactivation contract |
| [current-project-pointer-contract.md](current-project-pointer-contract.md) | §E — the pointer commit protocol |
| [changed-files.md](changed-files.md) | every changed path and symbol |
| [regression-matrix.md](regression-matrix.md) | every permanent test → requirement |
| [validation-summary.md](validation-summary.md) | gates, counts, hashes, flakes, confidence |
| [final-verdict.md](final-verdict.md) | stop-condition assessment |

## Preserved

Human approval mandatory; `schematic.edit-tier1-apply` unreachable by the
model; exactly nine provider-facing read/propose tools; no MCP/B13/
manufacturing/provider expansion; no provider credits or configuration
changes; B03–B11 gates unweakened; B11 replay pins and authoritative PCB
hashes byte-identical; `C:\Users\robsa\sirkit` untouched.
