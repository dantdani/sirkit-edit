/**
 * B13.2 §D — CANCELLABLE server-only authority reads.
 *
 * The narrow read adapter for the /api/chat component-authority path. It
 * executes the durable physical-binding and atomic-catalog READ queries
 * through postgres.js `PendingQuery` objects so an aborted request attempts
 * REAL database cancellation — `query.cancel()` issues the out-of-band
 * PostgreSQL cancel request (server error `57014 query_canceled`) — instead
 * of merely observing an AbortSignal while the query keeps running.
 *
 * Scope: READS ONLY, and only the authority queries —
 *  - binding-set lookup (`physical_binding_sets` by full component scope),
 *  - binding revision/aggregate reads (`physical_binding_revisions`),
 *  - atomic revision lookup (`atomic_part_revisions`, published only; [B19-E E3]
 *    "pinned" excludes revoked revisions, "selectable" excludes every
 *    withdrawn one — the same predicates as `app/lib/atomic/server-catalog.ts`;
 *    [B19-E E5] "historical" ignores withdrawal, for the pins being moved off),
 *  - [B19-E E5] catalog status lookup (`atomic_revision_status_events`),
 *  - CAD asset lookup (`atomic_cad_assets`, symbol + footprint versions),
 *  - mapping lookup (`atomic_mapping_certificates`, approved only),
 *  - exact-part lookup (`atomic_exact_parts` — the manufacturer identity is
 *    the `manufacturer_id` column of this row, so no separate manufacturers
 *    query is reached by the confirmation projection).
 * No write path, repository commit, migration, audit, or ingestion query is
 * touched or altered.
 *
 * Honesty about PostgreSQL cancellation: it is BEST-EFFORT by protocol — the
 * cancel request travels on a separate connection and can lose the race with
 * query completion. User-facing settlement therefore NEVER depends on it:
 * the loader's settlement (§C) is immediate and deterministic, and this
 * adapter additionally refuses to START any further query once the signal is
 * aborted, so a request abort ends the read sequence at the next boundary
 * even if an in-flight cancel is lost.
 *
 * Failure discipline: driver errors (including cancellation) are NEVER
 * rethrown. Every failure normalizes to `AUTHORITY_READ_ABORTED` (the signal
 * aborted) or `AUTHORITY_READ_UNAVAILABLE` — no SQL text, connection
 * information, credentials, or raw driver error ever leaves this module. The
 * authority loader converts either into fail-closed unavailability.
 */

import type {
  AtomicRevisionConfirmation,
  AuthorityBindingAggregate,
  AuthorityComponentScope,
} from "@/app/lib/engineering/component-authority-source";
import type { PublishedSymbolPinFacts } from "@/app/lib/engineering/replacement-pin-facts";
import type { KicadPin, KicadPinType } from "@/app/lib/kicad/types";
import type { ComponentPhysicalBinding, ComponentPhysicalBindingSet } from "@/app/lib/physical-binding/types";
import type { AtomicPartRevision, FootprintAssetVersion, MappingCertificate, SymbolAssetVersion } from "@/app/lib/atomic/types";
import { revisionStatusFromEvents, type AtomicCatalogStatus } from "@/app/lib/atomic/revision-status";

/** Normalized failure codes — the ONLY errors this module throws. */
export const AUTHORITY_READ_ABORTED = "AUTHORITY_READ_ABORTED";
export const AUTHORITY_READ_UNAVAILABLE = "AUTHORITY_READ_UNAVAILABLE";

/** The slice of a postgres.js `PendingQuery` the adapter needs: awaitable
 *  rows plus the driver's real `cancel()` (postgres.js 3.4.9,
 *  `PendingQueryModifiers.cancel(): void`). */
export interface CancellableAuthorityQuery extends PromiseLike<readonly Record<string, unknown>[]> {
  cancel(): void;
}

/** The slice of the postgres.js `Sql` client the adapter uses —
 *  `sql.unsafe(text, params)` returns a cancellable `PendingQuery`.
 *  Injectable so adapter tests drive controllable query objects. */
export interface CancellableAuthoritySqlClient {
  unsafe(text: string, params: string[]): CancellableAuthorityQuery;
}

/**
 * Run ONE cancellable read. Refuses to start when already aborted; invokes
 * the driver's `cancel()` on abort; normalizes every failure. The abort
 * listener is always removed.
 */
