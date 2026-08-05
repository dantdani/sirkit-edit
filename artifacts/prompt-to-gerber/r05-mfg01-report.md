# R05-MFG01 Gerber and Manufacturing Release Gate

## 1. Verdict and repository fingerprints

**Verdict: `BLOCKED_CONTRACT`.** The deterministic authority gate, explicit manufacturing profile, native Gerber/Excellon generation, canonical manifest, independent readback, conservation checks, normalized archive, extraction/revalidation, corruption rejection, and second authority reload are implemented and pass on a minimally parity-corrected successor. The exact RC03 golden board cannot be released because its five hand-written stable net IDs do not satisfy the RC01 endpoint-derived identity contract. Fresh release-time parity correctly reports `NET_MEMBERSHIP_MISMATCH` and `STABLE_NET_SET_MISMATCH`, so no exact-golden archive is published.

| Item | Evidence |
|---|---|
| Working repository | `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` |
| Protected original | `C:\Users\robsa\sirkit` exists and was not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status fingerprint | `e16b535fbaae22ab7f0da17af4f9b9f802f1fe699c7ef43a1a1cddd32fe8288d` (345 short-status entries; normalized LF) |
| Final status fingerprint | `c8a4ca90e462e0838608006682d841c4677378fdb591c45c59681143db03dce6` (349 short-status entries; normalized LF) |
| R03-B10D Retry 02 | `COMPLETE_DEMO` |
| R05-RC01 | `COMPLETE` |
| R05-RC02 | `COMPLETE` |
| R05-RC03 | report says `COMPLETE`; its exact golden fixture fails fresh RC01 parity at MFG01 |
| Baseline/final TypeScript | exit 0, zero diagnostics |
| FreeRouting | bundled 2.2.4; real RC02 and RC03 regressions pass |

The worktree was substantially dirty before MFG01. All earlier changes were preserved. No reset, clean, stash, stage, commit, push, rebase, dependency/lockfile update, migration, database, external credential, manufacturer API, upload, cart, or order operation occurred.

## 2. Current and final export call graph

### Before MFG01

```text
browser PcbBoard
  -> POST /api/pcb/export/gerbers
     -> readiness evaluation on caller payload
     -> buildFabBundle (KiCad CLI) or compileNativeFabPackage
     -> ZIP returned as "verified"
```

The native compiler was already strong: immutable snapshot, MIR, Gerber/XNC writers, independent parsers, exact MIR comparison, and deterministic ZIP. Its input was still an arbitrary caller board, the release manifest did not carry the full RC01/RC02/RC03/component/rule provenance, bare/assembly output was not explicitly separated, and the archive was not extracted and revalidated before publication.

### MFG01 release path

```text
ManufacturingReleaseLocator (identity + expected PCB revision/digest)
  -> server-owned ManufacturingAuthorityLoader
     -> immutable ManufacturingReleaseAuthority
     -> exact scope/revision/content digest checks
     -> fresh RC01 parity/readiness
     -> fresh RC02 connectivity/short/DRC verification
     -> fresh Stage 7 placement hard validation
     -> fresh RC03 post-layout capability evaluation
     -> explicit manufacturing rule-profile digest/compatibility checks
     -> native snapshot + MIR + Gerber/XNC generation
     -> independent emitted-byte parse-back against MIR
     -> canonical release manifest
     -> package checksum/path/completeness validation
     -> normalized deterministic ZIP
     -> extract + checksum + parse-back + conservation revalidation
     -> reload entire authority and compare canonical digest
     -> return artifact only when unchanged
```

The legacy HTTP endpoint now rejects `releaseMode=verified` when the board came from the browser, returning `authoritative-release-source-required`. Explicitly reasoned engineering exports remain clearly non-verified. A verified route must call the new server-loader function.

## 3. Authoritative source/release-gate contract

The release function does not accept `PcbBoard`. It accepts only a locator and a loader. The loaded source pins:

