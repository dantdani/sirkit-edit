# Sirkit Stage 1: Electrical identity and data-integrity implementation

Date: 2026-07-16  
Baseline audited and implemented: `2bd1603a775bd4b409b89710cd4e5f8d70201632`  
Implementation branch: `codex/stage-01-data-integrity`

## 1. Executive implementation summary

### P0-1: Copper changed nets after schematic synchronization

PCB nets now have a serialized `stableId` and canonical schematic `endpointKeys` in addition to their derived numeric `id`. Schematic endpoints are keyed by persistent component instance ID plus the exact, case-sensitive pin string. Synchronization migrates legacy identity, validates the complete candidate, reconciles old and new endpoint sets, then remaps every persistent numeric net reference through the reconciliation table.

Exact matches, renames, and unique endpoint growth/shrinkage retain stable identity. Routed split, merge, deletion, unresolved legacy identity, and identity-collision cases reject atomically with structured diagnostics. Tracks, vias, zones, stackup planes, routing-history events, footprint pad assignments, and direct net-target rule deltas are covered. A failed sync returns the exact original board and creates no history entry; a successful sync is one undoable transaction.

### P0-2: Pad-count-only footprint acceptance lost connectivity

Pad count is no longer an acceptance rule. The only implicit mapping is exact trimmed string identity; there is no numeric coercion, array-order, position, count, footprint-name, or AI guess. A typed mapping contract supports one-to-one, one-to-many, exposed-pad, internally-common, physical no-connect, schematic-only, mechanical, and intentional extra-pad classifications.

Every schematic pin and every electrical footprint pad is accounted for before sync commits. Conflicting ownership and connected nonphysical pins reject. The resolved mapping is persisted on the footprint and included in stale-candidate hashing. DSN carries an internal endpoint manifest and independently proves that required physical nodes survived. Duplicate physical pad numbers receive deterministic image-local IDs such as `1@1` and `1@2`, preserving both physical targets without changing the source mapping.

### P0-3: Locked copper was mutable

Tracks, vias, and zones now share central lock diagnostics and exact before/after validation. Inspector, batch, selection transform, delete, width, layer, zone-net, via-padstack, stretch, connected-junction drag, rip-up, autoroute import, repair preview/apply, AI/native command, and zone-command paths enforce locks.

Mixed bulk edits reject atomically. Rip-up removes only unlocked copper and reports removed and protected IDs separately. Autoroute and repair candidates cannot replace, move, resize, relayer, renet, or delete locked objects. Unlock is an explicit edit command and history event. Denied/no-op mutations add no false undo entry.

### P0-4: Duplicate exported references were ambiguous

Stable component identity remains the schematic/PCB instance ID; reference text is only the human/export identity. References are board-global, retain display spelling, and compare using trimmed uppercase keys. Empty/placeholder references, surrounding whitespace, invalid characters, missing annotation digits, duplicate component IDs, and case-insensitive duplicate references reject.

The shared validator runs before PCB sync, DSN, KiCad PCB, BOM, position, and native manufacturing outputs. DSN preflight independently detects a manually corrupted duplicate. Reannotation updates export text while placement, component identity, and net identity remain attached to the stable component ID.

## 2. Current data model

