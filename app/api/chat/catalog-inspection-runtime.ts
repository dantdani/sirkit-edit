/**
 * [PR-D d2] The chat route's ONE approved boundary to the parts catalog: the server resolver for the port behind
 * `sirkit.parts.catalog-inspect`. The port runs `loadCatalogPartDetail` - the SAME function `GET /api/parts/[id]` answers the browser's
 * part cache with (app/lib/atomic/catalog-part-detail.ts) - and `loadAtomicRevisionStatus` (app/lib/atomic/server-catalog.ts) for the
 * part's linked exact revisions; the agent layer (app/lib/agent/catalog-inspection-reads.ts) never imports either, it is handed this
 * port by the chat route exactly as the external reads, the named computations and the Build-mode generation are.
 *
 * Mirrors schematic-generation-runtime.ts: the default is the REAL production port, failing CLOSED to null when no catalog can answer -
 * the fixture runtime always can (the committed blinker catalog, no database), otherwise the database must be configured on the
 * server (the connection setting's presence; its value is never read here). Off, the tool is withheld from the run (the fact is false;
 * discovery never advertises the catalog authority). A test setter exists with a deterministic reset; it is never a production path.
 * The parts route reads nothing from here.
 */
import { loadCatalogPartDetail } from "@/app/lib/atomic/catalog-part-detail";
import { loadAtomicRevisionStatus } from "@/app/lib/atomic/server-catalog";
import type { AtomicRevisionStatus } from "@/app/lib/atomic/revision-status";
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
import type { CatalogPartInspectionPort } from "@/app/lib/agent/catalog-inspection-reads";

export type CatalogInspectionPortFactory = () => CatalogPartInspectionPort | null;

/** The server setting that configures the catalog database (presence decides availability; the value is never read here). */
export const CATALOG_DATABASE_SETTING = "DATABASE_URL" as const;

/** Whether a catalog part can be read here: the fixture runtime (the committed catalog), or the database is configured. */
export function catalogInspectionServable(environment: Record<string, string | undefined> = process.env): boolean {
  if (fixtureRuntimeEnabled(environment)) return true;
  return (environment[CATALOG_DATABASE_SETTING] ?? "").trim().length > 0;
}

const PRODUCTION_PORT: CatalogPartInspectionPort = {
  inspect: async (request) => {
    try {
      const detail = await loadCatalogPartDetail(request.partId);
      if (!detail) return { state: "not_found" };
      const revisionIds = Object.values(detail.atomicAssignments ?? {}).map((assignment) => assignment.revisionId);
      const statuses = revisionIds.length > 0 ? await loadAtomicRevisionStatus(revisionIds) : new Map<string, AtomicRevisionStatus>();
      return { state: "found", detail, revisionStatus: Object.fromEntries(statuses) };
    } catch {
      return { state: "failed", code: "CATALOG_UNAVAILABLE" }; // a database failure: a closed code, never its message
    }
  },
};

const DEFAULT_FACTORY: CatalogInspectionPortFactory = () => (catalogInspectionServable() ? PRODUCTION_PORT : null);
let portFactory: CatalogInspectionPortFactory = DEFAULT_FACTORY;

/** Test-only override; restore via `resetCatalogInspectionPortFactory`. */
export function setCatalogInspectionPortFactory(factory: CatalogInspectionPortFactory): void {
  portFactory = factory;
}

/** Restore the production default (deterministic test isolation). */
export function resetCatalogInspectionPortFactory(): void {
  portFactory = DEFAULT_FACTORY;
}

/** Resolve the port for one run, or null to withhold the catalog inspection. Never throws. */
export function resolveCatalogInspectionPort(): CatalogPartInspectionPort | null {
  try {
    return portFactory();
  } catch {
    return null;
  }
}
