# B13.2 §B — exact-authority internal consistency

## The defect (R4)

`hasCompleteExactAuthority` checked MPN agreement only. A record whose
`selectedPart.manufacturer` disagreed with `exactAuthority.manufacturer` —
same MPN, different vendor — still classified `verified-exact`, and the grant
path (which gates on that state) would then mint a grant.

## The strengthened rule

[component-authority.ts](../../app/lib/engineering/component-authority.ts)

`verified-exact` now requires ALL of:

1. a `selectedPart` exists (a record with no selection can never be
   verified-exact);
2. `selectedPart.mpn === exactAuthority.mpn`;
3. **`selectedPart.manufacturer === exactAuthority.manufacturer`** (new);
4. every structural identifier — `atomicPartRevisionId`,
   `symbolAssetVersionId`, `footprintAssetVersionId`,
   `mappingCertificateId`, and `selectionRecordId` when present — is a valid
   bounded identifier: `/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,199}$/` (no
   whitespace anywhere, no control characters, ≤200 chars, non-empty);
5. `mpn` and `manufacturer` are bounded identity strings: non-empty, already
   trimmed (no leading/trailing whitespace, so no whitespace-only identity),
   control-character free, ≤200 chars — interior spaces remain legal because
   real manufacturer names contain them;
6. all previously required facets (conflict none, not stale, lifecycle
   selected, footprint available, mapping verified, approval approved).

Anything short of this is the truthful `exact-authority-unresolved`, which is
structurally grant-incapable.

## Inspection and grant agree

The grant path (`consumeReplacementAuthority`) refuses anything whose
inspected state is not `verified-exact`, so tightening the classifier
tightens grant eligibility in lockstep — proven directly in test 10b: the
manufacturer-mismatched record is refused with `not_verified` through the
REAL grant path (real sealed envelopes, real bundle validation), while the
consistent control still mints a grant. No grant-path check was weakened;
the `asset_mismatch` derive/compare hardening from B13 is untouched.

## Cases pinned

| case | state |
| --- | --- |
| manufacturer mismatch (same MPN) | `exact-authority-unresolved` |
| MPN mismatch (same manufacturer) | `exact-authority-unresolved` |
| empty `atomicPartRevisionId` | `exact-authority-unresolved` |
| whitespace-only `symbolAssetVersionId` | `exact-authority-unresolved` |
| `footprintAssetVersionId` with an interior space | `exact-authority-unresolved` |
| `mappingCertificateId` with a space | `exact-authority-unresolved` |
| empty `mpn` / whitespace-only `manufacturer` / leading-space `mpn` | `exact-authority-unresolved` |
| non-token `selectionRecordId` | `exact-authority-unresolved` |
| no `selectedPart` | `unresolved` |
| fully consistent control | `verified-exact` (and grants) |
