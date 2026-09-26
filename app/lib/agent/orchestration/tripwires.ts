/**
 * [B21 A] Tripwire data for the orchestration import gate (D21-27, OD-113): the nine B11-scanned files - this is the ONLY
 * orchestration module that may name them - the identifiers none of them may ever carry, and the prefix every orchestration
 * module lives under. Data only: no import, no logic, nothing executable. The B11 and B20 tripwires over those files stay
 * verbatim; orchestration identifiers live under the prefix, never in a scanned file.
 */
export const ORCHESTRATION_MODULE_PREFIX = "app/lib/agent/orchestration/" as const;

export const B11_SCANNED_FILES = Object.freeze([
  "app/lib/agent/trace.ts",
  "app/lib/agent/trace-recorder.ts",
  "app/lib/agent/replay-capsule.ts",
  "app/lib/agent/replay-context.ts",
  "app/lib/agent/evaluation.ts",
  "app/lib/agent/evaluation-cases.ts",
  "app/lib/agent/pcb-shape-projection.ts",
  "app/lib/agent/pcb-shape-types.ts",
  "app/lib/agent/generated/pcb-shape-descriptor.ts",
] as const);

/** No scanned file may carry an orchestration identifier, in any case. */
export const ORCHESTRATION_IDENTIFIER_PATTERN = /orchestrat|specialist|coordinator|spawnAgent|multiAgent/i;
