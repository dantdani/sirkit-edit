/**
 * B09 — provider-neutral single-agent tool-loop contracts.
 *
 * NOTHING in this module (or anything the loop/registry/gateway exchanges)
 * carries provider SDK types. Provider request/response translation and
 * continuation mechanics live entirely inside a `ProviderAgentAdapter`;
 * its continuation payload is OPAQUE and TRANSIENT — it never enters
 * Sirkit traces, proposals, persisted chat, or user output.
 */

import type { LLMProviderId } from "../llm/types";
import type { DiscoveryContext } from "../engineering/tool-discovery";
import type { PermissionTier } from "../engineering/permission-tiers";
import type { SealedTier1Proposal, Tier1ProposalHeadMark } from "../engineering/schematic-proposals";
import type { SealedReplacementProposal } from "../engineering/replacement-proposals";
import type { SealedPcbEditProposal } from "../pcb/proposal/sealed-pcb-edit-proposal";

/** [B14] the discriminated union of SCHEMATIC sealed proposal artifacts.
 *  Discriminate on `schema`. Deliberately does NOT include the PCB proposal:
 *  the schematic `proposal_ready` event and its consumers stay closed to the
 *  two schematic families — the PCB proposal travels on its own distinct
 *  `pcb_proposal_ready` event and can never be overloaded onto them. */
export type SealedAgentProposal = SealedTier1Proposal | SealedReplacementProposal;

/** [B15.3] the EXACT proposal union — every sealed artifact family an agent
 *  run can produce, schematic and PCB. */
export type AgentProposalArtifact = SealedAgentProposal | SealedPcbEditProposal;
import type { CanonicalProjectState, EngineeringCapability, ProjectRole } from "../engineering/types";
import type { SchematicState } from "@/lib/schematic-types";
import type { SelectionRef } from "../pcb/edit/commands";
import type { AgentNetlistLogical } from "./netlist-validation";
import type { ComponentAuthorityRecord, ComponentCatalogCandidate } from "../engineering/component-authority";
import type { CapturedViewContext, ViewCommandRequest } from "./view-context";
import type { AgentAutonomySetting } from "../engineering/permission-tiers";
import type { LayoutCandidate } from "../pcb/candidates/layout-candidate";
import type { PcbBoard } from "../pcb/types";
import type { EngineeringOperation } from "../engineering/types";
import { EXECUTION_SETTLEMENT_TIMEOUT_MS, type ExecutionDecisionMode, type ExecutionFamily, type ExecutionGrantBase, type ExecutionGrantPreview, type ExecutionGrantSession, type ExecutionGrantTargets, type GrantableCapability, type PublicExecutionGrant, type RetirementReason, type SettlementOutcome } from "../engineering/execution-grant";

// ─── Run identity + context ──────────────────────────────────────────────────

/** Server/application-owned actor — NEVER model- or request-body-supplied. */
export interface AgentActor {
  actorId: string;
  actorRole: ProjectRole;
  grantedCapabilities: readonly EngineeringCapability[];
  /** Where this identity came from.
   *  - `local-only`: the unauthenticated local development build (no
   *    production server identity exists to verify against) — impossible under
   *    `NODE_ENV=production` (see app/lib/auth/mode.ts).
   *  - `verified-session`: [B16.0.1 §D] a Supabase-verified human principal
   *    with an ACTIVE project membership, derived server-side by
   *    `resolveTrustedRequestContext` — never caller-asserted.
   *  - `verified-worker`: [B16.0.1 §D] a constant-time-verified machine
   *    principal (worker secret), never a human. */
  source: "local-only" | "verified-session" | "verified-worker";
  /** [B16.0.1 §D/E] the membership revision the verified role was resolved at.
   *  Bound into proposal/approval identity so a later revocation, downgrade, or
   *  membership change invalidates an already-sealed proposal at apply time.
   *  A deterministic constant for the local-only build and for workers. */
  membershipRevision?: string;
  /** [B16.0.1 §D] the assurance class behind this identity — mirrors the
   *  trusted context's auth method (documents, never widens, authority). */
  authClass?: "supabase_cookie" | "local_dev" | "worker_secret";
}

