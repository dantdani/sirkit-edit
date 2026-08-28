# B15.2 — pre-edit counterexamples (R10–R16, all reproduced)

Probe: a DISPOSABLE vitest file (`b15-2-probe.test.ts`, deleted after
capture) against the B15.1 tree. Exact outputs verbatim.

## R10 — the parser still throws

```json
{"arrayLengthTrap":"THREW:length trap",
 "revokedRoot":"THREW:Cannot perform 'IsArray' on a proxy that has been revoked",
 "arrayIndexTrap":"THREW:index trap",
 "lateSemanticRead":"THREW:late read"}
```

B15.1 guarded object reflection but left `Array.isArray`, array `length`,
index reads, `Object.keys`, and — critically — the SEMANTIC validation pass,
which re-reads the ORIGINAL proxy-backed value after inspection. All four
escape as exceptions.

## R11 — outline containment is not exact

```json
{"roundrectCornerAccepted":true,"concaveEdgeCrossingAccepted":true,
 "dimensionRenderOffBoardAccepted":true}
```

A keepout in the CLIPPED CORNER of a roundrect passes (bounding-box test); a
keepout whose vertices sit in both arms of an L but whose EDGE crosses the
notch passes (vertex-only test); a dimension whose endpoints are on-board but
whose rendered offset line lies off-board passes (endpoint-only test).

## R12 — footprint hard constraints ignored

```json
{"fixedPositionMoved":true,"mechanicalMoved":true,
 "edgeConnectorMoved":true,"disallowedRotation":true}
```

Only `locked` was checked. `placement.fixedPosition`, `placement.mechanical`,
`placement.edgeConnector`, and `placement.allowedRotations` are all ignored.

## R13 — global routing minima incomplete

```json
{"defaultMinTrackWidthNm":127000,"powerClassMinTrackWidthNm":400000,
 "globalPreferenceAtDefaultMinimumAccepted":true,
 "tinyPadstackAccepted":true,"tinyPadstackOuterNm":200000,"activeMinViaOuterNm":600000}
```

A board carrying a Power-class net accepts a GLOBAL custom track width at the
weaker Default minimum (127 µm vs the Power class's 400 µm), because the
global path resolves only `rules.default`. And `viaPadstackId` is checked for
existence only — a 0.2/0.1 mm padstack is accepted against a 0.6 mm active
via-outer minimum.

## R14 — rule mutation has no effective result

```json
{"deltaAppended":true,"requestedNm":500000,"effectiveBefore":250000,
 "effectiveAfter":250000,"effectiveUnchanged":true,
 "ruleId":"b15-rule-0aea6d7b8a16596e","ruleIdInMinted":false,
 "ruleIdInChanged":false,"provenanceSource":"manual"}
```

The raw delta is appended without `applyRuleDeltas`/`layerRuleDeltas`, so
`getNetClass(candidate, 1).trackWidth` stays 250,000 — the proposal shows a
rule change that does nothing. The minted rule id appears in neither
`mintedObjectIds` nor `impact.changedObjectIds`, and the AI-originated delta
is labelled `source: "manual"`.

## R15 — contact identity collision

```json
{"padsCollideLocally":true,"padsDistinctCanonically":true,
 "zoneRegionsCollideLocally":true,"zoneRegionsDistinctCanonically":true,
 "differentZonesCollideLocally":true,
 "localPadKey":"pad|||1","canonicalPadKey":"pad:U1:1"}
```

The local `pairKey` reads `kind/id/footprintId/padNumber`. `CopperItemRef`
pads carry `instanceId` (not `footprintId`), so every pad numbered "1"
collapses to `pad|||1` regardless of footprint; and zone regions carry
`zoneId`/`regionIndex`, so EVERY zone region on the board collapses to one
key. The shared `copperItemId` distinguishes all of them. (The probe
replicates the private function's exact expression and compares behaviour
against `copperItemId` — no source-text assertion.)

## R16 — seal boundary forgeable and non-total

```json
{"sealerReturnedForeignToolArtifact":"sirkit.evil.tool",
 "verifyOnRevokedProxy":"THREW:Cannot perform 'IsArray' on a proxy that has been revoked",
 "compilerAcceptedForeignBaseIdentity":true,"realBaseIdentity":"pcb2-1c7e123"}
```

`sealPcbEditProposal` still RETURNS an artifact carrying a foreign tool
id/version (verification catches it later, but the assembler mints it);
`verifySealedPcbEditProposalIntegrity` throws on a revoked proxy instead of
refusing; and `compileBoundedPcbEdit` accepts a caller-chosen `baseIdentity`
unrelated to `pcbRevisionId(board)`, which is the input to every deterministic
minted id.
