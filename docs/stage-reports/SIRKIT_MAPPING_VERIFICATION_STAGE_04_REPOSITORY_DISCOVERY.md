# Stage 4 pin-pad mapping verification repository discovery

## Authority map

| Concern | Existing authority | Stage 4 use |
|---|---|---|
| Logical symbol asset and parsed pins | `app/lib/atomic/types.ts#SymbolAssetVersion`, `app/lib/atomic/kicad-assets.ts#parseSymbolAssets` | consumed by `buildMappingContext`; duplicate unit/body representations collapse by normalized pin identity while hidden pins remain present |
| Exact part, manufacturer facts and evidence | `app/lib/atomic/types.ts#AtomicPartRevision`, `ManufacturerTerminal`, `EvidenceRef`, `SourceRecord` | exact-part identity and independently sourced package terminals are frozen into the context |
| Exact footprint asset and parsed pads | `app/lib/atomic/types.ts#FootprintAssetVersion`, `app/lib/atomic/kicad-assets.ts#parseFootprintAsset` | exact pad IDs, pad numbers, type, layers, drill and mechanical attributes are frozen into the context |
| Existing atomic mapping | `app/lib/atomic/mapping.ts#buildMappingCertificate` and published portable snapshots | treated as an input/candidate only; its count-oriented flat certificate is not Stage 4 proof |
| Project component/variant binding | `app/lib/physical-binding/*` | Stage 4 publishes a richer immutable `PinPadMappingReference` successor through a projector |
| Footprint resolution | `app/lib/footprint-resolver/*` | accepts only supported/current/approved Stage 4 tiers; never creates the mapping |
| PCB synchronization | `app/lib/pcb-sync/*` | consumes the exact Stage 1 mapping reference and materialization; Stage 4 changes stale affected plans |
| Board/copper state | `app/lib/pcb/*` and Stage 3 repository | never read or mutated by pure verification; invalidation only changes plan lifecycle |

## Legacy and unsafe paths

- `app/lib/atomic/mapping.ts#buildMappingCertificate` models a direct pin-to-pad map and can report `approved` from completeness/package proof. It does not independently model manufacturer package terminals, polarity/function contradictions, equivalence classes, DNC, shield, mechanical or thermal intent. It remains compatible input but is not promoted to Stage 4 authority.
- `app/lib/pcb/pin-pad-mapping.ts`, `app/lib/pcb/netlist-bridge.ts` and `lib/footprint-assign.ts` belong to earlier live flows. Stage 4 imports none of their guessing/defaulting functions.
- A numeric/name/order match is represented only as `number_equality_candidate` and receives an explicit ambiguity plus blocking evidence finding.
- Vendor, legacy, API and AI-derived graphs cannot establish a verification tier under the fixed policy.

## Mutation and invalidation path

1. Pure verifier consumes trusted server-side `MappingContext` and `PhysicalTerminalMappingCandidate` and returns a deterministic result with no approval or design mutation claim.
2. A separate human-authorized operation may persist a verified result as an unreviewed immutable record.
3. A separate reviewer/admin action may approve the exact mapping content digest.
4. The Stage 1 projector writes an immutable selected physical-binding successor with the rich mapping reference.
5. Stage 2 has no cache; the invalidation event records its dependency key.
6. Affected Stage 3 plans are marked stale. Board state is not created or changed.

## Production ownership gap

The current Stage 4 route is intentionally qualification-only. The atomic catalog/published snapshot is the upstream durable authority, while Stage 1 physical bindings have a separate persistence path and Stage 3's qualified adapter is in-memory. There is no single durable compare-and-swap transaction that commits a new mapping record, updates the selected Stage 1 reference, records audit/idempotency, and stales Stage 3 plans across process restart. Enabling mutation before that transaction exists could create split authority. `SIRKIT_MAPPING_STAGE4` therefore defaults to `off`.

## Files that may be retired only after cutover

- Direct mapping approval semantics in `app/lib/atomic/mapping.ts` may be narrowed only after catalog publication emits/consumes Stage 4 artifacts.
- Legacy PCB mapping/default helpers may be retired only after Stage 1–4 durable authority and the Stage 3 safe-profile cutover are proven.
- No legacy path was deleted or silently changed in this stage.
