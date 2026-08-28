# B15.1 — pre-edit counterexamples (R1–R9, all reproduced)

Probe: a DISPOSABLE vitest file (`b15-1-probe.test.ts`, deleted after
capture) run against the B15 tree as delivered. Every counterexample the
independent verification raised is confirmed. Exact outputs verbatim.

## R1 — byte ceiling failure

```json
{"actualUtf8Bytes":40649,"ceiling":32768,"parseOk":true}
```

A 16-operation keepout payload whose real UTF-8 JSON serialization is
**40,649 bytes** parses `ok: true` against a declared 32,768-byte ceiling.
The budget counted only string lengths, 8 per number, and key names — it
ignored structural punctuation, quoting, escaping, and multibyte width, so
it undercounted by ~30%.

## R2 — parser totality failure

```json
{"ownKeys":"THREW:ownKeys trap","getPrototypeOf":"THREW:getPrototypeOf trap"}
```

Proxies whose `ownKeys` / `getPrototypeOf` traps throw make
`parseBoundedEditRequest` **throw** instead of returning a bounded
`hostile-input` refusal. The reflection boundary was unguarded.

## R3 — strict-schema failure

```json
{"ok":true,"candidateName":123,"typeofName":"number"}
```

`update_keepout` accepts `name: 123` and writes the **number** into the
candidate board. The add form validates `name`; the update form never did.

## R4 — geometry and structural-validation failures (all four)

```json
{"evilDimensionLayer":true,"degenerateKeepout":true,
 "keepoutInConcaveNotch":true,"dimensionInConcaveNotch":true}
```

Accepted: a dimension on an unsupported layer `evilLayer`; a keepout whose
three vertices are identical (zero area); and both a keepout and a
dimension placed in the notch of a concave L-shaped outline — inside the
bounding box but **outside the actual board**. Containment was
bounding-box only, and no structural authority was consulted.

## R5 — manufacturing-minimum failure

```json
{"bareNetRuleAccepted":true,"illegalPreferenceAccepted":true,
 "activeMinTrackWidthNm":null,"activeMinDrillNm":null}
```

On a net with no existing copper, a rule of 1,000 nm track / 1,000 nm
clearance / 2,000 nm via / 1,000 nm drill is accepted, as is a 1,000 nm
custom routing preference. The floor was the *empirical* narrowest
existing copper, which is null on a bare net — so there was no floor at
all, and the active fabrication rules were never consulted.

## R6 — padstack invariant failure

```json
{"updateOk":true,"updatedPadstack":"ps-big","updatedSize":600000,"updatedDrill":300000,
 "addOk":true,"addedPadstack":"ps-big","addedSize":600000,"addedDrill":300000}
```

Assigning the 1.2/0.6 mm padstack `ps-big` to a 0.6/0.3 mm via changes
`padstackId` but leaves the denormalized `size`/`drill` at 600,000/300,000.
`add_via` with a padstack plus conflicting provider dimensions silently
keeps the provider's numbers. The load-bearing denormalization invariant is
violated in both directions.

## R7 — seal consistency failure

```json
{"verdict":{"ok":true},"sealedOperationsDigest":"FORGED-OPERATIONS-DIGEST",
 "candidateDigest":"FORGED-CANDIDATE-DIGEST-DIFFERENT-FROM-IMPACT",
 "digestsAgree":false,"toolId":"sirkit.totally.different-tool"}
```

`sealPcbEditProposal` accepts caller-supplied pins verbatim and
`verifySealedPcbEditProposalIntegrity` returns `{ok:true}` for a proposal
with a forged operations digest, a forged impact digest, a candidate digest
that disagrees with `impact.candidateBoardDigest`, and a foreign tool
id/version. The whole-body digest certified the forgery instead of
detecting it, because it was computed over the forged values.

## R8 — connectivity identity failure

```json
{"shortsCompared":true,"unknownContactsCompared":true,"routedNetsCompared":true,
 "comparesShortIdentities":false,"comparesPerNetCompletion":false}
```

Safety compares **array lengths and routed-net counts only**. Equal
aggregates therefore conceal: one short resolved while a different short is
introduced; one unknown contact resolved while a different one appears; and
one net losing completion while a different net gains it.

## R9 — coverage omission

```json
{"hasPlaceholderComment":true,"hasVoidCases":true,
 "executesMoveFootprint":false,"executesRotateFootprint":false}
```

The B15 suite contains a footprint placeholder (`void cases;` with a "no
footprints on the fixture" comment) and never executes a successful
`move_footprint` or `rotate_footprint` — two of the nine mandated intents
were unproven.
