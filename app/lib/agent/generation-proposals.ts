/**
 * [PR-D] The agent's Build-mode GENERATION proposal: `sirkit.schematic.generate-proposal`, the semantic equivalent of the Build
 * composer's Generate (app/page.tsx POSTs /api/schematic/build-multi and offers the result in the schematic review dialog).
 * Both run the ONE function `runBuildMultiGeneration` (app/lib/schematic/build-multi-generation.ts) under the SAME bounds
 * (`BUILD_BUDGET`): the route serializes its outcome, this service seals it into an INERT proposal. Nothing here generates:
 * the server port is INJECTED into the gateway by the chat route through its one approved runtime boundary
 * (app/api/chat/schematic-generation-runtime.ts), behind the server's own generation fact (`schematicGenerationAvailable`),
 * exactly as the external reads (acquisition-reads.ts) and the named computations (computation-reads.ts) are.
 *
 * Per invocation: the exact allowlisted binding, the context integrity check, the server's fact AND port, a fresh discovery
 * check, the role and capability recheck against the effective actor, a validated schematic with its canonical head mark (the
 * sheet the proposal would REPLACE - the page's pin), the closed argument surface (exactly `prompt`), the run's remaining wall
 * clock (the budget: a generation that cannot fit is refused `budget_exhausted` before anything runs), then the port under a
 * deadline composed with the run's cancellation. A complete OR partial generation is SEALED - completeness, omitted blocks,
 * the electrical check's state, the planner's state and the budget spent travel as DATA inside the artifact, never as prose;
 * a failed generation is `proposal-blocked` with the failure class, the provider's reason and whether a retry can help as its
 * blockers (`generationFailureBlockers`), never `ok: true`. Nothing is ever applied here: the human approves or discards the
 * proposal in the review dialog (the page's intake of this artifact is a later round; its contract is this file).
 */
import type { LLMProviderId } from "../llm/types";
import { LLMProviderError, isRetryableReason } from "../llm/errors";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";
import type { BuildMultiGenerationOutcome } from "../schematic/build-multi-generation";
import { BUILD_BUDGET, type BuildBudgetReport, type BuildCompleteness, type BuildMultiFailure, type BuildMultiSuccess, type BuildPlannerStatus, type ElectricalCheckStatus } from "../schematic/build-result";
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { engineeringDigest } from "../engineering/stable";
import { buildAuthorizationBinding, isWellFormedAuthorizationBinding, type SchematicProposalAuthorizationBinding } from "../engineering/proposal-authorization";
import { validateSchematicCanonicalMark } from "../engineering/schematic-projection";
import type { Tier1ProposalScope } from "../engineering/schematic-proposals";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export const AGENT_GENERATION_PROPOSAL_TOOL_ID = "sirkit.schematic.generate-proposal" as const;
/** The sealed artifact's schema id (discriminate on `schema`, as for every other sealed proposal family). */
export const GENERATION_PROPOSAL_SCHEMA = "sirkit.schematic-generation-proposal.v1" as const;
/** A generation proposal expires like a tier-1 proposal; an expired one can only be regenerated. */
export const GENERATION_PROPOSAL_TTL_MS = 10 * 60 * 1000;
/** The authority source the descriptor requires: advertised ONLY when the chat route bound the generation port to the run. */
export const GENERATION_AUTHORITY = "schematic-generation" as const;
/** The ONE proven implementation the descriptor binds (the route's own function; `resolveGenerationBinding` matches it exactly). */
export const GENERATION_BINDING = Object.freeze({ module: "app/lib/schematic/build-multi-generation.ts", symbol: "runBuildMultiGeneration" });
/** The prompt bound (the composer's request is one paragraph; the B05 input limits bound the raw argument first). */
export const MAX_GENERATION_PROMPT_CHARS = 4_000;
/** The run must have at least this much wall clock left for a generation to start (one planner turn and one loop turn). */
export const MIN_GENERATION_BUDGET_MS = 5_000;
/** The generation's own deadline ends this much before the tool's race timer, so the loops stop before the race does. */
export const GENERATION_DEADLINE_MARGIN_MS = 1_000;
/** The descriptor's valid input example (the manual's example; pr-d-generate-proposal validates it against the schema). */
export const GENERATE_PROPOSAL_INPUT_EXAMPLE = Object.freeze({ prompt: "A 555 timer LED blinker powered from a 9 V battery through a 5 V linear regulator." });

