# R05-MFG01-U01 Golden Authority Parity Repair

## 1. Verdict and repository fingerprints

**Verdict: `COMPLETE`.** The RC03 golden source now begins with canonical endpoint-derived net identities, survives three consecutive real no-edit placement/routing qualifications with fresh RC01 parity, and flows without a post-RC03 identity transform into the production MFG01 release gate. The exact corrected authority produced a deterministic, independently read-back Gerber/Excellon archive. R05-E2E01 is authorized; manufacturer submission remains unauthorized.

| Item | Evidence |
|---|---|
| Working repository | `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` |
| Protected original | `C:\Users\robsa\sirkit` exists and was not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status | 349 short-status entries; normalized-LF SHA-256 `c8a4ca90e462e0838608006682d841c4677378fdb591c45c59681143db03dce6` |
| Final status | 350 short-status entries; normalized-LF SHA-256 `4b2dd7d358fad410bd9408fe9f52e92ff91b728d039219269b4f8744b31f7bb6` |
| Starting RC03 fixture test | 313 lines; SHA-256 `44abaa09bc511743db3421e80a9f9c4efcd1d2c444d17aeb8b5c3cceae191cf7` |
| Starting MFG01 test | 236 lines; SHA-256 `3813bcf5da194250f355c00e4f6a610a07ada93aadfc927d0d550c060f35e56d` |
| Starting shared fixture | absent |
| Prior RC03 report | `COMPLETE`, but the old fixture IDs were not release-valid |
| Prior MFG01 report | `BLOCKED_CONTRACT` on the exact old RC03 authority |

The worktree was substantially dirty before U01. All pre-existing dirty/untracked work was preserved. No reset, clean, stash, stage, commit, push, rebase, broad formatting, dependency/lockfile change, migration, schema change, manufacturer call, upload, cart, or order occurred.

## 2. Original mismatch reproduction

Before the repair, the exact focused MFG01 release test was run:

```text
npx vitest run app/lib/pcb/__tests__/manufacturing-release-gate.test.ts --pool=threads --maxWorkers=1 --testTimeout=240000 -t "blocks the exact RC03 golden board"
```

Result: 1 passed, 4 skipped. The production release gate rejected the exact old RC03 authority with `MFG_FINAL_READINESS_FAILED`; fresh parity contained `NET_MEMBERSHIP_MISMATCH` and `STABLE_NET_SET_MISMATCH`. The same topology routed correctly because board-local numeric net IDs remained consistent, proving the failure was identity authority rather than Gerber geometry or router connectivity.

The repaired suite retains a regression that reconstructs the five legacy values (`net:peripheral:1` through `net:peripheral:5`) on an otherwise canonical board and requires both mismatch codes. The untouched canonical source passes the same fresh parity function.

## 3. Exact fixture repair

One shared fixture now constructs endpoint identity through production helpers only:

```text
schematicEndpointKey(componentId, "1")
  -> canonicalEndpointSet(endpointKeys)
  -> stableNetIdForEndpoints(endpointKeys, netName)
```

The test does not duplicate the hash algorithm and has no hard-coded expected hash constants. `endpointKeys`, the source netlist, pin/pad mappings, PCB nets, and stable IDs all derive from the same component IDs and pin numbers. Declaration revision advanced from 1 to 2 because the authority construction changed. No board is corrected after placement or routing.

## 4. Before/after canonical identities

Identity set digest: `golden-net-identity-ab69cdd5`.

| Net | Canonical endpoint membership | Old invalid stable ID | Correct stable ID |
|---|---|---|---|
| `PERIPHERAL_1` | `j1::1`, `j2::1`, `j3::1` | `net:peripheral:1` | `net:46d4a0022e26ff6e` |
| `PERIPHERAL_2` | `j4::1`, `j5::1`, `j6::1` | `net:peripheral:2` | `net:bffe6609caf9356d` |
| `PERIPHERAL_3` | `j7::1`, `j8::1`, `j9::1` | `net:peripheral:3` | `net:f5ac612c28c65e80` |
| `PERIPHERAL_4` | `j10::1`, `j11::1`, `j12::1` | `net:peripheral:4` | `net:103a1d8eeeb45b42` |
| `PERIPHERAL_5` | `j13::1`, `j14::1`, `j15::1` | `net:peripheral:5` | `net:492bb4012a2cde45` |

The initial board has 15 through-hole footprints, 15 pads, five nets, ten required connections, zero tracks, and zero vias on a 50 mm x 32 mm two-layer rigid board.

