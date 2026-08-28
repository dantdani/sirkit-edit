/**
 * B14 §B — the server resolver for SERVER-OWNED published pin facts.
 *
 * Mirrors the B13.1/B13.2 component-authority runtime pattern: the default is
 * the REAL production source (cancellable postgres.js reads of the published
 * atomic symbol pins + approved mapping certificate), gated on
 * `DATABASE_URL`, constructed lazily (no I/O at import or resolve), failing
 * CLOSED to null. A test setter exists with a deterministic reset — it is
 * never a production path.
 *
 * `loadRunReplacementPinFacts` wraps one fact read in the B13.2 §C
 * settlement machine: external abort is a TERMINAL race member (immediate
 * null), the deadline aborts the underlying cancellable read, one terminal
 * settlement, late results discarded, no unhandled rejections, pre-aborted ⇒
 * no I/O.
 */

import { getSqlClient } from "@/app/lib/db/client";
import type { PublishedSymbolPinFacts } from "@/app/lib/engineering/replacement-pin-facts";
import {
  loadPublishedSymbolPinFactsCancellable,
  type CancellableAuthoritySqlClient,
} from "./authority-cancellable-reads";

export interface ReplacementPinFactsSource {
  loadPinFacts(atomicPartRevisionId: string, signal?: AbortSignal): Promise<PublishedSymbolPinFacts | null>;
}

function productionSource(): ReplacementPinFactsSource | null {
  if (!process.env.DATABASE_URL) return null;
  let client: CancellableAuthoritySqlClient | null = null;
  const sql = (): CancellableAuthoritySqlClient => (client ??= getSqlClient() as unknown as CancellableAuthoritySqlClient);
  return {
    loadPinFacts: (atomicPartRevisionId, signal) => loadPublishedSymbolPinFactsCancellable(sql(), atomicPartRevisionId, signal),
  };
}

const DEFAULT_FACTORY: () => ReplacementPinFactsSource | null = productionSource;
let sourceFactory = DEFAULT_FACTORY;

/** Test-only override; restore via `resetReplacementPinFactsSourceFactory`. */
export function setReplacementPinFactsSourceFactory(factory: () => ReplacementPinFactsSource | null): void {
  sourceFactory = factory;
}

/** Restore the production default (deterministic test isolation). */
export function resetReplacementPinFactsSourceFactory(): void {
  sourceFactory = DEFAULT_FACTORY;
}

/** Resolve the pin-facts source, or null to withhold. Never throws. */
export function resolveReplacementPinFactsSource(): ReplacementPinFactsSource | null {
  try {
    return sourceFactory();
  } catch {
    return null;
  }
}

export const DEFAULT_PIN_FACTS_DEADLINE_MS = 5_000;

/**
 * [B13.2 §C discipline] Deadline-bounded, immediately-abort-settling fact
 * read. Returns null (fail closed) on unavailable/timeout/abort/rejection.
 */
export async function loadRunReplacementPinFacts(
  source: ReplacementPinFactsSource | null,
  atomicPartRevisionId: string,
  externalSignal?: AbortSignal,
  deadlineMs: number = DEFAULT_PIN_FACTS_DEADLINE_MS,
): Promise<PublishedSymbolPinFacts | null> {
  if (!source) return null;
  if (externalSignal?.aborted) return null; // pre-aborted → no I/O

  const controller = new AbortController();
  return await new Promise((resolve) => {
    let settled = false;
    function settle(value: PublishedSymbolPinFacts | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      resolve(value);
    }
    function onExternalAbort(): void { controller.abort(); settle(null); }
    const timer = setTimeout(() => { controller.abort(); settle(null); }, deadlineMs);
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    source.loadPinFacts(atomicPartRevisionId, controller.signal).then(
      (facts) => settle(facts),
      () => settle(null),
    );
  });
}
