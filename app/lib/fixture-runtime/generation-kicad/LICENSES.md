# generation-kicad: KiCad library files for the L.7 generation fixture parts

[PR-L6, 2026-10-19] Runbook L.7 items 9-10 (OD-253 (1), (4)). The `.kicad_sym` and `.kicad_mod` files in this folder are the official
KiCad symbol and footprint library files the generation fixture parts are built from.

[licence notices, 2026-11-05] The licence section below now points at the licence documents committed in this repository, and every
blob id in this file was re-checked against the pinned upstream trees.

## Licence

These files come from the official KiCad libraries (https://gitlab.com/kicad/libraries), (c) KiCad contributors. They are licensed
under CC-BY-SA-4.0 with the KiCad libraries exception, and they are **not** covered by Sirkit's MIT licence. Because they are a
redistributed part of the libraries, they stay under CC-BY-SA-4.0 (share-alike). That includes the one composed file below.

- Licence text: [`LICENSES/CC-BY-SA-4.0.txt`](../../../../LICENSES/CC-BY-SA-4.0.txt)
- KiCad's licence statement, copied verbatim:
  [`LICENSES/KiCad-Libraries-LICENSE.md`](../../../../LICENSES/KiCad-Libraries-LICENSE.md)
- More about KiCad library licensing: https://www.kicad.org/libraries/license/
- Repository-wide notice: [`THIRD_PARTY_NOTICES.md`](../../../../THIRD_PARTY_NOTICES.md), section 1

The libraries are provided without warranty of any kind, express or implied.
Fix library data upstream in the KiCad libraries, not here.

## Sources

Upstream pins: `kicad-symbols` at `90c39c3880f0062a56b5944d428edc846968d72b`, `kicad-footprints` at
`645402ed82e16096cf827fea7114fdbef4c46948` (the commits `app/lib/kicad/pinned-checkout.ts` records). Every file in the table below is
a byte-identical upstream copy: its committed git blob id equals the upstream blob id (LF line endings, as upstream stores them).

The blob id is the git blob sha1 (`sha1("blob <length>\0" + bytes)`); the suite
`app/lib/fixture-runtime/__tests__/l7-generation-catalog.test.ts` recomputes every id from the committed bytes. That suite parses the
three-column tables in this file, so keep their columns as they are.

| file | upstream path | upstream git blob |
|---|---|---|
| `Q_NMOS_GSD.kicad_sym` | `kicad-symbols/Transistor_FET.kicad_symdir/Q_NMOS_GSD.kicad_sym` | `8e2f35affc1742d5c10f8d51bcbcfe6f051cc555` |
| `D_Schottky.kicad_sym` | `kicad-symbols/Device.kicad_symdir/D_Schottky.kicad_sym` | `e5bd8d41caba76bfdb4a80cc195bcdad7ce730f9` |
| `MIC5504-3.3YM5.kicad_sym` | `kicad-symbols/Regulator_Linear.kicad_symdir/MIC5504-3.3YM5.kicad_sym` | `b9bbaa5bb8e0e4f16a4a76cc63c013a13e0b4add` |
| `LSM6DS3.kicad_sym` | `kicad-symbols/Sensor_Motion.kicad_symdir/LSM6DS3.kicad_sym` | `c690591f35519906175979dae6b001f21e418e8e` |
| `Conn_01x04.kicad_sym` | `kicad-symbols/Connector_Generic.kicad_symdir/Conn_01x04.kicad_sym` | `d07c05d6d73d3233e497ab1cfb553893500acd7d` |
| `Conn_02x03_Odd_Even.kicad_sym` | `kicad-symbols/Connector_Generic.kicad_symdir/Conn_02x03_Odd_Even.kicad_sym` | `081d3a3bfe6fbd4106013cda195076a1293e8f1e` |
| `R_Potentiometer.kicad_sym` | `kicad-symbols/Device.kicad_symdir/R_Potentiometer.kicad_sym` | `210f85dc3ffd927c4bf580c751d947cef7dfca25` |
| `SOT-23.kicad_mod` | `kicad-footprints/Package_TO_SOT_SMD.pretty/SOT-23.kicad_mod` | `a8b97ac160265fe61233b6812bb2db0b74fef0bc` |
| `SOT-23-5.kicad_mod` | `kicad-footprints/Package_TO_SOT_SMD.pretty/SOT-23-5.kicad_mod` | `b9d7b1071c432e9dd05e2464e31c2608cbfc83fd` |
| `D_SMA.kicad_mod` | `kicad-footprints/Diode_SMD.pretty/D_SMA.kicad_mod` | `0e750f6aabe2d785d6017b0fd7ed32f1451a37e6` |
| `TQFP-32_7x7mm_P0.8mm.kicad_mod` | `kicad-footprints/Package_QFP.pretty/TQFP-32_7x7mm_P0.8mm.kicad_mod` | `81ef41cbc3e65079e7a39970fa225d3226ca8208` |
| `LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y.kicad_mod` | `kicad-footprints/Package_LGA.pretty/LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y.kicad_mod` | `56c8517f572aee30bd5cec0b9c8e109a00c907e8` |
| `PinHeader_1x04_P2.54mm_Vertical.kicad_mod` | `kicad-footprints/Connector_PinHeader_2.54mm.pretty/PinHeader_1x04_P2.54mm_Vertical.kicad_mod` | `f1b11b6b22c8a4516c76dc762af59441804a5208` |
| `PinHeader_2x03_P2.54mm_Vertical.kicad_mod` | `kicad-footprints/Connector_PinHeader_2.54mm.pretty/PinHeader_2x03_P2.54mm_Vertical.kicad_mod` | `d31fa1c4c7d2bd21644b88e7995cb2d8ceb7c375` |
| `Potentiometer_Bourns_3386P_Vertical.kicad_mod` | `kicad-footprints/Potentiometer_THT.pretty/Potentiometer_Bourns_3386P_Vertical.kicad_mod` | `5ea6d252184ad5b3c8ebed75cef1f68949f09fb2` |

## The one composed file

| file | made from | committed git blob | state |
|---|---|---|---|
| `MCU_Microchip_ATmega_ATmega328P-A.kicad_sym` | the two upstream files listed next | `9618fdedbd2a007a5898a39f93531b9ab67e0a2d` | **modified**: composed by Sirkit into one library file; no symbol data changed |

`MCU_Microchip_ATmega_ATmega328P-A.kicad_sym` is ONE KiCad symbol library assembled from two upstream files of the split library
`MCU_Microchip_ATmega.kicad_symdir` (KiCad's own `extends` resolution: the child `ATmega328P-A` extends `ATmega48PV-10A`):

| input | upstream path | upstream git blob |
|---|---|---|
| parent | `kicad-symbols/MCU_Microchip_ATmega.kicad_symdir/ATmega48PV-10A.kicad_sym` | `a1a6ae457beb1ea5fdb72a44535585c872f0c378` |
| child | `kicad-symbols/MCU_Microchip_ATmega.kicad_symdir/ATmega328P-A.kicad_sym` | `935a2b8c08091082885fc2b3420e02cf602508c5` |

### Modification notice: `MCU_Microchip_ATmega_ATmega328P-A.kicad_sym`

This file is not a verbatim upstream file. Sirkit combined the two upstream symbol files above into one library file: the child file's
header, the parent's `(symbol ...)` block, the child's `(symbol ...)` block and the child file's closing parenthesis, each copied byte
for byte. No symbol data was changed. The combined file is distributed under the same CC-BY-SA-4.0 licence.

The text is exactly what the production composer `composeSymbolLibrary(child, "ATmega328P-A", {ATmega48PV-10A: parent})`
(`app/lib/acquisition/kicad-library-compose.ts`) yields. It is committed pre-composed (as `../blinker/kicad/Timer_NE555.kicad_sym` is)
because the fixture catalog module may not import the composer; the catalog suite recomposes it from the two upstream blobs above and
compares.

## What these files are, and are not

The fixture catalog (`app/lib/fixture-runtime/blinker/catalog.ts`, `generationFixtureParts()`) derives every pin and pad fact from these
files. The exact manufacturer parts it links them to (AO3400A, SS14-E3/61T, MIC5504-3.3YM5-TR, ATMEGA328P-AU, LSM6DS3TR-C, Wuerth
61300411121 and 61300621121, Bourns 3386P-1-103LF) carry FIXTURE evidence records only (`fixture://l7/...`, "NOT manufacturer
datasheets"): no rating, pin function or package claim of a manufacturer datasheet was checked for this fixture. In particular the
KiCad `LSM6DS3` symbol draws pins 10 and 11 as no-connect; the LSM6DS3TR-C names them for its auxiliary SPI, and the fixture designs
leave both open.
