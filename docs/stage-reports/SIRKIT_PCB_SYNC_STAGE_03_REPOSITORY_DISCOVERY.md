# Sirkit PCB Synchronization Stage 3 Repository Discovery

## Scope and protected-copy rule

Stage 3 was implemented only in `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`. The original `C:\Users\robsa\sirkit` was not modified. This discovery describes the code as found before Stage 3 cutover.

## Existing production call flow

```text
PcbEditor Sync button / empty-board CTA
  -> PcbEditor.handleSync
  -> ensurePartLoaded for referenced catalog parts
  -> netlist-bridge.syncFromSchematic
       -> buildNetlist
       -> guessPackageToken
       -> exact atomic bundle OR symbol hint OR heuristicFootprint
       -> pin-pad mapping helper
       -> construct/update board, footprints, nets and placement
  -> history.execute OR dispatch(set-board)
  -> board-persistence/saveCurrentBoard
  -> lib/persistence localStorage project record
```

The old bridge decides footprints and mutates a candidate board in one call. It can preserve an already placed definition after a resolution failure. That makes it unsuitable as Stage 3 authority because a complete blocker set, immutable exact plan, and atomic server transaction do not exist at that boundary.

## Path inventory and classification

| Path / symbol | Caller / consumer | Existing responsibility | Mutation | Stage 3 disposition |
|---|---|---|---|---|
| `app/components/pcb/SyncButton.tsx` | PCB toolbar | Starts schematic-to-PCB sync and opens placement options | none | Legacy entry remains until qualified cutover |
| `app/components/pcb/PcbEditor.tsx#handleSync` | Sync button and empty-state CTA | Loads parts, invokes bridge, updates history/board/hash | board/history/local storage | Production legacy authority remains unchanged |
| `app/lib/pcb/netlist-bridge.ts#buildNetlist` | `syncFromSchematic` and tests | Enumerates schematic components/nets; derives package tokens | none | Comparison-only after cutover; forbidden from Stage 3 imports |
| `app/lib/pcb/netlist-bridge.ts#syncFromSchematic` | `PcbEditor` | Resolves, maps, places and updates a board | candidate board | Must be retired only after Stage 3 durable qualification |
| `app/lib/pcb/netlist-bridge.ts#resolveFootprint` | bridge | Atomic bundle, footprint hint, then heuristic | decision | Forbidden from new path |
| `app/lib/pcb/package-map.ts#guessPackageToken` / `heuristicFootprint` | bridge | Package/category/refdes heuristics | decision | Forbidden from new path; tested by static assertion |
| `lib/footprint-assign.ts` | legacy assignment paths | Hint/default lookup including passive defaults | decision | Forbidden from new path; comparison only |
| `app/lib/pcb/pin-pad-mapping.ts` | legacy bridge and validation | Existing mapping interpretation | none | Not a Stage 4 mapping authority |
| `app/lib/footprint-resolver/service.ts` | Stage 2 API and Stage 3 | Sole Stage 2 resolution authority | none | Required batch input to Stage 3; no fallback |
| `app/lib/atomic/server-catalog.ts` | atomic consumers | Loads published immutable atomic assets | catalog reads | Stage 3 exact resource materialization source |
| `app/lib/pcb/kicad-mod.ts#parseKicadMod` | footprint ingestion | Parses one immutable footprint asset | none | Used only after content-digest identity checks |
| `app/lib/pcb/types.ts` | PCB editor stack | Sirkit JSON PCB model | in memory | Only qualified board backend in Stage 3 |
| `app/lib/pcb/revision.ts` | board persistence / Stage 3 | Canonical semantic board revision | none | Stage 3 revision/CAS identity source |
| `app/lib/pcb/board-persistence.ts` | PCB editor | Loads/saves active PCB through project persistence | local storage | Not an atomic multi-record server repository |
| `lib/persistence.ts` | client product | Project record in `localStorage` | client storage | Cutover blocker for durable server authority |
| `app/lib/pcb/dsn/*` | autorouter integration | DSN export / SES import | route candidate | Consumes board only after router handoff |
| `app/api/pcb/autoroute/route.ts` | autoroute UI | FreeRouting execution and verification | generated route artifacts | Downstream; Stage 3 never invokes it |
| `app/lib/pcb/history.ts` | PCB editor | Undoable client board commands | history/board | Legacy sync uses it; Stage 3 has its own audited transaction contract |

## Identity and format findings

- Schematic reference designators were historically used as practical identity in several bridge paths. Stage 3 uses `componentInstanceId`; refdes is display metadata.
- Existing board nets have numeric IDs and names. Stage 3 adds/uses optional stable net IDs and verified endpoint keys rather than matching by name alone.
- Existing footprint definitions contain parsed geometry and optional raw s-expressions. Stage 3 stores exact asset version/content digest/mapping certificate/binding revision in `FootprintInstance.syncIdentity`.
- The repository has a KiCad footprint parser and board writer/export paths, but no demonstrated lossless arbitrary `.kicad_pcb` parse-modify-write transaction. Stage 3 therefore supports `sirkit-json-pcb/1` only.
- Project and board persistence is browser-local. There was no durable server-side snapshot/plan/board/audit transaction or compare-and-swap lock.

## Legacy inconsistency reproduced

Legacy assignment can infer a passive `0603` footprint for value-only `100n`, while another bridge path can block it. Stage 2 and Stage 3 now produce one deterministic blocked result. Generic `J1` is also blocked without deriving a connector package from its reference or pin count.

## Rollout boundary

`SIRKIT_PCB_SYNC_STAGE3` supports `off`, `observe`, `opt_in`, and `authoritative_safe_profile`. The default is `off`. Observation may compare results but cannot mutate. Opt-in apply is limited to the safe profile and still requires exact plan confirmation. Production legacy retirement is prohibited until durable snapshot/board repository, restart recovery, Stage 1/2 database qualification, full skipped-test review, and explicit rollout approval are complete.

