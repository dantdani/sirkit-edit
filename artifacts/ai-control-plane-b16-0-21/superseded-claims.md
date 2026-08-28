# B16.0.21 — Superseded claims

## From B16.0.20

"Remaining migration: 34 raw methods (baseline 37)" is **superseded**: the
eight firmware-bringup/full-flow/release-engineering methods are now
canonical.

| Claim | Prior | Now |
|---|---|---|
| canonical wrappers | 116 | **124** |
| raw methods | 34 | **26** |
| baseline | 37 | **29** |

## Intentional behavior change (§D correction)

`full-flow/transition` previously admitted `automated_engine` /
`import_adapter` / `system_migration` actors (only `"ai"` was refused);
reproduced verbatim pre-edit, unreachable via HTTP (trusted context mints
human), corrected to refuse ANY non-human actor with the same 403 response.
The same latent-defect class as B16.0.20's execute gate.

## NOT superseded

All B16.0.1–B16.0.20 claims for the other 145 methods; the three families'
domain semantics (compilers, resource solver, proposals, run creation, the
CD-13 state machine, release-problem compilation) unchanged.
