/**
 * [B19-E E6] The agent's two bounded READ-ONLY external acquisition tools, at the agent boundary.
 *
 *   sirkit.parts.external-search  1-5 exact MPNs: which registered source answered, from where (live, a connector's memo or the
 *                                 offer cache), when, until when, and whether the answer's MPN is exactly the one asked.
 *   sirkit.parts.evidence-read    one exact MPN, cache only: the evidence still missing, the conflicting property names, the
 *                                 observations stale after their freshness, and each published revision's catalog status.
 *
 * Nothing here reaches a vendor, a database or the offer cache. The server port (`app/lib/acquisition/agent-read-port.ts`) is
 * INJECTED into the gateway by the chat route through its one approved runtime boundary. This module decides what the port may
 * be asked and what the model may be told:
 *  - per invocation: a fresh discovery check, the role and capability recheck, the server's availability fact and a verified
 *    canonical state;
 *  - exact argument keys, the safe-JSON and schema checks, printable-ASCII exact MPNs (canonicalExactMpn), at most 5;
 *  - a deadline composed with the run's cancellation — the port's own deadline ends earlier, so a late vendor is "pending"
 *    per MPN rather than a timeout of the whole call — and at most 5 live MPNs per run (OD-40), charged to the run BEFORE
 *    the port is asked (a call that times out or fails keeps the charge; an answer settles it to what was sent);
 *  - a CLOSED projection of the port's answer: registry sources and display names, closed statuses and outcomes, ISO times, the
 *    requested MPNs only, property names only. Vendor values appear only under `untrustedVendorText`, bounded, with links and
 *    credential-shaped tokens removed, and only for a source whose registry entry PERMITS agent disclosure (OD-36: "unknown"
 *    everywhere today, so the model sees labels only);
 *  - at most 8,000 characters of output; an error is reported by its class name only.
 * It never publishes, approves, binds, withdraws, refreshes in bulk or buys anything.
 */
import { canonicalExactMpn } from "../atomic/identity";
import { ATOMIC_REVISION_ID_PATTERN } from "../atomic/revision-status";
import { SOURCE_IDS, SOURCE_REGISTRY, type AcquisitionSourceId, type AgentDisclosure } from "../acquisition/source-registry";
import { discoverTools } from "../engineering/tool-discovery";
import { canonicalJson } from "../engineering/stable";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS, validateAgainstSchema } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { boundUntrustedText } from "../untrusted-text";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";

export const EXTERNAL_SEARCH_TOOL_ID = "sirkit.parts.external-search";
export const EVIDENCE_READ_TOOL_ID = "sirkit.parts.evidence-read";
/** OD-40: the agent may send at most this many MPNs to a vendor in one run. */
export const MAX_LIVE_MPNS_PER_RUN = 5;
/** OD-40: one search names 1 to 5 exact MPNs. */
export const MAX_EXTERNAL_SEARCH_MPNS = 5;
export const MAX_EXTERNAL_READ_OUTPUT_CHARS = 8_000;
/**
 * The port's deadline ends this much before the service's own timer (a quarter of a short timeout), so a vendor that is late
 * answers "pending" per MPN — beside the call's cached observations and source statuses, with its live MPNs counted — instead
 * of the whole call timing out.
 */
export const EXTERNAL_READ_DEADLINE_MARGIN_MS = 500;
/** The label every external observation carries (the same sentence as the human search, external-search-contract.ts). */
export const EXTERNAL_READ_AUTHORITY_LABEL = "sourcing observation — not engineering authority";
const NOTE = "Sourcing observations only: untrusted and possibly stale. They never make a part verified, approved, bound or orderable; publication and binding are human steps, and purchasing is not available.";

