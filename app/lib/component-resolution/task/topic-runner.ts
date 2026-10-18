/**
 * [PR-M, 2026-10-18] Section M2 (design M2.3): the component-resolution topic as the EXISTING generation worker consumes it - the
 * worker's `FencedTopicRunner` (app/lib/generation-task/worker/worker.ts): claim (the store's fenced head claim, the live membership
 * re-check), renew (S2), poll control, run (the slice runner), release (a shutdown hands the slice back). The worker supervises it
 * exactly as a generation slice: one supervisor per running slice, the same timers, the same concurrency.
 */
import type { FencedTopicRunner, FencedTopicSlice } from "../../generation-task/worker/worker";
import { COMPONENT_RESOLUTION_SLICE_TOPIC } from "./contracts";
import type { ComponentResolutionTaskStore, ResolutionSliceRevalidator } from "./store";
import { runComponentResolutionSlice, type ComponentResolutionSlicePorts } from "./slices";

export function componentResolutionTopicRunner(input: { store: ComponentResolutionTaskStore; ports: () => ComponentResolutionSlicePorts; revalidate: ResolutionSliceRevalidator; log?: (line: string) => void }): FencedTopicRunner {
  return {
    topic: COMPONENT_RESOLUTION_SLICE_TOPIC,
    async claim({ workerId, limit }) {
      const outcomes = await input.store.claimSlices({ workerId, limit, revalidate: input.revalidate });
      const slices: FencedTopicSlice[] = [];
      for (const outcome of outcomes) {
        if (outcome.outcome !== "claimed") { if (outcome.outcome !== "stale-event" && outcome.outcome !== "not-before") input.log?.(`component-resolution claim of event ${outcome.eventId}: ${outcome.outcome}${outcome.code ? ` (${outcome.code})` : ""}`); continue; }
        const { lease, task } = outcome;
        slices.push({
          topic: COMPONENT_RESOLUTION_SLICE_TOPIC, sliceId: lease.sliceId, taskId: lease.taskId, kind: lease.kind, attempt: lease.attempt,
          get leaseExpiresAt() { return lease.leaseExpiresAt; },
          renew: () => input.store.renewSlice(lease),
          poll: () => input.store.pollControl(lease),
          release: () => input.store.releaseSlice(lease),
          run: (supervisor) => runComponentResolutionSlice({ store: input.store, lease, task, ports: input.ports(), supervisor }),
        });
      }
      return slices;
    },
  };
}