- tenant, project, branch, design, and board IDs;
- exact PCB semantic revision and canonical content digest;
- complete authoritative PCB and netlist;
- schematic revision/digest;
- RC01 evidence ID/digest and exact board revision;
- RC02 complete evidence, route pass IDs, exact revision, and zero remaining/short/route-blocking-DRC counts;
- RC03 declaration, post-layout evaluation, evidence ID/digest, board revision/digest;
- component binding, footprint library, mapping, policy, and assembly-variant revisions plus canonical digest;
- fabrication and DRC presets;
- explicit manufacturing rule profile;
- bare/assembled release mode, deterministic source date, and actor.

The complete loaded authority receives a canonical SHA-256 at start. Immediately before return, the loader runs again and the entire authority digest, PCB revision, and PCB digest must match. A race returns `MFG_AUTHORITY_CHANGED_DURING_GENERATION` and no artifact.

## 4. Exact manufacturing rule profile used in qualification

| Field | Value |
|---|---|
| Schema | `sirkit.manufacturing-rule-profile.v1` |
| Profile | `jlcpcb-2l` v1 |
| Manufacturer/process | JLCPCB / economy rigid two-layer PTH prototype |
| Controlled evidence | `controlled:jlcpcb-capabilities-and-kicad-guide:2026-07` |
| Verified | 2026-07-08; maximum permitted evidence age 366 days |
| Stackup | 2 copper layers, FR-4, 1.6 mm board, 35 µm copper |
| Qualified board maximum | 100 mm x 80 mm |
| Minimum trace / space | 0.127 mm / 0.127 mm |
| Minimum drill / finished hole | 0.300 mm / 0.300 mm |
| Minimum annular ring | 0.150 mm |
| Copper-to-edge / hole-to-edge | 0.300 mm / 0.300 mm |
| Solder-mask expansion / sliver | 0.050 mm / 0.100 mm |
| Silkscreen width / clearance | 0.150 mm / 0.150 mm |
| Default component mask policy | explicit pad layer or profile-bound opening |
| Default via mask policy | tented |
| Slots/castellations/edge plating/flex | unsupported |
| Assembly authority | unsupported for this source |

The profile is canonical-digest-bound and its enforced trace, spacing, drill, annular-ring, edge, and silk-clearance values must exactly equal the DRC preset. There is no hidden manufacturer default.

The RC03 synthetic through-hole pads did not include explicit mask layers. MFG01 does not mutate the PCB or guess a global default: the immutable manufacturing snapshot carries the exact profile digest and an explicit mask policy. MIR derives circular top/bottom openings using the profile’s 0.050 mm expansion. Unsupported polygon expansion blocks rather than approximates.

## 5. Required output matrix

| Output | Bare PCB | Assembled PCB |
|---|---|---|
| Top/bottom copper | required, nonempty | required |
| Top/bottom solder mask | required, nonempty | required |
| Top/bottom silkscreen | required when authoritative geometry exists; otherwise intentional absence | same |
| Closed board profile | required | required |
| Plated Excellon | required when plated holes exist | required when present |
| NPTH Excellon | required when NPTH exists; otherwise intentional absence | same |
| Gerber Job / README / release manifest | required | required |
| BOM / top-bottom placement / paste | intentionally absent | mandatory, but current assembled mode blocks before generation |

The successor qualification has no silkscreen or NPTH geometry, so those are explicitly absent. BOM and placement are explicitly absent because it is a bare-board release. `assembled_pcb` returns `MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE`; no generic/placeholder MPN is guessed.

## 6. Deterministic generation and archive rules

- canonical source arrays and stable JSON object-key ordering;
- explicit source date (`2026-07-21T00:00:00.000Z` in qualification);
- deterministic aperture, tool, object, file, manifest, and ZIP entry ordering;
- metric coordinates with six decimal places (1 nm output precision);
- CRLF/text conventions fixed by writer; no host paths or temporary names;
- safe names and normalized forward-slash relative paths only;
- ZIP entry timestamp fixed to 1980-01-01, UNIX mode 0644, STORE compression, sorted entries;
- maximum 64 files and 64 MiB uncompressed content;
- no filesystem publication: generation remains in memory until all checks and the final authority reload pass.

