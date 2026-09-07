# B16.1C — Fabrication profile sources (§D)

The ONLY fabrication profile the release path has placed, routed, released and independently verified is `jlcpcb-2l` (JLCPCB economy two-layer rigid FR-4, bare board). It is the only profile the qualify route will seal (`QUALIFIED_FABRICATION_PROFILE_ID` in `app/api/pcb/qualify/route.ts`); the release gate structurally refuses any non-two-layer construction (`MFG_RULE_PROFILE_CONSTRUCTION_MISMATCH`). No other manufacturer or profile is claimed as proven.

## Official source used for the re-verification (RECORDED)

- Manufacturer: JLCPCB.
- Page: `https://jlcpcb.com/capabilities/pcb-capabilities` ("PCB Manufacturing & Assembly Capabilities").
- Retrieval date: 2026-09-07 (this stage). The page shows no explicit revision date; it notes an "LDI upgraded June 2025" process change. Recorded in code as `QUALIFIED_FABRICATION_PROFILE_EVIDENCE = { sourceRef, verifiedAt: "2026-09-07" }` and bound into every sealed authority (`manufacturingRuleProfile.evidence`) and manifest.
- Release-time expiry: `RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS = 366 days` in `app/api/pcb/release/route.ts` (`MFG_RULE_PROFILE_STALE_AT_RELEASE`), in addition to the release gate's own `MFG_RULE_PROFILE_STALE` check.
- The two preset JSON files `app/lib/pcb/drc/presets/jlcpcb-2l.json` (verifiedAt 2026-07-08) and `app/lib/pcb/fab/presets/jlcpcb-2l.fab.json` (verifiedAt 2026-07-09, specUrl = JLCPCB help article on generating Gerber/drill files in KiCad 8, Protel extensions, zip root `gerber/`) were NOT modified in this stage; their digests are part of the sealed authority (`fabPreset`, `drcPreset`, `manufacturingRuleProfile.digest`).

## Values compared (official page, retrieved 2026-09-07) vs the enforced preset

| Capability | JLCPCB official page (2 layer, 1 oz) | Preset `jlcpcb-2l` / rule profile | Verdict |
|---|---|---|---|
| Min trace / space | 0.10 mm / 0.10 mm | 0.127 mm / 0.127 mm | Conservative — CONFIRMED |
| Via hole | min 0.15 mm (0.20 mm preferred); via diameter ≥ hole + 0.10 mm | via drill 0.30 mm, via outer 0.60 mm | Conservative — CONFIRMED |
| Annular ring | PTH recommended 0.25 mm, absolute min 0.18 mm; via (hole+0.1 mm) implies 0.05 mm | one rule `minAnnularRingMm 0.15` for vias AND PTH | Via: conservative. PTH: 0.15 mm is BELOW the stated 0.18 mm absolute minimum — the profile does not distinguish the two; the acceptance board's header pads (1.7 mm pad / 1.0 mm hole → 0.35 mm ring) satisfy the official value, but the RULE is not proven conservative for arbitrary PTH parts — owner decision (see `unknowns-and-owner-decisions.md`) |
| Hole-to-hole | via 0.20 mm; pad 0.45 mm | 0.50 mm | Conservative — CONFIRMED |
| Copper to board edge | ≥ 0.20 mm routed; ≥ 0.40 mm V-cut | 0.30 mm | Conservative for routed edges — CONFIRMED (V-cut panelization not claimed) |
| Hole to board edge | not explicitly stated (castellated ≥ 1 mm) | 0.30 mm (`minHoleToEdge` reuses edge clearance) | UNKNOWN on the official page — not claimed |
| Board thickness | 0.4–4.5 mm (FR-4 incl. 1.6 mm) | 1.6 mm | CONFIRMED |
| Outer copper | 1 oz (thickness in µm not stated on the page) | 35 µm | INFERRED (1 oz ≈ 35 µm) |
| Max size (2 layer) | 670 × 600 mm | profile 100 × 80 mm; capability envelope 100 × 80 mm | Conservative — CONFIRMED |
| Solder mask bridge / expansion | bridge 0.10 mm (0.13 mm black/white); expansion 1:1 allowed, ≥ 0.09 mm clearance to traces | expansion 0.05 mm, sliver 0.10 mm | Conservative — CONFIRMED |
| Silkscreen | min width 0.15 mm; pad-to-silk 0.15 mm; text height ≥ 1.0 mm | width 0.15 mm; silk-pad 0.15 mm | Equal — CONFIRMED |
| Drill range | 0.15–6.3 mm; NPTH min 0.5 mm | acceptance board tools 0.4 mm (vias) and 1.0 mm (header) | Within range — CONFIRMED (independent readers check every tool) |
| Slots / castellations / edge plating | supported as special features / extra cost | declared `unsupported` in the rule profile (`MFG_SPECIAL_FEATURE_POLICY_UNSUPPORTED`) | Fail-closed — CONFIRMED |
| Blind/buried vias | not supported on 2 layer | only through-vias releasable (`MFG_VIA_SPAN_UNSUPPORTED`) | CONFIRMED |
| File formats | RS-274X Gerber, Excellon drill, Protel-style extensions accepted (help articles) | RS-274X X2 + XNC drill, `.GTL/.GBL/.GTS/.GBS/.GTO/.GML/.xnc/.gbrjob` | CONFIRMED by both independent readers |

## What this stage does NOT claim

- No upload, quote, order, or DFM review was performed with JLCPCB or anyone else (the release route never contacts an external host; `independent-gerber-verification.md`).
- "Gerbers generated and verified" does not mean a board was fabricated, assembled, ordered, or electrically certified; the panel and README say so verbatim.
- Assembly (BOM/CPL/paste) is explicitly absent from the bare-board release (`intentionallyAbsent` in the manifest).