| Concept | Implemented representation and rule |
|---|---|
| Stable component identity | `FootprintInstance.id` / schematic component instance ID. It persists across reannotation and is never derived from reference or array order. |
| Export reference identity | `FootprintInstance.ref`; display spelling retained. Canonical comparison is `trim().toUpperCase()`. Valid references are board-global, contain an annotation digit, and cannot be empty or contain `?`. |
| Stable net identity | Serialized `PcbNet.stableId`. Preserved by endpoint reconciliation, not by name or numeric ID. |
| Numeric net ID | `PcbNet.id`; derived local/serialization index. Persistent objects may still store it, but sync remaps it only through stable reconciliation. Net 0 remains reserved for unconnected. |
| Endpoint identity | URI-safe `stableComponentInstanceId::exactPinString`; pin strings are trimmed but case-sensitive and never coerced to numbers. Endpoint sets are deduplicated and sorted. |
| Pin-pad mapping | Persisted `ResolvedPinPadMapping[]` plus `footprintPadClassifications`. Every result records component ID, endpoint key, symbol pin string, zero/one/many pad numbers, kind, and provenance. |
| Lock boundary | `locked` on tracks, vias, and zones; command validation, direct gesture/route commands, autoroute, repair, and zone mutation guard it. `validateLockedCopperUnchanged()` is the exact candidate boundary. |
| Persistence | Additive `PcbBoard.identityVersion = 1`; stable IDs, endpoint keys, mapping metadata, classifications, and zone locks serialize with the existing board. `formatVersion` remains 1 for compatibility. |
| Diagnostics | Shared `EngineeringDiagnostic` with code, severity, summary, object/component/stable-net IDs, context, and suggested actions. Ordering is deterministic. |

Hierarchy is not currently a Sirkit PCB data-model feature. Export references are therefore explicitly board-global. Separate schematic instances cannot share a reference merely by pretending to be units; future hierarchy/multi-unit support must introduce an explicit shared stable component/unit model first.

## 3. Reconciliation behavior

| Change | Stable ID behavior | Copper and other numeric references | Sync result |
|---|---|---|---|
| No-op | Preserve the old stable ID. | Remain attached to that stable net; derived numeric IDs are remapped if necessary. | Success; repeated sync is idempotent. |
| Rename | Preserve when endpoint set is exact. | Preserve all physical ownership and remap only the derived numeric ID. | Success; report classifies `renamed`. |
| Add endpoint | Preserve the unique old net whose endpoint set is contained by the new set. | Existing copper remains on the preserved stable net; new pad assignment joins it. | Success when unique. |
| Remove endpoint | Preserve the unique old net represented by the remaining endpoints. | Existing copper stays on that stable net and is never reassigned to another net. | Success when unique; removed pad assignment disappears. |
| New net | Deterministic stable ID from canonical endpoint set; collision suffix is deterministic. | Receives no inherited copper. | Success. |
| Delete net | Retire stable ID if no persistent physical owner exists. | With tracks, vias, zones, planes, or route records: nothing changes. | Success without physical data; atomic `ROUTED_NET_DELETION_CONFLICT` otherwise. |
| Split net | Without physical data, the highest-overlap deterministic child retains the old ID; other children receive new IDs. | Physical data is never guessed between children. | Success without physical data; atomic `ROUTED_NET_SPLIT_CONFLICT` otherwise. |
| Merge nets | Without physical data, all old numeric IDs map to the merged net and the lexically deterministic old stable ID is retained. | Any affected physical owner blocks the merge rather than being silently combined. | Success without physical data; atomic `ROUTED_NET_MERGE_CONFLICT` otherwise. |

Candidate and current-board duplicate numeric IDs, duplicate stable IDs, and endpoint ownership collisions reject before reconciliation. Endpoint overlap uses indexed maps rather than an all-net-pairs scan.

## 4. Pin-pad behavior

| Case | Behavior |
|---|---|
| Exact one pin to one pad | Supported implicitly by exact trimmed, case-sensitive string identity. |
| Alphanumeric identifiers | Supported without numeric coercion; pin/pad order is irrelevant. |
| One pin to multiple pad numbers | Supported only by explicit trusted mapping. All pads receive the endpoint's net. |
| Duplicate physical pads with the same number | Supported as one logical terminal. DSN emits deterministic unique physical node IDs while retaining the source number. |
| Multiple symbol pins internally common to one pad | Supported only when all mappings explicitly say `internally-common` and resolve to the same net, or are all unconnected. |
| Exposed/thermal pad | Supported by explicit `exposed-pad` mapping. |
| Mechanical/non-electrical hole | Native non-plated holes are non-routing; electrical-looking extras require explicit `mechanical` classification. |
| Intentional physical no-connect | Supported explicitly; it must not participate in a routable net. |
| Intentional schematic-only/nonphysical pin | Supported explicitly only while unconnected. A connected instance rejects with `CONNECTED_NONPHYSICAL_PIN_UNSUPPORTED`. |
| Hidden power pin | Treated like any other exact symbol pin when present in the part's pin data; it cannot disappear implicitly. |
| Equal count but different identifiers | Rejected; count never proves compatibility. |
| Missing mapping, unknown override, unclassified extra pad | Rejected atomically with structured diagnostics. |
| Multiple incompatible nets claiming one pad | Rejected with `PAD_NET_CONFLICT`. |
| Cross-instance multi-unit/hierarchy | Not currently modeled; different stable component IDs with the same reference reject. |

