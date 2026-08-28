# B15.2 — the corrective closures (R10–R16)

All seven are permanent fail-closed regressions in
`app/lib/pcb/proposal/__tests__/b15-2-core-closure.test.ts` (20 tests). The
B15 core (15) and B15.1 corrective (28) suites stay green alongside.

## R10 — the parser is now genuinely total (§A)

B15.1 guarded object reflection but left `Array.isArray`, array `length`,
index reads, and — the real hole — the SEMANTIC validation pass, which
re-read the caller's proxy-backed value *after* inspection.

The ordering is now load-bearing:

1. guarded hostile inspection of the raw value (`safeIsArray`, `safeLength`,
   `safeIndex` join the existing guarded object reflection);
2. guarded normalization into **inert plain JSON data**;
3. exact UTF-8 measurement of that normalized data;
4. semantic validation **against the inert data only** — the original value
   is never read again;
5. deep freeze.

`parseBoundedEditRequest` also carries a final fail-closed exception
boundary. Array-length traps, revoked proxies (root and nested), index
traps, and cycles all refuse.

**One honest refinement.** A proxy that survives inspection but would throw
on a *later* read is **neutralized**, not refused: normalization snapshots
its values, so the late trap never fires and a deterministic result follows
from the snapshot. The contract this closes is *totality plus determinism*,
not "every exotic value refuses" — and the test asserts exactly that.

## R11 — exact geometry through shared authorities (§B)

`pointInOutline` (shared) replaces the local bounding-box/polygon test, so a
roundrect's **clipped corner** is correctly outside. Keepout **edges** are
now sampled along their length against the exact outline, so two vertices in
opposite arms of a concave board no longer smuggle an edge through the
notch. Dimensions are validated through the shared `dimensionGeometry`
authority — every rendered extension line, dimension line, arrowhead, and
label polyline must stay on the board, not merely the measurement endpoints.

## R12 — footprint hard constraints (§C)

`placement.fixedPosition`, `placement.mechanical`, and
`placement.edgeConnector` refuse movement; `placement.allowedRotations` is
authoritative for rotation. Movement additionally requires the **complete
body/courtyard envelope** to fit the exact outline via the shared
`courtyardFitsOutline` — an anchor just inside the edge with a body hanging
over it now refuses.

## R13 — effective minima across every applicable net (§D)

A **global** routing preference now folds the strictest effective
requirement across every active net on the board (each net through its own
class via the shared `getNetClass`), so a board carrying a Power net rejects
a preference at the weaker Default minimum. A selected `viaPadstackId` is
resolved and validated against the active outer/drill/annular minima. The
same direct check now also covers **updated** track width, not only added
tracks.

## R14 — rule deltas have a verified effect (§E)

Deltas are applied through the shared `applyRuleDeltas`, so the candidate's
effective `getNetClass` reflects the proposal immediately; the compiler then
**re-resolves each affected net and verifies the effective value equals the
request**, refusing otherwise. The deterministically minted rule id is added
to `mintedObjectIds` **and** `impact.changedObjectIds`, before/after
effective values appear in `impact.ruleChanges`, provenance is truthfully
`source: "ai-brief"` (never `"manual"`), and duplicate net ids refuse.

Because rules now genuinely take effect, DRC/connectivity validation runs
against the *effective* candidate — which immediately surfaced that a rule
tightening a net beyond its existing copper introduces real DRC errors and
must refuse. Two B15 fixtures were corrected accordingly; the validator was
not weakened.

## R15 — canonical copper identity (§F)

The local `pairKey` expression is deleted. Both endpoints of every short and
unknown-contact pair are identified with the shared `copperItemId`, then
sorted and joined. Pads on different footprint instances, distinct pad
instances, separate zone regions, different zones, and same-id track/via
pairs are all provably distinct.

## R16 — the seal boundary is closed and total (§G)

`baseIdentity` is **derived internally** as `pcbRevisionId(board)`; a
caller-supplied value must match exactly or the compile refuses — so minted
ids can never be steered. The new internal `assemblePcbEditProposal`
**hard-codes** the trusted tool identity (the input type no longer accepts
one, so a foreign artifact cannot even be constructed) and recomputes every
pin it is about to certify — operations digest over the sealed base
identity, impact digest, candidate/impact digest equality, and minted-id
consistency — returning a refusal instead of sealing an inconsistent
compiled object. Verification is wrapped in a total exception boundary:
revoked proxies, throwing traps, and cycles refuse rather than throw. The
checksum remains integrity evidence only, never mutation authority.

## Exposure unchanged

A permanent test in this suite asserts the agent registry still exposes
**exactly 11** tools and no PCB propose tool, as B15.2 requires.
