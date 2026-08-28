/**
 * B16.0.2 §B — the ONE project-owned BOM snapshot / notification repository.
 *
 * R3 (B16.0.1 gap): the BOM routes selected/updated/deleted durable rows by a
 * caller-supplied `projectKey` or a raw row id, the diff route was public,
 * and the production client derived `projectKey` from a schematic-content
 * hash. Authentication without object-level authorization is not a closed
 * perimeter.
 *
 * Every operation here REQUIRES the trusted server-derived ownership scope
 * `{ tenantId, projectId, branchId }` (the caller's `TrustedRequestContext`)
 * and EVERY predicate — list, get, update-by-id, bulk update, delete —
 * includes the FULL scope. A raw id alone can never select a row.
 *
 *  - `projectKey` remains ONLY as non-authoritative display/dedupe metadata
 *    (the server writes the trusted project id into it); it never authorizes.
 *  - Ownership lives in durable, server-derived columns (`tenant_id`,
 *    `project_id`, `branch_id` — migration 0028). LEGACY rows whose ownership
 *    columns are NULL are QUARANTINED: the scope predicate can never match a
 *    NULL, so they are unavailable until an explicit owner-controlled
 *    migration assigns ownership. Ownership is NEVER guessed.
 *  - The Postgres adapter and the in-memory adapter share this contract; the
 *    in-memory adapter drives the cross-project isolation tests.
 */

import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { bomNotifications, bomSnapshots, type BomNotification, type BomSnapshotRecord } from "../db/schema";
import type { BomSnapshotMeta, SnapshotRow } from "../snapshots";

export interface BomOwnershipScope {
  tenantId: string;
  projectId: string;
  branchId: string;
}

export interface BomSnapshotSummary {
  id: string;
  label: string | null;
  takenAt: Date;
  bomMeta: BomSnapshotMeta;
}

export interface BomSnapshotFull extends BomSnapshotSummary {
  /** Non-authoritative display/dedupe metadata — never an ownership key. */
  projectKey: string;
  rows: SnapshotRow[];
}

export interface CreateBomSnapshotInput {
  label: string | null;
  rows: SnapshotRow[];
  meta: BomSnapshotMeta;
}

export interface BomNotificationPatch {
  readAt?: Date | null;
  dismissedAt?: Date | null;
}

export interface BomRepository {
  createSnapshot(scope: BomOwnershipScope, input: CreateBomSnapshotInput): Promise<{ id: string }>;
  listSnapshots(scope: BomOwnershipScope, limit: number): Promise<BomSnapshotSummary[]>;
  /** The snapshot ONLY when `scope` owns it; otherwise null (no oracle). */
  getSnapshot(scope: BomOwnershipScope, id: string): Promise<BomSnapshotFull | null>;
  listNotifications(scope: BomOwnershipScope, options: { unreadOnly: boolean; limit: number }): Promise<BomNotification[]>;
  /** Mark every unread notification in `scope` as read. Returns the count. */
  markAllNotificationsRead(scope: BomOwnershipScope, now: Date): Promise<number>;
  /** Patch ONE notification ONLY when `scope` owns it. Returns whether a row changed. */
  updateNotification(scope: BomOwnershipScope, id: string, patch: BomNotificationPatch): Promise<boolean>;
  /** Delete notifications in `scope` (optionally only older than a date). Returns the count. */
  deleteNotifications(scope: BomOwnershipScope, options: { olderThan?: Date }): Promise<number>;
}

function wellFormedScope(scope: unknown): scope is BomOwnershipScope {
  if (typeof scope !== "object" || scope === null) return false;
  const s = scope as Record<string, unknown>;
  return ["tenantId", "projectId", "branchId"].every((key) => typeof s[key] === "string" && (s[key] as string).trim().length > 0);
}

function requireScope(scope: BomOwnershipScope): BomOwnershipScope {
  if (!wellFormedScope(scope)) throw new Error("A trusted BOM ownership scope is required");
  return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId };
}

// ── Postgres adapter ─────────────────────────────────────────────────────────

/** The FULL ownership predicate for a table — NULL ownership (legacy rows) can never match. */
function snapshotScopePredicate(scope: BomOwnershipScope) {
  return and(eq(bomSnapshots.tenantId, scope.tenantId), eq(bomSnapshots.projectId, scope.projectId), eq(bomSnapshots.branchId, scope.branchId));
}
function notificationScopePredicate(scope: BomOwnershipScope) {
  return and(eq(bomNotifications.tenantId, scope.tenantId), eq(bomNotifications.projectId, scope.projectId), eq(bomNotifications.branchId, scope.branchId));
}

