# Sirkit Stage 5: Enriched Atomic Component Library

Date: 2026-07-17  
Branch: `codex/stage-05-enriched-atomic-component-library`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`

## 1. Executive implementation summary

The old library path treated a mutable `parts` row as a component. That row combined a KiCad symbol, optional MPN strings, a footprint hint, heuristic string specifications, and a mutable distributor view. Schematic instances pinned only `partId`. Footprint assignment called a syntactically valid symbol `Footprint` property “trusted” and used category defaults. The later Stage 1 PCB boundary did exact pin/pad accounting, but neither the project nor the library could prove which immutable symbol, footprint, package evidence, claim revisions, licenses, or source documents had been selected.

Stage 5 adds an additive atomic domain under `app/lib/atomic` and PostgreSQL migrations `0006`/`0007`. An atomic revision binds exact, independent symbol/footprint/model versions, an exact terminal mapping certificate, typed claims, guidance, sources, licenses, supplier snapshots, and a semantic hash. Symbols, footprints, and models are not merged. Raw bytes are content addressed and travel in portable project snapshots when publication policy permits.

The implementation also adds:

- deterministic manufacturer/MPN/SKU/generic identities;
- per-claim truth and evidence states independent of publication state;
- bounded KiCad parsing and deterministic library-table resolution;
- explicit unsupported-semantics diagnostics;
- package proof and exact terminal → symbol pin → logical pad → physical pad certificates;
- typed SI quantities, ranges, tolerances, conditions, and limit semantics;
- non-executable, evidence-backed guidance templates;
- quarantine and role-gated atomic publication;
- structured hard/soft deterministic search plus agent-safe read/propose tools;
- exact project pins, offline snapshots, upgrade diffs, and prior-stage invalidation;
- read-only KiCad HTTP-library endpoints with backend token authentication;
- legacy adapters that expose uncertainty instead of manufacturing enrichment.

The original `C:\Users\robsa\sirkit` tree was not modified.

## 2. Prerequisite evidence

Before Stage 5 implementation, the Stage 1–4 prerequisite gate ran:

```text
npx vitest run data-integrity pin-pad-mapping locked-copper-integrity \
  net-reconciliation electrical-truth electrical-consistency readiness-policy \
  schematic-parity dsn-integrity read-ses autoroute-verification build-bundle \
  native-fab release-persistence stage-04-native-planes copper-policy drc-clearance
```

Result: 17 files and 94 tests passed.

Verified guarantees included stable component/net identities, exact pin/pad mapping, atomic PCB sync rejection, locked-copper preservation, authoritative electrical parity, unknown/stale readiness behavior, native plane/fill provenance, DSN/SES integrity, and manufacturing release persistence.

## 3. Domain and identity specification

```text
Manufacturer ──< Family ──< Exact manufacturer part ──< Supplier part/SKU
                               │
Generic device ────────────────┤ (exactly one identity kind)
                               v
                     Atomic part revision
                     ├── Symbol asset version ──> raw content object
                     ├── Footprint asset version ──> raw content object
                     ├── 0..n 3D model versions ──> raw content objects
                     ├── Mapping certificate
                     ├── Engineering claims ──> evidence ──> source revision
                     ├── Guidance ─────────────> evidence ──> source revision
                     ├── License dispositions
                     └── Supplier offer snapshots
                               │
                               v
                  Selection record / project instance pin