## 5. Shared fixture and authority flow

```text
buildAutonomousGoldenBoard
  -> canonical source board + autonomousGoldenNetlist
  -> qualifyAutonomousLayout with bundled FreeRouting
  -> exact AutonomousLayoutQualificationResult.selectedBoard/evidence
  -> authority(result), with no board or net-ID rewrite
  -> releaseManufacturingPackage
  -> emitted-byte readback + conservation + normalized ZIP
```

Both RC03 and MFG01 import the same `autonomous-golden-board.ts` builder, declaration, rules, netlist, manufacturer profile, and real router. The MFG01 cross-boundary test invokes the real RC03 coordinator and accepts only a `complete` result with selected board, selected revision, selected route evidence, and final capability evaluation. Its authority constructor consumes that result directly. It never constructs a routed substitute or edits the selected board.

The successful MFG authority came from RC03 run `autolayout-f565982b`, candidate `placement-candidate:a21c287e6b2f546f5af5b0b4`, revision `pcb2-fde5cd4a361c7fbd`, and content digest `pcb-authority-0c36b713c71f1dcaf1ec6ea18edfa84e6dab20804c4b1b4fbd635b2b6d163a1b`.

## 6. Three corrected real RC03 runs

Every run started from the same deep-equal unrouted source, built three normal placement candidates, routed at most two candidates, invoked its commit callback exactly once, and left the source object unchanged. All selected boards had zero overlaps, footprints outside, pads outside, protected-state violations, remaining connections, shorts, and route-blocking DRC errors.

| Run | Run ID | Candidate / seed | DSN / SES | Router / pass | Vias | Routed length (nm) | Runtime (ms) | Final revision |
|---:|---|---|---|---|---:|---:|---:|---|
| 1 | `autolayout-2b40e604` | `placement-candidate:a21c287e6b2f546f5af5b0b4` / 101 | `dsn-a64333e0` / `ses-053a69b1` | 2.2.4 / `rc03-placement-candidate:a21c287e6b2f546f5af5b0b4-p1-fe4e4cc4` | 0 | 68,596,334.839 | 11,808 | `pcb2-fde5cd4a361c7fbd` |
| 2 | `autolayout-e88bf931` | same / 101 | `dsn-a64333e0` / `ses-8429c335` | 2.2.4 / same pass | 0 | 68,596,334.839 | 13,175 | `pcb2-fde5cd4a361c7fbd` |
| 3 | `autolayout-5607cb4a` | same / 101 | `dsn-a64333e0` / `ses-7397d875` | 2.2.4 / same pass | 0 | 68,596,334.839 | 11,619 | `pcb2-fde5cd4a361c7fbd` |

FreeRouting's SES bytes varied while the imported semantic PCB revision remained identical, which is acceptable: deterministic manufacturing A/B comparison begins from the same immutable selected authority.

## 7. Fresh parity and RC03 evaluation evidence

All three selected boards retained identity digest `golden-net-identity-ab69cdd5` and passed a newly built schematic parity certificate.

| Run | Fresh RC01 parity | Parity digest | Post-layout capability | Evaluation digest | Board digest |
|---:|---|---|---|---|---|
| 1 | PASS | `parity-6292918c` | `eligible` | `cap1-8dc6ffc2` | `pcb-authority-0c36b713c71f1dcaf1ec6ea18edfa84e6dab20804c4b1b4fbd635b2b6d163a1b` |
| 2 | PASS | `parity-6292918c` | `eligible` | `cap1-8dc6ffc2` | same |
| 3 | PASS | `parity-6292918c` | `eligible` | `cap1-8dc6ffc2` | same |

The MFG01 authority independently rebuilds fresh parity, re-verifies RC02 connectivity/DRC, and recomputes the RC03 capability contract against the same selected revision before generation.

## 8. Exact MFG01 release continuity

