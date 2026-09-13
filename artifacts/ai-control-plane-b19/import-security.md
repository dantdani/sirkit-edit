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
