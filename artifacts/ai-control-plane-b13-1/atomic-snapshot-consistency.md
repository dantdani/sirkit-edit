# B13.1 §D — atomic snapshot consistency

## The defect (R5)

B13's atomic confirmation proved only `{ revisionId, published }`. The
binding-side asset identifiers (symbol/footprint versions, mapping
certificate, MPN, manufacturer) were projected into `exactAuthority`
UNCHECKED — a drifted or forged binding could assert
`sym-BINDING`/`MPN-BINDING` and the grant path would demand exactly those
values.

## The rule

`AtomicRevisionConfirmation` is now an allowlisted projection of the
PUBLISHED `PortableAtomicSnapshot`:

| confirmation field | snapshot source | cross-checked against binding |
| --- | --- | --- |
| `revisionId` | `atomicRevision.id` | `selectedBinding.atomicPartRevisionId` |
| `published` | `publicationState === "published"` | must be true |
| `exactMpn` | `exactPart.exactMpn` | `physicalTruth.exactMpn` |
| `manufacturerId` | `exactPart.manufacturerId` | `physicalTruth.manufacturerId` |
| `symbolAssetVersionId` | `symbol.versionId` | `assetBinding.symbolAssetVersionId` |
| `footprintAssetVersionId` | `footprint.versionId` | `assetBinding.footprintAssetVersionId` |
| `mappingCertificateId` | `mapping.id` (state must be `approved`) | `assetBinding.mappingCertificateId` |

`resolveExactAuthority` compares ALL FIVE binding-side values against the
snapshot projection. ANY disagreement ⇒ no exactAuthority (the record
becomes truthful `exact-authority-unresolved`, never a partial or
binding-derived block). The projected `exactAuthority` values are the
CONFIRMED values — the ones `consumeReplacementAuthority` later
exact-compares, so a grant can only ever be minted for asset IDs the
published atomic source of truth actually names.

The production confirmer (`component-authority-runtime.ts`) builds this
projection from `loadPublishedPortableSnapshot` and returns null for
unpublished, unapproved-mapping, or structurally incomplete snapshots.

## Proof (§D)

Five single-field mismatch cases (symbol version, footprint version,
mapping certificate, MPN, manufacturer) each ⇒
`exact-authority-unresolved` with no exactAuthority; the fully-agreeing
confirmation ⇒ `verified-exact` with every field equal to the snapshot's
values. An unpublished snapshot ⇒ no exactAuthority (runtime adapter test,
§A/§G).
