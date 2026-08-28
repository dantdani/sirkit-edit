# B13 — discovery and invocation results

## The exposure change

`sirkit.component-authority.inspect` (descriptor in
[tool-catalog.ts](../../app/lib/engineering/tool-catalog.ts)) is now
`agentExposed: true` — the same pattern as
`sirkit.manufacturing.readiness-inspect` (statically exposed; per-run
availability gated on a required resource). No second registry, no special
provider path, no new tool: the EXISTING binding becomes callable.

The static agent-exposed set is therefore TEN read/propose tools (was
nine). This is the stage's explicit objective ("the existing
component-authority inspection binding becomes callable"), and it satisfies
the security invariant "static provider exposure must not gain
mutation/release tools" — the addition is a READ tool. Every "nine"/"NINE"
exposure-count assertion across B04/B09/B10/B11/B12 was updated to ten (a
strictly truthful count change; the no-mutation/no-release/no-apply
invariants are unchanged and still asserted).

## Per-run availability

- **Included when valid**: a run whose context carries the server-owned
  `component-authority-records` resource advertises `durable-server-board`
  authority and lists `component-authority-records` in
  `availableResourceKinds` (loop.ts). The binding's `requiredResources`
  (`canonical-state` + `component-authority-records`) are satisfied, so
  `buildRunToolset` includes the tool. Proven: B13 #22.
- **Withheld otherwise**: no resource ⇒ the kind is absent ⇒ the tool is
  filtered out with a truthful warning; no alternate snapshot/candidate
  fallback exists. Proven: B13 #23, #24.

## Invocation evidence and output

The binding is unchanged: it consumes ONLY the sealed resource, returns
`{ components: ComponentAuthoritySummary[], pinned: { authorityResource:
{resourceId, kind, sourceVersion, contentDigest} } }` — the closed
allowlisted summary plus resource id + digest, never contents. The B05
invocation service records the consumed resource id/digest and the bundle
manifest digest as invocation evidence.

## Provider parity

Both provider adapters render the tool's input schema identically (B13
#25); the regenerated B04 provider-parity artifact and the B09 schema
suites (updated to ten) confirm no schema drift.
