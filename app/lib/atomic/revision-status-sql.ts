/**
 * [B19-E E3] Server-only SQL predicates over the append-only withdrawal events (migration 0030), shared by every drizzle read
 * of atomic revisions so new-selection reads and pinned reads cannot drift apart. The chat's raw-SQL reads
 * (`app/api/chat/authority-cancellable-reads.ts`) spell the same predicates and a parity test holds them equal.
 */
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { atomicPartRevisions, atomicRevisionStatusEvents } from "@/app/lib/db/schema";
import type { AtomicRevisionReadMode } from "./revision-status";

/** The revision named by `revisionId` was never deprecated, superseded or revoked. */
export function neverWithdrawnSql(revisionId: AnyColumn): SQL {
  return sql`not exists (select 1 from ${atomicRevisionStatusEvents} where ${atomicRevisionStatusEvents.revisionId} = ${revisionId})`;
}

/** The revision named by `revisionId` was never revoked (deprecated and superseded pins keep working, OD-38). */
export function notRevokedSql(revisionId: AnyColumn): SQL {
  return sql`not exists (select 1 from ${atomicRevisionStatusEvents} where ${atomicRevisionStatusEvents.revisionId} = ${revisionId} and ${atomicRevisionStatusEvents.toState} = 'revoked')`;
}

export function readModeSql(revisionId: AnyColumn, mode: AtomicRevisionReadMode): SQL {
  return mode === "selectable" ? neverWithdrawnSql(revisionId) : notRevokedSql(revisionId);
}

/** A boolean: the id (e.g. a `parts_atomic_links` column) names a published revision that was never withdrawn. */
export function selectableRevisionIdSql(revisionId: AnyColumn): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${atomicPartRevisions} where ${atomicPartRevisions.id} = ${revisionId} and ${atomicPartRevisions.publicationState} = 'published' and ${neverWithdrawnSql(atomicPartRevisions.id)})`;
}
