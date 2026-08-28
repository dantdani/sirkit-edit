# B16.0.17.2 — Changed files

## Production

- `app/lib/schematic-compiler/agent-tools.ts` —
  1. `maxLength: 4096` added to `referencedSemanticObjectIds.items` and
     `proposedActions.items.properties.targetObjectIds.items` in the DECLARED
     schema (§B tightening);
  2. `validateSchematicProposalToolInput` refactored: `stringArray` /
     `boundedString` now take the schema NODES (typed `StringArraySchemaNode` /
     `StringSchemaNode`) and derive min/max/maxItems from them; the hard-coded
     `4096` arguments removed. No behavioral change for previously-valid
     inputs; over-long ids are now refused by BOTH contracts consistently.

## Tests

- `app/lib/schematic-compiler/__tests__/b16-0-17-2-schema-parity.test.ts` —
  NEW; the 10-test executable schema-parity gate (§C), fully data-driven from
  the schema nodes, incl. the live-mutation tripwire and the
  no-hard-coded-limit source scan.
- `app/lib/llm/__tests__/b16-0-17-2-adapter-schema-parity.test.ts` — NEW; §D
  adapter parity with fake SDK clients (one type-annotation fix applied after
  an initial tsc pass flagged the untyped mock tuple — disclosed; behavior
  identical).

## Artifacts

- `artifacts/ai-control-plane-b16-0-17-2/` — this stage's 9 documents.
- Supersession notes APPENDED to `artifacts/ai-control-plane-b16-0-17-1/`:
  `README.md`, `real-tool-schema-fixture.md`,
  `structural-validation-contract.md`, `final-verdict.md`.

## NOT changed

The propose route, prompt, provider routing, maxTokens/temperature/toolChoice,
`normalizeSchematicChangeProposal`, all other schematic-compiler routes,
inventory (91/3/59), baseline (62), tool exposure (12), hashes, replay pins.
`C:\Users\robsa\sirkit` untouched.
