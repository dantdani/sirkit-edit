# Pin-coincidence guard (layout shorts)

Date: 2026-06-26 · Status: done (unit-tested — `pnpm test:netlist`)

## Problem
After Layer-1 validation, multi-agent / dense builds still occasionally logged
`unintended-merge` warnings (e.g. `C1.1, C2.1, … U1.2, U2.2` on one net;
`J1.A5, J1.B5, R1.1, R2.1`). Root cause: the body de-overlap pass
(`resolveComponentCollisions`) separates component *bodies* but can leave two
DIFFERENT components with a PIN on the exact same grid point — which
`buildNetUnionFind` reads as one node, silently SHORTING the two nets. Corroborated
by the `1 component overlap could not be fully resolved` warning.

## Decision
Keep it deterministic — geometry de-overlap is a precise spatial problem, the
schematic sheet is unbounded (always room to separate), so no LLM. (An LLM can't
reliably produce non-overlapping grid coordinates and would risk new overlaps /
detached pins.)

## Change (`lib/build-auto-layout.ts`)
- **`resolvePinCoincidences(items)`** — maps every pin to its grid coordinate,
  finds any point shared by ≥2 components, nudges the more-movable owner
  (passive before processor) ~20px until no coordinate is shared. Bounded passes;
  returns residual.
- Wired into `autoLayoutBuild` AFTER `resolveComponentCollisions` and BEFORE wire
  routing (electrical correctness > body spacing; routing reads final positions
  so nets are preserved).
- Raised the body-collision pass budget (`×4+8` → `×8+16`).

## Test
Two components on the same point → separated so no pin coordinate is shared.

## Note
Guarantees no pin coincidence within the pass budget (kills the shorts); doesn't
guarantee zero cosmetic body overlap. Next lever if needed: a force-directed
final de-overlap pass.
