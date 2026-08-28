# B16.0.17.1 §C — Structural validation contract (CONFIRMED)

## One source of truth

`validateSchematicProposalToolInput(value: unknown): string[]` lives BESIDE
`SCHEMATIC_PROPOSAL_TOOL` in `app/lib/schematic-compiler/agent-tools.ts` and
derives every constraint from the schema literal itself:

- `proposalKind` enum ← `schema.properties.proposalKind.enum`;
- `actionKind` enum ← `schema.properties.proposedActions.items.properties.actionKind.enum`;
- item caps ← the schema's `maxItems` (512 referenced / 256 actions / 32
  targets / 64 assumptions / 64 warnings);
- string lengths ← the schema's `minLength`/`maxLength` (rationale 1..2000,
  assumption/warning ≤1000).

No handwritten duplicate contract exists in the route.

## Fail-closed coverage (all §C classes, adversarially tested)

missing/unknown `proposalKind` · missing/non-array
`referencedSemanticObjectIds` · missing/non-array `proposedActions` ·
missing/unknown `actionKind` · missing/non-array/wrong-type `targetObjectIds` ·
missing/out-of-length `rationale` · missing/non-array `assumptions` /
`warnings` · unexpected top-level keys · unexpected nested action keys ·
non-object actions · oversized arrays (513 referenced) · oversized strings
(2001-char rationale). The ORIGINAL malformed B16.0.17 fixture is itself a
permanent test case and now refuses deterministically.

## Deterministic bounded refusal

Malformed provider output returns:

```
422 { ok:false, code: "SCHEMATIC_PROPOSAL_OUTPUT_INVALID",
      error: "Provider tool output failed the SCHEMATIC_PROPOSAL_TOOL structural contract.",
      diagnostics: [≤20 items, each ≤200 chars] }   (Cache-Control: no-store)
```

Diagnostics name the offending FIELD (keys truncated to 64 chars) — no
provider payload echo, no stack, no secret. It is never classified as provider
unavailable / rate limit / quota / network, and never surfaces as an
incidental TypeError.


---

## ⚠️ SUPERSESSION NOTE (B16.0.17.2)

The one-source-of-truth claim in THIS document was **overstated**. Independent
verification found that `validateSchematicProposalToolInput` hard-coded a
4,096-character limit for `referencedSemanticObjectIds` and
`proposedActions[*].targetObjectIds` items while the declared tool schema
carried only `minLength: 1` (no `maxLength`) — so the provider-facing strict
schema permitted strings the local validator refused, and those two limits were
NOT schema-derived. B16.0.17.2 closed the drift: `maxLength: 4096` now lives in
the schema nodes themselves, the validator reads min/max from the nodes (no
hard-coded limits remain — gated), and an executable schema-parity gate plus
provider-adapter parity tests prove agreement at the 4,096/4,097 boundaries.
See `artifacts/ai-control-plane-b16-0-17-2/`. The historical text above is
retained as evidence.