| Evidence | Value |
|---|---|
| RC03 run | `autolayout-f565982b` |
| Selected candidate | `placement-candidate:a21c287e6b2f546f5af5b0b4` |
| PCB revision | `pcb2-fde5cd4a361c7fbd` |
| PCB authority digest | `pcb-authority-0c36b713c71f1dcaf1ec6ea18edfa84e6dab20804c4b1b4fbd635b2b6d163a1b` |
| Stable-net identity digest | `golden-net-identity-ab69cdd5` |
| RC03 evaluation digest | `cap1-8dc6ffc2` |
| Release ID | `mfg-release-bd54e5e7bc3c25049129ee900f3d4037` |
| Manifest content digest | `mfg-manifest-dea60007f57f1d2a624579f5c8b9fe1d134af2723e74bbddea17c0f0bd0b49f3` |
| Archive SHA-256 | `553fc2a6aeecc716a4b03e998a22e530f02068a63ced2da8c03ec8ff9bb18a19` |
| Readback digest | `mfg-readback-8f7600ec834efffed8a0750520a7b7f00984cd70bb5a9892bbca69128b2fd70f` |

The exact selected board object and coordinator evidence are passed to `authority(result)`. There is no `stableNetIdForEndpoints` call in MFG authority construction and no parity-corrected successor.

## 9. Exact package files

| Logical role | Path | Bytes | SHA-256 |
|---|---|---:|---|
| PTH drill | `gerber/rc03-golden-pth-1-2.xnc` | 342 | `78d20f7440dee6137c9f9bd67079c98cee1af805946e67f18767ea7a19575418` |
| Bottom copper | `gerber/rc03-golden.GBL` | 1,616 | `3226efa1944cfd809057ef290780713bbc61af2cedf49159d6cb1b13233510cd` |
| Gerber job | `gerber/rc03-golden.gbrjob` | 1,413 | `a5fde64178f8d9259574c6e80b8be3b1f5af118a6a1e8a199e594540de980b8f` |
| Bottom mask | `gerber/rc03-golden.GBS` | 1,067 | `dd43f6efd87149a659666f6eb47c52947a746c94c8b27ee01a882c64cf817af8` |
| Board outline | `gerber/rc03-golden.GML` | 702 | `55388bfb8b9614d96caec3ff076eb8e48739aa0e1c59499b2e0a1ef7d7fca020` |
| Top copper | `gerber/rc03-golden.GTL` | 3,386 | `4e7ec7764e056fec0d381809792c737b2a480ce8cb8dcb397978b23e2ea1a9e8` |
| Top mask | `gerber/rc03-golden.GTS` | 1,067 | `ce67d98e92a662a2ff63bced98debf4d4fe621dc18292254339762b0fbcf4f16` |
| README | `gerber/README.txt` | 575 | `ad51a51d19f2652dfcc7cc246a0ceb4f343ee736f99d02dd0fb02c48554a9618` |
| Release manifest | `gerber/release-manifest.json` | 7,664 | `64bd5457bb978c9a733e4ea30dcbe5483f3bbbaef133ab6ac4040f1a722df8f7` |

The bare-board manifest truthfully records NPTH drill, BOM, and top/bottom placement outputs as intentionally absent. Assembly mode remains blocked without exact MPN/population authority.

## 10. Readback and conservation

Independent emitted-byte parsing produced:

| Layer/output | Apertures/tools | Objects/hits | File function |
|---|---:|---:|---|
| Bottom copper | 1 aperture | 15 objects | `Copper,L2,Bot` |
| Bottom mask | 1 aperture | 15 objects | `Soldermask,Bot` |
| Outline | 1 aperture | 4 objects | `Profile,NP` |
| Top copper | 2 apertures | 36 objects | `Copper,L1,Top` |
| Top mask | 1 aperture | 15 objects | `Soldermask,Top` |
| PTH drill | 1 tool | 15 plated hits | `Plated,1,2,PTH` |

Gerber primitives expected/parsed were 85/85. Plated drill hits expected/parsed were 15/15. The profile reconstructed as a closed 50 mm x 32 mm outline. Supported integer-nanometre primitives matched MIR with the established 0 nm conservation tolerance. Archive extraction, checksums, path validation, manifest parsing, and a second full readback all passed.

## 11. Deterministic A/B generation

Two calls to the production release gate using the same immutable RC03 authority produced byte-identical files, identical ordering, identical manifest content digest, identical release ID, and identical archive bytes:

| Item | Generation A | Generation B |
|---|---|---|
| Release ID | `mfg-release-bd54e5e7bc3c25049129ee900f3d4037` | identical |
| Manifest digest | `mfg-manifest-dea60007f57f1d2a624579f5c8b9fe1d134af2723e74bbddea17c0f0bd0b49f3` | identical |
| Archive SHA-256 | `553fc2a6aeecc716a4b03e998a22e530f02068a63ced2da8c03ec8ff9bb18a19` | identical |
| Extracted validation | PASS | PASS |

