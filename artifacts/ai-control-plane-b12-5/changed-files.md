# B12.5 — changed files

## Production

| File | Change |
| --- | --- |
| `app/lib/engineering/approved-mutation-journal-idb.ts` | **NEW** — `IndexedDbApprovedMutationJournalStore` (atomic saveIf in one readwrite transaction; injective `[tenant, project, branch]` array keys; bounds validation before key derivation; fail-closed one-shot legacy migration), `legacyLocalStorageJournalKey`, `LEGACY_LOCAL_STORAGE_JOURNAL_PREFIX`, `LegacyJournalStorage`, `IndexedDbJournalStoreOptions` |
| `app/lib/engineering/approved-mutation-journal.ts` | `save` REMOVED from `ApprovedMutationJournalStore` and `InMemoryApprovedMutationJournalStore` (every production write passes through the CAS); `BrowserLocalStorageApprovedMutationJournalStore` REMOVED (R1/R4); new exports `APPROVED_MUTATION_JOURNAL_MAX_SERIALIZED`, `journalDocumentVersion`, `isValidJournalScopeId`, `classifyLegacyJournalDocument` + `LegacyJournalClassification`; header rewritten to state the real atomicity requirement. Validation, state machine, schema strings: UNCHANGED |
| `app/lib/engineering/project-commit-interlock.ts` | additive `retirementSettled` getter (settled vs merely-retiring) |
| `app/lib/engineering/project-transition-coordinator.ts` | completion loop rewritten as the §D settlement loop (`advance()`): per-winner retirement barrier with full-settlement await; typed `ProjectInstallResult` installs; §C failure semantics (pre-commit → survivor reactivation; recovery/thrown → blocking recovery with retired non-replaced incarnation); outcome-callback reentry re-consultation everywhere; `dispose()` reports the dropped request; `ProjectTransitionOutcome` gains optional `recovery` on `transition-failed` |
| `app/lib/project/current.ts` | `markProjectCurrent` returns typed `MarkProjectCurrentResult` with read-back verification and already-current skip; `ProjectBootstrap` gains `pointerPersisted`; `bootstrapCurrentProject`/`openProject` report pointer persistence truthfully |
| `app/page.tsx` | `installProject` restructured into the three-phase activation protocol (typed result); journal store swapped to `IndexedDbApprovedMutationJournalStore`; hydrate outcome handler routes `recovery` to blocking activation recovery; bootstrap guarded (unavailable storage → blocking recovery; unpersisted pointer → toast); new `activationRecovery` state + non-dismissible recovery dialog; success announce moved to the commit phase's final act |
| `app/lib/pcb/board-persistence.ts` | [adversarial closure] `ensureCurrentProjectScope` and `saveCurrentBoard` no longer write `sirkit:currentProjectId` — activation belongs exclusively to the page's transactional install; record existence checked with the SALVAGE loader so a salvaged current project is honored instead of being shadowed by a minted phantom |
| `package.json` / `pnpm-lock.yaml` | dev-only `fake-indexeddb@6.2.5` (justification in [README.md](README.md)) |

## Tests — new (45 permanent tests, 4 files)

| File | Tests |
| --- | --- |
| `b12-5-journal-atomicity.test.ts` | 9 — R1 closure, conflict/retry-from-fresh, different-identity no-lost-entry, same-identity convergence, unavailability without fallback, quota, abort, exhaustion, two-tab full apply with BOTH durable layers on production IndexedDB stores |
| `b12-5-scope-identity.test.ts` | 11 — R4 closure, adversarial injectivity sweep, bounds-before-derivation, owned migration, collision-victim authority, corrupt determinism, mixed-scope corrupt for both claimants AT THE JOURNAL SURFACE, duplicate-identity corrupt, empty classification, failed-import preservation, concurrent migration |
| `b12-5-transactional-activation.test.ts` | 11 — R2 closure, dropped-write read-back, prepare-phase failure, commit-phase blocking recovery, pointer-write counts, bootstrap truthfulness, PCB no-pointer-write source gate + behavioral closure, page source gates ×3 (incl. final-act announce ordering) |
| `b12-5-reentrant-settlement.test.ts` | 14 — R3 closure, normal-cycle reentry, installed-callback reentry, pre-commit reactivation, thrown-install recovery, leaked-lease settlement, cancel/remount, dispose, plus six adversarial closures (post-cancel request survival, cancel-only survivor reactivation, cancel-dropped-callback reentry, installed-callback cancel+request, hostile hook outcome, dispose-during-hook) — under a zero-unhandled-rejection capture |

## Tests — updated (all strictly stronger or interface-following)

| File | Change |
| --- | --- |
| `b12-3-durable-replay.test.ts` | unavailable-store stub: removed the now-nonexistent `save` member (interface follows the bypass removal; assertions unchanged) |
| `b12-4-concurrency.test.ts` | two wrapper stores: removed `save` delegation (same; assertions unchanged) |
| `b06-2-authority-hydration.test.ts` | gate 19 re-pin: now asserts the transition-failed guard AND the recovery routing (`setActivationRecovery`) — strictly more than the old single-string pin |
| `b07-4-project-async-scope.test.ts` | T1+T22 gate re-pin: same strengthening |
| `app/components/pcb/__tests__/pcb-sync-authority.test.tsx` | legacy-import fixture re-pinned to the §C contract: the current project is activated via `markProjectCurrent` and the test now ADDITIONALLY asserts `saveCurrentBoard` does not repoint (strictly more) |

All other B12/B12.1/B12.2/B12.3/B12.4 suites run byte-unchanged.