## 5. Locked-copper mutation-path audit

| Path inspected | Enforcement |
|---|---|
| Inspector/property and AI JSON edit commands | Central validation rejects width, layer, movement, rotation, zone properties/net, deletion, via-padstack, and shared-padstack edits that would affect locked copper. Structured results retain protected object IDs. |
| Batch move/align/distribute/snap/delete | Entire command rejects when selection contains locked copper; no partial patch. |
| Interactive track stretch | Locked primary track cannot start; connected locked junction members block indirect movement; command mutation boundary rechecks. |
| Per-net rip-up | Command captures unlocked removals and locked protected objects separately; mutation deletes captured unlocked IDs only. |
| Autoroute candidate/import | Existing locked track/via objects survive exactly; imported ID collisions cannot overwrite them; inverse/undo preserves protection. |
| Smart-route history | Route history tied to protected segments is retained during partial rip-up. |
| Zone edit/delete | Shared edit validator and direct zone-command boundary both refuse locked zones. |
| PCB repair and AI/native repair | Preview and apply both compare every previously locked object byte-for-byte. Generated-copper selectors already exclude locked objects. |
| Undo/redo | Explicit unlock is one transaction; subsequent mutation is another. No-op/denied mutations create no history entry. |
| Schematic sync | Only identity-preserving derived numeric `netId` remap is allowed for locked copper. Geometry, dimensions, layer, existence, and stable electrical meaning remain unchanged. Ambiguous topology rejects. |

## 6. Files changed

### Production and migration

- `app/lib/pcb/types.ts` — adds stable net, mapping, identity-version, and zone-lock fields.
- `app/lib/pcb/integrity.ts` — shared diagnostics, endpoint/reference identity, deterministic legacy migration, and lock invariants.
- `app/lib/pcb/net-reconciliation.ts` — endpoint-indexed net reconciliation, conflict policy, and numeric remap table.
- `app/lib/pcb/pin-pad-mapping.ts` — explicit lossless mapping resolver and accounting.
- `app/lib/pcb/netlist-bridge.ts` — atomic validation/reconciliation sync and complete persistent-reference remap.
- `app/lib/pcb/board-persistence.ts` — project-aware board identity migration and load diagnostics.
- `lib/persistence.ts` — save/load/import migration and preservation of imported PCB data.
- `app/components/pcb/PcbEditor.tsx` — surfaces migration/sync diagnostics and commits successful sync only.
- `app/lib/pcb/ai/snapshot.ts` — includes new identity/mapping/reference/lock data in stale-candidate revision and AI snapshot.
- `app/lib/pcb/dsn/types.ts` — endpoint integrity manifest and unique/source pad identities.
- `app/lib/pcb/dsn/write-dsn.ts` — shared reference gate, endpoint manifest, and lossless duplicate-pad emission.
- `app/lib/pcb/dsn/preflight.ts` — independent reference, mapping, endpoint, pad, node, and stable-net checks.
- `app/lib/pcb/kicad/write-pcb.ts` — shared reference validation before KiCad PCB export.
- `app/lib/pcb/fab/emit-bom.ts` — shared reference validation before BOM export.
- `app/lib/pcb/fab/emit-position.ts` — shared reference validation before position export.
- `app/lib/pcb/fab/native/snapshot.ts` — reference diagnostics in native manufacturing readiness.
- `app/lib/pcb/edit/commands.ts` — explicit copper lock/unlock command.
- `app/lib/pcb/edit/describe.ts` — auditable lock/unlock labels.
- `app/lib/pcb/edit/validate.ts` — central lock guards and structured protected-object diagnostics.
- `app/lib/pcb/edit/apply.ts` — atomic structured edit validation and lock/unlock mutation.
- `app/lib/pcb/history.ts` — prevents false history entries for no-op mutations.
- `app/lib/pcb/route-tool.commands.ts` — protected stretch/rip-up/autoroute mutation and inversion.
- `app/lib/pcb/route-tool.ts` — interactive primary/junction lock guards and protected reporting.
- `app/components/pcb/hooks/useRouteTool.ts` — user-visible protected-object message.
- `app/lib/pcb/autoroute/command.ts` — captures removed versus protected copper.
- `app/lib/pcb/autoroute/verification.ts` — preserves locked candidate objects and blocks ID replacement.
- `app/lib/pcb/repair/transaction.ts` — exact locked-object verification before preview/apply.
- `app/lib/pcb/zones/command.ts` — direct locked-zone edit/delete guard.
- `app/lib/pcb/index.ts` — exports the Stage 1 identity/mapping/reconciliation APIs.

