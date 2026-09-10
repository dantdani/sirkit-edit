# B17-E — Placement, routing, history and import/export parity

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = designed, not exercised; RECORDED = written down without a claim.

## The shared candidate artifact (CONFIRMED)

`app/lib/pcb/candidates/layout-candidate.ts` — `sirkit.layout-candidate.v1`, ONE revision-bound envelope for auto-placement and autoroute candidates:

| field | meaning |
|---|---|
| `candidateId`, `digest` | content identity: the digest covers everything but the wall-clock stamps and the engine's per-invocation run id / elapsed time (evidence, not identity), so the same base + result seals to the same digest whenever it is produced |
| `base.revision` | `pcbRevisionId` of the board it was computed from |
| `base.generation` | the editor's lifecycle generation when known — a same-digest checkpoint restore still invalidates (B08.2) |
| `producer` | `editor` (the placement worker / the autoroute run), `agent` (the tool service), `route` (the preview route), `repair` |
| `expiresAt` | 30 min |
| placement: `problem`, `candidate` (`PlacementCandidate` with its own `sourceBoardRevision` / `problemHash` / `constraintProgramHash`), `run`, `scope.instanceIds`, `legal` | |
| routing: `scope.netIds` (or `all`), `routes` restricted to the scope, `routeAttemptId`, `candidateRevision`, `completion`, `readiness`, `stats` | |

**One options builder** — `placementRunOptions(board, request)` decides the movement mode (`initial_unrouted` / `preserve_routed` / `selected_scope`) and the scope for EVERY producer: the editor worker (`autoPlace` now calls it), the preview route (`POST /api/pcb/placement/preview`, which also refuses a stale `expectedRevision` with 409 and answers the envelope) and the agent tool service (`PCBToolService.previewPlacement`). Before B17-E the three producers hand-built diverging options (the agent even mutated a shadow board's `locked` flags) and kept candidates in three private places.

**One store** — `LayoutCandidateStore` (bounded, observable, digest-checked at registration, `retireStale(board, generation)` on every board change or lifecycle replacement) is created once per PCB editor mount and handed to `useAutoPlace`, `useAutoroute` and — through `usePcbRepair` — the agent's `PCBToolService`. An agent placement candidate therefore appears in the placement panel with an `agent` badge and the human applies or discards it exactly like the editor's own; the agent's `applyPlacement` stays refused until B18 activates execution.

**One apply** — `applyLayoutCandidate` verifies digest, expiry, generation and base revision, then commits ONE canonical transaction through the PCB commit gateway (`pcb.auto-place` / `pcb.autoroute-import` / `pcb.reroute-nets`): the base revision is re-checked at serialized execution time, placement goes through `applyPlacementCandidate` (hard legality, problem/program hashes, protected copper), routing through the self-dual `AutorouteImport` command restricted to the requested nets (a router result touching other nets is refused, so a broad answer can never widen the blast radius), the router's `candidateRevision` is verified against the local projection, and undo is the ordinary canonical undo. A stale / expired / tampered / foreign-generation candidate refuses with zero mutation (`STALE_REVISION`, `EXPIRED`, `UNKNOWN_CANDIDATE`, `STALE_GENERATION`).

**Autoroute preview / apply / discard** — `useAutoroute.run({ netIds? })` no longer commits on return: it sends `sourceRevision` (409 on mismatch) and the scope, wraps the response as the shared candidate, ghosts its copper on the canvas (`PcbScene.setRoutePreview`) and reports the projected connectivity / DRC / readiness; `apply()` commits through `applyLayoutCandidate`, `discard()` retires. The routing panel shows the candidate with Apply / Discard. The previously dropped `AutorouteCompletionResult` evidence (attempts, provenance) now travels in the candidate and the transaction metadata.

## Explicit selected-net commands and the routed-board revision (CONFIRMED)

- `pcb.clear-nets` — `clearNets({ netIds })`: one `RipupNet` per net (unlocked copper removed, locked copper kept) in ONE canonical transaction; the nets are the ones the view-session selection names (`netsOfSelection`: tracks, vias, zones, pads and footprints). Controls: routing panel "Clear selected nets", palette "Clear routing on selected nets".
- `pcb.reroute-nets` — the routing candidate scoped to the selection's nets (`useAutoroute.run({ netIds })`), reviewed as a ghost, applied through the same path. Controls: routing panel "Reroute selected nets", palette.
- `pcb.routed-board-revision` — "New routed-board revision…": the routed working copy becomes the durable board's next revision through the B16 sync path (preflight → plan carrying copper only where the netlist proves it unchanged → explicit apply), never a raw replacement; qualification (`pcb.qualify-route`) then seals the routed-board authority on the new revision. B16's `derive_board_revision` (`pcb.board-revision`) remains the schematic-change path.

## Tests (CONFIRMED)

- `app/lib/pcb/candidates/__tests__/b17-e-layout-candidates.test.ts` (5): the options builder's mode/scope decisions; a placement candidate's identity, verification (generation, expiry, tampering) and canonical apply + refusal of the stale candidate + undo; routing candidates scoped to nets, revision-pinned, applied as one reroute transaction replacing only unlocked copper on those nets, provenance refusal; clear-nets keeps locked copper and undoes; the bounded observable store.
- `app/api/__tests__/b16-0-12-tranche-parity.test.ts` — the placement preview route still runs the engine exactly once and is byte-deterministic modulo the run id and the candidate's wall-clock stamps.
- Existing suites: auto-place, autoroute command, repair agent, placement, executor kernel, PCB components — green on the rewired code.

## Bounded (RECORDED)

- `placement.preview-api` stays api-only by design (precise): it is the server producer of the shared candidate for tools (B17-F); the editor produces its own candidates in a worker.
- The routing ghost is a translucent overlay of the candidate's tracks and vias; zone refills are computed at apply (as before).
- The dead parallel placement layers found by discovery (`placement/service.ts`, `autoplace/command.ts`, `legacyAutoPlace`) are unused and left in place; retiring them is housekeeping, not parity.
