/**
 * [B17-F] The LAYOUT PROPOSAL service — the agent's placement and routing
 * proposals. Both produce the SHARED revision-bound layout candidate
 * (`sirkit.layout-candidate.v1`, B17-E) through the SAME producers the
 * editor's own hooks and the preview route use; the candidate travels to
 * the browser as an artifact the human previews and applies or discards in
 * the placement / routing panel. Nothing here moves a footprint or commits
 * copper: apply is `applyLayoutCandidate` behind the editor's own review
 * controls, with its exact base-revision, generation and provenance
 * re-checks.
 *
 * Authorization mirrors the sealed proposal service: exact allowlisted
 * descriptor, context integrity, fresh discovery, role AND capability
 * recheck against the effective actor, a verified canonical board, strict
 * argument keys (authority-shaped arguments are refused by name).
 */
import type { AutoroutePassExecutor } from "../pcb/autoroute/completion";
import { runPlacementCandidate, type LayoutCandidate } from "../pcb/candidates/layout-candidate";
import { runRoutingCandidate } from "../pcb/candidates/routing-server";
import { getPreset } from "../pcb/drc/presets";
import { discoverTools } from "../engineering/tool-discovery";
import type { ToolRegistry } from "../engineering/tool-registry";
import type { AgentRunContext } from "./contracts";

export const AGENT_PLACEMENT_PROPOSAL_TOOL_ID = "sirkit.placement.propose";
export const AGENT_ROUTING_PROPOSAL_TOOL_ID = "sirkit.routing.propose";
export const LAYOUT_PROPOSAL_TOOL_IDS: readonly string[] = Object.freeze([AGENT_PLACEMENT_PROPOSAL_TOOL_ID, AGENT_ROUTING_PROPOSAL_TOOL_ID]);

/** The SERVER composition root supplies a resolved local FreeRouting pass executor per request (tests inject a double).
 *  Absent ⇒ the routing proposal refuses truthfully (`routing_engine_unavailable`). */
export type RoutingExecutorFactory = (input: { signal?: AbortSignal; timeoutMs: number }) => Promise<{ ok: true; executor: AutoroutePassExecutor } | { ok: false; reason: string }>;

export interface LayoutProposalInput {
  toolId: string;
  version: string;
  args: Record<string, unknown>;
  context: AgentRunContext;
  runId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type LayoutProposalOutcome =
  | { status: "candidate"; candidate: LayoutCandidate }
  | { status: "refused"; failure: string; diagnostics: string[] };

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "generation", "expectedRevision", "revision"]);

function refuse(failure: string, ...diagnostics: string[]): LayoutProposalOutcome {
  return { status: "refused", failure, diagnostics };
}

