# PCB Stage 2 — Footprint library ingestion + search API

Date: 2026-07-04 · Status: done (all gates pass, verified end-to-end)

Ingested the official KiCad footprint library (15,433 footprints) into a new
`pcb_footprints` table with pgvector embeddings, and exposed search / resolve /
detail API routes. **Stage 4 should use `resolve` for exact KiCad footprint
hints (the `footprint_hint` strings already on ~30k symbols) and `search` for
AI-assisted assignment.**

## New files
- `drizzle/0005_nice_meteorite.sql` — migration (repo convention is Drizzle, not
  `supabase/migrations/`). Hand-edited after `drizzle-kit generate`: added
  `CREATE EXTENSION IF NOT EXISTS pg_trgm` + `IF NOT EXISTS` guards so
  re-applying is a no-op (verified). Apply command: split on
  `--> statement-breakpoint`, run each via the `postgres` client (or
  `pnpm db:push` to sync the whole schema, the convention used previously).
- `scripts/ingest-footprints.ts` — CLI ingester, mirrors `scripts/ingest-kicad.ts`
  (loadEnvLocal, getDb/getSqlClient, embedBatch). Flags: `--limit N`, `--force`,
  `--dry-run`. Report → `scripts/output/ingest-footprints-report.json` (gitignored).
- `app/api/pcb/footprints/search/route.ts`
- `app/api/pcb/footprints/resolve/route.ts`
- `app/api/pcb/footprints/[id]/route.ts`
- `app/lib/pcb/footprint-api-types.ts` — pinned contracts (Stages 3/4 import):
  `FootprintSearchHit { id, libName, name, fullName, description, padCount,
  attrSmd, attrTht, bodyBBox, score }`,
  `FootprintDetail extends Omit<FootprintSearchHit,'score'> { tags, pads,
  courtyardBBox, models, rawSexpr, source, sourceCommit }`,
  plus `FootprintSearchResponse { hits }` / `FootprintResolveResponse { hit }`.
- `app/lib/pcb/__tests__/ingest-integrity.test.ts` — 3 random DB rows re-parse
  via `parseKicadMod` and `emitVerbatim` equals stored text; skips without
  `DATABASE_URL` so CI stays green.

## Modified files
- `app/lib/db/schema.ts` — added `pcbFootprints` table (+ `PcbFootprint` /
  `NewPcbFootprint` types). Required by the repo's Drizzle-first migration flow.
- `.gitignore` — added `/scripts/output`.
- Nothing else; contended files untouched.

## Routes
- `GET /api/pcb/footprints/search?q=<text>&limit=20&padCount=<n?>&smd=<bool?>`
  → `{ hits }`. Exact `Lib:Name`-shaped `q` short-circuits to an indexed lookup
  (score 1, no embedding call). Otherwise **dual-pool hybrid**: top-50 by
  pgvector cosine ∪ top-50 by pg_trgm similarity on `lib_name||':'||name`,
  merged and ranked by `0.6*cosineSim + 0.4*trigramSim`. Deviation from the
  spec's single vector pool (allowed if measurably better): with vector-only,
  "usb-c connector 16 pin" returned zero USB-C hits in the top 50 — "16 pin"
  drowned it in the 1x16 pin-header family; the trigram pool fixes that while
  "0805 resistor" / "SOIC-8" are unchanged.
- `GET /api/pcb/footprints/resolve?hint=<Lib:Name>` → `{ hit | null }`. Single
  indexed query (adds `source='kicad-footprints'`, the unique index's leading
  column, so it's a pure index seek).
- `GET /api/pcb/footprints/[id]` → `FootprintDetail` (includes verbatim
  `rawSexpr`); 404 JSON `{ ok:false, error }` on miss.

## Source deviation (important)
Spec said `github.com/KiCad/kicad-footprints` — that mirror froze in Oct 2020
(~12k footprints, would fail the ≥14k gate). Ingested from the live upstream
`gitlab.com/kicad/libraries/kicad-footprints` (same host the symbol ingestion
uses). `source_commit`: **645402ed82e16096cf827fea7114fdbef4c46948**.

## Full-run report (gates: scanned≥14k ✓, failed<1% ✓, embeddingNulls=0 ✓)
```json
{ "scanned": 15433, "parsed": 15433, "failed": 0, "fallbackPads": 10049,
  "inserted": 15383, "updated": 0, "skipped": 50, "embedded": 15383,
  "embeddingNulls": 0, "commit": "645402ed82e16096cf827fea7114fdbef4c46948" }
```
Parse success 100% — no Stage 1 parser gaps. Re-runs are cheap: unchanged
commit → all rows skipped, zero embedding calls (verified).

## SQL counts
```
select count(*) from pcb_footprints;                          => 15433
select count(*) from pcb_footprints where embedding is null;  => 0
```

## Curl verification (truncated)
```
search?q=0805 resistor&limit=5 →
  0.526 Resistor_SMD:R_0805_2012Metric   (rank 1 ✓; then R_01005/R_0815/R_0508/R_0402)
search?q=usb-c connector 16 pin&limit=5 →
  0.524 Connector_USB:USB_C_Receptacle_HCTL_HC-TYPE-C-16P-01A
  0.511 Connector_USB:USB_C_Receptacle_Palconn_UTC16-G
  0.497 Connector_USB:USB_C_Receptacle_GCT_USB4110 … (all 5 USB-C ✓)
resolve?hint=Resistor_SMD:R_0603_1608Metric →
  {"hit":{"fullName":"Resistor_SMD:R_0603_1608Metric","padCount":2,"score":1,…}} ✓
```
Also verified: exact-ref short-circuit (`q=Resistor_SMD:R_0805_2012Metric` →
score 1), `padCount`/`smd` filters, 48/48 vitest pass incl. round-trip
integrity, `tsc --noEmit` clean, new files eslint-clean.

## TODOs / known limitations
- `fallbackPads: 10049` = pad-related parser *warnings* (mostly custom-pad
  shape approximations from `parsePad`), not failures; rows are stored with
  approximated `Pad.shape` while `raw_sexpr` stays exact. Fine for search/place;
  Stage 13 export is unaffected (splices verbatim text).
- `pad_count` counts electrical pads only (non-empty pad number); NPTH/shield
  anchors excluded — USB-C receptacles report ~20 (16 signal + 4 shell).
- Post-MVP carve-outs skipped per spec: LCSC/EasyEDA sources (schema's `source`
  column is ready), 3D model files (paths stored in `models`), thumbnails,
  pagination beyond `limit`, auth.
