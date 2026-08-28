# B16.0.9 — Authenticated design-family wrapper migration, tranche 2

**Status: COMPLETE under its stop condition.** The exact 17 authenticated JSON
methods (architecture ×5, power ×6, interfaces ×6) now use the canonical
`authenticatedJsonRoute` boundary with every observable business contract
preserved. **Post-stage inventory: 153 total · 32 wrappers · 3 factories ·
118 raw · baseline 121** — the overall migration continues.

| Doc | Content |
|---|---|
| [pre-edit-route-contracts.md](pre-edit-route-contracts.md) | the pinned boundary class + per-route refusal contracts (111 pins, green pre-edit) |
| [route-migration-manifest.csv](route-migration-manifest.csv) | the 17 migrated methods |
| [authorization-and-body-ordering-evidence.md](authorization-and-body-ordering-evidence.md) | by-construction + behavioral ordering proof |
| [trusted-scope-and-actor-proof.md](trusted-scope-and-actor-proof.md) | §C scope/actor rules incl. preserved AI lineage on propose |
| [provider-zero-call-evidence.md](provider-zero-call-evidence.md) | fake-adapter zero-call refusals + routing parity + 503 normalization |
| [behavioral-parity-results.md](behavioral-parity-results.md) | 111 pins pre+post; 141 family tests untouched |
| [ratchet-and-inventory-results.md](ratchet-and-inventory-results.md) | 138→121 shrink; pins 121/32; matrices ×2 sha1s |
| [changed-files.md](changed-files.md) | 17 routes + ratchet/gates/tests |
| [test-and-validation-report.md](test-and-validation-report.md) | complete suite **3539/0/exit 0**; tsc/eslint/git/generators |
| [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) | allocate's missing scope check; throwing validators; tranche-3 recommendation |
| [final-verdict.md](final-verdict.md) | stop-condition item-by-item, exact counts |
| route-wrapper-matrix.csv | regenerated full inventory copy |

## Reproduce

```bash
npx vitest run app/api/__tests__/b16-0-9-tranche-parity.test.ts
npx vitest run app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts
npx tsx scripts/generate-b16-0-8-baseline.ts   # update mode: no-op, removals only
```

## Scope

Zero provider credits (vi.mock adapter only); no provider-config changes; no
DB writes; 12 tools / replay pins / hashes / internal-only release preserved;
`C:\Users\robsa\sirkit` untouched; B16.0.10 / B16.1 NOT started; R9 UNKNOWN.
