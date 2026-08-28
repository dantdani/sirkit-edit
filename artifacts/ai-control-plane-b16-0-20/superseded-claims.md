# B16.0.20 — Superseded claims

## From B16.0.19

"Remaining migration: 40 raw methods (baseline 43)" is **superseded**: the six
model-simulation methods are now canonical.

| Claim | Prior | Now |
|---|---|---|
| canonical wrappers | 110 | **116** |
| raw methods | 40 | **34** |
| baseline | 43 | **37** |

## Intentional behavior change (§C mandated correction)

The `/execute` actor gate previously admitted an AI actor whose role was
`automation` (reproduced end-to-end pre-edit: ai+automation → 400 instead of
403). The gate now refuses ANY non-human actor — a strict narrowing matching
the route's own stated contract ("AI cannot execute simulation campaigns").
The old behavior was unreachable via the HTTP boundary (trusted context mints
human actors) but was a real latent defect; the pre-edit record and the
correction are in
[human-ai-authority-separation.md](human-ai-authority-separation.md).

## NOT superseded

All B16.0.1–B16.0.19 claims for the other 147 methods; CD-10 domain semantics
(authorization gate, denominator compilation, measurement/assertion
evaluation, readiness, proposals) unchanged; the runner remains blocked
exactly as before.
