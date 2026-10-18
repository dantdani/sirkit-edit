/**
 * [PR-M, 2026-10-18] Section M2 (design M2.1): the agent's port onto the durable component-resolution task - the ONE module the chat
 * route's approved boundary (app/api/chat/cad-acquisition-runtime.ts) imports. It composes the SAME `ComponentResolutionService` the page
 * route answers from over the task's network-free runtime (the durable store; the CAD adapters are the worker's, never this port's) and
 * the chat route's catalog inspection port handed in. Null (both tools withheld) without a durable store or a catalog.
 */
import type { CatalogPartInspectionPort } from "../../agent/catalog-inspection-reads";
import type { CadAcquisitionPort } from "../../agent/cad-acquisition-reads";
import { ComponentResolutionService } from "./service";
import { resolveComponentResolutionRuntime } from "./runtime";

export function cadAcquisitionAgentPort(catalog: CatalogPartInspectionPort | null): CadAcquisitionPort | null {
  const runtime = resolveComponentResolutionRuntime();
  if (!runtime || !catalog) return null;
  const service = new ComponentResolutionService({ runtime, catalog });
  return { start: (scope, principal, input) => service.start(scope, principal, input), read: (scope, taskId) => service.read(scope, taskId), list: (scope) => service.list(scope) };
}
