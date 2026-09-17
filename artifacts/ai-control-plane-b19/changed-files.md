# B19 — changed files (`5a59a1f` → `bf88eba`, branch `chapter/b19-external-acquisition`)

342 files changed, 30994 insertions, 1366 deletions, over 31 commits. Generated from `git diff --numstat 5a59a1f...HEAD`; A = added, M = modified, D = deleted.

## acquisition and distributors (21 files)

| file | | + | − |
|---|---|---|---|
| `app/lib/acquisition/admission-control.ts` | A | 193 | 0 |
| `app/lib/acquisition/agent-read-port.ts` | A | 271 | 0 |
| `app/lib/acquisition/external-search-contract.ts` | A | 99 | 0 |
| `app/lib/acquisition/external-search.ts` | A | 264 | 0 |
| `app/lib/acquisition/import-review.ts` | A | 152 | 0 |
| `app/lib/acquisition/offer-cache-observations.ts` | A | 69 | 0 |
| `app/lib/acquisition/quarantine.ts` | A | 389 | 0 |
| `app/lib/acquisition/source-labels.ts` | A | 86 | 0 |
| `app/lib/acquisition/source-registry.ts` | A | 740 | 0 |
| `app/lib/distributors/cache.ts` | M | 188 | 48 |
| `app/lib/distributors/clients.ts` | A | 36 | 0 |
| `app/lib/distributors/digikey.ts` | M | 85 | 37 |
| `app/lib/distributors/egress.ts` | A | 104 | 0 |
| `app/lib/distributors/index.ts` | M | 301 | 92 |
| `app/lib/distributors/lcsc.ts` | M | 6 | 6 |
| `app/lib/distributors/lifecycle-sql.ts` | A | 23 | 0 |
| `app/lib/distributors/lifecycle.ts` | M | 4 | 1 |
| `app/lib/distributors/mouser.ts` | M | 51 | 26 |
| `app/lib/distributors/octopart.ts` | M | 123 | 28 |
| `app/lib/distributors/offer-selection.ts` | A | 15 | 0 |
| `app/lib/distributors/types.ts` | M | 86 | 9 |

## atomic catalog and physical binding (28 files)

| file | | + | − |
|---|---|---|---|
| `app/lib/atomic/authoring.ts` | A | 424 | 0 |
| `app/lib/atomic/catalog.ts` | M | 25 | 4 |
| `app/lib/atomic/claims.ts` | M | 45 | 9 |
| `app/lib/atomic/compatibility.ts` | M | 1 | 1 |
| `app/lib/atomic/identity.ts` | M | 34 | 0 |
| `app/lib/atomic/ingestion.ts` | M | 33 | 5 |
| `app/lib/atomic/kicad-adapters.ts` | M | 4 | 1 |
| `app/lib/atomic/kicad-assets.ts` | M | 70 | 21 |
| `app/lib/atomic/mapping.ts` | M | 80 | 0 |
| `app/lib/atomic/project.ts` | M | 27 | 3 |
| `app/lib/atomic/publication-review-contract.ts` | A | 258 | 0 |
| `app/lib/atomic/publication-review.ts` | A | 808 | 0 |
| `app/lib/atomic/quantity.ts` | M | 32 | 2 |
| `app/lib/atomic/revision-status-sql.ts` | A | 32 | 0 |
| `app/lib/atomic/revision-status.ts` | A | 139 | 0 |
| `app/lib/atomic/search.ts` | M | 15 | 3 |
| `app/lib/atomic/security.ts` | M | 55 | 4 |
| `app/lib/atomic/server-catalog.ts` | M | 128 | 4 |
| `app/lib/atomic/server-repository.ts` | M | 297 | 11 |
| `app/lib/atomic/server-search.ts` | M | 20 | 3 |
| `app/lib/atomic/validation.ts` | M | 104 | 0 |
| `app/lib/atomic/value-key.ts` | M | 41 | 11 |
| `app/lib/physical-binding/atomic-binding.ts` | M | 35 | 9 |
| `app/lib/physical-binding/atomic-successor.ts` | A | 174 | 0 |
| `app/lib/physical-binding/repository.ts` | M | 5 | 0 |
| `app/lib/physical-binding/review-handoff.ts` | M | 31 | 7 |
| `app/lib/physical-binding/server-repository.ts` | M | 3 | 1 |
| `app/lib/physical-binding/staged-repository.ts` | A | 98 | 0 |