```

Identity rules:

- Manufacturer IDs are explicit; similar names never fuzzy-merge.
- Exact part identity is manufacturer ID plus exact published MPN. A separate NFKC/uppercase/alphanumeric key is search-only.
- Package, temperature, qualification, voltage, packing, firmware, and other suffix variants remain separate exact parts.
- Supplier SKU and packaging/region are distinct from MPN.
- Generic devices have no invented manufacturer or MPN.
- Design instances remain separate schematic objects.
- Asset version IDs include immutable byte hash plus independent source/license binding. `contentHash` permits deduplication without erasing source identity.
- Atomic revisions and mapping certificates are immutable and semantic-hash identified.
- Terminal layers remain distinct: manufacturer terminal → symbol electrical pin → schematic pin instance → logical pad number → physical pad instances.
- A project selection pins atomic revision, symbol, footprint, model, certificate, selection rationale, catalog snapshot, and portable static/raw evidence.

## 4. Publication and claim-state model

Record states are `quarantined`, `draft`, `needs_review`, `approved`, `published`, `deprecated`, `revoked`, and `superseded`. Claim states are independently `source_backed`, `verified`, `inferred`, `conflicting`, `unknown`, `stale`, or `not_applicable`.

Legal workflow transitions are explicit. Ingestion workers/reviewers/agents may submit; only reviewers may approve; only publishers/admins may publish, deprecate, revoke, or supersede. `llm:*`, `ocr:*`, and agent roles cannot approve or publish. Publishing does not upgrade individual claim truth.

Safety-critical conflicts, missing evidence, invalid/missing assets, non-exportable licenses, missing primary bundles, and profile-specific missing mapping/model/sourcing evidence block approval. Deprecation/revocation removes a revision from new-selection indexes but retains immutable history for old projects.

The production repository publishes all identities, sources, raw bytes, assets, claims, guidance, certificates, revision, and audit event in one PostgreSQL transaction. Any FK/index/validation failure rolls back the entire publication.

## 5. KiCad compatibility matrix

Official references used to verify the boundary:

- [KiCad S-expression format](https://dev-docs.kicad.org/en/file-formats/sexpr-intro/index.html)
- [KiCad symbol library format](https://dev-docs.kicad.org/en/file-formats/sexpr-symbol-lib/)
- [KiCad footprint library format](https://dev-docs.kicad.org/en/file-formats/sexpr-footprint/)
- [KiCad HTTP libraries](https://dev-docs.kicad.org/en/apis-and-binding/http-libraries/index.html)
- [KiCad 9 schematic editor/library manual](https://docs.kicad.org/9.0/en/eeschema/eeschema.pdf)

KiCad documents S-expression symbol/footprint libraries from KiCad 6 onward, date-version headers, multiple symbols per `.kicad_sym`, one footprint per `.kicad_mod`, project/global tables and path variables, and read-only token-authenticated HTTP libraries. The Sirkit parser’s product gate accepts modern date versions `20210108` through `20269999`; exercised fixtures include `20231120`, `20240108`, and repository KiCad 10-era `20260206` footprints. This range is a Sirkit policy, not a claim that every token in every date is implemented.

| KiCad format/library type | Supported versions | Read | Write | Preserved semantics | Explicit limitations |
|---|---|---:|---:|---|---|
| `.kicad_sym` | Modern S-expression date versions in policy range | yes | no new library writer | inheritance link, resolved units/bodies, pin geometry/type/hidden/stacked identity, fields, filters, raw source/render symbol | alternate pin functions/swap-group tokens quarantine as unsupported |
| `.kicad_mod` | legacy `module` plus modern date versions in policy range | yes | verbatim re-emission/project use | exact pad instance/number/type/shape/position/rotation/layers/drill/plating/mask/paste, fab/silk/courtyard, model refs | custom/trapezoid approximation, footprint zones/keepouts/groups/net ties quarantine and cannot approve |
| STEP/WRL model | format allowlist | safe resolve/hash/record | no conversion writer | source/license/hash/reference transform, missing/blocked state | no geometry parser/bounding-box extractor or converter is claimed |
| `sym-lib-table` / `fp-lib-table` | modern S-expression | yes | no | nickname, type, URI, scope, order, project-over-global shadowing, permitted variables | same-scope collision and unresolved paths are unusable diagnostics |
| Internal PostgreSQL view | Stage 5 schema | yes | transactional server publication | exact IDs, JSON snapshots, claims, evidence, assets, selection records | not an installed KiCad ODBC `.kicad_dbl` configuration |
| KiCad HTTP library | current official REST-like contract | yes, read-only | no | endpoint discovery, categories, part summaries/details, all-string fields, exact symbol/footprint references | requires `KICAD_HTTP_LIBRARY_TOKEN`; no write API |
| KiCad schematic export | Sirkit exporter, KiCad 10-era output | yes (source state) | `.kicad_sch` | pinned symbol revision, approved footprint field, exact IDs in project data | not a full bidirectional KiCad project round trip |

Third-party generator output remains identified as Sirkit; it does not impersonate `kicad_symbol_editor` or `pcbnew`.

## 6. Mapping certificate specification

Each certificate contains exact part/generic identity, exact symbol and footprint version IDs, required terminal IDs, every symbol-pin identity by unit/body, mapped logical pad numbers, physical pad IDs, missing pins/pads, extra electrical pads, ambiguity, mechanical pads, exposed-pad IDs, NC/DNC/NU classifications, internally common groups, evidence, package proof, schema/validator versions, state, and semantic hash.

Coverage uses unique electrical pin/pad identifiers, not counts. Alternate graphical bodies may duplicate a symbol number without multiplying physical pads. Multiple physical pads may share one logical number. NPTH/unnumbered pads remain mechanical. Exposed pads remain electrical and explicit. NC, DNC, NU, unknown, and mechanical are not synonyms.

Package proof may include exact package code, mounting technology, pin count/numbering, pitch, body/lead dimensions, exposed-pad geometry, orientation, and recommended land-pattern evidence. The builder independently checks proof revision, exact part, mounting technology, and electrical pad identity count. Names/filters are candidates only.

Regression evidence:

```text
Before unsafe pattern: symbol pins {1,3}; footprint pads {1,2}; equal count = 2.
After Stage 5: certificate state = missing/ambiguous;
  missingPadNumbers = {3}; extraElectricalPadNumbers = {2}; never approved.
