/**
 * [PR-F fD] The agent's MODULE CONTRACT proposal, `sirkit.module.propose-contracts` (the owner's Astra directive, sections 6-7;
 * CONTINUATION E): the model submits a module-contract set for the run's PINNED schematic; the ONE validator
 * (`validateModuleContractSet`, app/lib/engineering/module-contract.ts) checks it against that sheet - every owned component an
 * exact identity of the sheet owned exactly once, every port net a named net of the sheet, every value with its unit, every
 * recommendation with evidence that names a source, every part-authority gap acknowledged, every cross-module interface stated -
 * and the service SEALS the validated set into an INERT artifact (`sirkit.module-contract-proposal.v1`) the page shows in the run
 * log as a reviewable engineering note. Nothing applies: there is no apply path for a contract set, it changes no sheet and no
 * board; the human accepts it by continuing (or asks for another), and a richer review surface is later work. A set the validator
 * refuses is `proposal-blocked` data with every blocker listed (unknown component, double ownership, a value without units, an
 * evidence without a source, an unstated interface, a sheet beyond the qualified scope), never ok.
 *
 * Per invocation: the exact allowlisted binding, the context integrity check, a verified schematic snapshot with its digest (the
 * PINNED sheet) and its canonical head mark (the tier-1 scope contract; the loop's B09.1 gate for every schematic proposal), a
 * fresh discovery check, the role and capability recheck, the closed argument surface (exactly system, modules, constraints;
 * authority-shaped keys refused by name), then the pure validate and seal. No port, no provider, no network; one artifact per run
 * (the loop's proposal single-flight). The artifact claims no electrical verification: its `electricalCheck` is `not_run` and its
 * `verification` is the constant `contract-structure-checked`.
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { engineeringDigest } from "../engineering/stable";
import { buildAuthorizationBinding, isWellFormedAuthorizationBinding, type SchematicProposalAuthorizationBinding } from "../engineering/proposal-authorization";
import { validateSchematicCanonicalMark } from "../engineering/schematic-projection";
import type { Tier1ProposalScope } from "../engineering/schematic-proposals";
import { MODULE_CONTRACT_SCHEMA, moduleContractSetDigest, validateModuleContractSet, type ModuleContractBlocker, type ModuleContractSet } from "../engineering/module-contract";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export const MODULE_CONTRACT_PROPOSAL_TOOL_ID = "sirkit.module.propose-contracts" as const;
/** The sealed artifact's schema id (discriminate on `schema`, as for every other sealed proposal family). */
export const MODULE_CONTRACT_PROPOSAL_SCHEMA = "sirkit.module-contract-proposal.v1" as const;
/** A contract proposal expires like a tier-1 proposal; an expired one can only be re-sealed over the current sheet. */
export const MODULE_CONTRACT_PROPOSAL_TTL_MS = 10 * 60 * 1000;
/** The ONE proven implementation the descriptor binds (`resolveModuleContractBinding` matches it exactly). */
export const MODULE_CONTRACT_BINDING = Object.freeze({ module: "app/lib/engineering/module-contract.ts", symbol: "validateModuleContractSet" });
/** What the artifact says about itself: identities, nets, units, evidence shape and interface statements were checked against the pinned sheet; nothing electrical was. */
export const MODULE_CONTRACT_VERIFICATION = "contract-structure-checked" as const;
/** The event the loop emits for the sealed note (the page shows it in the run log; no apply). */
export const MODULE_CONTRACTS_READY_EVENT = "module_contracts_ready" as const;
/** Where the human meets the artifact today. */
export const MODULE_CONTRACT_REVIEW_PATH = "the chat run log (the page's note for module_contracts_ready): an engineering note the human reads and accepts by continuing, or asks the assistant to revise; no apply, nothing changes the sheet or a board; a richer review surface is later work";

// ─── The closed request ─────────────────────────────────────────────────────────────────────────────────────────────────────

