# B16.0.24 §J — the zero-raw-handler ratchet

The migration ratchet now enforces the CLOSURE state, not a loose ceiling.

## New assertions (all green)

1. **EXACTLY zero raw handlers**: `inv.rawHandlers === []` — the
   raw-function/raw-arrow set is empty. Reverting any migrated route to a raw
   `export async function` / `export const = arrow` fails here.
2. **EXACTLY three factories**: `inv.factories === APPROVED_FACTORIES`
   ([factory-allowlist.md](factory-allowlist.md)) — a NEW factory fails CI.
3. **The baseline is EXACTLY the three factory rows** (`baseline.length === 3`).
4. **`inv.legacy.length === 3`** (non-canonical == the 3 factories) and
   **`inv.wrappers.length >= 150`**.

`inventory()` was extended to split `factories` from `rawHandlers` using the
classifier's three-valued `RouteMethodForm` (`factory` vs
`raw-function`/`raw-arrow`), rather than the prior coarse `legacy` lump.

## Constants

- `BASELINE_MAX`: 8 → **3**
- `MIGRATED_FLOOR`: 145 → **150**
- `TRANCHE_17` added (the 5 methods), pinned canonical + out-of-baseline
  forever.

## Generator + tripwires (unchanged, still green)

`ALLOWED_BASELINE_ADDITIONS = []`; a synthetic new raw POST classifies
`raw-function`; a fake/aliased wrapper is NOT canonical; the baseline may only
SHRINK (removals-only). The generator confirmed: "8 → 3 legacy methods (5
migrated, 0 added)".

Generators run ×2 — byte-stable:
`route-wrapper-matrix.csv` `ad1c5c65…` (150/3/0) ·
`_raw-route-baseline.json` `d0542262…` (3 rows).
