/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md sections 4 and 6): the composition root of the generation-task
 * STORE for the routes (the orchestration store's pattern, F16): the durable repository the task records live in, the task clock and
 * what kind of durability that is - or null, and then nothing is accepted.
 *
 *  - Normal mode: the PostgreSQL durable-workflow repository when `DATABASE_URL` is set (durable across restarts); without it, NULL -
 *    the routes answer `503 GENERATION_TASK_STORE_UNAVAILABLE` and accept nothing. A process-local fallback is never advertised as a
 *    recoverable task store.
 *  - Fixture runtime: the fixture container's in-memory repository (the dev server's process; lost when it restarts - labelled
 *    `process-memory`) and the UNFROZEN clock (`unfrozenNowMs`): the fixture freezes `Date.now()`, and leases, liveness and the pickup
 *    grace must still move with real time.
 *
 * A test setter exists with a deterministic reset; it is never a production path. Never throws.
 */
import { getDurableWorkflowRepository } from "../durable-workflow/runtime";
import type { DurableWorkflowRepository } from "../durable-workflow/types";
import { EMBEDDING_MODEL } from "../embeddings";
import { durableWorkflowDigest } from "../durable-workflow/stable";
import { unfrozenNowMs } from "../fixture-runtime/clock";
import { fixtureRuntimeEnabled } from "../fixture-runtime/mode";
import type { LLMProviderId } from "../llm/types";
import { BUILD_SUBSYSTEM_SYSTEM_PROMPT, BUILD_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT } from "../prompts";
import { GenerationTaskService, type GenerationTaskDurability } from "./service";
import { GenerationTaskStore, type GenerationTaskStartInput } from "./store";
import type { GenerationCatalogProfile } from "./vocabulary";

export interface GenerationTaskRuntime {
  repository: DurableWorkflowRepository;
  /** the task clock (epoch ms): leases, timestamps, liveness */
  clock: () => number;
  durability: GenerationTaskDurability;
  catalogProfile: GenerationCatalogProfile;
}
export type GenerationTaskRuntimeFactory = () => GenerationTaskRuntime | null;

function productionRuntime(environment: Record<string, string | undefined> = process.env): GenerationTaskRuntime | null {
  if (fixtureRuntimeEnabled(environment)) return { repository: getDurableWorkflowRepository(), clock: unfrozenNowMs, durability: "process-memory", catalogProfile: "fixture-blinker" };
  if (!(environment.DATABASE_URL ?? "").trim()) return null;
  return { repository: getDurableWorkflowRepository(), clock: () => Date.now(), durability: "durable", catalogProfile: "postgres" };
}

const DEFAULT_FACTORY: GenerationTaskRuntimeFactory = () => productionRuntime();
let factory: GenerationTaskRuntimeFactory = DEFAULT_FACTORY;

/** Test-only override; restore with `resetGenerationTaskRuntimeFactory`. */
export function setGenerationTaskRuntimeFactory(next: GenerationTaskRuntimeFactory): void { factory = next; }
export function resetGenerationTaskRuntimeFactory(): void { factory = DEFAULT_FACTORY; }
/** The runtime, or null (no durable store here). Never throws. */
export function resolveGenerationTaskRuntime(): GenerationTaskRuntime | null {
  try { return factory(); } catch { return null; }
}

/** The identities a new task pins (contract section 1.2): the catalog profile, the embedding model and the three system prompts' digests. */
export function generationTaskIdentities(catalogProfile: GenerationCatalogProfile): GenerationTaskStartInput["identities"] {
  return { catalogProfile, embeddingModel: EMBEDDING_MODEL, promptDigests: { plan: durableWorkflowDigest(PLAN_SYSTEM_PROMPT), build: durableWorkflowDigest(BUILD_SYSTEM_PROMPT), subsystem: durableWorkflowDigest(BUILD_SUBSYSTEM_SYSTEM_PROMPT) } };
}

export function generationTaskStoreOf(runtime: GenerationTaskRuntime): GenerationTaskStore {
  return new GenerationTaskStore({ repository: runtime.repository, clock: runtime.clock });
}

/** The service the routes call, over the resolved runtime (null: no durable store - the route answers 503 and accepts nothing). */
export function resolveGenerationTaskService(input: { providerServable: (provider: LLMProviderId) => boolean }): GenerationTaskService | null {
  const runtime = resolveGenerationTaskRuntime();
  if (!runtime) return null;
  try {
    return new GenerationTaskService({ store: generationTaskStoreOf(runtime), repository: runtime.repository, clock: runtime.clock, providerServable: input.providerServable, identities: () => generationTaskIdentities(runtime.catalogProfile), durability: runtime.durability });
  } catch {
    return null;
  }
}