Two generations from the same parity-corrected source were asserted byte-identical for every file, manifest digest, entry ordering, and final archive SHA-256.

## 7. Manifest schema and digest definitions

Schema: `sirkit.pcb-manufacturing-release.v1`.

It contains source scope/revisions/digests, RC01/RC02/RC03 provenance, capability profile/evaluation, component authority, complete rule profile, tool versions, release mode, source date/actor, construction, object/hole/connectivity/DRC counts, validator result, file-role mappings, every non-manifest file’s bytes/SHA-256, intentional absences, and limitations.

- `manifestContentDigest` = SHA-256 of canonical manifest content with `releaseId` and `manifestContentDigest` omitted.
- `releaseId` = SHA-256-derived ID over manifest content digest plus authoritative PCB digest.
- The manifest does not hash itself cyclically. Its own bytes are authenticated by the external archive SHA-256.
- `archiveSha256` = SHA-256 of final normalized ZIP bytes and is returned beside the manifest.

## 8. Independent readback and limits

The readback parser consumes emitted text bytes; it does not consume writer aperture objects. Gerber parsing independently requires exact `%FSLAX46Y46*%`, metric units, mandatory file attributes, valid aperture/tool selections, supported commands, and final `M02`. XNC parsing independently requires `M48`, metric header, tools, valid drill/rout commands, file function, and final `M30`.

Parsed object signatures are compared with MIR for geometry, attributes, polarity, layer ownership, bottom coordinates, rotations, and source conservation. Drill signatures compare tool diameter, hit/slot geometry, plating group, and layer span. The validator is not an external board-house DFM engine and this limitation is carried in the manifest.

## 9. Conservation tolerance and results

Coordinate precision is six decimal metric places, exactly 1 nm, and all authoritative geometry is integer nanometres. The conservation tolerance is therefore **0 nm** for the supported primitives.

Parity-corrected successor results:

- Gerber primitives expected/parsed: 85/85;
- plated drills expected/parsed: 15/15;
- NPTH: 0, explicitly absent;
- outline objects: 4/4, closed 50 mm x 32 mm profile;
- top copper: 36 objects; bottom copper: 15;
- top mask: 15; bottom mask: 15;
- readback digest: `mfg-readback-8f7600ec834efffed8a0750520a7b7f00984cd70bb5a9892bbca69128b2fd70f`.

## 10. Successor package file evidence

This table is evidence for the minimally parity-corrected successor, not authorization for the exact RC03 board or manufacturer submission.

| Path | Bytes | SHA-256 | Parsed summary |
|---|---:|---|---|
| `gerber/rc03-golden.GTL` | 3,386 | `2f4a44d34e5218f42d36a1220489f08a6d507d33ddfabe83db1672537ab8bd4c` | Copper L1 Top; 2 apertures; 36 objects |
| `gerber/rc03-golden.GBL` | 1,616 | `c0b2a0a342e2a0a29f5b1d6a533c6a42cf335e50a1dbadae65735fd5d02aaa18` | Copper L2 Bottom; 1 aperture; 15 objects |
| `gerber/rc03-golden.GTS` | 1,067 | `b8fa47c583b90e48210e5e2f65b2d7ee1fa30a13f771fbfeaa9a468ef4ff22d8` | Soldermask Top; 15 objects |
| `gerber/rc03-golden.GBS` | 1,067 | `65aaf032964ec0e98a8020c9ad202a90d167f43c5fd89a96b31d33c20d6287c3` | Soldermask Bottom; 15 objects |
| `gerber/rc03-golden.GML` | 702 | `8d54c0e8c495ec2bc62b136874c1d620e5802f0815f4499249bdb6d762e3ce9f` | Profile; 4 objects |
| `gerber/rc03-golden-pth-1-2.xnc` | 342 | `78d20f7440dee6137c9f9bd67079c98cee1af805946e67f18767ea7a19575418` | 1 tool; 15 plated hits |
| `gerber/rc03-golden.gbrjob` | 1,413 | `ab2535ebf034091aed510b0be34880bef4407edbc10feb8156b60fd299e1290a` | deterministic job mapping |
| `gerber/README.txt` | 575 | `4f128ef8893e8870e24bb77a5ed213e4aaeb846cd7aa732617aeffedc343c562` | release limitations and coordinate convention |
| `gerber/release-manifest.json` | 7,651 | `d1fcfc5fffa02eba024883bea66d094a084fd054a2f7d84794a6e3a8dfcde2af` | canonical MFG01 manifest |

