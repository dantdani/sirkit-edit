import { PhysicalBindingMappingProjector } from "../mapping-verification/stage1-projector";
import { mappingOutboxHandlers, readyMappingInvalidationTopics } from "../mapping-verification/durable";
import { ScopedMappingInvalidationTarget } from "../mapping-verification/invalidation";
import { PostgresPhysicalBindingRepository } from "../physical-binding/server-repository";
import { DurablePcbSyncRepository } from "../pcb-sync/durable";
import { DurablePassivePolicyInvalidationTarget, passivePolicyOutboxHandlers } from "../passive-policy/durable";
import { DurableOutboxDispatcher, type DurableEffectHandler } from "./outbox";
import { getDurableWorkflowRepository } from "./runtime";

export function durableEffectHandlers(extra: ReadonlyMap<string, DurableEffectHandler> = new Map()): ReadonlyMap<string, DurableEffectHandler> {
  const workflow = getDurableWorkflowRepository(), pcbSync = new DurablePcbSyncRepository(workflow);
  return new Map<string, DurableEffectHandler>([
    ...mappingOutboxHandlers({ workflow, projector: new PhysicalBindingMappingProjector(new PostgresPhysicalBindingRepository()), invalidation: new ScopedMappingInvalidationTarget(pcbSync) }).entries(),
    ...passivePolicyOutboxHandlers({ workflow, target: new DurablePassivePolicyInvalidationTarget(pcbSync) }).entries(),
    ...extra.entries(),
  ]);
}

export async function dispatchDurableEffects(input: { workerId: string; now?: string; limit?: number; topics?: string[]; signal?: AbortSignal; extraHandlers?: ReadonlyMap<string, DurableEffectHandler> }) {
  const repository = getDurableWorkflowRepository(), dispatcher = new DurableOutboxDispatcher(repository, durableEffectHandlers(input.extraHandlers));
  // Assignment revalidation is deliberately left pending for its trusted source
  // coordinator. A generic effect worker must never consume it as an unknown job.
  const selectors = new Set(input.topics ?? ["mapping.stage1-project", "mapping.invalidate", "passive-policy.invalidate"]), now = input.now ?? new Date().toISOString(), limit = input.limit ?? 25, result = { claimed: 0, completed: 0, retried: 0, failed: 0 };
  const run = async (topics: string[]) => { if (!topics.length || result.claimed >= limit) return; const next = await dispatcher.dispatch({ workerId: input.workerId, now, limit: limit - result.claimed, topics, signal: input.signal }); result.claimed += next.claimed; result.completed += next.completed; result.retried += next.retried; result.failed += next.failed; };
  const reserved = new Set(["mapping.stage1-project", "mapping.invalidate", "passive-policy.invalidate"]), projectionTopics = selectors.has("mapping.stage1-project") ? ["mapping.stage1-project"] : [];
  await run(projectionTopics);
  const dependent = selectors.has("mapping.invalidate") ? await readyMappingInvalidationTopics(repository) : [], independent = [...selectors].filter((topic) => !reserved.has(topic));
  if (selectors.has("passive-policy.invalidate")) independent.push("passive-policy.invalidate");
  await run([...new Set([...dependent, ...independent])].sort());
  return result;
}
