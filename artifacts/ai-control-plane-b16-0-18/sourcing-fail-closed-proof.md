# B16.0.18 §F — Sourcing fail-closed proof (CONFIRMED)

| Rule | Evidence |
|---|---|
| `operation=refresh` remains **503** | pinned: 503 with `Retry-After: 300` |
| exact refusal text | `approved server-side sourcing provider acquisition is not configured; no live observation was invented` (pinned substring; literal asserted in source by the gate) |
| never invent live observations | the refresh path returns the refusal INSTEAD of fabricating data; `normalize` only restructures caller-supplied observation + snapshot through the deterministic domain factories |
| zero live distributor/network calls | the §H gate proves no `fetch(`/URL/distributor identifier exists in ANY component-selection route; no network module is imported |
| offer/snapshot binding preserved | `observation.snapshotId !== snapshot.snapshotId` → 422 `offer/snapshot scope mismatch` (unchanged) |
| normalize contract preserved | `snapshot, observation, and quantityProfile are required` 400 (pinned); `maximumPriceAgeDays` default 7 and `now` handling unchanged |

A sourcing snapshot is therefore never "live" unless acquired through an
approved server-side source — which this stage deliberately does NOT add.
