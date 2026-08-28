# B16.0.8 — Unknowns & owner decisions

## Decisions taken this stage (documented, reviewable)

1. **Worker refusal contracts preserved via declared config.** The worker
   routes historically return route-specific 401 codes
   (`AQ_SOURCE_WORKER_UNAUTHORIZED`, `AQ_REVALIDATION_WORKER_UNAUTHORIZED`,
   `DW_WORKER_UNAUTHORIZED`) with differing Cache-Control presence. Rather than
   normalize (a contract change) or keep handwritten boundaries, the worker
   wrappers accept a declared `unauthorized: {code, noStore}` applied ONLY to
   the worker-unauthenticated 401. The owner may later choose to normalize all
   worker 401s to a canonical code — that would be an intentional, tested
   contract correction.
2. **kicadLibraryRoute runs only the token boundary** (no runtime policy
   adapter) — forced by the pinned external protocol (trailing-slash
   tolerance). See [behavioral-parity-results.md](behavioral-parity-results.md).
3. **Baseline includes factories.** The 3 approved factory methods
   (mapping-verification POST, pcb-sync GET/POST) are tracked in the baseline as
   legacy until each migrates — they are resolved and analyzed today, but the
   target state is wrapper adoption.

## Owner decisions pending

1. **Tranche 2 selection** — recommended next: the remaining `_scope`-family
   JSON POSTs (they already delegate to `scopedTrustedJson`, so parity risk is
   low), then the architecture/interfaces/power/schematic/bom direct-reader
   families, leaving chat / replacement-authority / release / export / SPICE
   streaming for dedicated late tranches with their own narrow variants.
2. **Client fetch audit** for the migrated public routes is unchanged (no
   contract change shipped), but the owner should decide when to normalize the
   worker 401 codes, if ever.

## Residual risk / unknowns

- **R9 live-Supabase production auth remains UNKNOWN** (no live DB contacted).
- The parity suite pins db-dependent success paths through mocked seams; the
  real-DB success paths are covered by the pre-existing family suites (all
  green in the full run) and did not change (business logic moved verbatim).
- 135 raw methods + 3 factories remain outside wrapper confinement — exact
  counts in [final-verdict.md](final-verdict.md).

## Scope adherence

Work confined to `C:\Users\robsa\Desktop\sirkit-edit`; `C:\Users\robsa\sirkit`
untouched; no provider credits; no live DB writes; no manufacturing-release
exposure; exactly 12 exposed tools preserved; B16.1 / second tranche NOT
started.
