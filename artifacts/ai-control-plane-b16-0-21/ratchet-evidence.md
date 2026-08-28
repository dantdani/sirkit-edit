# B16.0.21 §H — Ratchet evidence (CONFIRMED)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 37 → 29 legacy methods (8 migrated, 0 added)
```

Baseline 37 → **29**; canonical 116 → **124**; raw 34 → **26**; factories 3;
zero new raw methods. `TRANCHE_14` revert pins added; `BASELINE_MAX` 37 → 29;
`MIGRATED_FLOOR` 116 → 124; tranches 1–13 green. The ratchet was updated ONLY
after all eight routes passed parity, via the sanctioned generator.

Generators ×2 byte-stable: wrapper matrix (124/3/26) `ea080378…`; baseline
(29) `f9ec18cd…`; b16-0-4 matrices stable.
