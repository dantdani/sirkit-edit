# KiCad export — "Invalid symbol unit name prefix" fix

## Reported bug
Exported `.kicad_sch` files were rejected by KiCad 8.x with
**"Invalid symbol unit name prefix"** for parts with hyphenated names
(AP1117-15, ATmega328P-AU, ESP32-WROOM-32, …). Initial theory: the exporter
emitted identifiers as unquoted S-expression atoms.

## Actual root cause
The quoting theory didn't hold up. `q()` already wraps every identifier the
exporter emits (lib_id, refdes, properties, labels, title block), and
`CachedPart.symbolRaw` is a verbatim text slice from the `.kicad_sym` source, so
the original quotes are preserved. The base symbols the report named
(AP1117-15, ESP32-WROOM-32) actually export *valid* today.

The real failures are **`(extends …)` symbols**. Ingest resolves inheritance by
giving the child the *parent's* raw block (`extract.ts` `resolveSymbol`), so the
embedded unit children keep the parent's name — e.g. `AP1117-18`
(`extends "AP1117-15"`) arrives with `AP1117-15_0_1` / `AP1117-15_1_1` units.
`rewriteSymbolName` rewrote only the **root** id to `Regulator_Linear:AP1117-18`,
leaving the children prefixed `AP1117-15`. KiCad sets
`m_symbolName = id.GetLibItemName()` (library nickname stripped → `AP1117-18`)
and enforces `unitName.StartsWith(m_symbolName)`; `AP1117-15_0_1` fails it.

## Fix (app/lib/kicad-export.ts only)
`rewriteSymbolName` now also re-prefixes child unit ids: it reads the original
root name from the raw block and rewrites every
`(symbol "<root>_<unit>_<style>")` to use the new bare item name. For a base
symbol the original and target names are identical, so the child pass is a
no-op and existing exports are byte-for-byte unchanged. Added an
`escapeRegExp` helper for the dynamic child-match pattern.

## Verification
- Simulated `rewriteSymbolName` against the real source files:
  - base `AP1117-15` → root `Regulator_Linear:AP1117-15`, children
    `AP1117-15_{0,1}_1` (unchanged) — pass.
  - extends `AP1117-18` → root `Regulator_Linear:AP1117-18`, children rewritten
    to `AP1117-18_{0,1}_1` — now satisfy `StartsWith(item)`.
- `npx tsc --noEmit` clean.

## Note
The `q()` helper is the single source of truth for quoting (already used
everywhere); no separate `sExpQuote` was added since it would be a rename of an
identical existing function. The "quote all atoms" change in the original spec
was unnecessary — quoting was never the defect.
