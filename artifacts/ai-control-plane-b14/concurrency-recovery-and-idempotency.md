# B14 — concurrency, recovery, idempotency

All through the SHARED B12 primitives (one registry, one journal document,
one interlock, one serialized gateway) — proven in b14-replacement-apply:

| scenario | behaviour |
| --- | --- |
| duplicate Apply | `already-applied` with the SAME receipt (`receiptId` equal); one transaction total |
| concurrent Apply ×2 | exactly one `committed`; the other `already-in-flight`/`already-applied`; `executedCount === 1` |
| crash BEFORE commit (gateway throws) | `command-failed`, claim released, journal untouched beyond `prepared`; retry commits exactly once |
| crash AFTER commit BEFORE receipt (finalize fails) | `recovery-required`; a fresh composition (reload) over the SAME durable journal + canonical evidence reconstructs the byte-identical receipt and finalizes it (`already-applied`) |
| adoption/autosave host failure after commit | POISON (registry + journal) — success never claimed; subsequent applies refuse `identity-poisoned` |
| project switch while queued (`stillCurrent` false) | `session-superseded`, zero mutation |
| project retirement in the critical section | interlock `retired`/lease refusal → `session-superseded`, zero mutation |
| stale head / expired / foreign scope / lineage | `verification-failed` with zero mutation (currency at the serialized head + session-queue recheck) |
| receipt forgery in the durable journal | detected corrupt on lookup → `recovery-required`, never honored |
| journal entry forgery | same |
| reauthorization unavailable | `authority-unavailable`, zero mutation |
| fresh authority changed / target substituted / forged response | recompile digest mismatch → `verification-failed`, zero mutation |

The fresh runtime grant is retired on EVERY terminal path (executor retires
on acceptance; the service's `finally` covers all failure paths; retiring a
retired id is a no-op). Grant registry capacity, single-use, and
serialization inertness are unchanged from B06.2/B13.
