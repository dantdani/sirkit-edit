/**
 * [B18-C] THE reviewed granted-execution list — the ONLY place the model's
 * mutation reach widens, one row per tool with its reason. Every exposure
 * gate (the descriptor validator, discovery, the exposure report, the run
 * toolset and the gateway) DERIVES from this list through
 * `grantedExecutionViolations`; no gate and no test carries a count.
 *
 * A granted execution is a canonical mutation the agent may invoke ONLY
 * through a server-minted one-shot execution grant (B18-B): the agent actor
 * never holds the capability (D18-8 — it is a grant property), the family
 * must be a permission-Tier-1 execution family bound to the canonical editor
 * session, and the commands that can never be granted are refused by
 * COMMAND id (a renamed tool cannot slip past).
 */
import type { ToolDescriptor } from "./tool-registry";
import { TIER1_GRANTABLE_CAPABILITIES, isExecutionFamily, type ExecutionFamily } from "./execution-grant";
import { permissionTierOfDescriptor } from "./permission-tiers";

export interface GrantedExecutionTool {
  toolId: string;
  family: ExecutionFamily;
  reason: string;
}

/** One row per reviewed granted execution, each with its reason; rows land per increment (B18-C I3, I5 …). */
export const GRANTED_EXECUTION_TOOLS: readonly GrantedExecutionTool[] = Object.freeze([
  Object.freeze({
    toolId: "sirkit.pcb.move-footprint",
    family: "pcb.move-footprint",
    reason: "B18-C I3 — absolute footprint moves (integer nm) compiled by the SAME builder the editor session and the explicit-request grammar use; permission Tier 1 (reversible, edit_placement); one canonical transaction and one undo entry; targets named by stable id, never resolved from a selection",
  }),
  Object.freeze({
    toolId: "sirkit.pcb.rotate-side-footprint",
    family: "pcb.rotate-side-footprint",
    reason: "B18-C I5 — absolute rotation and board side through set-footprint-props (the editor's own mutator); permission Tier 1 (reversible, edit_placement); one transaction; the explicit grammar derives rotate-BY-an-angle with a required direction word and flip onto a named side",
  }),
  Object.freeze({
    toolId: "sirkit.pcb.arrange",
    family: "pcb.arrange",
    reason: "B18-C I5 — align / distribute / snap-to-grid through the editor's own arrangement commands, pinned in the grant as the absolute positions they produce; permission Tier 1 (reversible, edit_placement); confirmation-only (no explicit grammar: multi-target geometry the user must see)",
  }),
  Object.freeze({
    toolId: "sirkit.pcb.silkscreen-text",
    family: "pcb.silkscreen-text",
    reason: "B18-C I6 — silkscreen TEXT add / update / remove through the editor's own silk commands and set-text-props (never copper, never board text); permission Tier 1 (reversible, edit_placement); deterministic add ids; confirmation-only (free text placed by the AI is always shown to the user first)",
  }),
] as GrantedExecutionTool[]);

export const GRANTED_EXECUTION_TOOL_IDS: readonly string[] = Object.freeze(GRANTED_EXECUTION_TOOLS.map((tool) => tool.toolId).sort());

/** Canonical commands that can NEVER be granted — copper, vias/padstacks, zones, deletions, bulk layout, the approved-apply
 *  command, destructive schematic commands and topology edits. A rule on the COMMAND, not the tool id. */
export const NEVER_GRANTED_COMMAND_IDS: readonly string[] = Object.freeze([
  "pcb.edit-via", "pcb.create-via", "pcb.padstack", "pcb.edit-track", "pcb.delete-item", "pcb.zone-edit", "pcb.route-copper",
  "pcb.auto-place", "pcb.autoroute-import", "pcb.reroute-nets", "pcb.clear-nets", "pcb.autonomous-layout", "pcb.board-repair",
  "pcb.assist-edit", "pcb.bounded-edit-apply",
  "schematic.delete-component", "schematic.replace-component", "schematic.connect",
]);

/** Tool ids that are NEVER exposed: manufacturing release, qualification, the canonical replay primitive, and the canonical
 *  mutations not reviewed as granted executions (B18-C lifts a family by removing it HERE in the increment that exposes it).
 *  [B18-C review U1] a SECOND key on every lift: `grantedExecutionViolations` refuses a pattern-listed tool even with a
 *  reviewed row, so every runtime gate (validator, discovery-backed toolset, dispatch) enforces it — not only the tests. */
export const NEVER_EXPOSED_TOOL_PATTERNS: readonly RegExp[] = Object.freeze([
  /\.release$/,               // manufacturing release
  /qualif/i,                  // qualification
  /undo-redo/,                // canonical replay
  /^sirkit\.pcb\.(edit-track|delete-item|create-via|zone-edit|dimension)$/, // canonical mutations not reviewed as granted executions
]);

export type GrantedExecutionCandidate = Pick<ToolDescriptor, "toolId" | "operationClass" | "binding" | "approvalTier" | "requiredCapability" | "owningCommandId" | "agentExposed" | "sideEffects" | "executionMode">;

/**
 * Why a descriptor is NOT a granted execution (empty ⇒ it is one). Derives every condition; `tools` is injectable so the
 * gates can be proven on a test registry before a real row lands (the production registry always uses the reviewed list).
 */
export function grantedExecutionViolations(descriptor: GrantedExecutionCandidate, tools: readonly GrantedExecutionTool[] = GRANTED_EXECUTION_TOOLS): string[] {
  const violations: string[] = [];
  if (descriptor.operationClass !== "mutate") violations.push(`operation class ${descriptor.operationClass} is not mutate`);
  if (descriptor.executionMode !== "granted") violations.push("executionMode is not \"granted\"");
  if (descriptor.binding.status !== "bound-mutation-editor-session") violations.push("the binding is not a canonical mutation editor-session binding");
  const command = descriptor.binding.canonicalCommandId;
  if (!command || !isExecutionFamily(command)) violations.push(`canonical command ${command ?? "(none)"} is not an execution family`);
  if (command && NEVER_GRANTED_COMMAND_IDS.includes(command)) violations.push(`canonical command ${command} can never be granted`);
  const row = tools.find((tool) => tool.toolId === descriptor.toolId);
  if (!row) violations.push(`${descriptor.toolId} is not in the reviewed granted-execution list`);
  else if (command !== row.family) violations.push(`canonical command ${command ?? "(none)"} differs from the reviewed family ${row.family}`);
  const tier = permissionTierOfDescriptor(descriptor);
  if (tier !== 1) violations.push(`permission tier ${tier} is not Tier 1`);
  if (!(TIER1_GRANTABLE_CAPABILITIES as readonly string[]).includes(descriptor.requiredCapability)) violations.push(`capability ${descriptor.requiredCapability} is not grantable`);
  if (descriptor.sideEffects !== "engineering-state") violations.push(`side effects ${descriptor.sideEffects} are not engineering-state`);
  if (NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(descriptor.toolId))) violations.push(`${descriptor.toolId} matches a never-exposed tool pattern`);
  return violations;
}

/** An exposed descriptor that is a granted execution (the model may call it; the server decides per grant). */
export function isGrantedExecutionDescriptor(descriptor: GrantedExecutionCandidate, tools?: readonly GrantedExecutionTool[]): boolean {
  return descriptor.agentExposed && grantedExecutionViolations(descriptor, tools).length === 0;
}
