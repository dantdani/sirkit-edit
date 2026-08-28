# B12.5 — failure and recovery matrix

Every new failure edge introduced or re-specified by B12.5, with its
proven disposition. (The B12.3 crash-window matrix and the B12.4 receipt
linkage dispositions are unchanged and remain in force.)

## §A — atomic journal boundary

| Failure | Disposition | Proven by |
| --- | --- | --- |
| Two contexts `saveIf` from the same expected version | engine-serialized: exactly ONE true; the loser writes NOTHING | b12-5-journal-atomicity (R1 closure) |
| Version conflict | `false`, nothing written; journal retries only from freshly loaded state | atomicity suite |
| Retry exhaustion (live contention every attempt) | typed `conflict` refusal; durable state untouched | atomicity suite |
| Quota failure mid-transaction | transaction aborts; last committed document intact; journal → typed `unavailable` | atomicity suite |
| Aborted transaction AFTER a successful put | nothing commits; prior document intact | atomicity suite |
| IndexedDB unavailable / open failure | throws `JOURNAL_STORAGE_UNAVAILABLE` → journal `unavailable` → apply `recovery-required`; NO localStorage fallback (proven with a planted legacy record) | atomicity suite |
| Illegal scope id (Unicode/empty/oversized/bad first char) | `JOURNAL_SCOPE_INVALID` BEFORE key derivation; storage never opened; journal fails closed | scope-identity suite |

## §B — legacy migration

| Case | Disposition | Proven by |
| --- | --- | --- |
| Owned legacy record | imported once (put-if-absent txn); legacy removed only after durable confirmation, and ONLY by the context that performed the put | scope-identity suite |
| Collision victim reads the shared legacy key | `foreign` → absent for that scope; record untouched for its owner | scope-identity suite |
| Corrupt / unparseable / mixed-scope / duplicate-identity legacy | surfaced as the raw STRING → document-level `corrupt` for EVERY identity and claimant; lookups AND writes refuse `corrupt` (never `conflict`); never imported, never deleted, deterministic | scope-identity suite (incl. journal-surface tests for both claimants + duplicate identity) |
| Empty legacy document | absent; nothing imported; record untouched | scope-identity suite |
| Import transaction fails | legacy record preserved; next load retries; nothing half-migrated | scope-identity suite |
| Two contexts migrate concurrently | exactly one import; both converge | scope-identity suite |
| Legacy layer transiently unreadable | not settled — retried on a later load (an importable record is never skipped) | code path (`migrateLegacy` catch) |

## §C — transactional activation

| Failure | Disposition | Proven by |
| --- | --- | --- |
| PREPARE phase throws | typed pre-commit `transition-failed`; pointer unwritten; zero visible change; survivor operational | activation suite |
| Pointer write throws | typed pre-commit failure (R2 closure): never `installed`; visible A; persisted A; survivor reactivated with a fresh ACTIVE interlock | activation suite |
| Pointer write accepted but dropped | caught by read-back → same pre-commit failure | activation suite |
| COMMIT phase throws (contractually no-throw; guarded anyway) | `transition-failed { recovery: true }` → non-dismissible blocking recovery dialog; target incarnation RETIRED (leases refuse); NO survivor-installed claim; the pointer already names the target, so the recovery reload bootstraps IT from durable state — pointer and recovery target agree | activation suite + coordinator suite |
| Bootstrap storage entirely unavailable | `bootstrapCurrentProject` throws → page enters blocking activation recovery (no phantom workspace) | page source gate |
| Bootstrap pointer write refused (fallback/create paths) | `pointerPersisted: false` → surfaced by toast, never swallowed | activation suite |

## §D — reentrant settlement

| Scenario | Disposition | Proven by |
| --- | --- | --- |
| Failed-outcome callback leases the reactivated interlock, requests C | C PENDS until that exact lease releases; `transitionPending` true throughout; the leased interlock stays reachable as `currentInterlock()` | settlement suite (R3 closure) |
| Request from any outcome callback (failed/superseded/installed) | consumed by the next loop iteration as a NORMAL cycle (barrier + hook + typed install); exactly one terminal outcome | settlement suite |
| Typed pre-commit install failure | target incarnation retired (leaked leases awaited); survivor reactivated fresh-ACTIVE | settlement suite |
| Thrown install (unknowable progress) | blocking recovery: recovery-flagged outcome; RETIRED target incarnation stays live; leases refuse; coordinator stays mechanically usable for recovery-driven rehydration | settlement suite |
| `cancelPending` during a mid-cycle barrier wait | PRE-cancel targets superseded exactly once; a POST-cancel request (StrictMode remount) proceeds normally; a cancel-only cycle reactivates the survivor with a fresh ACTIVE interlock | settlement suite |
| A request from a cancel-dropped (or installed) outcome callback | consumed by the running cycle — never stranded with zero outcomes | settlement suite |
| Hostile hook/install outcome objects (throwing getters) | snapshotted to typed failures inside the guard — one outcome, no unhandled rejection | settlement suite |
| `dispose` with a pending request / during a failing hook | the dropped request still receives its ONE terminal outcome (superseded); no fresh leaseable interlock is ever minted after permanent shutdown | settlement suite |
| PCB view mounts on a salvaged (strict-load-failing) current project | scope resolved from the SALVAGED record; the pointer is never written by PCB persistence (activation is the page install's alone) | activation suite + pcb-sync-authority re-pin |
| Any of the above | ZERO unhandled promise rejections (process-level capture across the whole suite) | settlement suite |
