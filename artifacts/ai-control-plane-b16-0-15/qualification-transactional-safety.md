# B16.0.15 §D — Qualification transactional safety

## What the migration touched

ONLY the boundary prologue of `qualify/route.ts`: the raw
`export async function POST(request)` + `scopedPcbSyncJson(request)` was replaced
by `authenticatedJsonRoute({8MB/30s}, async ({context, body}) => {...})` with the
forbidden-key check and scope projection moved to the top of the callback.
Everything from `const record = await stage3Repository.getBoard(...)` onward is
byte-identical.

## Transactional invariants (preserved, not rewritten — §H no-rewrite)

- the autonomous capability profile, placement algorithms, FreeRouting
  integration, board-digest logic, and RC01/RC02/RC03 definitions are
  **untouched**;
- publish happens only inside `commitSelected`, only when
  `next.revision === selectedRevision`, and only when the layout status is
  `complete` with a selected board and committed record;
- any failed / partial / stale / mismatched attempt returns 422 with blocking
  evidence and leaves the authoritative board untouched;
- `ManufacturingReleaseAuthority` is assembled and `store.save(...)` is called
  ONLY after RC01 parity passes, RC02 route evidence exists, and RC03
  capability completed — a boundary refusal or any earlier failure calls
  `save` zero times (pinned).

## Proof scope

The route-boundary suite proves the boundary + the ineligible/​not-found
early-exit paths do zero router/persistence work. The FULL expensive success
path (real FreeRouting-backed qualification, real digests, real authority
persistence) is exercised by the standing autonomous-qualification and
manufacturing-release-gate suites, which remain **unchanged and green** — this
stage deliberately does not re-run a live routing process to test request
boundaries (§D note, §J: no external process).
