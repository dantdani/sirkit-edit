# B12.3 — changed files and symbols

## New production modules

| Path | Contents |
| --- | --- |
| `app/lib/engineering/approved-mutation-journal.ts` | §A — `ApprovedMutationJournal` (lookup/prepare/markCommitted/markAdopted/finalizeReceipt/poison; capture-first integrity-verified loads; bounded documents), `ApprovedMutationJournalStore`, `InMemoryApprovedMutationJournalStore`, `BrowserLocalStorageApprovedMutationJournalStore`, schemas `sirkit.approved-mutation-journal.v1` / `…journal-entry.v1`, `ApprovedMutationJournalState` |

## Modified production modules

| Path | Changes |
| --- | --- |
| `app/lib/engineering/schematic-session.ts` | §D — new read-only `durableIdempotencyEvidence(clientOperationId)` + exported `DurableIdempotencyEvidence` type (envelope integrity-chain verification, exact-id lookup, owned bounded metadata). No other change. |
| `app/lib/engineering/approved-agent-mutations.ts` | §B/§C/§E — `journal: ApprovedMutationJournal` and `stillCurrent(): boolean` REQUIRED; §E pre-flight live-authority check (ready session, current scope, non-retiring interlock, live scope match) now guards EVERY path including consumed/durable lookups; the durable journal + evidence lookup with the exact-match bypass runs BEFORE current-head enforcement; journal state transitions woven through the normal path (prepare → markCommitted → markAdopted → finalizeReceipt-before-success); receipts' `completedAt` = journal `committedAt` (deterministic reconstruction); new refusal code `recovery-required`; new helpers `evidenceMatchesProposal`, `reconstructReceiptFromJournal` (module-private). |
| `app/lib/engineering/project-transition-coordinator.ts` | §F — reentrant-safe completion loop (latest re-consulted after every synchronous window; `transitionPending` true through hook+install; superseded just-installed incarnations retired exactly once); `beforeInstall` typed (`BeforeInstallOutcome`); `request(install, onOutcome?)` with `ProjectTransitionOutcome` (`installed`/`superseded`/`transition-failed`); teardown checkpoints; no unhandled rejections. |
| `app/page.tsx` | journal store ref (`BrowserLocalStorageApprovedMutationJournalStore`) + per-apply scoped `ApprovedMutationJournal` passed as required; typed `beforeInstall` flush (try/catch → `{ok}`); `hydrateProject` passes an outcome callback that toasts `transition-failed`. |

## Updated tests (strengthened)

| Path | Changes |
| --- | --- |
| all 8 prior B12-family suites | required `journal` (in-memory store instances) + `stillCurrent` at every apply call site |
| `b12-1-lifecycle-interlock.test.ts`, `b12-1-production-integration.test.ts` | explicit microtask flushes so the apply's pre-queue durable lookups complete before the scenario's invalidate/begin (assertions unchanged) |
| `b06-2-authority-hydration.test.ts` (19), `b07-4-project-async-scope.test.ts` (T1+T22) | hydration gates re-pinned to the outcome-reporting `request(...)` shape (`transition-failed` toast asserted) |

## New tests

| Path | Tests |
| --- | --- |
| `app/lib/engineering/__tests__/b12-3-durable-replay.test.ts` | 9 |
| `app/lib/engineering/__tests__/b12-3-reentrant-transition.test.ts` | 7 |

## Artifacts

- NEW `artifacts/ai-control-plane-b12-3/` (11 documents).
- Supersession notes added to: `ai-control-plane-b12/concurrency-and-idempotency-matrix.md`,
  `ai-control-plane-b12/scope-hydration-recovery-matrix.md`,
  `ai-control-plane-b12-2/README.md`,
  `ai-control-plane-b12-2/project-transition-state-machine.md`,
  `ai-control-plane-b12-2/validation-summary.md` (history preserved).

## Explicitly NOT changed

`app/lib/pcb/types.ts`, `pcb-shape-descriptor.ts`, all B11 replay
pins/artifacts, the nine-tool exposure, the executor's duplicate/
reference-mismatch checks, the receipt/proposal/identity schemas, the
interactive channel and its four approved importers, provider
configuration. The protected original `C:\Users\robsa\sirkit` was never
touched.
