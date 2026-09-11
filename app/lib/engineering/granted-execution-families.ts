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

/** Rows land per increment (B18-C I3 …); empty ⇒ nothing is granted anywhere. */
export const GRANTED_EXECUTION_TOOLS: readonly GrantedExecutionTool[] = Object.freeze([] as GrantedExecutionTool[]);

export const GRANTED_EXECUTION_TOOL_IDS: readonly string[] = Object.freeze(GRANTED_EXECUTION_TOOLS.map((tool) => tool.toolId).sort());

/** Canonical commands that can NEVER be granted — copper, vias/padstacks, zones, deletions, bulk layout, the approved-apply
 *  command, destructive schematic commands and topology edits. A rule on the COMMAND, not the tool id. */
export const NEVER_GRANTED_COMMAND_IDS: readonly string[] = Object.freeze([
  "pcb.edit-via", "pcb.create-via", "pcb.padstack", "pcb.edit-track", "pcb.delete-item", "pcb.zone-edit", "pcb.route-copper",
  "pcb.auto-place", "pcb.autoroute-import", "pcb.reroute-nets", "pcb.clear-nets", "pcb.autonomous-layout", "pcb.board-repair",
  "pcb.assist-edit", "pcb.bounded-edit-apply",
  "schematic.delete-component", "schematic.replace-component", "schematic.connect",
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
  return violations;
}

/** An exposed descriptor that is a granted execution (the model may call it; the server decides per grant). */
export function isGrantedExecutionDescriptor(descriptor: GrantedExecutionCandidate, tools?: readonly GrantedExecutionTool[]): boolean {
  return descriptor.agentExposed && grantedExecutionViolations(descriptor, tools).length === 0;
}