```

Stale/missing/ambiguous certificates cannot become `PCB-assignable`. Exact Stage 5 instances reaching schematic-to-PCB sync without their bound approved assignment are rejected before footprint fallback.

## 7. Engineering claim schema

`Quantity` stores SI-normalized scalar/range/min/typ/max/tolerance values plus dimension, source unit, and original source text. Supported dimensions cover dimensionless, voltage, current, resistance, capacitance, inductance, power, frequency, time, temperature, length, and mass. Invalid units, non-finite values, reversed ranges, and dimension mismatches throw/quarantine.

Limit semantics are separate: absolute maximum, recommended operating, guaranteed, typical, nominal, test condition, characterization-only, configurable, and derating. Search requires matching semantics; a 6 V absolute maximum cannot satisfy a 5.5 V recommended-operating requirement.

Claims carry stable ID, typed facet, property, normalized value, conditions, scope, truth state, evidence IDs, conflicts/supersession, and safety criticality. Common and representative category facets are enumerated; organization extensions are explicit. Unsupported category facts remain source-backed unknown/unstructured records rather than invented fields.

Effective-claim policy uses explicit source precedence. Retrieval time never overwrites a conflict. An unreviewed safety-critical conflict has no effective claim. Supplier availability remains in expiring snapshots and never mutates static part identity.

## 8. Guidance schema

Guidance has category, status, scope, conditions, normalized template, source text, evidence, and `executable: false`. Supported representative templates include decoupling, regulator input/output capacitor and ESR review, thermal-pad connection/copper, boot strap, reset, DNC, layout review/compact loop/near-terminal, and conditional reference designs.

Validation rejects unsupported actions, absent evidence/source text, any Stage 5 executable claim, and primitive numeric values not present in source text. Typed quantities may carry their own sourced representation. Vague “place close” prose therefore cannot become an invented 2 mm rule.

These are facts/templates/review items only. Stage 6 executable constraint/ERC enforcement is not implemented or claimed.

## 9. Ingestion architecture

The enforced pipeline is:

```text
quarantine → parse → normalize → validate → reconcile → review → immutable publish
           ↘ rejected at every boundary
