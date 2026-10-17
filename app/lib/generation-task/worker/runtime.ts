/**
 * [PR-L, 2026-10-17] Runbook L.3, increment 3 part 2 (task-worker-contract.md section 4): the worker's composition - the production
 * ports, the continuation re-check (membership, role, provider), the process LLM meters, and the TRANSPORTS a worker process reaches
 * the durable task store through.
 *
 *  - `direct` (this increment): the worker process holds the durable repository itself (`getDurableWorkflowRepository()`: PostgreSQL
 *    through `DATABASE_URL`) and runs every slice in its own process. Refused - with nothing claimed - when `DATABASE_URL` is absent
 *    (`GENERATION_TASK_STORE_UNAVAILABLE`) or under the fixture runtime, whose in-memory store lives only in the dev server's process
 *    (`GENERATION_WORKER_NEEDS_PUMP`); a process-local store is never presented as a recoverable task store.
 *  - `pump` (SEAM, increment 4): each tick POSTs `/api/generation-worker` with the worker secret and the route claims and runs ONE slice
 *    inside the server, with the same slice code (`runGenerationSlice`). The route does not exist yet, so `createPumpTransport` refuses
 *    (`GENERATION_WORKER_PUMP_UNAVAILABLE`) instead of pretending to consume work.
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
import { isGenerationEditorRole } from "../contracts";
import { GenerationTaskStore, type GenerationSliceRevalidator } from "../store";
import type { GenerationLlmAdmission } from "./accounting";
import type { GenerationSliceReport } from "./slices";
import { GenerationWorker, type GenerationScopeRunner, type GenerationTickReport, type GenerationWorkerHealth } from "./worker";

/** The route that admits a generation task (increment 4): its provider calls are recorded under this route id (`withLlmCallScope`). */
export const GENERATION_TASK_ROUTE = Object.freeze({ routeId: "/api/generation-tasks", method: "POST" } as const);

export class GenerationWorkerSetupError extends Error {
  constructor(readonly code: "GENERATION_TASK_STORE_UNAVAILABLE" | "GENERATION_WORKER_NEEDS_PUMP" | "GENERATION_WORKER_PUMP_UNAVAILABLE" | "GENERATION_WORKER_MEMBERSHIP_UNAVAILABLE", message: string) {
    super(message);
    this.name = "GenerationWorkerSetupError";
  }
}

/** Why a DIRECT worker cannot run in this environment, or null. Reads the environment's names only, never prints a value. */
export function directWorkerRefusal(environment: Record<string, string | undefined>): GenerationWorkerSetupError | null {
  if (fixtureRuntimeEnabled(environment)) {
    return new GenerationWorkerSetupError("GENERATION_WORKER_NEEDS_PUMP", "The fixture runtime keeps the task store inside the dev server's process; a separate worker reaches it only through the HTTP pump (POST /api/generation-worker), which increment 4 builds. No slice was claimed.");
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

export interface GenerationTransportTick { tick: GenerationTickReport; slices: GenerationSliceReport[] }
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
  });
  return {
    mode: "direct",
    runOnce: () => worker.runOnce(),
    start: () => worker.start(),
    stop: async (stopOptions) => { await worker.stop(stopOptions); },
    health: () => ({ mode: "direct", ...worker.health() }),
  };
}

/**
 * SEAM (increment 4) - the HTTP pump transport. Under the fixture runtime the task store lives in the dev server's process, so a worker
 * process drives it by POSTing `/api/generation-worker` (`Authorization: Bearer $SIRKIT_WORKFLOW_WORKER_SECRET`, fail closed when unset;
 * the route is a canonical `workerRoute` that claims ONE slice and runs it to settlement with `runGenerationSlice`, bounded by the slice
 * window - the `/api/engineering-effects` precedent). That route is built with the other generation-task routes in increment 4; until
 * then this transport REFUSES rather than run a loop that consumes nothing.
 */
export function createPumpTransport(options: { origin: string }): GenerationWorkerTransport {
  throw new GenerationWorkerSetupError("GENERATION_WORKER_PUMP_UNAVAILABLE", `The HTTP pump transport needs POST ${options.origin}/api/generation-worker, which increment 4 builds; use the direct transport (DATABASE_URL, fixture runtime off). No slice was claimed.`);
}
