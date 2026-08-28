# B16.0.13 — Protected PCB provider, autoroute & engineering-export migration, tranche 6

The five high-value protected PCB methods moved to `authenticatedJsonRoute`:
three provider-credit advisory routes (16 MB/45 s), the FreeRouting process
boundary (16 MB/60 s + the wrapper-projected AbortSignal), and the engineering
Gerber export (16 MB/60 s). **All 36 behavioral pins were written and run GREEN
against the PRE-migration handlers, then kept green post-migration** (one
guessed error-string in a pin was corrected against the recorded pre-edit
output; zero contract changes). No route limit changed — autoroute and gerbers
were already at 16 MB/60 s.

## Explicitly excluded (documented, no escape hatch)

`/api/pcb/apply-authorization` (body-selector envelope precedes trusted-context
resolution), `/api/pcb/assign/suggest` (derives an internal fetch origin from
the raw request URL — needs a service-boundary extraction), `/api/pcb/qualify`,
`/api/pcb/release` — see [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md).

## Results at a glance

| Metric | Value |
|---|---|
| Behavioral pins (pre = post) | **36** ([pre-edit-pcb-route-contracts.md](pre-edit-pcb-route-contracts.md)) |
| Standing deep suites (autoroute, gerbers ×2, from-brief, assist ×2) | **51 pass** unchanged |
| Zero provider/process/export work on every refusal | 5 fakes asserted per refusal ×5 routes ([provider-zero-call-evidence.md](provider-zero-call-evidence.md)) |
| Autoroute signal | `exposeAbortSignal: true`; both `request.signal` uses replaced by the projection ([callback-and-signal-confinement.md](callback-and-signal-confinement.md)) |
| Verified-release refusal + forbidden attribution keys | pinned ([engineering-export-safety-proof.md](engineering-export-safety-proof.md)) |
| Ratchet | 89 → **84** (5 removed, 0 added) |
| Inventory | **153 total · 69 canonical · 3 factories · 81 raw** |
| Full suite | **3740 pass / 0 fail / exit 0**; tsc 0; eslint 0 errors; git clean; generators ×2 byte-stable ([test-and-validation-report.md](test-and-validation-report.md)) |

## Documents

pre-edit-pcb-route-contracts · [pcb-route-migration-manifest.csv](pcb-route-migration-manifest.csv) ·
authorization-and-body-ordering-evidence · callback-and-signal-confinement ·
provider-zero-call-evidence · prompt-schema-and-provider-parity ·
pcb-advisory-nonmutation-proof · autoroute-process-boundary-proof ·
protected-copper-and-revision-parity · engineering-export-safety-proof ·
export-byte-and-header-parity · ratchet-and-inventory-results · changed-files ·
test-and-validation-report · unknowns-and-owner-decisions ·
[final-verdict.md](final-verdict.md)

## Scope

No provider credits, no live FreeRouting/KiCad process, no DB writes;
`C:\Users\robsa\sirkit` untouched; 12 tools / replay pins / hashes /
internal-only release preserved. B16.0.14 / B16.1 NOT started.