export class PostgresBomRepository implements BomRepository {
  async createSnapshot(scope: BomOwnershipScope, input: CreateBomSnapshotInput): Promise<{ id: string }> {
    const owned = requireScope(scope);
    const [created] = await getDb()
      .insert(bomSnapshots)
      .values({
        tenantId: owned.tenantId,
        projectId: owned.projectId,
        branchId: owned.branchId,
        // display/dedupe metadata only — the trusted project id, never a caller value
        projectKey: owned.projectId,
        label: input.label,
        snapshotData: input.rows,
        bomMeta: input.meta,
      })
      .returning({ id: bomSnapshots.id });
    return { id: created.id };
  }

  async listSnapshots(scope: BomOwnershipScope, limit: number): Promise<BomSnapshotSummary[]> {
    const owned = requireScope(scope);
    const rows = await getDb()
      .select({ id: bomSnapshots.id, label: bomSnapshots.label, takenAt: bomSnapshots.takenAt, bomMeta: bomSnapshots.bomMeta })
      .from(bomSnapshots)
      .where(snapshotScopePredicate(owned))
      .orderBy(desc(bomSnapshots.takenAt))
      .limit(limit);
    return rows;
  }

  async getSnapshot(scope: BomOwnershipScope, id: string): Promise<BomSnapshotFull | null> {
    const owned = requireScope(scope);
    const [rec] = await getDb()
      .select()
      .from(bomSnapshots)
      .where(and(eq(bomSnapshots.id, id), snapshotScopePredicate(owned)))
      .limit(1);
    return rec ? recordToFull(rec) : null;
  }

  async listNotifications(scope: BomOwnershipScope, options: { unreadOnly: boolean; limit: number }): Promise<BomNotification[]> {
    const owned = requireScope(scope);
    const where = options.unreadOnly
      ? and(notificationScopePredicate(owned), isNull(bomNotifications.dismissedAt), isNull(bomNotifications.readAt))
      : and(notificationScopePredicate(owned), isNull(bomNotifications.dismissedAt));
    return getDb().select().from(bomNotifications).where(where).orderBy(desc(bomNotifications.createdAt)).limit(options.limit);
  }

  async markAllNotificationsRead(scope: BomOwnershipScope, now: Date): Promise<number> {
    const owned = requireScope(scope);
    const updated = await getDb()
      .update(bomNotifications)
      .set({ readAt: now })
      .where(and(notificationScopePredicate(owned), isNull(bomNotifications.readAt)))
      .returning({ id: bomNotifications.id });
    return updated.length;
  }

  async updateNotification(scope: BomOwnershipScope, id: string, patch: BomNotificationPatch): Promise<boolean> {
    const owned = requireScope(scope);
    const updated = await getDb()
      .update(bomNotifications)
      .set(patch)
      .where(and(eq(bomNotifications.id, id), notificationScopePredicate(owned)))
      .returning({ id: bomNotifications.id });
    return updated.length > 0;
  }

  async deleteNotifications(scope: BomOwnershipScope, options: { olderThan?: Date }): Promise<number> {
    const owned = requireScope(scope);
    const where = options.olderThan
      ? and(notificationScopePredicate(owned), lt(bomNotifications.createdAt, options.olderThan))
      : notificationScopePredicate(owned);
    const deleted = await getDb().delete(bomNotifications).where(where).returning({ id: bomNotifications.id });
    return deleted.length;
  }
}

function recordToFull(rec: BomSnapshotRecord): BomSnapshotFull {
  return { id: rec.id, projectKey: rec.projectKey, label: rec.label, takenAt: rec.takenAt, rows: rec.snapshotData, bomMeta: rec.bomMeta };
}

// ── In-memory adapter (tests + deterministic isolation proofs) ───────────────

interface MemSnapshot extends BomSnapshotFull { scope: BomOwnershipScope | null }
interface MemNotification extends BomNotification { scope: BomOwnershipScope | null }

function sameScope(a: BomOwnershipScope | null, b: BomOwnershipScope): boolean {
  return a !== null && a.tenantId === b.tenantId && a.projectId === b.projectId && a.branchId === b.branchId;
}

export class InMemoryBomRepository implements BomRepository {
  private snapshots = new Map<string, MemSnapshot>();
  private notifications = new Map<string, MemNotification>();
  private counter = 0;

  /** Seed a snapshot (scope null ⇒ a LEGACY unowned row, which must stay quarantined). */
  seedSnapshot(scope: BomOwnershipScope | null, input: { id?: string; label?: string | null; rows?: SnapshotRow[]; meta?: BomSnapshotMeta; projectKey?: string }): string {
    const id = input.id ?? `snap-${++this.counter}`;
    this.snapshots.set(id, {
      id, scope, label: input.label ?? null, takenAt: new Date(2026, 0, 1, 0, 0, this.counter),
      rows: input.rows ?? [], bomMeta: input.meta ?? { totalRows: 0, totalCostCents: null, currency: null, designRiskScore: 0 },
      projectKey: input.projectKey ?? scope?.projectId ?? "legacy",
    });
    return id;
  }

