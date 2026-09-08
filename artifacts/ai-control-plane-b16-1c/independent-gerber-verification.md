# B16.1C — Independent Gerber / ZIP verification (§E/§G/§J.9)

Subject: the deterministic acceptance release produced by `acceptance-pipeline.test.ts` step 10 and reproduced byte-identically on every REPLAY of the committed recording under the frozen clock (`FIXED_NOW = 2026-09-07T12:00:00.000Z`).

- filename `sirkit-board-b16-1c-blinker-3c9c6f02a496.zip`
- archive sha256 `5cd671810e87cfe805a91d83406fe456c2cc802320ba5b6e9a31341b1667ef66`
- release id `mfg-release-e0bdf91bb6f5d9656ec23c9c6f02a496`; manifest digest `mfg-manifest-a5592c82a03e0517048404b0177d7f96398463a3d39c242f2c7dc754385d4482`
- board revision `pcb2-bbc76fdb18ec7646` (21 × 21 mm, 2 copper layers); authority r1 `sha256:f648165bd4c3ba415ae494737471bbb1001fd0c74135fdc4dedfbec46737927d`
- evidence location: `SIRKIT_B16_1C_EVIDENCE_DIR` or `<os tmpdir>/sirkit-b16-1c-evidence/` (`b16-1c-acceptance-release.zip`, `b16-1c-acceptance-manifest.json`, `b16-1c-acceptance-evidence.json`) — never under the repository (B11.5 closure).
- [B16-A corrected] The identities above changed with the F8 locale fix (`8746b46`, fixtures re-recorded) and are substituted by the orchestrator; both validators were RE-RUN on the re-recorded archive (`5cd671810e87cfe805a91d83406fe456c2cc802320ba5b6e9a31341b1667ef66`, 40,962 bytes) on 2026-09-07 local: the in-repo reader reports 80/80 ok inside the acceptance replay (evidence JSON `archiveChecks` = 80) and `scripts/verify-release-independent.py` prints `INDEPENDENT VERIFICATION: PASS` (CONFIRMED by the orchestrator); the deterministic-manufacturing CI job (ubuntu-latest, run 34160044215) reproduced the same archive sha256 from the committed recording (CONFIRMED). Geometry-derived counts (flashes, draws, gerbonara object counts, track/via counts) may legitimately differ after re-recording; structural counts (10 members, 9 files, 24 pads, 7 nets, 4 plated holes, 2 tools, 21 × 21 mm) follow from the design and the fixtures.

## Validator 1 — `app/lib/pcb/fab/independent-archive-verifier.ts` (in-process, acceptance step 11) — CONFIRMED

Shares no decision logic with the generator: its own RS-274X lexer (extended `%…%` blocks, `%AM` macro extents, `%ADD` apertures, D01/D02/D03 with a current point, G36/G37 regions), its own Excellon/XNC lexer (M48/METRIC/tool table/hits/M30), its own canonical-JSON digest. 80 rows, all PASS on the acceptance archive — 78 unconditional rows for this 10-member / 9-file / 6-Gerber archive plus the 2 expectation rows the suite passes (`boardRevision`, `expectedComponents: 9`); counted from source in B16-A (the H.14 matrix row that said 61 was wrong, F16). It is the ONLY reader that recomputes the manifest content digest and the release id, compares every member's byte length and sha256 with the manifest, and reconciles pad/track/hole COUNTS with the manifest. The categories:

