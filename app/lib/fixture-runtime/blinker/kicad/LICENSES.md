# KiCad library files in this folder

The `.kicad_sym` and `.kicad_mod` files in this folder come from the official
KiCad libraries (https://gitlab.com/kicad/libraries), (c) KiCad contributors.
They are licensed under CC-BY-SA-4.0 with the KiCad libraries exception, and
they are **not** covered by Sirkit's MIT licence. Because they are a
redistributed part of the libraries, they stay under CC-BY-SA-4.0 (share-alike).

- Licence text: [`LICENSES/CC-BY-SA-4.0.txt`](../../../../../LICENSES/CC-BY-SA-4.0.txt)
- KiCad's licence statement, copied verbatim:
  [`LICENSES/KiCad-Libraries-LICENSE.md`](../../../../../LICENSES/KiCad-Libraries-LICENSE.md)
- More about KiCad library licensing: https://www.kicad.org/libraries/license/

The libraries are provided without warranty of any kind, express or implied.
Fix library data upstream in the KiCad libraries, not here.

## Sources

Upstream pins: `kicad-symbols` at `90c39c3880f0062a56b5944d428edc846968d72b`,
`kicad-footprints` at `645402ed82e16096cf827fea7114fdbef4c46948`. "Byte-identical"
means the committed git blob id equals the upstream blob id.

| file | upstream path | blob id | state |
|---|---|---|---|
| `C.kicad_sym` | `kicad-symbols/Device.kicad_symdir/C.kicad_sym` | `1cb16b43012d96bfb090dc6a47b160d75ad5574f` | byte-identical |
| `Conn_01x02.kicad_sym` | `kicad-symbols/Connector_Generic.kicad_symdir/Conn_01x02.kicad_sym` | `cd65abe4c58c441d33ff68382e47773e699c3238` | byte-identical |
| `LED.kicad_sym` | `kicad-symbols/Device.kicad_symdir/LED.kicad_sym` | `d7af0c685e07eee9e2cf5a34b2710fdb8fe6735a` | byte-identical |
| `R.kicad_sym` | `kicad-symbols/Device.kicad_symdir/R.kicad_sym` | `7518db51e6f8580ceaae96208b4cad1e8065c66b` | byte-identical |
| `Timer_NE555.kicad_sym` | `kicad-symbols/Timer.kicad_symdir/NE555D.kicad_sym` (`15213064fe6956dccc4f7dcfa6de64bebf728724`) and `kicad-symbols/Timer.kicad_symdir/NE555P.kicad_sym` (`bee075fdba5954802fff2cbd0619c8de16aaef2f`) | `6e0d62a6c48bf4448f3058d23db40a552dacd466` | **modified**: composed by Sirkit into one library file (see below) |
| `C_0805_2012Metric.kicad_mod` | `kicad-footprints/Capacitor_SMD.pretty/C_0805_2012Metric.kicad_mod` | `85188009b643fd34e6df53d07bde315851236128` | byte-identical |
| `LED_0805_2012Metric.kicad_mod` | `kicad-footprints/LED_SMD.pretty/LED_0805_2012Metric.kicad_mod` | `99a5b8eb2f9be5ede5871b34334f2490d4e77116` | byte-identical |
| `PinHeader_1x02_P2.54mm_Vertical.kicad_mod` | `kicad-footprints/Connector_PinHeader_2.54mm.pretty/PinHeader_1x02_P2.54mm_Vertical.kicad_mod` | `77ba5bb335392f63365e27f60ce79d305a11b134` | byte-identical |
| `R_0805_2012Metric.kicad_mod` | `kicad-footprints/Resistor_SMD.pretty/R_0805_2012Metric.kicad_mod` | `44825545f5c9edeac2651d2b9218fa804580df99` | byte-identical |
| `SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` | `kicad-footprints/Package_SO.pretty/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` | `5535978e52241fb38973c1aacf06b31ecdfe9f18` | byte-identical |

### Modification notice: `Timer_NE555.kicad_sym`

This file is not a verbatim upstream file. Sirkit combined two upstream symbol
files into one library file: the whole of `NE555D.kicad_sym` without its
closing parenthesis, followed by the `NE555P` symbol block (which `extends`
`NE555D`) and the closing parenthesis of `NE555P.kicad_sym`. No symbol data was
changed. The combined file is distributed under the same CC-BY-SA-4.0 licence.
