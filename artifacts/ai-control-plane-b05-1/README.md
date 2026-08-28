# B05.1 — Authority-Resource Pinning

Closes the composite-provenance gap B05 verification found: auxiliary
resources (DRC rules, fabrication/DRC presets, netlist, component-authority
records, selection snapshots) are now versioned, digest-verified, scoped,
and re-verified after execution — a composite read can no longer claim
verification on the strength of the canonical board alone.

## What changed

- **Resource envelopes + bundles** (`resource-envelopes.ts`): every consumed
  fact travels in a sealed `ReadAuthorityResourceEnvelope` inside a
  `ReadResourceBundle` with a deterministic manifest digest. Eight
  structured failure codes; deny-by-default validation before authorization
  completes. See `resource-envelope-contract.md`.
- **Declared consumption**: every activated binding names its required/
  optional resource kinds; the service supplies a scoped view of exactly
  those — undeclared resources are structurally absent. See
  `resource-consumption-matrix.csv` (generated).
- **Truthful verification**: `canonical-revision-verified` vs
  `composite-resources-verified`; post-invocation recomputation of every
  consumed digest + the manifest digest; results and traces carry consumed-
  resource references. See `composite-verification-policy.md`.
- **Pinned outputs**: DRC names rules resource + engine version; readiness
  names presets + optional netlist (inspection only); component authority
  names the records resource and per-record id/revision/digest, rejects
  foreign-project records, and NEVER merges conflicting records.
- **Context envelope v2**: sections carry source-resource references, the
  envelope carries the resource-manifest digest, and sections pinned to an
  incompatible canonical revision are refused as `unavailable` (with
  `stale` now distinct from unknown/omitted/unavailable).
- **Replay v2**: bundle-pinned fixtures (`composite-replay-fixtures.json`
  for the composite subset; B05's `read-replay-fixtures.json` regenerated
  in v2 format).

## Verification

`npx vitest run app/lib/engineering/__tests__/b05-1-resource-pinning.test.ts`
— 20 tests over the required matrix (the updated B05 suite carries the
rest). Full engineering suite (B01→B05.1): 189/189. Artifacts regenerate via
`npx tsx scripts/generate-read-invocation-artifacts.ts` and are CI
byte-matched.