## routes (app/api) (31 files)

| file | | + | − |
|---|---|---|---|
| `app/api/bom/_failure.ts` | A | 20 | 0 |
| `app/api/bom/cart/digikey/route.ts` | M | 6 | 7 |
| `app/api/bom/cart/lcsc/route.ts` | M | 6 | 7 |
| `app/api/bom/cart/mouser/route.ts` | M | 6 | 7 |
| `app/api/bom/diff/route.ts` | M | 9 | 6 |
| `app/api/bom/export-csv/route.ts` | M | 6 | 14 |
| `app/api/bom/notifications/route.ts` | M | 4 | 6 |
| `app/api/bom/procurement-packet/route.ts` | M | 12 | 10 |
| `app/api/bom/route.ts` | M | 18 | 16 |
| `app/api/bom/snapshot/route.ts` | M | 9 | 10 |
| `app/api/chat/authority-cancellable-reads.ts` | M | 43 | 4 |
| `app/api/chat/component-authority-runtime.ts` | M | 5 | 1 |
| `app/api/chat/external-acquisition-runtime.ts` | A | 37 | 0 |
| `app/api/chat/replacement-facts-runtime.ts` | M | 7 | 4 |
| `app/api/chat/route.ts` | M | 13 | 2 |
| `app/api/circuit-knowledge/propose/route.ts` | M | 1 | 1 |
| `app/api/components/atomic/publication/handler.ts` | A | 185 | 0 |
| `app/api/components/atomic/publication/route.ts` | A | 59 | 0 |
| `app/api/components/atomic/route.ts` | M | 4 | 3 |
| `app/api/components/revision-status/route.ts` | A | 45 | 0 |
| `app/api/export/kicad/route.ts` | M | 76 | 15 |
| `app/api/kicad/v1/parts/category/[id]/route.ts` | M | 3 | 2 |
| `app/api/parts/[id]/alternates/route.ts` | M | 6 | 3 |
| `app/api/parts/[id]/route.ts` | M | 24 | 5 |
| `app/api/parts/external-search/route.ts` | A | 47 | 0 |
| `app/api/parts/search/route.ts` | M | 4 | 3 |
| `app/api/pcb/autoroute/route.ts` | M | 1 | 1 |
| `app/api/physical-bindings/route.ts` | M | 69 | 8 |
| `app/api/replacement-authority/route.ts` | M | 4 | 3 |
| `app/api/schematic/cross-verify/route.ts` | M | 14 | 77 |
| `app/api/simulate/route.ts` | M | 18 | 8 |

## agent, engineering registries and prompts (21 files)

| file | | + | − |
|---|---|---|---|
| `app/lib/agent/acquisition-reads.ts` | A | 525 | 0 |
| `app/lib/agent/context.ts` | M | 8 | 1 |
| `app/lib/agent/contracts.ts` | M | 3 | 0 |
| `app/lib/agent/gateway.ts` | M | 26 | 4 |
| `app/lib/agent/loop.ts` | M | 33 | 1 |
| `app/lib/agent/redaction.ts` | M | 21 | 0 |
| `app/lib/build-loop.ts` | M | 53 | 9 |
| `app/lib/engineering/action-registry.ts` | M | 9 | 4 |
| `app/lib/engineering/agent-exposure.ts` | M | 2 | 0 |
| `app/lib/engineering/component-authority-source.ts` | M | 29 | 1 |
| `app/lib/engineering/component-authority.ts` | M | 20 | 0 |
| `app/lib/engineering/control-registry.ts` | M | 10 | 1 |
| `app/lib/engineering/granted-execution-families.ts` | M | 2 | 0 |
| `app/lib/engineering/permission-tiers.ts` | M | 3 | 2 |
| `app/lib/engineering/replacement-pin-facts.ts` | M | 7 | 0 |
| `app/lib/engineering/schematic-read.ts` | M | 16 | 8 |
| `app/lib/engineering/tool-catalog.ts` | M | 44 | 1 |
| `app/lib/engineering/tool-discovery.ts` | M | 2 | 1 |
| `app/lib/engineering/tool-registry.ts` | M | 14 | 1 |
| `app/lib/llm/context.ts` | M | 9 | 1 |
| `app/lib/prompts.ts` | M | 15 | 2 |

