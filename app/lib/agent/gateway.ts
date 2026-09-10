/**
 * B09 — the agent tool-invocation gateway.
 *
 * The gateway (not the loop, not the provider adapter) owns fresh
 * authorization/discovery rechecks, resource/revision verification,
 * binding allowlists, execution deadlines, and output redaction:
 *
 *  - READ tools travel through the REAL B05/B05.1
 *    `ReadToolInvocationService` — unweakened, with a freshly assembled
 *    context and verified resource bundle per invocation.
 *  - The tier-1 schematic PROPOSAL travels through the separate
 *    `ProposalInvocationService` below: it compiles all-or-nothing against
 *    the verified schematic snapshot, seals the proposal (digest-pinned to
 *    the exact schematic), and mutates NOTHING. The sealed artifact can
 *    only enter the existing explicit Apply-exact-proposal review boundary
 *    (page.tsx → verifySealedTier1Proposal → trusted schematic session).
 *
 * No provider SDK types, no CanonicalEditorSession/SchematicEditorSession
 * imports, no API-route-to-API-route execution, no LLM-backed routes as
 * tools.
 */

import { randomUUID } from "node:crypto";
import type { SchematicEditOp, SchematicState } from "@/lib/schematic-types";
import { compileTier1Proposal } from "../engineering/schematic-plans";
import { sealTier1Proposal, type SealedTier1Proposal, type Tier1ProposalScope } from "../engineering/schematic-proposals";
import { assembleReplacementProposal } from "../engineering/replacement-proposal-assembler";
import { buildAuthorizationBinding, type SchematicProposalAuthorizationBinding } from "../engineering/proposal-authorization";
import type { SealedReplacementProposal } from "../engineering/replacement-proposals";
import type { PublishedSymbolPinFacts } from "../engineering/replacement-pin-facts";
import { schematicStateDigest } from "../engineering/schematic-model";
import { validateSchematicCanonicalMark } from "../engineering/schematic-projection";
import { computeProjectRevision } from "../engineering/revision";
import { engineeringDigest } from "../engineering/stable";
import { ReadToolInvocationService } from "../engineering/tool-invocation";
import type { ToolRegistry } from "../engineering/tool-registry";
import { discoverTools } from "../engineering/tool-discovery";
import { PCB_EDIT_PROPOSAL_SCHEMA, PCB_EDIT_PROPOSAL_TOOL_ID, PCB_EDIT_PROPOSAL_TOOL_VERSION, type SealedPcbEditProposal } from "../pcb/proposal/sealed-pcb-edit-proposal";
import { handlePcbProposeTool } from "../pcb/proposal/pcb-propose-tool-handler";
import { buildAgentResourceBundle } from "./context";
import { prepareViewCommandRequest, viewContextDigest } from "./view-context";
import { LAYOUT_PROPOSAL_TOOL_IDS, LayoutProposalService, type RoutingExecutorFactory } from "./layout-proposals";
import type { AgentExecutionGrantMinter, AgentRunContext, AgentToolInvocationGateway, GatewayInvocationOutcome } from "./contracts";

export const AGENT_PROPOSAL_TOOL_ID = "sirkit.schematic.propose-tier1-edit";
/** [B09.2] the V2 scope/head proposal contract ships as descriptor 1.1.0. */
export const AGENT_PROPOSAL_TOOL_VERSION = "1.1.0";
/** [B14] the SECOND allowlisted proposal binding — exact component
 *  replacement. Proposal-artifact only; apply is never provider-callable. */
export const AGENT_REPLACEMENT_PROPOSAL_TOOL_ID = "sirkit.schematic.propose-component-replacement";
export const AGENT_REPLACEMENT_PROPOSAL_TOOL_VERSION = "1.0.0";
/** [B15.3] the THIRD allowlisted proposal binding — the sealed bounded PCB
 *  edit. Proposal-artifact only; apply is never provider-callable and lives
 *  behind the human-gated PCB approval boundary inside PcbEditor. */