// ─── The port the chat route injects ────────────────────────────────────────────────────────────────────────────────────────

export interface SchematicGenerationPortRequest {
  readonly prompt: string;
  readonly provider: LLMProviderId;
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly branchId: string };
  readonly runId: string;
  /** The wall clock the generation may use, in ms (never above `BUILD_BUDGET.deadlineMs`; the port may only tighten further). */
  readonly deadlineMs: number;
  /** The run's cancellation. The generation itself has no cancellation seam: the service stops waiting; the port's work ends at its deadline. */
  readonly signal: AbortSignal;
}
/** The server port: `runBuildMultiGeneration` behind a configured provider (app/api/chat/schematic-generation-runtime.ts); faked in tests. */
export interface SchematicGenerationPort {
  generate(request: SchematicGenerationPortRequest): Promise<BuildMultiGenerationOutcome>;
}

// ─── The sealed artifact ────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the generation produced, as DATA (app/lib/schematic/build-result.ts): the page renders completeness and checks beside the proposal. */
export interface SchematicGenerationResult {
  status: BuildCompleteness;
  netlist: BuildLogicalNetlist;
  explanation: string;
  omittedBlocks: string[];
  electricalCheck: ElectricalCheckStatus;
  planner: BuildPlannerStatus;
  budget: BuildBudgetReport;
}

/**
 * The sealed Build-mode generation proposal. Receiving or displaying one mutates NOTHING. It binds, under one whole-body identity
 * digest: the tool, the scope (tenant/project/branch + the editor's canonical head mark, the tier-1 scope contract), the
 * authorization binding (verified principal + membership revision), the base schematic digest (the sheet the generation would
 * REPLACE - the page's `pin.baseDigest`), the request, the generation result, the netlist digest, actor and effective actor,
 * provenance, creation and expiry. The page's intake lays the netlist out through the SAME `autoLayoutBuildValidated` the Build
 * composer uses and offers it in the SAME review dialog, refusing it when the base digest no longer matches (stale), when the
 * scope or head mark differ (foreign/stale-head), or past `expiresAt`.
 */
export interface SealedSchematicGenerationProposal {
  schema: typeof GENERATION_PROPOSAL_SCHEMA;
  proposalId: string;
  toolId: typeof AGENT_GENERATION_PROPOSAL_TOOL_ID;
  version: string;
  scope: Tier1ProposalScope;
  authorization: SchematicProposalAuthorizationBinding;
  /** `schematicStateDigest` of the validated sheet the generation replaces. */
  baseSchematicDigest: string;
  /** The generation is a Build-mode result (real catalog parts); the intake treats it as the Build Generate path. */
  mode: "build";
  request: { prompt: string; provider: LLMProviderId };
  generation: SchematicGenerationResult;
  /** Digest over the base and the generated netlist; the trace records it as the proposal's operations digest. */
  netlistDigest: string;
  actor: { actorId: string; kind: "ai" };
  /** the verified principal the proposal is sealed for (`human`: a session principal or the local build's owner; `worker`: a machine principal) */
  effectiveActor: { actorId: string; kind: "human" | "worker" };
  provenance: { provider: string; runId: string; note: string; instruction: string };
  createdAt: number;
  expiresAt: number;
}

const IDENTITY_DIGEST_SCHEMA = "sirkit.schematic-generation-proposal-id.v1";
const NETLIST_DIGEST_SCHEMA = "sirkit.schematic-generation-netlist.v1";
const PROPOSAL_KEYS = Object.freeze(["schema", "proposalId", "toolId", "version", "scope", "authorization", "baseSchematicDigest", "mode", "request", "generation", "netlistDigest", "actor", "effectiveActor", "provenance", "createdAt", "expiresAt"] as const);
const GENERATION_KEYS = Object.freeze(["status", "netlist", "explanation", "omittedBlocks", "electricalCheck", "planner", "budget"] as const);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function generationNetlistDigest(baseSchematicDigest: string, netlist: BuildLogicalNetlist): string {
  return engineeringDigest({ schema: NETLIST_DIGEST_SCHEMA, base: baseSchematicDigest, netlist });
}

export type GenerationProposalVerification =
  | { ok: true }
  | { ok: false; code: "malformed" | "wrong-version" | "altered"; detail: string };

/** INTEGRITY-ONLY verification (the page's intake runs it first): schema, exact shape, both sealed digests. Currency (the live
 *  base digest, scope, head mark and expiry) is the intake's own check against the live editor, as for the tier-1 proposal. */
