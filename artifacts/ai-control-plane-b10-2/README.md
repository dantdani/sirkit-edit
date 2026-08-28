# B10.2 — Authoritative-Netlist Proof and Final Request-Boundary Closure

Corrective stage over B10.1 (implemented but not accepted). Five confirmed
counterexamples (R1–R5) were independently reproduced against production
code pre-edit, closed, and made permanent regressions.

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Exact R1–R5 pre-edit evidence |
| [server-proven-netlist-contract.md](server-proven-netlist-contract.md) | §A derivation-proof contract |
| [exact-request-contract-results.md](exact-request-contract-results.md) | §B exact selection contract |
| [bounded-reader-settlement-results.md](bounded-reader-settlement-results.md) | §C non-blocking cancellation |
| [regression-matrix.md](regression-matrix.md) | §D the 13 required coverage areas → tests |
| [validation-summary.md](validation-summary.md) | Full battery counts, UNKNOWNs, verdict |

## Invariants after B10.2

- **No client-authored projection can become a verified/authoritative
  netlist without server-side derivation proof.** For theory-only
  schematics, `proveAgentNetlist` re-derives the expected physical netlist
  through THE shared production authority (`buildNetlist` +
  `theoryPinContract` — no second pin/topology definition) and requires
  EXACT agreement; the sealed content is the SERVER-OWNED recomputation,
  never browser bytes. For KiCad/catalog-bearing schematics, the netlist is
  withheld with a precise warning (no trusted server-side pin authority;
  no producer created; nothing guessed) and readiness reports parity
  unavailable/unknown — never an authoritative pass.
- Empty projections, omissions, additions, simulation-only components
  (voltage/current sources, ground symbols), invented pins (resistor pin
  "999"), altered theory pin names, and topology rewrites all refuse.
  Board/netlist disagreement REMAINS a readiness diagnosis after the
  netlist is proven (a proven netlist against an empty board yields a real
  `SCHEMATIC_COMPONENT_MISSING` parity failure).
- **Exact selection contract**: `editorContext.selection` requires exactly
  `{ refs, primary }` — a missing `primary` returns 400 before provider
  invocation; `primary` must be null or a structurally valid selection
  reference (validated by THE shared parser, `parseSelectionRef`).
- **Non-blocking bounded reader**: crossing the byte ceiling stops
  consumption immediately, issues best-effort cancellation WITHOUT
  awaiting it, swallows cancel rejections and synchronous throws, and
  returns 413 deterministically — a hostile never-settling cancel cannot
  delay the response.

Static exposure stays NINE tools; no component-authority producer,
mutation, release, MCP, provider expansion, or multi-agent surface was
added. B11 was not started.