export const AGENT_PCB_PROPOSAL_TOOL_ID = PCB_EDIT_PROPOSAL_TOOL_ID;
export const AGENT_PCB_PROPOSAL_TOOL_VERSION = PCB_EDIT_PROPOSAL_TOOL_VERSION;

/** [B14 §B] server-owned published pin facts, injected by the SERVER
 *  composition root (the /api/chat route wires the cancellable production
 *  reads; tests inject deterministic sources). Never browser/provider data. */
export type ReplacementPinFactsFetcher = (atomicPartRevisionId: string) => Promise<PublishedSymbolPinFacts | null>;

/**
 * [B09.2/B09.3] actor/discovery authority claims must agree EXACTLY —
 * identity, role, normalized capability set, project/branch scope, the
 * revision anchor, AND the lineage anchor. Divergence fails closed
 * (nothing may widen through a tampered discovery context).
 *
 * Digest domains are deliberately kept separate: the canonical project
 * revision, the schematic-state digest, and the schematic-session head
 * digest have different meanings — the revision anchor derives only from
 * the first two (assembly rule), the lineage anchor only from the
 * REVALIDATED head mark. They are never equated.
 */
export function verifyAgentContextIntegrity(context: AgentRunContext): string[] {
  const issues: string[] = [];
  const discovery = context.discovery;
  if (discovery.actorId !== context.actor.actorId) issues.push("actor identity diverges between actor and discovery context");
  if (discovery.actorRole !== context.actor.actorRole) issues.push("actor role diverges between actor and discovery context");
  const actorCaps = [...context.actor.grantedCapabilities].sort().join(",");
  const discoveryCaps = [...discovery.grantedCapabilities].sort().join(",");
  if (actorCaps !== discoveryCaps) issues.push("granted capability sets diverge between actor and discovery context");
  if (discovery.tenantId !== context.tenantId || discovery.projectId !== context.projectId || discovery.branchId !== context.branchId) {
    issues.push("project/branch scope diverges between run identity and discovery context");
  }
  const expectedRevision = context.canonicalRevisionDigest ?? context.schematicDigest ?? "";
  if (discovery.currentRevisionDigest !== expectedRevision) issues.push("revision anchor diverges between assembled state and discovery context");
  // [B09.3] the stored head mark is REVALIDATED here — an object is never
  // assumed to have stayed valid because it passed assembly earlier. A
  // present-but-malformed mark is itself an integrity failure.
  let expectedLineage = "";
  if (context.schematicHeadMark !== null && context.schematicHeadMark !== undefined) {
    const revalidated = validateSchematicCanonicalMark(context.schematicHeadMark);
    if (revalidated === null) {
      issues.push("the stored schematic head mark is malformed (post-assembly tampering or corruption)");
    } else {
      expectedLineage = revalidated.lineageId;
    }
  }
  if (discovery.lineageId !== expectedLineage) {
    issues.push("lineage anchor diverges between the validated schematic head mark and the discovery context");
  }
  // [B10] resource-content integrity: every context resource is RECOMPUTED
  // against its assembly-time pin, so post-assembly mutation or resource
  // substitution fails before any invocation. Each domain stays separate.
  if (context.canonicalState !== null) {
    const recomputed = computeProjectRevision(context.canonicalState).canonicalStateDigest;
    if (recomputed !== context.canonicalRevisionDigest) issues.push("the canonical project state no longer matches its assembly-time revision digest (post-assembly mutation)");
  } else if (context.canonicalRevisionDigest !== null) {
    issues.push("a canonical revision digest is claimed without canonical state");
  }
  if (context.schematic !== null) {
    if (schematicStateDigest(context.schematic) !== context.schematicDigest) issues.push("the schematic snapshot no longer matches its assembly-time digest (post-assembly mutation)");
  } else if (context.schematicDigest !== null) {
    issues.push("a schematic digest is claimed without a schematic snapshot");
  }
  if (context.selection !== null) {
    const recomputed = engineeringDigest({ schema: "sirkit.selection-snapshot.v1", refs: context.selection.refs, primary: context.selection.primary });
    if (recomputed !== context.selectionDigest) issues.push("the selection resource no longer matches its assembly-time digest (post-assembly mutation)");
    if (context.canonicalState === null) issues.push("a selection resource is claimed without canonical state");
  } else if (context.selectionDigest !== null) {
    issues.push("a selection digest is claimed without a selection resource");
  }
  if (context.netlist !== null) {
    const recomputed = engineeringDigest({ schema: "sirkit.agent-netlist-projection.v1", netlist: context.netlist });
    if (recomputed !== context.netlistDigest) issues.push("the netlist resource no longer matches its assembly-time digest (post-assembly mutation)");
  } else if (context.netlistDigest !== null) {
    issues.push("a netlist digest is claimed without a netlist resource");
  }
  // [B13] server-owned component-authority integrity — recomputed against its
  // assembly-time pin, and it may exist ONLY alongside canonical state and the
  // advertised durable-server-board authority (post-assembly substitution or a
  // dangling authority claim fails closed).
  if (context.componentAuthority !== null) {
    const recomputed = engineeringDigest({ schema: "sirkit.component-authority-records.v1", records: context.componentAuthority.records, candidates: context.componentAuthority.candidates });
    if (recomputed !== context.componentAuthorityDigest) issues.push("the component-authority resource no longer matches its assembly-time digest (post-assembly mutation)");
    if (context.canonicalState === null) issues.push("a component-authority resource is claimed without canonical state");
    if (!discovery.availableAuthority.includes("durable-server-board")) issues.push("component-authority is present but durable-server-board authority is not advertised");
  } else if (context.componentAuthorityDigest !== null) {
    issues.push("a component-authority digest is claimed without a component-authority resource");
  }
  // [B18-A] the autonomy setting is server-owned and project-scoped: a setting
  // for another project (or a malformed one) fails every invocation closed.
  if (!context.autonomy || context.autonomy.schema !== "sirkit.agent-autonomy-setting.v1" || context.autonomy.tenantId !== context.tenantId || context.autonomy.projectId !== context.projectId) {
    issues.push("the autonomy setting does not belong to this run's project");
  }
  // [B17-F] the view context is recomputed against its assembly-time pin, and
  // the surfaces it proves must be the ONLY `*-surface` project states the
  // discovery context advertises (a widened surface list fails closed).
  if (context.view !== null) {
    if (viewContextDigest(context.view) !== context.viewDigest) issues.push("the view context no longer matches its assembly-time digest (post-assembly mutation)");
    const advertised = discovery.projectState.filter((state) => state.endsWith("-surface")).sort().join(",");
    const proven = context.view.surfaces.map((surface) => `${surface}-surface`).sort().join(",");
    if (advertised !== proven) issues.push("the advertised editor surfaces diverge from the captured view context");
  } else {
    if (context.viewDigest !== null) issues.push("a view digest is claimed without a view context");
    if (discovery.projectState.some((state) => state.endsWith("-surface"))) issues.push("editor surfaces are advertised without a captured view context");
  }
  return issues;
}