### Tests

- `app/lib/pcb/__tests__/netlist-bridge.test.ts` — C-01/C-02/C-04, rename/growth/shrink, routed conflicts, reannotation, idempotence, and history atomicity.
- `app/lib/pcb/__tests__/data-integrity.test.ts` — migration, round-trip persistence, reference policy, and stale-candidate hashing.
- `app/lib/pcb/__tests__/net-reconciliation.test.ts` — order permutations, unnamed-net insertion, unrouted topology policy, and corrupt identity rejection.
- `app/lib/pcb/__tests__/pin-pad-mapping.test.ts` — exact/alpha/order, one-to-many, duplicate pads, exposed/mechanical/no-connect, and ownership conflicts.
- `app/lib/pcb/__tests__/locked-copper-integrity.test.ts` — C-03 command/gesture/rip-up/autoroute/unlock/undo invariants.
- `app/lib/pcb/__tests__/dsn-integrity.test.ts` — endpoint manifest, missing mapping/node, duplicate references, and duplicate-pad DSN nodes.

### Documentation

- `SIRKIT_STAGE_01_DATA_INTEGRITY_IMPLEMENTATION.md` — this implementation/evidence report.
- `progress/2026-07-16/01-stage-01-data-integrity.md` — chronological project progress entry.

The pre-existing untracked `SIRKIT_PCB_PLACEMENT_ROUTING_AUDIT.md` was preserved and is not part of this implementation.

## 7. Test evidence

### Final verification

- `npx tsc --noEmit` — pass, exit 0.
- `npx vitest run app/lib/pcb/__tests__/net-reconciliation.test.ts app/lib/pcb/__tests__/pin-pad-mapping.test.ts app/lib/pcb/__tests__/dsn-integrity.test.ts app/lib/pcb/__tests__/locked-copper-integrity.test.ts app/lib/pcb/__tests__/netlist-bridge.test.ts app/lib/pcb/__tests__/data-integrity.test.ts app/lib/pcb/__tests__/write-dsn.test.ts app/lib/pcb/__tests__/route-tool.commands.test.ts app/lib/pcb/__tests__/edit-commands.test.ts app/lib/pcb/__tests__/pcb-repair-agent.test.ts app/lib/pcb/__tests__/autoroute-command.test.ts app/lib/pcb/__tests__/autoroute-verification.test.ts` — 12 files, 92/92 passed.
- `npm test` — 97 files passed, 2 files skipped; 582 tests passed, 9 skipped, 591 total. The skipped tests are pre-existing external/live integrations: PCB assist live (4), SPICE worker integration (3), and two KiCad CLI oracle cases; no Stage 1 test is skipped.
- `npm run test:netlist` — all standalone schematic/netlist validation checks passed.
- changed-file lint command (`git diff`/untracked TypeScript file list passed to `npx eslint`) — pass, exit 0.
- `npm run build` — optimized Next.js production build passed, exit 0; 41/41 static pages generated. Existing Turbopack warnings concern broad dynamic Java/NGSPICE executable tracing, not Stage 1 code.

