# Sirkit Footprint Resolver Stage 2 Repository Discovery

## Scope and conclusion

Stage 2 adds one read-only resolver over the Stage 1 physical-binding model. It does not replace production schematic-to-PCB synchronization; that cutover belongs to Stage 3. The original `C:\Users\robsa\sirkit` tree was not touched.

## Existing decision paths

| Path | Caller/consumer | Current behavior | Mutation point | Stage 2 disposition |
|---|---|---|---|---|
| `lib/footprint-assign.ts#resolveFootprint` | Legacy assignment consumers and tests | Approved atomic lookup, symbol hint, category defaults such as passive `0603` | Returns a candidate/default but does not itself write the board | Preserved for comparison only; defaults/hints are suggestion-only and cannot resolve in Stage 2 |
| `app/lib/pcb/netlist-bridge.ts#syncFromSchematic` | `app/components/pcb/PcbEditor.tsx` schematic-to-PCB action | Atomic bundle, exact hint, then package-map heuristic | Creates/updates PCB footprints and nets | Unchanged production authority until Stage 3; exercised through shadow wrapper for deep-equality proof |
| `app/lib/pcb/package-map.ts` | PCB netlist bridge | Token normalization and package/footprint mapping, including passive/package/header heuristics | Supplies a footprint selection to the bridge | Unchanged; future Stage 3 adapter/cutover must consume resolver output instead of re-deciding |
| `app/api/pcb/assign/suggest/route.ts` | PCB assignment UI | LLM suggestions with basic pad-count checking | Suggestion response only | Remains non-authoritative; AI cannot satisfy selection, approval, mapping, or readiness gates |
| `app/lib/atomic/*` and atomic catalog tables | Build/catalog flows | Exact part, package, footprint and evidence facts | Catalog ingestion/enrichment writes | Read as evidence only through Stage 1 bindings; not a resolver mutation path |
| `app/lib/physical-binding/repository.ts#PhysicalBindingService` | Stage 1 API/workflows | Candidate creation, explicit selection, validation, approval, stale/revoke transitions | Authoritative physical-binding writes and audit | Sole mutable authority; Stage 2 only calls the new read query |
| `app/lib/physical-binding/readiness.ts#evaluatePhysicalReadiness` | Stage 1 and Stage 2 | Deterministic layout/manufacturing gates | None | Reused directly; no duplicate readiness logic |
| `app/lib/pcb/pin-pad-mapping.ts` | PCB validation/runtime | Existing mapping accounting | Board validation only | Not promoted to Stage 4 verification authority |

## Current production precedence

The legacy paths are inconsistent: `lib/footprint-assign.ts` may propose a default `Capacitor_SMD:C_0603_1608Metric` for a generic capacitor while `app/lib/pcb/netlist-bridge.ts` can reject the same component when no package/hint is usable. Stage 2 records this as `legacy_default_new_requires_policy`; it does not choose either legacy outcome.

## Stage 2 authority map

- Public service: `app/lib/footprint-resolver/service.ts#FootprintResolutionService`.
- Pure decision core: `app/lib/footprint-resolver/engine.ts#DeterministicFootprintResolutionEngine`.
- Immutable snapshot/candidate collection: `service.ts` plus `adapters.ts`.
- Versioned policy: `policy.ts`.
- Conservative identity/deduplication: `stable.ts` and `normalize.ts`.
- Structural/request/context validation: `validation.ts`.
- Read-only API: `app/api/footprint-resolution/route.ts`.
- Optional observation-only boundary: `shadow.ts`.
- Pseudonymized metrics: `observability.ts`.

## Mutation and rollout boundary

Stage 2 contains no schematic, board, library, candidate, selection, approval, or migration write. `SIRKIT_FOOTPRINT_RESOLVER_SHADOW` is opt-in; the wrapper returns the production value unchanged and treats resolver failure/timeout as observation failure. The API reports `productionPcbSyncAuthority: legacy_until_stage3` and uses `Cache-Control: no-store`.

## Future disposition

- Stage 3 may replace the three production assignment branches with a single `resolvedBinding` consumer after live database qualification and rollout approval.
- Stage 4 owns new mapping verification, not Stage 2.
- Stage 5 owns passive package policy; its adapter is disabled in Stage 2.
- Stage 6 owns user decision/approval queueing; Stage 2 only returns remediation requirements.
- Stage 9 AI remains suggestion-only.
- Stage 10 owns generated/custom overlays; its adapter is disabled in Stage 2.

