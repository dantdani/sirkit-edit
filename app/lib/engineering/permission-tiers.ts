/**
 * [B18-A] PERMISSION TIERS — the enforced policy vocabulary for what an agent
 * may execute, and the project's AUTONOMY SETTING that widens Tier 1 from
 * "preview + confirmation" to "execute the exact user-requested operation".
 *
 * The tiers are a MAPPING onto the registry's existing approval vocabulary
 * (`ApprovalTier`: none / reversible / topology-or-geometry / destructive /
 * release) and operation classes — never a second, drifting classification:
 *
 *   Tier 0  read, inspect, measure, view-session      → executes directly for authorized project readers
 *   Tier 1  reversible requested edits                → preview + confirmation by default; a project may opt
 *                                                        into `execute_explicit_tier1` for EXACT user-requested ops
 *   Tier 2  topology / geometry / authority changes   → always an inert sealed proposal + exact human approval
 *   Tier 3  publish, release, upload, purchase/order  → never agent-executable
 *
 * Every function here is pure. The setting is SERVER-OWNED (repository +
 * canonical route + audit): nothing in a request body, a tool argument or a
 * model output can assert a mode — see `app/lib/agent/autonomy-*.ts`.
 */
import type { ActionCoverageRecord, ApprovalTier } from "./action-registry";
import type { ToolDescriptor, ToolOperationClass } from "./tool-registry";
import type { ProjectRole } from "./types";

export const PERMISSION_TIERS = [0, 1, 2, 3] as const;
export type PermissionTier = (typeof PERMISSION_TIERS)[number];

export const PERMISSION_TIER_TITLES: Readonly<Record<PermissionTier, string>> = Object.freeze({
  0: "read, inspect, measure, view-session (direct for authorized readers)",
  1: "reversible requested edit (preview + confirmation; explicit execution only by project opt-in)",
  2: "high-impact topology / geometry / authority change (inert sealed proposal, exact human approval)",
  3: "irreversible: publish authority, manufacturing release, external upload, purchasing/order (never agent-executable)",
});

/** A defensive floor: an id in one of these families is Tier 3 whatever its record says. [B19-E E4 review] gates-2: `publica`
 *  (publication) is publish authority too — "publication" does not contain "publish". */
export const TIER3_FAMILY_PATTERN = /(release|publish|publica|upload|order|purchas|qualif|ship|deliver)/i;

/** The tier of an operation from the registry's approval tier and its operation kind/class. */
export function permissionTierOfApproval(approvalTier: ApprovalTier, kind: ActionCoverageRecord["kind"] | ToolOperationClass): PermissionTier {
  if (approvalTier === "release" || kind === "release") return 3;
  if (approvalTier === "topology-or-geometry" || approvalTier === "destructive" || kind === "destructive") return 2;
  if (approvalTier === "reversible") return 1;
  // approvalTier "none":
  if (kind === "read" || kind === "view-session") return 0;
  // A proposal artifact is by construction the Tier-2 path (inert, human-approved apply).
  if (kind === "propose") return 2;
  // A mutation with no approval tier of its own is the exact-last-operation undo/redo family (Tier 1).
  return 1;
}

export function permissionTierOfDescriptor(descriptor: Pick<ToolDescriptor, "toolId" | "operationClass" | "approvalTier">): PermissionTier {
  if (TIER3_FAMILY_PATTERN.test(descriptor.toolId)) return 3;
  return permissionTierOfApproval(descriptor.approvalTier, descriptor.operationClass);
}

export function permissionTierOfAction(record: Pick<ActionCoverageRecord, "id" | "kind" | "approvalTier" | "area">): PermissionTier {
  if (TIER3_FAMILY_PATTERN.test(record.id)) return 3;
  // View records mutate VIEW state only (the B17 bus): Tier 0 whatever their record kind says.
  if (record.area === "view" && record.approvalTier === "none") return 0;
  return permissionTierOfApproval(record.approvalTier, record.kind);
}

// ── the project's autonomy setting ──────────────────────────────────────────

export const AGENT_AUTONOMY_SCHEMA = "sirkit.agent-autonomy-setting.v1" as const;
export const AGENT_AUTONOMY_CHANGE_SCHEMA = "sirkit.agent-autonomy-change.v1" as const;

/** `proposal_only` (the default): Tier 1 previews and asks. `execute_explicit_tier1`: Tier 1 runs directly for an
 *  EXACT user-requested operation under a server-minted grant; Tier 2/3 are unchanged by any mode. */
export const AUTONOMY_MODES = ["proposal_only", "execute_explicit_tier1"] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

