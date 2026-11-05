/**
 * [PR-M, 2026-10-18] The ONE server boundary to the PUBLISHED REVISION EVIDENCE of the component resolution (moved verbatim out of
 * component-resolution-runtime.ts, which composes it with the catalog search): for each revision id, its published, never-withdrawn
 * portable snapshot (`loadSelectablePortableSnapshot`, app/lib/atomic/server-catalog.ts) projected to the bounded evidence
 * (`publishedRevisionEvidenceOf`), and the catalog status of every id (`loadAtomicRevisionStatus`). A withdrawn, unpublished or unknown
 * revision has no evidence (null). Servable wherever the catalog is (the fixture runtime's committed catalog, or a configured database).
 *
 * Its own module so the reviewed apply's fresh-facts endpoint (app/api/component-resolution-authority/route.ts) reads the SAME port the
 * chat run's proposal was assembled from WITHOUT importing the catalog search (the Build loop's provider-backed recall): that endpoint
 * spends no provider credit and sends nothing to a model, and its import closure says so. A failure is a closed code, never its message.
 */
import { loadAtomicRevisionStatus, loadSelectablePortableSnapshot } from "@/app/lib/atomic/server-catalog";
import { publishedRevisionEvidenceOf, type PublishedRevisionEvidence, type RevisionEvidencePort } from "@/app/lib/component-resolution/evidence";
import { catalogInspectionServable } from "./catalog-inspection-runtime";

/** At most this many revisions per evidence call (a resolution batch is at most 20 items; a search classifies at most 10 hits). */
export const MAX_EVIDENCE_REVISIONS_PER_CALL = 64;

export const PRODUCTION_EVIDENCE_PORT: RevisionEvidencePort = {
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

/** The evidence port where the catalog can be read here (the fixture runtime, or a configured database); undefined otherwise. Never throws. */
export function resolveRevisionEvidencePort(): RevisionEvidencePort | undefined {
  try {
    return catalogInspectionServable() ? PRODUCTION_EVIDENCE_PORT : undefined;
  } catch {
    return undefined;
  }
}
