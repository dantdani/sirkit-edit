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
import type { DurableCommitRequest, DurableCommitResult } from "../durable-workflow/types"; // [PR-L7, 2026-10-20] the nudging repository
import { InMemoryPhysicalBindingRepository } from "../physical-binding/repository";
import { fixtureRuntimeEnabled } from "./mode";
import { installFixtureClock, uninstallFixtureClock } from "./clock";
import { fixtureRuntimeCatalog, type BlinkerCatalog } from "./blinker/catalog"; // [PR-M, 2026-10-18] the blinker catalog plus the two resolution records (an unresolved 1N4148, a published 1N4148W)

interface FixtureContainer {
  durableRepository: InMemoryDurableWorkflowRepository;
  physicalBindingRepository: InMemoryPhysicalBindingRepository;
  catalog: BlinkerCatalog;
  /** Observed router executions (placed-board revisions), for the harness's evidence. */
  routerExecutions: string[];
  /** [PR-M, 2026-10-18] M2: the FIXTURE catalog governance project (OD-37's ids for the fixture runtime only; never the environment's) */
  governance: { tenantId: string; projectId: string };
  /** [PR-L7, 2026-10-20] the in-process nudge: a durable commit that schedules outbox work (a task started, resumed, retried; an
   *  acquisition queued) wakes the worker's idle pump request waiting in this process (`POST /api/generation-worker?hold=`) */
  work: FixtureWorkSignal;
  createdAt: string;
}

/** [PR-L7, 2026-10-20] The fixture's in-process work signal: `notify` bumps a version and wakes every waiter; `wait` resolves true at
 *  once when the version moved past `since` (a commit between the waiter's empty tick and its wait is never missed), true on a later
 *  notify, false when `ms` elapse or the request goes away. No timer outlives a waiter. */
export interface FixtureWorkSignal {
  version(): number;
  notify(): void;
  wait(ms: number, input: { since: number; signal?: AbortSignal }): Promise<boolean>;
}

export function createFixtureWorkSignal(): FixtureWorkSignal {
  let version = 0;
  const waiters = new Set<() => void>();
  return {
    version: () => version,
    notify: () => { version += 1; for (const wake of [...waiters]) wake(); },
    wait: (ms, input) => new Promise<boolean>((resolve) => {
      if (version !== input.since) return resolve(true);
      if (!(ms > 0) || input.signal?.aborted) return resolve(false);
      const settle = (woken: boolean): void => { clearTimeout(timer); waiters.delete(wake); input.signal?.removeEventListener("abort", aborted); resolve(woken); };
      const wake = (): void => settle(true);
      const aborted = (): void => settle(false);
      const timer = setTimeout(() => settle(false), ms);
      waiters.add(wake);
      input.signal?.addEventListener("abort", aborted, { once: true });
    }),
  };
}

/** [PR-L7, 2026-10-20] The fixture's in-memory repository with the nudge: a first (not replayed) commit that carries outbox effects
 *  notifies the work signal after it is stored. Every read, write and fence is the parent's. */
class NudgingInMemoryDurableWorkflowRepository extends InMemoryDurableWorkflowRepository {
  constructor(private readonly work: FixtureWorkSignal) { super(); }
  override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
    const committed = await super.commit(request);
    if (!committed.idempotent && request.outbox.length > 0) this.work.notify();
    return committed;
  }
}

/** [PR-M, 2026-10-18] M2: the fixture runtime's catalog governance project - where the browser proof's reviewer and administrator act. */
export const FIXTURE_CATALOG_GOVERNANCE = Object.freeze({ tenantId: "local", projectId: "m2-fixture-catalog-governance" });

const KEY = "__sirkitFixtureRuntimeContainer__" as const;

function create(): FixtureContainer {
  installFixtureClock(); // [B16-C.5] frozen clock before the first durable identity (idempotent; instrumentation.ts installs it at start-up)
  const work = createFixtureWorkSignal(); // [PR-L7, 2026-10-20]
  return {
    durableRepository: new NudgingInMemoryDurableWorkflowRepository(work), // [PR-L7, 2026-10-20] was the plain in-memory repository: the same store, plus the nudge
    physicalBindingRepository: new InMemoryPhysicalBindingRepository(),
    catalog: fixtureRuntimeCatalog(),
    routerExecutions: [],
    governance: { ...FIXTURE_CATALOG_GOVERNANCE },
    work,
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
  uninstallFixtureClock(); // a fresh container is a fresh runtime: the clock follows it (tests)
}
