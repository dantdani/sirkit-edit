# Third-party notices

Sirkit's own code is released under the MIT License (see [`LICENSE`](LICENSE)).
This repository also contains material from the third parties listed below.
That material keeps its own licence, and the notices below are reproduced as
those licences require. Where a licence below differs from Sirkit's, the
licence below governs the listed files.

Licence texts were checked against the upstream sources on 2026-11-04.

## 1. KiCad libraries (CC-BY-SA-4.0 with the KiCad libraries exception)

- **Source:** the official KiCad symbol and footprint libraries,
  https://gitlab.com/kicad/libraries (`kicad-symbols`, `kicad-footprints`),
  (c) KiCad contributors. Licensing statement:
  https://www.kicad.org/libraries/license/
- **Licence:** Creative Commons Attribution-ShareAlike 4.0 International
  (CC-BY-SA-4.0), with the KiCad libraries exception.
  - Full legal code: [`LICENSES/CC-BY-SA-4.0.txt`](LICENSES/CC-BY-SA-4.0.txt)
    (copied verbatim from https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt).
  - KiCad's licence statement and exception:
    [`LICENSES/KiCad-Libraries-LICENSE.md`](LICENSES/KiCad-Libraries-LICENSE.md)
    (copied verbatim from
    https://gitlab.com/kicad/libraries/kicad-symbols/-/raw/master/LICENSE.md;
    `kicad-footprints` ships an identical file).
- **Not covered by Sirkit's MIT License.** These files are redistributed
  library data, so the exception does not apply to them: they, and any
  modified versions of them, stay under CC-BY-SA-4.0 (share-alike), with this
  attribution and the licence documents kept.