## KiCad, PCB and constraints (15 files)

| file | | + | − |
|---|---|---|---|
| `app/lib/constraints/kicad-dru.ts` | M | 17 | 3 |
| `app/lib/kicad/extract.ts` | M | 150 | 88 |
| `app/lib/kicad/pinned-checkout.ts` | A | 73 | 0 |
| `app/lib/kicad/sexp.ts` | M | 56 | 25 |
| `app/lib/pcb/autonomous/production-router.ts` | M | 9 | 2 |
| `app/lib/pcb/autoroute/freerouting-pass-executor.ts` | M | 3 | 2 |
| `app/lib/pcb/dsn/write-dsn.ts` | M | 51 | 9 |
| `app/lib/pcb/fab/emit-bom.ts` | M | 3 | 1 |
| `app/lib/pcb/fab/emit-position.ts` | M | 6 | 3 |
| `app/lib/pcb/fab/native/ancillary.ts` | M | 4 | 2 |
| `app/lib/pcb/kicad-mod.ts` | M | 1 | 1 |
| `app/lib/pcb/kicad/emit-footprint.ts` | M | 19 | 3 |
| `app/lib/pcb/kicad/emit-silk.ts` | M | 8 | 3 |
| `app/lib/pcb/kicad/layer-map.ts` | M | 2 | 0 |
| `app/lib/pcb/kicad/sexpr-emit.ts` | M | 64 | 6 |

## BOM (4 files)

| file | | + | − |
|---|---|---|---|
| `app/lib/bom-builder.ts` | M | 57 | 6 |
| `app/lib/bom/build.ts` | M | 115 | 36 |
| `app/lib/bom/line-price.ts` | A | 15 | 0 |
| `app/lib/cart-formats.ts` | M | 57 | 15 |

## project files and schematic libraries (9 files)

| file | | + | − |
|---|---|---|---|
| `app/lib/project/chat-history.ts` | A | 20 | 0 |
| `app/lib/project/file.ts` | M | 167 | 30 |
| `app/lib/project/suggestion-instruction.ts` | A | 44 | 0 |
| `lib/build-auto-layout.ts` | M | 37 | 12 |
| `lib/kicad-placement.ts` | A | 39 | 0 |
| `lib/netlist-crosscheck.ts` | M | 3 | 1 |
| `lib/netlist-review.ts` | M | 16 | 11 |
| `lib/persistence.ts` | M | 33 | 2 |
| `lib/schgen-netlist.ts` | M | 12 | 2 |

## database and migrations (5 files)

| file | | + | − |
|---|---|---|---|
| `app/lib/db/migrations/manifest.ts` | M | 2 | 0 |
| `app/lib/db/migrations/verify-schema.ts` | M | 31 | 0 |
| `app/lib/db/schema.ts` | M | 29 | 0 |
| `drizzle/0029_part_offers_mpn.sql` | A | 14 | 0 |
| `drizzle/0030_atomic_revision_status_events.sql` | A | 36 | 0 |

## UI (10 files)

| file | | + | − |
|---|---|---|---|
| `app/components/bom/BomView.tsx` | M | 510 | 176 |
| `app/components/chat/ChatMarkdown.tsx` | A | 67 | 0 |
| `app/components/editor/BuildLibraryPanel.tsx` | M | 283 | 12 |
| `app/components/parts/AtomicPublicationReviewPanel.tsx` | A | 368 | 0 |
| `app/components/parts/DatasheetLink.tsx` | A | 19 | 0 |
| `app/components/parts/hooks/useAtomicPublicationReview.ts` | A | 152 | 0 |
| `app/components/pcb/ComponentReviewPanel.tsx` | M | 71 | 1 |
| `app/components/pcb/PcbEditor.tsx` | M | 19 | 4 |
| `app/components/pcb/hooks/useComponentReview.ts` | M | 110 | 7 |
| `app/page.tsx` | M | 45 | 84 |

