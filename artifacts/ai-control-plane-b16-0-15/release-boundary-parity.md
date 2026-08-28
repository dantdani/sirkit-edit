# B16.0.15 §E — Release boundary parity (CONFIRMED)

`POST /api/pcb/release` → `authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 })`
(project_admin only). The callback receives `{ context, body }` and calls the
UNCHANGED release-gate flow.

| Requirement (§E) | Status | Evidence |
|---|---|---|
| 1. client board/netlist/snapshot/path refused before durable work | CONFIRMED | forbidden `snapshot`/`board`/`path` → 400 before `store.get` |
| 2. authority loaded from server-owned durable storage | CONFIRMED | `store.get({trusted scope + ids})` (pinned) |
| 3. missing authority → exact historical 404 | CONFIRMED | 404 `MFG_AUTHORITY_NOT_FOUND`, exact message |
| 4. locator built only from trusted context + validated designId/boardId | CONFIRMED | pin asserts the exact locator object |
| 5. expectedBoardRevision/Digest come only from the stored authority | CONFIRMED | pin: attacker body `boardRevision`/`boardDigest` ignored; locator carries `stored.boardRevision`/`stored.boardDigest` |
| 6. releaseManufacturingPackage gets the pinned locator + authoritative loader | CONFIRMED | pin captures `{ locator, loadAuthority: store.loader(locator) }` |
| 7. authority reloaded/revalidated through the existing release gate | UNCHANGED | `releaseManufacturingPackage` internals untouched |
| 8. no client field selects/replaces board bytes/revision/digest/netlist/rule profile/fab preset/RC evidence/component authority/release mode | CONFIRMED | the callback reads ONLY `body.boardId`, `body.designId`, `body.format`; everything else is server-owned |
| 9. format="manifest" exact JSON | CONFIRMED | pin: `{ ok, releaseId, archiveSha256, manifest, validation }` + no-store |
| 10. default ZIP bytes + exact headers | CONFIRMED | [release-artifact-byte-and-header-parity.md](release-artifact-byte-and-header-parity.md) |
| 11. filename sanitization unchanged | CONFIRMED | `sirkit-b1-<releaseId.slice(-12)>.zip` pinned |
| 12. error-code/status mapping unchanged | UNCHANGED | catch block byte-identical (422 + `MFG_*` code extraction) |
| 13. maxDuration = 300 | UNCHANGED | module export untouched |
| 14. no artifact when any check fails | UNCHANGED | `releaseManufacturingPackage` throws → 422, no bytes emitted |
