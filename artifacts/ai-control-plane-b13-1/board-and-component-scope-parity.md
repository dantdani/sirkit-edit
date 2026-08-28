# B13.1 §B — board and component scope parity

## The defect (R3)

The physical-binding WRITE path (PcbEditor `syncIdentity` →
`bind_atomic_selection`) used `board:${projectId}`; the B13 chat READ path
queried `${projectId}:${branchId}`. Two different formulas — a binding
written in production could NEVER be found by the chat authority loader.

## The rule (one formula, one module)

[app/lib/pcb/board-identity.ts](../../app/lib/pcb/board-identity.ts):

```ts
pcbBoardInstanceId(projectId)          → `board:${projectId}`
PCB_BOARD_HIERARCHY_PATH               → ["root"]
PCB_BOARD_ASSEMBLY_VARIANT_ID          → "variant-default"
```

- **Writer**: PcbEditor's `syncIdentity` now calls `pcbBoardInstanceId` and
  `PCB_BOARD_ASSEMBLY_VARIANT_ID` (its private template literals removed).
- **Reader**: the /api/chat authority load scope uses
  `pcbBoardInstanceId(requestScope.projectId)`; the production adapter
  queries with `PCB_BOARD_HIERARCHY_PATH` and the caller's variant
  (defaulting to `PCB_BOARD_ASSEMBLY_VARIANT_ID` in the loader).
- The hierarchy/variant defaults are EXACTLY the physical-binding creator's
  (`bindAtomicSelection`: `hierarchyPath ?? ["root"]`,
  `assemblyVariantIds ?? ["variant-default"]`) — no guessing, no broadened
  scope.

## Proof

- §B test 3: the shared formula equals the writer formula.
- §B test 3b (source gates): PcbEditor uses `pcbBoardInstanceId(...)` and
  no longer contains the private literal; the route uses the shared helper
  and no longer contains the old two-part formula.
- §B tests 4/5: hierarchy and variant constants equal the physical-binding
  creator defaults (checked against the binding fixture scope).
- Parity end-to-end: a binding aggregate produced through the REAL
  `PhysicalBindingService` (create→select→revalidate→approve) is loaded,
  validated, and projected by the REAL authority loader into a
  `verified-exact` record (§D test 18) — the same service the production
  write path drives.