const REQUEST_KEYS = Object.freeze(["system", "modules", "constraints"] as const);
/** Refused by name: a claim of authority, a verification, or a resource the service reads from the run itself. */
const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "approve", "approved", "accept", "accepted", "apply", "commit", "bind", "publish", "publication", "release", "certificate", "mappingCertificateId", "verified", "verification", "electricalCheck", "erc", "drc", "simulated", "revision", "revisionId", "expectedRevision", "lineageId", "scope", "headMark", "schematic", "netlist", "board", "snapshot", "partAuthority", "coverage", "schema", "proposalId", "digest", "baseSchematicDigest"]);

/** The descriptor's valid input example (the manual's example): an anti-alias filter feeding an ADC, their interface stated. */
export const MODULE_CONTRACT_INPUT_EXAMPLE = Object.freeze({
  system: { name: "Single-channel acquisition front end", statement: "A 0 to 2.5 V sensor signal, band-limited and sampled by a 12-bit ADC at 10 kS/s from a 3.3 V rail; the ADC reference is the rail.", operatingConditions: [{ name: "ambient temperature", value: 70, unit: "degC", bound: "max" }] },
  modules: [
    {
      id: "lpf", name: "Anti-alias low-pass filter", responsibility: "Band-limit the sensor signal below the ADC's Nyquist frequency and present it to the ADC input.",
      components: [{ refDes: "R1" }, { refDes: "C1" }],
      ports: [
        { id: "in", net: "VIN", direction: "input", logicLevel: "analog", voltage: [{ name: "signal", value: 0, unit: "V", bound: "min" }, { name: "signal", value: 2.5, unit: "V", bound: "max" }], impedance: [{ name: "input impedance", value: 10000, unit: "ohm", bound: "nominal" }], unknown: ["current", "permittedLoading"], evidence: [{ sourceIdentity: "sensor datasheet", documentRevision: "rev B", section: "electrical characteristics", applicability: "VIN at 25 degC", assumptions: "sensor output within its rated range", uncertainty: "tolerance not stated by the source", kind: "hard-requirement" }] },
        { id: "out", net: "AIN", direction: "output", logicLevel: "analog", voltage: [{ name: "signal", value: 2.5, unit: "V", bound: "max" }], impedance: [{ name: "output impedance", value: 10000, unit: "ohm", bound: "nominal" }], permittedLoading: [{ name: "load capacitance", value: 50, unit: "pF", bound: "max" }], unknown: ["current"], evidence: [{ sourceIdentity: "RC network analysis of R1 and C1", documentRevision: "this contract", section: "lpf.out", applicability: "AIN driving the ADC sample capacitor", assumptions: "C1 much larger than the sample capacitor", uncertainty: "R1 and C1 tolerances not stated", kind: "optimization-goal" }] },
      ],
      requirements: [{ topic: "bandwidth", statement: "Cut-off well below the Nyquist frequency of 5 kHz.", quantities: [{ name: "cut-off frequency", value: 1600, unit: "Hz", bound: "nominal" }], evidence: [{ sourceIdentity: "ADC datasheet", documentRevision: "rev C", section: "sampling and anti-aliasing", applicability: "10 kS/s sampling", assumptions: "first-order RC filter", uncertainty: "attenuation at Nyquist not computed here", kind: "approved-policy" }] }],
      unknown: ["noise", "accuracy", "timing"], notApplicable: ["gain", "power", "reference", "ground", "startup", "protection"],
      partAuthorityGaps: [], placementRouting: ["keep C1 at the ADC input pin"], tests: [{ id: "lpf-fc", procedure: "sweep VIN 100 Hz to 20 kHz and measure AIN", acceptance: "-3 dB at the cut-off frequency within tolerance", quantities: [{ name: "attenuation at cut-off", value: -3, unit: "dB", bound: "nominal" }], evidence: [] }],
    },
    {
      id: "adc", name: "ADC interface", responsibility: "Sample AIN at 10 kS/s referenced to the 3.3 V rail and deliver codes on the SPI bus.",
      components: [{ refDes: "U1" }],
      ports: [
        { id: "ain", net: "AIN", direction: "input", logicLevel: "analog", voltage: [{ name: "absolute maximum", value: 3.6, unit: "V", bound: "max" }], impedance: [{ name: "sample capacitance", value: 20, unit: "pF", bound: "typical" }], unknown: ["current", "permittedLoading"], evidence: [{ sourceIdentity: "ADC datasheet", documentRevision: "rev C", section: "analog input", applicability: "U1 AIN pin", assumptions: "acquisition time as specified", uncertainty: "none stated", kind: "hard-requirement" }] },
        { id: "vref", net: "+3V3", direction: "power-in", voltage: [{ name: "supply and reference", value: 3.3, unit: "V", bound: "nominal" }], current: [{ name: "supply current", value: 2, unit: "mA", bound: "max" }], unknown: ["impedance", "permittedLoading"], evidence: [{ sourceIdentity: "ADC datasheet", documentRevision: "rev C", section: "power supply", applicability: "U1 VDD/VREF pin", assumptions: "reference equals the supply", uncertainty: "none stated", kind: "hard-requirement" }] },
        { id: "gnd", net: "GND", direction: "ground", unknown: ["voltage", "current", "impedance", "permittedLoading"] },
      ],
      requirements: [{ topic: "accuracy", statement: "12-bit no-missing-codes over the input range.", quantities: [{ name: "resolution", value: 12, unit: "bit", bound: "nominal" }], evidence: [{ sourceIdentity: "ADC datasheet", documentRevision: "rev C", section: "DC accuracy", applicability: "U1 over temperature", assumptions: "reference noise below 1 LSB", uncertainty: "none stated", kind: "hard-requirement" }] }],
      unknown: ["noise", "timing", "startup", "protection"], notApplicable: ["bandwidth", "gain", "power", "reference", "ground"],
      partAuthorityGaps: ["U1"], placementRouting: ["decoupling at U1 VDD within the datasheet's distance"], tests: [],
    },
  ],
  constraints: [
    { id: "ain-interface", kind: "interface", net: "AIN", modules: ["lpf", "adc"], statement: "The filter drives the ADC sample capacitor; settling within the acquisition time bounds R1.", loading: { driver: "lpf", quantities: [{ name: "receiver sample capacitance", value: 20, unit: "pF", bound: "typical" }, { name: "driver permitted load", value: 50, unit: "pF", bound: "max" }] }, evidence: [{ sourceIdentity: "ADC datasheet", documentRevision: "rev C", section: "driving the analog input", applicability: "AIN between lpf.out and adc.ain", assumptions: "single-ended source", uncertainty: "settling margin not computed here", kind: "hard-requirement" }] },
    { id: "rail", kind: "shared-power", net: "+3V3", modules: ["adc"], owner: "adc", statement: "The 3.3 V rail is the ADC reference; its noise bounds the conversion.", evidence: [{ sourceIdentity: "ADC datasheet", documentRevision: "rev C", section: "reference", applicability: "+3V3 at U1", assumptions: "rail decoupled at U1", uncertainty: "rail noise not measured", kind: "approved-policy" }] },
    { id: "ground", kind: "shared-ground", net: "GND", modules: ["adc"], owner: "adc", statement: "One ground return for the filter and the ADC.", evidence: [{ sourceIdentity: "ADC datasheet", documentRevision: "rev C", section: "layout", applicability: "GND at U1", assumptions: "no split ground", uncertainty: "none stated", kind: "approved-policy" }] },
  ],
});

