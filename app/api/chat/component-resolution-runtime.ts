/**
 * [PR-M, 2026-10-17] The chat route's ONE approved boundary to the component resolution's server facts (section M.2): the two ports
 * behind `sirkit.parts.candidate-search` and `sirkit.schematic.propose-component-resolution`, beside the catalog inspection port
 * they share (app/api/chat/catalog-inspection-runtime.ts). The agent layer (app/lib/agent/candidate-search-reads.ts,
 * app/lib/agent/component-resolution-proposals.ts) never imports a database reader or the search; it is handed these ports.
 *
 *  - the REVISION EVIDENCE port: for each revision id, its published, never-withdrawn portable snapshot
 *    (`loadSelectablePortableSnapshot`, app/lib/atomic/server-catalog.ts - the read a new selection or binding uses) projected to the
 *    bounded evidence (`publishedRevisionEvidenceOf`), and the catalog status of every id (`loadAtomicRevisionStatus`). A withdrawn,
 *    unpublished or unknown revision has no evidence (null). Servable wherever the catalog is (the fixture runtime's committed catalog,
 *    or a configured database);
 *  - the CATALOG SEARCH port: the Build loop's own hybrid recall (`searchPartsForAI`, app/lib/parts-search.ts: an embedding of the
 *    query on the server's provider account, the lexical and authority channels, the catalog's category vocabulary and the reranker
 *    refusal memo). It needs the catalog DATABASE (the search has no fixture branch), so it is bound only with a configured database
 *    outside the fixture runtime; the agent's per-run limit (3 searches) bounds its provider spend.
 *
 * Mirrors catalog-inspection-runtime.ts: the default is the REAL production port, failing CLOSED to undefined; a failure is a closed
 * code, never its message. A test setter exists with a deterministic reset; it is never a production path.
 */
import { searchPartsForAI, type PartsSearchOutcome } from "@/app/lib/parts-search";
import { loadAtomicRevisionStatus, loadSelectablePortableSnapshot } from "@/app/lib/atomic/server-catalog";
import { publishedRevisionEvidenceOf, type CatalogSearchPort, type PublishedRevisionEvidence, type RevisionEvidencePort } from "@/app/lib/component-resolution/evidence";
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
import { CATALOG_DATABASE_SETTING, catalogInspectionServable } from "./catalog-inspection-runtime";

export interface ComponentResolutionPorts { evidence?: RevisionEvidencePort; search?: CatalogSearchPort }
export type ComponentResolutionPortsFactory = () => ComponentResolutionPorts;

/** At most this many revisions per evidence call (a resolution batch is at most 20 items; a search classifies at most 10 hits). */
export const MAX_EVIDENCE_REVISIONS_PER_CALL = 64;

const PRODUCTION_EVIDENCE_PORT: RevisionEvidencePort = {
  load: async (request) => {
    try {
      const ids = [...new Set(request.revisionIds)].slice(0, MAX_EVIDENCE_REVISIONS_PER_CALL);
      const evidence: Record<string, PublishedRevisionEvidence | null> = {};
      for (const id of ids) {
        if (request.signal.aborted) return { state: "failed", code: "EVIDENCE_CANCELLED" };
        const snapshot = await loadSelectablePortableSnapshot(id);
        evidence[id] = snapshot && snapshot.atomicRevision.id === id ? publishedRevisionEvidenceOf(snapshot) : null;
      }
      const statuses = await loadAtomicRevisionStatus(ids);
      return { state: "ok", evidence, status: Object.fromEntries(statuses) };
    } catch {
      return { state: "failed", code: "EVIDENCE_UNAVAILABLE" };
    }
  },
};

const PRODUCTION_SEARCH_PORT: CatalogSearchPort = {
  search: async (request) => {
    try {
      let outcome: PartsSearchOutcome | null = null;
      const results = await searchPartsForAI(request.query, request.category ?? undefined, request.limit, { signal: request.signal, onOutcome: (reported) => { outcome = reported; } });
      const reported = outcome as PartsSearchOutcome | null;
      return {
        state: "ok",
        hits: results.map((result) => ({ partId: result.partId, name: result.name, mpn: result.mpn, mainCategory: result.mainCategory, similarity: result.similarity, pinCount: result.pins.length })),
        category: reported ? { status: reported.category.status, applied: reported.category.applied, note: reported.category.note } : null,
        ranking: reported?.ranking ?? "unknown",
      };
    } catch {
      return { state: "failed", code: "CATALOG_SEARCH_UNAVAILABLE" };
    }
  },
};

/** Whether the local catalog search can run here: a configured catalog database outside the fixture runtime. */
export function catalogSearchServable(environment: Record<string, string | undefined> = process.env): boolean {
  if (fixtureRuntimeEnabled(environment)) return false;
  return (environment[CATALOG_DATABASE_SETTING] ?? "").trim().length > 0;
}

const DEFAULT_FACTORY: ComponentResolutionPortsFactory = () => ({
  ...(catalogInspectionServable() ? { evidence: PRODUCTION_EVIDENCE_PORT } : {}),
  ...(catalogSearchServable() ? { search: PRODUCTION_SEARCH_PORT } : {}),
});
let portsFactory: ComponentResolutionPortsFactory = DEFAULT_FACTORY;

/** Test-only override; restore via `resetComponentResolutionPortsFactory`. */
export function setComponentResolutionPortsFactory(factory: ComponentResolutionPortsFactory): void {
  portsFactory = factory;
}

/** Restore the production default (deterministic test isolation). */
export function resetComponentResolutionPortsFactory(): void {
  portsFactory = DEFAULT_FACTORY;
}

/** Resolve the ports for one run (each absent to withhold what needs it). Never throws. */
export function resolveComponentResolutionPorts(): ComponentResolutionPorts {
  try {
    return portsFactory();
  } catch {
    return {};
  }
}