export interface AgentRunContext {
  tenantId: string;
  projectId: string;
  branchId: string;
  actor: AgentActor;
  /** [B09.2] Verified canonical revision digest — null when no complete,
   *  structurally validated canonical project could be assembled. A digest
   *  is NEVER manufactured over substituted or missing state. */
  canonicalRevisionDigest: string | null;
  /** [B09.2] The assembled canonical project state, or null when its
   *  required constituents (a supplied, structurally VALID board; a valid
   *  schematic when one was supplied) are not all present. */
  canonicalState: CanonicalProjectState | null;
  /** The verified schematic snapshot (present ⇒ structurally valid). */
  schematic: SchematicState | null;
  schematicDigest: string | null;
  /** [B09.1] the client-supplied canonical head mark — a scope LABEL for
   *  proposal sealing only (verification happens at apply against the
   *  CURRENT ready session). null ⇒ the proposal tool is unavailable. */
  schematicHeadMark: Tier1ProposalHeadMark | null;
  /** The fresh discovery context the gateway re-derives per invocation. */
  discovery: DiscoveryContext;
  /** Preset id used to seal DRC/fab preset resources deterministically. */
  presetId: string;
  /** [B10] the VERIFIED live selection captured atomically with the board:
   *  deduplicated and resolved against the exact captured board (dead refs
   *  removed; primary kept only while live). null ⇒ selection-snapshot
   *  resource unavailable (selection.inspect withheld). Only ever claimed
   *  alongside a validated canonical board. */
  selection: { refs: readonly SelectionRef[]; primary: SelectionRef | null } | null;
  /** [B10] integrity pin for `selection` — recomputed and compared inside
   *  verifyAgentContextIntegrity (post-assembly tampering fails closed). */
  selectionDigest: string | null;
  /** [B10/B10.1] the VALIDATED authority-neutral netlist projection
   *  captured atomically with the current schematic (schematic-digest
   *  agreement + per-component schematic membership proven). null ⇒ the
   *  optional netlist resource is withheld (readiness reports schematic
   *  parity as not evaluated — never fabricated, never a stale sync
   *  snapshot). Logical intent ONLY — never catalog/assignment/authority
   *  metadata. */
  netlist: AgentNetlistLogical | null;
  /** [B10] integrity pin for `netlist`. */
  netlistDigest: string | null;
  /** [B13] SERVER-OWNED component-authority records loaded from durable
   *  physical-binding + atomic facts by the /api/chat authority loader —
   *  never from the request body, catalog candidates, or model output.
   *  null ⇒ the component-authority resource is withheld (the durable source
   *  was unavailable, or none was requested), so the inspection tool stays
   *  unexposed. An empty verified set is NEVER fabricated for an unavailable
   *  source. */
  componentAuthority: { records: readonly ComponentAuthorityRecord[]; candidates: readonly ComponentCatalogCandidate[] } | null;
  /** [B13] integrity pin for `componentAuthority`. */
  componentAuthorityDigest: string | null;
  /** [B15.3] the PCB proposal BASIS captured atomically with the board by
   *  the editor-context bridge: the canonical PCB history head, the session
   *  lineage, and the editor's ACTIVE DRC preset. A scope LABEL for sealing
   *  only (verification happens at apply against the live editor) — shape-
   *  validated at assembly, never granted authority. null ⇒ the PCB proposal
   *  tool is unavailable for this run (fail closed; reads unaffected). */
  pcbProposalBasis: PcbProposalBasis | null;
  /** [B17-F] the VALIDATED captured view context — what the user's editors
   *  show (open surfaces, each editor's view session id + revision + a
   *  bounded state summary, the project operation timeline). View state is
   *  never engineering state and never authority: it gates which view /
   *  history tools are advertised and pins the revision a view command
   *  expects. null ⇒ no view tools for this run. */
  view: CapturedViewContext | null;
  /** [B17-F] integrity pin for `view`. */
  viewDigest: string | null;
  /** [B18-A] the project's agent autonomy setting, read SERVER-SIDE by the
   *  route from the durable store (never from the request body or the
   *  model). The default (`proposal_only`, revision 0) when the project never
   *  wrote one or the store is unavailable — unavailability never widens. It
   *  decides, with the operation's permission tier and the actor's role,
   *  whether a Tier 1 operation previews or executes (B18-C). */
  autonomy: AgentAutonomySetting;
  /** [B18-C] whether the composition root bound an execution-grant minter to this run (a human session principal with a
   *  readable autonomy setting). SERVER-derived; with the verified board, the PCB proposal basis and a Tier 1 execute role it
   *  makes granted executions discoverable — the actor still holds only read_project. */
  executionGrantsAvailable: boolean;
  /** [B19-E E6] SERVER fact: the chat route bound an external acquisition port to this run AND a verified canonical state exists.
   *  Present (true) exactly when the discovery context advertises the external-observation authority; absent otherwise. */
  externalAcquisitionAvailable?: boolean;
}

