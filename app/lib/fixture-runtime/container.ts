/**
 * [B16-C §5] The fixture runtime's in-process container: ONE set of in-memory
 * stores and one catalog per Node process, anchored on `globalThis` because a
 * Next.js server compiles every route into its own module graph — a plain
 * module-level singleton would give each route bundle a different store and
 * the browser flow would "lose" its board between requests.
 *
 * Only reachable when `fixtureRuntimeEnabled()`; every accessor throws
 * otherwise, so no production path can touch fixture state by accident.
 */

import { InMemoryDurableWorkflowRepository } from "../durable-workflow/repository";
import { InMemoryPhysicalBindingRepository } from "../physical-binding/repository";
import { fixtureRuntimeEnabled } from "./mode";
import { blinkerCatalog, type BlinkerCatalog } from "./blinker/catalog";

interface FixtureContainer {
  durableRepository: InMemoryDurableWorkflowRepository;
  physicalBindingRepository: InMemoryPhysicalBindingRepository;
  catalog: BlinkerCatalog;
  /** Observed router executions (placed-board revisions), for the harness's evidence. */
  routerExecutions: string[];
  createdAt: string;
}

const KEY = "__sirkitFixtureRuntimeContainer__" as const;

function create(): FixtureContainer {
  return {
    durableRepository: new InMemoryDurableWorkflowRepository(),
    physicalBindingRepository: new InMemoryPhysicalBindingRepository(),
    catalog: blinkerCatalog(),
    routerExecutions: [],
    createdAt: new Date().toISOString(),
  };
}

export function fixtureContainer(): FixtureContainer {
  if (!fixtureRuntimeEnabled()) throw new Error("FIXTURE_RUNTIME_DISABLED");
  const host = globalThis as unknown as Record<string, FixtureContainer | undefined>;
  host[KEY] ??= create();
  return host[KEY];
}

/** Drop the container (a fresh browser session in the harness starts from nothing durable). */
export function resetFixtureContainer(): void {
  const host = globalThis as unknown as Record<string, FixtureContainer | undefined>;
  delete host[KEY];
}
