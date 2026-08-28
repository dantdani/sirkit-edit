# B13 — exact target authority contract

A verified replacement target must be backed by EXACT server-owned facts.
The loader resolves the `exactAuthority` block for a selection ONLY when
ALL of the following hold (`resolveExactAuthority` in
[component-authority-source.ts](../../app/lib/engineering/component-authority-source.ts)):

1. The selection is FULLY verified by facet precedence (mirrors the
   inspector's `verified-exact`): conflict none, not stale, lifecycle
   `selected` with an exact part, footprint `available`, mapping
   `verified`, approval `approved`.
2. The durable binding carries every exact identity fact:
   `exactPart.atomicPartRevisionId`, `exactPart.exactPublishedMpn`,
   `exactPart.manufacturerId`, `pinPadMapping.symbolAssetVersionId`,
   a footprint asset version (`footprint.assetVersionId` or the mapping's
   `footprintAssetVersionId`), and `pinPadMapping.mappingCertificateId`.
   Any missing fact ⇒ no `exactAuthority`.
3. The atomic revision is CONFIRMED PUBLISHED by the atomic authority
   (`deps.atomic(atomicPartRevisionId)` returns non-null and matching).
   A missing/unpublished revision ⇒ no `exactAuthority`, even if the
   binding looks verified. An atomic confirmer failure ⇒ the whole load
   is `unavailable` (fail closed).

`selectionRecordId` is derived from `pinPadMapping.mappingRevisionId`
when present (optional).

## Consequences

- An MPN string — selected OR a permitted alternative — is NEVER exact
  authority on its own. Only the selected exact part with a complete
  server-owned `exactAuthority` can become a verified replacement target
  ([grant-consumption-hardening.md](grant-consumption-hardening.md)).
- A stale, unapproved, unavailable-footprint, unverified, or
  atomic-unconfirmed selection carries facet states truthfully but NO
  exact authority — it can be inspected, never replaced.
- Every installed field in a verified grant is DERIVED from this block,
  so the exact target identity is a server-owned fact end to end.