/** Closed source refusal codes (never an environment variable name). */
export const EXTERNAL_SOURCE_REFUSALS = ["blocked", "disabled", "operator_disabled", "not_configured", "terms_unconfirmed", "paused"] as const;
export type ExternalSourceRefusal = (typeof EXTERNAL_SOURCE_REFUSALS)[number];
export type ExternalSourceStatus = "available" | ExternalSourceRefusal;
/**
 * What happened to one MPN at one source: observed (an answer for exactly this MPN, cached or live); not_cached (no cached
 * answer and no live lookup allowed); no_exact_answer (asked live, no product with exactly this MPN came back, or the lookup
 * failed); pending (asked live, no answer before the deadline); run_live_limit (the run's live MPNs are spent); paused.
 */
export const EXTERNAL_MPN_OUTCOMES = ["observed", "not_cached", "no_exact_answer", "pending", "run_live_limit", "paused"] as const;
export type ExternalMpnOutcome = (typeof EXTERNAL_MPN_OUTCOMES)[number];
export type ExternalServedFrom = "live" | "process-memo" | "offer-cache";
const SERVED_FROM: readonly ExternalServedFrom[] = ["live", "process-memo", "offer-cache"];
const CONFLICT_KINDS = ["identity", "engineering", "lifecycle"] as const;
const REVISION_STATES = ["published", "deprecated", "superseded", "revoked"] as const;
/** The evidence an import review can report missing (quarantine.ts / import-review.ts). */
const MISSING_EVIDENCE = ["manufacturer datasheet or CAD evidence", "symbol", "footprint", "pin-to-pad mapping"] as const;

/** Vendor values, only for a source that permits agent disclosure; every string bounded and made inert. */
export interface ExternalVendorValues {
  manufacturer: string | null;
  description: string | null;
  packaging: string | null;
  lifecycle: string | null;
  stock: number | null;
  minimumOrderQuantity: number | null;
  priceBreaks: Array<{ quantity: number; unitPrice: number; currency: string }>;
}

export interface ExternalReadScope { tenantId: string; projectId: string }

export interface ExternalSearchPortRequest {
  /** Canonical exact MPNs, 1 to 5, de-duplicated. */
  mpns: readonly string[];
  /** How many MPNs this call may still send to a vendor (the run's remainder of MAX_LIVE_MPNS_PER_RUN). */
  liveMpnBudget: number;
  scope: ExternalReadScope;
  deadlineMs: number;
  signal: AbortSignal;
}

export interface ExternalSearchPortAnswer {
  registryVersion: string;
  /** Distinct MPNs this call sent to a vendor; never more than the budget. */
  liveMpnsUsed: number;
  sources: Array<{ sourceId: string; status: ExternalSourceStatus; retryAt: string | null; disclosure: "labels_only" | "values" }>;
  observations: Array<{ mpn: string; sourceId: string; outcome: ExternalMpnOutcome; servedFrom: ExternalServedFrom | null; retrievedAt: string | null; expiresAt: string | null; exactMatch: boolean; untrustedVendorText?: ExternalVendorValues }>;
}

export interface ExternalEvidencePortRequest { mpn: string; scope: ExternalReadScope; deadlineMs: number; signal: AbortSignal }

export interface ExternalEvidencePortAnswer {
  registryVersion: string;
  observations: Array<{ observationId: string; sourceId: string; servedFrom: "offer-cache"; retrievedAt: string; expiresAt: string; stale: boolean; exactMatch: boolean; untrustedVendorText?: ExternalVendorValues }>;
  conflicts: Array<{ property: string; kind: (typeof CONFLICT_KINDS)[number] }>;
  quarantinedDisagreements: string[];
  missing: string[];
  staleObservationIds: string[];
  revisions: Array<{ revisionId: string; state: (typeof REVISION_STATES)[number]; selectable: boolean; pinnable: boolean; successorRevisionId: string | null; selectableSuccessorRevisionId: string | null }>;
}

/** The server port the chat route injects. Implemented by app/lib/acquisition/agent-read-port.ts; faked in tests. */
export interface ExternalAcquisitionReadPort {
  searchExactMpns(request: ExternalSearchPortRequest): Promise<ExternalSearchPortAnswer>;
  readEvidence(request: ExternalEvidencePortRequest): Promise<ExternalEvidencePortAnswer>;
}

