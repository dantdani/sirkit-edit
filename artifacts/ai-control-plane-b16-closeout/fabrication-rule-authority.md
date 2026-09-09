# B16-C.4 — Fabrication-rule authority (via / plated-through-hole split, source-pinned profile)

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = design not yet exercised; RECORDED = written down without a claim; UNKNOWN = not established.

## Reproduced ambiguity (CONFIRMED, OD-1)

- The DRC preset `jlcpcb-2l` carried ONE `minAnnularRingMm 0.15`. `DrcRuleSet.minAnnularRingNm` was documented as the VIA ring (`(viaOuter - viaDrill) / 2`), `checkVia` measured vias only, and no check measured the ring of a plated component pad. The release profile copied the same number as a generic `minAnnularRing`.
- Live manufacturer evidence (JLCPCB 1-2 layer capabilities, retrieved 2026-09-09; the page was re-fetched during this chapter, not quoted from memory): 2-layer minimum via hole / via diameter 0.15 mm / 0.25 mm (preferred min via hole 0.2 mm); PTH annular ring, 1 oz: recommended 0.25 mm or above, absolute minimum 0.18 mm (2 oz: 0.254 mm); PTH drill 0.15 - 6.3 mm; NPTH minimum 0.50 mm; hole-to-hole via 0.2 mm / pad 0.45 mm; 1 oz track / space 0.10 / 0.10 mm; copper to routed edge >= 0.2 mm.
- Consequence reproduced in `app/lib/pcb/__tests__/b16-c-fabrication-rule-authority.test.ts` ("reproduction"): a plated pad with a 0.16 mm ring (1.30 mm pad, 0.98 mm drill) satisfies the 0.15 mm via limit, produces zero via violations, and would have been qualified and released — although it is below the manufacturer's absolute PTH minimum.

## Decision (PROPOSED by the builder, RECORDED for the owner in OD-1)

The evidence supports SEPARATE limits, so they are split:

| limit | preset field | jlcpcb-2l value | basis |
| --- | --- | --- | --- |
| via annular ring | `minAnnularRingNm` (unchanged meaning, now documented via-only) | 0.15 mm | conservative: follows from the enforced 0.6 / 0.3 mm via, far above the 0.05 mm the 0.15 / 0.25 mm pair implies |
| PTH annular ring | `minPthAnnularRingNm` (new) | 0.25 mm | manufacturer's RECOMMENDED minimum; the 0.18 mm absolute minimum is recorded in the profile evidence notes and NOT enforced |

Other presets (`jlcpcb-4l`, `pcbway-standard`, `oshpark-4l`) received `minPthAnnularRingMm` EQUAL to the shared value they already enforced, with a `pthAnnularRingEvidence: "not separately verified ..."` note in the JSON. No new manufacturer claim was made for them and none is releasable (`QUALIFIED_RULE_PROFILE_IDS = {jlcpcb-2l}`; `buildManufacturingRuleProfile` refuses every other preset with `RULE_PROFILE_NOT_QUALIFIED`), per the runbook's instruction not to broaden to other manufacturers or stackups without implemented profiles and tests.

## What enforces the PTH ring now (CONFIRMED)

- DRC: new check `pth-annular-ring` (`checkPthAnnularRing`, kind `pthAnnularRing`, error severity) measures every plated `thru_hole` pad: the narrowest copper between the hole wall and the pad edge, honouring slot drills and drill offsets; circle / rect / roundrect / oval use the axis formula, polygons the exact nearest-edge distance minus the larger hole half-dimension (conservative for slots). NPTH pads and `plated: false` pads are skipped. Violations carry `objectIds` and the pad's copper layer; the message names the pad and both numbers in mm.
- Rule enumerations updated so the new field cannot be dropped silently: preset loader `REQUIRED_KEYS`, `rulesAreExplicit` (RC03), repair `SAFETY_MINIMUM_FIELDS` (lowering it is refused), manufacturing constraint program (`pth_annular_ring` kind, compiled as a hard, enforced, non-waivable manufacturing constraint), readiness fabrication kinds, DRC checker descriptors (`drc.pth-annular-ring`, `validateDrcDescriptors` proves every kind is covered exactly once), route-blocking DRC set (a ring violation blocks routing verification and therefore qualification and release), violation normalizer (manual-only fix: choose another footprint variant).
- Qualification: `evaluateAutonomousCapability` adds blocker `CAP_PTH_ANNULAR_RING_BELOW_PROFILE` (category `unsupported`) BEFORE placement so an unmanufacturable footprint is refused with a bounded RC03 evaluation instead of a late DRC failure.
- Release: the profile the release gate re-validates now lists `minViaAnnularRing` AND `minPthAnnularRing`; both must equal the enforced DRC preset field by field (`MFG_RULE_PROFILE_LIMIT_MISMATCH`).

