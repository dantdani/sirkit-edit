# B16.1C — Component authority proof (§D/§G)

Claim: every footprint the acceptance board carries is bound to an exact, published, human-approved atomic revision with an approved pin-to-pad certificate, and qualification reads that authority from server-owned records only.

## The acceptance catalog (CONFIRMED by `blinker-catalog.test.ts`, 4 tests)

`app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-catalog.ts` builds, through the PRODUCTION catalog code (`AtomicCatalog`, `parseSymbolAssets`, `parseFootprintAsset`, `buildMappingCertificate`, `provePackage`, review/approve/publish transitions by human actor ids):

| Part | KiCad symbol (official library file, committed under `fixtures/kicad/`) | KiCad footprint | Exact part (fixture-labelled evidence) | Certificate |
|---|---|---|---|---|
| U1 | `Timer_NE555.kicad_sym` → `NE555D` (derived from `NE555D` parent; 8 pins 1 GND, 2 TRIG, 3 OUT, 4 ~{RST}, 5 CONT, 6 THRES, 7 DISCH, 8 VCC) | `SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` (8 SMD pads) | Texas Instruments NE555DR | approved, 8/8 pins ↔ pads |
| R1/R2/R3 | `R.kicad_sym` → `R` | `R_0805_2012Metric.kicad_mod` | Yageo RC0805FR-0710KL / -0756KL / -07330RL (one published revision per value) | approved, 2/2 |
| C1/C2/C3 | `C.kicad_sym` → `C` | `C_0805_2012Metric.kicad_mod` | Samsung CL21A106KAYNNNE (10 µF) / CL21B104KBCNNNC (100 nF) / CL21B103KBANNNC (10 nF) | approved, 2/2 |
| D1 | `LED.kicad_sym` → `LED` (pin 1 K, pin 2 A) | `LED_0805_2012Metric.kicad_mod` (pad 1 cathode) | Lite-On LTST-C170KGKT | approved, 2/2 |
| J1 | `Conn_01x02.kicad_sym` → `Conn_01x02` | `PinHeader_1x02_P2.54mm_Vertical.kicad_mod` (2 plated 1.0 mm holes) | Würth Elektronik 61300211121 | approved, 2/2 |

9 published atomic revisions; every portable snapshot carries the raw `.kicad_mod` bytes under the parsed asset's content hash (what `AtomicPcbSyncResourceProvider.materialize` demands). Evidence records are explicit `fixture://` records (the stage proves the PIPELINE; it does not claim datasheet verification of vendor data — see `unknowns-and-owner-decisions.md`).

## Binding (CONFIRMED by acceptance step 4)

`POST /api/physical-bindings` `bind_atomic_selection` as a human reviewer/admin for each of the 9 laid-out instances → 201, lifecycle `selected`, approval `approved`; the same request from a `pcb_editor` is refused (`PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED`, HTTP 422 — the route's existing status mapping, pinned as-is). A bound instance cannot be re-pointed at another revision (409 `PB_…`, recovery H.13).

## Synchronization uses that authority (CONFIRMED by acceptance step 5–6)

The production resolver (`createProductionFootprintResolutionService` over the binding repository; `selected_stage1_binding` source) resolves each component to its selected binding; `AtomicPcbSyncResourceProvider` materializes the footprint from the snapshot's raw bytes only when version id, content hash and certificate id all match; the executor stamps `syncIdentity {componentInstanceId, bindingRevisionId, footprintAssetVersionId, footprintContentDigest, mappingCertificateId, symbolAssetVersionId, syncPlanId}` on every footprint. Parity check in the TEST fixture: the board's own pad connectivity reproduces the 7 nets of the fake provider's netlist exactly (`verifyBlinkerBoardParity` compares `boardToSourceNetlist(board)` against `BLINKER_NETLIST`, an input independent of the board — not tautological). [B16-A corrected] The ROUTE's RC01 parity was a different matter: until `3231f3f` the qualify route certified parity against `boardToSourceNetlist(board)` — the board against itself — and sealed that board-derived netlist as `authority.netlist` (F4). It now derives the source netlist from the LAST APPLIED synchronization snapshot (`snapshotToSourceNetlist(applied.snapshot)`, `app/lib/pcb/fab/snapshot-netlist.ts` — introduced under `app/lib/pcb-sync/` in `3231f3f`, moved to `pcb/fab` in `e0efcfb` because Stage 3 forbids `netlist-bridge` references) and seals THAT netlist; `app/lib/pcb/fab/__tests__/b16-a-snapshot-netlist-parity.test.ts` shows a shorted net, a gained footprint and a moved endpoint each pass the old board-projected parity and FAIL the snapshot parity.

## Qualification reads only that authority (CONFIRMED)

`resolveQualificationComponentAuthority` (contract in `qualification-authority-contract.md`) accepted all 9 tuples: 0805 passives → `passive_smd_0603_0805` (×7), `SOIC-8 3.9x4.9mm P1.27mm` → `soic_tssop`, `PinHeader 1x02 P2.54mm Vertical` (through_hole, 2 pins) → `through_hole_header`; digest `qualification-authority-a959f6fc8f03a4c94e4a08ee95d0e9ad4750af97c025715c499a8a6fb6fb1b42` (acceptance evidence; [B16-A corrected] the digest is computed over sorted tuples and changed with the F8 locale fix `8746b46` — the orchestrator substitutes the re-recorded value). Negative proof: the golden RC03 board with synthetic identities and no binding records is refused 422 `MFG_COMPONENT_AUTHORITY_INCOMPLETE` with one `QA_BINDING_NOT_FOUND` per footprint and zero router runs (recovery H.3); all nine `QA_*` codes are unit-pinned (`qualification-authority.test.ts`).

## Electrical truth of the design (CONFIRMED by `verifyBlinkerSchematic`, 26 PASS rows in the acceptance run)

[B16-A corrected: F16 — this heading said 24. `verifyBlinkerSchematic` in `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-electrical.ts` emits 26 `check(...)` rows for a netlist that has the timer, all three timing parts, LED + limiter and the header (12 unconditional rows + 3 timing rows + 2 decoupling/bypass rows + 4 LED-branch rows + 2 header-pin rows + 3 hygiene rows), counted from the source in B16-A. The acceptance suite asserts the whole table has no FAIL row.]

Topology: VCC net (U1.8, U1.4, R1.1, C2.1, J1.1) and GND net (U1.1, C1.2, C2.2, C3.2, D1.1, J1.2) distinct; R_A = R1 10 kΩ (VCC → DISCH), R_B = R2 56 kΩ (DISCH → THRES/TRIG tied), C_T = C1 10 µF (THRES node → GND); f = 1.44/((R_A+2R_B)·C) = 1.180 Hz (tolerance band 1.06–1.33 Hz with R ±1 %, C ±10 %), duty 54.1 %; decoupling C2 100 nF VCC↔GND; CONT bypass C3 10 nF pin 5 ↔ GND; OUT (3) → R3 330 Ω → D1 anode (pin 2), D1 cathode (pin 1) → GND: 3.64 mA typical (2.12 mA at Vf max), limiter dissipation 5.9 mW; header J1.1 = VCC, J1.2 = GND; no dangling pins; exactly 7 nets and 9 components.