/** [B15.3] see `AgentRunContext.pcbProposalBasis`. */
export interface PcbProposalBasis {
  /** Canonical PCB history head sequence at capture time. */
  historyHeadSequence: number;
  /** The head entry's label, or null for the initial head. */
  historyHeadLabel: string | null;
  /** Canonical lineage identity of the bound PCB editor session. */
  lineageId: string;
  /** The DRC preset the EDITOR is actively validating under — the proposal
   *  seals its validation policy from this (registry-resolved server-side). */
  activeDrcPresetId: string;
}

export interface AgentRunBudget {
  maxModelSteps: number;
  maxToolCalls: number;
  perToolTimeoutMs: number;
  runDeadlineMs: number;
  /** Identical (toolId@version + canonical args digest) call limit. */
  maxIdenticalCalls: number;
  /** [B18-B] how long the run waits for the browser to settle an
   *  execute_explicit grant before answering the model truthfully that the
   *  execution is unsettled (bounded by the remaining run deadline). */
  executionSettlementTimeoutMs: number;
}

export const DEFAULT_AGENT_BUDGET: AgentRunBudget = Object.freeze({
  maxModelSteps: 6,
  maxToolCalls: 10,
  perToolTimeoutMs: 15_000,
  runDeadlineMs: 120_000,
  maxIdenticalCalls: 2,
  executionSettlementTimeoutMs: EXECUTION_SETTLEMENT_TIMEOUT_MS,
});

export interface AgentRunRequest {
  runId: string;
  provider: LLMProviderId;
  /** Prior user/assistant chat turns (plain text only). */
  history: Array<{ role: "user" | "assistant"; text: string }>;
  userMessage: string;
  budget: AgentRunBudget;
  signal?: AbortSignal;
}

// ─── Tool calls / results (neutral) ──────────────────────────────────────────

export interface AgentToolCall {
  /** Provider-issued call id — preserved EXACTLY for the continuation. */
  callId: string;
  /** Provider-facing tool name (pre-resolution). */
  providerName: string;
  /** Raw argument JSON text as the provider produced it. */
  argumentsText: string;
}

export interface AgentToolResult {
  callId: string;
  /** Bounded, redacted JSON text returned to the provider. */
  outputText: string;
  isError: boolean;
}

// ─── Provider adapter boundary ───────────────────────────────────────────────

/** Opaque provider continuation. The `state` payload may contain provider
 *  items (reasoning objects, raw content blocks) — the loop never inspects,
 *  persists, or emits it. */
export interface ProviderContinuation {
  provider: LLMProviderId;
  state: unknown;
}

export interface AgentStep {
  text: string;
  toolCalls: AgentToolCall[];
  stopReason: string | null;
  usage: { inputTokens?: number; outputTokens?: number };
  model: string;
  continuation: ProviderContinuation;
}

/** A provider-facing tool declaration (already strict-validated + named). */
export interface ProviderToolDeclaration {
  providerName: string;
  toolId: string;
  version: string;
  description: string;
  /** Strict-compatible JSON schema (additionalProperties:false everywhere;
   *  optional fields represented strict-compatibly). */
  inputSchema: Record<string, unknown>;
}

export interface ProviderAgentAdapter {
  readonly provider: LLMProviderId;
  /** First model turn of the run. */
  start(input: {
    system: string;
    history: AgentRunRequest["history"];
    userMessage: string;
    tools: readonly ProviderToolDeclaration[];
    signal?: AbortSignal;
  }): Promise<AgentStep>;
  /** Continue after tool results. MUST preserve every provider continuation
   *  item (function calls + reasoning items for OpenAI; assistant tool_use
   *  blocks for Anthropic) and tie each result to its exact call id. */
  continueWith(input: {
    continuation: ProviderContinuation;
    results: readonly AgentToolResult[];
    tools: readonly ProviderToolDeclaration[];
    signal?: AbortSignal;
  }): Promise<AgentStep>;
}

// ─── [B18-B] Execution grants (server-minted; the agent sees a closure) ──────

/** The DATA the pure seal (app/lib/agent/execution-intents.ts) hands the
 *  minter: family, tool identity, the grant's capability, the operations
 *  compiled through the shared builder, their digest, the targets and the
 *  human-readable preview. No decision, no ids, no explicitness — those are
 *  minted only inside the server closure. */
