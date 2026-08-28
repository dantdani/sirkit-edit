/**
 * B07.2 — one shared readiness gate for authoritative schematic consumers.
 *
 * Export, simulation, PCB synchronization, autosave, and checkpoint creation
 * must not consume (or persist) schematic state while the canonical session
 * is conflicted, hydrating, or unavailable — a corrupted or unresolved
 * projection must never leak into a downstream artifact. The page evaluates
 * this gate at every consumer entry point; the same function is unit-tested
 * directly so the policy is behavioral, not just UI copy.
 */

import type { SchematicSessionLifecycle } from "./schematic-session";

export interface SchematicConsumerGateInput {
  /** Lifecycle of the active canonical schematic session (or null before one exists). */
  lifecycle: SchematicSessionLifecycle | null;
  /** True while a recovery decision (conflict / corrupt history / invalid projection) is pending in the UI. */
  recoveryPending: boolean;
  /** What the caller is about to do — used only for the refusal message. */
  consumer: "export" | "simulation" | "pcb-sync" | "autosave" | "checkpoint" | "edit";
}

export type SchematicConsumerGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

const CONSUMER_LABEL: Record<SchematicConsumerGateInput["consumer"], string> = {
  export: "Export",
  simulation: "Simulation",
  "pcb-sync": "PCB synchronization",
  autosave: "Autosave",
  checkpoint: "Checkpoint creation",
  edit: "Editing",
};

export function evaluateSchematicConsumerGate(input: SchematicConsumerGateInput): SchematicConsumerGateResult {
  const label = CONSUMER_LABEL[input.consumer];
  if (input.recoveryPending) {
    return { allowed: false, reason: `${label} is blocked: the schematic needs an explicit recovery decision first. Nothing was changed.` };
  }
  // Autosave writes the user's OWN SavedProject record (localStorage), not a
  // derived artifact: it must keep working while the canonical IndexedDB
  // store is merely unavailable or still loading (the pendingHydration guard
  // already prevents pre-hydration writes). It is blocked only while the
  // canonical history is CONFLICTED — a projection awaiting a recovery
  // decision must not be re-persisted as if it were settled.
  if (input.consumer === "autosave") {
    return input.lifecycle === "conflicted"
      ? { allowed: false, reason: `${label} is blocked: the schematic's canonical history is in a conflicted state and must be recovered first. Nothing was changed.` }
      : { allowed: true };
  }
  switch (input.lifecycle) {
    case "ready":
      return { allowed: true };
    case "conflicted":
      return { allowed: false, reason: `${label} is blocked: the schematic's canonical history is in a conflicted state and must be recovered first. Nothing was changed.` };
    case "hydrating":
    case "unopened":
    case null:
      return { allowed: false, reason: `${label} is blocked: the schematic's canonical history is still loading. Try again in a moment.` };
    case "unavailable":
      return { allowed: false, reason: `${label} is blocked: durable schematic storage is unavailable, so the canonical schematic cannot be trusted.` };
  }
}
