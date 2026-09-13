# B19-D — import security and licensing

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED**, **RECORDED**, **UNKNOWN**.

## The import surfaces that exist

Measured by reading every inbound path before testing (so the matrix attacks what Sirkit actually parses, rather than
building importers to attack):

| surface | parses | notes |
|---|---|---|
| distributor JSON | vendor responses | bounded, typed and redacted since I1; quotas and breakers since I3b |
| KiCad symbol and footprint assets | `.kicad_sym` / `.kicad_mod` s-expressions (`app/lib/atomic/kicad-assets.ts`) | bounded by `assertBoundedSExpression`; used by the catalog and the manufacturing fixture |
| KiCad library tables and 3D model references | paths with `${VARIABLES}` (`library-resolver.ts`, `resolvePermittedPath`) | root- and extension-bounded |
| vendor text and links shown in the product | descriptions, product and datasheet URLs, MPNs | reach the BOM view, CSV exports and (B19-E) agent tools |
| PDFs, SVGs, archives | **none** | no inbound PDF, SVG or archive import exists; the only archives are outbound fabrication bundles |

## I5a — license enforced at export (CONFIRMED; closes D19-7)

### Reproduced first

`app/lib/atomic/__tests__/b19-export-license.test.ts` against the unchanged export: **6 of 7 failed**. A KiCad schematic
export copies each pinned part's symbol definition into the downloaded file, and it never looked at a license:

- symbols whose license export disposition was `prohibited`, `private_review_only`, `metadata_only` or `unknown` exported;
- a symbol whose license record was absent from the snapshot exported;
- `POST /api/export/kicad` answered **200** with the file for a `private_review_only` symbol.

Publication already refused `unknown` and `prohibited`; but `private_review_only` and `metadata_only` revisions can be
published, and the export reads the pinned snapshot as the caller sends it. One baseline passed before and after: a
`redistributable` symbol exports exactly as before.

### What changed

| rule | where |
|---|---|
| Before a byte is serialized, every pinned symbol's own license (by the asset's `origin.licenseId`, looked up in the snapshot) must have export disposition `redistributable`; anything else, or a missing record, collects a violation and the export throws `SchematicExportLicenseError` | `app/lib/kicad-export.ts` |
| The route answers 422 `EXPORT_LICENSE_PROHIBITED`, names the components and their dispositions, and sends nothing of any symbol | `app/api/export/kicad/route.ts` |
| The app's export button already shows a structured refusal's code and sentence | `app/lib/project/io-outcome.ts` (unchanged) |

### Recorded

- The app's own export button sends no pinned selections today (it exports catalog rows), so this gate protects the public
  export API and any pinned export; the footprint is exported by name only and 3D models are not exported.
- Other outputs that carry CAD-derived content — PCB and fabrication exports built from footprint geometry — are governed
  by the manufacturing release chapters; whether their geometry sources' `derivedRedistribution` is checked there is
  **UNKNOWN** from this chapter and recorded for the validation increment.
- A BOM export carries identity metadata (MPN, manufacturer, quantities), not CAD content, and is not gated here.

## I5b — the import security matrix (plan; rows close as batches land)

A read-only multi-agent sweep (`import-security-matrix.md`) mapped every inbound surface for the runbook's B19-D cases,
had an adversarial skeptic try to refute each suspected gap, and kept 51 rows (none refuted; two marked
reproduce-first) plus six verified controls to pin as regression tests. It also confirmed which surfaces do NOT exist:
no inbound archive, PDF or SVG import, no CSV/BOM import, no model-file ingestion, and no distributor text in any model
prompt. Every row carries a proposed failing test; nothing is claimed until that test fails on the unchanged code.

The rows land in four test-first batches:

| batch | rows | theme |
|---|---|---|
| I5b | 01, 03, 20, 26, 27a, 36, 39, 40, 41, 42, 43, 51 | the acquisition path: exact-MPN binding, derived lifecycle retention, price semantics, lifecycle mapping, confusable identity in bundles, quarantine hygiene, ingestion bounds |
| I5c | 02, 04, 09, 10, 15, 16, 17, 18, 21, 33, 34, 35 | output injection: chat markdown images, KiCad emitters, CSV formulas and CR, vendor hrefs, report escaping, export selection shape |
| I5d | 06, 07, 08, 22, 23, 27c, 37, 38, 44–50 | KiCad parsing and atomic data integrity: symbols, inheritance, s-expression bounds, paths, value keys, claims, mapping conflicts, quantities |
| I5e | 05, 11–14, 19, 24, 25, 28–32 | model context and project import: untrusted catalog text, prompt delimiters, tool-result hygiene, end-to-end injection ratchet, import bounds |
