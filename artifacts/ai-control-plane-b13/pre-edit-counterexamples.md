# B13 — pre-edit counterexamples (verbatim)

Reproduced against PRODUCTION code before any edit with a disposable
probe (`app/lib/engineering/__tests__/__b13probe__.test.ts`, deleted
after capture; run: `npx vitest run … — 3 passed`).

## #7 — caller-supplied asset IDs enter a grant with NO server-owned comparison (THE security defect)

The fixture authority record authorizes `u1-id → lib:part-b` at revision
`rev-new` and carries **no** `symbolAssetVersionId`,
`footprintAssetVersionId`, `mappingCertificateId`, or
`selectionRecordId`. An attacker supplies arbitrary values for all four
to `consumeReplacementAuthority`:

```
B13 #7 OBSERVED: {"ok":true,"installedSymbol":"ATTACKER-symbol-v99","installedFootprint":"ATTACKER-footprint-v99","installedMapping":"ATTACKER-cert-v99","installedSelection":"ATTACKER-sel-v99"}
```

Consumption SUCCEEDS and the branded `VerifiedReplacementAuthority` grant
carries the attacker's asset IDs verbatim. `consumeReplacementAuthority`
(schematic-authority.internal.ts) compares only `targetPartId` against
`selectedPart.mpn`/`permittedAlternatives` and `atomicPartRevisionId`
against `record.authorityRevision`; the other four `target.*` fields
(schematic-authority.internal.ts:317–321) are installed into the grant
with zero comparison against any server-owned record. Since the executor
gate (`verifyReplacementAuthorityGrant`) only checks that the OPERATION
equals the GRANT, an attacker who controls the caller controls which
symbol/footprint/mapping/selection asset a "verified" replacement
installs. (The B06.1 fixture `fixtureVerifiedAuthority` itself supplies
`mappingCertificateId: "cert-new"` / `selectionRecordId: "sel-new"` that
appear nowhere in its record — the defect is visible in the shipped
fixture.)

## #1 — a normal production resource bundle carries no component-authority-records envelope

```
B13 #1 OBSERVED: bundleKinds=["canonical-state","drc-rules","drc-preset","fab-preset"] hasAuthority=false
```

`buildAgentResourceBundle` (agent/context.ts) never seals a
`component-authority-records` envelope — the kind is first-class in
`READ_RESOURCE_KINDS` and consumed by fixtures, but no production path
produces it.

## #2 — the component-authority inspection tool is withheld from a real agent chat run

```
B13 #2 OBSERVED: included=false exclusionReason=not_agent_exposed
```

`discoverTools` over a real assembled agent context excludes
`sirkit.component-authority.inspect`. Its descriptor is `agentExposed:
false` (tool-catalog.ts), so it is dropped with `not_agent_exposed`
BEFORE resource logic runs; separately, its `requiredResources` include
`component-authority-records`, which #1 shows is never produced. Two
independent reasons it can never be called in a real run today.

## #3–#6, #8 — cannot be demonstrated because no production loader exists

The stage's counterexamples #3 (browser-authored records cannot become
authority), #4 (foreign tenant/project/branch must not enter), #5
(duplicate/conflicting must stay conflicted, never merged), #6 (stale/
unapproved/unavailable-footprint/unverified must not become
`verified-exact`), and #8 (DB failure/timeout/missing → explicit
unavailable/unknown without breaking unrelated tools) all concern a
SERVER-OWNED authority loader that **does not exist** in production
today. The controlling disposition
(`artifacts/ai-control-plane-b10/component-authority-disposition.md`)
records the blocker verbatim: *"No proven server-owned producer exists
for per-run component-authority-records: the binding repository is
project-DB scoped and browser-independent, and nothing in the chat
request may be trusted to supply or select those records."*

The pure inspector `inspectComponentAuthority` already enforces the
record-level halves of #4 (foreign-project rejection),
#5 (duplicate → `conflicted`, never merged), and #6 (`verified-exact`
classification), but there is no production code that BUILDS records from
the durable repositories to feed it — so these guarantees are exercised
only by fixtures. Establishing that loader, and making #3–#6/#8
production-real and adversarially tested, is B13's work.