// ─── The allowlisted bindings ────────────────────────────────────────────────

type Projected = { ok: true; result: Record<string, unknown>; liveMpnsUsed: number; values: boolean } | { ok: false; reason: string };

interface ProjectionContext {
  requested: readonly string[];
  liveMpnBudget: number;
  usedBeforeThisCall: number;
  disclosureOf: (sourceId: AcquisitionSourceId) => AgentDisclosure;
}

export interface ActivatedExternalReadBinding {
  bindingId: string;
  bindingVersion: string;
  kind: "external-read";
  toolId: string;
  /** Must EXACTLY match the descriptor's binding module and symbol. */
  module: string;
  symbol: string;
  inputKeys: readonly string[];
  /** Whether a call may send MPNs to a vendor: the run's live budget is charged for them before the port is asked. */
  reservesLiveMpns: boolean;
  parse(args: Record<string, unknown>): { ok: true; mpns: string[] } | { ok: false; error: string };
  invoke(port: ExternalAcquisitionReadPort, mpns: readonly string[], request: { liveMpnBudget: number; scope: ExternalReadScope; deadlineMs: number; signal: AbortSignal }): Promise<unknown>;
  project(answer: unknown, context: ProjectionContext): Projected;
}

const MPN_RULE = "an exact MPN is 1 to 64 printable ASCII characters";

function exactMpn(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/^[ \t]+|[ \t]+$/g, "");
  if (trimmed === "" || trimmed.length > 64 || !/^[\x20-\x7e]+$/.test(trimmed)) return null;
  try {
    return canonicalExactMpn(trimmed);
  } catch {
    return null;
  }
}

export const ACTIVATED_EXTERNAL_READ_BINDINGS: readonly ActivatedExternalReadBinding[] = Object.freeze([
  {
    bindingId: "external.exact-mpn-search", bindingVersion: "1.0.0", kind: "external-read",
    toolId: EXTERNAL_SEARCH_TOOL_ID,
    module: "app/lib/acquisition/agent-read-port.ts", symbol: "searchExactMpnsForAgent",
    inputKeys: ["mpns"],
    reservesLiveMpns: true,
    parse: (args) => {
      const raw = args.mpns;
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_EXTERNAL_SEARCH_MPNS) return { ok: false, error: `mpns must list 1 to ${MAX_EXTERNAL_SEARCH_MPNS} exact MPNs.` };
      const mpns: string[] = [];
      for (const item of raw) {
        const mpn = exactMpn(item);
        if (mpn === null) return { ok: false, error: `Every MPN must be exact: ${MPN_RULE}, with no confusable or invisible character.` };
        if (!mpns.includes(mpn)) mpns.push(mpn);
      }
      return { ok: true, mpns };
    },
    invoke: (port, mpns, request) => port.searchExactMpns({ mpns, ...request }),
    project: projectSearch,
  },
  {
    bindingId: "external.evidence-read", bindingVersion: "1.0.0", kind: "external-read",
    toolId: EVIDENCE_READ_TOOL_ID,
    module: "app/lib/acquisition/agent-read-port.ts", symbol: "readEvidenceForAgent",
    inputKeys: ["mpn"],
    reservesLiveMpns: false,
    parse: (args) => {
      const mpn = exactMpn(args.mpn);
      return mpn === null ? { ok: false, error: `mpn must be exact: ${MPN_RULE}, with no confusable or invisible character.` } : { ok: true, mpns: [mpn] };
    },
    invoke: (port, mpns, request) => port.readEvidence({ mpn: mpns[0]!, scope: request.scope, deadlineMs: request.deadlineMs, signal: request.signal }),
    project: projectEvidence,
  },
] satisfies readonly ActivatedExternalReadBinding[]);

export type ExternalReadBindingResolution = { state: "resolved"; binding: ActivatedExternalReadBinding } | { state: "not_callable"; reason: string };

