# KiCad export — power ports rendered as "?" boxes (fix)

## Bug
In KiCad 10.0.3, exported `.kicad_sch` files showed every power port (+3V3, +5V,
GND, VBUS, VCC, VDD, …) as a red "?" box. Cause: instances referenced the stock
`power` library by `lib_id` (`power:+3V3`) but nothing made that symbol
resolvable — KiCad couldn't find it, so it drew the unresolved-symbol placeholder.

## Fix
KiCad itself solves this by embedding each used power symbol into the schematic's
own `lib_symbols` block (verified against a KiCad 10 demo: the embedded entry is
`(symbol "power:GND" (power global) …)`, root re-qualified, unit children left
bare). The export now does the same.

### New file: `app/lib/kicad-power-symbols.ts`
- `POWER_SYMBOLS`: 16 stock power-port definitions copied **verbatim** from the
  installed `KiCad/10.0/share/kicad/symbols/power.kicad_sym` (generated, not
  hand-written, for byte-fidelity): +3V3 +5V +9V +12V +15V +1V8 -5V -12V VCC VDD
  VBUS GND GNDA GNDD Earth PWR_FLAG. All names/sub-names double-quoted.
- `getPowerSymbol(name)` lookup.
- `buildGenericPowerSymbol(name)`: upward-flag fallback for rails with no stock
  symbol (e.g. "VIN" — not in KiCad's lib — or custom "+24V", "VAUX").

### `app/lib/kicad-export.ts`
- Embeds the power symbols the schematic actually uses into `lib_symbols`,
  qualified to `power:<name>` via the existing `rewriteSymbolName` (so unit
  children keep the bare prefix and pass KiCad's "unit name prefix" check — the
  fix from the previous prompt). Grounds all map to the stock `GND` glyph.
- Power-port instances now reference `power:<name>` for every rail (the old
  `POWER_LIB_ID` allow-list and the global-label fallback for unknown rails are
  gone; unknown rails get an embedded generic symbol instead). `label`-kind
  labels still emit `global_label`.
- Format version bumped `20240114` → **`20250610`** (matches a schematic saved
  by KiCad 10.0.3).

## Test — opens cleanly in KiCad 10.0.3
Generated a schematic with net labels +3V3, GND, VBUS, VIN, +24V, MOSI and ran
the real toolchain:
- `npx tsc --noEmit` — clean.
- Programmatic checks: balanced parens; version present; `power:{+3V3,GND,VBUS,
  VIN,+24V}` all embedded + referenced; MOSI stays a `global_label`; every
  embedded unit-child name satisfies KiCad's `StartsWith(item)` rule.
- **`kicad-cli 10.0.3 sch export svg`** parsed and plotted with exit 0 — no
  errors/warnings. SVG contains all rail labels and **no "?" placeholder glyph**,
  confirming all power ports resolve to their proper symbols.

## Notes
- Only `app/lib/kicad-export.ts` modified + `app/lib/kicad-power-symbols.ts`
  added, per constraints. Theory parts (Device:R/C/L/D) rendered fine, so no
  Device-library embedding was needed (Fix 4 skipped).
- Chose the library-qualified `power:<name>` embed (what KiCad emits) over the
  spec's Option A `+3V3` / Option B `sirkit_export:+3V3`, since it's the native,
  verified-correct convention.
