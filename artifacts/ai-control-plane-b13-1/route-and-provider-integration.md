# B13.1 §G — route and provider integration

## Route behaviour (unchanged gates, now production-real)

- Valid production-shaped source (real `PhysicalBindingService` data
  through the runtime adapter seams) ⇒ the sealed
  `component-authority-records` envelope enters the run context and
  `sirkit.component-authority.inspect` is discoverable/callable — the
  TENTH tool.
- Source resolution failure (no `DATABASE_URL`, throwing factory, query
  failure, deadline) ⇒ resource withheld, inspect tool unexposed,
  `sirkit.board.inspect` and the rest of the run UNAFFECTED (fail-closed
  without collateral damage).
- Browser-supplied authority-shaped context keys are ignored by contract:
  the editor-context schema has no authority field, and a smuggled key
  never reaches sealing (B13 #14 gate re-asserted against the production
  path).

## Provider parity (R8 closure — no more vacuous test)

The B13 parity test compared a hand-built object to itself. The B13.1
test renders the REAL registry entry for
`sirkit.component-authority.inspect` through the REAL transforms:

- `renderOpenAiResponsesTool(entry)` → OpenAI Responses tool shape
- `renderAnthropicAgentTool(entry)` → Anthropic tool shape

and asserts:

- `JSON.stringify(openai.parameters) === JSON.stringify(anthropic.input_schema)`
  (byte-identical schema projection),
- names agree (`sirkit.component-authority.inspect` under each provider's
  naming rule),
- `additionalProperties: false` present in the rendered schema,
- the tool appears in BOTH rendered toolsets when the resource is valid
  and NEITHER when it is withheld.

A mocked provider transform can no longer satisfy the test: it imports
the production render functions from the provider adapter module.

## Manifest determinism

Same run inputs ⇒ byte-identical sealed manifest digest across repeated
seals; changing one durable record changes the digest (re-pinned in the
rewritten b13 suite, #21).
