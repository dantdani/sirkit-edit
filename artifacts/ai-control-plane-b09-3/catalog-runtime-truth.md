# Section D — catalog and generated runtime truth

## Defect (R4)

The committed catalog and generated manifests described a runtime that does
not exist pre-B10: a "Missing capabilities (pcb.dimension)" header claim
(dimension is implemented and active since B08), `create_via` operation
wording (the canonical vocabulary is `add_via`/`update_via`/`remove_via`),
a schematic-inspection note contradicted by the (now removed) gateway
bypass, and an unconditional "run-context resources assemblable" claim for
every read — even though the browser `/api/chat` request supplies NO
authoritative PCB board, so canonical-state reads are never assemblable in
real pre-B10 runs.

## Catalog corrections (`app/lib/engineering/tool-catalog.ts`)

1. Header: the pcb.dimension-"missing" claim replaced with the truthful
   statement (non-callable registration marks missing TOOL ADAPTERS;
   dimension itself is implemented and active since B08).
2. Via descriptor description: `add_via/update_via/remove_via` — canonical
   operation vocabulary. The public tool ID `sirkit.pcb.create-via` is
   deliberately UNCHANGED (this is a vocabulary correction, not a tool-ID
   migration).
3. `sirkit.schematic.inspect` binding notes + versionNotes: describe the
   registered B05/B05.1 canonical-state path as the ONLY path; record the
   removal of the B09.2 bypass.
4. All six read versionNotes and seven `agentExposed` comments no longer
   claim "assemblable"; they state the per-run canonical-state requirement
   and the pre-B10 browser withholding.

## Generator (`scripts/generate-agent-artifacts.ts`) — manifest v2

`sirkit.agent-exposed-tool-manifest.v2` distinguishes, per tool:

- `statically_exposed` — registry exposure (the exact-eight static set);
- `binding_resolved` — the B05 binding resolves (reads) / bound-proposal;
- `required_runtime_resources` — from the ACTIVATED binding's declared
  `requiredResources` (reads) or `validated-schematic;canonical-head-mark`
  (proposal);
- `pre_b10_browser_availability` — the ACTUAL pre-B10 runtime result:
  `withheld` for every canonical read (the browser chat request supplies no
  board), `conditional` for the proposal, `not-exposed` otherwise;
- `reason` — the conditional reason when unavailable.

Recorded pre-B10 runtime truth: all canonical read tools withheld without a
validated board; the proposal tool available only with a validated
schematic + canonical head mark; otherwise a ZERO-TOOL conversational run.

## CI gates (`b09-3-closure.test.ts` §D — all pass)

- **Stale-phrase tripwires** over production sources and the generated B09
  manifests: `Missing capabilities (pcb.dimension)`, `create_via`,
  `run-context resources assemblable`, the fictitious snapshot-resource
  name. (Historical artifact documents in b09-1/b09-2/b09-3 that RECORD the
  old defects are deliberately outside the tripwire scope.)
- **Pre-B10 runtime-availability gate**: manifest v2 schema asserted; every
  exposed read `withheld` with `canonical-state` in its required resources
  and a resolved binding; the proposal `conditional`; and the manifest
  truth cross-checked against ACTUAL `buildRunToolset` behavior for the
  exact browser request shape (schematic + mark, no board → proposal only;
  no mark → zero tools).
- **sourceEvidence existence gate** preserved and green (27/27 descriptors).

## Regeneration

All four generators re-run byte-stably after the catalog/registry changes
(new registry digest `eng1-9fc75afe389b1f49`): B04 registry artifacts, B05
read-invocation replays, B09 manifests/parity/replay pins, B06 schematic
fixtures. Byte-match suites pass.