/** Allowlist-only resolution: a descriptor is callable here only when its module and symbol EXACTLY match an entry. */
export function resolveExternalReadBinding(descriptor: ToolDescriptor, bindings: readonly ActivatedExternalReadBinding[] = ACTIVATED_EXTERNAL_READ_BINDINGS): ExternalReadBindingResolution {
  if (descriptor.operationClass !== "read") return { state: "not_callable", reason: `External reads are read class only; ${descriptor.operationClass} is rejected.` };
  if (descriptor.binding.status !== "bound-external-read") return { state: "not_callable", reason: `Binding status ${descriptor.binding.status} is not a bound external read.` };
  if (descriptor.requiredAuthority.length !== 1 || descriptor.requiredAuthority[0] !== "external-observation") return { state: "not_callable", reason: "An external read requires exactly the external-observation authority." };
  if (descriptor.sideEffects !== "none" && descriptor.sideEffects !== "derived-cache") return { state: "not_callable", reason: `Side effects ${descriptor.sideEffects} are not permitted for an external read.` };
  const entry = bindings.find((candidate) => candidate.toolId === descriptor.toolId);
  if (!entry || entry.kind !== "external-read") return { state: "not_callable", reason: "No activated external read binding is registered for this tool." };
  if (entry.module !== descriptor.binding.module || entry.symbol !== descriptor.binding.symbol) {
    return { state: "not_callable", reason: `Descriptor evidence (${descriptor.binding.module ?? "?"}#${descriptor.binding.symbol ?? "?"}) does not match the allowlisted external read binding.` };
  }
  return { state: "resolved", binding: entry };
}

// ─── The closed projection ───────────────────────────────────────────────────

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const OBSERVATION_ID = /^observation_[0-9a-f]{64}$/;
const PROPERTY = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_REVISION_ID = 128;
const MAX_EVIDENCE_OBSERVATIONS = 8;
const MAX_LISTED = 16;
const MAX_REVISIONS = 8;
const MAX_PRICE_BREAKS = 4;

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const isoOrNull = (value: unknown): string | null => (typeof value === "string" && ISO_TIME.test(value) ? value : null);
const sourceIdOf = (value: unknown): AcquisitionSourceId | null => ((SOURCE_IDS as readonly unknown[]).includes(value) ? (value as AcquisitionSourceId) : null);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null => ((allowed as readonly unknown[]).includes(value) ? (value as T) : null);
const revisionIdOrNull = (value: unknown): string | null => (typeof value === "string" && value.length <= MAX_REVISION_ID && ATOMIC_REVISION_ID_PATTERN.test(value) ? value : null);
const countOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

/**
 * Vendor text is data, never a link, a credential or a command. Before the bound, links of any scheme and credential-shaped
 * tokens (a provider key prefix, a bearer token, an assignment or JSON field named like a key, secret, token or password) are
 * replaced by a marker: a part description never legitimately carries them. An instruction it may carry stays text under the
 * untrusted key, which the note tells the model is untrusted.
 */
const VENDOR_TEXT_REMOVALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:javascript|vbscript|data|blob|file|https?|ftps?|wss?|mailto):[^\s"'<>]*/gi, "[link removed]"],
  [/\bsk-[A-Za-z0-9_-]{6,}/g, "[credential removed]"],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[credential removed]"],
  // [B19-E E6 review follow-up] the leading run is bounded, so a long keyword-repeat word cannot make the scan quadratic
  [/\b[A-Za-z_][A-Za-z0-9_]{0,40}(?:key|secret|token|password|passwd|credential)[A-Za-z0-9_]{0,40}["']?\s*[=:]\s*["']?[^\s"',;}]+/gi, "[credential removed]"],
];

/** [B19-E E6 review follow-up] the scrub runs over a bounded prefix only: anything past 4× the visible bound is never shown. */
const SCRUB_PREFIX_FACTOR = 4;

function textOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const prefix = Array.from(value).slice(0, max * SCRUB_PREFIX_FACTOR).join("");
  const scrubbed = VENDOR_TEXT_REMOVALS.reduce((text, [pattern, marker]) => text.replace(pattern, marker), prefix);
  const bounded = boundUntrustedText(scrubbed, max);
  return bounded === "" ? null : bounded;
}

