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
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
import { fixtureReplacementPinFactsSource } from "@/app/lib/fixture-runtime/blinker/authority";
import type { PublishedSymbolPinFacts, ReplacementPinFactsRole } from "@/app/lib/engineering/replacement-pin-facts";
import {
  loadPublishedSymbolPinFactsCancellable,
  type CancellableAuthoritySqlClient,
} from "./authority-cancellable-reads";

export interface ReplacementPinFactsSource {
  /** [B19-E E5] `role` (default "target"): current pins are read from the revision being left, target pins only from a selectable one */
  loadPinFacts(atomicPartRevisionId: string, signal?: AbortSignal, role?: ReplacementPinFactsRole): Promise<PublishedSymbolPinFacts | null>;
}

function productionSource(): ReplacementPinFactsSource | null {
  // [B18-E E16] the fixture runtime's published pin facts - the same bounded projection, read out of the committed
  // catalog instead of the database. Gated by the same non-production, local_dev-only switch as every other seam.
  if (fixtureRuntimeEnabled()) return fixtureReplacementPinFactsSource();
  if (!process.env.DATABASE_URL) return null;
  let client: CancellableAuthoritySqlClient | null = null;
  const sql = (): CancellableAuthoritySqlClient => (client ??= getSqlClient() as unknown as CancellableAuthoritySqlClient);
  return {
    // [B19-E E5] a project may move OFF a withdrawn (even revoked) part, but only ONTO a published, never-withdrawn one (OD-38)
    loadPinFacts: (atomicPartRevisionId, signal, role = "target") => loadPublishedSymbolPinFactsCancellable(sql(), atomicPartRevisionId, signal, role === "current" ? "historical" : "selectable"),
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
  role: ReplacementPinFactsRole = "target", // [B19-E E5]
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
    source.loadPinFacts(atomicPartRevisionId, controller.signal, role).then(
      (facts) => settle(facts),
      () => settle(null),
    );
  });
}
