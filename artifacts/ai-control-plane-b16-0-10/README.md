# B16.0.10 — Schematic AI route wrapper migration, tranche 3

The eight core schematic AI POST methods moved from handwritten raw-Request
boundaries to the canonical `authenticatedJsonRoute` (16 MB / 45 s), preserving
every observable business contract. **All 57 behavioral pins were written and
run GREEN against the PRE-migration handlers, then kept green unchanged after
migration — zero assertion changes.**

## The tranche

`POST /api/schematic`, `/build`, `/build-multi`, `/cross-verify`, `/edit`,
`/edit-build`, `/layout-critic`, `/review` — see
[schematic-route-migration-manifest.csv](schematic-route-migration-manifest.csv)
(all 8 now `canonical-wrapper / authenticatedJsonRoute / adopted`).

## Results at a glance

| Metric | Value |
|---|---|
| Behavioral pins (pre = post, zero changes) | **57** ([pre-edit-route-contracts.md](pre-edit-route-contracts.md), [behavioral-parity-results.md](schematic-behavioral-parity-results.md)) |
| Provider zero-call refusal proofs | every refusal class ×8 routes; exactly-once valid invocation ([provider-zero-call-evidence.md](provider-zero-call-evidence.md)) |
| Prompts/schemas/tools | untouched — `app/lib/prompts.ts` sha1 `eb08600b…` pre = post ([prompt-schema-and-provider-parity.md](prompt-schema-and-provider-parity.md)) |
| Ratchet | 121 → **113** (8 removed, 0 added) ([ratchet-and-inventory-results.md](ratchet-and-inventory-results.md)) |
| Inventory | **153 total · 40 canonical · 3 factories · 110 raw** |
| Full suite | **3547 pass / 0 fail / exit 0**; tsc 0; eslint 0; git clean; 6 generators ×2 byte-stable ([test-and-validation-report.md](test-and-validation-report.md)) |

## Documents

pre-edit-route-contracts · authorization-and-body-ordering-evidence ·
trusted-scope-and-actor-proof · provider-zero-call-evidence ·
prompt-schema-and-provider-parity · schematic-behavioral-parity-results ·
ratchet-and-inventory-results · changed-files · test-and-validation-report ·
unknowns-and-owner-decisions · [final-verdict.md](final-verdict.md)

## Scope

No provider credits, no DB writes, no prompt/provider-config changes,
`C:\Users\robsa\sirkit` untouched, 12 tools / replay pins / hashes /
internal-only release preserved. B16.0.11 / B16.1 NOT started.
