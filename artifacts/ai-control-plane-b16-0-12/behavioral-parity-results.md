# B16.0.12 — Behavioral parity results

## Method

The 24-pin suite ran GREEN against the PRE-migration raw handlers (recorded),
the 12 methods were migrated, and the suite re-ran GREEN. **No contract
assertion changed.** Two pin-harness corrections and one mid-authoring
discovery are disclosed:

1. **ai/runtime call shape** — the raw handler took zero arguments, so the
   original pin called `aiRuntime()`. The canonical wrapper (like Next itself)
   receives a `Request`; the pin now passes a real `Request` for
   `/api/ai/runtime`. Assertions unchanged.
2. **Volatile output tokens (discovered while authoring the PRE pins, before
   migration)** — the kicad-pcb writer mints random per-element `(uuid …)`
   values and the placement engine mints a fresh `runId` + wall-clock
   `elapsedMs` per invocation. The parity pins compare bytes with exactly those
   historical volatile tokens normalized; everything else is exact.
3. **A migration-script brace misplacement** in `footprints/search` (the
   arrow-close landed after the wrong helper) was caught immediately by the pin
   suite failing to parse, and fixed — evidence the pins gate the migration.

## Result

| Battery | Result |
|---|---|
| 24-pin suite pre-migration (raw handlers) | **24 / 24** |
| 24-pin suite post-migration | **24 / 24** |
| targeted security + tranche-1..4 + adoption + capabilities + export fail-closed + `app/lib/atomic` | **445 passed** (13 files) |
| ratchet (TRANCHE_5, 89/64) | 8 / 8 |
| complete bounded-fork suite | **3704 / 0 / exit 0** |

Tranche-1's KiCad pins (`b16-0-8-tranche-parity`) stay green over the newly
migrated category route's sibling, and the standing export `route-fail-closed`
suite passes unchanged against the wrapped route.