// ─── Proposal invocation service (separate from the read service) ────────────

export interface ProposalInvocationInput {
  toolId: string;
  version: string;
  args: Record<string, unknown>;
  context: AgentRunContext;
  /** Safe provenance recorded on the sealed proposal. */
  provenance: { provider: string; instruction: string };
  /** [B15.3] the run identity, recorded in PCB proposal provenance. */
  runId?: string;
}

export type ProposalInvocationOutcome =
  | { status: "sealed"; proposal: SealedTier1Proposal | SealedReplacementProposal | SealedPcbEditProposal }
  | { status: "blocked"; blockers: Array<{ code: string; detail: string }> }
  | { status: "refused"; failure: string; diagnostics: string[] };

function parseOps(value: unknown): SchematicEditOp[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const ops: SchematicEditOp[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const op = item as Record<string, unknown>;
    if (typeof op.target !== "string" || op.target.length === 0 || op.target.length > 200) return null;
    if (op.op === "set-value" && typeof op.value === "string" && op.value.length <= 500) {
      ops.push({ op: "set-value", target: op.target, value: op.value });
    } else if (op.op === "rename" && typeof op.refDes === "string" && op.refDes.length > 0 && op.refDes.length <= 64) {
      ops.push({ op: "rename", target: op.target, refDes: op.refDes });
    } else if (op.op === "delete") {
      ops.push({ op: "delete", target: op.target });
    } else {
      return null;
    }
  }
  return ops;
}