1. ZIP: 10 members, all `gerber/<safe name>`, no duplicates, every member dated 1980-01-01 (deterministic archive).
2. Manifest: schema `sirkit.pcb-manufacturing-release.v1`; content digest recomputed independently = declared; release id recomputed from manifest digest + board digest = declared; board revision = the qualified board; component count 9.
3. Member reconciliation: member set = manifest files ∪ `release-manifest.json`; every member's byte length and sha256 = manifest; Protel-style extensions per role; required roles copper_top/bottom, mask_top/bottom, outline, pth_drill, gerber_job present.
4. Every Gerber: `%FSLAX46Y46*%`, `%MOMM*%`, `M02*`; `TF.FileFunction` matches the role (Copper L1 Top / L2 Bot, Soldermask Top/Bot, Legend Top, Profile NP); polarity Positive (copper/silk/outline) / Negative (masks); every selected aperture defined (incl. the six `SRK…` macro apertures); one `TF.SameCoordinates` id and one `TF.ProjectId` across all layers.
5. Outline: closed 4-segment polyline returning to its first move; bounding box 21.000 × 21.000 mm = manifest board size; no flashes on the profile.
6. Copper: every flash and draw (aperture extents included) inside the outline on both layers; no draw narrower than the profile minimum trace width (0.127 mm); 30 copper flashes across both layers for 24 pads; 80 draws for 80 tracks; mask openings (24 top, 2 bottom) never exceed same-side copper flashes.
7. Drill: `M48`/`METRIC`/`M30`; 2 tools (0.4 mm vias, 1.0 mm header) within the profile range (min 0.3 mm … 6.3 mm); 4 hits = manifest plated holes; every hole inside the outline; every plated hole has a bottom-copper flash at the same position.
8. Gerber job file: `FilesAttributes` = exactly the shipped Gerber + drill members (this stage removed a phantom paste entry the compiler listed for bare-board releases); `LayerNumber = 2`.

## Validator 2 — `scripts/verify-release-independent.py` (third-party `gerbonara 1.6.3`) — CONFIRMED (run locally 2026-09-07 on the re-recorded evidence ZIP `5cd67181…67ef66`; the same script passed on the pre-F8 archive earlier that day)

[B16-A corrected: F17] Scope stated truthfully: the script is PRE-EXISTING (present at `b7bb6d6`, commit `3505cd8`), is run LOCALLY only (no `.github` workflow or `package.json` script invokes it — CONFIRMED), and uses `release-manifest.json` ONLY to locate files by role. It checks layer presence, parseability of each layer, outline real extent / envelope / closure (no dangling segment endpoints), drill parse, tool diameters readable and ≥ 0.30 mm with exact decimals, top copper and every hole inside the outline bounding box, bottom copper inside the same frame, and full-stack auto-detection. It does NOT check the manifest content digest, member sha256s, the release id, or any pad/track/hole count against the manifest — reader 1 does. The README and the H.14 row previously implied both readers verify "against the manifest and the board".

```
layer set: copper_top, copper_bottom, mask_top, mask_bottom, outline, pth_drill, gerber_job — PASS (7)
copper + mask parse independently: copper_top 99 objects, copper_bottom 11, mask_top 24, mask_bottom 2, silk_top 211, outline 4 — PASS (6)
board outline: bounding box 21.100 x 21.100 mm (nominal 21.00 x 21.00 mm; outline stroke width included); real extent; within the 100 x 80 mm envelope; closed, 4 segments, no dangling endpoints — PASS (3)
plated drill (Excellon): 4 plated holes parsed; tool diameters [0.4, 1.0] mm readable; every diameter >= 0.300 mm profile minimum; exact decimal values — PASS (5)
drill-to-copper alignment: top copper inside the outline; all 4 holes inside the outline — PASS (2)
mirroring / orientation: bottom copper shares the outline frame — PASS (1)
full-stack load: gerbonara recognized (bottom,copper) (bottom,mask) (top,copper) (top,mask) (top,silk); drill layer auto-detected — PASS (2)
INDEPENDENT VERIFICATION: PASS — all checks satisfied by a third-party parser
```

Reproduce: run the acceptance suite (writes the evidence ZIP), then `python scripts/verify-release-independent.py <evidence dir>/b16-1c-acceptance-release.zip`. `verify-manufacturer-zip.py` (manufacturer-zip cross-check against a KiCad-assisted export) was not applicable — no manufacturer bundle exists for this design (UNKNOWN, not claimed).

## What these validators do not establish

Neither validator is a board-house DFM review, a fabrication, an assembly, an order, or an electrical certification. The design's electrical intent is checked separately from first principles (`component-authority-proof.md`); the copper's DRC/connectivity is the server's RC02 evidence re-verified at release (`deterministic-release-contract.md`). The readback the release route performs before shipping is Sirkit's OWN parser — the panel says so: "Gerbers generated and read back on the server by Sirkit's internal parser (not a third-party DFM check)" ([B16-A corrected: F18 — the text said "independently read back"]). Validator 2 does not run in CI, so "two independent readers PASS" is a local, pre-F8 observation, not a CI guarantee.
