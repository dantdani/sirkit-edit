# B10.2 §A — server-proven netlist contract

## The proof (`proveAgentNetlist` in `app/lib/agent/netlist-validation.ts`)

A browser-supplied digest or an internally consistent projection is NOT
proof of derivation from the verified schematic. Proof is server-side
RE-DERIVATION:

1. Structural/semantic validation (`validateAgentNetlistProjection`) —
   now strengthened with the PRODUCTION rules:
   - Physical membership uses `theoryPinContract` (newly EXPORTED from
     `app/lib/pcb/netlist-bridge.ts` — the exact `THEORY_PIN_NUMBERS`
     table `buildNetlist` uses; no second divergent definition exists):
     ground symbols and voltage/current sources are sim stimuli and refuse
     as "not a component of the verified schematic" (R3).
   - Theory components must declare EXACTLY the production pin contract —
     pin numbers AND names (resistor: 1/left, 2/right) — so invented pins
     (R2, pin "999") and altered pin names refuse at the validator.
   - Display references use the production normalization
     (`normalizeRefDes(schDisplayRef(...))`).
2. **Theory-only schematics**: the expected netlist is recomputed via
   `buildNetlist(schematic)` (THE shared production derivation authority —
   union-find over wires/labels, GND merging, singleton rules), projected
   through the same authority-neutral projection, and compared for EXACT
   agreement (canonical digest over components + nets): complete physical
   component set, exact stable ids/refs, exact pins, exact nets/nodes/
   names/canonical endpoint keys — no omissions, additions, topology
   rewrites, or invented pins (R1). On agreement the SEALED resource
   content is the SERVER-OWNED recomputed result — browser bytes are never
   sealed.
3. **KiCad/catalog-bearing schematics**: the verified schematic carries no
   trusted server-owned pin/catalog data — the projection CANNOT be
   proven. Fail closed: the optional netlist resource is withheld with the
   precise bounded warning "trusted server-side component pin authority is
   unavailable…"; it is never sealed as verified; readiness reports
   schematic parity source `unavailable`, state `unknown` — never an
   authoritative pass. No component-authority producer was created and
   nothing is guessed.

## Preserved intent

Board/netlist disagreement stays a READINESS diagnosis after the netlist
is proven: a proven theory netlist against an empty board yields parity
`source: "authoritative-netlist"`, `state: "fail"`, with the real
`missingComponents` list (proven by test with a wired two-resistor
schematic → `["r1", "r2"]`). The resource remains local-working-copy,
optional, pinned to the verified schematic digest and canonical revision,
never component or manufacturing-release authority; no manufacturing gate
was weakened (readiness types unchanged — the logical projection already
satisfied the binding contract).

## Fixture discipline

Every valid-netlist fixture (B10/B10.1 suites, the B10 matrix generator)
is now DERIVED through `projectAgentNetlist(buildNetlist(...))` — no
hand-written "valid" netlist exists anywhere in the tree, so fixtures can
never drift from the production derivation.