// ─── The sealed artifact ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The sealed module-contract proposal. Receiving or displaying one mutates NOTHING and grants nothing. It binds, under one
 * whole-body identity digest: the tool, the scope (tenant / project / branch + the editor's canonical head mark), the
 * authorization binding (verified principal + membership revision), the base schematic digest (the PINNED sheet the contracts
 * were validated against), the validated contract set with the exact identities read from that sheet, the electrical-check state
 * (not run), the review task, actor, effective actor, provenance, creation and expiry.
 */
export interface SealedModuleContractProposal {
  schema: typeof MODULE_CONTRACT_PROPOSAL_SCHEMA;
  proposalId: string;
  toolId: typeof MODULE_CONTRACT_PROPOSAL_TOOL_ID;
  version: string;
  scope: Tier1ProposalScope;
  authorization: SchematicProposalAuthorizationBinding;
  /** `schematicStateDigest` of the pinned sheet the set was validated against. */
  baseSchematicDigest: string;
  verification: typeof MODULE_CONTRACT_VERIFICATION;
  contractSet: ModuleContractSet;
  /** The one fact about verification the artifact may state: nothing electrical ran. */
  electricalCheck: ModuleContractSet["electricalCheck"];
  reviewTask: { path: string; decides: string; neverClaims: string };
  /** Digest over the base and the validated set; the trace records it as the proposal's operations digest. */
  contractDigest: string;
  actor: { actorId: string; kind: "ai" };
  effectiveActor: { actorId: string; kind: "human" | "worker" };
  provenance: { provider: string; runId: string; note: string; instruction: string };
  createdAt: number;
  expiresAt: number;
}

const IDENTITY_DIGEST_SCHEMA = "sirkit.module-contract-proposal-id.v1";
const CONTRACT_DIGEST_SCHEMA = "sirkit.module-contract-proposal-body.v1";
const PROPOSAL_KEYS = Object.freeze(["schema", "proposalId", "toolId", "version", "scope", "authorization", "baseSchematicDigest", "verification", "contractSet", "electricalCheck", "reviewTask", "contractDigest", "actor", "effectiveActor", "provenance", "createdAt", "expiresAt"] as const);
const SET_KEYS = Object.freeze(["schema", "system", "modules", "constraints", "partAuthority", "coverage", "electricalCheck"] as const);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function moduleContractProposalDigest(baseSchematicDigest: string, set: ModuleContractSet): string {
  return engineeringDigest({ schema: CONTRACT_DIGEST_SCHEMA, base: baseSchematicDigest, set: moduleContractSetDigest(set) });
}

export type ModuleContractProposalVerification = { ok: true } | { ok: false; code: "malformed" | "wrong-version" | "altered"; detail: string };

/** INTEGRITY-ONLY verification (an intake runs it first): schema, exact shape, the constant verification, both sealed digests. */
export function verifySealedModuleContractProposalIntegrity(candidate: unknown): ModuleContractProposalVerification {
  if (!record(candidate)) return { ok: false, code: "malformed", detail: "The proposal is not an object." };
  const proposal = candidate;
  if (proposal.schema !== MODULE_CONTRACT_PROPOSAL_SCHEMA) return { ok: false, code: "wrong-version", detail: "The artifact is not a sirkit.module-contract-proposal.v1 artifact." };
  if (Object.keys(proposal).sort().join(",") !== [...PROPOSAL_KEYS].sort().join(",")) return { ok: false, code: "malformed", detail: "The proposal does not carry exactly the sealed key set." };
  if (proposal.toolId !== MODULE_CONTRACT_PROPOSAL_TOOL_ID || proposal.verification !== MODULE_CONTRACT_VERIFICATION) return { ok: false, code: "malformed", detail: "The artifact names another tool, or claims a verification a module contract can never have." };
  const scope = proposal.scope as Record<string, unknown> | null;
  if (!record(scope) || typeof scope.tenantId !== "string" || typeof scope.projectId !== "string" || typeof scope.branchId !== "string" || validateSchematicCanonicalMark(scope.headMark) === null) return { ok: false, code: "malformed", detail: "The scope or its canonical head mark is malformed." };
  if (!isWellFormedAuthorizationBinding(proposal.authorization) || proposal.authorization.tenantId !== scope.tenantId || proposal.authorization.projectId !== scope.projectId || proposal.authorization.branchId !== scope.branchId) return { ok: false, code: "malformed", detail: "The authorization binding is malformed or does not agree with the sealed scope." };
  const set = proposal.contractSet as Record<string, unknown> | null;
  if (!record(set) || set.schema !== MODULE_CONTRACT_SCHEMA || Object.keys(set).sort().join(",") !== [...SET_KEYS].sort().join(",") || !Array.isArray(set.modules) || set.modules.length === 0 || !Array.isArray(set.constraints)) return { ok: false, code: "malformed", detail: "The contract set is not a sirkit.module-contract.v1 set with modules and constraints." };
  const check = proposal.electricalCheck as Record<string, unknown> | null;
  if (!record(check) || check.state !== "not_run" || !record(set.electricalCheck) || set.electricalCheck.state !== "not_run") return { ok: false, code: "malformed", detail: "The artifact claims an electrical check a module contract can never carry." };
  if (typeof proposal.baseSchematicDigest !== "string" || typeof proposal.contractDigest !== "string" || typeof proposal.proposalId !== "string") return { ok: false, code: "malformed", detail: "A sealed digest is missing." };
  if (moduleContractProposalDigest(proposal.baseSchematicDigest, set as unknown as ModuleContractSet) !== proposal.contractDigest) return { ok: false, code: "altered", detail: "The contract digest does not match the sealed contract set." };
  const { proposalId, ...body } = proposal;
  if (`modcon-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5)}` !== proposalId) return { ok: false, code: "altered", detail: "The proposal body does not match its sealed identity." };
  return { ok: true };
}

/** Seal a validated set. Pure; the caller supplied every server-derived fact. */
export function sealModuleContractProposal(input: { set: ModuleContractSet; provider: string; runId: string; context: AgentRunContext; headMark: Tier1ProposalScope["headMark"]; descriptor: Pick<ToolDescriptor, "version">; now: number }): SealedModuleContractProposal {
  const { context } = input;
  const baseSchematicDigest = context.schematicDigest!;
  const contractSet = structuredClone(input.set);
  const body = {
    schema: MODULE_CONTRACT_PROPOSAL_SCHEMA,
    toolId: MODULE_CONTRACT_PROPOSAL_TOOL_ID,
    version: input.descriptor.version,
    scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, headMark: { ...input.headMark } },
    authorization: buildAuthorizationBinding({ principalId: context.actor.actorId, ...(context.actor.membershipRevision ? { membershipRevision: context.actor.membershipRevision } : {}), scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId } }),
    baseSchematicDigest,
    verification: MODULE_CONTRACT_VERIFICATION,
    contractSet,
    electricalCheck: { ...contractSet.electricalCheck },
    reviewTask: {
      path: MODULE_CONTRACT_REVIEW_PATH,
      decides: "the human reads the modules, their owned components, ports, requirements, part-authority gaps and the cross-module constraints, and continues (accepts the note as the plan) or asks for a revision; the existing deterministic checks recheck the composed circuit later",
      neverClaims: "no electrical verification, no simulation, no ERC or DRC, no part authority, no approval and no change to the sheet or a board: this artifact is an engineering note validated for identities, nets, units, evidence shape and stated interfaces only",
    },
    contractDigest: moduleContractProposalDigest(baseSchematicDigest, contractSet),
    actor: { actorId: `agent:${input.provider}`, kind: "ai" as const },
    effectiveActor: { actorId: context.actor.actorId, kind: (context.actor.source === "verified-worker" ? "worker" : "human") as "human" | "worker" },
    provenance: { provider: input.provider, runId: input.runId, note: "AI-proposed module contracts over the pinned schematic, validated for identities, nets, units, evidence shape and interface statements; an engineering note for human review, nothing applied, nothing verified electrically", instruction: sanitizeTraceText(`module contracts: ${contractSet.modules.map((module) => module.id).join(", ")}`, 300) },
    createdAt: input.now,
    expiresAt: input.now + MODULE_CONTRACT_PROPOSAL_TTL_MS,
  };
  return deepFreeze({ ...body, proposalId: `modcon-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5)}` });
}