export function verifySealedSchematicGenerationProposalIntegrity(candidate: unknown): GenerationProposalVerification {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return { ok: false, code: "malformed", detail: "The proposal is not an object." };
  const proposal = candidate as Record<string, unknown>;
  if (proposal.schema !== GENERATION_PROPOSAL_SCHEMA) return { ok: false, code: "wrong-version", detail: "The proposal is not a sirkit.schematic-generation-proposal.v1 artifact." };
  const keys = Object.keys(proposal).sort();
  if (keys.join(",") !== [...PROPOSAL_KEYS].sort().join(",")) return { ok: false, code: "malformed", detail: "The proposal does not carry exactly the sealed key set." };
  if (proposal.toolId !== AGENT_GENERATION_PROPOSAL_TOOL_ID || proposal.mode !== "build") return { ok: false, code: "malformed", detail: "The proposal names another tool or mode." };
  const scope = proposal.scope as Partial<Tier1ProposalScope> | null;
  if (!scope || typeof scope !== "object" || typeof scope.tenantId !== "string" || typeof scope.projectId !== "string" || typeof scope.branchId !== "string" || validateSchematicCanonicalMark(scope.headMark) === null) {
    return { ok: false, code: "malformed", detail: "The proposal scope or its canonical head mark is malformed." };
  }
  if (!isWellFormedAuthorizationBinding(proposal.authorization) || proposal.authorization.tenantId !== scope.tenantId || proposal.authorization.projectId !== scope.projectId || proposal.authorization.branchId !== scope.branchId) {
    return { ok: false, code: "malformed", detail: "The authorization binding is malformed or does not agree with the sealed scope." };
  }
  const generation = proposal.generation as Record<string, unknown> | null;
  if (!generation || typeof generation !== "object" || Object.keys(generation).sort().join(",") !== [...GENERATION_KEYS].sort().join(",")) return { ok: false, code: "malformed", detail: "The generation result does not carry exactly its key set." };
  if ((generation.status !== "complete" && generation.status !== "partial") || !Array.isArray(generation.omittedBlocks)) return { ok: false, code: "malformed", detail: "The generation's completeness is malformed." };
  const netlist = generation.netlist as Partial<BuildLogicalNetlist> | null;
  if (!netlist || typeof netlist !== "object" || !Array.isArray(netlist.components) || !Array.isArray(netlist.connections)) return { ok: false, code: "malformed", detail: "The generated netlist is malformed." };
  if (typeof proposal.baseSchematicDigest !== "string" || typeof proposal.netlistDigest !== "string" || typeof proposal.proposalId !== "string") return { ok: false, code: "malformed", detail: "A sealed digest is missing." };
  if (generationNetlistDigest(proposal.baseSchematicDigest, netlist as BuildLogicalNetlist) !== proposal.netlistDigest) return { ok: false, code: "altered", detail: "The netlist digest does not match the sealed netlist." };
  const { proposalId, ...body } = proposal;
  if (`genprop-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5)}` !== proposalId) return { ok: false, code: "altered", detail: "The proposal body does not match its sealed identity." };
  return { ok: true };
}

// ─── Failures as data ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A failed generation as the `proposal-blocked` blockers the loop already carries to the model and the page: the failure class
 *  (`code`: build_budget_exhausted / build_loop_failed / build_invalid_output / provider_unavailable) with its sentence, whether a
 *  retry can help (`retryable` / `not_retryable`), the provider and its reason (`insufficient_quota`, `breaker_open`, ...) when known. */
export function generationFailureBlockers(failure: BuildMultiFailure): Array<{ code: string; detail: string }> {
  const retryable = failure.retryable !== false;
  return [
    { code: failure.code, detail: sanitizeTraceText(failure.error, 300) },
    { code: retryable ? "retryable" : "not_retryable", detail: retryable ? "A retry can help; nothing was generated or changed." : "A retry will not help until the cause is resolved; nothing was generated or changed." },
    ...(failure.provider ? [{ code: "provider", detail: failure.provider }] : []),
    ...(failure.reason ? [{ code: "provider_reason", detail: sanitizeTraceText(failure.reason, 120) }] : []),
  ];
}

