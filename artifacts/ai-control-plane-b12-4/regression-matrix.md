# B12.4 — regression matrix

25 new permanent tests across four files; the complete B12 family (14
files, 120 in-family tests) green. Mapped to the stage's required list:

| Required coverage | Where |
| --- | --- |
| 1. R1–R5 exactly | receipt-linkage test 1 (R1); journal-strictness test 1 (R2) and "R3 exactly"; transition-pointer tests 1 (R4) and "R5 closure" |
| 2. Every legal and illegal journal transition | journal-strictness "every illegal transition…" (full matrix incl. finalize-conflict and poison-from-finalized) |
| 3. Unknown/missing keys and malformed nested values | journal-strictness "checksum-valid malformed entries…" (14 cases) |
| 4. Checksum-valid malformed entries | same suite (every case reseals the checksum) |
| 5. Entry scope mismatch | journal-strictness "entry scope must match…" + receipt-linkage cross-scope substitution |
| 6. Receipt/proposal mismatch per material field | receipt-linkage systematic battery (12 fields, coherent-forgery form) |
| 7. Receipt/journal/canonical-record disagreement | receipt-linkage incoherent-forgery + b12-3 disagreement tests (still green) |
| 8. Finalized-entry prepare downgrade refusal | journal-strictness R3 + "poison preserves…" (prepare-after-poison) |
| 9. Two independent concurrent compositions | concurrency test 1 (+ CAS tests) |
| 10. Crash/reload behavior for every B12.3 window | `b12-3-durable-replay.test.ts` re-run green under B12.4 (9/9) |
| 11. Failed switch restores active mutation capability | transition-pointer R4 test (real end-to-end apply after the failure) |
| 12. Failed and superseded switch/create/import leave the pointer unchanged | transition-pointer R5 + superseded + create/import tests |
| 13. Successful switch/create/import update the pointer once, after installation | superseded test (write-count = exactly one) + create/import success leg |
| 14. No duplicate transaction/adoption/history/receipt/outcome | concurrency test 1 (tx=1, receipts identical); §D test (one outcome, one history entry per apply); B12.2 §C suite (still green) |
| 15. No unhandled rejection | b12-3-reentrant suite's process-level capture (re-run green) + §D/§F caught paths |

All 95 pre-existing B12/B12.1/B12.2/B12.3 tests run UNCHANGED in strength
(the only edits: one type-completeness member on an injected store stub and
three explicit vitest timeouts — no assertion weakened, none replaced with
shape assertions).
