# B16.0.8 — Canonical wrapper foundation & first ratcheted migration tranche

**Status: COMPLETE under its stop condition** — the wrapper foundation is
extended, the FIRST tranche (15 methods) is migrated with pinned behavioral
parity, and the monotonic migration ratchet is live.
**The overall wrapper migration is NOT complete: 15 / 153 methods adopted,
135 raw + 3 factories remain** ([final-verdict.md](final-verdict.md)).

## What landed

| § | Deliverable |
|---|---|
| A | Monotonic RATCHET: frozen 138-entry legacy baseline (shrink-only), refusal-on-addition generator, revert/new-raw/fake-wrapper/expansion tripwires ([migration-ratchet.md](migration-ratchet.md)) |
| B | Foundation: `publicRoute`, `workerRoute`, `kicadLibraryRoute` (narrow), ctx-params, bounded query projection, safe-header allowlist (secret names throw at construction), opt-in AbortSignal, declared worker refusal contracts ([wrapper-foundation-contract.md](wrapper-foundation-contract.md), [safe-metadata-and-header-policy.md](safe-metadata-and-header-policy.md)) |
| C | 15 methods migrated: 5 public no-body (incl. 3 kicad + dynamic `[id]`), 3 public JSON, 3 worker (1 JSON + 2 no-body), 2 authenticated no-body, 2 authenticated JSON ([migrated-methods.csv](migrated-methods.csv)) |
| D | 24 behavioral parity pins — green PRE- and POST-migration; one true protocol difference (kicad trailing-slash) resolved with the narrow variant, not forced ([pre-edit-route-contracts.md](pre-edit-route-contracts.md), [behavioral-parity-results.md](behavioral-parity-results.md)) |
| E | Raw-Request confinement for the migrated 15: no raw exported handlers, callbacks cannot receive Request/Headers, wrapper provenance exact — claimed ONLY for the migrated set |
| F | New suites: parity (24), wrapper capabilities (12), ratchet (6); R1–R11 remain green |
| H | Full suite **3428 / 0 / exit 0**; tsc 0; eslint 0; git clean; generators ×2 byte-stable ([test-and-validation-report.md](test-and-validation-report.md)) |

## Reproduce

```bash
npx vitest run app/api/__tests__/b16-0-8-tranche-parity.test.ts
npx vitest run app/lib/auth/__tests__/b16-0-8-wrapper-capabilities.test.ts
npx vitest run app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts
npx tsx scripts/generate-b16-0-8-baseline.ts   # update mode: removals only
```

## Scope

No provider credits; no live DB writes; no manufacturing exposure; 12 tools /
replay pins / hashes preserved; `C:\Users\robsa\sirkit` untouched; second
tranche and B16.1 NOT started. R9 UNKNOWN.
