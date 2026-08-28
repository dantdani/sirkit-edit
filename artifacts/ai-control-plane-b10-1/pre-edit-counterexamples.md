# B10.1 pre-edit counterexamples (R1–R5)

Captured with transient vitest files (deleted after capture) against the
unmodified B10 tree, plus the independent `npx tsc --noEmit` run.

## R1 — React Strict Mode disables the production bridge

The EXACT current PcbEditor pattern (one-way `bridgeAliveRef` + mount
cleanup + publish effect) mounted under `<StrictMode>`:

```
sequence: ["liveness-setup:true","publish-setup:true","liveness-cleanup:false",
           "publish-cleanup","liveness-setup:false","publish-setup:false"]
capture after StrictMode replay: NULL (bridge dead)
```

The replayed publisher registered with `isCurrent() === false` and was
rejected — development runs had NO PCB context. The existing B10 unit
tests instantiated the bridge directly and never mounted the React seam.

## R2 — the TypeScript gate was not clean

```
app/api/chat/__tests__/b10-chat-boundary.test.ts(16,33): error TS1354:
  'readonly' type modifier is only permitted on array and tuple literal types.
app/lib/agent/__tests__/b10-editor-context.test.ts(170,5): error TS2322:
  Type 'null' is not assignable to type 'PcbBoard'.
```

The B10 report's "tsc clean" claim was false (the check predated the test
files). Fixed: `ReadonlyArray<…>`; explicit `{ board: PcbBoard | null }`
fixture type.

## R3 — nested request claims were not closed

```
scope.actor/capabilities accepted: true
editorContext.scope extra key accepted: true
message extra authority key accepted: true
```

Authority-shaped fields nested inside `scope`, `editorContext.scope`, and
message objects were silently accepted and ignored.

## R4 — netlist validation proved nothing about the schematic

Verified schematic contains only `r1`; the submitted netlist contained only
`ghost`, carrying `pinPadMapping`/`atomicAssignment` metadata, with the
digest copied from the submitted schematic:

```
validator issues []
assembly accepted netlist true []
```

The validator saw neither schematic nor board and sealed the resource.

## R5 — the request limit was not a reading limit

A 12 MB hostile stream against the 8 MB limit (1 MB chunks, counting
pulls):

```
status: 413 chunks pulled: 13 (limit crossed at 9)
```

`req.arrayBuffer()` fully buffered the hostile body (all 12 chunks + the
close pull) before the 413.

All five are closed and permanently regression-tested in
`app/lib/agent/__tests__/b10-1-strict-mode-publisher.test.tsx` and
`app/api/chat/__tests__/b10-1-request-boundary.test.ts` (post-fix: the
same stream stops at 9 pulls).