/** The planner's provider failure as the same failure contract the route answers (503 `provider_unavailable`, the provider's reason). */
export function providerFailureOf(error: unknown, provider: LLMProviderId): BuildMultiFailure {
  const normalized = error instanceof LLMProviderError ? error : null;
  return {
    ok: false,
    code: "provider_unavailable",
    error: sanitizeTraceText(normalized?.message ?? (error instanceof Error ? error.message : String(error)), 300) || "The provider request failed.",
    provider: normalized?.provider ?? provider,
    reason: normalized?.reason ?? "unknown",
    retryable: normalized ? isRetryableReason(normalized.reason) : false,
  };
}

// ─── Binding resolution ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type GenerationBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

/** Allowlist-only: the descriptor is callable here only as the one generation proposal over the one shared function. */
export function resolveGenerationBinding(descriptor: ToolDescriptor): GenerationBindingResolution {
  if (descriptor.toolId !== AGENT_GENERATION_PROPOSAL_TOOL_ID) return { state: "not_callable", reason: "Only the generation proposal is invocable here." };
  if (descriptor.operationClass !== "propose" || descriptor.sideEffects !== "proposal-artifact" || descriptor.approvalTier !== "none") return { state: "not_callable", reason: "The generation proposal is a sealed proposal artifact (propose class, proposal-artifact side effects, no approval tier of its own)." };
  if (descriptor.binding.status !== "bound-proposal" || descriptor.binding.module !== GENERATION_BINDING.module || descriptor.binding.symbol !== GENERATION_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one shared generation function." };
  if (descriptor.requiredAuthority.length !== 1 || descriptor.requiredAuthority[0] !== GENERATION_AUTHORITY) return { state: "not_callable", reason: "The generation proposal requires exactly the schematic-generation authority." };
  return { state: "resolved" };
}

// ─── The service ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "scope", "headMark", "revision", "expectedRevision", "lineageId", "provider", "netlist", "schematic", "budget", "deadline"]);

export interface SchematicGenerationProposalServiceOptions {
  /** The server port, injected by the composition root; absent: the generation proposal refuses authority_unavailable. */
  port?: SchematicGenerationPort;
  /** The gateway's context integrity check (injected so this module never imports the gateway). */
  integrity: (context: AgentRunContext) => readonly string[];
  now?: () => number;
}
export interface SchematicGenerationProposalInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; provider: LLMProviderId; timeoutMs: number; signal?: AbortSignal }

class GenerationTimeout { readonly kind = "timeout"; }
class GenerationCancelled { readonly kind = "cancelled"; }

export class SchematicGenerationProposalService {
  constructor(private readonly registry: ToolRegistry, private readonly options: SchematicGenerationProposalServiceOptions) {}