// ─── Binding resolution ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type ModuleContractBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

/** Allowlist-only: the descriptor is callable here only as the one module-contract proposal over the one validator. */
export function resolveModuleContractBinding(descriptor: ToolDescriptor): ModuleContractBindingResolution {
  if (descriptor.toolId !== MODULE_CONTRACT_PROPOSAL_TOOL_ID) return { state: "not_callable", reason: "Only the module contract proposal is invocable here." };
  if (descriptor.operationClass !== "propose" || descriptor.sideEffects !== "proposal-artifact" || descriptor.approvalTier !== "none") return { state: "not_callable", reason: "The module contract proposal is a sealed proposal artifact (propose class, proposal-artifact side effects, no approval tier of its own)." };
  if (descriptor.binding.status !== "bound-proposal" || descriptor.binding.module !== MODULE_CONTRACT_BINDING.module || descriptor.binding.symbol !== MODULE_CONTRACT_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one module contract validator." };
  return { state: "resolved" };
}

// ─── The service ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ModuleContractProposalServiceOptions {
  /** The gateway's context integrity check (injected so this module never imports the gateway). */
  integrity: (context: AgentRunContext) => readonly string[];
  now?: () => number;
}
export interface ModuleContractProposalInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; provider: string; timeoutMs: number; signal?: AbortSignal }

