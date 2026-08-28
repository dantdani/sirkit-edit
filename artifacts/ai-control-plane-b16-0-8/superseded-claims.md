# B16.0.8 — Superseded claims (nothing deleted)

## Supersedes B16.0.7 "0/153 canonical wrappers"

The inventory now reads **15 canonical wrappers / 3 approved factories /
135 raw** (of 153 methods). The B16.0.7 matrix remains as the historical
0/153 record; the regenerated matrix is authoritative
([route-wrapper-matrix.csv](route-wrapper-matrix.csv)).

## Supersedes B16.0.7's dormant all-or-nothing cutover

The `EXPECT_FULL_ADOPTION` switch alone could not prevent regression while
false. It is now backed by the MONOTONIC ratchet
([migration-ratchet.md](migration-ratchet.md)): frozen shrinking baseline,
generator that refuses additions, revert/new-raw/fake-wrapper tripwires, and
pinned counts. The switch stays false until the baseline reaches zero.

## Corrected during migration (truthful protocol note)

`kicadLibraryRoute` was first drafted to run the policy adapter before the
KiCad token boundary; the Stage 5 tests proved the historical surface tolerates
URL shapes (trailing slash) that the exact-path policy lookup refuses. The
shipped variant runs ONLY the token boundary and documents that scope — the
policy TABLE still classifies the rows; runtime policy resolution was not
forced onto a protocol that never had it.

## Explicitly NOT claimed

- B16.0.7 and B16.0.8 are **NOT complete for the entire wrapper migration** —
  135 raw methods and 3 factories remain
  ([final-verdict.md](final-verdict.md) has exact counts).
- Raw-Request confinement is claimed ONLY for the 15 migrated methods (their
  modules export no raw handler and their callbacks cannot receive
  Request/Headers); production-wide confinement remains pending.
- R9 live-Supabase remains UNKNOWN; B16.1 / MCP / multi-agent / manufacturing
  integration / provider expansion / new tool exposure NOT started.