```

Implemented adapters/boundaries:

- bounded local KiCad S-expression/library-table parsing;
- content-addressed raw quarantine objects;
- a paginated source-adapter interface with timeout, bounded retry/backoff, cursor-loop protection, host policy, and redacted errors;
- recorded deterministic source-adapter fixtures;
- OCR/LLM extraction demotion to `inferred` with mandatory evidence locator;
- transactional PostgreSQL publication repository;
- legacy KiCad/distributor rows exposed only through a draft compatibility adapter.

No live manufacturer datasheet, OCR service, distributor-to-atomic, or third-party CAD connector is claimed. Existing distributor code remains the legacy BOM source until a reviewed atomic adapter/migration is installed.

## 10. Validation and approval matrix

| Approval profile | Required assets | Required claims/evidence | Permitted unknowns | Blocking conflicts |
|---|---|---|---|---|
| Schematic-only | primary valid symbol, bound exportable asset license | all trusted/safety-critical claims have evidence | footprint, model, sourcing may be absent | invalid symbol, identity XOR failure, safety conflict, missing/non-exportable license |
| PCB-assignable | schematic requirements + exact valid footprint + approved current mapping/package certificate | mapping/package evidence | 3D model and live sourcing may be absent | missing/stale/ambiguous map, invalid/unsupported footprint, asset/license mismatch |
| Mechanically complete | PCB requirements + safely inspected exact 3D models | model source/license/hash | non-mechanical sourcing unknowns | missing/blocked/uninspected model, mechanical/license conflict |
| Sourcing current | selected engineering profile + exact supplier/offer snapshot | supplier source and unexpired observation | unrelated optional offers | missing/expired/stale offer, supplier/MPN mismatch |

## 11. Search/selection contract

`ComponentQuery` binds query ID, catalog snapshot, policy version, identity/category, approval profile, hard criteria, weighted soft criteria, unknown policy, and result limit. Hard failures/conflicts never relax. Unknown/stale facts block unless the caller explicitly selects `allow_with_warning`. Results retain criterion outcomes, claim IDs, explanations, conflicts, unknowns, freshness, score, and deterministic revision-ID tie break.

The server exposes a structured atomic search endpoint and catalog snapshot ID. Fixed input/catalog/policy produces fixed ordering. Zero qualifying rows means no confirmed match.

Agent tools can search, get/compare revisions, retrieve evidence, and propose a selection. A proposal is not a persisted selection until explicit user confirmation. They cannot approve, publish, query arbitrary SQL, see raw credentials, or invent a missing claim.

## 12. Project pinning and upgrade contract

Every exact selection stores atomic revision ID, exact CAD asset IDs, mapping certificate ID, catalog snapshot, query/results/rationale, actor, and a portable snapshot containing static identity, claims, evidence, licenses, sources, raw CAD bytes, and supplier snapshots. Legacy projects load with no fabricated pins.

Upgrade diff classes are metadata-only, supplier-only, symbol-pin, footprint-geometry, pin-map, rating/guidance, license, and revoked-target. Symbol/mapping changes invalidate electrical parity; footprint changes invalidate mapping/placement/routing/DRC; claim/guidance changes invalidate readiness/release; license changes invalidate release. Unsafe changes are never automatic. Application requires exact from/to binding, a matching target portable snapshot, no blockers, and user confirmation.

Deprecated/revoked records remain inspectable offline. Revoked records cannot be newly selected. Catalog updates never mutate the embedded snapshot.

## 13. Consumer migration table

| Consumer | Old source/assumption | New atomic API/adapter | Compatibility behavior | Tests |
|---|---|---|---|---|
| Part browser | mutable `parts` rows | legacy-to-atomic draft envelope; published atomic browse/search API | old rows remain visible and are labeled unapproved | compatibility/UI type tests + build |
| Schematic | `partId` only | optional exact atomic/symbol/footprint/map/selection IDs | old instances remain unresolved; no fabricated IDs | project persistence/cross-consumer |
| Footprint resolution | hint/default described as trusted | `proofState`; only exact atomic bundle is approved | hint/default remain candidates | compatibility + mapping tests |
| PCB sync | hint/heuristic then Stage 1 mapping | exact instances require matching approved assignment/certificate | legacy path retains Stage 1 exact rejection | cross-consumer + prior Stage 1 suite |
| AI tools | embedding/LLM discovery returned mutable part IDs | deterministic atomic search and read/propose-only agent tools | main Build loop still uses legacy discovery (remaining gap) | search/agent tests |
| BOM/manufacturing | live mutable metadata by `partId` | optional project selection snapshots; CSV includes atomic revision | legacy fallback remains | BOM cross-consumer/formula tests |
| KiCad import/export | mutable cached symbol + footprint hint | exact snapshot → renderer consumer, approved footprint, content manifest, read-only HTTP library | legacy export retained | adapter/export/HTTP tests |
| Project persistence | localStorage state/PCB only | exact per-instance pins and portable raw/static snapshot | old JSON migrates without enrichment | jsdom persistence tests |

## 14. Security and licensing report

Implemented controls include 8 MiB text, 100 MiB model, depth 160, one-million-token, archive entry/expanded-size/ratio limits; full-document/trailing-content parsing; permitted roots/variables/extensions; realpath symlink re-check; HTTPS/host/private-IP/redirect policy; bounded network timeout/retry/pagination; token redaction; spreadsheet formula neutralization; backend-only constant-time KiCad HTTP token checks; LLM/OCR non-approval; confidential-content publication block; content hashes; immutable raw evidence; and per-asset raw/derived/export license dispositions.

Unknown/restricted license is not permission. Byte-identical mirrors retain separate source/license version identity. Publication validates asset raw object, content hash binding, source record, and license.

Remaining restrictions: DNS rebinding resolution is delegated to a future hardened HTTP transport; there is no untrusted 3D geometry parser/converter; archive limits are available but no Stage 5 archive connector is installed; database migration was generated but not applied to an external database during this protected-copy task.

## 15. Files changed

Major groups:

- Domain/services: `app/lib/atomic/{types,identity,stable,quantity,claims,guidance,mapping,validation,catalog,ingestion,search,project,portable,agent-tools,compatibility}.ts`
- KiCad/security/adapters: `kicad-assets.ts`, `library-resolver.ts`, `kicad-adapters.ts`, `security.ts`, `server-auth.ts`, `server-catalog.ts`, `server-search.ts`, `server-repository.ts`
- Database/migrations: `app/lib/db/schema.ts`, `drizzle/0006_stage05_atomic_component_catalog.sql`, `drizzle/0007_stage05_atomic_raw_content.sql`, Drizzle metadata
- APIs: `/api/components/atomic`, `/api/components/atomic/search`, `/api/kicad/v1/**`, enhanced `/api/parts/[id]`, enhanced `/api/export/kicad`
- Consumers: BOM/CSV, KiCad schematic export, part cache/browser trust label, schematic types, project persistence, footprint assignment, PCB netlist bridge
- KiCad parsers: richer symbol unit/body/hidden/stacked pin metadata and footprint plating/mask/paste overrides
- Fixtures/tests: seven Stage 5 test files, original MIT fixture corpus, fixture license record
- Documentation: this report and `progress/2026-07-17/03-stage-05-enriched-atomic-component-library.md`

## 16. Test evidence

Commands used:

```text
npx vitest run app/lib/atomic/__tests__ --reporter=dot
npx vitest run --reporter=dot
npx tsc --noEmit --pretty false
npx eslint <Stage 5 production/test/consumer files>
npm run build
npx drizzle-kit generate --name stage05_atomic_component_catalog
npx drizzle-kit generate --name stage05_atomic_raw_content
```

Evidence covered exact equal-count mismatch rejection; one-to-one/repeated/multi-unit/hidden/exposed/mechanical/NC/DNC mappings; version-aware parsing/inheritance; typed units/ranges/temperature/conditions/limit semantics; conflict policy; stale sourcing; quarantine and LLM non-approval; license rejection; deterministic search/no-match/ties; immutable pins and unsafe upgrades; KiCad database-view/HTTP/export contracts; size/depth/path/SSRF/archive/secret/formula security; transactional rollback; and Stage 1–4 regressions.

Final verification on 2026-07-17:

- Stage 5 atomic suite: **7 files passed, 75 tests passed**.
- Full repository suite: **111 files passed, 2 skipped; 697 tests passed, 9 skipped (706 total)**.
- TypeScript: `npx tsc --noEmit --pretty false` passed.
- Focused ESLint over all Stage 5 production, API, test, and migrated consumer surfaces passed.
- Production build: `npm run build` passed, including the new atomic catalog/search and KiCad HTTP-library routes. Turbopack retained five pre-existing broad file-tracing warnings around dynamic FreeRouting/NGSpice executables; there were no compilation errors.
- A first full-suite run executed concurrently with the production compiler and one 250 ms performance assertion measured 265.5 ms. The affected test then passed alone, and the complete suite passed when rerun without the competing compiler workload.
- Both Drizzle migrations and metadata snapshots generated successfully. They were not applied to an external database.

Live manufacturer/distributor APIs, external ODBC KiCad, filesystem symlink creation, and external KiCad CLI tests remain intentionally isolated/not run in the core suite.

## 17. Corpus and performance report

The checked-in original MIT corpus has 16 categories: generic resistor; exact resistor/capacitor; multi-unit op-amp; MCU domains; regulator/exposed pad; connector mechanical/common pads; thermal/paste aperture case; dense BGA/QFN; suffix variants; filter-many/proof-one; missing 3D; equal-count mismatch; source conflict; stale offer; restricted CAD policy; and malformed/security boundaries. No third-party datasheet/CAD/model response is embedded.

The deterministic dense-mapping test validates 1,000 terminals/pads under a 1,000 ms gate. Full-suite PCB performance gates also remain active. Database cold/warm indexing/import throughput and live query latency were not measured because migrations were not applied to an external PostgreSQL instance; no extrapolated numbers are claimed.

## 18. Compatibility notes

- Theory/generic components remain valid generic devices; no MPN is invented.
- Existing KiCad instances keep `partId`; missing enrichment remains explicit.
- Old footprint hints/defaults remain candidates and Stage 1 exact accounting remains active.
- Existing caches receive an additive draft compatibility envelope.
- Projects without `componentSelections` load unchanged.
- Missing 3D is acceptable for schematic/PCB profiles, not mechanical completion.
- Legacy symbol/footprint tables remain discovery indexes. Atomic publication tables are the approval authority.
- OpenAI embeddings/retrieval are unchanged; Stage 5 structured selection is deterministic and separate from embedding recall.
- Schema/API additions are additive and versioned.

## 19. Remaining risks

- **Confirmed remaining defect/integration gap:** the main Build AI loop and manual placement browser still select legacy `partId` discovery rows. They are labeled/draft-adapted but not yet switched to confirmed atomic selection records.
- **Confirmed remaining integration gap:** the main project/browser UI does not yet expose the review queue, hard/soft atomic query editor, evidence viewer, or upgrade confirmation flow.
- **Data-quality/review backlog:** no approved atomic catalog population/migration job has reviewed existing ~legacy KiCad/distributor rows, so the new published catalog may initially be empty.
- **Source limitation:** no live manufacturer datasheet/OCR/distributor/third-party CAD adapter is installed in the atomic pipeline.
- **Unsupported format/category:** alternate pin functions/swap groups, footprint-local zones/keepouts/net ties/custom pad semantics, and deterministic 3D geometry inspection remain explicit unsupported cases.
- **Unverified deployment requirement:** migrations and transactional publication/search need PostgreSQL integration/load testing in the deployment environment.
- **Performance backlog:** database cold/warm indexing, large-catalog query latency, cache hit rate, storage growth, and concurrent publisher contention are not yet measured.
- **Later-stage requirement:** executable hierarchical constraints/ERC/application-rule enforcement belongs to Stage 6 and is not implemented.

## 20. Completion verdict

STAGE 5 INCOMPLETE — the integrity core, schema, parsers, evidence model, mapping proof, deterministic search, project pins, security controls, HTTP/KiCad adapters, and consumer compatibility seams are implemented and tested, but completion is blocked by the still-legacy main Build AI/manual placement path, missing review/upgrade UI, absent approved-catalog population/live source adapters, unsupported advanced KiCad/3D semantics, and unrun deployed-PostgreSQL scale/concurrency validation.