export class ProposalInvocationService {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly now: () => number = () => Date.now(),
    private readonly replacementPinFacts?: ReplacementPinFactsFetcher,
  ) {}

  async invoke(input: ProposalInvocationInput): Promise<ProposalInvocationOutcome> {
    // 1. Exact descriptor + activation class. [B14] TWO allowlisted proposal
    // bindings exist — each matched exactly; anything else refuses.
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return { status: "refused", failure: "not_registered", diagnostics: [`No registered tool ${input.toolId}@${input.version}.`] };
    const isTier1 = descriptor.toolId === AGENT_PROPOSAL_TOOL_ID;
    const isReplacement = descriptor.toolId === AGENT_REPLACEMENT_PROPOSAL_TOOL_ID;
    const isPcbEdit = descriptor.toolId === AGENT_PCB_PROPOSAL_TOOL_ID;
    if ((!isTier1 && !isReplacement && !isPcbEdit) || descriptor.operationClass !== "propose" || descriptor.sideEffects !== "proposal-artifact" || descriptor.binding.status !== "bound-proposal") {
      return { status: "refused", failure: "not_callable", diagnostics: ["Only the allowlisted sealed proposal bindings are invocable here."] };
    }
    // 1b. [B09.2] actor/discovery divergence fails closed BEFORE anything else.
    const integrity = verifyAgentContextIntegrity(input.context);
    if (integrity.length > 0) {
      return { status: "refused", failure: "context_integrity", diagnostics: integrity.slice(0, 5) };
    }
    // 2. Fresh discovery over the current context — the tool must be
    // included NOW (agent channel, risk ceiling, project state, authority).
    const discovery = discoverTools(this.registry, input.context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return { status: "refused", failure: "not_discoverable", diagnostics: [`Tool is not discoverable in the current context (${reason}).`] };
    }
    // 3. Role AND capability recheck against the EFFECTIVE ACTOR (never
    // discovery grants alone — B09.2 counterexample R7).
    if (!descriptor.requiredRoles.includes(input.context.actor.actorRole)) {
      return { status: "refused", failure: "unauthorized", diagnostics: [`Role ${input.context.actor.actorRole} is not permitted.`] };
    }
    if (!input.context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return { status: "refused", failure: "unauthorized", diagnostics: [`Capability ${descriptor.requiredCapability} is not granted to the effective actor.`] };
    }

    // ── [B15.3] the bounded PCB edit proposal path — diverges BEFORE the
    // schematic-only requirements. Its authority basis is the verified
    // canonical BOARD plus the PCB history basis, never a schematic mark.
    if (isPcbEdit) {
      return this.invokePcbEdit(input);
    }

    // 4. Verified schematic snapshot must exist for this run.
    const schematic: SchematicState | null = input.context.schematic;
    if (!schematic || !input.context.schematicDigest) {
      return { status: "refused", failure: "authority_unavailable", diagnostics: ["No verified schematic snapshot is available for this run; the proposal tool is unavailable."] };
    }
    // 4b. [B09.1] a well-formed canonical head mark is REQUIRED — without
    // it the proposal cannot be scope-sealed and fails closed here
    // (read-only conversation continues unaffected).
    if (!input.context.schematicHeadMark) {
      return { status: "refused", failure: "authority_unavailable", diagnostics: ["No canonical schematic head mark is available for this run; the proposal tool is unavailable until the editor session is ready."] };
    }
    const scope: Tier1ProposalScope = {
      tenantId: input.context.tenantId,
      projectId: input.context.projectId,
      branchId: input.context.branchId,
      headMark: input.context.schematicHeadMark,
    };
    // [B16.0.1 §E] the authorization binding — the SERVER-verified run actor
    // (Section D) and the membership revision its role was resolved at. The
    // provider can neither supply nor alter it: it is derived here, from the
    // trusted run context, after the strict argument-key validation refuses
    // any authorization-shaped provider argument.
    const authorization: SchematicProposalAuthorizationBinding = buildAuthorizationBinding({
      principalId: input.context.actor.actorId,
      ...(input.context.actor.membershipRevision ? { membershipRevision: input.context.actor.membershipRevision } : {}),
      scope: { tenantId: input.context.tenantId, projectId: input.context.projectId, branchId: input.context.branchId },
    });

    // ── [B14] the replacement proposal path ─────────────────────────────────
    if (isReplacement) {
      return this.invokeReplacement(input, schematic, scope, authorization);
    }

    // 5. Strict argument validation (post-provider-normalization revalidation).
    const ops = parseOps(input.args.ops);
    if (!ops) return { status: "refused", failure: "invalid_input", diagnostics: ["ops must be 1–20 well-formed set-value/rename/delete operations."] };
    // 6. Compile all-or-nothing + seal against the EXACT verified snapshot.
    // pinsByPartId is intentionally empty: the server run context carries no
    // catalog pin data, so kicad-component deletes BLOCK (fail closed with
    // `pins-unavailable`) exactly as the compiler mandates.
    const compilation = compileTier1Proposal(schematic, { ops, pinsByPartId: new Map() });
    const sealed = sealTier1Proposal({
      state: schematic,
      compilation,
      provenance: { provider: input.provenance.provider, note: "Proposed by the Sirkit agent tool loop.", instruction: input.provenance.instruction.slice(0, 500) },
      now: this.now(),
      scope,
      authorization,
    });
    if (sealed.kind === "blocked") {
      return { status: "blocked", blockers: sealed.blockers.map((blocker) => ({ code: blocker.code, detail: blocker.detail })) };
    }
    // 7. The sealed base digest MUST equal the run's verified snapshot digest.
    if (sealed.proposal.baseSchematicDigest !== schematicStateDigest(schematic) || sealed.proposal.baseSchematicDigest !== input.context.schematicDigest) {
      return { status: "refused", failure: "stale_revision", diagnostics: ["Sealed base digest does not match the verified run snapshot; proposal discarded."] };
    }
    return { status: "sealed", proposal: sealed.proposal };
  }

  /**
   * [B14 §A] the replacement proposal path. Strict {componentId,
   * expectedMpn?} input — the model can NEVER supply asset identities, pin
   * definitions, authority claims, approvals, or dropped-pin
   * acknowledgements (unknown keys refuse). Target identity and pin facts
   * are server-derived; the assembler blocks anything outside the strict
   * B14 envelope with zero mutation.
   */
  private async invokeReplacement(
    input: ProposalInvocationInput,
    schematic: SchematicState,
    scope: Tier1ProposalScope,
    authorization: SchematicProposalAuthorizationBinding,
  ): Promise<ProposalInvocationOutcome> {
    const args = input.args;
    for (const key of Object.keys(args)) {
      if (key !== "componentId" && key !== "expectedMpn") {
        return { status: "refused", failure: "invalid_input", diagnostics: [`Unexpected argument "${key.slice(0, 40)}" — the replacement proposal accepts only componentId and an optional expectedMpn assertion.`] };
      }
    }
    const componentId = args.componentId;
    if (typeof componentId !== "string" || componentId.length === 0 || componentId.length > 200) {
      return { status: "refused", failure: "invalid_input", diagnostics: ["componentId must be the stable component instance id (1–200 chars)."] };
    }
    const expectedMpn = args.expectedMpn;
    if (expectedMpn !== undefined && (typeof expectedMpn !== "string" || expectedMpn.length === 0 || expectedMpn.length > 200)) {
      return { status: "refused", failure: "invalid_input", diagnostics: ["expectedMpn, when present, must be a 1–200 char string (an assertion, never a choice)."] };
    }
    // [B14] the SERVER-OWNED component-authority resource is REQUIRED.
    const authority = input.context.componentAuthority;
    if (!authority || !input.context.canonicalState || !input.context.canonicalRevisionDigest) {
      return { status: "refused", failure: "authority_unavailable", diagnostics: ["No server-owned component-authority resource is available for this run; the replacement proposal tool is unavailable."] };
    }
    // Pre-resolve SERVER-OWNED pin facts (keyed lookups only — the assembler
    // performs every verification). Missing fetcher/facts fail closed inside
    // the assembler as structured blockers.
    const instance = (schematic.kicadComponents ?? []).find((candidate) => candidate.id === componentId);
    const record = authority.records.find((candidate) => candidate.componentId === componentId);
    const exact = record?.exactAuthority;
    let currentPinFacts: PublishedSymbolPinFacts | null = null;
    let targetPinFacts: PublishedSymbolPinFacts | null = null;
    try {
      if (this.replacementPinFacts && instance?.atomicPartRevisionId) {
        currentPinFacts = await this.replacementPinFacts(instance.atomicPartRevisionId);
      }
      if (this.replacementPinFacts && exact?.atomicPartRevisionId) {
        targetPinFacts = await this.replacementPinFacts(exact.atomicPartRevisionId);
      }
    } catch {
      currentPinFacts = null;
      targetPinFacts = null;
    }
    const outcome = assembleReplacementProposal({
      state: schematic,
      componentId,
      ...(expectedMpn !== undefined ? { expectedMpn } : {}),
      authority: { records: authority.records, candidates: authority.candidates ?? [] },
      scope,
      authorization,
      currentPinFacts,
      targetPinFacts,
      provenance: { provider: input.provenance.provider, note: "Proposed by the Sirkit agent tool loop.", instruction: input.provenance.instruction.slice(0, 500) },
      now: this.now(),
    });
    if (outcome.kind === "blocked") {
      return { status: "blocked", blockers: outcome.blockers.map((blocker) => ({ code: blocker.code, detail: blocker.detail })) };
    }
    if (outcome.proposal.baseSchematicDigest !== schematicStateDigest(schematic) || outcome.proposal.baseSchematicDigest !== input.context.schematicDigest) {
      return { status: "refused", failure: "stale_revision", diagnostics: ["Sealed base digest does not match the verified run snapshot; proposal discarded."] };
    }
    return { status: "sealed", proposal: outcome.proposal };
  }

  /**
   * [B15.3 §H] the bounded PCB edit proposal path. Provider arguments are
   * ONLY {intent, operations} (the handler refuses unknown keys by name);
   * the board, scope, canonical resource pin, history basis, lineage, and
   * validation policy are all derived from the VERIFIED run context and the
   * run's sealed resource bundle. Sealing mutates NOTHING.
   */
  private invokePcbEdit(input: ProposalInvocationInput): ProposalInvocationOutcome {
    const board = input.context.canonicalState?.pcb;
    if (!board || !input.context.canonicalRevisionDigest) {
      return { status: "refused", failure: "authority_unavailable", diagnostics: ["No complete validated canonical PCB board exists for this run; the PCB proposal tool is unavailable."] };
    }
    // The run's SEALED canonical-state resource — the exact envelope the
    // read boundary consumes; its content digest pins the proposal's base
    // resource identity. Sealed fresh per invocation, never provider data.
    let canonicalResource: { resourceId: string; contentDigest: string };
    try {
      const bundle = buildAgentResourceBundle(input.context);
      canonicalResource = { resourceId: bundle.canonicalState.resourceId, contentDigest: bundle.canonicalState.contentDigest };
    } catch {
      return { status: "refused", failure: "authority_unavailable", diagnostics: ["The canonical PCB resource envelope cannot be sealed for this run; the PCB proposal tool is unavailable."] };
    }
    const outcome = handlePcbProposeTool({
      args: input.args,
      context: input.context,
      canonicalResource,
      provider: input.provenance.provider,
      runId: input.runId ?? "unidentified-run",
      nonce: randomUUID().replace(/-/g, ""),
      now: this.now(),
    });
    if (outcome.status === "sealed") return { status: "sealed", proposal: outcome.proposal };
    if (outcome.status === "blocked") return { status: "blocked", blockers: outcome.blockers };
    return { status: "refused", failure: outcome.failure, diagnostics: outcome.diagnostics };
  }
}