export class ModuleContractProposalService {
  constructor(private readonly registry: ToolRegistry, private readonly options: ModuleContractProposalServiceOptions) {}

  async invoke(input: ModuleContractProposalInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveModuleContractBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    // The pinned sheet: the run's verified schematic snapshot (digest-pinned by the integrity check) and its canonical head mark.
    if (!context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No verified schematic snapshot is available for this run; the module contract proposal is unavailable."]);
    const headMark = context.schematicHeadMark ? validateSchematicCanonicalMark(context.schematicHeadMark) : null;
    if (!headMark) return refuse("authority_unavailable", ["No canonical schematic head mark is available for this run; the module contract proposal is unavailable until the editor session is ready."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    }
    // The closed argument surface: exactly system, modules, constraints; authority-shaped keys are refused by name.
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    for (const key of Object.keys(input.args)) {
      if ((REQUEST_KEYS as readonly string[]).includes(key)) continue;
      return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim (or a fact this service reads from the run itself) - the module contract proposal accepts only ${REQUEST_KEYS.join(", ")}.` : `Unexpected argument "${key.slice(0, 40)}" - the module contract proposal accepts only ${REQUEST_KEYS.join(", ")}.`]);
    }
    for (const key of REQUEST_KEYS) if (!(key in input.args)) return refuse("invalid_input", [`${key} is required: the contract set names its system, its modules and its cross-module constraints (an empty constraints list is allowed when no net is shared).`]);
    if (input.signal?.aborted) return refuse("cancelled", ["The run was cancelled before the module contracts were validated; nothing was changed."]);
    let validation: ReturnType<typeof validateModuleContractSet>;
    try {
      validation = validateModuleContractSet(input.args, context.schematic);
    } catch (error) {
      return refuse("implementation_failed", [`The module contract validation failed internally: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
    if (!validation.ok) return { kind: "proposal-blocked", ok: false, toolId: input.toolId, version: input.version, blockers: blockersAsData(validation.blockers) };
    const now = this.options.now ? this.options.now() : Date.now();
    return { kind: "module-contract-proposal", ok: true, toolId: input.toolId, version: input.version, proposal: sealModuleContractProposal({ set: validation.set, provider: input.provider, runId: input.runId, context, headMark, descriptor, now }) };
  }
}

/** The validator's blockers as the `proposal-blocked` rows the loop carries to the model and the page (the module named in the detail). */
export function blockersAsData(blockers: readonly ModuleContractBlocker[]): Array<{ code: string; detail: string }> {
  return blockers.map((blocker) => ({ code: blocker.code, detail: sanitizeTraceText(blocker.moduleId ? `[${blocker.moduleId}] ${blocker.detail}` : blocker.detail, 300) }));
}
