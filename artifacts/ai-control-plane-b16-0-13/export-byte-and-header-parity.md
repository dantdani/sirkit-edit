# B16.0.13 §H/§I — Export bytes/headers & input non-mutation

## Gerber export bytes and headers

The standing gerbers suites (`route.test.ts` + `b16-0-2-engineering-export`)
drive the migrated route with the SAME fake `buildFabBundle` / native-compiler
seams and pass unchanged, pinning: archive response bytes (fake-bundle
digest), filenames and `Content-Disposition`, `Cache-Control: no-store`, the
engineering-export labelling headers, readiness/disposition headers, bounded
stderr behavior, and every error code/status. No exporter code changed; no
live KiCad ran; no manufacturing artifact was written.

## Input non-mutation (§I)

| Route | Proof |
|---|---|
| repair/agent | board JSON-frozen before the call, byte-compared after a FULL valid run — unchanged |
| from-brief | `{brief, board}` frozen/compared across the provider path — unchanged |
| edit/assist | `digest` frozen/compared — unchanged |
| autoroute | the standing suite's candidate-generation tests operate on cloned boards; route code unchanged |
| gerbers | the board is serialized for export only; standing suites unchanged |

## Volatile fields (documented; nothing else normalized)

This tranche's pins normalize NOTHING new. The only historical volatile fields
recognized anywhere in the tranche suites are those already documented in
B16.0.12 (writer per-element uuids; placement runId/elapsedMs) — none apply to
these five routes' pinned assertions. Semantic revisions, evidence digests,
readiness states, tracks, vias, rules, edits, and diagnostics are asserted
exactly, never normalized.
