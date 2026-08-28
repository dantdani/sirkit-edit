# B16.0.11 §F — Public output parity

The six public BOM methods remain PUBLIC (no policy change — a public↔auth
switch is an owner decision outside this stage) and keep their exact output
contracts. Business logic is byte-preserved; only the boundary prologue moved
into `publicJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 })`.

## Pinned parity (pre = post)

| Surface | Pinned |
|---|---|
| `/api/bom` | `buildBomRows(state, choice, forceRefresh)` exactly once; result JSON passthrough VERBATIM (marker-checked); pricing-choice normalization via `normalizeChoice`; `forceRefresh === true` threading |
| `/api/bom/cart/digikey` | REAL `toDigiKeyCsv` bytes; `Content-Type: text/csv; charset=utf-8`; `attachment; filename="sirkit-bom-digikey.csv"` |
| `/api/bom/cart/lcsc` | REAL `toLcscCsv` bytes; `…filename="sirkit-bom-lcsc.csv"` |
| `/api/bom/cart/mouser` | REAL `toMouserCsv` bytes; `…filename="sirkit-bom-mouser.csv"` |
| `/api/bom/export-csv` | `buildBom` → `bomToCsv` order (both called exactly once); legacy `pricingChoice:"both"` → `"all"` normalization; `…filename="sirkit-bom.csv"` |
| `/api/bom/procurement-packet` | REAL `toProcurementPacketCsv` bytes under a frozen clock, with title / buildQuantity / notes handling; `…filename="sirkit-procurement-packet.csv"` |

Error shapes (`{ ok:false, error }` 400/500), the two distinct missing-`state`
error strings, risk/lifecycle summaries, warning ordering, and
distributor/cache accounting all flow through the UNCHANGED
`bom-builder` / `bom/build` / `cart-formats` modules — none of which were
edited this stage (the CSV formatters run REAL in the pins, so the download
bytes are compared against the actual formatter output, not a copy).

## What the wrapper adds (non-breaking)

`publicJsonRoute` resolves the exact route policy first (all six rows are
public, no CSRF) and enforces media/ceiling/deadline in the same order the
routes already did via the shared reader — the pinned refusal statuses and
codes are identical pre/post. No authentication was added.
