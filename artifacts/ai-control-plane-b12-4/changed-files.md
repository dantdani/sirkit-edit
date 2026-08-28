# B12.4 — changed files and symbols

## Modified production modules

| Path | Changes |
| --- | --- |
| `app/lib/engineering/approved-mutation-journal.ts` | §B/§C rewrite: strict total `validateEntry` (closed key sets, patterns, bounds, scope-vs-instance, per-state invariants, receipt/entry coherence via `isReceiptShaped`); document validation (closed keys + `version`); MONOTONIC transitions (`prepare` idempotent-or-refusing, per-transition allowed-predecessor + immutable-field checks, finalize-conflict on differing receipts, poison-from-finalized refused, poison preserves committed identity); CAS-versioned writes (`saveIf` on the store interface, bounded optimistic retries, `conflict`/`invalid-transition` write reasons); both stores implement `saveIf` (localStorage synchronously within one JS turn). Entry/document schema STRINGS unchanged (v1) — stricter reader, no wire change. |
| `app/lib/engineering/approved-agent-mutations.ts` | §A: `RECEIPT_COMMITMENT_SCHEMA` + `receiptCommitmentFor` + `verifyReceiptLinkage` (field-by-field authority: proposal / canonical record / commitment / re-derived after-digest); the normal path chooses `completedAt` BEFORE the commit and binds `{identityKey, originRunId, completedAt}` into the transaction via `provenanceCandidateId`; replay dispositions gate BOTH persisted and reconstructed receipts on full linkage; journal/proposal coherence check at the boundary; legacy (commitment-less) receipt-bearing entries → `recovery-required`. |
| `app/lib/engineering/schematic-session.ts` | new read-only `headProjectionDigest()` (ready-only UI-projection digest of the canonical head); `DurableIdempotencyEvidence.record` gains `provenanceCandidateId`; `SchematicCommandRequest` gains optional `provenanceCandidateId`, threaded into the transaction's `provenance.candidateId` (inside the canonical integrity chain). |
| `app/lib/engineering/project-transition-coordinator.ts` | §D: the hook-failure branch reactivates the SURVIVING incarnation with a fresh ACTIVE interlock (only after the settled retirement barrier, only when no newer request superseded the cycle). |
| `app/lib/project/current.ts` | §E: new `loadProjectRecord` (load without activating), `createProjectRecord` (persist without activating), `markProjectCurrent` (the single pointer-commit primitive); `openProject`/`startNewProject` retained for bootstrap fallback, documented DEPRECATED for transitions. |
| `app/page.tsx` | §E: `switchProject`/`createNewProject`/`handleImportProjectFile` use the non-activating loaders and drop the raw pre-transition `autosaver.flush()` calls (the coordinator's typed `beforeInstall` is the one flush); `installProject` commits the pointer (`markProjectCurrent(record.id)`) as its last act. |

## New tests

| Path | Tests |
| --- | --- |
| `b12-4-receipt-linkage.test.ts` | 6 (R1 exact, systematic 12-field forgery battery, incoherent forgery, healthy byte-identical replay, legacy commitment-less, cross-scope substitution) |
| `b12-4-journal-strictness.test.ts` | 10 (R2 exact, malformed/checksum-valid batteries, state invariants, scope mismatch, totality, R3 exact, idempotent/conflicting prepare, full transition matrix, poison semantics, failed-write intactness) |
| `b12-4-concurrency.test.ts` | 3 (two-tab single-transaction/receipt, CAS retry/exhaustion, monotonic versions) |
| `b12-4-transition-pointer.test.ts` | 6 (R4 end-to-end incl. real apply after failed switch, post-barrier reactivation, R5 exact, superseded pointer, create/import pointer, page source gates) |

## Updated tests

- `b12-3-durable-replay.test.ts` — the injected unavailable store gained the
  now-required `saveIf` member (type completeness only). Every B12.3
  assertion unchanged.
- Three §E pointer tests carry explicit 20 s vitest timeouts (they exercise
  the real `lib/persistence` storage stack; ~2 s standalone, > 5 s default
  timeout under full-suite contention). Assertions unchanged.

## Explicitly NOT changed

The receipt schema (v1, 20 fields), proposal schema (v2), identity schema
(v2), journal schema STRINGS (v1), the executor's duplicate/reference-
mismatch checks, `pcb/types.ts`, the shape descriptor, all B11 pins, the
nine-tool exposure, the chat route/gateway/loop, the interactive channel
and its approved importers, provider configuration. The protected original
`C:\Users\robsa\sirkit` was never touched.