function vendorValues(raw: unknown): ExternalVendorValues | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const values = raw as Record<string, unknown>;
  return {
    manufacturer: textOrNull(values.manufacturer, 60),
    description: textOrNull(values.description, 120),
    packaging: textOrNull(values.packaging, 40),
    lifecycle: textOrNull(values.lifecycle, 24),
    stock: countOrNull(values.stock),
    minimumOrderQuantity: countOrNull(values.minimumOrderQuantity),
    priceBreaks: asArray(values.priceBreaks).slice(0, MAX_PRICE_BREAKS).flatMap((item) => {
      const entry = asRecord(item);
      const quantity = countOrNull(entry.quantity);
      const unitPrice = countOrNull(entry.unitPrice);
      return quantity === null || unitPrice === null ? [] : [{ quantity, unitPrice, currency: textOrNull(entry.currency, 8) ?? "USD" }];
    }),
  };
}

function projectSearch(raw: unknown, context: ProjectionContext): Projected {
  const answer = asRecord(raw);
  const used = answer.liveMpnsUsed;
  const liveCap = Math.min(context.liveMpnBudget, context.requested.length);
  if (typeof used !== "number" || !Number.isInteger(used) || used < 0 || used > liveCap) return { ok: false, reason: "the port reported live MPNs outside the run's budget" };
  const seenSources = new Set<AcquisitionSourceId>();
  const sources = asArray(answer.sources).flatMap((item) => {
    const entry = asRecord(item);
    const sourceId = sourceIdOf(entry.sourceId);
    const status = oneOf(entry.status, ["available", ...EXTERNAL_SOURCE_REFUSALS] as const);
    if (sourceId === null || status === null || seenSources.has(sourceId)) return [];
    seenSources.add(sourceId);
    const registry = SOURCE_REGISTRY[sourceId];
    const values = entry.disclosure === "values" && context.disclosureOf(sourceId) === "permitted";
    return [{ sourceId, displayName: registry.displayName, status, retryAt: isoOrNull(entry.retryAt), disclosure: values ? "values" : "labels_only", attribution: registry.license.attribution, attributionLink: registry.license.attributionLink }];
  }).sort((a, b) => SOURCE_IDS.indexOf(a.sourceId) - SOURCE_IDS.indexOf(b.sourceId));
  const valuesFrom = new Set(sources.filter((source) => source.disclosure === "values").map((source) => source.sourceId));
  const seenObservations = new Set<string>();
  const observations = asArray(answer.observations).flatMap((item) => {
    const entry = asRecord(item);
    const sourceId = sourceIdOf(entry.sourceId);
    const outcome = oneOf(entry.outcome, EXTERNAL_MPN_OUTCOMES);
    const mpn = typeof entry.mpn === "string" && context.requested.includes(entry.mpn) ? entry.mpn : null;
    if (sourceId === null || outcome === null || mpn === null || seenObservations.has(`${mpn}|${sourceId}`)) return [];
    seenObservations.add(`${mpn}|${sourceId}`);
    const observed = outcome === "observed";
    const values = observed && valuesFrom.has(sourceId) ? vendorValues(entry.untrustedVendorText) : null;
    return [{
      mpn, sourceId, outcome,
      servedFrom: observed ? oneOf(entry.servedFrom, SERVED_FROM) : null,
      retrievedAt: observed ? isoOrNull(entry.retrievedAt) : null,
      expiresAt: observed ? isoOrNull(entry.expiresAt) : null,
      exactMatch: observed && entry.exactMatch === true,
      ...(values ? { untrustedVendorText: values } : {}),
    }];
  }).sort((a, b) => context.requested.indexOf(a.mpn) - context.requested.indexOf(b.mpn) || SOURCE_IDS.indexOf(a.sourceId) - SOURCE_IDS.indexOf(b.sourceId));
  return {
    ok: true,
    liveMpnsUsed: used,
    values: observations.some((observation) => "untrustedVendorText" in observation),
    result: {
      schema: "sirkit.external-observation-search.v1",
      authority: EXTERNAL_READ_AUTHORITY_LABEL,
      registryVersion: typeof answer.registryVersion === "string" && VERSION.test(answer.registryVersion) ? answer.registryVersion : null,
      requestedMpns: [...context.requested],
      liveLookups: { thisCall: used, thisRun: context.usedBeforeThisCall + used, runLimit: MAX_LIVE_MPNS_PER_RUN },
      sources,
      observations,
      note: NOTE,
    },
  };
}

