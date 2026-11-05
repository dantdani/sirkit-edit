# KiCad library files in this folder

The `.kicad_sym` and `.kicad_mod` files in this folder come from the official
KiCad libraries (https://gitlab.com/kicad/libraries), (c) KiCad contributors.
They are licensed under CC-BY-SA-4.0 with the KiCad libraries exception, and
they are **not** covered by Sirkit's MIT licence. Because they are a
redistributed part of the libraries, they stay under CC-BY-SA-4.0 (share-alike).

- Licence text: [`LICENSES/CC-BY-SA-4.0.txt`](../../../../../../LICENSES/CC-BY-SA-4.0.txt)
- KiCad's licence statement, copied verbatim:
  [`LICENSES/KiCad-Libraries-LICENSE.md`](../../../../../../LICENSES/KiCad-Libraries-LICENSE.md)
- More about KiCad library licensing: https://www.kicad.org/libraries/license/
- Repository-wide notice: [`THIRD_PARTY_NOTICES.md`](../../../../../../THIRD_PARTY_NOTICES.md), section 1

The libraries are provided without warranty of any kind, express or implied.
Fix library data upstream in the KiCad libraries, not here.

## Sources

Upstream pins: `kicad-symbols` at `90c39c3880f0062a56b5944d428edc846968d72b`,
`kicad-footprints` at `645402ed82e16096cf827fea7114fdbef4c46948`. "Byte-identical"
means the committed git blob id equals the upstream blob id.

| file | upstream path | blob id | state |
|---|---|---|---|
| `D.kicad_sym` | `kicad-symbols/Device.kicad_symdir/D.kicad_sym` | `3d08ad680e4dfe1d3989b02a05afb7679b2e01ad` | byte-identical |
| `D_SOD-123.kicad_mod` | `kicad-footprints/Diode_SMD.pretty/D_SOD-123.kicad_mod` | `0f1f9bed4db3f95f8ee9c917c6a1a2cef04d828c` | byte-identical |

These are test fixtures for section M1, read by
[`../../_m1-fixtures.ts`](../../_m1-fixtures.ts). The same two files, with the same
blob ids, are also committed in `app/lib/fixture-runtime/blinker/kicad/`.

`_m1-fixtures.ts` also derives a `D_AK` symbol from `D.kicad_sym` while the
tests run (the symbol renamed and its two pin numbers swapped). That derived
text is not committed; it is a modified form of the KiCad symbol and stays
under the same CC-BY-SA-4.0 licence.
