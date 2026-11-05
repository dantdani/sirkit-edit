# Test fixtures

The three `.kicad_mod` files in this directory are byte-exact copies from the
official KiCad footprint libraries (KiCad 10.0, `Resistor_SMD.pretty`,
`Package_QFP.pretty`, `Connector_PinHeader_2.54mm.pretty`), copied here solely
for round-trip and parser test purposes. They are licensed CC-BY-SA 4.0 with
the KiCad Libraries Exception — see
https://gitlab.com/kicad/libraries/kicad-footprints/-/blob/master/LICENSE.md.
Do not edit or re-save them: the round-trip tests depend on the exact bytes
(including CRLF line endings), which is also why `.gitattributes` marks them
as not-text.

These three files are not covered by Sirkit's MIT licence. As redistributed
library files they stay under CC-BY-SA-4.0 (share-alike). Copies of the
licence documents are committed at
[`LICENSES/CC-BY-SA-4.0.txt`](../../../../../LICENSES/CC-BY-SA-4.0.txt) and
[`LICENSES/KiCad-Libraries-LICENSE.md`](../../../../../LICENSES/KiCad-Libraries-LICENSE.md).
The same three footprints are embedded in the generated
`app/lib/pcb/demo/fixtures.ts` (content unchanged apart from line endings),
under the same licence. `routed-demo.kicad_pcb`
is a board Sirkit generated from them; generated designs fall under the KiCad
libraries exception (see the root `THIRD_PARTY_NOTICES.md`).
