# B16.0.15 §E — Release authority pinning (CONFIRMED)

## The client cannot author manufacturing authority

The release callback consumes only three body fields — `boardId`, `designId`,
`format`. It never reads board bytes, revision, digest, netlist, rule profile,
fab preset, RC01/RC02/RC03 evidence, component authority, or release mode from
the body. All of those come from the durable authority the server loads.

## Locator pinning (pinned)

```
store.get({ tenantId, projectId, branchId, designId, boardId })   // trusted scope + validated ids
locator = {
  tenantId, projectId, branchId, designId, boardId,               // trusted context + validated ids
  expectedBoardRevision: stored.boardRevision,                    // from STORED authority
  expectedBoardDigest:  stored.boardDigest,                       // from STORED authority
}
releaseManufacturingPackage({ locator, loadAuthority: store.loader(locator) })
```

The pin submits a body carrying `boardRevision: "attacker-rev"` and
`boardDigest: "attacker-digest"` and asserts the locator handed to the release
gate carries the **stored** `rev-9` / `sha256:board9` instead — the attacker
values are dropped.

## Reload + revalidation

`store.loader(locator)` returns the authoritative loader; the release gate
reloads and revalidates the authority against the pinned locator and fails
closed on any drift. That gate logic is UNCHANGED by this stage and is covered
by the standing MFG01 manufacturing-release-gate suite (green, unmodified).

## Failure = no authority

A missing authority returns 404 and `releaseManufacturingPackage` is never
called; any downstream authority/readback/archive/profile/DRC/connectivity/
parity/digest failure throws inside the gate → 422 with no artifact bytes.