export async function runCancellableAuthorityRead(
  client: CancellableAuthoritySqlClient,
  text: string,
  params: string[],
  signal: AbortSignal | undefined,
): Promise<readonly Record<string, unknown>[]> {
  if (signal?.aborted) throw new Error(AUTHORITY_READ_ABORTED); // never start new work once aborted
  let query: CancellableAuthorityQuery;
  try {
    query = client.unsafe(text, params);
  } catch {
    throw new Error(AUTHORITY_READ_UNAVAILABLE);
  }
  const onAbort = (): void => {
    // REAL database cancellation — postgres.js sends the out-of-band cancel
    // request; the query then rejects (57014). Best-effort: a throwing
    // cancel() must not mask the normalized settlement below.
    try {
      query.cancel();
    } catch {
      /* cancellation is best-effort */
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await query;
  } catch {
    // Cancellation (57014), connection failure, and every other driver error
    // normalize here — raw driver errors, SQL text, and connection details
    // never escape this module.
    throw new Error(signal?.aborted ? AUTHORITY_READ_ABORTED : AUTHORITY_READ_UNAVAILABLE);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

const SQL_BINDING_SETS =
  'select "binding_set" from "physical_binding_sets" where "tenant_id" = $1 and "project_id" = $2 and "branch_id" = $3 and "board_instance_id" = $4 and "component_instance_id" = $5';
const SQL_BINDING_REVISIONS = (count: number): string =>
  `select "binding" from "physical_binding_revisions" where "revision_id" in (${Array.from({ length: count }, (_, index) => `$${index + 1}`).join(", ")})`;
// [B19-E E3] withdrawal is append-only (`atomic_revision_status_events`): an existing pin reads a revision unless it was revoked
// (OD-38), a new selection reads it only if it was never withdrawn. Mirrors `readModeSql` in app/lib/atomic/revision-status-sql.ts.
const SQL_ATOMIC_REVISION_PINNED =
  `select "revision_data" from "atomic_part_revisions" where "id" = $1 and "publication_state" = $2 and not exists (select 1 from "atomic_revision_status_events" where "atomic_revision_status_events"."revision_id" = "atomic_part_revisions"."id" and "atomic_revision_status_events"."to_state" = 'revoked')`;
const SQL_ATOMIC_REVISION_SELECTABLE =
  'select "revision_data" from "atomic_part_revisions" where "id" = $1 and "publication_state" = $2 and not exists (select 1 from "atomic_revision_status_events" where "atomic_revision_status_events"."revision_id" = "atomic_part_revisions"."id")';
// [B19-E E5] the revision an existing pin is being moved OFF (a replacement's current pins): published, withdrawal ignored
const SQL_ATOMIC_REVISION_HISTORICAL =
  'select "revision_data" from "atomic_part_revisions" where "id" = $1 and "publication_state" = $2';

/**
 * [B19-E E3] "pinned": a revision an existing pin names (published, not revoked); "selectable": a new selection (never
 * withdrawn). [B19-E E5] "historical": the revision a pin is being moved off (published, whatever was withdrawn; grants nothing).
 */
export type AtomicAuthorityReadMode = "pinned" | "selectable" | "historical";
const atomicRevisionSql = (mode: AtomicAuthorityReadMode): string => (mode === "selectable" ? SQL_ATOMIC_REVISION_SELECTABLE : mode === "historical" ? SQL_ATOMIC_REVISION_HISTORICAL : SQL_ATOMIC_REVISION_PINNED);
const SQL_CAD_ASSETS =
  'select "kind", "payload" from "atomic_cad_assets" where "version_id" in ($1, $2)';
const SQL_MAPPING_CERTIFICATE =
  'select "certificate" from "atomic_mapping_certificates" where "id" = $1 and "state" = $2';
const SQL_EXACT_PART =
  'select "manufacturer_id", "exact_mpn" from "atomic_exact_parts" where "id" = $1';

/** Mirrors `PB_CANDIDATE_LIMIT` — a durable set naming more candidates is
 *  corrupt; refuse (bounded) instead of building an unbounded IN clause. */
const MAX_CANDIDATE_REVISIONS = 256;

/**
 * Cancellable equivalent of the repository's `findForComponentVariant`
 * projection for the authority path: sets by the full component scope,
 * filtered by exact hierarchy and variant applicability (empty = universal —
 * the repository's existing authoritative semantic), then each set's
 * candidate revisions. Projects ONLY `{ set, bindings }` — never audits,
 * migrations, assessments, or raw rows. Once aborted, NO further query
 * starts.
 */
export async function loadBindingAggregatesCancellable(
  client: CancellableAuthoritySqlClient,
  scope: AuthorityComponentScope,
  signal: AbortSignal | undefined,
): Promise<AuthorityBindingAggregate[]> {
  const setRows = await runCancellableAuthorityRead(
    client,
    SQL_BINDING_SETS,
    [scope.tenantId, scope.projectId, scope.branchId, scope.boardInstanceId, scope.componentInstanceId],
    signal,
  );
  const requestedHierarchy = scope.hierarchyPath.join("\0");
  const sets = setRows
    .map((row) => row.binding_set as ComponentPhysicalBindingSet | undefined)
    .filter((set): set is ComponentPhysicalBindingSet => Boolean(set && typeof set === "object" && set.scope))
    .filter((set) => set.scope.hierarchyPath.join("\0") === requestedHierarchy
      && (set.scope.assemblyVariantIds.length === 0 || set.scope.assemblyVariantIds.includes(scope.assemblyVariantId)))
    .sort((a, b) => a.setId.localeCompare(b.setId));
  const aggregates: AuthorityBindingAggregate[] = [];
  for (const set of sets) {
    const revisionIds = set.candidateRevisionIds;
    if (revisionIds.length > MAX_CANDIDATE_REVISIONS) throw new Error(AUTHORITY_READ_UNAVAILABLE);
    // runCancellableAuthorityRead refuses to start once aborted, so an abort
    // between sequential reads stops the sequence here.
    const bindingRows = revisionIds.length
      ? await runCancellableAuthorityRead(client, SQL_BINDING_REVISIONS(revisionIds.length), [...revisionIds], signal)
      : [];
    const bindings = bindingRows
      .map((row) => row.binding as ComponentPhysicalBinding | undefined)
      .filter((binding): binding is ComponentPhysicalBinding => Boolean(binding && typeof binding === "object"))
      .sort((a, b) => a.revisionId.localeCompare(b.revisionId));
    aggregates.push({ set, bindings });
  }
  return aggregates;
}

/**
 * Cancellable equivalent of the B13.1 published-snapshot confirmation: the
 * allowlisted `AtomicRevisionConfirmation` projection, with IDENTICAL
 * semantics — the revision must be published, its primary CAD bundle must
 * name a symbol, footprint, and mapping certificate, the mapping must be
 * APPROVED, the exact part must exist, and every id must agree. Returns null
 * (no exact authority) on any incompleteness. Once aborted, NO further query
 * starts.
 */
export async function confirmPublishedAtomicRevisionCancellable(
  client: CancellableAuthoritySqlClient,
  atomicPartRevisionId: string,
  signal: AbortSignal | undefined,
  mode: AtomicAuthorityReadMode = "pinned",
): Promise<AtomicRevisionConfirmation | null> {
  const revisionRows = await runCancellableAuthorityRead(client, atomicRevisionSql(mode), [atomicPartRevisionId, "published"], signal);
  const revision = revisionRows[0]?.revision_data as AtomicPartRevision | undefined;
  if (!revision || typeof revision !== "object") return null;
  if (revision.id !== atomicPartRevisionId || revision.publicationState !== "published") return null;
  const primary = revision.cadBundles.find((bundle) => bundle.disposition === "primary_approved") ?? revision.cadBundles[0];
  if (!primary || !primary.footprintVersionId || !primary.mappingCertificateId || !revision.exactPartId) return null;

  const assetRows = await runCancellableAuthorityRead(client, SQL_CAD_ASSETS, [primary.symbolVersionId, primary.footprintVersionId], signal);
  const symbol = assetRows.find((row) => row.kind === "symbol")?.payload as SymbolAssetVersion | undefined;
  const footprint = assetRows.find((row) => row.kind === "footprint")?.payload as FootprintAssetVersion | undefined;
  if (!symbol || symbol.versionId !== primary.symbolVersionId) return null;
  if (!footprint || footprint.versionId !== primary.footprintVersionId) return null;

  const mappingRows = await runCancellableAuthorityRead(client, SQL_MAPPING_CERTIFICATE, [primary.mappingCertificateId, "approved"], signal);
  const mapping = mappingRows[0]?.certificate as MappingCertificate | undefined;
  if (!mapping || mapping.id !== primary.mappingCertificateId || mapping.state !== "approved") return null;

  const partRows = await runCancellableAuthorityRead(client, SQL_EXACT_PART, [revision.exactPartId], signal);
  const part = partRows[0];
  if (!part || typeof part.exact_mpn !== "string" || typeof part.manufacturer_id !== "string") return null;

  return {
    atomicPartRevisionId: revision.id,
    published: true,
    exactMpn: part.exact_mpn,
    manufacturerId: part.manufacturer_id,
    symbolAssetVersionId: symbol.versionId,
    footprintAssetVersionId: footprint.versionId,
    mappingCertificateId: mapping.id,
  };
}

const SQL_REVISION_STATUS_EVENTS =
  'select "to_state", "successor_revision_id" from "atomic_revision_status_events" where "revision_id" = $1';

/**
 * [B19-E E5] Cancellable read of one revision's catalog status from its append-only withdrawal events: the furthest state
 * reached and the successor it names (published when there are none). Whether the revision is published at all is the
 * confirmation's question, not this one's. Once aborted, no query starts.
 */
export async function loadAtomicCatalogStatusCancellable(
  client: CancellableAuthoritySqlClient,
  atomicPartRevisionId: string,
  signal: AbortSignal | undefined,
): Promise<{ state: AtomicCatalogStatus; successorRevisionId?: string }> {
  const rows = await runCancellableAuthorityRead(client, SQL_REVISION_STATUS_EVENTS, [atomicPartRevisionId], signal);
  const status = revisionStatusFromEvents(atomicPartRevisionId, "", rows.map((row) => ({ toState: String(row.to_state), successorRevisionId: typeof row.successor_revision_id === "string" ? row.successor_revision_id : null })));
  return { state: status.state, ...(status.successorRevisionId ? { successorRevisionId: status.successorRevisionId } : {}) };
}

const SQL_SYMBOL_ASSET =
  'select "kind", "payload" from "atomic_cad_assets" where "version_id" = $1';

/** KiCad electrical-type vocabulary; unknown durable values degrade to
 *  "unspecified" (pin identity for mapping is number+name, never type). */
const KICAD_PIN_TYPES: ReadonlySet<string> = new Set([
  "input", "output", "bidirectional", "tri_state", "passive", "free",
  "unspecified", "power_in", "power_out", "open_collector", "open_emitter", "no_connect",
]);

function toKicadPin(pin: SymbolAssetVersion["pins"][number]): KicadPin {
  return {
    number: pin.number,
    name: pin.name,
    type: (KICAD_PIN_TYPES.has(pin.electricalType) ? pin.electricalType : "unspecified") as KicadPinType,
    position: { x: pin.position.x, y: pin.position.y },
    orientation: pin.orientation,
    length: pin.length,
    ...(pin.unit !== undefined ? { unit: pin.unit } : {}),
    ...(pin.bodyStyle !== undefined ? { bodyStyle: pin.bodyStyle } : {}),
    ...(pin.hidden ? { hidden: true } : {}),
    ...(pin.stacked ? { stacked: true } : {}),
  };
}

/**
 * [B14 §B] Cancellable server-only read of the PUBLISHED pin facts for one
 * atomic part revision: the primary CAD bundle's symbol pins (converted to
 * the planner's `KicadPin` shape) plus a bounded projection of the APPROVED
 * mapping certificate for corroboration. Returns null (fail closed, no
 * facts) when the revision is unpublished, structurally incomplete, or its
 * mapping is not approved. Never returns raw snapshots, blobs, rows,
 * supplier data, or credentials. Once aborted, NO further query starts.
 */
export async function loadPublishedSymbolPinFactsCancellable(
  client: CancellableAuthoritySqlClient,
  atomicPartRevisionId: string,
  signal: AbortSignal | undefined,
  mode: AtomicAuthorityReadMode = "pinned",
): Promise<PublishedSymbolPinFacts | null> {
  const revisionRows = await runCancellableAuthorityRead(client, atomicRevisionSql(mode), [atomicPartRevisionId, "published"], signal);
  const revision = revisionRows[0]?.revision_data as AtomicPartRevision | undefined;
  if (!revision || typeof revision !== "object") return null;
  if (revision.id !== atomicPartRevisionId || revision.publicationState !== "published") return null;
  const primary = revision.cadBundles.find((bundle) => bundle.disposition === "primary_approved") ?? revision.cadBundles[0];
  if (!primary || !primary.mappingCertificateId) return null;

  const assetRows = await runCancellableAuthorityRead(client, SQL_SYMBOL_ASSET, [primary.symbolVersionId], signal);
  const symbol = assetRows.find((row) => row.kind === "symbol")?.payload as SymbolAssetVersion | undefined;
  if (!symbol || symbol.versionId !== primary.symbolVersionId) return null;
  if (!Array.isArray(symbol.pins) || symbol.pins.length === 0) return null;

  const mappingRows = await runCancellableAuthorityRead(client, SQL_MAPPING_CERTIFICATE, [primary.mappingCertificateId, "approved"], signal);
  const mapping = mappingRows[0]?.certificate as MappingCertificate | undefined;
  if (!mapping || mapping.id !== primary.mappingCertificateId || mapping.state !== "approved") return null;

  return {
    atomicPartRevisionId: revision.id,
    symbolAssetVersionId: symbol.versionId,
    pins: symbol.pins.map(toKicadPin),
    certificate: {
      id: mapping.id,
      symbolVersionId: mapping.symbolVersionId,
      footprintVersionId: mapping.footprintVersionId,
      symbolPinIds: [...mapping.symbolPinIds],
      missingTerminalIds: [...mapping.missingTerminalIds],
      missingSymbolPinIds: [...mapping.missingSymbolPinIds],
      missingPadNumbers: [...mapping.missingPadNumbers],
      ambiguous: [...mapping.ambiguous],
      state: "approved",
    },
    symbolPinIds: symbol.pins.map((pin) => pin.id),
  };
}
