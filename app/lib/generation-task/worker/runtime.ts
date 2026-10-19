/**
 * [PR-L, 2026-10-17] Runbook L.3, increment 3 part 2 (task-worker-contract.md section 4): the worker's composition - the production
 * ports, the continuation re-check (membership, role, provider), the process LLM meters, and the TRANSPORTS a worker process reaches
 * the durable task store through.
 *
 *  - `direct` (this increment): the worker process holds the durable repository itself (`getDurableWorkflowRepository()`: PostgreSQL
 *    through `DATABASE_URL`) and runs every slice in its own process. Refused - with nothing claimed - when `DATABASE_URL` is absent
 *    (`GENERATION_TASK_STORE_UNAVAILABLE`) or under the fixture runtime, whose in-memory store lives only in the dev server's process
 *    (`GENERATION_WORKER_NEEDS_PUMP`); a process-local store is never presented as a recoverable task store.
 *  - `pump` ([PR-L, 2026-10-17] increment 4, was a refusing seam): each tick POSTs `/api/generation-worker` with the worker secret
 *    (`Authorization: Bearer`), and the route claims and runs ONE slice inside the server to its settlement (`runPumpedSlice`, the same
 *    `GenerationWorker` and slice code as `direct`), awaited and bounded by the slice window. This is the transport the fixture runtime
 *    needs (its store lives only in the dev server's process); it works against any server whose route is enabled behind the secret. The
 *    client loop is `pump-transport.ts` (the worker script's only), so no route's closure reaches a network client through this module.
 *
 * Continuation re-check (section 3.2 step 3, L.3 "revalidate membership ... at continuation"): before ANY provider call of every slice,
 * the initiating principal's live membership and role are read again; a revoked or demoted principal's task becomes `failed` /
 * `authority_revoked` (the store commits it), and a provider whose key is gone is `waiting-for-resource` / `provider_credentials`.
 */
import { getDurableWorkflowRepository } from "../../durable-workflow/runtime";
import { productionBuildCatalogPort, productionBuildLlmPort } from "../../build-loop";
import { resolveMembershipRepository } from "../../auth/identity-runtime";
import { projectRoleFromMembership, type ProjectMembershipRepository } from "../../auth/project-membership";
import { fixtureRuntimeEnabled } from "../../fixture-runtime/mode";
import { recordLlmProviderOutcome, requestLlmProviderAdmission, type LlmProviderTicket } from "../../acquisition/admission-control";
import type { LLMProviderId } from "../../llm/types";
import { isGenerationEditorRole, type GenerationTaskScope } from "../contracts";
import { GenerationTaskStore, type GenerationSliceRevalidator } from "../store";
import type { GenerationLlmAdmission } from "./accounting";
import { GenerationWorker, type FencedTopicRunner, type GenerationScopeRunner, type GenerationTickReport, type GenerationWorkerHealth, type WorkerSliceReport } from "./worker";
import type { GenerationSlicePorts } from "./slices";
import { fixtureGenerationCatalogPort, fixtureGenerationLlmPort } from "../../fixture-runtime/generation-ports";
import { isoOf } from "../vocabulary";

/** The route that admits a generation task (increment 4): its provider calls are recorded under this route id (`withLlmCallScope`). */
export const GENERATION_TASK_ROUTE = Object.freeze({ routeId: "/api/generation-tasks", method: "POST" } as const);

export class GenerationWorkerSetupError extends Error {
  // [PR-L, 2026-10-17] GENERATION_WORKER_PUMP_UNAVAILABLE (the refusing pump seam of increment 3) is gone with the seam: the pump refuses only without its secret
  constructor(readonly code: "GENERATION_TASK_STORE_UNAVAILABLE" | "GENERATION_WORKER_NEEDS_PUMP" | "GENERATION_WORKER_MEMBERSHIP_UNAVAILABLE" | "GENERATION_WORKER_SECRET_UNSET", message: string) {
    super(message);
    this.name = "GenerationWorkerSetupError";
  }
}

/** Why a DIRECT worker cannot run in this environment, or null. Reads the environment's names only, never prints a value. */
export function directWorkerRefusal(environment: Record<string, string | undefined>): GenerationWorkerSetupError | null {
  if (fixtureRuntimeEnabled(environment)) {
    return new GenerationWorkerSetupError("GENERATION_WORKER_NEEDS_PUMP", "The fixture runtime keeps the task store inside the dev server's process; a separate worker reaches it only through the HTTP pump: --transport pump --origin <the dev server> (POST /api/generation-worker). No slice was claimed.");
  }
  if (!(environment.DATABASE_URL ?? "").trim()) {
    return new GenerationWorkerSetupError("GENERATION_TASK_STORE_UNAVAILABLE", "DATABASE_URL is not set, so the durable task store is unavailable and there is nothing a worker can consume. No slice was claimed.");
  }
  return null;
}

