# B16.0.17 §E — Round-trip truthfulness (CONFIRMED)

`/compare` (migrated) remains a DIAGNOSTIC endpoint that cannot fabricate a
certified round-trip:

| Rule | Evidence |
|---|---|
| source + independently reparsed graphs must validate | `validateSchematicGraph` on both (unchanged) |
| trusted-project binding | both graphs' `projectId` checked against the trusted scope |
| `artifactManifestId` required | 400 without it (pinned exact message) |
| `independentParserRevisionId` remains `none-certified` | hardcoded in the route (gate asserts the literal); pinned in the response certificate |
| `unsupportedConstructIds` includes `NO_CERTIFIED_KICAD_SEMANTIC_ADAPTER` | hardcoded (gate + pin) |
| response remains diagnostic-only and **422** | pinned: 422 with `ok:false`, the certificate, and the explicit "No KiCad version is certified…; comparison is diagnostic only." error |
| no KiCad version claimed certified | the 422 + none-certified parser make certification impossible through this surface |
| no semantically-equivalent certificate fabricated | the standing routes.test pins `certificateState: "unsupported_construct"` |

The equivalence policy revision (`sirkit-schematic-equivalence/1.0.0`) and the
`certifySemanticRoundTrip` implementation are untouched.