  async invoke(input: SchematicGenerationProposalInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const blocked = (blockers: Array<{ code: string; detail: string }>): GatewayInvocationOutcome => ({ kind: "proposal-blocked", ok: false, toolId: input.toolId, version: input.version, blockers });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveGenerationBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    const port = this.options.port;
    if (!port || context.schematicGenerationAvailable !== true) return refuse("authority_unavailable", ["No schematic generation provider is bound to this run; the generation proposal is unavailable."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    }
    // The base the proposal replaces: a validated schematic with its canonical head mark (the tier-1 scope contract).
    if (!context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No verified schematic snapshot is available for this run; the generation proposal is unavailable."]);
    const headMark = context.schematicHeadMark ? validateSchematicCanonicalMark(context.schematicHeadMark) : null;
    if (!headMark) return refuse("authority_unavailable", ["No canonical schematic head mark is available for this run; the generation proposal is unavailable until the editor session is ready."]);
    // The closed argument surface: exactly `prompt`; authority-shaped keys are refused by name.
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    for (const key of Object.keys(input.args)) {
      if (key === "prompt") continue;
      return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - the generation proposal accepts only prompt.` : `Unexpected argument "${key.slice(0, 40)}" - the generation proposal accepts only prompt.`]);
    }
    const prompt = typeof input.args.prompt === "string" ? input.args.prompt.trim() : "";
    if (prompt.length === 0 || prompt.length > MAX_GENERATION_PROMPT_CHARS) return refuse("invalid_input", [`prompt must be 1 to ${MAX_GENERATION_PROMPT_CHARS} characters of plain text describing the circuit.`]);
    // The budget: the run's remaining wall clock (the loop hands a long-running tool min(its timeout, the run's remaining time)).
    if (input.signal?.aborted) return refuse("cancelled", ["The run was cancelled before the generation started; nothing was generated or changed."]);
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs < MIN_GENERATION_BUDGET_MS) return refuse("budget_exhausted", [`The run's remaining wall clock (${Math.max(0, Math.floor(input.timeoutMs))} ms) cannot hold a Build-mode generation (at least ${MIN_GENERATION_BUDGET_MS} ms); nothing was generated or changed.`]);
    const deadlineMs = Math.max(1_000, Math.min(BUILD_BUDGET.deadlineMs, Math.floor(input.timeoutMs) - GENERATION_DEADLINE_MARGIN_MS));
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: BuildMultiGenerationOutcome | GenerationTimeout | GenerationCancelled;
    try {
      outcome = await Promise.race<BuildMultiGenerationOutcome | GenerationTimeout | GenerationCancelled>([
        port.generate({ prompt, provider: input.provider, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }, runId: input.runId, deadlineMs, signal: controller.signal }),
        new Promise<GenerationTimeout>((resolve) => { timer = setTimeout(() => resolve(new GenerationTimeout()), Math.floor(input.timeoutMs)); }),
        new Promise<GenerationCancelled>((resolve) => { controller.signal.addEventListener("abort", () => resolve(new GenerationCancelled()), { once: true }); }),
      ]);
    } catch (error) {
      return refuse("implementation_failed", [`The generation failed internally: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was generated or changed.`]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }
    if (outcome instanceof GenerationTimeout) return refuse("timeout", [`The generation did not finish within the run's remaining ${Math.floor(input.timeoutMs)} ms; nothing was generated or changed.`]);
    if (outcome instanceof GenerationCancelled) return refuse("cancelled", ["The run was cancelled while generating; nothing was generated or changed."]);
    if (outcome.kind === "provider_error") return blocked(generationFailureBlockers(providerFailureOf(outcome.error, input.provider)));
    if (outcome.kind === "failure") return blocked(generationFailureBlockers(outcome.body));
    const now = this.options.now ? this.options.now() : Date.now();
    return { kind: "generation-proposal", ok: true, toolId: input.toolId, version: input.version, proposal: sealGenerationProposal({ body: outcome.body, prompt, provider: input.provider, runId: input.runId, context, headMark, descriptor, now }) };
  }
}

/** Seal a complete or partial generation. Pure; the caller supplied every server-derived fact. */
export function sealGenerationProposal(input: { body: BuildMultiSuccess; prompt: string; provider: LLMProviderId; runId: string; context: AgentRunContext; headMark: Tier1ProposalScope["headMark"]; descriptor: Pick<ToolDescriptor, "version">; now: number }): SealedSchematicGenerationProposal {
  const { context } = input;
  const baseSchematicDigest = context.schematicDigest!;
  const generation: SchematicGenerationResult = {
    status: input.body.status,
    netlist: structuredClone(input.body.netlist),
    explanation: input.body.explanation,
    omittedBlocks: [...input.body.omittedBlocks],
    electricalCheck: structuredClone(input.body.electricalCheck),
    planner: structuredClone(input.body.planner),
    budget: { ...input.body.budget },
  };
  const body = {
    schema: GENERATION_PROPOSAL_SCHEMA,
    toolId: AGENT_GENERATION_PROPOSAL_TOOL_ID,
    version: input.descriptor.version,
    scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, headMark: { ...input.headMark } },
    authorization: buildAuthorizationBinding({ principalId: context.actor.actorId, ...(context.actor.membershipRevision ? { membershipRevision: context.actor.membershipRevision } : {}), scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId } }),
    baseSchematicDigest,
    mode: "build" as const,
    request: { prompt: input.prompt, provider: input.provider },
    generation,
    netlistDigest: generationNetlistDigest(baseSchematicDigest, generation.netlist),
    actor: { actorId: `agent:${input.provider}`, kind: "ai" as const },
    effectiveActor: { actorId: context.actor.actorId, kind: (context.actor.source === "verified-worker" ? "worker" : "human") as "human" | "worker" },
    provenance: { provider: input.provider, runId: input.runId, note: "AI-generated Build-mode schematic, proposed for explicit human review; nothing applied", instruction: sanitizeTraceText(input.prompt, 300) },
    createdAt: input.now,
    expiresAt: input.now + GENERATION_PROPOSAL_TTL_MS,
  };
  return deepFreeze({ ...body, proposalId: `genprop-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5)}` });
}