## Source-pinned profile (CONFIRMED)

`ManufacturingRuleProfile` schema `sirkit.manufacturing-rule-profile.v2` (`app/lib/pcb/fab/release-manifest.ts`), built ONLY by `buildManufacturingRuleProfile` (`app/lib/pcb/fab/rule-profile.ts`), used by the qualify route and the golden fixture:

- identity: `profileId` (fab preset id), `version` (= DRC preset version, bumped to 2 for `jlcpcb-2l`), `manufacturer`, `processName`, content digest;
- evidence: `sourceRefs[]` (URLs, or `controlled:` refs for fixtures), `retrievedAt`, `expiresAt` (= retrieval + 365 days, `ruleProfileExpiry`), `scope` (manufacturer, layer count, copper weight, board kind), `notes[]` (the transcribed statements, incl. the 0.18 mm absolute PTH minimum);
- `ruleProfileEvidenceStatus(evidence, instant)` is a pure function: `ok | missing | invalid_window | expired | not_yet_valid`; the expiry date itself is still valid; a window longer than a year is invalid.

Release-time enforcement:

| condition | release gate (`releaseManufacturingPackage`) | route `POST /api/pcb/release` |
| --- | --- | --- |
| profile schema is v1 (pre-split) | `MFG_RULE_PROFILE_SCHEMA_RETIRED` | `MFG_RULE_PROFILE_SCHEMA_RETIRED` (422, before any release work) |
| evidence missing / invalid window | `MFG_RULE_PROFILE_EVIDENCE_MISSING` | `MFG_RULE_PROFILE_STALE_AT_RELEASE` |
| release instant after `expiresAt` | `MFG_RULE_PROFILE_EXPIRED` | `MFG_RULE_PROFILE_EXPIRED` |
| release instant before `retrievedAt` | `MFG_RULE_PROFILE_STALE` | `MFG_RULE_PROFILE_STALE_AT_RELEASE` |
| declared limits differ from the enforced DRC preset | `MFG_RULE_PROFILE_LIMIT_MISMATCH` | (gate) |

Existing qualifications made under the v1 profile are therefore NOT releasable; the board must be re-qualified (its authority is re-created with the v2 profile). This is deliberate: a release must never rest on the ambiguous ring.

## Identities (RECORDED)

Adding an enforced rule changes the manufacturing constraint program, the RC03 rules digest, the authority digest and the release manifest; the pinned B16.1C identities (`app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.json`) and the route recordings were re-recorded with `SIRKIT_B16_1C_RECORD_ROUTES=1` in this chapter (see `test-and-validation-report.md` for the new values and `changed-files.md` for the fixture list).

## Not done / bounded (RECORDED)

- No other manufacturer or stackup profile was implemented; the split is a JLCPCB two-layer fact plus an inherited value elsewhere.
- KiCad `.dru` import still maps `annular_width` to the via ring only (`app/lib/constraints/kicad-dru.ts`); a KiCad rule meant for pads is imported as a via rule and reported as such. UNKNOWN whether any project relies on it; recorded in `unknowns-and-owner-decisions.md`.
- The 0.25 mm choice (recommended) over 0.18 mm (absolute) is the builder's conservative default; OD-1 records it for the owner to confirm or relax.

## Finding while re-pinning: released copper depended on JSON property order (CONFIRMED, corrected)

Re-recording the pipeline after the rule split exposed a latent determinism defect: the recording run (board built in-process) and the replay run (board round-tripped through the sorted-key route fixture) produced IDENTICAL board digests, authority digests and qualification identities, yet a different copper-top Gerber (aperture D-codes and macro names permuted; archive sha256 differed). Cause: `shapeKey` in `app/lib/pcb/fab/native/gerber-writer.ts` used a raw `JSON.stringify(shape)` as the aperture identity, which depends on the pad shape's property order; every content digest uses sorted-key `stableJson` and so could not see the difference. PostgreSQL jsonb does not preserve key order either, so a production release from a stored authority could have differed from the in-process one. Corrected to `stableJson`; regression test `app/lib/pcb/fab/__tests__/b16-c-gerber-aperture-key.test.ts` (two boards every digest calls identical → byte-identical copper; a genuinely different shape still differs). The pinned identities were re-recorded after the fix and the replay reproduces them.
