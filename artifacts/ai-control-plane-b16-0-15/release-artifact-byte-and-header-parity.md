# B16.0.15 §E.10 — Release artifact byte & header parity (CONFIRMED)

The default (non-manifest) release response is byte/header-preserved. With a
fake release artifact `{ releaseId:"rel-abcdef123456", archiveSha256:"sha256:arch",
archiveBytes:[9,8,7] }` and stored authority `boardRevision:"rev-9"`, the pin
asserts:

| Aspect | Value |
|---|---|
| status | 200 |
| body bytes | exactly `Uint8Array([9,8,7])` (the artifact's `archiveBytes`, via `new Uint8Array(...)`) |
| Content-Type | `application/zip` |
| Content-Disposition | `attachment; filename="sirkit-b1-abcdef123456.zip"` (boardId sanitized + `releaseId.slice(-12)`) |
| Cache-Control | `no-store` |
| X-Sirkit-Release-Id | `rel-abcdef123456` |
| X-Sirkit-Release-Disposition | `verified_manufacturing_release` |
| X-Sirkit-Archive-Sha256 | `sha256:arch` |
| X-Sirkit-Board-Revision | `rev-9` (from the STORED authority) |

`format="manifest"` returns exactly
`{ ok:true, releaseId, archiveSha256, manifest, validation }` with `no-store`
and emits no ZIP bytes.

The response-construction code is byte-identical to the pre-migration handler —
only the boundary prologue changed. Archive construction/readback and digest
logic are UNCHANGED (§H) and covered by the standing MFG01 suite.
