# BOM Stage 6: Cart export & procurement packet

**Date**: 2026-06-24
**Status**: Shipped

## What this changed
Added BOM export in DigiKey / Mouser / LCSC upload-tool formats and a
comprehensive procurement-packet CSV for contract manufacturers. UI Send-To
dropdown auto-downloads the CSV and opens the distributor's upload page in
a new tab. Procurement packet collects project title, build quantity, and
notes via modal.

## New files
- app/lib/cart-formats.ts — DigiKey, Mouser, LCSC, procurement-packet CSV builders (RFC 4180, CRLF)
- app/lib/distributor-links.ts — upload-tool URLs + product-page URL helpers
- app/lib/bom-builder.ts — extracted shared BomRow builder + request validation
- app/api/bom/cart/{digikey,mouser,lcsc}/route.ts — distributor CSV downloads
- app/api/bom/procurement-packet/route.ts — comprehensive procurement CSV download

## Modified files
- app/api/bom/route.ts — refactored to use bom-builder (thin wrapper; response shape unchanged)
- app/components/bom/BomView.tsx — Send-To dropdown, procurement-packet modal, per-row distributor links, post-action banner

## New exports
- toDigiKeyCsv / toMouserCsv / toLcscCsv / toProcurementPacketCsv(rows[, meta]) → string
- DISTRIBUTOR_UPLOAD_URLS, type CartDistributor
- digiKeyProductUrl / mouserProductUrl / lcscProductUrl(id) → string
- buildBomRows(state, pricingChoice[, forceRefresh]) → Promise<BomResult>; normalizeChoice, isSchematicState

## Design decisions / Known limitations
- No OAuth/direct-cart API — deep-link + manual CSV upload is the explicit MVP (out of scope).
- bom-builder.buildBomRows wraps the existing buildBom rather than duplicating logic; cart routes
  and /api/bom all call it, so the /api/bom response shape is byte-for-byte unchanged.
- Custom dropdown/modal/banner (no shadcn UI lib exists in the repo; no new deps).
- BomRow type imported from @/app/lib/bom/build (the spec's @/api/bom/route path doesn't resolve
  under the @/* → ./* alias; route.ts re-exports the same type).
- LCSC CSV/upload URL are best-effort — verify against LCSC's real tool before trusting.
- Rows with neither SKU nor MPN are dropped from distributor CSVs; the post-download banner reports
  how many rows will be matched by MPN instead of SKU.
- Procurement packet is CSV only (PDF deferred); prices rounded to 4dp to drop float noise.

## Verification
- pnpm tsc --noEmit: 0 errors
- Throwaway builder test: DigiKey/Mouser/LCSC headers exact; RFC 4180 escaping verified
  ("MCU,X", "ST, Inc", "RES 10K, 1%" quoted), CRLF endings present, theory/no-MPN rows dropped,
  MPN-only fallback URLs generated; procurement totals sum correctly (16+32+0+240 = 288), metadata
  header + 23 columns + TOTAL PROJECT COST row present.
- Send-To buttons disabled until a BOM is loaded; Generate disabled until title non-empty.
- Manual (needs distributor sessions): Send to DigiKey/Mouser downloads CSV + opens upload tool;
  upload populates the cart; procurement CSV opens cleanly in Excel/LibreOffice.
