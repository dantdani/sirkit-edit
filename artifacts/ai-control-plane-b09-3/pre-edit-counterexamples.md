# B09.3 pre-edit counterexamples (R1–R4)

All four were reproduced with a transient script (`scripts/_tmp-b093-repro.ts`,
deleted after capture) against the unmodified B09.2 tree, before any B09.3
edit. Exact captured output below; each is now closed and encoded as a
permanent regression in `app/lib/agent/__tests__/b09-3-closure.test.ts`.

## R1 — lineage divergence undetected

A valid agent context was assembled (valid board + schematic + head mark
`lin1-1234567890abcdef`), then ONLY `discovery.lineageId` was changed to the
foreign well-formed lineage `lin1-ffffffffffffffff`:

```
verifyAgentContextIntegrity issues: []
gateway read with foreign discovery lineage: read ok: true
```

The integrity boundary ignored lineage entirely, and a canonical read
succeeded despite the divergence.

Closure: discovery lineage now derives from the VALIDATED head mark;
`verifyAgentContextIntegrity` revalidates the stored mark and rejects any
lineage disagreement; every gateway path refuses `context_integrity`.

## R2 — semantically invalid provider schemas accepted

`toStrictSchema` accepted ALL eight semantically invalid schemas:

```
ACCEPTED: root {type:string} -> {"type":"string"}
ACCEPTED: string with properties -> {"type":"string","properties":{"x":{"type":"string"}}}
ACCEPTED: object with numeric description -> {"type":"object","properties":{},"description":42,...}
ACCEPTED: object with object title -> {"type":"object","properties":{},"title":{"x":1},...}
ACCEPTED: {type:string, enum:[1]} -> {"type":"string","enum":[1]}
ACCEPTED: string carrying items -> {"type":"string","items":{"type":"string"}}
ACCEPTED: empty unconstrained {} -> {}
ACCEPTED: multi non-null type array -> {"type":["string","number"]}
```

Closure: context-aware semantic validation (section C) — every case above
now throws `STRICT_SCHEMA_UNSUPPORTED`, plus the extended hostile set
(NaN/Infinity, cross-type keywords, tuple items, enum+const, anyOf-sibling
combinations, annotation-only schemas).

## R3 — fictitious schematic-snapshot resource

```
READ_RESOURCE_KINDS: ["canonical-state","selection-snapshot","component-authority-records",
                      "drc-rules","fab-preset","drc-preset","netlist"]
includes snapshot kind: false
gateway.ts mentions of sirkit.schematic-snapshot-resource.v1 (comments only): 2
resource-envelopes mentions snapshot resource: false
boardless schematic.inspect via gateway: read ok: true verification: schematic-snapshot-verified
```

`sirkit.schematic-snapshot-resource.v1` existed ONLY in gateway comments and
verification wording: it was absent from `READ_RESOURCE_KINDS`, no envelope
ever sealed it, and the activated `read.schematic-snapshot` binding declares
`requiredResources: ["canonical-state"]`
([tool-bindings-readonly.ts](../../app/lib/engineering/tool-bindings-readonly.ts),
verified by direct source inspection) — yet the gateway served boardless
schematic inspection through a special branch (`invokeSchematicSnapshot`)
that bypassed `ReadToolInvocationService` entirely, and the catalog kept
`sirkit.schematic.inspect` registered as a canonical-state read.

Closure: the bypass and every mention of the fictitious resource are
removed; boardless schematic inspection refuses `authority_unavailable`;
the registered canonical-state binding is the only path.

## R4 — catalog and artifact drift

```
catalog 'Missing capabilities (pcb.dimension)': true
catalog 'create_via/update_via': true
catalog schematic.inspect binding note claims canonical-state envelope: true   (contradicted by the gateway bypass)
generator unconditional 'run-context resources assemblable': true
browser /api/chat request sends boardState: false
committed manifest claims assemblable: true
```

The committed catalog still claimed pcb.dimension "missing" (implemented
since B08) and used `create_via` instead of the canonical `add_via`
vocabulary; the generated manifests claimed "run-context resources
assemblable" for every read even though the browser chat request
(`app/page.tsx` `/api/chat` body) sends NO `boardState`, so canonical reads
are never actually assemblable pre-B10.

Closure: catalog corrections, manifest v2 with per-run availability truth,
and CI tripwires on all four stale phrases (section D).
