# B14 §D — `sirkit.schematic-replacement-proposal.v1`

A SEPARATE versioned artifact ([replacement-proposals.ts](../../app/lib/engineering/replacement-proposals.ts))
— the Tier-1 schema is untouched (no ambiguous optional fields).

## Sealed bindings (closed 20-key set incl. `proposalId`)

| field | binds |
| --- | --- |
| `schema` | the exact version |
| `proposalId` | whole-body identity digest (`rprop-…`, `sirkit.schematic-replacement-proposal-id.v1`) |
| `scope` | tenant/project/branch + canonical lineage + base head sequence + base canonical-state digest (`Tier1ProposalScope` reused — the proven scope/head identity) |
| `baseSchematicDigest` | the schematic the plan was compiled against |
| `componentInstanceId` | the ONE component |
| `expectedCurrentPartId` | expected current part identity (hard precondition in the operation) |
| `target` | exact server-owned identity: partId(=MPN), manufacturer, atomic/symbol/footprint revisions, mapping certificate, selection record |
| `operation` + `operationDigest` | the EXACT canonical `schematic_replace_component` operation (`sirkit.schematic-replacement-operation.v1` over base+operation) |
| `impact` + `impactDigest` | the deterministic impact plan (mode, mapping evidence, pin mapping, preserved connections, ZERO dropped connections, wire endpoint moves, net-label moves, downstream, warnings) |
| `authorityResource` / `canonicalResource` | consumed resource IDs + content digests |
| `resourceManifestDigest` | the bundle manifest digest |
| `consumedAuthorityDigest` | digest over the grant's consumed resources |
| `provenance` | provider provenance (display only, never authority) |
| `createdAt` / `expiresAt` | 10-minute TTL |
| `approvalTier` | `"destructive"` (fixed) |

## Fail-closed verification (B12.1 split)

- `verifySealedReplacementProposalIntegrity` — closed keys (unknown/missing
  fields refuse), schema version, operation↔identity coherence (kind,
  component, expected part, all six target fields), ZERO dropped connections,
  operation digest, impact digest, whole-body identity digest.
- `verifySealedReplacementProposal` — currency at the live head:
  foreign-scope / stale-head / expired / stale-base (same vocabulary as
  Tier-1), re-checked INSIDE the session's serialized queue via
  `expectedHeadMark`/`expectedBaseDigest`.

## No reusable runtime grant

The artifact's `operation.authorityGrantId` is a deterministic
content-derived REGISTRY HANDLE. The branded `VerifiedReplacementAuthority`
instance minted at proposal time is RETIRED before the artifact leaves the
assembler (proven `grant_missing` immediately after sealing); serialization
of the class collapses to an inert string. Apply-time execution mints a
FRESH capability after full revalidation — the deterministic id then matches
the sealed operation IF AND ONLY IF the schematic, authority content, and
exact target are unchanged.
