# Stage 5 fixture licensing

All inline KiCad-format, component, package, claim, guidance, malformed-input,
and security fixtures in this directory are original minimal Sirkit test data
and are licensed under the MIT License with the rest of the Sirkit source tree
(see the repository's root `LICENSE`).

That licence does not cover the official KiCad library files some suites here
read from `app/lib/fixture-runtime/blinker/kicad/` (for example through
`_kicad-fixture-library.ts`). Those files stay under CC-BY-SA-4.0 with the KiCad
libraries exception; see `app/lib/fixture-runtime/blinker/kicad/LICENSES.md`
and the root `THIRD_PARTY_NOTICES.md`.

The `restricted` license object is synthetic policy metadata. It contains no
third-party CAD, datasheet, model, or proprietary content. No live supplier or
manufacturer response is checked in.