function projectEvidence(raw: unknown, context: ProjectionContext): Projected {
  const answer = asRecord(raw);
  const observations = asArray(answer.observations).flatMap((item) => {
    const entry = asRecord(item);
    const sourceId = sourceIdOf(entry.sourceId);
    const observationId = typeof entry.observationId === "string" && OBSERVATION_ID.test(entry.observationId) ? entry.observationId : null;
    const retrievedAt = isoOrNull(entry.retrievedAt);
    const expiresAt = isoOrNull(entry.expiresAt);
    // cache only: an observation claiming any other origin is not this tool's answer
    if (sourceId === null || observationId === null || entry.servedFrom !== "offer-cache" || retrievedAt === null || expiresAt === null) return [];
    const values = context.disclosureOf(sourceId) === "permitted" ? vendorValues(entry.untrustedVendorText) : null;
    return [{ observationId, sourceId, displayName: SOURCE_REGISTRY[sourceId].displayName, servedFrom: "offer-cache" as const, retrievedAt, expiresAt, stale: entry.stale === true, exactMatch: entry.exactMatch === true, ...(values ? { untrustedVendorText: values } : {}) }];
  }).slice(0, MAX_EVIDENCE_OBSERVATIONS);
  const names = (value: unknown): string[] => [...new Set(asArray(value).filter((item): item is string => typeof item === "string" && PROPERTY.test(item)))].slice(0, MAX_LISTED);
  const conflicts = asArray(answer.conflicts).flatMap((item) => {
    const entry = asRecord(item);
    const kind = oneOf(entry.kind, CONFLICT_KINDS);
    return typeof entry.property === "string" && PROPERTY.test(entry.property) && kind !== null ? [{ property: entry.property, kind }] : [];
  }).slice(0, MAX_LISTED);
  const revisions = asArray(answer.revisions).flatMap((item) => {
    const entry = asRecord(item);
    const revisionId = revisionIdOrNull(entry.revisionId);
    const state = oneOf(entry.state, REVISION_STATES);
    if (revisionId === null || state === null) return [];
    return [{ revisionId, state, selectable: entry.selectable === true, pinnable: entry.pinnable === true, successorRevisionId: revisionIdOrNull(entry.successorRevisionId), selectableSuccessorRevisionId: revisionIdOrNull(entry.selectableSuccessorRevisionId) }];
  }).slice(0, MAX_REVISIONS);
  return {
    ok: true,
    liveMpnsUsed: 0,
    values: observations.some((observation) => "untrustedVendorText" in observation),
    result: {
      schema: "sirkit.external-evidence-read.v1",
      authority: EXTERNAL_READ_AUTHORITY_LABEL,
      mpn: context.requested[0]!,
      proven: false,
      cacheOnly: true,
      registryVersion: typeof answer.registryVersion === "string" && VERSION.test(answer.registryVersion) ? answer.registryVersion : null,
      observations,
      conflicts,
      quarantinedDisagreements: names(answer.quarantinedDisagreements),
      missing: [...new Set(asArray(answer.missing).filter((item): item is string => (MISSING_EVIDENCE as readonly unknown[]).includes(item)))],
      staleObservationIds: [...new Set(asArray(answer.staleObservationIds).filter((item): item is string => typeof item === "string" && OBSERVATION_ID.test(item)))].slice(0, MAX_LISTED),
      revisions,
      note: NOTE,
    },
  };
}

