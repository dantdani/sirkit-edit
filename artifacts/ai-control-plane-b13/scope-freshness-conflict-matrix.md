# B13 — scope / freshness / conflict matrix

Every loader disposition, proven in `b13-component-authority-bridge.test.ts`.

| Durable input | Loader disposition | Exact authority? | Test |
| --- | --- | --- | --- |
| Fully verified selection, atomic revision confirmed published | record with complete `exactAuthority`; inspector → `verified-exact` | YES | #1 |
| No aggregate for the component | no record emitted; inspector → `unknown` | — | #2 |
| Selection with `freshness: stale` | record `freshness: stale`; inspector → `stale` | no | #3 |
| Selection with `approval` not `approved` | record `approval` reflected; not `verified-exact` | no | #4 |
| Selection with `footprint.availability` not `available` | record `footprintAsset` reflected | no | #5 |
| Selection with `pinPadMapping.state` not `verified` | record `mappingVerification` reflected | no | #6 |
| Verified selection, atomic revision NOT confirmed published | facets truthful, but no exact authority | no | #6b |
| Two aggregates for one component | record `conflict: present`, NEVER merged; inspector → `conflicted` | no | #7/#8 |
| Foreign tenant / project / branch / board aggregate | DROPPED — never enters the records | — | #9 |
| Durable binding source throws (DB down/timeout) | whole load `unavailable` (fail closed) | — | #11 |
| Atomic confirmer throws | whole load `unavailable` (fail closed) | — | (resolveExactAuthority) |
| Load exceeds the deadline | `loadRunComponentAuthority` → null (withhold) | — | #12 |
| Aborted signal | `unavailable` | — | #12b |
| Envelope pinned to a different canonical revision | `consumeReplacementAuthority` → `wrong_revision` | — | #10 |

Ordering is deterministic (records sorted by `componentId`); output is
bounded (`MAX_AUTHORITY_COMPONENTS`); no partial verified set is ever
emitted on failure. Foreign-scope defence is applied twice: on the
aggregate's set scope and again on the selected binding's own scope.