- **No warranty:** the KiCad libraries are provided without warranty of any
  kind, express or implied (see KiCad's statement).

Files:

| path | notes |
|---|---|
| `app/lib/fixture-runtime/blinker/kicad/C.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/blinker/kicad/Conn_01x02.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/blinker/kicad/D.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/blinker/kicad/LED.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/blinker/kicad/R.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/blinker/kicad/Timer_NE555.kicad_sym` | **modified**: composed by Sirkit from the upstream `NE555D` and `NE555P` symbol files into one library file; no symbol data changed |
| `app/lib/fixture-runtime/blinker/kicad/C_0805_2012Metric.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/blinker/kicad/D_SOD-123.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/blinker/kicad/LED_0805_2012Metric.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/blinker/kicad/PinHeader_1x02_P2.54mm_Vertical.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/blinker/kicad/R_0805_2012Metric.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/blinker/kicad/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/Conn_01x04.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/Conn_02x03_Odd_Even.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/D_Schottky.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/LSM6DS3.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/MCU_Microchip_ATmega_ATmega328P-A.kicad_sym` | **modified**: composed by Sirkit from the upstream `ATmega48PV-10A` and `ATmega328P-A` symbol files into one library file; no symbol data changed |
| `app/lib/fixture-runtime/generation-kicad/MIC5504-3.3YM5.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/Q_NMOS_GSD.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/R_Potentiometer.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/D_SMA.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/PinHeader_1x04_P2.54mm_Vertical.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/PinHeader_2x03_P2.54mm_Vertical.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/Potentiometer_Bourns_3386P_Vertical.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/SOT-23.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/SOT-23-5.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/generation-kicad/TQFP-32_7x7mm_P0.8mm.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/cad-source/kicad-symbols/Diode.kicad_symdir/1N4001.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/cad-source/kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym` | byte-identical upstream copy |
| `app/lib/fixture-runtime/cad-source/kicad-footprints/Diode_THT.pretty/D_DO-35_SOD27_P7.62mm_Horizontal.kicad_mod` | byte-identical upstream copy |
| `app/lib/fixture-runtime/cad-source/kicad-footprints/Diode_THT.pretty/D_DO-41_SOD81_P10.16mm_Horizontal.kicad_mod` | byte-identical upstream copy |
| `app/lib/component-resolution/__tests__/fixtures/kicad/D.kicad_sym` | byte-identical upstream copy |
| `app/lib/component-resolution/__tests__/fixtures/kicad/D_SOD-123.kicad_mod` | byte-identical upstream copy |
| `app/lib/pcb/__tests__/fixtures/LQFP-48_7x7mm_P0.5mm.kicad_mod` | byte-exact copy from the KiCad 10.0 libraries |
| `app/lib/pcb/__tests__/fixtures/PinHeader_1x02_P2.54mm_Vertical.kicad_mod` | byte-exact copy from the KiCad 10.0 libraries |
| `app/lib/pcb/__tests__/fixtures/R_0805_2012Metric.kicad_mod` | byte-exact copy from the KiCad 10.0 libraries |
| `app/lib/pcb/demo/fixtures.ts` | embeds the three footprints above as strings (generated by `scripts/gen-demo-fixtures.ts`) |

Upstream paths, pinned commits and blob ids for the files in the
`blinker/kicad`, `generation-kicad`, `cad-source` and
`component-resolution/__tests__/fixtures/kicad` folders, and the modification
notices for the two composed files, are in each folder's `LICENSES.md`:

- [`app/lib/fixture-runtime/blinker/kicad/LICENSES.md`](app/lib/fixture-runtime/blinker/kicad/LICENSES.md)
- [`app/lib/fixture-runtime/generation-kicad/LICENSES.md`](app/lib/fixture-runtime/generation-kicad/LICENSES.md)
- [`app/lib/fixture-runtime/cad-source/LICENSES.md`](app/lib/fixture-runtime/cad-source/LICENSES.md)
- [`app/lib/component-resolution/__tests__/fixtures/kicad/LICENSES.md`](app/lib/component-resolution/__tests__/fixtures/kicad/LICENSES.md)

The `pcb/__tests__/fixtures` copies are described in
[`app/lib/pcb/__tests__/fixtures/README.md`](app/lib/pcb/__tests__/fixtures/README.md).

Designs and generated files that only *use* library data (for example
`app/lib/pcb/__tests__/fixtures/routed-demo.kicad_pcb`,
`e2e/fixtures/blinker-route-fixture.json` and the
`app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-route-fixture*.json`
recordings) fall under the KiCad libraries exception, which waives article 3
of the licence for them.

Please fix KiCad library data upstream in the KiCad libraries rather than in
this repository.

## 2. PCBSchemaGen_v2 (MIT)

- **Source:** https://github.com/HZou9/PCBSchemaGen_v2 (PCBSchemaGen,
  arXiv:2602.00510). Licence file:
  https://raw.githubusercontent.com/HZou9/PCBSchemaGen_v2/HEAD/LICENSE
  (default branch at `e07c545f4c01a8026480b1093ee503a926ce2be5` when checked).
- **Files:**
  - `lib/kg-data.ts`: generated by `scripts/build-kg.ts` from the upstream
    knowledge-graph JSON files.
  - `lib/kg.ts`: the knowledge-graph lookup and predicates of the port.
  - `lib/erc.ts`: error taxonomy and continuous-reward shaping ported from the
    upstream `framework/topo/error_types.py`.
  - `scripts/build-kg.ts`: the generator for `lib/kg-data.ts`.

