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

### I5b landed — the acquisition path (CONFIRMED)

Every row was reproduced by a failing test on the unchanged code first: **40 of 67** new cases failed; the other 27 are
baselines that pass before and after (the behaviour that must not change).

| row | reproduced before the fix | now |
|---|---|---|
| 01 (high) | DigiKey and Mouser answered a request for `MAX3232CSE` with the first search result (`MAX3232CSE+`); Nexar took `results[0]`; the pricing layer relabelled the answer as the requested MPN, cached it, and wrote its lifecycle into `parts`; cached offers had no MPN and were relabelled too | connectors answer only for the exact published MPN (trim + ASCII case-fold; every suffix character significant; non-printable-ASCII spellings never match — OD-34); nothing is relabelled; a stored offer carries its MPN (`part_offers.mpn`, migration 0029) and answers only for it; rows stored before 0029 are never served |
| 36 | two exact parts under one catalog row were priced once and shared the first price | pricing is keyed by `pricingKey(partId, exact MPN)` in the pricing layer and the BOM |
| 03 (medium) | every call — a cache-only export included — re-stamped the part's vendor-derived lifecycle, and nothing cleared it | written only from a live answer; the offer purge clears a vendor-stamped status older than the strictest bounded retention (1 h); KiCad-derived statuses (unstamped) are untouched |
| 20 | the "best unit price" was the minimum over every break (a 10 000-piece break priced a one-off line; GBP/JPY numbers could win); totals were labelled with one row's currency | `cheapestUnitPrice(breaks, { quantity, currency })`: the cheapest break reachable at the quantity, in USD only, else the order minimum; the BOM estimate and the procurement packet price at the ordered quantity and total in USD |
| 26 | "Inactive", "Not Active", "Non-Active" mapped to active | negated terms map to unknown |
| 51 | "0,34" read as 34, "€1.234,56" as 1.23456, "12abc34" as 1234 | only a currency sign, optional US thousands separators and decimals are read; anything else is not a number |
| 27a | a bundle's identity was the letters-and-digits search key: `MAX3232CSE+`/`MAX3232CSE`, `LT1086CM#PBF`/`LT1086CMPBF`, homoglyph and zero-width spellings merged into one part's evidence | identity is the canonical exact MPN; a confusable spelling is refused |
| 39 | terminal function, electrical rating and package geometry disagreements were not conflicts | every engineering property, identity and lifecycle are conflict properties |
| 40 | the observation recorded the vendor's MPN as the one asked for; a superseded document revision never went stale | the requested MPN is kept and a mismatch is a bundle conflict; a superseded extraction is stale |
| 41 | a `javascript:` product link, a `data:` datasheet link and control/bidi characters became sourcing facts | links pass `safeExternalHref` (HTTPS pages; HTTP/HTTPS documents; no credentials, whitespace, control characters or blocked hosts); vendor text passes `inertExternalText` |
| 42 | `quarantineText` accepted any media type and size unless it was declared KiCad; adapter paging had no record ceiling and an adapter ignoring its signal ran forever | a text media-type allowlist, the text byte ceiling for every type, s-expression preflight whenever content looks like one; 50 000-record ceiling; every page and retry wait races the deadline |
| 43 | NaN, negative, infinite and fractional archive counts passed the budget | only non-negative safe integers are accepted |

Recorded, not changed: pricing currency is USD (every registered source's default); an offer priced only in another
currency has no unit price rather than a converted one. Two exact MPNs under one catalog part share one
`(part_id, distributor)` cache row and may displace each other's cached offer — never mislabel it. An independent
adversarial review of this diff followed (below).

### I5b adversarial review — every verified finding fixed (CONFIRMED)

A review workflow read the exact I5b diff through four lenses (functional correctness, security bypasses, data and migration
safety, test adequacy), and a skeptic per lens tried to refute each finding by reading the code. 39 findings: **22 verified
real** (1 medium, 21 low; several reported by more than one lens), 17 refuted with file:line reasons (e.g. the one-cache-row-
per-part collision needs `componentSelections` on a route, and no route passes them today).

Every verified finding got a failing test first — **42 of 67** new cases failed on the I5b code; 22 are baselines; three are
pins that already passed (the adapter deadline against a hanging page and a hanging retry wait, and the packet total at the
ordered quantity), kept because the reviewer showed the earlier test would pass with either mechanism removed.

| finding | fix |
|---|---|
| medium: "no exact match" answers were never remembered, so every live BOM re-queried the vendor for generic MPNs | a successful answer with no exact product is remembered per source and canonical MPN for the source's freshness (not for no-storage sources; a failed request is not remembered; a forced refresh clears it) |
| memo and in-flight keys folded Unicode case (a Kelvin-sign request read the plain MPN's memo) | memo and in-flight keys are the canonical exact MPN; a confusable spelling is never memoized |
| a three-digit decimal comma ("0,340") read as a thousands group | a thousands group never starts with 0 |
| negated phrases beyond "(in|not|non) active" mapped to active ("No Longer Active", "Not In Production", "Non-Preferred") | every negated active / in production / preferred phrase maps to unknown |
| inert text left ALM, word joiner, invisible operators, tag characters and soft hyphens, and could split a surrogate pair | Unicode property classes (Cc, Cf, Cs, Zl, Zp) and code-point truncation; the same classes for links |
| a mixed-case host allowlist refused every link; http-page refusal untested | allowlist entries are normalised; both pinned |
| the archive budget skipped a missing or inherited count | the three named counts are checked explicitly |
| a case-only MPN difference raised an MPN conflict | MPN conflicts compare canonical MPNs |
| a cached offer's lifecycle was re-stamped when another source answered live; a memo answer was stamped "now" | the persisted verdict is consolidated from live answers only and stamped with when the vendor answered |
| the project estimate used the price at the line's quantity while the table, BOM CSV and view showed the quantity-1 price | one browser-safe `lineUnitPrice` rule for the estimate, the BOM CSV and the BOM view |
| snapshots labelled a USD price with a same-numbered break's currency; the notify job and alternates still used the lowest break in any currency; pre-B19 snapshots were compared with current ones | snapshots record `priceBasis: usd-at-quantity-1` and are labelled USD; price and best-supplier changes are compared only between snapshots of the same basis; the notify job and alternates price at quantity 1 in USD |
| the alternates route and both operator scripts read offers stored for another exact MPN or before 0029 | one `offersForExactMpn` rule (fresh + stored for that exact MPN) in all three |
| vendor lifecycle expired only when the BOM purge ran; public readers of `parts.lifecycle_status` never enforced it; the notify job then read "unknown" as a change; `backfill-parts` left a vendor stamp on a KiCad-derived status | a shared `partLifecycleStatus` SQL expression expires a stamped status older than the strictest retention at READ time in parts search, part detail, alternates and the notify job (verified on migrated PGlite); an expired current status is "no information" in notifications; backfill clears the stamp |
| the opt-in real-PostgreSQL qualification test's migration pin was not moved for 0029 | moved |

Accepted as recorded decisions rather than changed: exact-MPN matching ignores the manufacturer (OD-34), and alternate
ranking still scores a never-checked part's seeded status (pre-existing Stage 1 data, recorded).
