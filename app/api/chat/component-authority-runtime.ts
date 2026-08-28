/**
 * B13.1 §A / B13.2 §D — the /api/chat resolver for the SERVER-OWNED
 * component-authority source, with a REAL production default (no test setter)
 * whose database reads are CANCELLABLE.
 *
 * The default source executes the durable binding and atomic-catalog READ
 * queries through the cancellable adapter (`authority-cancellable-reads.ts`)
 * over the raw postgres.js client, so an aborted request attempts real
 * `query.cancel()` database cancellation and never starts further queries.
 * Construction is lazy — resolving a source performs NO I/O and builds no
 * connection; the client is obtained on the FIRST read. Everything fails
 * CLOSED: a missing `DATABASE_URL`, a construction/query failure, or an
 * atomic-catalog failure withholds the resource without breaking unrelated
 * chat. Authority data and source selection never come from the request
 * body, browser state, provider, or model — the resolver takes only the
 * authenticated server scope, and the adapter reads only durable rows.
 *
 * Test seams (NOT production paths): `setComponentAuthoritySourceFactory`
 * replaces the whole source, and `setAuthoritySqlClientFactory` replaces the
 * SQL client under the REAL production source; each has a deterministic
 * reset and `sourceFactory` defaults to the real `productionSource`.
 */

import { getSqlClient } from "@/app/lib/db/client";
import type {
  AtomicRevisionConfirmer,
  AuthorityBindingSource,
  ComponentAuthoritySourceDeps,
} from "@/app/lib/engineering/component-authority-source";
import {
  confirmPublishedAtomicRevisionCancellable,
  loadBindingAggregatesCancellable,
  type CancellableAuthoritySqlClient,
} from "./authority-cancellable-reads";

export interface ComponentAuthorityRuntimeScope {
  tenantId: string;
  projectId: string;
  branchId: string;
}

/** The raw postgres.js client, projected to the narrow cancellable-read
 *  slice. The cast is a pure narrowing: `Sql.unsafe(text, params)` returns a
 *  `PendingQuery` (awaitable rows + `cancel()`), exactly the adapter
 *  contract. */
const DEFAULT_SQL_CLIENT_FACTORY: () => CancellableAuthoritySqlClient = () =>
  getSqlClient() as unknown as CancellableAuthoritySqlClient;
let sqlClientFactory = DEFAULT_SQL_CLIENT_FACTORY;

/** Test-only override for the SQL client under the REAL production source.
 *  Call `resetAuthoritySqlClientFactory` to restore deterministically. */
export function setAuthoritySqlClientFactory(factory: () => CancellableAuthoritySqlClient): void {
  sqlClientFactory = factory;
}

/** Restore the production SQL client factory (deterministic test isolation). */
export function resetAuthoritySqlClientFactory(): void {
  sqlClientFactory = DEFAULT_SQL_CLIENT_FACTORY;
}

/** The REAL production source: cancellable durable-binding reads +
 *  cancellable published-atomic confirmation. No I/O at import or resolve —
 *  the client is obtained on the first read. Returns null (withhold) when no
 *  durable database is configured. */
function productionSource(scope: ComponentAuthorityRuntimeScope): ComponentAuthoritySourceDeps | null {
  // Withhold safely when no durable DB is configured (getSqlClient() would throw).
  if (!process.env.DATABASE_URL) return null;
  let client: CancellableAuthoritySqlClient | null = null;
  const sql = (): CancellableAuthoritySqlClient => (client ??= sqlClientFactory());
  const bindings: AuthorityBindingSource = {
    // [B13.2 §A] the ONE complete component scope drives the query — the
    // component id, hierarchy, and variant are never separate parameters.
    // [B13.2 §D] the signal is passed through to real query cancellation.
    loadForComponent: (componentScope, signal) => loadBindingAggregatesCancellable(sql(), componentScope, signal),
  };
  const atomic: AtomicRevisionConfirmer = (atomicPartRevisionId, signal) =>
    confirmPublishedAtomicRevisionCancellable(sql(), atomicPartRevisionId, signal);
  void scope;
  return { bindings, atomic };
}

/** Defaults to the REAL production source (not null). Tests may override and
 *  MUST restore via `resetComponentAuthoritySourceFactory`. */
const DEFAULT_FACTORY: (scope: ComponentAuthorityRuntimeScope) => ComponentAuthoritySourceDeps | null = productionSource;
let sourceFactory = DEFAULT_FACTORY;

/** Test-only override. Passing a factory replaces the production default for
 *  the duration of a test; call `resetComponentAuthoritySourceFactory` to
 *  restore deterministically. */
export function setComponentAuthoritySourceFactory(
  factory: (scope: ComponentAuthorityRuntimeScope) => ComponentAuthoritySourceDeps | null,
): void {
  sourceFactory = factory;
}

/** Restore the production default source (deterministic test isolation). */
export function resetComponentAuthoritySourceFactory(): void {
  sourceFactory = DEFAULT_FACTORY;
}

/** Resolve the durable source for a scope, or null to withhold. Never throws:
 *  any construction/config error fails closed to null (the run continues
 *  without authority; unrelated chat tools are unaffected). */
export function resolveComponentAuthoritySource(scope: ComponentAuthorityRuntimeScope): ComponentAuthoritySourceDeps | null {
  try {
    return sourceFactory(scope);
  } catch {
    return null;
  }
}
