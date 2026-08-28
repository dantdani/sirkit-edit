# B10.1 §A — Strict-Mode-safe production publisher

## Ownership after the fix

Module: `app/lib/agent/use-editor-context-publisher.ts`
(`useEditorContextPublisher`) — the extracted PRODUCTION seam PcbEditor
mounts (no logic duplicated in tests).

- **Effect-local liveness**: `let effectLive = true` is created on EVERY
  effect setup and set false only by THAT setup's cleanup. A StrictMode
  setup→cleanup→setup replay therefore registers a fully live publisher
  (the old one-way `bridgeAliveRef` is deleted).
- **Lifecycle scope at registration**: each registration captures a real
  `PcbBoardLifecycleScope` (`pcbLifecycle.capture()`); the publisher's
  `isCurrent = () => effectLive && lifecycleScope.isCurrent()`.
- **Re-registration on adoption**: `lifecycleGeneration` (advanced by
  PcbEditor's `adoptBoardLifecycle`) is an effect dependency — every board
  lifecycle adoption retires the old publication and registers a fresh one
  for the replacement board.
- **Fail closed between retirement and replacement**: `adopt()` advances
  the owner generation SYNCHRONOUSLY, so the captured scope goes stale
  before the replacement board is even dispatched; captures in that window
  return unavailable.
- **Hidden tab keeps publishing**: `active` is not an input — display
  state is never board authority.
- **Real unmount retires**; project-keyed remount + `enabled: !init.demo
  && init.scope !== null` keep it project-scoped and demo-gated.
- **Page bridge**: the unmount-invalidate effect was REMOVED (its cleanup
  ran under StrictMode replay while the page kept living, and the bridge's
  owner is unreachable at real unmount anyway). Hydration
  (`beginProject`) remains the only generation authority.

## jsdom `<StrictMode>` integration proof

`b10-1-strict-mode-publisher.test.tsx` mounts the PRODUCTION hook with a
REAL `EditorContextBridge` and a REAL `PcbBoardLifecycleOwner`:

| Case | Result |
| --- | --- |
| Capture after StrictMode replay (R1) | non-null (pre-fix: null) |
| Latest unsaved `state.board` | returned (revision matches the mutated working copy) |
| `lifecycle.adopt()` | capture immediately unavailable (before any re-render) |
| Replacement generation | republishes; capture returns the replacement board's revision |
| Real unmount | capture unavailable |
| Project switch (`beginProject` B) | project A's board unreachable from any scope |
| Demo (`enabled: false`) | never publishes |
| Page seam (hydration-owned beginProject, no invalidate cleanup, editor mounted after hydration) | capture works after replay; `app/page.tsx` contains no unmount-invalidate |
