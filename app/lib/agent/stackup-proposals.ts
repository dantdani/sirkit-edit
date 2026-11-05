/**
 * [PR-F, 2026-10-17] The agent's STACKUP / VIA-POLICY proposal, `sirkit.stackup.propose` (directive section 9; CONTINUATION E-F):
 * a sealed, revision-bound RECOMMENDATION (`sirkit.stackup-candidate.v1`, app/lib/pcb/candidates/stackup-candidate.ts) of a layer
 * count and layer roles, reference planes, power distribution and a through-via profile chosen ONLY among the stackup profiles,
 * the two- and four-layer manufacturing presets and the via padstacks this tree already defines - compiled by the ONE pure
 * function `compileStackupCandidate` over the run's verified canonical board. Anything else (blind / buried / micro / via-in-pad /
 * stacked vias, materials, dielectrics, copper weights, thicknesses, impedance, other layer counts) is refused as `proposal-blocked`
 * DATA with the exact reason `UNSUPPORTED_CHAIN_REASON`; never `ok: true`. A different layer count or profile is marked as
 * invalidating dependent approvals, with the existing revision / approval rules cited inside the candidate.
 *
 * Per invocation, as the layout proposal service: the exact allowlisted binding, the context integrity check, a verified canonical
 * board with its revision digest, fresh discovery, the role AND capability recheck against the effective actor, the closed argument
 * surface (authority-shaped keys refused by name; the unsupported-capability keys pass through to the compiler so their refusal
 * carries the exact reason), then the pure compile. Nothing is applied: the human path is the PCB editor's Stackup selector (one
 * canonical `pcb.board-geometry` transaction), and the candidate's own `humanPath` says so. No port, no provider, no network.
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { compileStackupCandidate, UNSUPPORTED_REQUEST_KEYS } from "../pcb/candidates/stackup-candidate";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export const STACKUP_PROPOSAL_TOOL_ID = "sirkit.stackup.propose" as const;
/** The ONE proven implementation the descriptor binds (`resolveStackupProposalBinding` matches it exactly). */
export const STACKUP_PROPOSAL_BINDING = Object.freeze({ module: "app/lib/pcb/candidates/stackup-candidate.ts", symbol: "compileStackupCandidate" });
/** The descriptor's valid input example (the manual's example; pr-f-stackup-candidate validates it against the schema). */
export const STACKUP_PROPOSAL_INPUT_EXAMPLE = Object.freeze({ profileId: "signal-plane-4", manufacturingProfileId: "jlcpcb-4l", planes: [{ layer: "in1", net: { name: "GND", id: 1 } }], viaPadstackIds: ["via-default"], viaTechnology: "through", rationale: "Two internal planes give the analog front end a continuous ground return under the top signal layer." });
/** The request's own keys (the compiler owns their validation). */
export const STACKUP_REQUEST_KEYS: readonly string[] = Object.freeze(["profileId", "manufacturingProfileId", "planes", "viaPadstackIds", "viaTechnology", "rationale"]);

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "generation", "expectedRevision", "revision", "qualify", "qualification", "release", "approve"]);

export type StackupProposalBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

/** Allowlist-only: the descriptor is callable here only as the one stackup proposal over the one pure compiler. */
export function resolveStackupProposalBinding(descriptor: ToolDescriptor): StackupProposalBindingResolution {
  if (descriptor.toolId !== STACKUP_PROPOSAL_TOOL_ID) return { state: "not_callable", reason: "Only the stackup proposal is invocable here." };
  if (descriptor.operationClass !== "propose" || descriptor.sideEffects !== "proposal-artifact") return { state: "not_callable", reason: "The stackup proposal is a propose-class tool with a proposal artifact as its only side effect." };
  if (descriptor.binding.status !== "bound-proposal" || descriptor.binding.module !== STACKUP_PROPOSAL_BINDING.module || descriptor.binding.symbol !== STACKUP_PROPOSAL_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one stackup candidate compiler." };
  return { state: "resolved" };
}

export interface StackupProposalServiceOptions {
  /** The gateway's context integrity check (injected so this module never imports the gateway). */
  integrity: (context: AgentRunContext) => readonly string[];
  now?: () => number;
}
export interface StackupProposalInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; timeoutMs: number; signal?: AbortSignal }

export class StackupProposalService {
  constructor(private readonly registry: ToolRegistry, private readonly options: StackupProposalServiceOptions) {}

  async invoke(input: StackupProposalInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveStackupProposalBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    const board = context.canonicalState?.pcb;
    if (!board || !context.canonicalRevisionDigest) return refuse("authority_unavailable", ["No complete validated canonical PCB board exists for this run; the stackup proposal is unavailable."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole)) return refuse("unauthorized", [`Role ${context.actor.actorRole} is not permitted.`]);
    if (!context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) return refuse("unauthorized", [`Capability ${descriptor.requiredCapability} is not granted to the effective actor.`]);
    // The closed argument surface: the request's keys, plus the unsupported-capability keys the compiler refuses with the exact reason.
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    for (const key of Object.keys(input.args)) {
      if (STACKUP_REQUEST_KEYS.includes(key) || (UNSUPPORTED_REQUEST_KEYS as readonly string[]).includes(key)) continue;
      return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - the stackup proposal accepts only ${STACKUP_REQUEST_KEYS.join(", ")}.` : `Unexpected argument "${key.slice(0, 40)}" - the stackup proposal accepts only ${STACKUP_REQUEST_KEYS.join(", ")}.`]);
    }
    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);
    try {
      const compiled = compileStackupCandidate({ board, request: input.args, presetId: context.presetId, clock: () => new Date(this.options.now ? this.options.now() : Date.now()).toISOString() });
      if (!compiled.ok) return { kind: "proposal-blocked", ok: false, toolId: descriptor.toolId, version: descriptor.version, blockers: compiled.blockers.map((blocker) => ({ code: blocker.code, detail: blocker.detail })) };
      return { kind: "stackup-candidate", ok: true, toolId: descriptor.toolId, version: descriptor.version, candidate: compiled.candidate };
    } catch (error) {
      return refuse("implementation_failed", [`The stackup proposal failed internally: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
  }
}