## other app/lib (28 files)

| file | | + | − |
|---|---|---|---|
| `app/lib/alternates.ts` | M | 7 | 6 |
| `app/lib/auth/route-policy.ts` | M | 10 | 1 |
| `app/lib/auth/route-resource-classification.ts` | M | 9 | 0 |
| `app/lib/circuit-knowledge/source.ts` | M | 19 | 1 |
| `app/lib/component-selection/gates.ts` | M | 4 | 2 |
| `app/lib/component-selection/identity.ts` | M | 16 | 5 |
| `app/lib/distributor-links.ts` | M | 27 | 4 |
| `app/lib/execution-grant/mint.ts` | M | 4 | 4 |
| `app/lib/fixture-runtime/blinker/authority.ts` | M | 6 | 1 |
| `app/lib/fixture-runtime/blinker/catalog.ts` | M | 2 | 2 |
| `app/lib/kicad-export.ts` | M | 101 | 8 |
| `app/lib/kicad-power-symbols.ts` | M | 4 | 2 |
| `app/lib/net/external-href.ts` | A | 37 | 0 |
| `app/lib/net/href-policy.ts` | A | 52 | 0 |
| `app/lib/net/ip-policy.ts` | A | 103 | 0 |
| `app/lib/net/outbound-fetch.ts` | A | 234 | 0 |
| `app/lib/parts-cache.ts` | M | 5 | 0 |
| `app/lib/parts-rerank-payload.ts` | A | 31 | 0 |
| `app/lib/parts-search.ts` | M | 23 | 20 |
| `app/lib/pcb-sync/providers.ts` | M | 9 | 0 |
| `app/lib/requirements/source.ts` | M | 36 | 0 |
| `app/lib/requirements/validation.ts` | M | 8 | 1 |
| `app/lib/risk-scoring.ts` | M | 1 | 1 |
| `app/lib/schgen/endpoint-client.ts` | A | 168 | 0 |
| `app/lib/snapshots.ts` | M | 11 | 4 |
| `app/lib/spice/report.ts` | M | 1 | 1 |
| `app/lib/spreadsheet-cell.ts` | A | 10 | 0 |
| `app/lib/untrusted-text.ts` | A | 21 | 0 |

## operator scripts (7 files)

| file | | + | − |
|---|---|---|---|
| `scripts/backfill-parts.ts` | M | 1 | 0 |
| `scripts/compute-alternates.ts` | M | 8 | 3 |
| `scripts/generate-agent-artifacts.ts` | M | 11 | 1 |
| `scripts/generate-b19-source-registry.ts` | A | 26 | 0 |
| `scripts/ingest-footprints.ts` | M | 12 | 14 |
| `scripts/ingest-kicad.ts` | M | 18 | 14 |
| `scripts/refresh-bom-pricing.ts` | M | 22 | 12 |

## tests (128 files)