/** Only a project administrator may change the setting; every member may read it. */
export const AUTONOMY_WRITE_ROLES: readonly ProjectRole[] = Object.freeze(["project_admin"]);

export interface AgentAutonomyScope { tenantId: string; projectId: string }

export interface AgentAutonomyActor { principalId: string; membershipRevision: string; role: ProjectRole }

export interface AgentAutonomySetting {
  schema: typeof AGENT_AUTONOMY_SCHEMA;
  tenantId: string;
  projectId: string;
  mode: AutonomyMode;
  /** 0 = the default (never written); every accepted change increments it. */
  revision: number;
  updatedAt: string | null;
  updatedBy: AgentAutonomyActor | null;
}

export interface AgentAutonomyChange {
  schema: typeof AGENT_AUTONOMY_CHANGE_SCHEMA;
  tenantId: string;
  projectId: string;
  fromMode: AutonomyMode;
  toMode: AutonomyMode;
  /** The setting revision this change produced. */
  revision: number;
  at: string;
  actor: AgentAutonomyActor;
}

export function defaultAutonomySetting(scope: AgentAutonomyScope): AgentAutonomySetting {
  return { schema: AGENT_AUTONOMY_SCHEMA, tenantId: scope.tenantId, projectId: scope.projectId, mode: "proposal_only", revision: 0, updatedAt: null, updatedBy: null };
}

export function isAutonomyMode(value: unknown): value is AutonomyMode {
  return typeof value === "string" && (AUTONOMY_MODES as readonly string[]).includes(value);
}

export function canChangeAutonomy(role: ProjectRole): boolean {
  return AUTONOMY_WRITE_ROLES.includes(role);
}

// ── the execution decision ──────────────────────────────────────────────────

export const EXECUTION_DECISIONS = ["execute_direct", "preview_then_confirm", "execute_explicit", "proposal_only", "never"] as const;
export type ExecutionDecisionKind = (typeof EXECUTION_DECISIONS)[number];

export interface ExecutionDecision {
  tier: PermissionTier;
  decision: ExecutionDecisionKind;
  /** A server-minted one-shot grant (B18-B) must be consumed before the operation commits. */
  requiresGrant: boolean;
  /** A human must confirm/approve the exact operation before it commits. */
  requiresHumanApproval: boolean;
  reason: string;
}

/** Roles that may execute Tier 1 (the same roles that may apply a proposal). */
export const TIER1_EXECUTE_ROLES: readonly ProjectRole[] = Object.freeze(["pcb_editor", "project_admin"]);

/**
 * Decide how an operation of `tier` may proceed for `actorRole` under the project's setting.
 * `explicitUserRequest` is the loop's PROVEN fact that the operation is the exact one the user asked for
 * (B18-C binds it into the grant); a model's own claim never sets it.
 */
export function decideAgentExecution(input: { tier: PermissionTier; setting: AgentAutonomySetting | null; actorRole: ProjectRole; explicitUserRequest: boolean }): ExecutionDecision {
  const { tier, actorRole } = input;
  const mode: AutonomyMode = input.setting?.mode ?? "proposal_only";
  if (tier === 3) return { tier, decision: "never", requiresGrant: false, requiresHumanApproval: false, reason: "Tier 3 (publish / release / upload / purchase) is never agent-executable; a human performs it through the product's own authorized path." };
  if (tier === 2) return { tier, decision: "proposal_only", requiresGrant: false, requiresHumanApproval: true, reason: "Tier 2 changes always produce an inert sealed proposal that a human approves exactly." };
  if (tier === 1) {
    if (!TIER1_EXECUTE_ROLES.includes(actorRole)) return { tier, decision: "never", requiresGrant: false, requiresHumanApproval: false, reason: `Role ${actorRole} may not execute or approve an edit; a Tier 1 request from this role is answered with what would change, never applied.` };
    if (mode === "execute_explicit_tier1" && input.explicitUserRequest) return { tier, decision: "execute_explicit", requiresGrant: true, requiresHumanApproval: false, reason: "The project opted into execute_explicit_tier1 and the operation is the exact user-requested one; it runs under a server-minted one-shot grant." };
    return { tier, decision: "preview_then_confirm", requiresGrant: true, requiresHumanApproval: true, reason: mode === "execute_explicit_tier1" ? "The operation is not provably the exact user-requested one; it is previewed and needs confirmation." : "Tier 1 defaults to preview plus confirmation (project mode proposal_only)." };
  }
  return { tier, decision: "execute_direct", requiresGrant: false, requiresHumanApproval: false, reason: "Tier 0 reads, inspections, measurements and view-session actions execute directly for authorized project readers." };
}