```text
MIT License

Copyright (c) 2026 Huanghaohe Zou, Peng Han, Emad Nazerian, Mafu Zhang,
Zhicheng Guo, and Alex Q. Huang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 3. Hershey fonts (Hershey Simplex, `futural.jhf`)

- **Source:** https://github.com/kamalmostafa/hershey-fonts, file
  `hershey-fonts/futural.jhf`. Licence: the "Hershey fonts
  (hershey-fonts/*.jhf) license" section of
  https://raw.githubusercontent.com/kamalmostafa/hershey-fonts/HEAD/COPYING.
  Sirkit includes only this font data file. The package's software, which the
  same COPYING file places under GPL-2.0, is not included.
- **Files:**
  - `scripts/assets/futural.jhf`: byte-identical upstream copy (git blob
    `9bff530527ae69b97984190f01a8271545c9802b`).
  - `app/lib/pcb/silk/hershey-simplex.json`: the same font data converted to
    JSON by `scripts/gen-silk-font.ts`. It ships in the app bundle through
    `app/lib/pcb/silk/stroke-font.ts`.

The glyph designs themselves are widely described as public domain; the
conditions below come with this distribution of the data, and this section is
how Sirkit meets condition 1. The upstream text follows, with its indentation
converted from tabs to spaces:

```text
 Hershey fonts (hershey-fonts/*.jhf) license

 Copyright: 1967 Dr. A. V. Hershey, James Hurt

 This distribution of the Hershey Fonts may be used by anyone for
 any purpose, commercial or otherwise, providing that:
        1. The following acknowledgements must be distributed with
                the font data:
                - The Hershey Fonts were originally created by Dr.
                        A. V. Hershey while working at the U. S.
                        National Bureau of Standards.
                - The format of the Font data in this distribution
                        was originally created by
                                James Hurt
                                Cognition, Inc.
                                900 Technology Park Drive
                                Billerica, MA 01821
                                (mit-eddie!ci-dandelion!hurt)
        2. The font data in this distribution may be converted into
                any other format *EXCEPT* the format distributed by
                the U.S. NTIS (which organization holds the rights
                to the distribution and use of the font data in that
                particular format). Not that anybody would really
                *want* to use their format... each point is described
                in eight bytes as "xxx yyy:", where xxx and yyy are
                the coordinate values as ASCII numbers.
```

## 4. microsoft/SchGen (MIT)

- **Source:** https://github.com/microsoft/SchGen. Licence file:
  https://raw.githubusercontent.com/microsoft/SchGen/HEAD/LICENSE. The
  Hugging Face model card (https://huggingface.co/microsoft/SchGen) also
  declares `license: mit`.
- **Files:** `schgen-endpoint/handler.py`. Its `SYSTEM_PROMPT` is adapted from
  SchGen's system contract (`config.py`, `prepare_context`). The handler loads
  the `microsoft/SchGen` adapter and its base model from Hugging Face at run
  time; no model weights are committed, and those models keep their own
  licences.

```text
MIT License

Copyright (c) 2025 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 5. shadcn/ui (MIT)

- **Source:** https://github.com/shadcn-ui/ui. Licence file:
  https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md
- **Files:** `components/ui/badge.tsx`, `components/ui/button.tsx`,
  `components/ui/dialog.tsx`, `components/ui/input.tsx`,
  `components/ui/scroll-area.tsx`, `components/ui/separator.tsx`,
  `components/ui/textarea.tsx` (generated with the shadcn/ui CLI; see
  `components.json`).

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 6. create-next-app (MIT)

- **Source:** `create-next-app`, part of Next.js,
  https://github.com/vercel/next.js (package `license: MIT`). Licence file:
  https://raw.githubusercontent.com/vercel/next.js/canary/license.md
- **Files:** the project was scaffolded with `create-next-app`. Files still
  from that template include `app/favicon.ico` and `public/file.svg`,
  `public/globe.svg`, `public/next.svg`, `public/vercel.svg` and
  `public/window.svg`. The Next.js and Vercel names and logos are trademarks
  of Vercel, Inc.; the licence below does not grant trademark rights.

```text
The MIT License (MIT)

Copyright (c) 2025 Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Not in this repository

- **npm dependencies** are installed by pnpm and are not committed (only
  `pnpm-lock.yaml` is). Each package keeps its own licence.
- **External tools** that Sirkit can run as separate processes are installed
  separately and are not committed: FreeRouting (GPL-3.0) and a Java runtime,
  fetched by `scripts/setup-freerouting.ps1`; `kicad-cli` (part of KiCad); and
  ngspice.
- **Fonts:** Geist and Geist Mono are loaded through `next/font/google` at
  build time; no font files are committed.