/** Within the output budget: the vendor values go first, and past that the answer is refused rather than cut. */
function bounded(result: Record<string, unknown>): Record<string, unknown> | null {
  if (canonicalJson(result).length <= MAX_EXTERNAL_READ_OUTPUT_CHARS) return result;
  const withoutValues = {
    ...result,
    ...(Array.isArray(result.observations) ? { observations: (result.observations as Array<Record<string, unknown>>).map((observation) => Object.fromEntries(Object.entries(observation).filter(([key]) => key !== "untrustedVendorText"))) } : {}),
    untrustedVendorTextOmitted: `the answer exceeded the ${MAX_EXTERNAL_READ_OUTPUT_CHARS}-character tool budget`,
  };
  return canonicalJson(withoutValues).length <= MAX_EXTERNAL_READ_OUTPUT_CHARS ? withoutValues : null;
}

// ─── The invocation service ──────────────────────────────────────────────────

export interface ExternalReadServiceOptions {
  /** The server port, injected by the composition root; absent: every external read refuses authority_unavailable. */
  port?: ExternalAcquisitionReadPort;
  /** The gateway's context integrity check (injected so this module never imports the gateway). */
  integrity: (context: AgentRunContext) => readonly string[];
  /** Test seam: the disclosure decision per source; production reads the committed registry. */
  disclosureOf?: (sourceId: AcquisitionSourceId) => AgentDisclosure;
  bindings?: readonly ActivatedExternalReadBinding[];
}