| file | | + | − |
|---|---|---|---|
| `app/api/__tests__/b16-0-11-tranche-parity.test.ts` | M | 11 | 7 |
| `app/api/__tests__/b16-0-4-bounded-body-behavior.test.ts` | M | 2 | 1 |
| `app/api/__tests__/b16-0-5-media-type-and-wrapper.test.ts` | M | 2 | 1 |
| `app/api/__tests__/b16-1c-invariant-tripwires.test.ts` | M | 11 | 5 |
| `app/api/bom/__tests__/b19-bom-quota.test.ts` | A | 138 | 0 |
| `app/api/bom/__tests__/b19-d-bom-table-bounds.test.ts` | A | 76 | 0 |
| `app/api/bom/__tests__/b19-e-bom-catalog-status-scope.test.ts` | A | 86 | 0 |
| `app/api/chat/__tests__/b13-2-route-authority.test.ts` | M | 13 | 3 |
| `app/api/chat/__tests__/b14-route-replacement.test.ts` | M | 24 | 0 |
| `app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts` | A | 202 | 0 |
| `app/api/chat/__tests__/b19-e-chat-external-acquisition.test.ts` | A | 127 | 0 |
| `app/api/circuit-knowledge/__tests__/b19-d-excerpt-injection.test.ts` | A | 72 | 0 |
| `app/api/components/__tests__/b19-e-atomic-publication-route.test.ts` | A | 288 | 0 |
| `app/api/components/__tests__/b19-e-revision-status-route.test.ts` | A | 178 | 0 |
| `app/api/components/__tests__/b19-e-withdraw-revision-route.test.ts` | A | 229 | 0 |
| `app/api/parts/__tests__/b19-e-external-search-route.test.ts` | A | 177 | 0 |
| `app/api/pcb/autoroute/__tests__/route.test.ts` | M | 11 | 0 |
| `app/api/physical-bindings/__tests__/b16-c-review-handoff.test.ts` | M | 55 | 6 |
| `app/api/physical-bindings/__tests__/b19-e-successor-rebind.test.ts` | A | 433 | 0 |
| `app/api/schematic/__tests__/b19-cross-verify-egress.test.ts` | A | 165 | 0 |
| `app/api/schematic/__tests__/b19-d-schgen-netname-injection.test.ts` | A | 85 | 0 |
| `app/api/simulate/__tests__/b19-d-deck-injection.test.ts` | A | 103 | 0 |
| `app/components/bom/__tests__/b19-e-bom-catalog-status.test.tsx` | A | 92 | 0 |
| `app/components/bom/__tests__/b19-e-bom-workbench.test.tsx` | A | 490 | 0 |
| `app/components/chat/__tests__/b19-d-chat-markdown.test.tsx` | A | 78 | 0 |
| `app/components/editor/__tests__/b19-e-build-library-exact-revision.test.tsx` | A | 70 | 0 |
| `app/components/editor/__tests__/b19-e-build-library-external-search.test.tsx` | A | 200 | 0 |
| `app/components/parts/__tests__/b19-e-atomic-publication-panel.test.tsx` | A | 267 | 0 |
| `app/components/parts/__tests__/b19-e-publication-withdraw-revision.test.tsx` | A | 97 | 0 |
| `app/components/pcb/__tests__/b19-e-component-review-successor.test.tsx` | A | 188 | 0 |
| `app/lib/__tests__/b19-d-build-loop-injection.test.ts` | A | 211 | 0 |
| `app/lib/__tests__/b19-d-href-and-csv-output.test.ts` | A | 176 | 0 |
| `app/lib/__tests__/b19-d-review-input-bounds.test.ts` | A | 71 | 0 |
| `app/lib/__tests__/b19-e-packet-provenance.test.ts` | A | 80 | 0 |
| `app/lib/acquisition/__tests__/b19-admission-control.test.ts` | A | 120 | 0 |
| `app/lib/acquisition/__tests__/b19-d-quarantine-hardening.test.ts` | A | 100 | 0 |
| `app/lib/acquisition/__tests__/b19-e-admission-purpose-share.test.ts` | A | 51 | 0 |
| `app/lib/acquisition/__tests__/b19-e-agent-read-port.test.ts` | A | 432 | 0 |
| `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | A | 149 | 0 |
| `app/lib/acquisition/__tests__/b19-e-external-search-sources.test.ts` | A | 97 | 0 |
| `app/lib/acquisition/__tests__/b19-e-external-search.test.ts` | A | 542 | 0 |
| `app/lib/acquisition/__tests__/b19-e-import-review.test.ts` | A | 138 | 0 |
| `app/lib/acquisition/__tests__/b19-e-live-contract.test.ts` | A | 66 | 0 |
| `app/lib/acquisition/__tests__/b19-e-quarantine-review-fixes.test.ts` | A | 147 | 0 |
| `app/lib/acquisition/__tests__/b19-e-source-labels.test.ts` | A | 70 | 0 |
| `app/lib/acquisition/__tests__/b19-e-source-registry-search.test.ts` | A | 128 | 0 |
| `app/lib/acquisition/__tests__/b19-quarantine-pipeline.test.ts` | A | 193 | 0 |
| `app/lib/acquisition/__tests__/b19-source-registry.test.ts` | A | 149 | 0 |
| `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` | M | 8 | 0 |
| `app/lib/agent/__tests__/b18-c-gateway-execution.test.ts` | M | 4 | 2 |
| `app/lib/agent/__tests__/b19-d-tool-result-hygiene.test.ts` | A | 93 | 0 |
| `app/lib/agent/__tests__/b19-e-external-read-service.test.ts` | A | 596 | 0 |
| `app/lib/atomic/__tests__/_kicad-fixture-library.ts` | A | 34 | 0 |
| `app/lib/atomic/__tests__/_publication-fixtures.ts` | A | 119 | 0 |
| `app/lib/atomic/__tests__/b19-approval-evidence-authority.test.ts` | A | 162 | 0 |
| `app/lib/atomic/__tests__/b19-d-atomic-integrity.test.ts` | A | 222 | 0 |
| `app/lib/atomic/__tests__/b19-d-claims-values.test.ts` | A | 142 | 0 |
| `app/lib/atomic/__tests__/b19-d-i5d-review.test.ts` | A | 178 | 0 |
| `app/lib/atomic/__tests__/b19-d-ingestion-bounds.test.ts` | A | 65 | 0 |
| `app/lib/atomic/__tests__/b19-d-kicad-export-fixture-runtime.test.ts` | A | 37 | 0 |
| `app/lib/atomic/__tests__/b19-d-kicad-export-selections.test.ts` | A | 175 | 0 |
| `app/lib/atomic/__tests__/b19-d-kicad-hostile.test.ts` | A | 197 | 0 |
| `app/lib/atomic/__tests__/b19-e-adopt-exact-revision.test.ts` | A | 120 | 0 |
| `app/lib/atomic/__tests__/b19-e-atomic-publication-durable.test.ts` | A | 335 | 0 |
| `app/lib/atomic/__tests__/b19-e-atomic-revision-loaders.test.ts` | A | 307 | 0 |
| `app/lib/atomic/__tests__/b19-e-publication-boundaries.test.ts` | A | 191 | 0 |
| `app/lib/atomic/__tests__/b19-e-publication-fake-vendors.test.ts` | A | 140 | 0 |
| `app/lib/atomic/__tests__/b19-e-publication-integrity.test.ts` | A | 327 | 0 |
| `app/lib/atomic/__tests__/b19-e-publication-review-durable.test.ts` | A | 360 | 0 |
| `app/lib/atomic/__tests__/b19-e-publication-review.test.ts` | A | 953 | 0 |
| `app/lib/atomic/__tests__/b19-e-upgrade-diff-status.test.ts` | A | 81 | 0 |
| `app/lib/atomic/__tests__/b19-export-license.test.ts` | A | 93 | 0 |
| `app/lib/atomic/__tests__/cross-consumer.test.ts` | M | 1 | 1 |
| `app/lib/atomic/__tests__/governance-security.test.ts` | M | 20 | 6 |
| `app/lib/atomic/__tests__/kicad-compatibility.test.ts` | M | 10 | 4 |
| `app/lib/auth/__tests__/b16-0-ai-approval-lifecycle.test.ts` | M | 7 | 3 |
| `app/lib/auth/__tests__/b16-1b-auth-composition.test.ts` | M | 2 | 2 |
| `app/lib/bom/__tests__/b19-d-pricing-mpn-binding.test.ts` | A | 56 | 0 |
| `app/lib/bom/__tests__/b19-d-review-price-consistency.test.ts` | A | 94 | 0 |
| `app/lib/bom/__tests__/b19-e-bom-catalog-status.test.ts` | A | 90 | 0 |
| `app/lib/bom/__tests__/b19-e-bom-sources.test.ts` | A | 78 | 0 |
| `app/lib/constraints/__tests__/b19-d-dru-structure.test.ts` | A | 29 | 0 |
| `app/lib/db/__tests__/b16-b-migrations.test.ts` | M | 19 | 16 |
| `app/lib/db/__tests__/b16-b-postgres-qualification.test.ts` | M | 4 | 2 |
| `app/lib/db/__tests__/b16-b-schema-parity.test.ts` | M | 10 | 1 |
| `app/lib/distributors/__tests__/b19-connector-policy.test.ts` | A | 83 | 0 |
| `app/lib/distributors/__tests__/b19-d-exact-mpn-binding.test.ts` | A | 95 | 0 |
| `app/lib/distributors/__tests__/b19-d-exact-mpn-connectors.test.ts` | A | 72 | 0 |
| `app/lib/distributors/__tests__/b19-d-lifecycle-retention.test.ts` | A | 44 | 0 |
| `app/lib/distributors/__tests__/b19-d-review-connectors.test.ts` | A | 93 | 0 |
| `app/lib/distributors/__tests__/b19-d-review-lifecycle.test.ts` | A | 51 | 0 |
| `app/lib/distributors/__tests__/b19-d-review-values.test.ts` | A | 84 | 0 |
| `app/lib/distributors/__tests__/b19-d-vendor-values.test.ts` | A | 76 | 0 |
| `app/lib/distributors/__tests__/b19-distributor-egress.test.ts` | A | 135 | 0 |
| `app/lib/distributors/__tests__/b19-e-exact-mpn-offer-cache.test.ts` | A | 72 | 0 |
| `app/lib/distributors/__tests__/b19-e-external-search-retention.test.ts` | A | 173 | 0 |
| `app/lib/distributors/__tests__/b19-e-pricing-provenance-cache.test.ts` | A | 83 | 0 |
| `app/lib/distributors/__tests__/b19-e-pricing-provenance-counts.test.ts` | A | 65 | 0 |
| `app/lib/distributors/__tests__/b19-offer-retention.test.ts` | A | 154 | 0 |
| `app/lib/distributors/__tests__/b19-pricing-live-gate.test.ts` | A | 94 | 0 |
| `app/lib/distributors/__tests__/b19-quota-breaker-coalescing.test.ts` | A | 123 | 0 |
| `app/lib/distributors/__tests__/b19-source-admission.test.ts` | A | 135 | 0 |
| `app/lib/engineering/__tests__/b04-tool-registry.test.ts` | M | 8 | 1 |
| `app/lib/engineering/__tests__/b14-replacement-proposal.test.ts` | M | 23 | 0 |
| `app/lib/engineering/__tests__/b17-f-agent-exposure.test.ts` | M | 3 | 1 |
| `app/lib/engineering/__tests__/b18-a-permission-tiers.test.ts` | M | 4 | 0 |
| `app/lib/engineering/__tests__/b18-c-exposure-lift.test.ts` | M | 3 | 1 |
| `app/lib/engineering/__tests__/b19-e-authority-catalog-status.test.ts` | A | 158 | 0 |
| `app/lib/engineering/__tests__/b19-e-external-read-descriptors.test.ts` | A | 139 | 0 |
| `app/lib/engineering/__tests__/b19-e-no-purchase-tripwire.test.ts` | A | 358 | 0 |
| `app/lib/kicad/__tests__/b19-d-ingest-issues.test.ts` | A | 26 | 0 |
| `app/lib/kicad/__tests__/b19-d-pinned-checkout.test.ts` | A | 84 | 0 |
| `app/lib/kicad/__tests__/b19-d-sexp-hostile.test.ts` | A | 54 | 0 |
| `app/lib/llm/__tests__/b19-d-compose-instructions-escaping.test.ts` | A | 41 | 0 |
| `app/lib/net/__tests__/b19-outbound-fetch.test.ts` | A | 195 | 0 |
| `app/lib/pcb/__tests__/b19-d-dsn-tokens.test.ts` | A | 119 | 0 |
| `app/lib/pcb/__tests__/b19-d-kicad-emit-injection.test.ts` | A | 193 | 0 |
| `app/lib/pcb/__tests__/write-dsn.test.ts` | M | 6 | 4 |
| `app/lib/pcb/fab/__tests__/b19-d-fab-csv-formula.test.ts` | A | 55 | 0 |
| `app/lib/physical-binding/__tests__/b19-e-successor-b14-durable.test.ts` | A | 370 | 0 |
| `app/lib/project/__tests__/b19-d-project-import-bounds.test.tsx` | A | 237 | 0 |
| `app/lib/project/__tests__/project-state.test.tsx` | M | 4 | 1 |
| `app/lib/requirements/__tests__/b19-d-source-unions.test.ts` | A | 52 | 0 |
| `app/lib/schgen/__tests__/b19-schgen-endpoint-client.test.ts` | A | 147 | 0 |
| `app/lib/spice/__tests__/b19-d-report-escaping.test.ts` | A | 20 | 0 |
| `app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts` | M | 4 | 1 |
| `app/lib/workflow/prompt-to-gerber/__tests__/recovery-pipeline.test.ts` | M | 4 | 1 |
| `e2e/security-headers.spec.ts` | A | 21 | 0 |

## B19 artifacts (9 files)

| file | | + | − |
|---|---|---|---|
| `artifacts/ai-control-plane-b19/README.md` | A | 20 | 0 |
| `artifacts/ai-control-plane-b19/acquisition-boundary.md` | A | 257 | 0 |
| `artifacts/ai-control-plane-b19/acquisition-ux.md` | A | 139 | 0 |
| `artifacts/ai-control-plane-b19/discovery.md` | A | 104 | 0 |
| `artifacts/ai-control-plane-b19/import-security-matrix.md` | A | 767 | 0 |
| `artifacts/ai-control-plane-b19/import-security.md` | A | 356 | 0 |
| `artifacts/ai-control-plane-b19/quarantine-pipeline.md` | A | 115 | 0 |
| `artifacts/ai-control-plane-b19/source-registry.csv` | A | 5 | 0 |
| `artifacts/ai-control-plane-b19/source-registry.md` | A | 119 | 0 |

## regenerated governance artifacts (23 files)

| file | | + | − |
|---|---|---|---|
| `artifacts/ai-control-plane-b01/api-route-coverage.csv` | M | 3 | 0 |
| `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv` | M | 6 | 4 |
| `artifacts/ai-control-plane-b01/ui-control-fingerprint.json` | M | 5 | 1 |
| `artifacts/ai-control-plane-b04/provider-schema-parity.json` | M | 1 | 1 |
| `artifacts/ai-control-plane-b04/tool-registry.csv` | M | 2 | 0 |
| `artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.csv` | M | 2 | 0 |
| `artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.json` | M | 1 | 1 |
| `artifacts/ai-control-plane-b09/normalized-loop-replay-fixtures.json` | M | 1 | 1 |
| `artifacts/ai-control-plane-b09/provider-schema-parity.json` | M | 1 | 1 |
| `artifacts/ai-control-plane-b09/tool-activation-audit.csv` | M | 2 | 0 |
| `artifacts/ai-control-plane-b11/evaluation-results.json` | M | 1 | 1 |
| `artifacts/ai-control-plane-b11/replay-trace-pins.json` | M | 1 | 1 |
| `artifacts/ai-control-plane-b16-0-1/exact-route-authorization-policy.csv` | M | 5 | 1 |
| `artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv` | M | 5 | 1 |
| `artifacts/ai-control-plane-b16-0-4/method-authorization-matrix.csv` | M | 5 | 1 |
| `artifacts/ai-control-plane-b16-0-4/request-body-boundary-matrix.csv` | M | 5 | 1 |
| `artifacts/ai-control-plane-b16-0-7/route-wrapper-matrix.csv` | M | 5 | 1 |
| `artifacts/ai-control-plane-b16-0/auth-route-coverage.csv` | M | 4 | 1 |
| `artifacts/ai-control-plane-b17/ui-control-inventory-summary.json` | M | 9 | 7 |
| `artifacts/ai-control-plane-b17/ui-control-inventory.csv` | M | 52 | 5 |
| `artifacts/remaining-builder-program/EXECUTION_LEDGER.md` | M | 746 | 0 |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md` | M | 124 | 0 |
| `artifacts/remaining-builder-program/PROGRAM_STATE.json` | M | 8 | 7 |

## CI (2 files)

| file | | + | − |
|---|---|---|---|
| `.github/workflows/benchmark.yml` | M | 4 | 0 |
| `.github/workflows/deterministic-manufacturing.yml` | M | 91 | 0 |

## other (1 files)

| file | | + | − |
|---|---|---|---|
| `next.config.ts` | M | 5 | 0 |
