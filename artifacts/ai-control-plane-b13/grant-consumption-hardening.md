# B13 — grant consumption hardening

Module: [schematic-authority.internal.ts](../../app/lib/engineering/schematic-authority.internal.ts) — `consumeReplacementAuthority`.

## The defect (pre-edit #7)

The consumer compared only `targetPartId` (against `selectedPart.mpn` /
`permittedAlternatives`) and `atomicPartRevisionId` (against
`record.authorityRevision`). It then installed the caller-supplied
`symbolAssetVersionId`, `footprintAssetVersionId`, `mappingCertificateId`,
and `selectionRecordId` into the branded grant with NO comparison. An
attacker controlling the caller controlled which assets a "verified"
replacement would install. Reproduced: all four attacker values were
installed verbatim.

## The closure

After the bundle/scope/revision/verified-exact checks, the consumer now
requires a server-owned `record.exactAuthority` and DERIVES every
installed asset field from it:

1. `record.exactAuthority` MUST be present → else `incomplete_identity`
   ("a permitted MPN string is not replacement authority; no server-owned
   exact authority").
2. `targetPartId` MUST equal `exactAuthority.mpn` (the selected exact
   part) → else `wrong_part`. A permitted-alternative MPN is a candidate
   only, never a verified target.
3. For each of `atomicPartRevisionId`, `symbolAssetVersionId`,
   `footprintAssetVersionId`, `mappingCertificateId`, `selectionRecordId`:
   the DERIVED value is the record's; if the caller supplied that field it
   MUST exactly equal the derived value → else `asset_mismatch`, refused
   BEFORE any grant is minted or registered.
4. The exact block must itself be complete (required assets non-empty) →
   else `incomplete_identity`.
5. The grant is content-identified by the DERIVED (server-owned) identity
   and installs the derived values — the caller may name the component and
   target part; it may NOT choose authoritative asset identifiers.

New failure code: `asset_mismatch`. Preserved unchanged: branded runtime
grant identity (`instanceof`), scope binding, canonical-revision binding,
consumed-resource digest binding, single-use retirement, and the
executor-side `verifyReplacementAuthorityGrant` gate.

## Proof

`b13-component-authority-bridge.test.ts`:
- #17 an exact authorized selection mints a grant whose symbol/footprint/
  mapping/selection are the SERVER-OWNED values (derived, not supplied).
- #18 substituting ANY one of the five asset fields → `asset_mismatch`,
  refused before registration (the #7 closure, field by field).
- #15/#16 a record without `exactAuthority` (candidate-only or permitted
  alternative) → `incomplete_identity`; a permitted-alternative MPN with a
  selected-part exact block → `wrong_part`.
- The B06.1 suite (updated to carry server-owned exact authority in its
  fixture) stays green, including the executor-side grant gate.