/** Section 3.2 step 3: the initiating principal still holds an editor role on the task's project, and the provider is servable. */
export function createGenerationSliceRevalidator(input: { membership: () => ProjectMembershipRepository | null; providerServable: (provider: LLMProviderId) => boolean }): GenerationSliceRevalidator {
  return async (task) => {
    const repository = input.membership();
    // without the membership authority the worker cannot check: refuse to run (the slice is retried, then platform_failure)
    if (!repository) throw new GenerationWorkerSetupError("GENERATION_WORKER_MEMBERSHIP_UNAVAILABLE", "The membership repository is unavailable; no slice runs without its authority check.");
    const membership = await repository.loadActiveMembership({ tenantId: task.scope.tenantId, projectId: task.scope.projectId, userId: task.initiator.principalId });
    if (!membership) return { ok: false, failure: "authority_revoked" };
    if (!isGenerationEditorRole(projectRoleFromMembership(membership.role))) return { ok: false, failure: "authority_revoked" };
    if (!input.providerServable(task.request.provider)) return { ok: false, blocker: "provider_credentials" };
    return { ok: true };
  };
}

/** The process LLM meters (acquisition/admission-control.ts) with purpose `agent` (section 5); per process - the durable allowance is
 *  the cross-process bound. */
export const PROCESS_GENERATION_ADMISSION: GenerationLlmAdmission = Object.freeze({
  request(provider: LLMProviderId, now: number) {
    const admitted = requestLlmProviderAdmission({ kind: "llm-provider", provider }, now, "agent");
    return admitted.allowed ? { allowed: true as const, ticket: admitted.ticket } : { allowed: false as const, retryAtMs: admitted.retryAtMs };
  },
  record(provider: LLMProviderId, ticket: unknown, outcome: Parameters<GenerationLlmAdmission["record"]>[2], now: number) {
    recordLlmProviderOutcome({ kind: "llm-provider", provider }, ticket as LlmProviderTicket, outcome, now);
  },
});

// ─── Transports ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GenerationTransportTick { tick: GenerationTickReport; slices: WorkerSliceReport[] } // [PR-M, 2026-10-18] M2: a topic slice settles here too
/** How a worker process reaches the queued work: one interface, two transports (section 4). */
export interface GenerationWorkerTransport {
  readonly mode: "direct" | "pump";
  /** one tick and the settlement of what it started (`--once`) */
  runOnce(): Promise<GenerationTransportTick>;
  /** run until `stop` */
  start(): void;
  /** stop claiming; running slices yield at a boundary, the rest are released after the grace */
  stop(options?: { graceMs?: number }): Promise<void>;
  health(): GenerationWorkerHealth & { mode: "direct" | "pump" };
}

export interface DirectTransportOptions {
  workerId: string;
  concurrency?: number;
  /** `schematicGenerationServable` (app/api/chat/schematic-generation-runtime.ts), injected by the composition root */
  providerServable: (provider: LLMProviderId) => boolean;
  runInScope?: GenerationScopeRunner;
  log?: (line: string) => void;
  environment?: Record<string, string | undefined>;
  /** [PR-M, 2026-10-18] M2: other durable topics the worker consumes (the component-resolution slices) */
  topics?: readonly FencedTopicRunner[];
  /** [PR-L6, 2026-10-19] OD-253 item 6: the worker's `--scope` (both topics); absent: every scope */
  scope?: GenerationTaskScope;
}
/** The direct transport over the process's durable repository and the production ports. Throws a setup refusal with nothing claimed. */
export function createDirectTransport(options: DirectTransportOptions): GenerationWorkerTransport {
  const refusal = directWorkerRefusal(options.environment ?? process.env);
  if (refusal) throw refusal;
  if (!resolveMembershipRepository()) throw new GenerationWorkerSetupError("GENERATION_WORKER_MEMBERSHIP_UNAVAILABLE", "The membership repository is unavailable; no slice runs without its authority check. No slice was claimed.");
  const store = new GenerationTaskStore({ repository: getDurableWorkflowRepository() });
  const worker = new GenerationWorker({
    store, workerId: options.workerId,
    ports: { llm: productionBuildLlmPort(), catalog: productionBuildCatalogPort(), admission: PROCESS_GENERATION_ADMISSION },
    revalidate: createGenerationSliceRevalidator({ membership: resolveMembershipRepository, providerServable: options.providerServable }),
    ...(options.concurrency !== undefined ? { policy: { concurrency: options.concurrency } } : {}),
    ...(options.runInScope ? { runInScope: options.runInScope } : {}),
    ...(options.log ? { log: options.log } : {}),
    ...(options.topics ? { topics: options.topics } : {}),
    ...(options.scope ? { scope: options.scope } : {}),
  });
  return {
    mode: "direct",
    runOnce: () => worker.runOnce(),
    start: () => worker.start(),
    stop: async (stopOptions) => { await worker.stop(stopOptions); },
    health: () => ({ mode: "direct", ...worker.health() }),
  };
}

