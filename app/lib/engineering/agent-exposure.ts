/**
 * [B17-F] THE intentional agent-exposure set — the one reviewed list every
 * exposure gate derives from. Adding a tool to the model's reach is a
 * reviewed change HERE (with its reason), never a count bumped in a test.
 *
 * Exposable operation classes are `read`, `propose` (sealed proposal
 * artifacts / revision-bound layout candidates the human applies) and
 * `view-session` (bus commands the browser executes; never engineering
 * state). [B18-C] A `mutate` tool is exposable ONLY as a reviewed granted
 * execution (`granted-execution-families.ts`): the model's call mints a
 * server-bound one-shot grant and the user's canonical editor session is
 * the only committer. `destructive` and `release` are never exposed; nothing
 * that qualifies or releases manufacturing, runs a raw process, replaces
 * state wholesale, or mutates a database/file is in this list.
 */
import type { ToolDescriptor, ToolRegistry } from "./tool-registry";
import { GRANTED_EXECUTION_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS, NEVER_GRANTED_COMMAND_IDS, grantedExecutionViolations, type GrantedExecutionCandidate } from "./granted-execution-families"; // [B18-C]

export const AGENT_EXPOSABLE_OPERATION_CLASSES = Object.freeze(["read", "propose", "view-session"] as const);

/**
 * [B18-C] THE exposure rule every gate and pin derives from: the three exposable classes, or a `mutate` tool that is a
 * reviewed granted execution (B18-B grants; `granted-execution-families.ts`). Nothing else is ever exposable.
 */
export function isAgentExposableDescriptor(descriptor: GrantedExecutionCandidate): boolean {
  if ((AGENT_EXPOSABLE_OPERATION_CLASSES as readonly string[]).includes(descriptor.operationClass)) return true;
  return descriptor.operationClass === "mutate" && grantedExecutionViolations(descriptor).length === 0;
}

export const INTENTIONAL_AGENT_EXPOSED_TOOL_IDS: readonly string[] = Object.freeze([
  "sirkit.component-authority.inspect",           // B13 — server-owned authority resource gates per-run availability
  "sirkit.manufacturing.readiness-inspect",       // read: a readiness REPORT; never authorizes a release
  "sirkit.pcb.board-inspect",
  "sirkit.pcb.move-footprint",                    // B18-C I3 — the first reviewed granted execution (server-minted one-shot grant: a preview to confirm, or the exact requested move)
  "sirkit.pcb.rotate-side-footprint",             // B18-C I5 — reviewed granted execution (absolute rotation / board side; explicit rotate and flip grammar)
  "sirkit.pcb.arrange",                           // B18-C I5 — reviewed granted execution (align / distribute / snap-to-grid; confirmation-only)
  "sirkit.pcb.silkscreen-text",                   // B18-C I6 — reviewed granted execution (silkscreen TEXT only; confirmation-only)
  "sirkit.pcb.dimension",                         // B18-C I7 — reviewed granted execution (dimension annotations; re-tiered Tier 1 per OD-13; confirmation-only)
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

/** [B18-C review U1] defined in `granted-execution-families.ts` (a runtime key on every lift); re-exported for the gates. */
export { NEVER_EXPOSED_TOOL_PATTERNS };

export interface AgentExposureReport {
  ok: boolean;
  expected: readonly string[];
  actual: readonly string[];
  missing: string[];
  unexpected: string[];
  classViolations: string[];
  /** [B18-C] granted executions: every reviewed id exposed with zero violations, every exposed mutate in the list, no
   *  exposed tool bound to a never-granted command, no stray `executionMode`. */
  executionViolations: string[];
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
    .filter((descriptor) => !isAgentExposableDescriptor(descriptor) || NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(descriptor.toolId)))
    .map((descriptor) => `${descriptor.toolId} (${descriptor.operationClass})`);
  const executionViolations = grantedExecutionReport(registry.list());
  return { ok: missing.length === 0 && unexpected.length === 0 && classViolations.length === 0 && executionViolations.length === 0 && registry.coverageReport().agentExposedCount === expected.length, expected, actual, missing, unexpected, classViolations, executionViolations, count: actual.length };
}

/** [B18-C] the granted-execution side of the report (derived from the reviewed list, never a count). */
export function grantedExecutionReport(descriptors: readonly ToolDescriptor[]): string[] {
  const violations: string[] = [];
  for (const id of GRANTED_EXECUTION_TOOL_IDS) {
    const descriptor = descriptors.find((item) => item.toolId === id && item.lifecycle === "active");
    if (!descriptor) { violations.push(`${id}: in the granted-execution list but not registered`); continue; }
    if (!descriptor.agentExposed) violations.push(`${id}: in the granted-execution list but not exposed`);
    for (const violation of grantedExecutionViolations(descriptor)) violations.push(`${id}: ${violation}`);
    if (!INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.includes(id)) violations.push(`${id}: granted but not in the intentional exposure list`);
  }
  for (const descriptor of descriptors) {
    if (descriptor.agentExposed && descriptor.operationClass === "mutate" && !GRANTED_EXECUTION_TOOL_IDS.includes(descriptor.toolId)) violations.push(`${descriptor.toolId}: an exposed mutate tool outside the granted-execution list`);
    if (descriptor.executionMode !== undefined && !GRANTED_EXECUTION_TOOL_IDS.includes(descriptor.toolId)) violations.push(`${descriptor.toolId}: carries executionMode outside the granted-execution list`);
    if (descriptor.agentExposed && descriptor.binding.canonicalCommandId && NEVER_GRANTED_COMMAND_IDS.includes(descriptor.binding.canonicalCommandId)) violations.push(`${descriptor.toolId}: exposed while bound to the never-granted command ${descriptor.binding.canonicalCommandId}`);
  }
  return violations;
}
