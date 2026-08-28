# Section B — the registered resource path is the only read path

## Defect (R3)

B09.2 introduced a gateway-level `invokeSchematicSnapshot` branch that
served boardless schematic inspection over a claimed
"…schematic-snapshot-resource…" — a resource that did not exist anywhere in
the resource architecture: not in `READ_RESOURCE_KINDS`, never sealed by
any envelope, consumed by no activated binding. The catalog kept
`sirkit.schematic.inspect` registered as a canonical-state read while the
gateway bypassed `ReadToolInvocationService` for it.

## Production changes (minimal fail-closed solution)

- `invokeSchematicSnapshot` and its gateway branch are DELETED, along with
  every mention of the fictitious resource (gateway comments included).
  Unused imports (`inspectSchematicState`, argument-validation helpers)
  removed.
- Without a complete validated canonical project resource, EVERY read —
  `sirkit.schematic.inspect` included — refuses with structured
  `authority_unavailable` at the gateway, and `buildRunToolset` withholds
  every read from the model (per-tool warning emitted).
- The sealed proposal tool remains available only when the schematic is
  validated, the canonical head mark is validated (discovery
  `lineage_required` gate + head-mark toolset filter), and scope, lineage,
  actor, and capability integrity all pass.
- Ordinary provider conversation continues with ZERO tools when no
  prerequisite holds — no resource is fabricated to preserve tool count.
- `sirkit.schematic.inspect` stays bound to the existing B05/B05.1
  canonical-state read binding (`read.schematic-snapshot` binding id,
  `requiredResources: ["canonical-state"]`). B10 restores its real live
  availability by delivering authoritative board context.

## Test results (`b09-3-closure.test.ts` §B — all pass)

| Case | Result |
| --- | --- |
| Boardless toolset, schematic + head mark present | exactly `[sirkit.schematic.propose-tier1-edit]` |
| Boardless toolset, proposal prerequisites absent (no mark; no schematic) | zero tools |
| Boardless `schematic.inspect` via gateway (R3) | `refused` / `authority_unavailable` |
| Production-source scan (`app/`, `scripts/`, tests excluded) | zero mentions of the fictitious snapshot resource |
| Complete valid canonical context | schematic inspection served through `ReadToolInvocationService`, verification is the read-service value (never "snapshot"), source revision = canonical revision digest |
| Static exposed registry | exactly eight distinct tool ids |