// ─── [PR-L, 2026-10-17] The pump (increment 4) ───────────────────────────────────────────────────────────────────────────

/** The route the pump transport drives. */
export const GENERATION_WORKER_PUMP_ROUTE = Object.freeze({ path: "/api/generation-worker", method: "POST" } as const);

/** The slice ports a server-side slice uses: the fixture runtime's scripted provider and committed catalog (zero credits), or the
 *  production ports with the process meters. A test setter exists with a deterministic reset; it is never a production path. */
export type GenerationSlicePortsFactory = () => GenerationSlicePorts;
const DEFAULT_PORTS_FACTORY: GenerationSlicePortsFactory = () => (fixtureRuntimeEnabled()
  ? { llm: fixtureGenerationLlmPort(), catalog: fixtureGenerationCatalogPort() }
  : { llm: productionBuildLlmPort(), catalog: productionBuildCatalogPort(), admission: PROCESS_GENERATION_ADMISSION });
let portsFactory: GenerationSlicePortsFactory = DEFAULT_PORTS_FACTORY;
export function setGenerationSlicePortsFactory(factory: GenerationSlicePortsFactory): void { portsFactory = factory; }
export function resetGenerationSlicePortsFactory(): void { portsFactory = DEFAULT_PORTS_FACTORY; }
export function resolveGenerationSlicePorts(): GenerationSlicePorts { return portsFactory(); }

export interface PumpedSliceInput {
  store: GenerationTaskStore;
  ports: GenerationSlicePorts;
  revalidate: GenerationSliceRevalidator;
  /** the task clock - the SAME clock the store uses */
  clock: () => number;
  /** the pump request's signal: an aborted request (the pump worker stopping, or its request bound) is a worker SHUTDOWN - running
   *  slices yield at their next turn boundary and the rest are released after the grace - never the user's cancel */
  signal?: AbortSignal;
  runInScope?: GenerationScopeRunner;
  workerId?: string;
  graceMs?: number;
  log?: (line: string) => void;
  /** [PR-M, 2026-10-18] M2: other durable topics (the component-resolution slices) the one pumped slice may come from */
  topics?: readonly FencedTopicRunner[];
}
export interface PumpedSliceAnswer { tick: GenerationTickReport; ran: WorkerSliceReport | null }

/** The SERVER side of the pump: claim at most ONE slice and run it to its settlement, awaited, inside this request (the slice window
 *  bounds it). The same `GenerationWorker`, claim, fencing, lease renewal and slice code as the direct transport. */
export async function runPumpedSlice(input: PumpedSliceInput): Promise<PumpedSliceAnswer> {
  const workerId = input.workerId ?? `generation-pump-${Math.floor(input.clock()).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  if (input.signal?.aborted) return { tick: { at: isoOf(input.clock()), claims: [], started: [] }, ran: null };
  const worker = new GenerationWorker({
    store: input.store, workerId, ports: input.ports, revalidate: input.revalidate, clock: input.clock, policy: { concurrency: 1 },
    ...(input.runInScope ? { runInScope: input.runInScope } : {}), ...(input.log ? { log: input.log } : {}), ...(input.topics ? { topics: input.topics } : {}),
  });
  const onAbort = (): void => { void worker.stop({ graceMs: input.graceMs ?? 10_000 }); };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const { tick, slices } = await worker.runOnce();
    return { tick, ran: slices[0] ?? null };
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
  }
}

/** [PR-L, 2026-10-17] The pump's CLIENT side (`createPumpTransport`, the worker process's HTTP loop) lives in `pump-transport.ts`, imported
 *  only by the worker script: no route reaches a network client through this module (the B23 transport census). */
