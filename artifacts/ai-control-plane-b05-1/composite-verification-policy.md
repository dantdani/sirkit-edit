# B05.1 — Composite Verification Policy

Authoritative code: `app/lib/engineering/tool-invocation.ts`,
`tool-bindings-readonly.ts`. Tests: `__tests__/b05-1-resource-pinning.test.ts`.

## Why

B05 reported composite reads (DRC, readiness, component authority,
selection) as `revision-verified` when only the canonical board had been
revision-verified — auxiliary inputs (rules, presets, authority records,
netlist) were unversioned. B05.1 makes verification truthful.

## Declared consumption

Every activated binding declares `requiredResources` (always including
`canonical-state`) and optional kinds. The service builds a SCOPED resource
view containing exactly the declared kinds — undeclared resources are
structurally absent, so a binding cannot read them (tested):

| Tool | Required | Optional |
|---|---|---|
| canonical-revision-inspect, pcb.revision-inspect, board-inspect, connectivity-verify | canonical-state | — |
| selection.inspect | canonical-state + selection-snapshot | — |
| validation.drc-run | canonical-state + drc-rules | — |
| component-authority.inspect | canonical-state + component-authority-records | — |
| manufacturing.readiness-inspect | canonical-state + fab-preset + drc-preset | netlist |

(Generated form: `resource-consumption-matrix.csv`.)

## Verification states

- `canonical-revision-verified` — the binding consumed ONLY canonical state,
  and it re-verified after execution.
- `composite-resources-verified` — the binding consumed auxiliary authority;
  EVERY consumed resource (canonical revision, per-resource content digests,
  and the bundle manifest digest) re-verified after execution.

Composite tools succeed only with `composite-resources-verified`. Partial
verification is never reported as full verification; the blanket
`revision-verified` state no longer exists. Post-invocation, any consumed
resource that changed discards the output (`stale_resource` /
`corrupt_resource`).

## Result + trace provenance

Successful results and traces carry `consumedResources` (id, kind, source
version, content digest per consumed resource) and the bundle
`resourceManifestDigest` — identities and digests only, never contents.
Pinned outputs additionally name their exact inputs: DRC → board revision +
rules resource + engine version (`pcb-drc/2`) + report digest; readiness →
board revision + fab/DRC preset refs + optional netlist ref + engine id +
report digest (inspection only — never manufacturing authority or release
evidence); component authority → the authority-records resource ref, with
per-record `authorityRecordId`/revision/record digest.

## Replay

Fixtures (`sirkit.read-replay-fixture.v2`) pin the full bundle and expect
output digest + consumed-manifest digest + verification state. Replay fails
on: content change, forged content digest, resource-version change,
authority-scope change, dependency-digest change, manifest-digest change,
and auxiliary-resource change with the board unchanged (all tested).
