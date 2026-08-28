# Section A — truthful resource authority (no synthetic canonical state)

> **SUPERSESSION NOTE (B09.3).** The "narrow schematic-snapshot path" described below was FICTITIOUS: no `…schematic-snapshot-resource…` existed in READ_RESOURCE_KINDS, no envelope sealed it, and no activated binding consumed it — the gateway simply bypassed ReadToolInvocationService. B09.3 removed the bypass; boardless schematic inspection now refuses `authority_unavailable` and the registered B05/B05.1 canonical-state binding is the only path. The section-A no-synthetic-authority closure itself remains valid. See artifacts/ai-control-plane-b09-3/registered-resource-path-results.md.

## Defect

`assembleAgentRunContext` built `CanonicalProjectState` with
`board ?? createEmptyBoard()` — a missing or invalid board was silently
replaced by an empty PCB and the result carried a manufactured revision
digest that was then sealed as a verified/current canonical resource and
served to every canonical read (R1/R2).

## Production changes (`app/lib/agent/context.ts`)

- The `createEmptyBoard` substitution is REMOVED (import deleted).
- Canonical state is claimed only when EVERY constituent is supplied and
  validated: the board must be present and pass `validatePcbBoardStructure`
  (throw treated as invalid), and a SUPPLIED schematic must validate — a
  supplied-but-invalid schematic also blocks the canonical claim.
- Otherwise `context.canonicalState = null` and
  `context.canonicalRevisionDigest = null`, with explicit assembly warnings
  ("canonical authority withheld…", "no PCB board was supplied…").
- No digest is manufactured: `canonicalRevisionDigest` is computed ONLY from
  an actually-claimed canonical state; the discovery revision anchor falls
  back to the schematic digest, then `""` (which makes
  `requiresExpectedRevision` tools drop out of discovery naturally).
- `buildAgentResourceBundle(context)` throws `CANONICAL_RESOURCE_UNAVAILABLE`
  when canonical state is null — a resource bundle over a substitute can no
  longer exist. Envelope sealing emits `sourceCanonicalRevision` only when a
  real revision exists.

## Schematic continuity without canonical authority

`sirkit.schematic.inspect` remains available through a NARROW gateway path
(`invokeSchematicSnapshot` in `app/lib/agent/gateway.ts`) backed by the
versioned resource `sirkit.schematic-snapshot-resource.v1`:

- digest-pinned to `context.schematicDigest`;
- verification string `schematic-snapshot-verified` (never
  `canonical-revision-verified`);
- carries the same discovery/role/capability/argument checks as the read
  service;
- never constructs or implies a `CanonicalProjectState`.

Every OTHER read without canonical authority refuses with
`authority_unavailable`.

## Toolset consequences (`app/lib/agent/loop.ts`)

`buildRunToolset` filters on resource satisfaction deterministically: without
canonical state, only `sirkit.schematic.propose-tier1-edit` (still gated on a
head mark) and `sirkit.schematic.inspect` (still gated on a supplied
schematic) remain; each exclusion emits a warning naming the tool and the
missing resource. The STATIC agent-exposed registry is unchanged — exactly
eight tools.

## Tests (`b09-2-closure.test.ts` §A)

1. Missing board and invalid board each yield null canonical state/digest,
   warnings, and a throwing `buildAgentResourceBundle` (R1).
2. `canonical-revision-inspect`, `pcb.board-inspect`, `pcb.revision-inspect`,
   and `validation.drc-run` all refuse without canonical authority (R2).
3. The snapshot path serves schematic inspection with
   `schematic-snapshot-verified` pinned to the schematic digest; a complete
   valid board restores the full canonical path with zero warnings —
   warnings and canonical success are mutually exclusive.
4. Toolset filtering is deterministic across rebuilds; the static exposed
   registry is exactly eight distinct ids.
