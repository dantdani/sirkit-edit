# B16.0.22 §A — pin-suite summary (59 pins)

`app/api/__tests__/b16-0-22-tranche-parity.test.ts` — run GREEN against the
RAW handlers first (56/59 first run; 3 expectation errors corrected to
observed reality — see
[pre-edit-counterexamples.md](pre-edit-counterexamples.md) — then 59/59),
then 59/59 after migration with 57 pins byte-unchanged and 2 documented
supersessions.

| block | pins | covers |
|---|---|---|
| policy rows | 1 | exact role sets + CSRF flags for all 8 methods |
| shared POST refusals | 5 × it.each(4) = 20 | 401/foreign/revoked (zero domain work), viewer+commenter 403, production cross-origin zero-pull 403, 415, one-byte-over 413 per family ceiling |
| §C assignment-queue | 7 | 503 off-gate, list envelope + limit clamp, item-null contract, forbidden keys (exact generic envelope), declared-length 413 zero-pull, request-required/op-unsupported, commit double-gate, scope forcing |
| §D footprint-resolution | 4 | input floors, scope+schema forcing + AbortSignal threading, batch/compare floors, 408 cancellation |
| §E GET surfaces | 6 (incl. it.each(4)) | GET auth classes, passive-policy doc (off + opt_in), pcb-sync doc + board 404 + unknown-field/invalid-id + duplicate-key supersession |
| §F physical-bindings | 7 | setId floor (no repo read), 404/foreign-403, role-gated redaction, create floors + actor forcing + idempotency, op floors, migration admin gate, foreign transition blocked pre-service |
| §G replacement-authority | 8 | byte-exact legacy envelopes (413/408/400×3), key/scope/nonce/id refusals verbatim, 503 no-source (loader uncalled), nonce echo + trusted-scope binding, optional-scope omission |

Seams: prototype spies (`AssignmentQueueService`, `FootprintResolutionService`,
`PhysicalBindingService`, `PostgresPhysicalBindingRepository`,
`DurablePcbSyncRepository`, `DurableAssignmentQueueRepository`), pass-through
module spies (`loadRunComponentAuthority`,
`createPhysicalBindingCandidate`), `setComponentAuthoritySourceFactory`, env
stubs for feature flags and production CSRF, counting ReadableStreams for
zero-pull proofs. Zero providers/processes/network/DB.