## 12. Corruption, stale, and unsupported rejection

| Case | Result |
|---|---|
| Missing authority | `MFG_AUTHORITY_NOT_FOUND` |
| Stale locator revision | `MFG_AUTHORITY_BOARD_MISMATCH` |
| Authority changes during generation | `MFG_AUTHORITY_CHANGED_DURING_GENERATION`; loader called twice, no artifact returned |
| Assembled mode without authority | `MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE` |
| Corrupt rule-profile digest | `MFG_RULE_PROFILE_DIGEST_INVALID` |
| Four-layer construction | `MFG_RULE_PROFILE_CONSTRUCTION_MISMATCH` |
| Missing routed copper | `MFG_FINAL_ELECTRICAL_GATE_FAILED` |
| Invalid outline | `MFG_OUTLINE_INVALID` |
| Stale zone fill | `MFG_ZONE_FILL_STALE` |
| Truncated Gerber | `GERBER_PARSE_ERROR` |
| Truncated drill | `XNC_PARSE_ERROR` |
| Swapped layer mapping | independent validation fails |
| Mutated archive entry | `MFG_ARCHIVE_CHECKSUM_MISMATCH` |
| Missing drill entry | `MFG_ARCHIVE_FILE_MISSING` |
| Parent/absolute archive path | rejected |

## 13. Tests and static qualification

| Gate | Result |
|---|---|
| Corrected identity, capability, and three real RC03 runs | 5/5 passed |
| Exact MFG01 authority, A/B, readback, archive, corruption, stale cases | 5/5 passed |
| RC01 identity/parity plus RC02 DSN/SES/completion/verification/real boundary suites | 73 passed, 1 conditional test skipped |
| Existing fab/native/bundle/preset/BOM/position/readiness/persistence/API suites | 55/55 passed |
| Unique focused total | **138 passed, 1 skipped, 0 failed** |
| Full `npx tsc --noEmit` | PASS; zero diagnostics |
| Focused ESLint on all three U01 test/fixture files | PASS; zero findings |
| `git diff --check` on all three U01 paths | PASS |

The MFG01 five-test suite and all static gates were rerun after the final evidence-field change and remained green.

## 14. Exact files and churn

U01 changed exactly three test/fixture files and zero production files. Stage-specific product/test churn is **+228 / -316**, 544 total changed lines, below the 700-line limit.

| Classification | File | Final lines | Final SHA-256 | U01 churn |
|---|---|---:|---|---:|
| Existing test | `app/lib/pcb/__tests__/autonomous-layout-qualification.test.ts` | 160 | `0f47c55b9aac24bcc66450fb01435150e05b4dcdffd67bb83a05d847454dff23` | +53 / -206 |
| Existing test | `app/lib/pcb/__tests__/manufacturing-release-gate.test.ts` | 193 | `aa2351d1e028018f083feafe20405aeba699dbbdff40370f719a1514a84e890f` | +67 / -110 |
| New shared fixture | `app/lib/pcb/__tests__/fixtures/autonomous-golden-board.ts` | 108 | `3bb8c04ae10c5a1726a945ec938782db73bdebf71f0a8e7dfb7b76707d411f8d` | +108 / -0 |

The large deletions are deliberate extraction of duplicated fixture construction and the real-router adapter into the single shared fixture, not removed coverage. Coverage increased with per-run fresh parity and exact RC03-to-MFG continuity assertions.

## 15. Forbidden paths and cleanup

- No RC01 canonical identity implementation or parity criterion changed.
- No RC02 DSN, SES, router, completion, verification, or DRC implementation changed.
- No RC03 capability, placement, routing coordinator, or tool implementation changed.
- No MFG01 release, Gerber, drill, manifest, readback, or archive implementation changed.
- No editor, schematic, PCB-sync, assignment, authentication, plane, Stage 6/7, schema, migration, dependency, lockfile, or binary changed by U01.
- No generated DSN, SES, Gerber, Excellon, manifest, or ZIP output was retained; package qualification remained in memory.
- No post-hoc net ID rewrite exists in the successful path.

## 16. Authorization

R05-E2E01 is authorized because the exact corrected RC03 authority now passes RC01, RC02, RC03, MFG01 generation, independent readback/conservation, A/B determinism, and negative-case gates.

This does not authorize R04D final qualification or manufacturer submission. External CAM/board-house DFM, construction confirmation, order review, and physical prototype validation remain separate future gates.
