# B13.2 §A — the complete requested authority scope

## The contract

[component-authority-source.ts](../../app/lib/engineering/component-authority-source.ts)

```ts
export interface AuthorityComponentScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
  componentInstanceId: string;
  hierarchyPath: readonly string[];
  assemblyVariantId: string;
}
```

`AuthorityBindingSource.loadForComponent(scope, signal)` now takes ONE
complete scope. The component id is no longer a separate parameter, so the
identity the source QUERIES and the identity the loader COMPARES cannot
diverge — the structural cause of R1.

`LoadComponentAuthorityInput` gains `hierarchyPath?`. Hierarchy and variant
default to the ONE shared board identity (`PCB_BOARD_HIERARCHY_PATH`,
`PCB_BOARD_ASSEMBLY_VARIANT_ID`); a malformed requested hierarchy entry or
variant fails the load closed rather than silently degrading to the default.

## The scope comparison (every field, before any projection)

| field | rule | on mismatch |
| --- | --- | --- |
| tenantId | exact equality | load `unavailable` |
| projectId | exact equality | load `unavailable` |
| branchId | exact equality | load `unavailable` |
| boardInstanceId | exact equality | load `unavailable` |
| componentInstanceId | exact equality | load `unavailable` |
| hierarchyPath | exact element-wise equality (length + order) | load `unavailable` |
| assemblyVariantIds | universal (`[]`) OR contains the requested variant | load `unavailable` |
| every binding's owner scope | all seven fields equal to its SET's scope (variant list compared element-wise) | load `unavailable` |
| selected binding | must belong to that exact validated owner scope | not treated as selected |

## Variant applicability rule

An empty durable `assemblyVariantIds` means **universally applicable**. This
is not a new invention: it is the existing authoritative semantic of
`PostgresPhysicalBindingRepository.findForComponentVariant`
(`state.set.scope.assemblyVariantIds.length === 0 ||
state.set.scope.assemblyVariantIds.includes(scope.assemblyVariantId)`). Any
non-empty list must CONTAIN the requested variant. A list naming only other
variants (R3's `["variant-alt"]`) is not applicable and fails closed.

## Fail-closed, not relabel / not conflicted

A mismatched aggregate is untrusted SOURCE behaviour, not data to sift:

- it is never relabeled (the projected `componentId` now derives from the
  VALIDATED durable scope, `aggregate.set.scope.componentInstanceId`, only
  after equality with the request is proven);
- it is never projected;
- it is never folded into a `conflicted` record (which would expose the
  foreign aggregate's `setId` through `authorityRecordId`);
- the whole load returns `{ status: "unavailable", reason }` with a bounded,
  fixed reason string carrying NO durable identifier from the other scope
  (asserted in test 1).

Reasons used: `durable source returned an aggregate outside the requested
authority scope`, `durable aggregate carries a binding outside its owner
scope`, `durable source returned an oversized aggregate collection`,
`durable source returned a malformed aggregate`.

## Bounding order

`aggregates.length > MAX_AGGREGATES_PER_COMPONENT` is checked on the RAW
returned collection — before filtering, before scope comparison, before
validation (test 7). B13.1 bounded the collection only after filtering, so an
oversized raw return was partly processed first.

## Supersession note

This supersedes the B13 §"foreign aggregate is dropped" semantic recorded in
`artifacts/ai-control-plane-b13/` — dropping silently was weaker than failing
closed, and it only ever compared four of the seven scope fields. The B13
test `#9` is retained and STRENGTHENED (it now asserts the truthful
`unavailable` refusal rather than a silent empty load).
