# B16.0.12 §E — KiCad HTTP-library token boundary proof (category route)

`GET /api/kicad/v1/parts/category/[id]` migrated to the narrow canonical
`kicadLibraryRoute({ routeParams: ["id"] })` — the SAME dedicated variant the
tranche-1 `parts/[id]` route adopted. **Target-classification correction
recorded**: the generic matrix suggested a public wrapper, but production uses
the dedicated KiCad token protocol; current behavior is authoritative and the
generated matrix now records `kicadLibraryRoute`.

## Preserved exactly (pinned pre = post)

| Behavior | Pin |
|---|---|
| `KICAD_HTTP_LIBRARY_TOKEN` unconfigured → **503** | with **ZERO DB selects** |
| missing / wrong `Authorization: Token …` → **401** (constant-time compare) | with **ZERO DB selects** |
| token verification BEFORE parameter processing and database access | wrapper runs the boundary first by construction; the 503/401 pins never touch params |
| `published.json` and `published` compatibility | `.json` suffix stripped in the callback (historical logic byte-preserved) |
| unknown category → `[]` (200) | pinned |
| output ordering (`ORDER BY id ASC`) and the 5,000-row ceiling | the query is byte-identical to the pre-migration code |

## Callback confinement

The callback receives `{ params, meta }` only — the Authorization header and
the raw Request are consumed inside the wrapper's constant-time boundary
(`authorizeKicadHttpLibrary`) and never reach route code. The b16-0-8 wrapper
capability suite additionally proves secret headers are structurally
unavailable to `kicadLibraryRoute` callbacks.
