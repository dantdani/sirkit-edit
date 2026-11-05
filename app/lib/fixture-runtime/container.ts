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
   *  acquisition queued) wakes the worker's idle pump request waiting in this process (`POST /api/generation-worker?hold=`);
   *  [PR-L7 verify, 2026-10-20] pump work only, and a slice re-queued for now as well (the repository below) */
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
  /** [PR-L7 verify, 2026-10-20] the waits now pending in this process (the held pump requests): 0 once every wait settled, however it
   *  ended - no waiter, timer or abort listener outlives its wait (`l7-pump-idle-backoff` 10 and 11) */
  waiting(): number;
}

export function createFixtureWorkSignal(): FixtureWorkSignal {
  let version = 0;
  const waiters = new Set<() => void>();
  return {
    version: () => version,
    waiting: () => waiters.size, // [PR-L7 verify, 2026-10-20]
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

/** [PR-L7 verify, 2026-10-20] The outbox topics the pump claims - `GENERATION_SLICE_TOPIC` (generation-task/contracts.ts) and
 *  `COMPONENT_RESOLUTION_SLICE_TOPIC` (component-resolution/task/contracts.ts), spelled here because this module's runtime closure is
 *  pinned (`b24-c1-llm-call-record`: parts-search.ts reaches it); `l7-pump-idle-backoff` 12 pins the two equal to the contracts'. */
export const FIXTURE_PUMP_TOPICS: readonly string[] = Object.freeze(["generation-task.slice", "component-resolution-slice"]);

/** [PR-L7, 2026-10-20] The fixture's in-memory repository with the nudge: a first (not replayed) commit that carries outbox effects
 *  notifies the work signal after it is stored. Every read, write and fence is the parent's. [PR-L7 verify, 2026-10-20] Only effects
 *  on a topic the pump claims wake it (an execution grant's or an autonomy change's audit effects never did any pump work), and an
 *  event re-queued for NOW - a released slice's immediate takeover (`releaseSlice` of either store), or a not-before that has already
 *  passed - wakes it too: `failOutbox` makes that work claimable without a commit that carries effects. Work that falls due LATER (a
 *  provider wait's `notBefore`, a review recheck, a lapsed lease) is not signalled: a held request picks it up when its hold ends. */
class NudgingInMemoryDurableWorkflowRepository extends InMemoryDurableWorkflowRepository {
  constructor(private readonly work: FixtureWorkSignal) { super(); }
  override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
    const committed = await super.commit(request);
    if (!committed.idempotent && request.outbox.some((effect) => FIXTURE_PUMP_TOPICS.includes(effect.topic))) this.work.notify(); // [PR-L7 verify, 2026-10-20] was: any outbox effect
    return committed;
  }
  /** [PR-L7 verify, 2026-10-20] a non-terminal re-queue whose retry is due at once wakes held requests; only the pump's two stores
   *  re-queue for now (the generic `DurableOutboxDispatcher` always retries later), so no topic test is needed here */
  override async failOutbox(input: Parameters<InMemoryDurableWorkflowRepository["failOutbox"]>[0]): Promise<void> {
    await super.failOutbox(input);
    if (!input.terminal && Date.parse(input.retryAt) <= Date.parse(input.failedAt)) this.work.notify();
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
