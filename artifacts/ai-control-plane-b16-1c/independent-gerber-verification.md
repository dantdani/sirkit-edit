# B16.1C — Independent Gerber / ZIP verification (§E/§G/§J.9)

Subject: the deterministic acceptance release produced by `acceptance-pipeline.test.ts` step 10 and reproduced byte-identically on every replay.

- filename `sirkit-board-b16-1c-blinker-e5437bba0531.zip`
- archive sha256 `7432a65a27485e796ccafef5c70347a7aea216af5bf579991ca18da929b54c20`
- release id `mfg-release-69cb64a4a41b221f0ed4e5437bba0531`; manifest digest `mfg-manifest-06232495c2e4ab9d34534e3718a1b9e53507d587aafe32cbdb9868710d2049b4`
- board revision `pcb2-0b7f191c06df5865` (21 × 21 mm, 2 copper layers); authority r1 `sha256:f8677a84…bc8f7a`
- evidence location: `SIRKIT_B16_1C_EVIDENCE_DIR` or `<os tmpdir>/sirkit-b16-1c-evidence/` (`b16-1c-acceptance-release.zip`, `b16-1c-acceptance-manifest.json`, `b16-1c-acceptance-evidence.json`) — never under the repository (B11.5 closure).

## Validator 1 — `app/lib/pcb/fab/independent-archive-verifier.ts` (in-process, acceptance step 11) — CONFIRMED

Shares no decision logic with the generator: its own RS-274X lexer (extended `%…%` blocks, `%AM` macro extents, `%ADD` apertures, D01/D02/D03 with a current point, G36/G37 regions), its own Excellon/XNC lexer (M48/METRIC/tool table/hits/M30), its own canonical-JSON digest. 61 rows, all PASS on the acceptance archive; the categories:

1. ZIP: 10 members, all `gerber/<safe name>`, no duplicates, every member dated 1980-01-01 (deterministic archive).
2. Manifest: schema `sirkit.pcb-manufacturing-release.v1`; content digest recomputed independently = declared; release id recomputed from manifest digest + board digest = declared; board revision = the qualified board; component count 9.
3. Member reconciliation: member set = manifest files ∪ `release-manifest.json`; every member's byte length and sha256 = manifest; Protel-style extensions per role; required roles copper_top/bottom, mask_top/bottom, outline, pth_drill, gerber_job present.
4. Every Gerber: `%FSLAX46Y46*%`, `%MOMM*%`, `M02*`; `TF.FileFunction` matches the role (Copper L1 Top / L2 Bot, Soldermask Top/Bot, Legend Top, Profile NP); polarity Positive (copper/silk/outline) / Negative (masks); every selected aperture defined (incl. the six `SRK…` macro apertures); one `TF.SameCoordinates` id and one `TF.ProjectId` across all layers.
5. Outline: closed 4-segment polyline returning to its first move; bounding box 21.000 × 21.000 mm = manifest board size; no flashes on the profile.
6. Copper: every flash and draw (aperture extents included) inside the outline on both layers; no draw narrower than the profile minimum trace width (0.127 mm); 30 copper flashes across both layers for 24 pads; 80 draws for 80 tracks; mask openings (24 top, 2 bottom) never exceed same-side copper flashes.
7. Drill: `M48`/`METRIC`/`M30`; 2 tools (0.4 mm vias, 1.0 mm header) within the profile range (min 0.3 mm … 6.3 mm); 4 hits = manifest plated holes; every hole inside the outline; every plated hole has a bottom-copper flash at the same position.
8. Gerber job file: `FilesAttributes` = exactly the shipped Gerber + drill members (this stage removed a phantom paste entry the compiler listed for bare-board releases); `LayerNumber = 2`.

## Validator 2 — `scripts/verify-release-independent.py` (third-party `gerbonara 1.6.3`) — CONFIRMED (run locally 2026-09-07 on the evidence ZIP)

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

Neither validator is a board-house DFM review, a fabrication, an assembly, an order, or an electrical certification. The design's electrical intent is checked separately from first principles (`component-authority-proof.md`); the copper's DRC/connectivity is the server's RC02 evidence re-verified at release (`deterministic-release-contract.md`).
