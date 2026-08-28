# B16.0.17.2 — Corrective stage: tool-schema and local-validator parity

Independent verification of B16.0.17.1 confirmed one narrow contract-parity
defect: `validateSchematicProposalToolInput` hard-coded a 4,096-character item
limit for `referencedSemanticObjectIds` and `proposedActions[*].targetObjectIds`
while the declared `SCHEMATIC_PROPOSAL_TOOL.schema` carried only
`minLength: 1` — the provider-facing strict schema permitted strings the local
validator refused, so the "one source of truth" claim was overstated.

## What was done

| Section | Delivery |
|---|---|
| §A | Drift reproduced and recorded BEFORE editing: schema node `{"type":"string","minLength":1}` vs validator refusing a 4,097-char id ([pre-edit-schema-drift.md](pre-edit-schema-drift.md)) |
| §B | `maxLength: 4096` added to BOTH schema nodes (an intentional tightening of provider-declared output); the validator now reads `minLength`/`maxLength`/`maxItems` from the schema nodes via typed node parameters — the hard-coded `4096` arguments are GONE ([schema-validator-parity.md](schema-validator-parity.md)) |
| §C | Executable 10-test schema-parity gate: 4,096 accepted / 4,097 refused on both id arrays, every length/cap/enum/required/additionalProperties agreement, a LIVE-schema mutation tripwire, and a source scan proving no schema limit ≥32 appears as a literal in the validator |
| §D | Both provider adapters proven (fake SDK clients) to pass the schema through **reference-identical** — nested maxLength intact, `strict: true`, forced toolChoice, prompt/maxTokens/temperature unchanged ([provider-adapter-schema-parity.md](provider-adapter-schema-parity.md)) |
| §E | Supersession notes appended to the four B16.0.17.1 documents carrying the overstated claim |

## Invariants held (§F, re-measured)

Inventory **91 / 3 / 59**, baseline **62** — wrapper matrix byte-IDENTICAL
(`cd4aaee0…`). Tools **12**. Provider routing, prompt, maxTokens 4096,
temperature 0, proposal authority, graph semantics, transactions, KiCad
quarantine, layout, export approval, manufacturing-release internality, hashes,
replay pins: all unchanged.

## Validation

Recorded in [test-and-validation-report.md](test-and-validation-report.md).
B16.0.18 / B16.1 NOT started. `C:\Users\robsa\sirkit` untouched.
