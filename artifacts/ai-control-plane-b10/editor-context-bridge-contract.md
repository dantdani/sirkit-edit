# B10 — editor-context bridge contract

Module: `app/lib/agent/editor-context-bridge.ts` (`EditorContextBridge`,
schema `sirkit.editor-context.v1`). Independently tested in
`b10-editor-context.test.ts` §A.

## Ownership

- **Producer**: `PcbEditor` ONLY. It registers a pull publisher whose
  `read()` returns the live refs: `boardRef` (mirrors `state.board`), the
  live `selectionStore` set, the live netlist ref, and the schematic digest
  of its current schematic prop. The read source is the WORKING COPY — the
  publisher block contains no `authorityRef` read, no localStorage/
  IndexedDB/durable-cache reconstruction, no API refetch (source-gated by
  test).
- **Consumer**: `app/page.tsx`. One bridge per page; `send()` captures one
  atomic snapshot per chat request for the exact request scope.

## Generations and invalidation

- `beginProject(scope)` is called at the SAME site as the
  `ProjectAsyncScopeRegistry` generation begin (project hydration): it
  advances the bridge generation and retires any registered publisher —
  project A's context can never appear in project B.
- `publish()` refuses: no active generation; scope mismatch (a late
  publication from a retired/foreign editor); a publisher whose lifecycle
  is already retired (`isCurrent() === false`).
- `capture(expected)` returns null (unavailable) when: no publisher; the
  publisher's generation is stale; the expected scope mismatches the
  generation scope or the publisher scope (branch mismatch included); the
  publisher's lifecycle has retired since publishing (unmount); or the
  editor currently has no board.
- `PcbEditor` retires its publication in the effect cleanup (unmount /
  dependency change); its `isCurrent` is the component-alive flag, and the
  project-keyed remount ties publisher lifetime to project identity.
- Demo mode (`?pcbdemo=`) NEVER publishes — a demo fixture is not the
  current durable project board, so demo chat PCB tools stay truthfully
  unavailable.

## Atomicity and immutability

One `capture()` performs one synchronous `read()` and returns a single
deep-frozen `structuredClone` snapshot: scope, board, client
`pcbRevisionId` (server-verifiable hint), selection refs + primary,
optional netlist, schematic digest, and `authoritySource:
"local-working-copy"`. Later editor mutations cannot alter a captured
request; external aliases cannot mutate the captured snapshot (frozen at
every level — proven by test). Unsaved edits made BETWEEN captures are
visible in the next capture (working-copy truth).