  /** Seed a notification (scope null ⇒ a LEGACY unowned row). */
  seedNotification(scope: BomOwnershipScope | null, input: Partial<BomNotification> & { id?: string } = {}): string {
    const id = input.id ?? `notif-${++this.counter}`;
    this.notifications.set(id, {
      id,
      scope,
      tenantId: scope?.tenantId ?? null,
      projectId: scope?.projectId ?? null,
      branchId: scope?.branchId ?? null,
      projectKey: input.projectKey ?? scope?.projectId ?? "legacy",
      sourceSnapshotId: input.sourceSnapshotId ?? null,
      type: input.type ?? "stock_dropped",
      severity: input.severity ?? "warning",
      partId: input.partId ?? null,
      summary: input.summary ?? "seeded",
      detailsJson: input.detailsJson ?? {},
      createdAt: input.createdAt ?? new Date(2026, 0, 1, 0, 0, this.counter),
      readAt: input.readAt ?? null,
      dismissedAt: input.dismissedAt ?? null,
    });
    return id;
  }

  /** Tests: raw read by id (NO scope) to prove a foreign/quarantined row was untouched. */
  peekNotification(id: string): MemNotification | undefined { return this.notifications.get(id); }
  peekSnapshot(id: string): MemSnapshot | undefined { return this.snapshots.get(id); }
  notificationCount(): number { return this.notifications.size; }

  async createSnapshot(scope: BomOwnershipScope, input: CreateBomSnapshotInput): Promise<{ id: string }> {
    const owned = requireScope(scope);
    const id = this.seedSnapshot(owned, { label: input.label, rows: input.rows, meta: input.meta, projectKey: owned.projectId });
    return { id };
  }
  async listSnapshots(scope: BomOwnershipScope, limit: number): Promise<BomSnapshotSummary[]> {
    const owned = requireScope(scope);
    return [...this.snapshots.values()].filter((s) => sameScope(s.scope, owned))
      .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime()).slice(0, limit)
      .map((s) => ({ id: s.id, label: s.label, takenAt: s.takenAt, bomMeta: s.bomMeta }));
  }
  async getSnapshot(scope: BomOwnershipScope, id: string): Promise<BomSnapshotFull | null> {
    const owned = requireScope(scope);
    const s = this.snapshots.get(id);
    if (!s || !sameScope(s.scope, owned)) return null;
    const { scope: _scope, ...rest } = s; void _scope;
    return structuredClone(rest);
  }
  async listNotifications(scope: BomOwnershipScope, options: { unreadOnly: boolean; limit: number }): Promise<BomNotification[]> {
    const owned = requireScope(scope);
    return [...this.notifications.values()]
      .filter((n) => sameScope(n.scope, owned) && n.dismissedAt === null && (!options.unreadOnly || n.readAt === null))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, options.limit)
      .map(({ scope: _scope, ...rest }) => { void _scope; return structuredClone(rest); });
  }
  async markAllNotificationsRead(scope: BomOwnershipScope, now: Date): Promise<number> {
    const owned = requireScope(scope);
    let count = 0;
    for (const n of this.notifications.values()) if (sameScope(n.scope, owned) && n.readAt === null) { n.readAt = now; count += 1; }
    return count;
  }
  async updateNotification(scope: BomOwnershipScope, id: string, patch: BomNotificationPatch): Promise<boolean> {
    const owned = requireScope(scope);
    const n = this.notifications.get(id);
    if (!n || !sameScope(n.scope, owned)) return false;
    if ("readAt" in patch) n.readAt = patch.readAt ?? null;
    if ("dismissedAt" in patch) n.dismissedAt = patch.dismissedAt ?? null;
    return true;
  }
  async deleteNotifications(scope: BomOwnershipScope, options: { olderThan?: Date }): Promise<number> {
    const owned = requireScope(scope);
    let count = 0;
    for (const [id, n] of this.notifications) {
      if (!sameScope(n.scope, owned)) continue;
      if (options.olderThan && !(n.createdAt.getTime() < options.olderThan.getTime())) continue;
      this.notifications.delete(id); count += 1;
    }
    return count;
  }
}

// ── Runtime seam (mirrors identity-runtime.ts) ───────────────────────────────

const DEFAULT_FACTORY: () => BomRepository = () => new PostgresBomRepository();
let factory = DEFAULT_FACTORY;
export function setBomRepositoryFactory(next: () => BomRepository): void { factory = next; }
export function resetBomRepositoryFactory(): void { factory = DEFAULT_FACTORY; }
export function resolveBomRepository(): BomRepository { return factory(); }
