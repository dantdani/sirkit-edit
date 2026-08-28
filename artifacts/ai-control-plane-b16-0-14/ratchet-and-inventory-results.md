# B16.0.14 §K — Ratchet & inventory results

## Baseline update (sanctioned generator only)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 84 → 82 legacy methods (2 migrated, 0 added)
```

## Post-stage inventory (measured, matches the mandate exactly)

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **71** |
| Factories | **3** |
| Raw methods | **79** |
| Legacy baseline entries | **82** |

## Requirements verified

- Both tranche-7 methods classify `canonical-wrapper`
  (apply-authorization → `selectorEnvelopeJsonRoute`; assign/suggest →
  `authenticatedJsonRoute`) and neither remains in the baseline.
- `TRANCHE_7` revert-pins added; `BASELINE_MAX` 84 → **82** (downward only),
  `MIGRATED_FLOOR` 69 → **71** (upward only).
- The prior 69 wrapper methods (tranches 1–6) remain pinned canonical.
- Zero baseline additions; shrink-only generator; empty exception list pinned.
- `selectorEnvelopeJsonRoute` is accepted ONLY from exact canonical provenance
  (added to `APPROVED_ROUTE_WRAPPERS`; a fake/local/aliased/barrel copy fails
  the classifier).
- Fake-wrapper / alias / barrel / shadowing / raw-export tripwires green.
- Byte-stable ×2: baseline `027bccf9…`, wrapper matrix `ae3f6311…`, b16-0-4
  matrices `8dcf41b5…` / `ff1ea338…`.
