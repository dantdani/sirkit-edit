# B10.2 pre-edit counterexamples (R1–R5)

Independently reproduced against current production code with a transient
vitest file (deleted after capture) BEFORE any edit. Exact output:

## R1 — incomplete netlist authority elevation

Verified schematic containing physical resistor `r1`, empty PCB, supplied
`{ schema: "sirkit.agent-netlist-projection.v1", components: [], nets: [] }`:

```
R1 validator issues: []
R1 assembly accepted netlist: true []
R1 sealed authorityStatus: verified
R1 parity: {"source":"authoritative-netlist","state":"pass","intendedComponents":[]}
```

An EMPTY client projection became a verified authoritative-netlist parity
PASS.

## R2 — invented theory pin

```
R2 pin-999 issues: []
```

A resistor declaring and connecting pin "999" validated (only internal
consistency was checked; the production theory pin contract was never
consulted).

## R3 — simulation-only component

```
R3 sim-source issues: []
```

A voltage-source record inserted into the physical projection validated
(membership used the raw schematic component list, not the production
physicality rule).

## R4 — incomplete exact selection

```
R4 status without primary: 200
```

`selection: { refs: [] }` without `primary` was accepted (primary was
optional at the route).

## R5 — hostile cancellation

```
R5 outcome after 500ms: HUNG pulls: 9
```

`readBoundedBody` awaited `reader.cancel()`; a never-settling cancel
prevented the 413 indefinitely (the request never settled within the 500 ms
race window despite reading having stopped at 9 pulls).

All five are closed and permanently regression-tested in
`app/api/chat/__tests__/b10-2-closure.test.ts` (9 tests, driven through the
production validator → assembler → resource envelope → readiness chain and
the production chat route).
