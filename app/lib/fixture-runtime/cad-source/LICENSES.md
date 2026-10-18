# The fixture CAD source (`fixture-kicad`, section M2)

Served by `app/lib/fixture-runtime/cad-source/transport.ts` on the fixture host `cad-fixture.sirkit.test`, only under the fixture
runtime or an injected test registry (`app/lib/acquisition/cad-source-registry.ts`). Fixture evidence: never a live source.

## KiCad files (CC-BY-SA 4.0 with the KiCad libraries exception)

Verbatim copies of the official KiCad library blobs at the reviewed pinned commits (`app/lib/kicad/pinned-checkout.ts`); the git
blob ids of these files equal the upstream blob ids (LF line endings, as upstream stores them):

| file | upstream path | pinned commit | git blob |
|---|---|---|---|
| `kicad-symbols/Diode.kicad_symdir/1N4001.kicad_sym` | `kicad-symbols:Diode.kicad_symdir/1N4001.kicad_sym` | `90c39c3880f0062a56b5944d428edc846968d72b` | `38528108f1cc9a549608e38f7ed07051a5a85d7b` |
| `kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym` | `kicad-symbols:Diode.kicad_symdir/1N4148.kicad_sym` | `90c39c3880f0062a56b5944d428edc846968d72b` | `3666ff30401fdbd828e03c4974d6ee40ba9561a8` |
| `kicad-footprints/Diode_THT.pretty/D_DO-35_SOD27_P7.62mm_Horizontal.kicad_mod` | `kicad-footprints:Diode_THT.pretty/...` | `645402ed82e16096cf827fea7114fdbef4c46948` | `f87a125a8fa102e7659dc537b7f45a9f219237bc` |
| `kicad-footprints/Diode_THT.pretty/D_DO-41_SOD81_P10.16mm_Horizontal.kicad_mod` | `kicad-footprints:Diode_THT.pretty/...` | `645402ed82e16096cf827fea7114fdbef4c46948` | `3c076adcd93c780239de0b68326f99e65c8abe5b` |

The transport also serves `Device.kicad_symdir/D.kicad_sym` and `Diode_SMD.pretty/D_SOD-123.kicad_mod` from
`app/lib/fixture-runtime/blinker/kicad/` (the copies M1 committed), without copying them again.

## Pin tables (MIT, original)

`datasheets/*.pin-table.txt` are ORIGINAL Sirkit test text in the closed `SIRKIT-PIN-TABLE/1` format
(`app/lib/acquisition/datasheet-pin-table.ts`). They are labelled `fixture: yes`, are classed `organization_authored`, and are never
presented as a manufacturer document. They state the KiCad convention (pin/pad 1 the cathode) and nothing about ratings.