function strictKeys(args: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(args)) {
    if (allowed.includes(key)) continue;
    return AUTHORITY_KEYS.has(key)
      ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim — the proposal accepts only ${allowed.join(", ")}.`
      : `Unexpected argument "${key.slice(0, 40)}" — the proposal accepts only ${allowed.join(", ")}.`;
  }
  return null;
}

const boundedInteger = (value: unknown, min: number, max: number): number | undefined | null => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
};

export class LayoutProposalService {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: { now?: () => number; routingExecutor?: RoutingExecutorFactory } = {},
  ) {}

  async invoke(input: LayoutProposalInput): Promise<LayoutProposalOutcome> {
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", `No registered tool ${input.toolId}@${input.version}.`);
    const isPlacement = descriptor.toolId === AGENT_PLACEMENT_PROPOSAL_TOOL_ID;
    const isRouting = descriptor.toolId === AGENT_ROUTING_PROPOSAL_TOOL_ID;
    if ((!isPlacement && !isRouting) || descriptor.operationClass !== "propose" || descriptor.sideEffects !== "proposal-artifact" || descriptor.binding.status !== "bound-proposal") {
      return refuse("not_callable", "Only the allowlisted layout candidate producers are invocable here.");
    }
    // Fresh discovery: the tool must be included NOW (agent channel, role, capability, board present, risk ceiling).
    const discovery = discoverTools(this.registry, input.context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", `Tool is not discoverable in the current context (${reason}).`);
    }
    // Role AND capability recheck against the EFFECTIVE actor (never discovery grants alone).
    if (!descriptor.requiredRoles.includes(input.context.actor.actorRole)) return refuse("unauthorized", `Role ${input.context.actor.actorRole} is not permitted.`);
    if (!input.context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) return refuse("unauthorized", `Capability ${descriptor.requiredCapability} is not granted to the effective actor.`);
    const board = input.context.canonicalState?.pcb;
    if (!board || !input.context.canonicalRevisionDigest) return refuse("authority_unavailable", "No complete validated canonical PCB board exists for this run; layout proposals are unavailable.");
    const clock = (): string => new Date(this.options.now ? this.options.now() : Date.now()).toISOString();

    if (isPlacement) {
      const invalid = strictKeys(input.args, ["instanceIds", "candidateCount", "maxIterations"]);
      if (invalid) return refuse("invalid_input", invalid);
      let instanceIds: string[] | undefined;
      if (input.args.instanceIds !== undefined && input.args.instanceIds !== null) {
        if (!Array.isArray(input.args.instanceIds) || input.args.instanceIds.length === 0 || input.args.instanceIds.length > 500 || !input.args.instanceIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)) {
          return refuse("invalid_input", "instanceIds must be 1–500 footprint ids.");
        }
        instanceIds = [...new Set(input.args.instanceIds as string[])];
        const unknown = instanceIds.filter((id) => !board.footprints.some((footprint) => footprint.id === id));
        if (unknown.length > 0) return refuse("invalid_input", `instanceIds names footprints that are not on this board: ${unknown.slice(0, 5).join(", ")}.`);
      }
      const candidateCount = boundedInteger(input.args.candidateCount, 2, 8);
      const maxIterations = boundedInteger(input.args.maxIterations, 1, 2000);
      if (candidateCount === null || maxIterations === null) return refuse("invalid_input", "candidateCount must be 2–8 and maxIterations 1–2000.");
      const { candidate, run } = runPlacementCandidate({
        board,
        request: {
          producer: "agent",
          projectId: input.context.projectId,
          instanceIds,
          candidateCount,
          maxIterations,
          // Bounded by the tool's own deadline: the engine stops at the budget and reports its termination.
          timeoutMs: Math.max(1_000, Math.min(input.timeoutMs, 110_000)),
        },
        clock,
      });
      if (!candidate) return refuse("no_candidate", `The placement engine produced no candidate (termination ${run.termination}).`);
      return { status: "candidate", candidate };
    }

    const invalid = strictKeys(input.args, ["netIds"]);
    if (invalid) return refuse("invalid_input", invalid);
    let netIds: number[] | undefined;
    if (input.args.netIds !== undefined && input.args.netIds !== null) {
      if (!Array.isArray(input.args.netIds) || input.args.netIds.length === 0 || input.args.netIds.length > 500 || !input.args.netIds.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)) {
        return refuse("invalid_input", "netIds must be 1–500 positive integer net ids.");
      }
      netIds = [...new Set(input.args.netIds as number[])].sort((a, b) => a - b);
      const unknown = netIds.filter((id) => !board.nets.some((net) => net.id === id));
      if (unknown.length > 0) return refuse("invalid_input", `netIds names nets that are not on this board: ${unknown.slice(0, 5).join(", ")}.`);
    }
    if (!this.options.routingExecutor) return refuse("routing_engine_unavailable", "No local routing engine is wired for this run; the routing proposal is unavailable.");
    let executor: AutoroutePassExecutor;
    try {
      const resolved = await this.options.routingExecutor({ signal: input.signal, timeoutMs: input.timeoutMs });
      if (!resolved.ok) return refuse("routing_engine_unavailable", resolved.reason.slice(0, 300));
      executor = resolved.executor;
    } catch {
      return refuse("routing_engine_unavailable", "The local routing engine could not be resolved (details redacted).");
    }
    const rules = getPreset(input.context.presetId as never).rules;
    try {
      const produced = await runRoutingCandidate({ board, rules, executor, producer: "agent", netIds, attemptNamespace: `agent:${input.runId}`, clock });
      if ("ok" in produced) return refuse(produced.code === "EMPTY" ? "no_candidate" : "invalid_input", produced.message);
      return { status: "candidate", candidate: produced };
    } catch (error) {
      return refuse("routing_failed", error instanceof Error ? error.message.slice(0, 300) : "The routing engine failed (details redacted).");
    }
  }
}
