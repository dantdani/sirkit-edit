# Footprint Binding Stage 1 — Repository Discovery and Ownership

Date: 2026-07-18  
Implementation root: protected Sirkit copy only (`work/sirkit-edit`)

## Existing footprint-bearing flows

| Path | Existing responsibility | Stage 1 classification |
|---|---|---|
| `lib/schematic-types.ts` | Canvas component instance IDs and optional atomic symbol/footprint/mapping pins | Stable-identity input. `id` is durable; `refDes` remains display metadata. |
| `app/lib/schematic-compiler/types.ts` | CD-8 semantic `componentInstanceId`, exact part/package/footprint revisions and mapping certificate | Stable/exact upstream input. Not replaced. |
| `app/lib/atomic/types.ts` | Exact manufacturer parts, supplier parts, evidence, immutable CAD assets, package proof and mapping certificates | Authority for catalog facts, evidence and immutable assets. Reused by reference. |
| `app/lib/db/schema.ts` atomic tables | Persistent atomic exact parts, evidence, CAD assets, mappings, revisions and selections | Existing catalog/evidence store. Not duplicated. |
| `parts` / `pcb_footprints` in `app/lib/db/schema.ts` | Search/discovery indexes with MPN, package and footprint hint strings | Legacy/raw input only; never approval. |
| `lib/footprint-assign.ts` | Deterministic legacy assignment: atomic approved bundle, hint, then candidate defaults | Existing production assignment path. Unchanged in Stage 1. |
| `app/lib/pcb/netlist-bridge.ts` | Live schematic-to-PCB conversion: atomic bundle, exact hint, package heuristic; preserves placed board data | Existing production PCB-sync path. Unchanged in Stage 1. |
| `app/lib/pcb/package-map.ts` | Package-token heuristic | Legacy production heuristic only; not authoritative binding truth. |
| `app/lib/pcb/pin-pad-mapping.ts` | Runtime lossless pin/pad accounting with explicit mappings or exact identifier equality | Existing PCB-sync safety check. Stage 1 stores the later Stage 4 certificate contract and does not replace this code. |
| `app/api/pcb/assign/suggest/route.ts` | On-demand suggestion queue | Candidate input only; suggestion never means selection or approval. |
| `app/api/pcb/footprints/*` | KiCad footprint search, lookup and source retrieval | Asset-discovery adapter. Not a binding authority. |
| `app/lib/atomic/server-repository.ts` | Atomic catalog publication transaction and audit | Reused evidence/asset authority. |
| `lib/persistence.ts` | Existing project serialization and atomic project pins | Compatibility/persistence input. Stage 1 adds separate authoritative binding tables without changing old round-trips. |
| `app/lib/engineering/*` | Actor, role, revision, transaction, telemetry and rollout conventions | Reused authorization and audit vocabulary. |
| `app/lib/pcb/board-persistence.ts` | Board persistence | Board authority. Stage 1 does not modify it. |
| `app/lib/pcb/kicad-mod.ts`, `app/lib/kicad/*` | KiCad parsing/adaptation | Format adapters only. Core binding model has no parser dependency. |
| `app/lib/bom/build.ts` | BOM projection from schematic/atomic metadata | Downstream consumer; no Stage 1 behavior change. |
| `app/components/pcb/PcbEditor.tsx`, `app/components/pcb/hooks/*` | Current sync/edit UI and commands | No Stage 1 cutover or mutation. |

## Test and fixture ownership

- Existing production PCB-sync coverage: `app/lib/pcb/__tests__/netlist-bridge.test.ts`.
- Existing atomic identity/mapping coverage: `app/lib/atomic/__tests__/`.
- Existing PCB pin/pad coverage: `app/lib/pcb/__tests__/pin-pad-mapping.test.ts`.
- Existing project persistence coverage: `app/lib/engineering/__tests__/persistence-recovery.test.ts` and `lib/persistence.ts` consumers.
- New Stage 1 qualification corpus: `app/lib/physical-binding/__tests__/`.

## Authoritative ownership matrix

| Fact or decision | Authority | Compatibility behavior |
|---|---|---|
| Stable project component identity | Schematic instance ID plus tenant/project/branch/board/hierarchy scope | Refdes is never used as the foreign key. |
| Manufacturer and exact MPN | Atomic exact-part catalog | Legacy MPN alone remains unresolved. |
| Supplier SKU | Atomic supplier-part record | Never substitutes for exact MPN. |
| Package fact | Revisioned `PackageBinding` referencing evidence/atomic facts | Ambiguous aliases such as bare `0603` are rejected. |
| Footprint content | Atomic/project asset version and content digest | `Library:Name` is a locator, not immutable identity. |
| Pin-to-pad proof | Versioned `PinPadMappingReference` to a Stage 4/atomic certificate | Counts and string existence never prove mapping. |
| Project/variant candidate, selection and approval | `ComponentPhysicalBinding` and `ComponentPhysicalBindingSet` | Legacy fields are preserved inputs/read-only projections. |
| Layout/manufacturing readiness | Pure central Stage 1 evaluator | Never stored or set directly by callers. |
| Current PCB footprint choice | Existing `syncFromSchematic` path until Stage 2/3 cutover | Stage 1 shadow output cannot change it. |
| Board geometry, placement, routing and copper | Existing PCB board model | Outside Stage 1 and untouched. |

## Ownership conclusion

`app/lib/physical-binding/types.ts` is the sole authoritative Stage 1 project physical-binding model. It references existing atomic identities and evidence rather than copying catalog truth. `legacy.ts` is an input/projection adapter, `shadow.ts` is observation-only, and the legacy assigner/netlist bridge remain the production decision paths. This avoids a parallel mutable footprint authority during rollout.

## Known rollout boundary

Stage 1 does not make an unresolved schematic transferable to PCB. In particular, generic `J1` and `100n` records remain blocked until later stages obtain explicit physical facts, selection, validation and approval.