export interface AgentExecutionPlan {
  family: ExecutionFamily;
  toolId: string;
  toolVersion: string;
  capability: GrantableCapability;
  operations: EngineeringOperation[];
  operationsDigest: string;
  operationCount: number;
  targets: ExecutionGrantTargets;
  preview: ExecutionGrantPreview;
  previewDigest: string;
  expectedPcbRevisionAfter: string;
  /** [B18-C I8] a replay plan's direction (the minter resolves the reference from the principal's settled grants). */
  replayDirection?: "undo" | "redo";
}

export interface AgentExecutionGrantRequest {
  plan: AgentExecutionPlan;
  /** The VERIFIED canonical board the plan was built against (the proof re-derives on it). */
  board: PcbBoard;
  base: ExecutionGrantBase;
  session: ExecutionGrantSession;
  origin: { callId: string; registryDigest: string; promptVersion: string };
}

export type AgentExecutionGrantOutcome =
  | { ok: true; grant: PublicExecutionGrant; decision: ExecutionDecisionMode; note: string | null }
  | { ok: false; reason: "execution_not_permitted" | "grant_unavailable" | "nothing_to_replay"; diagnostics: string[] };

export interface AgentExecutionSettlement {
  status: "settled" | "retired" | "in_flight" | "unsettled";
  grant: PublicExecutionGrant | null;
}

/** [B18-C I4] what the DURABLE settlement says about an execution — display data for the page (never a claim of its own). */
export interface AgentExecutionSettledSummary {
  transactionId: string | null;
  revisionBefore: string | null;
  revisionAfter: string | null;
  headSequenceAfter: number | null;
  validations: { drc: { ran: boolean; violations: number } } | null;
  undoEligible: boolean;
}

/** The ONLY authority the agent layer ever holds over execution: a closure
 *  the `/api/chat` composition root builds from the trusted request context
 *  (app/lib/execution-grant/mint.ts). It never receives an instruction, a
 *  nonce or a store; it mints from a sealed plan, reports settlement from the
 *  durable record only, and retires this run's still-issued grants. */
export interface AgentExecutionGrantMinter {
  mint(request: AgentExecutionGrantRequest): Promise<AgentExecutionGrantOutcome>;
  awaitSettlement(grantId: string, options: { timeoutMs: number; signal?: AbortSignal; pollMs?: number }): Promise<AgentExecutionSettlement>;
  retireIssued(reason: Extract<RetirementReason, "run_cancelled" | "run_unsettled">, onlyExplicit: boolean): Promise<string[]>;
}

// ─── Invocation gateway boundary ─────────────────────────────────────────────

export type GatewayInvocationOutcome =
  | { kind: "read"; ok: true; toolId: string; version: string; output: Record<string, unknown>; sourceRevisionDigest: string; verification: string }
  | { kind: "proposal"; ok: true; toolId: string; version: string; proposal: SealedAgentProposal }
  /** [B15.3] the PCB proposal rides a DISTINCT outcome kind so the schematic
   *  proposal path can never receive one by type or by accident. */
  | { kind: "pcb-proposal"; ok: true; toolId: string; version: string; proposal: SealedPcbEditProposal }
  | { kind: "proposal-blocked"; ok: false; toolId: string; version: string; blockers: Array<{ code: string; detail: string }> }
  /** [B17-F] a server-VALIDATED view-session command request the BROWSER
   *  executes on the user's own view bus (stale-revision rule, role gate and
   *  session scoping re-applied there). Never engineering state. */
  | { kind: "view-command"; ok: true; toolId: string; version: string; request: ViewCommandRequest }
  /** [B17-F] the shared revision-bound layout candidate (placement or
   *  routing) — an artifact the human previews and applies in the editor's
   *  own panel; producing it changes nothing. */
  | { kind: "layout-candidate"; ok: true; toolId: string; version: string; candidate: LayoutCandidate }
  /** [B18-B] a SERVER-MINTED one-shot execution grant for a Tier 1 family:
   *  the browser tenders it (one compare-and-set burn) and commits the
   *  operations through its canonical editor session; the loop awaits the
   *  browser-attested settlement for execute_explicit and reports a preview
   *  awaiting confirmation for preview_then_confirm. Producing it changes
   *  nothing. */
  | { kind: "execution-grant"; ok: true; toolId: string; version: string; grant: PublicExecutionGrant; decision: ExecutionDecisionMode; note: string | null }
  | { kind: "refused"; ok: false; toolId: string; version?: string; status: string; diagnostics: string[] };

