# B10 — resource validation and provenance

> **CORRECTION NOTE (B10.1).** The netlist validation described below was
> INTERNAL-ONLY — it received no schematic, so a ghost-component netlist
> with authority-bearing fields (pinPadMapping, atomicAssignment) sealed.
> B10.1 replaced it with the authority-neutral projection
> `sirkit.agent-netlist-projection.v1` validated AGAINST the verified
> schematic. See artifacts/ai-control-plane-b10-1/authority-neutral-netlist-contract.md.

## Selection (selection-snapshot resource + sirkit.selection.inspect)

Sealing (`app/lib/agent/context.ts` `verifyCapturedSelection`):

- Claimed ONLY alongside a validated canonical board.
- Exact shape (`{refs, primary?}`), structurally valid `SelectionRef`s.
- Oversized (> `MAX_SELECTION_REFS` = 2000) → REJECTED (resource withheld
  with a warning) — never silently truncated.
- Deterministic dedupe by `refKey` (insertion order).
- Dead refs REMOVED: only refs resolving on the exact captured board (via
  the same `getItems` helper the tool uses) survive; the primary survives
  only while live.
- Sealed as the `selection-snapshot` envelope with `sourceVersion` = the
  SERVER-computed canonical revision (pinned).

Tool activation:

- Descriptor `sirkit.selection.inspect` bumped to 1.1.0,
  `agentExposed: true` (static set = NINE), EMPTY strict input schema
  (`maxItems` removed — outside the proven wire subset; the tool inspects
  the sealed CURRENT selection, never model-invented refs); binding
  `read.selection` bumped to 1.2.0. Model-supplied `refs` arguments refuse
  `invalid_input` under the strict schema.
- Advertised only when the selection-snapshot resource sealed; a missing
  selection withholds ONLY this tool. An empty-but-valid current selection
  returns a truthful empty result.

## Netlist (optional resource)

Validation (`app/lib/agent/netlist-validation.ts` `validateAgentNetlist`):
exact top-level keys; unique component identities; unique per-component pin
numbers; net nodes referencing declared components AND declared pins;
unique safe-integer net ids; endpointKeys string arrays; finite bounded
JSON everywhere (depth/size/node budgets). Acceptance additionally requires
schematic-digest agreement: the editor context's captured
`schematicDigest` must equal this run's verified schematic digest (atomic
capture proven). On any failure the netlist ALONE is withheld — never
fabricated, never replaced by a previous sync snapshot — and
`manufacturing.readiness-inspect` still executes, with
`buildSchematicParityCertificate` reporting `SCHEMATIC_PARITY_NOT_EVALUATED`
(proven by test). A valid netlist is sealed with `sourceVersion` = the
schematic digest and appears in the readiness output's `pinned.netlist`
consumed-resource ref (exact provenance).

## Resource-aware discovery + integrity

- `availableResourceKinds(context)` derives the kinds the run's bundle can
  supply (canonical-state + presets when the board validated; selection /
  netlist when sealed). `buildRunToolset` advertises a read ONLY when its
  resolved activated binding's `requiredResources` ⊆ available (optional
  resources stay optional); the read service rechecks the same set at
  invocation (`missing_resource`).
- `verifyAgentContextIntegrity` now RECOMPUTES: the canonical revision from
  the stored canonical state, the schematic digest, the selection digest,
  and the netlist digest against their assembly-time pins — post-assembly
  mutation, resource substitution, or claimed-digest-without-resource fails
  `context_integrity` before any invocation (reads, proposals, direct).
