# BOM alternates — Swap part wiring

**Date:** 2026-06-28
**Status:** Done.
**Scope:** `app/page.tsx` only (per constraints). BomView and the alternates API unchanged.

## What changed

The alternates drawer's **Swap** button already plumbed an `onSwapPart(sourcePartId,
newPartId)` callback all the way up through `BomView` → `AlternatesDrawer` →
`AlternateCard`, but `app/page.tsx` never supplied it, so `canSwap={!!onSwapPart}`
was false and the button sat disabled. Implemented the callback.

### 1. `handleSwapPart(sourcePartId, newPartId)`
- `await ensurePartLoaded(newPartId)` first, so the renderer has the new symbol/pin
  data on the very next render (no flash of missing part). `ensurePartLoaded` was
  already imported from `@/app/lib/parts-cache` — no new import needed (the prompt's
  `@/lib/parts-cache` path was stale).
- `setKicadComponents(prev => prev.map(...))` re-points every instance whose
  `partId === sourcePartId` to `newPartId`. **x / y / rotation / refDes / value are
  preserved** — swap assumed form-fit-function compatible.
- On success, fires a toast: `Swapped to <mpn|name>. Verify wire connections — pin
  positions may differ.`
- Wrapped in try/catch; a load failure shows an error toast instead of an unhandled
  rejection (the `=> void` callback can't surface the promise).

### 2. Minimal toast system (none existed in the app)
- `toast` state + `toastTimer` ref + `showToast(msg)` helper (auto-dismiss after 6s).
- Fixed bottom-center overlay rendered at the root, with an `X` dismiss button
  (`X` already imported from lucide-react). No new dependency — the codebase had no
  toast lib, and `alert()` (used by the export handler) is blocking/ugly.

### 3. Passed `onSwapPart={handleSwapPart}` to `<BomView>` in the `view === "bom"` branch.

## Edge cases (per spec)
- **Differing pin layouts:** wires keep their old endpoints and may hang. We do NOT
  run a connection-integrity check or block the swap — the toast tells the user to
  verify visually.
- `sourcePartId` comes from `drawerRow.partId`, which is the BOM row's catalog id —
  the same value stored on each `KicadComponentInstance.partId`, so the remap matches.

## Verification
- `tsc --noEmit` over the whole project: **exit 0**, no errors.
- Traced the call path: `drawerRow.partId` → `onSwapPart(sourcePartId, alt.partId)`
  → `handleSwapPart` → `setKicadComponents`. Cache warmed before state update.

## Not done (manual)
- Visual smoke test: click Swap on an alternate in the BOM view and confirm the
  symbol re-renders in place + toast appears.
