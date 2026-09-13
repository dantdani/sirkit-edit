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
| I5d | 06, 07, 08, 22, 23, 27b (missing from the first table), 27c, 37, 38, 44–50 | KiCad parsing and atomic data integrity: symbols, inheritance, s-expression bounds, paths, value keys, claims, mapping conflicts, quantities |
| I5e | 05, 11–14, 19, 24, 25, 28–32, 52 (DSN writer tokens, from the I5c review) | model context and project import: untrusted catalog text, prompt delimiters, tool-result hygiene, end-to-end injection ratchet, import bounds |

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

### I5c landed — output injection (CONFIRMED)

Every row was reproduced by a failing test first (**all 42 new cases** failed on the code before the fix; five only because
the new helpers did not exist yet, the other 37 on behaviour). Two corrections were made to the matrix's proposed tests
while reproducing: a formula-shaped pick-and-place *reference* is already refused by board integrity (measured
`BoardIntegrityError`), so row 33 targets the value and package columns instead; and a comma inside a neutralised cell must
still be quoted.

| row | reproduced before the fix | now |
|---|---|---|
| 02 (medium) | assistant markdown rendered `![x](https://evil.example/…)` as an `<img>` fetched when the chat opened (inline, reference-style and in a table); links accepted any destination; no image policy | one `ChatMarkdown` renderer: images render as `[image: alt]` and are never fetched; links keep only web or mail destinations, open without a referrer and show their host; `next.config` sends `Content-Security-Policy: img-src 'self' data: blob:` on every route |
| 04 (medium) | the `.kicad_pcb` writer put `pad.type` unquoted and net ids through `String()` — an injected pad type or net id became sibling nodes in the file (also through `writeKicadPcb`, which feeds kicad-cli) | every leaf child is a finite number, a `q()`-quoted string or a bare token (`KicadEmitError` otherwise); pad types from the parser's vocabulary; net ids non-negative integers; unknown pad shapes refused |
| 17 | `q()` escaped only `\` and `"`: a newline inside a footprint text or schematic value became a literal line break inside a string; `indent()` could pad inside a string | newline, CR and tab are escaped as KiCad writes them (other controls become spaces) in all three writers; `indent()` is string-aware |
| 18 | `constructor` / `__proto__` / `toString` as a pad layer or power label crashed the footprint parser and the schematic export | own-property lookups in the layer, wildcard, power-symbol and DRU tables |
| 15 | the export's license gate ran only for pinned instances with a body selection; the app exports instances that declare an atomic revision without one | the route exports every instance that declares an atomic revision from the PUBLISHED snapshot it loads for that revision (symbol and licenses), requires the declared symbol version to match, and refuses (`EXPORT_PINNED_PART_UNAVAILABLE`) when it cannot load it |
| 16 | a crafted body selection injected its own s-expressions through `rawSymbolSExpression`, claimed any license, or crashed the route with a 500 | body selections are ignored; a pinned symbol is written only when it is exactly one bounded `(symbol …)` definition |
| 34 | vendor product links and KiCad Datasheets were rendered as `href` with no policy (`data:`, `vbscript:`, `//host`, credentials, IP literals passed) | `safeHref` (browser-safe): HTTPS pages (vendor pages only on distributor domains), HTTP/HTTPS documents, no credentials, whitespace, control/format characters, IP literals or local names; the BOM view, the library panel, the part inspector and KiCad extraction use it; the server egress helper delegates to it |
| 35 (reproduce-first) | the KiCad export wrote a part's Datasheet with quote escaping only | only a web datasheet link is written. Whether KiCad launches a `file:`/UNC datasheet could not be tested (no KiCad here): recorded as **policy**, not as a reproduced exploit |
| 09 | cart CSVs and the procurement packet never neutralised a formula, and the packet's URL columns took a stored link as-is | text cells are neutralised (numbers stay numbers); a non-distributor stored link is replaced by the vendor search link |
| 10 | the BOM CSV left a lone CR unquoted | quoted |
| 21 | the SPICE HTML report interpolated `projectRevision` unescaped | escaped |
| 33 | fab BOM and pick-and-place CSVs (both writers) never neutralised a formula | text columns are neutralised; coordinates, rotation and quantity stay numbers |

Reviewed pin move: I5a's route license test now serves its restricted snapshot through the server catalog, because the route
no longer reads the body's snapshot. The export parity pin (bytes identical to the serializer) holds unchanged.

~~Not proven locally: the chat, BOM and library links in a real browser, and the image policy header against the running app —
carried by CI's page-browser-e2e job on this commit.~~ **Corrected by the I5c review:** no Playwright spec exercised any of
this, so that sentence claimed proof that did not exist. See the review section below for what now proves it.

### I5c adversarial review — verified findings fixed, one decision recorded (CONFIRMED)