export interface ExternalReadInvocationInput {
  toolId: string;
  version: string;
  args: Record<string, unknown>;
  context: AgentRunContext;
  runId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

class ExternalReadTimeoutError extends Error { constructor() { super("EXTERNAL_READ_TIMEOUT"); this.name = "ExternalReadTimeoutError"; } }
class ExternalReadCancelledError extends Error { constructor() { super("EXTERNAL_READ_CANCELLED"); this.name = "ExternalReadCancelledError"; } }
const MAX_TRACKED_RUNS = 256;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export class ExternalReadInvocationService {
  private readonly liveByRun = new Map<string, number>();
  private readonly disclosureOf: (sourceId: AcquisitionSourceId) => AgentDisclosure;

  constructor(private readonly registry: ToolRegistry, private readonly options: ExternalReadServiceOptions) {
    this.disclosureOf = options.disclosureOf ?? ((sourceId) => SOURCE_REGISTRY[sourceId].license.agentDisclosure);
  }

  /** Live MPNs this run has already sent to a vendor (a call in flight counts what it may send). */
  liveMpnsUsed(runId: string): number {
    return this.liveByRun.get(runId) ?? 0;
  }

  private charge(runId: string, used: number): void {
    this.liveByRun.delete(runId);
    if (used > 0) this.liveByRun.set(runId, used);
    while (this.liveByRun.size > MAX_TRACKED_RUNS) {
      const oldest = this.liveByRun.keys().next().value;
      if (oldest === undefined) break;
      this.liveByRun.delete(oldest);
    }
  }

  async invoke(input: ExternalReadInvocationInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveExternalReadBinding(descriptor, this.options.bindings);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const binding = resolution.binding;
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    const port = this.options.port;
    if (!port || context.externalAcquisitionAvailable !== true) return refuse("authority_unavailable", ["No external acquisition source is bound to this run; the tool is unavailable."]);
    if (!context.canonicalState || !context.canonicalRevisionDigest) return refuse("authority_unavailable", ["No complete validated canonical project state exists for this run; the tool is unavailable."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    }

    // exact keys first, so a transport- or credential-shaped key is refused by name before anything else reads it
    const unexpected = Object.keys(input.args).find((key) => !binding.inputKeys.includes(key));
    if (unexpected !== undefined) return refuse("invalid_input", [`Unexpected argument "${unexpected.replace(/[^A-Za-z0-9_-]/g, "?").slice(0, 40)}": this tool accepts only ${binding.inputKeys.join(", ")}.`]);
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    const schemaErrors = validateAgainstSchema(input.args, descriptor.inputSchema, "args");
    if (schemaErrors.length > 0) return refuse("invalid_input", schemaErrors.slice(0, 5));
    const parsed = binding.parse(input.args);
    if (!parsed.ok) return refuse("invalid_input", [parsed.error]);

    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);
    const timeoutMs = Math.max(1, Math.min(input.timeoutMs, descriptor.timeoutMs));
    // the port's deadline ends before this service's timer, so a late vendor is "pending" per MPN, never a timeout of the call
    const portDeadlineMs = Math.max(1, timeoutMs - Math.min(EXTERNAL_READ_DEADLINE_MARGIN_MS, Math.floor(timeoutMs / 4)));
    const usedBefore = this.liveMpnsUsed(input.runId);
    const liveMpnBudget = Math.max(0, MAX_LIVE_MPNS_PER_RUN - usedBefore);
    // OD-40: the run is charged BEFORE the port is asked, for every MPN this call may send. A call that times out, is cancelled
    // or fails keeps the charge (the vendor may already have been asked); a projected answer settles it to what was sent.
    const reserved = binding.reservesLiveMpns ? Math.min(liveMpnBudget, parsed.mpns.length) : 0;
    if (reserved > 0) this.charge(input.runId, usedBefore + reserved);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let answer: unknown;
    try {
      const work = Promise.resolve().then(() => binding.invoke(port, parsed.mpns, { liveMpnBudget, scope: { tenantId: context.tenantId, projectId: context.projectId }, deadlineMs: portDeadlineMs, signal: controller.signal }));
      work.catch(() => undefined); // a late rejection after the deadline is never unhandled
      answer = await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new ExternalReadTimeoutError()); }, timeoutMs);
          if (input.signal) {
            onAbort = () => { controller.abort(); reject(new ExternalReadCancelledError()); };
            input.signal.addEventListener("abort", onAbort, { once: true });
          }
        }),
      ]);
    } catch (error) {
      if (error instanceof ExternalReadTimeoutError) return refuse("timeout", [`The external read exceeded ${timeoutMs} ms.`]);
      if (error instanceof ExternalReadCancelledError) return refuse("cancelled", ["The external read was cancelled."]);
      const name = error instanceof Error && SAFE_ERROR_NAME.test(error.name) ? error.name : "UnknownError";
      return refuse("implementation_failed", [`IMPLEMENTATION_ERROR:${name} (details redacted).`]);
    } finally {
      if (timer) clearTimeout(timer);
      if (input.signal && onAbort) input.signal.removeEventListener("abort", onAbort);
    }

    const projected = binding.project(answer, { requested: parsed.mpns, liveMpnBudget, usedBeforeThisCall: usedBefore, disclosureOf: this.disclosureOf });
    if (!projected.ok) return refuse("implementation_failed", [`IMPLEMENTATION_ERROR:ExternalReadAnswerRejected (${projected.reason}).`]);
    // the reservation is settled to what the port actually sent (never below what other calls of the run have charged)
    if (reserved > 0 || projected.liveMpnsUsed > 0) this.charge(input.runId, Math.max(0, this.liveMpnsUsed(input.runId) - reserved + projected.liveMpnsUsed));
    const result = bounded(projected.result);
    if (result === null) return refuse("invalid_output", [`The external read answer exceeds the ${MAX_EXTERNAL_READ_OUTPUT_CHARS}-character tool budget; ask about fewer MPNs.`]);
    const output = { result };
    const outputErrors = [...assertSafeJsonValue(output, DEFAULT_INPUT_LIMITS, "output"), ...validateAgainstSchema(output, descriptor.outputSchema, "output")];
    if (outputErrors.length > 0) return refuse("invalid_output", outputErrors.slice(0, 5));
    return {
      kind: "read",
      ok: true,
      toolId: descriptor.toolId,
      version: descriptor.version,
      output,
      sourceRevisionDigest: context.canonicalRevisionDigest,
      verification: projected.values && "observations" in result && !("untrustedVendorTextOmitted" in result) ? "external-observation-untrusted-values" : "external-observation-labels",
    };
  }
}
