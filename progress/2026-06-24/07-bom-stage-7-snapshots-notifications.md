# BOM Stage 7: Snapshots & change notifications

**Date**: 2026-06-24
**Status**: Shipped

## What this changed
Added BOM snapshot persistence, snapshot-to-snapshot diffing, and a notification
system that surfaces supply-chain changes (stock drops, lifecycle moves, price
spikes, new/lost alternates). Background refresh script now generates
notifications as a cron-runnable job. BOM view exposes Take Snapshot, History,
and a notification bell with unread count.

## New files
- app/lib/snapshots.ts — SnapshotRow/BomSnapshot, rowToSnapshotRow, diffSnapshots, Change types, thresholds
- app/lib/notifications.ts — changeToNotification, severity rules, summary templates, NotificationType union
- app/api/bom/snapshot/route.ts — POST create, GET list snapshots
- app/api/bom/diff/route.ts — GET diff between two snapshots (or snapshot vs current)
- app/api/bom/notifications/route.ts — GET/PATCH/DELETE notifications

## Modified files
- app/lib/db/schema.ts — new bomSnapshots and bomNotifications tables (migration 0003)
- scripts/refresh-bom-pricing.ts — --notify flag diffs latest snapshot vs refreshed cache, inserts notifications (24h dedupe)
- app/components/bom/BomView.tsx — projectKey prop + SHA-256 hash fallback, Take Snapshot popover, History panel, notification bell + drawer, diff view, row highlight
- package.json — added refresh:bom-notify script

## New exports
- type SnapshotRow, BomSnapshot, BomSnapshotMeta, Change, NotificationType, NotificationSeverity
- rowToSnapshotRow(row) → SnapshotRow; diffSnapshots(prev, curr) → Change[]
- changeToNotification(change, partInfo) → { type, severity, summary, details }

## Design decisions / Known limitations
- Snapshots are project-keyed by an explicit string; synthetic key = SHA-256 of state (sorted keys,
  computed client-side via crypto.subtle). No per-user auth/isolation yet.
- BomRow type imported from @/app/lib/bom/build (the spec's @/api/bom/route alias doesn't resolve).
- "Restore from snapshot" deferred — diff is view-only.
- supplier_lost is approximated from the snapshot's best-source change (per-distributor stock isn't
  stored in the compact SnapshotRow); alternate_obsolete type is reserved but not yet diffed.
- Dedupe is SELECT-then-INSERT on (projectKey, partId, type) within 24h — small race window accepted.
- Notifications are in-app only (no email/push); custom drawer/popover (no shadcn lib in repo).

## Verification
- pnpm db:generate + db:push: migration 0003 applied ("Changes applied")
- pnpm tsc --noEmit: 0 errors
- Unit test: diffSnapshots emits all 5 change kinds with correct severities/summaries; no-change and
  added-part (only-in-curr) correctly yield 0 changes
- End-to-end against live DB: inserted a snapshot (stock 99,999) for a real part → pnpm refresh:bom-notify
  generated 2 notifications ([critical] stock_dropped "out of stock at all suppliers", [warning]
  supplier_lost); re-run generated 0 (24h dedupe); test data cleaned up
- refresh:bom-notify completes cleanly with no snapshots ("0 notifications across 0 projects")