export interface AgentToolInvocationGateway {
  invoke(input: {
    runId: string;
    /** [B09.1] the ACTUAL selected provider — recorded in proposal
     *  provenance (never the placeholder "agent"). */
    provider: LLMProviderId;
    toolId: string;
    version: string;
    args: Record<string, unknown>;
    context: AgentRunContext;
    timeoutMs: number;
    signal?: AbortSignal;
    /** [B18-C] the provider call id. REQUIRED by the granted-execution dispatch (a grant is minted once per run + call —
     *  the mint idempotency key); every other operation class ignores it. */
    callId?: string;
  }): Promise<GatewayInvocationOutcome>;
}

// ─── Run events (the chat UI protocol source) ────────────────────────────────

export type AgentRunEvent =
  | { type: "run_started"; runId: string; provider: LLMProviderId }
  /** [B18-D I2] `phase`: "interim" — written in a step that also called tools (a side-effecting step's text is emitted only
   *  after its calls resolved); "final" — the closing answer. `tier` on tool events: the tool's permission tier (display only). */
  | { type: "text_delta"; runId: string; text: string; phase: "interim" | "final" }
  | { type: "tool_started"; runId: string; callId: string; toolId: string; title: string; tier: PermissionTier | null }
  /** [B18-E E12] `reason`: on a REFUSAL only, the server's own sentence for it (today: a blocked proposal's first
   *  blocker), shown to the user so learning why never depends on the model relaying it. Display only — untraced, never
   *  authority, and never set on a successful outcome. */
  | { type: "tool_finished"; runId: string; callId: string; toolId: string; title: string; ok: boolean; status: string; tier: PermissionTier | null; reason?: string }
  /** [B18-D I10] a call refused BEFORE it ran (an unknown tool, the budget, invalid arguments, a repeated call, a second
   *  side-effecting artifact) — shown to the user; the model already receives the error result. UNTRACED: the run trace
   *  and the evaluation capsules are unchanged. `toolId`, `title` and `tier` are null for an unknown tool. */
  | { type: "tool_refused"; runId: string; callId: string; toolId: string | null; title: string | null; tier: PermissionTier | null; status: string }
  | { type: "proposal_ready"; runId: string; toolId: string; proposal: SealedAgentProposal }
  /** [B15.3] DISTINCT event for the sealed bounded PCB-edit proposal — never
   *  overloaded onto the schematic `proposal_ready`. Receiving or displaying
   *  it grants nothing and mutates nothing; apply authority stays behind the
   *  human-gated PCB approval boundary. Emitted at most once per run. */
  | { type: "pcb_proposal_ready"; runId: string; toolId: string; proposal: SealedPcbEditProposal }
  /** [B17-F] a validated view-command request for the browser's view bus.
   *  The page dispatches it on the named editor session with the agent
   *  actor; the bus's own stale-revision / role / session rules decide. */
  | { type: "view_command_ready"; runId: string; toolId: string; request: ViewCommandRequest }
  /** [B17-F] a layout candidate for the editor's candidate store — displayed
   *  in the placement / routing panel; apply stays the human's explicit
   *  action through the B17-E apply path. */
  | { type: "layout_candidate_ready"; runId: string; toolId: string; candidate: LayoutCandidate }
  /** [B18-B] a server-minted execution grant for the browser's granted-
   *  execution ritual: preview_then_confirm shows the exact preview and
   *  waits for the human; execute_explicit tenders and commits through the
   *  canonical editor session, then settles back to the server. Receiving
   *  it grants nothing beyond the grant itself (server-bound, one-shot). */
  | { type: "execution_grant_ready"; runId: string; toolId: string; grant: PublicExecutionGrant; decision: ExecutionDecisionMode; note: string | null }
  /** [B18-B] what the run learned about an execute_explicit grant from the
   *  DURABLE record before answering the model (never from the browser
   *  directly): settled with an outcome, retired with a reason, still in
   *  flight (consumed, unsettled) or unsettled (never tendered in time). */
  | { type: "execution_settled"; runId: string; toolId: string; grantId: string; status: AgentExecutionSettlement["status"]; outcome: SettlementOutcome | null; reason: RetirementReason | null; settlement: AgentExecutionSettledSummary | null }
  | { type: "warning"; runId: string; message: string }
  | { type: "run_failed"; runId: string; reason: string; message: string }
  | {
      type: "run_completed";
      runId: string;
      finalText: string;
      steps: number;
      toolCalls: number;
      usage: { inputTokens: number; outputTokens: number };
      model: string;
    };

export interface AgentRunResult {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  finalText: string;
  steps: number;
  toolCalls: number;
  failureReason?: string;
}
