# B15.2.1 §D — semantic rule mutation (R20)

## What was wrong

`applyRuleDeltas` resets `assignments = clone(base ?? {})` before
re-layering. On a legacy `netClassing` that has `assignments` but no optional
`base` (a valid PcbBoard representation), that wipe flipped the net's class
(Power → Default) and moved unrequested `clearance`/`viaSize` values — a rule
that named only `trackWidthNm`.

## The closure — change ONLY what the request names

The delta is still applied through the SHARED `applyRuleDeltas` (no second
rules engine), but the compiler now brackets it with a total before/after
verification over the EFFECTIVE `getNetClass` of **every net on the board**:

- **class identity**: `before.id === after.id` for every net, or refuse. A
  legacy no-base record that would flip a class is REFUSED with a precise
  bounded diagnostic — never silently reset (R20).
- **named fields on named nets**: each requested field must equal the
  requested value, or refuse ("did not take effect").
- **every other field and every other net**: must be byte-identical
  before/after, or refuse ("would change the unrequested … / another net").

## Additional guarantees

- Partial via changes validate the RESULTANT pair — `viaSize`/`viaDrill` and
  the annular ring — against the active minima, not only the supplied field.
- Duplicate net ids refuse (contradictory input).
- Provenance is truthfully `source: "ai-brief"`; the minted rule id is in
  both `mintedObjectIds` and `impact.changedObjectIds`; before/after
  effective values appear in `impact.ruleChanges`.
- The caller's board is never mutated (the candidate is a clone).

On a normal board with a proper base, a rule targeting specific nets passes
verification (only the named field on the named net changes); the legacy
no-base board refuses. Both are pinned (§D R20, R20b, R20c).
