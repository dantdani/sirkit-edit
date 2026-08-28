# B10.1 §D — authority-neutral netlist contract

> **SUPERSESSION NOTE (B10.2).** The validation described below was still
> ELEVATABLE: an internally consistent projection (including an EMPTY one)
> passed and sealed as a verified authoritative-netlist parity PASS,
> invented theory pins validated, and simulation-only components entered
> the physical set. B10.2 adds server-side DERIVATION PROOF
> (`proveAgentNetlist` re-derives through the shared production
> `buildNetlist`/`theoryPinContract` authority; exact agreement required;
> the SERVER-owned recomputation is what seals; KiCad-bearing schematics
> withhold explicitly). See
> artifacts/ai-control-plane-b10-2/server-proven-netlist-contract.md.
> Historical evidence below is preserved.

## Defect (R4)

`validateAgentNetlist` validated only internal netlist references — it
received no schematic. A netlist containing only a `ghost` component
(absent from the verified schematic), carrying `pinPadMapping` and
`atomicAssignment` authority metadata, sealed with zero issues.

## The contract (`sirkit.agent-netlist-projection.v1`)

Module: `app/lib/agent/netlist-validation.ts`.

**Transport projection** (`projectAgentNetlist`, applied by the bridge at
capture — the full browser `PcbNetlist` is never transported):

- Component: stable `id`, display `ref`, `pins` = `{number, name?}` only.
- Net: `id`, `name`, `nodes` = `{componentId, pinNumber}` pairs,
  canonical `endpointKeys`.
- Excluded by construction: `atomicAssignment`, `atomicPartRevisionId`,
  `pinPadMapping`, `mpn`/`value`/`package`, `footprintHint` — proven
  absent from the projected JSON by test.

**Server validation** (`validateAgentNetlistProjection(raw, schematic)`)
receives the VERIFIED schematic and enforces:

- Exact keys at EVERY level (top: schema/components/nets; component:
  id/ref/pins; pin: number(+name); node: componentId/pinNumber; net:
  id/name/nodes/endpointKeys). Unknown keys refuse; authority-shaped keys
  (`pinPadMapping`, `atomicAssignment`, `atomicPartRevisionId`,
  `footprintHint`, `mpn`, `package`, `value`, approval/verification/
  certificate/candidates/authority/release) refuse BY NAME.
- Every component belongs to the schematic's physical component set
  (theory components + placed KiCad components) and its display reference
  agrees with the schematic's (`schDisplayRef` / `refDes`). Pin identities
  beyond internal consistency are not provable server-side (the schematic
  carries no catalog pin data) — documented, not fabricated.
- Every node references a declared component AND its declared pin.
- `endpointKeys` agree EXACTLY with the canonical
  `schematicEndpointKey(componentId, pinNumber)` set derived from the
  net's nodes (sorted, as `buildNetlist` emits them).
- No endpoint appears in multiple nets; no duplicate component, pin,
  node/endpoint, or net identity.
- All strings/numbers/arrays bounded (existing budgets preserved).

**Deliberately NOT validated**: board/netlist agreement — readiness must
still diagnose a stale board; that disagreement is a readiness RESULT
(`SCHEMATIC_PARITY` divergence), never a malformed-resource refusal
(proven by test: a valid projection seals against a board without
matching footprints).

## Resource semantics (unchanged posture)

Local-working-copy only; optional (failure withholds ONLY the netlist and
readiness reports `SCHEMATIC_PARITY_NOT_EVALUATED`); accepted only with
proven schematic-digest agreement; sealed pinned to the verified schematic
digest and consumed under the canonical revision; digest schema
`sirkit.agent-netlist-projection.v1` participates in
`verifyAgentContextIntegrity`. Never component authority, never
manufacturing release authority — no manufacturing gate was weakened
(readiness consumes the logical subset through the unchanged binding).

## Tests (`b10-1-request-boundary.test.ts` §D — all pass)

Ghost component refuses; wrong display reference refuses; duplicate
endpoint across nets refuses; endpointKeys/nodes disagreement refuses;
duplicate net identity refuses; `pinPadMapping`/`atomicAssignment` refuse
by name; the projection strips every authority field and the SAME
projection passes server validation and seals; board/netlist disagreement
still seals (readiness diagnosis).
