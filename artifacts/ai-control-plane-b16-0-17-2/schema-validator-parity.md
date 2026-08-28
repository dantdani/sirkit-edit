# B16.0.17.2 §B/§C — Schema-validator parity (CONFIRMED)

## §B — the drift is closed IN the schema

`SCHEMATIC_PROPOSAL_TOOL.schema` now declares:

- `referencedSemanticObjectIds.items.maxLength = 4096`
- `proposedActions.items.properties.targetObjectIds.items.maxLength = 4096`

This is an intentional security-boundary TIGHTENING of provider-declared
output (the provider-facing strict schema now also refuses over-long ids), not
a capability expansion.

## §B — the validator reads the nodes

`stringArray(name, value, node)` and `boundedString(name, value, node)` take
the SCHEMA NODES themselves and derive `minLength` (`?? 0`), `maxLength`
(`?? ∞`) and `maxItems` from them. The hard-coded `4096` arguments are gone;
no parallel limits table exists. The schema literal is authoritative for:
allowed proposal kinds, allowed action kinds, required top-level and action
fields, additionalProperties behavior, array item caps, and string min/max
lengths.

## §C — the executable parity gate (10 tests, data-driven)

[`b16-0-17-2-schema-parity.test.ts`](../../app/lib/schematic-compiler/__tests__/b16-0-17-2-schema-parity.test.ts)
reads every boundary FROM the schema nodes (no copied numbers):

| # | Proof |
|---|---|
| 1–3 | referenced id of exactly `items.maxLength` accepted; `maxLength+1` refused |
| 4 | same for `targetObjectIds` |
| 5 | rationale min/max agree (at-max accepted, max+1 refused, at-min accepted, below-min refused) |
| 6/7 | assumption + warning `items.maxLength` agree (at/over boundary) |
| 8 | every array's `maxItems` agrees (at-cap accepted, cap+1 refused) — referenced, assumptions, warnings, proposedActions, targetObjectIds |
| 9/10 | every declared proposalKind/actionKind accepted; non-declared refused |
| 11/12 | unexpected top-level and action keys refused (`additionalProperties: false` asserted on both schema levels) |
| 13 | every `required` field (top level AND action level, iterated from the schema's own `required` arrays) is actually required |
| 14 | **live-schema tripwire**: temporarily mutating `items.maxLength` to 5 at runtime changes validator behavior AUTOMATICALLY (10-char id flips from accepted to refused), then restores |
| 15 | **no hard-coded limit**: the validator's source region (comments/strings stripped) contains NO schema limit ≥ 32 as a numeric literal — the set of limits is itself read from the schema |
