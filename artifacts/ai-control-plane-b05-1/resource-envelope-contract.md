# B05.1 — Authority-Resource Envelope Contract

Authoritative code: `app/lib/engineering/resource-envelopes.ts`.

## Envelope (`sirkit.read-authority-resource.v1`)

Every fact a read binding consumes travels in a sealed envelope:
`resourceId` · `kind` (closed set: canonical-state, selection-snapshot,
component-authority-records, drc-rules, fab-preset, drc-preset, netlist —
unknown kinds fail closed) · tenant/project/branch scope · `authoritySource`
+ `authorityStatus` · `sourceVersion` · `sourceCanonicalRevision` (the
canonical revision the resource is pinned to, when applicable) · `producer`
+ `producerVersion` · optional `generatedAt` (only when a timestamp is
meaningful provenance) · `freshness` · `contentDigest` · optional
`dependencyDigests` · typed `content`.

`sealResourceEnvelope` is the only minting path: it CLONES the content (an
envelope owns its bytes — external aliases can never mutate it) and computes
the content digest. No secrets, credentials, connections, tokens, or
provider request data may appear in envelopes.

## Bundle (`sirkit.read-resource-bundle.v1`)

canonical-state envelope + auxiliary envelopes + deterministic manifest
(id, kind, scope, authority source, source version/revision, content digest,
dependency digests, freshness — sorted by kind then id) + manifest digest.

## Validation (deny by default, structured codes)

`validateReadResourceBundle` enforces, before authorization completes:
structure → recomputed content digests → scope → unique resource ids →
dependency digests → freshness → canonical-revision compatibility →
recomputed manifest digest. Failures use EIGHT structured codes (never a
generic failure): `missing_resource`, `corrupt_resource`, `stale_resource`,
`foreign_resource`, `incompatible_resource_revision`, `manifest_mismatch`,
`dependency_mismatch`, `duplicate_resource`. When several apply, the
reported status follows a deterministic dominance order (corruption >
manifest > duplicates > foreign > incompatibility > dependency > stale >
missing) with every failure listed in diagnostics.

## Trust boundary (accurate, not overstated)

Digest verification proves INTEGRITY AND CONSISTENCY of the supplied
envelopes: nothing consumed differs from what was sealed, and everything is
mutually compatible. It does NOT independently prove that an arbitrary
in-process caller selected the correct real-world authority source —
production composition must construct envelopes through approved authority
adapters. Tool arguments never provide resource contents and never choose
module/store paths; future API/agent callers receive resource REFERENCES,
not authority objects in arguments. No signatures or key management exist,
so no cryptographic authenticity is claimed.
