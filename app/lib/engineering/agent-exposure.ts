/**
 * [B17-F] THE intentional agent-exposure set — the one reviewed list every
 * exposure gate derives from. Adding a tool to the model's reach is a
 * reviewed change HERE (with its reason), never a count bumped in a test.
 *
 * Exposable operation classes are `read`, `propose` (sealed proposal
 * artifacts / revision-bound layout candidates the human applies) and
 * `view-session` (bus commands the browser executes; never engineering
 * state). `mutate`, `destructive` and `release` are never exposed; nothing
 * that qualifies or releases manufacturing, runs a raw process, replaces
 * state wholesale, or mutates a database/file is in this list.
 */
import type { ToolRegistry } from "./tool-registry";

export const AGENT_EXPOSABLE_OPERATION_CLASSES = Object.freeze(["read", "propose", "view-session"] as const);

export const INTENTIONAL_AGENT_EXPOSED_TOOL_IDS: readonly string[] = Object.freeze([
  "sirkit.component-authority.inspect",           // B13 — server-owned authority resource gates per-run availability
  "sirkit.manufacturing.readiness-inspect",       // read: a readiness REPORT; never authorizes a release
  "sirkit.pcb.board-inspect",
  "sirkit.pcb.propose-bounded-edit",              // B15.3 — sealed bounded PCB proposal
  "sirkit.pcb.revision-inspect",
  "sirkit.placement.propose",                     // B17-F — the shared revision-bound layout candidate (human applies it in the placement panel)
  "sirkit.project.canonical-revision-inspect",
  "sirkit.project.history-inspect",               // B17-F — the project operation timeline (read-only)
  "sirkit.routing.propose",                       // B17-F — the shared revision-bound routing candidate (human applies it in the routing panel)
  "sirkit.schematic.inspect",
  "sirkit.schematic.propose-component-replacement", // B14 — sealed replacement proposal
  "sirkit.schematic.propose-tier1-edit",
  "sirkit.selection.control",                     // B17-F — view-session selection/highlight commands
  "sirkit.selection.inspect",                     // B10
  "sirkit.validation.connectivity-verify",
  "sirkit.validation.drc-run",
  "sirkit.view.canvas-navigation",                // B17-F — fit/zoom/pan/focus + open editor tab (view-session)
  "sirkit.view.layers",                           // B17-F — layer visibility / active layer / grid (view-session)
  "sirkit.view.measure",                          // B17-F — measure between stable objects; never a dimension (view-session)
  "sirkit.view.pcb3d",                            // B17-F — 3D camera / focus / scene layers (view-session)
  "sirkit.view.read-state",                       // B17-F — read-only view state of every open editor
  "sirkit.view.reveal-finding",                   // B17-F — reveal a DRC/routing finding (view-session)
].sort());

export const NEVER_EXPOSED_TOOL_PATTERNS: readonly RegExp[] = Object.freeze([
  /\.release$/,               // manufacturing release
  /qualif/i,                  // qualification
  /undo-redo/,                // canonical replay
  /^sirkit\.pcb\.(move-footprint|rotate-side-footprint|edit-track|delete-item|arrange|create-via|zone-edit|dimension)$/, // canonical mutations
]);

export interface AgentExposureReport {
  ok: boolean;
  expected: readonly string[];
  actual: readonly string[];
  missing: string[];
  unexpected: string[];
  classViolations: string[];
  count: number;
}

/** Compare the registry's ACTUAL exposure with the intentional set (both derived, nothing hard-coded). */
export function agentExposureReport(registry: ToolRegistry): AgentExposureReport {
  const exposed = registry.list().filter((descriptor) => descriptor.agentExposed);
  const actual = exposed.map((descriptor) => descriptor.toolId).sort();
  const expected = INTENTIONAL_AGENT_EXPOSED_TOOL_IDS;
  const missing = expected.filter((id) => !actual.includes(id));
  const unexpected = actual.filter((id) => !expected.includes(id));
  const classViolations = exposed
    .filter((descriptor) => !(AGENT_EXPOSABLE_OPERATION_CLASSES as readonly string[]).includes(descriptor.operationClass) || NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(descriptor.toolId)))
    .map((descriptor) => `${descriptor.toolId} (${descriptor.operationClass})`);
  return { ok: missing.length === 0 && unexpected.length === 0 && classViolations.length === 0 && registry.coverageReport().agentExposedCount === expected.length, expected, actual, missing, unexpected, classViolations, count: actual.length };
}