## 11. Generation A/B hashes

Latest successor qualification source revision: `pcb2-f24d0f79412e557a`.

| Item | A | B |
|---|---|---|
| Release ID | `mfg-release-1caa12fe3712ab4bcd942b4f19512d88` | identical |
| Manifest content digest | `mfg-manifest-87194a83d35e051819a81bdb9697c6f6569b21f430fd44f1b7b9bc45da09e469` | identical |
| Archive SHA-256 | `cf640604be3667567399ca5e64fe0a371c358745265db712188b031ee1f8e2fb` | identical |
| File bytes/hashes/order | exact | byte-identical |
| Extracted revalidation | pass | pass |

Different test-process route runs may produce different generated track object IDs because the legacy autoroute HTTP job namespace is random. MFG01 determinism is correctly defined for identical immutable authority input; A/B from the same authority are byte-identical.

## 12. Corruption, stale, unsupported, and no-publication results

| Case | Result |
|---|---|
| Browser/local board used as verified source | rejected; exporter not invoked |
| Missing authority record | `MFG_AUTHORITY_NOT_FOUND` |
| Stale locator revision/digest | `MFG_AUTHORITY_BOARD_MISMATCH` |
| Authority changes during generation | `MFG_AUTHORITY_CHANGED_DURING_GENERATION`; no return |
| Exact RC03 stable-net mismatch | `MFG_FINAL_READINESS_FAILED` |
| Unrouted connection | `MFG_FINAL_ELECTRICAL_GATE_FAILED` |
| Four-layer/plane source | `MFG_RULE_PROFILE_CONSTRUCTION_MISMATCH` |
| Invalid/zero outline | `MFG_OUTLINE_INVALID` |
| Stale zone fill | `MFG_ZONE_FILL_STALE` |
| Corrupt rule-profile digest | `MFG_RULE_PROFILE_DIGEST_INVALID` |
| Assembled mode without MPN/variant authority | `MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE` |
| Truncated Gerber / drill | independent `GERBER_PARSE_ERROR` / `XNC_PARSE_ERROR` |
| Swapped copper mapping | geometry/layer comparison fails |
| Archive byte/checksum mutation | `MFG_ARCHIVE_CHECKSUM_MISMATCH` |
| Missing drill archive entry | `MFG_ARCHIVE_FILE_MISSING` |
| Parent/absolute path | rejected before publication |
| Coordinate corruption | existing independent parser regression reports `GERBER_GEOMETRY_MISMATCH` |

All release work is in memory. A thrown gate leaves no final or partial artifact on disk.

## 13. BOM/placement result

Bare mode is truthful and excludes BOM/placement. The manifest records `bom`, `placement_top`, and `placement_bottom` as intentionally absent.

Assembled mode is deliberately blocked. The exact RC03 fixture has no approved manufacturer/MPN/population/evidence authority, so emitting its current generic header rows as an assembly package would be false.

## 14. Commands and results

