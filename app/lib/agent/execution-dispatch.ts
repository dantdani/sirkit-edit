/**
 * [B18-C] The gateway's granted-execution dispatch — the ONLY path by which a
 * model tool call can lead to a mutation, and even here nothing mutates: a
 * reviewed Tier 1 granted execution is re-discovered in the current context,
 * its role rechecked, its intent sealed purely against the verified board
 * (`sealExecutionIntent`), its base derived from the verified context
 * (`buildExecutionGrantBase`), and a one-shot grant MINTED through the
 * composition root's closure. The browser's canonical editor session is the
 * only committer (the B18-B ritual).
 *
 * Refusals, in order: not a reviewed granted execution ⇒ not_callable; no
 * minter or prompt version bound to the run ⇒ execution_unavailable; no call
 * id ⇒ invalid_input (a grant is minted once per run + call); not
 * discoverable in the CURRENT context ⇒ not_discoverable (<reason>); a role
 * outside the descriptor's roles or Tier 1's execute roles ⇒ unauthorized; the
 * seal's own refusals 1:1; an underivable base ⇒ authority_unavailable; the
 * minter's refusals 1:1. The actor's own capabilities are deliberately NOT
 * consulted: the capability is the grant's (D18-8), never the actor's.
 *
 * Imports: no editor session, no store, nothing under app/lib/execution-grant
 * (the minter arrives as a closure).
 */
import { discoverTools } from "../engineering/tool-discovery";
import { grantedExecutionViolations } from "../engineering/granted-execution-families";
import { TIER1_EXECUTE_ROLES } from "../engineering/permission-tiers";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { buildExecutionGrantBase, mintablePlanOf, sealExecutionIntent } from "./execution-intents";
import type { AgentExecutionGrantMinter, AgentExecutionGrantOutcome, AgentRunContext, GatewayInvocationOutcome } from "./contracts";

export interface GrantedExecutionDispatchInput {
  registry: ToolRegistry;
  descriptor: ToolDescriptor;
  args: Record<string, unknown>;
  context: AgentRunContext;
  runId: string;
  callId: string | undefined;
  executionGrants: AgentExecutionGrantMinter | undefined;
  promptVersion: string | undefined;
}

const MAX_CALL_ID_CHARS = 200;

export async function dispatchGrantedExecution(input: GrantedExecutionDispatchInput): Promise<GatewayInvocationOutcome> {
  const { registry, descriptor, context } = input;
  const refused = (status: string, ...diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: descriptor.toolId, version: descriptor.version, status, diagnostics });

  if (descriptor.operationClass !== "mutate" || !descriptor.agentExposed) {
    return refused("not_callable", `Operation class ${descriptor.operationClass} is not executable through the agent gateway.`);
  }
  const violations = grantedExecutionViolations(descriptor, registry.grantedExecutionTools());
  if (violations.length > 0) return refused("not_callable", `${descriptor.toolId} is not a reviewed granted execution (${violations[0]!.slice(0, 160)}).`);
  if (!input.executionGrants || !input.promptVersion) return refused("execution_unavailable", "No execution-grant minter is bound to this run; nothing was minted and nothing changed.");
  if (!input.callId || input.callId.length > MAX_CALL_ID_CHARS) return refused("invalid_input", "A granted execution needs the provider call id (a grant is minted once per run and call).");

  // A FRESH discovery recheck against the run's discovery context, exactly as the view-session path does.
  const discovery = discoverTools(registry, context.discovery);
  if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
    const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
    return refused("not_discoverable", `Tool is not discoverable in the current context (${reason}).`);
  }
  const role = context.actor.actorRole;
  if (!descriptor.requiredRoles.includes(role) || !(TIER1_EXECUTE_ROLES as readonly string[]).includes(role)) {
    return refused("unauthorized", `Role ${role} may not execute ${descriptor.toolId}.`);
  }

  const sealed = sealExecutionIntent({ descriptor, args: input.args, context });
  if (!sealed.ok) return refused(sealed.status, ...sealed.diagnostics);
  const base = buildExecutionGrantBase(context);
  if (!base.ok) return refused("authority_unavailable", ...base.diagnostics);
  const board = context.canonicalState?.pcb;
  const basis = context.pcbProposalBasis;
  if (!board || !basis) return refused("authority_unavailable", "No verified canonical board with a PCB history basis exists for this run.");

  let minted: AgentExecutionGrantOutcome;
  try {
    minted = await input.executionGrants.mint({
      plan: mintablePlanOf(sealed.plan),
      board,
      base: base.base,
      session: { editor: "pcb", lineageId: basis.lineageId, runId: input.runId, viewSessionId: context.view?.editors.pcb?.sessionId ?? null },
      origin: { callId: input.callId, registryDigest: registry.digest(), promptVersion: input.promptVersion },
    });
  } catch {
    return refused("grant_unavailable", "The execution grant could not be minted (details redacted); nothing was minted and nothing changed.");
  }
  if (!minted.ok) return refused(minted.reason, ...minted.diagnostics);
  return { kind: "execution-grant", ok: true, toolId: descriptor.toolId, version: descriptor.version, grant: minted.grant, decision: minted.decision, note: minted.note };
}