### Additional slice verification

- Six-file Stage 1 core run — 42/42 passed while implementing the first complete slice.
- `npx vitest run app/lib/pcb/__tests__/net-reconciliation.test.ts` — 4/4 passed after indexed reconciliation/corruption guards.
- The production build was invoked once while a prior build was still finalizing and correctly reported the Next build lock; after that process completed, the clean final build above passed.

### Repository-wide lint baseline

`npm run lint` reports 46 pre-existing problems: 32 errors and 14 warnings in unchanged files such as `BomView.tsx`, `BuildLibraryPanel.tsx`, `CommandPalette.tsx`, `SilkTool.tsx`, `useLivePreview.ts`, inspector/padstack components, and `app/page.tsx`. They are React hook/ref rules unrelated to Stage 1. Every changed TypeScript/TSX file passes ESLint.

### Audited reproductions

- C-01: `netlist-bridge.test.ts` introduces alphabetically earlier net A and proves B/OUT stable identity plus track, via, zone, plane, route-history, rule-delta, and pad remaps. `net-reconciliation.test.ts` covers unnamed insertions and order permutations.
- C-02: `netlist-bridge.test.ts` and `pin-pad-mapping.test.ts` reject equal-count symbol pins `1,3` against footprint pads `1,2` without board mutation.
- C-03: `locked-copper-integrity.test.ts` proves bit-identical denied stretch, protected partial rip-up, atomic bulk rejection, edit guards, explicit unlock/undo, and malicious autoroute replacement defense.
- C-04: `netlist-bridge.test.ts` rejects duplicate canonical references atomically; `dsn-integrity.test.ts` independently blocks manually corrupted DSN input.

## 8. Migration and compatibility

- The board format version stays at 1. `identityVersion: 1` is an additive marker so existing fixtures and saved projects remain readable.
- Legacy numeric net-to-track/via/zone/pad/plane/history/rule associations are not changed during migration.
- Initial stable IDs are deterministic from project identity, legacy net ID/name, and known endpoint evidence. They are serialized on the next board save and do not regenerate after reopening.
- Connected legacy pad assignments become explicit `legacy-inferred` mappings. The next successful schematic sync replaces them with proven current mappings.
- Duplicate numeric/stable IDs, missing net 0, or references to unknown numeric nets return diagnostics and leave the original board untouched.
- Old TypeScript fixtures may omit the additive fields; runtime load/sync migration establishes them before identity-sensitive work.
- JSON project import now preserves and migrates PCB data; previously the import path discarded the PCB object.
- Existing valid boards continue to sync and export, as demonstrated by the complete repository suite and production build.

## 9. Remaining risks

- **Unsupported edge case:** hierarchical and cross-instance multi-unit PCB identity is not modeled today. Stage 1 deliberately enforces board-global unique references until a future schema can represent shared unit identity explicitly.
- **Unsupported workflow:** trusted non-exact pin-pad mappings can enter through library/part data, but there is not yet a dedicated user mapping editor. Sirkit rejects those assignments rather than guessing.
- **Legacy evidence limit:** a legacy board can only recover endpoint identity from the stable footprint instance ID and existing pad/net associations. If that historic data is already ambiguous or a routed net has no endpoint evidence, synchronization blocks for explicit repair.
- **Later-stage build issue:** existing Turbopack dynamic executable tracing warnings and repository-wide React lint debt remain outside this focused correctness stage.

No confirmed Stage 1 P0 defect remains after the final regression, full-suite, type, changed-file lint, and production-build passes.

STAGE 1 COMPLETE
