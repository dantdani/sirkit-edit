# B15.2 — unknowns and deliberate omissions

1. **The internal-sealer import gate is not added.** §G asks for an
   AST-aware exact-importer gate on the sealer. Nothing in production
   imports `sealed-pcb-edit-proposal.ts` today — only tests do — so the
   gate would pin an EMPTY approved set and would have to be rewritten in
   B15.3 when the tool handler becomes its first legitimate importer.
   Adding it now would be evidence theatre rather than a boundary. B15.3
   should add it together with that first importer.

2. **Late-throwing proxies are neutralized, not refused.** Because
   normalization snapshots values into inert data, a proxy that would throw
   on a later read never gets read again and yields a deterministic result
   from the snapshot. This satisfies totality and determinism; it is not a
   refusal, and the permanent test asserts the actual behaviour rather than
   a stronger claim.

3. **Dimension render-geometry traversal is structural.** The check walks
   whatever `dimensionGeometry` returns, collecting any `{x,y}` points and
   polylines it finds, rather than naming specific fields. If that
   authority's return shape gains a non-geometric point-like field, the
   check would over-approximate (refuse more), never under-approximate.

4. **Edge containment is sampled, not analytic.** Keepout edges and
   dimension polylines are tested at 64 interior samples plus endpoints
   against the exact outline. A notch narrower than 1/64 of an edge's
   length could in principle be stepped over. Increasing the sample count
   or intersecting analytically against outline segments would close this;
   it is recorded rather than claimed closed.
