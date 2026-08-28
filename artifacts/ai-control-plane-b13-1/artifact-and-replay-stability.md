# B13.1 — artifact and replay stability

## Replay pins — UNCHANGED

`artifacts/ai-control-plane-b11/replay-trace-pins.json` sha256 remains
`03e043f4b5402bb4…` — the value B13 pinned when the tenth tool shifted
the discovery digest. B13.1 changes NO registry entry, NO discovery
surface, NO envelope schema: it adds validation, cross-checks, a
classifier state, cancellation, and production wiring — none of which
participate in the pinned traces. `generate-b11-artifacts.ts` was run
twice: byte-identical output both times, pins equal to the committed
file. No pin movement to justify this stage.

## Regenerated artifacts — b05 replay fixtures only

The `tool-read-replay.ts` `auth:u1` verified-exact fixture gained its
exactAuthority block (required for truthful classification under R6), so
`generate-read-invocation-artifacts.ts` was rerun. Justification: the
fixture previously asserted verified-exact WITHOUT server-owned exact
authority — exactly defect R6; the regenerated artifact reflects the
now-truthful record. Byte-stability: generator run twice AFTER the
change; `artifacts/ai-control-plane-b05-1/composite-replay-fixtures.json`
sha256 `f18e47e0f14b2d1d…` both runs. b05 suites green against the
regenerated artifacts (54/54).

## Foundation hashes — unchanged

| file | sha256 (16) |
| --- | --- |
| `app/lib/pcb/types.ts` | `72ad7c7758b44414` |
| `app/lib/agent/generated/pcb-shape-descriptor.ts` | `5501d810e583395d` |

`generate-pcb-shape-descriptor.ts --check` passes (descriptor matches a
fresh generation). `git diff --check` reports no whitespace/conflict
problems.

## Protected original

`C:\Users\robsa\sirkit` untouched: `git status --porcelain` still lists
exactly the SAME 6 pre-existing entries (the user's own Jul 16 auth files
and Aug 3 `ai_recon.patch`) that predate every builder stage. No file in
the protected tree was modified, formatted, staged, or generated.