| Gate | Result |
|---|---|
| MFG01 cross-boundary real-router/release test | 5/5 passed |
| Fab/native/bundle/preset/BOM/position/readiness/persistence/API suites | 48/48 passed |
| RC01 electrical identity plus RC02 SES/completion/verification/real FreeRouting suites | 48 passed, 1 conditional test skipped |
| RC03 capability and three real no-edit FreeRouting runs | 5/5 passed; final RC03 revision remains `pcb2-82c32e0f68b94690` |
| Focused total | **106 passed, 1 skipped, 0 failed** |
| Full `npx tsc --noEmit` | pass, zero diagnostics |
| Focused ESLint over all nine MFG01 product/test files | pass, zero findings |

No PostgreSQL was required. The authority race was exercised through an immutable in-memory server-loader boundary.

## 15. Exact files and churn

Product/test files changed by MFG01: **9** (limit 16).  
Stage-specific product/test churn: **+1,035 / -12** (limit 2,000 combined).

| Classification | File | Purpose |
|---|---|---|
| Production, new | `app/lib/pcb/fab/release-manifest.ts` | rule profile, canonical v1 manifest, digest definitions |
| Production, new | `app/lib/pcb/fab/validate-package.ts` | independent file/archive readback, conservation, safety |
| Production, new | `app/lib/pcb/fab/release-gate.ts` | authority-only final orchestrator and normalized archive |
| Production | `app/lib/pcb/fab/native/types.ts` | explicit immutable mask policy contract |
| Production | `app/lib/pcb/fab/native/snapshot.ts` | mask-policy digest/validation in immutable snapshot |
| Production | `app/lib/pcb/fab/native/mir.ts` | exact profile-bound component mask openings |
| Production | `app/api/pcb/export/gerbers/route.ts` | demote browser boards from verified authority |
| Existing test | `app/api/pcb/export/gerbers/__tests__/route.test.ts` | HTTP fail-closed regression |
| Cross-boundary test, new | `app/lib/pcb/__tests__/manufacturing-release-gate.test.ts` | real board, A/B, readback, corruption, stale and blocker evidence |

The only additional file is this required report. No generated Gerber or ZIP artifact is retained.

## 16. Forbidden-path and cleanup confirmation

- No schematic/PCB-sync/DSN authority implementation changed.
- No SES/autoroute/DRC correctness implementation changed.
- No autonomous capability/placement/routing implementation changed.
- No editor, assignment, authentication, plane, Stage 6/7, schema, migration, dependency, lockfile, or binary changed.
- Existing native MIR/export/readback functions were reused; no raster geometry or alternate PCB engine was introduced.
- No temp package, Gerber, Excellon, or ZIP remains in the repository or filesystem from qualification.
- No manufacturer communication, upload, quote, cart, or order was performed.

## 17. Remaining obligations and smallest successor

The exact RC03 board uses `net:peripheral:1` through `net:peripheral:5`. RC01 requires `stableNetIdForEndpoints(endpointKeys, name)`, whose result is derived from canonical endpoint membership. Tracks use numeric net IDs, so routing/DRC can complete while parity still fails at release time.

Smallest safe successor:

1. Rebuild only the RC03 golden fixture’s five stable net IDs through the RC01 canonical function before placement/routing.
2. Rerun all three RC03 no-edit qualification runs and record the new exact final PCB revision/digest/evaluation.
3. Rerun MFG01 against that exact new authority; do not copy or locally rewrite IDs after RC03.
4. If MFG01 then completes, run R05-E2E01 and external CAM/board-house DFM on its specific package.

External DFM, manufacturer review, impedance/material confirmation, stencil/assembly review, and physical prototype bring-up remain required even after this contract is repaired.

## 18. Authorization

R05-E2E01 is **not authorized** because the required exact RC03 authoritative board did not produce a package. The parity-corrected successor evidence proves the MFG machinery but cannot substitute for a newly qualified upstream authority.

R04D final qualification, Gerber manufacturer submission, and any board order remain **not authorized**.
