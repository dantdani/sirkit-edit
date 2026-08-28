# B16.0.17.1 — Superseded claims

## The invalid B16.0.17 claim (retired)

B16.0.17's report, `pre-edit-counterexamples.md`, `proposal-provider-parity.md`,
`unknowns-and-owner-decisions.md` and `final-verdict.md` stated that the
unknown-semantic-ID pin exercised `CD8_AI_PROPOSAL_REFERENCE_INVALID` ("the
deterministic validator DID run and rejected it" / "unknown IDs refused").

**That claim was invalid.** The fixture did not satisfy the
`SCHEMATIC_PROPOSAL_TOOL` schema; the observed failure was
`TypeError: Cannot read properties of undefined (reading 'map')` — the
known-ID validation was never reached. Additionally the graph fixture omitted
`units`/`portBindings`/`bundleDefinitions`/`graphId`, so even correct payloads
would have crashed on the graph shape.

Supersession notes are now APPENDED to each of those four documents (historical
text preserved as evidence, explicitly marked not-a-valid-proof).

## The B16.0.17 owner-decision item 4 (retired)

B16.0.17 recorded "unknown-ID throw surfaces via providerErrorResponse —
future owner decision whether to remap to a dedicated 422". That decision is
NOW TAKEN by this corrective mandate: unknown IDs return a deterministic local
**422 `CD8_AI_PROPOSAL_REFERENCE_INVALID`**, and malformed provider output
returns **422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID`** — neither ever surfaces as
a provider availability/quota/rate failure.

## What is NOT superseded

Everything else in B16.0.17 stands: the ten-route migration, inventory
91/3/59, baseline 62, the other 81 parity pins, the confinement gates, KiCad
quarantine, layout view-only, export approval chain, transaction security, and
the tool-exposure invariants — all re-verified green in this stage's runs.