// ─── The gateway ─────────────────────────────────────────────────────────────

export interface AgentGatewayOptions {
  readService?: ReadToolInvocationService;
  proposalService?: ProposalInvocationService;
  now?: () => number;
  /** [B14 §B] server-owned published pin facts for the replacement proposal
   *  path — wired by the SERVER composition root only. Absent ⇒ the
   *  replacement proposal blocks with a structured pin-authority blocker. */
  replacementPinFacts?: ReplacementPinFactsFetcher;
  /** [B17-F] the server composition root's local routing engine for the
   *  routing proposal (a resolved FreeRouting pass executor per request);
   *  absent ⇒ the routing proposal refuses truthfully. */
  routingExecutor?: RoutingExecutorFactory;
  layoutProposalService?: LayoutProposalService;
  /** [B18-B] the server composition root's execution-grant minter (a
   *  closure over the trusted request context). Absent ⇒ no Tier 1
   *  execution can be granted in this run. The gateway dispatch branch that
   *  seals a mutation intent and mints through it lands with the exposure
   *  lift (B18-C); until then every mutation class stays not_callable. */
  executionGrants?: AgentExecutionGrantMinter;
}

export function createAgentToolGateway(registry: ToolRegistry, options?: AgentGatewayOptions): AgentToolInvocationGateway {
  const readService = options?.readService ?? new ReadToolInvocationService(registry);
  const proposalService = options?.proposalService ?? new ProposalInvocationService(registry, options?.now, options?.replacementPinFacts);
  const layoutService = options?.layoutProposalService ?? new LayoutProposalService(registry, { now: options?.now, routingExecutor: options?.routingExecutor });
  return {
    async invoke(input): Promise<GatewayInvocationOutcome> {
      const descriptor = registry.get(input.toolId, input.version);
      if (!descriptor) {
        return { kind: "refused", ok: false, toolId: input.toolId, status: "not_registered", diagnostics: ["Unknown tool."] };
      }
      // [B09.2] actor/discovery divergence fails EVERY invocation closed.
      const integrity = verifyAgentContextIntegrity(input.context);
      if (integrity.length > 0) {
        return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: "context_integrity", diagnostics: integrity.slice(0, 5) };
      }
      if (descriptor.operationClass === "read") {
        // [B09.3] without a COMPLETE validated canonical project resource,
        // EVERY read fails closed — including schematic inspection, whose
        // only registered path is the B05/B05.1 canonical-state binding.
        // No ad hoc resource or bypass exists; B10 restores live read
        // availability by delivering authoritative board context.
        if (!input.context.canonicalState || !input.context.canonicalRevisionDigest) {
          return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: "authority_unavailable", diagnostics: ["No complete validated canonical project state exists for this run; the tool's required resource cannot be assembled."] };
        }
        // The REAL B05/B05.1 boundary with a per-invocation fresh bundle.
        const bundle = buildAgentResourceBundle(input.context);
        const result = await readService.invoke(
          {
            invocationId: `agent-${randomUUID()}`,
            toolId: descriptor.toolId,
            toolVersion: descriptor.version,
            tenantId: input.context.tenantId,
            projectId: input.context.projectId,
            branchId: input.context.branchId,
            actorId: input.context.actor.actorId,
            actorRole: input.context.actor.actorRole,
            grantedCapabilities: input.context.actor.grantedCapabilities,
            channel: "assistant-agent",
            canonicalRevisionDigest: input.context.canonicalRevisionDigest,
            authoritySource: "local-working-copy",
            currentEditor: input.context.discovery.currentEditor,
            args: input.args,
            timeoutMs: input.timeoutMs,
            cancellation: input.signal,
            traceId: `agent-run-${input.runId}`,
            requestTimestamp: options?.now ? options.now() : Date.now(),
          },
          input.context.discovery,
          bundle,
        );
        if (result.status === "succeeded") {
          return { kind: "read", ok: true, toolId: result.toolId, version: result.toolVersion, output: result.output, sourceRevisionDigest: result.sourceRevisionDigest, verification: result.verification };
        }
        return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: result.status, diagnostics: result.diagnostics };
      }
      // [B17-F] view-session tools: the gateway VALIDATES the request against
      // the registry-backed command list, the captured surface, the board, the
      // command's role gate and its exact payload contract, then hands the
      // browser a request to dispatch on the user's own view bus. Nothing
      // executes here; nothing is engineering state.
      if (descriptor.operationClass === "view-session") {
        if (descriptor.binding.status !== "bound-view-session" || !descriptor.agentExposed) {
          return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: "not_callable", diagnostics: ["Only bound, exposed view-session tools are invocable here."] };
        }
        const discovery = discoverTools(registry, input.context.discovery);
        if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
          const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
          return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: "not_discoverable", diagnostics: [`Tool is not discoverable in the current context (${reason}).`] };
        }
        if (!descriptor.requiredRoles.includes(input.context.actor.actorRole) || !input.context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
          return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: "unauthorized", diagnostics: [`Role ${input.context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`] };
        }
        const prepared = prepareViewCommandRequest({
          descriptor,
          args: input.args,
          context: {
            canonicalState: input.context.canonicalState,
            view: input.context.view,
            actor: { actorId: input.context.actor.actorId, role: input.context.actor.actorRole, actorKind: "agent" },
            runId: input.runId,
            ...(options?.now ? { now: options.now } : {}),
          },
        });
        if (!prepared.ok) return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: prepared.status, diagnostics: prepared.diagnostics };
        return { kind: "view-command", ok: true, toolId: input.toolId, version: input.version, request: prepared.request };
      }
      // [B17-F] layout proposals produce the shared revision-bound candidate
      // (an artifact for the editor's own review panel), never a mutation.
      if (descriptor.operationClass === "propose" && LAYOUT_PROPOSAL_TOOL_IDS.includes(descriptor.toolId)) {
        const outcome = await layoutService.invoke({ toolId: input.toolId, version: input.version, args: input.args, context: input.context, runId: input.runId, timeoutMs: input.timeoutMs, signal: input.signal });
        if (outcome.status === "candidate") return { kind: "layout-candidate", ok: true, toolId: input.toolId, version: input.version, candidate: outcome.candidate };
        return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: outcome.failure, diagnostics: outcome.diagnostics };
      }
      if (descriptor.operationClass === "propose") {
        // [B09.1] real provider provenance — never the placeholder "agent".
        const outcome = await proposalService.invoke({
          toolId: input.toolId,
          version: input.version,
          args: input.args,
          context: input.context,
          provenance: { provider: input.provider, instruction: typeof input.args.instruction === "string" ? input.args.instruction : "agent tool loop" },
          runId: input.runId,
        });
        if (outcome.status === "sealed") {
          // [B15.3] the PCB proposal rides its DISTINCT outcome kind so the
          // schematic proposal path can never receive one.
          if (outcome.proposal.schema === PCB_EDIT_PROPOSAL_SCHEMA) {
            return { kind: "pcb-proposal", ok: true, toolId: input.toolId, version: input.version, proposal: outcome.proposal };
          }
          return { kind: "proposal", ok: true, toolId: input.toolId, version: input.version, proposal: outcome.proposal };
        }
        if (outcome.status === "blocked") return { kind: "proposal-blocked", ok: false, toolId: input.toolId, version: input.version, blockers: outcome.blockers };
        return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: outcome.failure, diagnostics: outcome.diagnostics };
      }
      // Mutation/destructive/release can never execute here.
      return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: "not_callable", diagnostics: [`Operation class ${descriptor.operationClass} is not executable through the agent gateway.`] };
    },
  };
}
