/**
 * [PR-M, 2026-10-18] Section M2 (design M2.1): the chat route's ONE approved boundary to the schematic-scoped CAD acquisition - the port
 * behind `sirkit.parts.acquisition-start` and `sirkit.parts.acquisition-status`. It imports exactly one module, the agent port
 * (app/lib/component-resolution/task/agent-port.ts): the SAME `ComponentResolutionService` the page route (`/api/parts/acquisitions`)
 * answers from, over the task's network-free composition (the durable task store, never the CAD adapters - the worker runs those in its
 * own slices) and the chat route's catalog inspection port, handed in by the route (one resolution per run).
 *
 * Mirrors catalog-inspection-runtime.ts: the default is the REAL production port, failing CLOSED to null when there is no durable task
 * store (normal mode without `DATABASE_URL`) or no catalog; null withholds both tools (the run's fact is false). A test setter exists with
 * a deterministic reset; it is never a production path.
 */
import { cadAcquisitionAgentPort } from "@/app/lib/component-resolution/task/agent-port";
import type { CadAcquisitionPort } from "@/app/lib/agent/cad-acquisition-reads";
import type { CatalogPartInspectionPort } from "@/app/lib/agent/catalog-inspection-reads";

export type CadAcquisitionPortFactory = (catalog: CatalogPartInspectionPort | null) => CadAcquisitionPort | null;

const DEFAULT_FACTORY: CadAcquisitionPortFactory = (catalog) => cadAcquisitionAgentPort(catalog);
let portFactory: CadAcquisitionPortFactory = DEFAULT_FACTORY;

/** Test-only override; restore via `resetCadAcquisitionPortFactory`. */
export function setCadAcquisitionPortFactory(factory: CadAcquisitionPortFactory): void { portFactory = factory; }
/** Restore the production default (deterministic test isolation). */
export function resetCadAcquisitionPortFactory(): void { portFactory = DEFAULT_FACTORY; }
/** Resolve the port for one run (over the run's catalog port), or null to withhold the acquisition tools. Never throws. */
export function resolveCadAcquisitionPort(catalog: CatalogPartInspectionPort | null): CadAcquisitionPort | null {
  try { return portFactory(catalog); } catch { return null; }
}
