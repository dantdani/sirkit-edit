# B13.1 §E — authority state semantics

## The defect (R6)

B13 classified a record `verified-exact` whenever its facets were
verified — even with NO server-owned exactAuthority. "Verified exact"
asserted exactness the server had not established, and the gap report
hid the missing authority.

## The rule

[component-authority.ts](../../app/lib/engineering/component-authority.ts):

- New state `exact-authority-unresolved`, inserted after `verified-exact`
  in `AUTHORITY_STATES` (a real, truthful state — not a synonym for
  unknown).
- `hasCompleteExactAuthority(record)` requires ALL of
  `atomicPartRevisionId`, `mpn`, `manufacturer`, `symbolAssetVersionId`,
  `footprintAssetVersionId`, `mappingCertificateId` to be non-empty
  strings AND the record's `selectedPart.mpn` to agree with
  `exactAuthority.mpn`.
- `classify()`: verified facets WITHOUT complete exactAuthority ⇒
  `exact-authority-unresolved`. `verified-exact` now MEANS: facets
  verified AND a complete, internally consistent, server-confirmed
  exactAuthority exists.
- `gapsFor()` for the new state names the true gap: "server-owned exact
  authority is missing or incomplete".

Downstream, `consumeReplacementAuthority` only ever grants from records
carrying exactAuthority, so the new state is structurally grant-incapable
— truthful inspection without escalation.

## Ripple (made truthful, not relaxed)

- `tool-read-replay.ts` fixture `auth:u1` verified record now carries a
  full exactAuthority block (it always claimed verified-exact; now it
  proves it). b05 replay artifacts regenerated once, byte-stable ×2.
- b05 read-invocation suite: verified-exact cases carry exactAuthority; a
  new `c-facets-no-exact` case pins `exact-authority-unresolved`.
- No assertion was weakened — every prior verified-exact expectation still
  asserts verified-exact, now with the stronger precondition satisfied.

## Proof (§E)

Facet-verified record with exactAuthority stripped ⇒
`exact-authority-unresolved`, gaps name missing exact authority, sealed
envelope carries the state verbatim; with exactAuthority ⇒
`verified-exact`. Partial blocks (any single field emptied) ⇒
`exact-authority-unresolved`.