A review workflow read the committed I5c diff through four lenses (regressions, security bypasses, coverage of the rows' own
claims, test adequacy), and a skeptic per finding tried to refute it by reading and running the code. **20 findings: 17
verified real** (4 medium after de-duplication: one regression, one injection the diff missed, one weak test; the rest low),
**3 refuted** with reasons.

Every real finding got a test first. On the I5c code **18 new or strengthened cases failed**; the others are pins that already
passed and were kept because the reviewer showed the earlier tests could not tell the fix from its absence — each pin was
proven by reverting its control and watching the test fail (chat link policy, both string-aware indents, native placement
neutralisation, the DRU own-property lookup: all five mutants killed).

| finding (severity) | fix |
|---|---|
| the app's own export of a pinned part wrote an EMPTY Datasheet (the snapshot adapter hard-coded `null`) (medium) | the published symbol's own Datasheet property, through the link policy; a fixture-runtime route test drives the REAL loader (no catalog mock) and finds the NE555's datasheet on both the library block and the placed instance |
| a silk text anchor was written into `.kicad_pcb` by hand: `left))) (gr_text … (layer "F.Cu") …` became sibling nodes, on the public export route and into kicad-cli (medium; row 04's control did not hold for every input) | only `left`/`center`/`right`, through the validated token layer (`KicadEmitError` otherwise). Every other hand-built child in the eight PCB writers was audited: numbers, `q()`-quoted strings or constants only |
| the row-16 test passed even if the route trusted body selections again (its forged block was malformed, and its server license forced 422 anyway) (medium) | a WELL-FORMED forged symbol with a forged license (must export the server's symbol, 200, no injected text) and a server-prohibits/body-allows case (must be `EXPORT_LICENSE_PROHIBITED`); the single-definition case asserts its code and issue |
| the embedded `lib_symbols` block still carried a `file:`/UNC Datasheet (row 35 half applied) (low, two lenses) | the Datasheet property inside the embedded block goes through the same policy (refused → `~`; other properties byte-for-byte) for catalog and pinned parts |
| 80 of ~20 000 upstream KiCad datasheets are written `www.host/…` with no scheme and were dropped at export and ingest (low) | a scheme-less `www.` DOCUMENT link is read as `https://www.…` and must then pass every rule; a vendor page link must still carry its scheme |
| the export loaded one full snapshot per INSTANCE, sequentially, and reported a database outage as "not published" (low, two lenses) | one load per revision, four at a time; a loader that throws is `503 EXPORT_CATALOG_UNAVAILABLE`, logged redacted, never 422 |
| the kicad-default pick-and-place Side column wrote the stored text (low) | a closed token, as in the other formats |
| the BOM CSV link columns skipped the policy the packet and view use (low) | datasheet through the document policy; product URL through the shared distributor-page helper |
| the chat link assertions passed with the old unfiltered renderer (react-markdown already empties `javascript:`/`file:`) (low) | protocol-relative, IP-literal, credentialed, `xmpp:`, relative-path and local-host links must render as text; the host label, a mail link and a GFM autolink are asserted exactly |
| the image policy header was tested only as config, and the artifacts claimed CI browser proof that did not exist (low) | `e2e/security-headers.spec.ts`: the page and an API response carry `img-src 'self' data: blob:` in the running app; the false sentence above is struck and corrected |
| the string-aware indents and the power-label escaping had no test (low) | unit and export cases for both indents and a power label with a newline |
| native placement neutralisation and the DRU own-property lookup had no test (low) | both pinned |
| the BOM view and library panel link policy was guarded only by `safeHref(` regexes; the local-name rule was untested (low) | one `DatasheetLink` component (library panel, part inspector) rendered in tests, `vendorProductPageUrl`/`offerLinkUrl` in `distributor-links` (BOM view, BOM CSV) tested directly; tripwires require them and forbid a stored link straight into an `<a href>`; six local host names refused |

**Decision recorded (regression half kept):** a pinned part's library item is still named after its exact MPN
(`Timer:NE555DR`, not the catalog row's `Timer:NE555D`). Two pinned revisions share one KiCad symbol name whenever they share a
symbol (every resistor value is `Device:R`), so naming by symbol would put two different definitions under one `lib_id`; the
exact MPN is unique per pinned part and the file embeds every definition it uses. Stage 5 designed and tested the pinned export
this way; I5c made the app's own export use it. Cost, stated plainly: KiCad's "Update symbols from library" does not find
`Timer:NE555DR` in the stock library.

Refuted: regional distributor domains (no live source produces one — Mouser is disabled, DigiKey sends no locale, Octopart links
are on octopart.com); a `KicadEmitError` answering 500 on the PCB export (fails closed, same convention as `BoardIntegrityError`
on that route); the FreeRouting DSN writer's own unquoted stackup tokens (not in the I5c diff or rows). The DSN finding is real
in its own right — an authenticated caller's stackup names, directions and costs are written unquoted into the file handed to
the FreeRouting subprocess, and its `q()` does not escape newlines — so it is **added to I5e** as row 52 rather than dropped.
