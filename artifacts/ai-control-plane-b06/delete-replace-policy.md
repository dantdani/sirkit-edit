# B06 — Delete and Replacement Policy

## Delete contract

Deletion is deterministic, atomic, pre-planned, and exactly invertible.

**Impact plan** (`planSchematicDelete`, pure — catalog pin data is supplied,
never fetched): identifies the component, its pin world-coordinates, the
incident wires and labels that will be removed, the removed label names, and
the downstream effects (physical binding, pcb-sync, BOM/SPICE, readiness).
For kicad targets, missing pin data is a structured refusal
(`pins-unavailable`) — a delete without a computable plan never executes.

**Incident-connectivity policy** (the audited tier-1 semantics, applied
uniformly to every migrated path — canvas tool, keyboard, panels, AI apply):

- A wire is removed iff its FIRST or LAST vertex sits exactly on a deleted
  pin coordinate. Interior vertices never match → **no accidental removal of
  unrelated or passing-through segments**.
- A net label is removed iff it sits exactly on a deleted pin coordinate.
  Same-name labels elsewhere keep their nets alive → **no hidden net
  merging**.
- Orphan cleanup is exactly the listed entities → **no silent retention of
  dangling references** (the pre-B06 panel deletes left dangling wires; that
  defect is closed).

**Guarantees** (tested): graph integrity after execution; one user action =
one transaction = one revision = one history entry; exact undo restoring the
component and all incident graph state **at their original array indices**
(digest-identical restore); exact redo via the durable record's forward
operations; any failure (validation, authorization, stale revision,
persistence) leaves the canonical state byte-identical.

## Replacement contract

Replacement is ONE atomic semantic operation (`schematic_replace_component`),
never a delete followed by an independently visible add.

**Distinguished modes**: `value-only` (same authoritative part),
`pin-identical-substitution`, `mapped-substitution` (explicit pin
renumbering). Footprint/physical-binding change travels as authority-field
replacement inside the same operation.

**Fail-closed rules** — replacement REFUSES (structured refusal naming the
pins needing a decision) when:

- the component or exact target identity cannot be resolved
  (`component-not-found`; targets are exact `partId`s with supplied pin data);
- a connected pin has no identity-equal pin (same number AND same trimmed
  name) on the replacement and no explicit mapping was given
  (`explicit-pin-mapping-required`);
- an explicit mapping references nonexistent pins or is not one-to-one
  (`invalid-pin-mapping`);
- a connected pin would silently lose its connection
  (`unacknowledged-dropped-connections` — the caller must explicitly
  acknowledge each dropped pin);
- the supplied authority is anything other than an explicit
  `catalog-unverified` marker or a `VerifiedReplacementAuthority` instance
  minted by the internal B05.1 bundle adapter (`ambiguous-authority`) —
  B06.1: a plain caller-supplied status/identifier object is NEVER authority;
- a net label sits on stacked pins mapping to different positions
  (`ambiguous-label-move`, B06.1).

**Never evidence of compatibility**: natural-language names, display labels,
matching pin counts, similar descriptions, provider-generated text,
unverified resource envelopes. (Pin-count-only compatibility is explicitly
tested to refuse.)

**Plan contents**: source/target part identity, authority/provenance status
(`verified-atomic` / `catalog-unverified` / `authority-cleared`), the full
old→new pin mapping, preserved connections, dropped connections (all
explicitly acknowledged), wire endpoint moves, net-label moves (B06.1:
position-preconditioned, exactly inverted; a label-only connection is
preserved ONLY via its move, and acknowledged drops that strand a label are
surfaced), consumed authority resources (B06.1), warnings, downstream
invalidations.

**Authority rules (B05.1 preserved)**: digests prove envelope integrity, not
real-world authority. The operation replaces `partId` and ALL five authority
fields **together**: a `catalog-unverified` or authority-less replacement
CLEARS stale atomic authority (with a surfaced warning) — the legacy swap
defect that retained `atomicPartRevisionId`/symbol/footprint/mapping ids
across a partId change is structurally impossible. Candidate, stale,
unverified, or caller-minted identities are never promoted to authoritative;
`expectedCurrentPartId` is a hard precondition; durable publication continues
to fail closed until atomic authority is re-bound through the approved
adapters.

**Downstream** (explicit in every plan and tested at the kernel):
`electrical_truth`, `drc`, `route_measurements`, `readiness`,
`manufacturing_preflight`, `ai_snapshot` invalidate; schematic parity and the
pcb-sync dirty flag flip (existing sync plans fail closed at preflight); BOM
regroups under the new identity; SPICE captures a new design revision on next
run; physical-binding qualification must be re-established for the new
identity.

**Exact inverse**: replace-back with the ORIGINAL identity and authority
fields (all together) plus reversed wire-endpoint moves — tested to be
digest-identical round-trip.
