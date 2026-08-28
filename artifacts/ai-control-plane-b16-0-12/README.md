# B16.0.12 — Public catalog, footprint & deterministic export migration, tranche 5

The 12 public read / catalog / deterministic-export / placement-preview methods
(plus the KiCad token-protected category route) moved to canonical wrappers.
**All 24 behavioral pins were written and run GREEN against the PRE-migration
raw handlers, then kept green post-migration** (two disclosed pin-harness
corrections; zero contract-assertion changes — see
[behavioral-parity-results.md](behavioral-parity-results.md)).

## Results at a glance

| Metric | Value |
|---|---|
| Wrapper mapping | 7× `publicRoute` (query/params projections) · 4× `publicJsonRoute` (200 KB/10 s · 8 MB/30 s · 16 MB/45 s ×2) · 1× `kicadLibraryRoute` (**target-classification corrected** — the category route uses the dedicated KiCad token protocol) |
| Behavioral pins (pre = post) | **24** ([pre-edit-public-route-contracts.md](pre-edit-public-route-contracts.md)) |
| Zero-embedding discipline | exact-hit / invalid queries → 0 embed calls; free text → exactly 1 fake call ([footprint-search-and-zero-embedding-evidence.md](footprint-search-and-zero-embedding-evidence.md)) |
| Export parity | bytes vs the REAL serializers, modulo the writer's historical per-element random UUIDs ([export-byte-parity.md](export-byte-parity.md)) |
| Runtime secret safety | adversarial sentinel env fixture — none appear in the response ([runtime-secret-nondisclosure.md](runtime-secret-nondisclosure.md)) |
| Ratchet | 101 → **89** (12 removed, 0 added) |
| Inventory | **153 total · 64 canonical · 3 factories · 86 raw** |
| Full suite | **3704 pass / 0 fail / exit 0**; tsc 0; eslint 0; git clean; generators ×2 byte-stable ([test-and-validation-report.md](test-and-validation-report.md)) |

## Documents

pre-edit-public-route-contracts · [public-route-migration-manifest.csv](public-route-migration-manifest.csv) ·
query-and-parameter-confinement · kicad-token-boundary-proof ·
atomic-component-authority-proof · footprint-search-and-zero-embedding-evidence ·
export-byte-parity · placement-preview-parity · runtime-secret-nondisclosure ·
behavioral-parity-results · ratchet-and-inventory-results · changed-files ·
test-and-validation-report · unknowns-and-owner-decisions ·
[final-verdict.md](final-verdict.md)

## Scope

No live DB/embedding/provider/external calls (queue-driven drizzle fake,
counted embedding fake, engine spy); `C:\Users\robsa\sirkit` untouched; 12
tools / replay pins / hashes / internal-only release preserved. B16.0.13 /
B16.1 NOT started.
