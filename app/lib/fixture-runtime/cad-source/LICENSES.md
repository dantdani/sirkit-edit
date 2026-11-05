# The fixture CAD source (`fixture-kicad`, section M2)

Served by `app/lib/fixture-runtime/cad-source/transport.ts` on the fixture host `cad-fixture.sirkit.test`, only under the fixture
runtime or an injected test registry (`app/lib/acquisition/cad-source-registry.ts`). Fixture evidence: never a live source.

[licence notices, 2026-11-05] The KiCad section below now points at the licence documents committed in this repository, gives each
file's full upstream path, and every blob id in it was re-checked against the pinned upstream trees.

## KiCad files (CC-BY-SA-4.0 with the KiCad libraries exception)

The `.kicad_sym` and `.kicad_mod` files under `kicad-symbols/` and `kicad-footprints/` in this folder come from the official KiCad
libraries (https://gitlab.com/kicad/libraries), (c) KiCad contributors. They are licensed under CC-BY-SA-4.0 with the KiCad libraries
exception, and they are **not** covered by Sirkit's MIT licence. Because they are a redistributed part of the libraries, they stay
under CC-BY-SA-4.0 (share-alike).

- Licence text: [`LICENSES/CC-BY-SA-4.0.txt`](../../../../LICENSES/CC-BY-SA-4.0.txt)
- KiCad's licence statement, copied verbatim:
  [`LICENSES/KiCad-Libraries-LICENSE.md`](../../../../LICENSES/KiCad-Libraries-LICENSE.md)
- More about KiCad library licensing: https://www.kicad.org/libraries/license/
- Repository-wide notice: [`THIRD_PARTY_NOTICES.md`](../../../../THIRD_PARTY_NOTICES.md), section 1

The libraries are provided without warranty of any kind, express or implied.
Fix library data upstream in the KiCad libraries, not here.

### Sources

Upstream pins: `kicad-symbols` at `90c39c3880f0062a56b5944d428edc846968d72b`, `kicad-footprints` at
`645402ed82e16096cf827fea7114fdbef4c46948` (the reviewed commits `app/lib/kicad/pinned-checkout.ts` records). "Byte-identical" means
the committed git blob id equals the upstream blob id (LF line endings, as upstream stores them).

| file | upstream path | blob id | state |
|---|---|---|---|
| `kicad-symbols/Diode.kicad_symdir/1N4001.kicad_sym` | `kicad-symbols/Diode.kicad_symdir/1N4001.kicad_sym` | `38528108f1cc9a549608e38f7ed07051a5a85d7b` | byte-identical |
| `kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym` | `kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym` | `3666ff30401fdbd828e03c4974d6ee40ba9561a8` | byte-identical |
| `kicad-footprints/Diode_THT.pretty/D_DO-35_SOD27_P7.62mm_Horizontal.kicad_mod` | `kicad-footprints/Diode_THT.pretty/D_DO-35_SOD27_P7.62mm_Horizontal.kicad_mod` | `f87a125a8fa102e7659dc537b7f45a9f219237bc` | byte-identical |
| `kicad-footprints/Diode_THT.pretty/D_DO-41_SOD81_P10.16mm_Horizontal.kicad_mod` | `kicad-footprints/Diode_THT.pretty/D_DO-41_SOD81_P10.16mm_Horizontal.kicad_mod` | `3c076adcd93c780239de0b68326f99e65c8abe5b` | byte-identical |

The transport also serves `Device.kicad_symdir/D.kicad_sym` and `Diode_SMD.pretty/D_SOD-123.kicad_mod` from
`app/lib/fixture-runtime/blinker/kicad/` (the copies M1 committed), without copying them again; their sources are listed in
[`../blinker/kicad/LICENSES.md`](../blinker/kicad/LICENSES.md).

## Pin tables (MIT, original)

`datasheets/*.pin-table.txt` are ORIGINAL Sirkit test text in the closed `SIRKIT-PIN-TABLE/1` format
(`app/lib/acquisition/datasheet-pin-table.ts`). They are labelled `fixture: yes`, are classed `organization_authored`, and are never
presented as a manufacturer document. They state the KiCad convention (pin/pad 1 the cathode) and nothing about ratings.
