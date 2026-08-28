# B16.0.11 §A — Pre-edit BOM contracts (pinned BEFORE migration)

[`app/api/__tests__/b16-0-11-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-11-tranche-parity.test.ts)
was written against the PRE-migration raw handlers and run GREEN first
(**60 / 60**, recorded), then kept green post-migration. All external work is
faked: `buildBomRows` / `buildBom` / `bomToCsv` (distributor pricing + CSV
assembly) and the BOM repository (`setBomRepositoryFactory`).

## Public methods (×6)

| Pin | Contract |
|---|---|
| text/plain | 415 `AUTH_MEDIA_TYPE_UNSUPPORTED`, **0 body pulls**, 0 business calls |
| malformed JSON | 400 `AUTH_INVALID_JSON`, 0 business calls |
| oversized (8 MB + 1) | 413, 0 business calls |
| missing `state` | 400 with the exact historical error (two distinct strings: the `/api/bom` + `export-csv` long form vs the short form on carts/packet) |
| valid | business seam called exactly once with `(state, normalized choice[, forceRefresh])` |

Output parity: `/api/bom` result passthrough verbatim; DigiKey/LCSC/Mouser
REAL `cart-formats` CSV bytes + exact filenames + `text/csv; charset=utf-8`;
export-csv `buildBom→bomToCsv` order + legacy `"both"→"all"` normalization;
procurement packet REAL bytes under a frozen clock with title/quantity/notes.

## Authenticated methods (×6)

| Pin | Contract |
|---|---|
| anonymous | 401, **0 body pulls**, **0 repository calls** (incl. both GETs) |
| production cross-origin (POST/PATCH/DELETE) | 403 CSRF, 0 pulls, 0 repository calls |
| revoked membership | 403, 0 repository calls |
| text/plain | 415 before body; malformed → 400; oversized → 413 (8 MB + 1 for diff/snapshot; **16 KB + 1** for notifications PATCH/DELETE) — all 0 repository calls |
| forbidden authority keys ×7 (`projectKey`,`tenantId`,`projectId`,`branchId`,`actor`,`actorId`,`role`) | the EXACT historical refusal: 400 `AUTH_AUTHORITATIVE_INPUT_FORBIDDEN`, `` `key` is server-derived and may not be supplied. ``, no-store — 0 repository calls |
| trusted ownership | every repository call carries exactly `{tenantId:"local", projectId, branchId:"main"}` |
| foreign snapshot / notification id | uniform 404 `BOM_NOT_FOUND`; foreign row never updated |
| diff `from`/`to` required; `to=current` requires `state`; current-diff is UNPERSISTED (no `createSnapshot`) | preserved |
| notifications PATCH `id` required / nothing-to-update; markAllRead bulk scope-constrained; DELETE olderThan scoped | preserved |
| GET notifications `?unreadOnly=true` | reaches the repository under the trusted scope |
| snapshot GET summary mapping; snapshot POST label trim + `{ok,id}` | preserved |
