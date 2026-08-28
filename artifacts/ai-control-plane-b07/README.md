# AI Control Plane — B07: Canonical Schematic Graph Commands and Stable Theory Identity

> **CORRECTION (B07.1, 2026-08-06).** Independent verification reproduced
> four acceptance failures against the claims below; B07.1
> (`artifacts/ai-control-plane-b07-1/`) closed them. As originally shipped,
> B07: (1) accepted OFF-GRID canonical wire geometry (`(1,1)→(21,1)`
> committed — "integer grid" was integers only, not grid alignment); (2)
> hydrated a projection containing DUPLICATE stable ids as `fresh`, leaving
> canonical operation targets ambiguous; (3) left the theory netlist
> reference positional, so downstream consumers discarded displayed
> references and could emit duplicate manufacturing references; (4) let a
> LATE gesture rejection restore its stale base over newer state (the
> commit cleared its gesture ref before awaiting and rolled back
> unconditionally); and (5) enforced the direct-setter boundary with a
> comment tripwire any future call could self-certify against. The sections
> below are retained verbatim as the historical record; where they claim
> grid validation, fail-closed duplicate identity, consumer-consistent
> display references, race-safe gesture rollback, or a structural tripwire,
> B07.1 is the authority.

B07 closes the schematic editor's remaining direct-mutation surface: wire,
label, junction/connectivity, and geometry edits are now typed, versioned
canonical operations; every completed pointer gesture is one atomic
transaction; and Theory components carry an immutable stable identity
separate from their editable display reference.

Companion documents:

- `schematic-graph-command-contract.md` — operation vocabulary, the
  simulation-verified graph-diff compiler, and the pinned derived-junction
  contract.
- `stable-theory-identity-migration.md` — the id/refDes split, one
  normalization policy, zero-rewrite deterministic legacy migration, and
  consumer behavior.
- `gesture-transaction-contract.md` — begin/preview/commit/cancel lifecycle,
  pinned base digests, and stale-gesture rejection.
- `graph-mutation-migration-matrix.csv` — every mutation path: old handler →
  new command with validation/inverse/boundary/evidence.
- `schematic-graph-replay-fixtures.json` — kernel-generated fixtures (8, all
  inverse round-trips exact); regenerate with
  `npx tsx scripts/generate-b06-schematic-artifacts.ts` (CI-pinned).

## What changed (runtime)

1. **Seven new graph operations** (`add/delete/update` × wire/net-label +
   indexed `add_component`) with order-preserving indexed adds, exact
   inverses captured pre-apply, and full validation; theory
   `set_component_properties` gained display-rename with a null-clears form
   so undo of a first rename is digest-exact.
2. **Every in-scope canvas handler routes through the session**: wire draw
   (incl. splits), junction, labels, deletes, placement — each recomputing
   its result against the canonical head inside the serialized queue and
   compiling through `diffSchematicGraphOps` (which SIMULATES its batch and
   refuses drift, hidden component removals, and identity/authority changes).
3. **Gestures**: group drag, stretch, label drag, and the SPICE-view move
   render preview frames only; pointer-up commits ONE pinned-base
   transaction; Escape/rejection restores the exact pre-gesture projection;
   frames create no history and are never persisted.
4. **Stable theory identity**: immutable `id` + editable `refDes` display
   (fallback = id, which IS the deterministic legacy migration — zero data
   rewrite, reload-stable, lineage/quarantine contracts untouched). Rename is
   a canonical interactive command; tier-1 proposal rename stays blocked as
   an explicit activation decision.
5. **Registry/tripwires**: `schematic.connect` and `schematic.add-component`
   are `implemented` with truthful rows; matrices and B04 artifacts
   regenerated; a CI tripwire fails on any untagged direct schematic setter
   call in `page.tsx` (35 remaining calls are all tagged `b07:preview` or
   `b07:lifecycle`); no tool/provider/MCP/route exposure was added (tested).

## Verification (2026-08-06, repo root)

```
npx tsc --noEmit                                   # PASS (0 errors; one corrupt GENERATED .next/dev/types/validator.ts was removed — see final report)
npx eslint <changed files>                         # see final stage report
npx tsx scripts/generate-action-toolability-matrix.ts && npx tsx scripts/generate-tool-registry-artifacts.ts && npx tsx scripts/generate-b06-schematic-artifacts.ts
npx vitest run app/lib/engineering/__tests__/b07-graph-gestures.test.ts   # PASS (19 tests)
npx vitest run app/lib/engineering                 # PASS (294 tests)
npx vitest run                                     # see final stage report
```

## Remaining limitations and owner decisions

- Theory netlist refdes SYNTHESIS in `netlist-bridge` remains positional
  (pre-existing); whether exports should follow display references is an
  owner decision.
- Tier-1 proposal theory-rename activation is an explicit owner decision
  (interactive rename exists; provider proposals stay blocked).
- Crossing-without-junction remains electrically disconnected unless split —
  current behavior, now pinned; making crossings configurable is future
  scope.
- The SPICE view keeps its own preview math (commits through the shared
  gesture contract); consolidating the two preview implementations is
  cleanup, not authority work.
- Wire drafts (the in-progress polyline preview) remain UI-transient state.
