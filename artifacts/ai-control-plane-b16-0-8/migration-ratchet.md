# B16.0.8 §A — The monotonic migration ratchet

Replaces B16.0.7's dormant all-or-nothing cutover (`EXPECT_FULL_ADOPTION`,
still false) with a contract that can only move FORWARD.

## The baseline

`app/lib/auth/__tests__/_raw-route-baseline.json` — the frozen set of legacy
(raw or factory) route methods, each `{ method, route, sha1(source) }`.
Frozen at the pre-B16.0.8 state (153 methods − 15 tranche-1 = **138 legacy**),
it may ONLY shrink.

## The generator (`scripts/generate-b16-0-8-baseline.ts`)

- **freeze** (file absent): writes the complete current raw set;
- **update** (file present): removes entries whose methods are now canonical
  wrappers; REFUSES any addition — a raw method not already in the baseline —
  with exit 1 and the offending list, unless the addition appears in the
  explicit `ALLOWED_BASELINE_ADDITIONS` exception list, which the ratchet test
  PINS to `[]`. Deterministic and side-effect-free on import (main is guarded).

## The gate (`b16-0-8-migration-ratchet.test.ts`)

1. **No new raw routes**: every non-canonical method must be IN the baseline —
   a newly created route/method that isn't a canonical wrapper fails CI here.
2. **Monotonic pins**: `baseline.length ≤ 138` and canonical-wrapper count
   ≥ 15 — future tranches move the pins (down/up) only.
3. **No reverts**: each tranche-1 method must classify `canonical-wrapper` and
   must NOT re-enter the baseline; a revert to raw fails both rule 1 and this.
4. **Tripwires** (all passing): baseline EXPANSION refused by the generator's
   pure decision function; a synthetic new raw `POST` classifies `raw-function`
   and is outside the baseline; a fake wrapper module (`./evil`) and an
   aliased-from-canonical wrapper are NOT canonical; the checked-in baseline
   byte-agrees with a fresh scan (no drift).

## Cutover path

Each future tranche: migrate methods → run the generator (removals only) →
lower `BASELINE_MAX` / raise `MIGRATED_FLOOR` in the ratchet test → when the
baseline reaches ZERO, flip `EXPECT_FULL_ADOPTION = true` in
`b16-0-7-wrapper-adoption-gate.test.ts` (the hard gate) and retire the baseline.
