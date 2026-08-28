# B06.1 — Replacement Authority Consumption Contract

> **Hardened by B06.2** (`artifacts/ai-control-plane-b06-2/executor-authority-gate.md`):
> the enforcement described here was PLANNER-ONLY — a caller submitting a raw
> `schematic_replace_component` operation could still install atomic fields.
> The invariant is now enforced at the canonical executor via registered
> runtime grants (scope/revision/component/part/field/resource-matched,
> single-use); serialized operation data can never manufacture authority.

Closes the B06 gap where `planSchematicReplacement` accepted a caller-supplied
object with `status: "verified-atomic"` and identifier strings.

## The rule

`verified-atomic` replacement authority exists ONLY as a
`VerifiedReplacementAuthority` instance — a branded class with a private
constructor, minted exclusively by `consumeReplacementAuthority()` in
`app/lib/engineering/schematic-authority.internal.ts`. The planner accepts:

- `{ status: "catalog-unverified" }` — the explicit catalog-swap marker.
  Catalog-unverified replacement **clears** stale atomic authority (all five
  fields replaced together with the partId; a surfaced warning names the
  cleared authority). Durable publication continues to fail closed until
  atomic authority is re-bound.
- a `VerifiedReplacementAuthority` instance (checked by `instanceof`
  identity), and only for the exact `(componentId, targetPartId)` pair it was
  minted for.

Everything else — a plain object claiming `verified-atomic`, a
`catalog-unverified` marker carrying atomic identifier fields, a
JSON-round-tripped or spread-cloned copy of a real instance — is refused with
`ambiguous-authority`. `toJSON` yields an inert marker so the capability
never round-trips through persistence, traces, or tool output.

## Consumption validations (fail-closed, in order)

`consumeReplacementAuthority({ bundle, scope, expectedCanonicalRevision,
componentId, targetPartId, target })`:

1. **Bundle integrity** — full B05.1 `validateReadResourceBundle`: envelope
   schema/structure, every content digest, manifest digest, unique ids,
   dependency digests, scope (foreign → `wrong_scope`), producer freshness
   (stale → `stale_or_unavailable`).
2. **Revision pinning** — the bundle's canonical revision must equal the
   schematic head the replacement is planned against (`wrong_revision`).
3. **Authority envelope** — a `component-authority-records` resource must be
   present (`missing_authority_record`), producer-verified (`not_verified`),
   and current (`stale_or_unavailable`).
4. **B05.1 inspection** — `inspectComponentAuthority` must classify the
   component `verified-exact`. Candidate-only, unresolved, stale, and
   conflicting records refuse (`not_verified` / `stale_or_unavailable`);
   conflicting records are never merged.
5. **Target part** — the requested part must be the verified selection's MPN
   or a recorded permitted alternative (`wrong_part`). Display text and
   candidates are never evidence.
6. **Atomic identity** — `atomicPartRevisionId` is required
   (`incomplete_identity`) and must match the recorded authority revision
   (`wrong_revision`).

## Provenance

The minted authority records the exact consumed resources
(`{resourceId, contentDigest}` for the canonical-state and
component-authority envelopes). They appear in:

- the replacement **plan** (`consumedAuthorityResources`), and
- the **operation** (`schematic_replace_component.consumedAuthorityResources`),
  which lands verbatim in the durable transaction record — auditable replay
  provenance (tested end-to-end in §2.15).

## Boundary

The module is NOT exported from the engineering barrel. A repo scan test
fails if any production file outside the approved set
(`schematic-plans.ts` — the enforcement point — and
`schematic-replay-evidence.ts` — the fixture builder) imports it.

## Production status

No production UI flow performs verified-atomic replacement today: the BOM
swap is explicitly `catalog-unverified`, and no verified-authority adapter is
wired into the page. Verified replacement therefore remains UNAVAILABLE from
the UI rather than accepting any caller assertion — the adapter and its
tests define the only path a future flow may use.
