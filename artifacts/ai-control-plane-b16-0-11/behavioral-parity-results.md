# B16.0.11 — Behavioral parity results

## Method

The 60-pin suite was run GREEN against the PRE-migration raw handlers
(recorded), the 12 methods were migrated, and the suite re-ran GREEN with
**zero assertion changes**.

One test-harness correction was made between the runs and is disclosed: the
three cart-CSV pins originally posted to a synthetic placeholder URL
(`/api/bom/cart/x`). The raw handlers ignored the URL; the canonical wrapper
correctly resolves the exact route policy from the real path, so the pins were
corrected to post to each cart's REAL path (`/api/bom/cart/digikey|lcsc|mouser`)
— the URLs production traffic actually uses. **No assertion (status, headers,
bytes, call counts) changed.**

## Result

| Battery | Result |
|---|---|
| 60-pin suite pre-migration (raw handlers) | **60 / 60** |
| 60-pin suite post-migration | **60 / 60** (same assertions) |
| `b16-0-2-bom-ownership` (standing B16.0.2 ownership suite) | green, untouched |
| `b16-0-3-boundary-gate`, `b16-0-2-gates` (§A/§C) | green |
| BOM confinement gate + ratchet | 32 / 32 |
| Complete bounded-fork suite | **3680 / 0 / exit 0** |

## Notable preserved specifics

- the two distinct missing-`state` error strings (long form on `/api/bom` +
  `export-csv`; short form on carts/packet);
- the exact per-key forbidden-authority message with backticked key names;
- uniform `BOM_NOT_FOUND` 404 for foreign snapshot/notification ids;
- `markAllRead` / `olderThan` bulk semantics;
- snapshot label trimming (`" L1 "` → `"L1"`, 200-char cap);
- snapshot GET summary field mapping (id/label/takenAt/rowCount/totalCostCents/
  currency/designRiskScore);
- CSV bytes byte-equal to the REAL `cart-formats` output; filenames and
  `text/csv; charset=utf-8` headers exact.
