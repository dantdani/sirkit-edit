/**
 * [PR-M, 2026-10-18] Section M2: the composition root of the component-resolution task (the generation-task runtime's pattern,
 * app/lib/generation-task/runtime.ts): the durable repository, the task clock, the governance ids, the ADMITTED CAD source adapters, the
 * server reads the slices need - or null, and then nothing is accepted.
 *
 *  - Normal mode: the PostgreSQL durable-workflow repository when `DATABASE_URL` is set; without it NULL (503, nothing accepted). Sources:
 *    `kicad-bundled` (the pinned local checkout; refused per request when it is absent or not at the pin); `kicad-gitlab` is BLOCKED and
 *    is a recorded skip, never an adapter; `fixture-kicad` is refused (fixture only). Governance ids from the environment (OD-37); unset is
 *    the stated `governance_unconfigured` blocker (OD-M2-1).
 *  - Fixture runtime: the fixture container's in-memory repository and the UNFROZEN clock; sources `fixture-kicad` (the committed bytes
 *    through the production egress path and the fixture transport) - the bundled checkout is not consulted (fixture evidence stays
 *    fixture evidence); the FIXTURE governance ids of the container (`FIXTURE_CATALOG_GOVERNANCE`), never the environment's.
 *
 * The ADMITTED CAD source adapters and the worker's slice ports are in ./worker-runtime.ts (the only module of the task that reaches the
 * egress path): the routes that start, read and control a task compose THIS module and reach no network client.
 */
import { getDurableWorkflowRepository } from "../../durable-workflow/runtime";
import type { DurableWorkflowRepository } from "../../durable-workflow/types";
import { fixtureRuntimeEnabled } from "../../fixture-runtime/mode";
import { unfrozenNowMs } from "../../fixture-runtime/clock";
import { fixtureContainer } from "../../fixture-runtime/container";
import { atomicCatalogGovernanceProjectId, atomicCatalogGovernanceTenantId } from "../../atomic/publication-review";
import type { HandoffDeps } from "../acquisition/handoff";
import { ComponentResolutionTaskStore } from "./store";

export interface ComponentResolutionRuntime {
  repository: DurableWorkflowRepository;
  clock: () => number;
  durability: "durable" | "process-memory";
  fixture: boolean;
  governance: HandoffDeps["governance"];
  environment: Record<string, string | undefined>;
}
export type ComponentResolutionRuntimeFactory = () => ComponentResolutionRuntime | null;

function productionRuntime(environment: Record<string, string | undefined> = process.env): ComponentResolutionRuntime | null {
  if (fixtureRuntimeEnabled(environment)) return { repository: getDurableWorkflowRepository(), clock: unfrozenNowMs, durability: "process-memory", fixture: true, governance: { ...fixtureContainer().governance }, environment };
  if (!(environment.DATABASE_URL ?? "").trim()) return null;
  return { repository: getDurableWorkflowRepository(), clock: () => Date.now(), durability: "durable", fixture: false, governance: { tenantId: atomicCatalogGovernanceTenantId(environment), projectId: atomicCatalogGovernanceProjectId(environment) }, environment };
}

const DEFAULT_FACTORY: ComponentResolutionRuntimeFactory = () => productionRuntime();
let factory: ComponentResolutionRuntimeFactory = DEFAULT_FACTORY;
/** Test-only override; restore with `resetComponentResolutionRuntimeFactory`. */
export function setComponentResolutionRuntimeFactory(next: ComponentResolutionRuntimeFactory): void { factory = next; }
export function resetComponentResolutionRuntimeFactory(): void { factory = DEFAULT_FACTORY; }
/** The runtime, or null (no durable store here). Never throws. */
export function resolveComponentResolutionRuntime(): ComponentResolutionRuntime | null {
  try { return factory(); } catch { return null; }
}

export function componentResolutionStoreOf(runtime: ComponentResolutionRuntime): ComponentResolutionTaskStore {
  return new ComponentResolutionTaskStore({ repository: runtime.repository, clock: runtime.clock });
}

export function handoffDepsOf(runtime: ComponentResolutionRuntime): HandoffDeps {
  return { repository: runtime.repository, governance: runtime.governance, clock: runtime.clock };
}
