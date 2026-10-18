/**
 * [PR-M, 2026-10-17] The agent's CANDIDATE SEARCH BY REQUIREMENTS, `sirkit.parts.candidate-search` (section M.2.2): a Tier 0 read
 * that searches Sirkit's local catalog for exact published revisions that can resolve one schematic instance - by functional role,
 * specifications and package / mounting text, never only by ids the model already knows - and separates the results into
 * eligible / draft / missing-asset / withdrawn / incompatible / unresolved with their reasons (the one composition,
 * app/lib/component-resolution/candidate-search.ts `searchResolutionCandidates`).
 *
 * Its recall is the Build loop's own hybrid catalog search (app/lib/parts-search.ts) behind the chat route's injected search port
 * (app/api/chat/component-resolution-runtime.ts): an embedding-backed recall plus the catalog's lexical and authority channels,
 * over the catalog's real category vocabulary. Every hit is re-read through the catalog port and the published revision evidence
 * port before it can be eligible; a hit is a candidate, never authority. At most MAX_CANDIDATE_SEARCHES_PER_RUN searches per run
 * (each may spend one embedding and one rerank call on the server's provider accounts). No distributor is called; nothing is
 * placed, bound, published or bought. Advertised only with the server's catalog, search and evidence facts.
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS, DEFAULT_OUTPUT_LIMITS, validateAgainstSchema } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { searchResolutionCandidates, MAX_CANDIDATE_SEARCH_HITS } from "../component-resolution/candidate-search";
import type { ResolutionRequirement, RatingRequirement } from "../component-resolution/compatibility";
import type { CatalogSearchPort, RevisionEvidencePort } from "../component-resolution/evidence";
import { inspectSchematicInstances } from "../component-resolution/instance-facts";
import { loadCatalogParts } from "../component-resolution/facts-loader";
import { FUNCTIONAL_CLASSES, type FunctionalClass } from "../component-resolution/pin-functions";
import type { QuantityDimension } from "../atomic/types";
import type { CatalogPartInspectionPort } from "./catalog-inspection-reads";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export const CANDIDATE_SEARCH_TOOL_ID = "sirkit.parts.candidate-search" as const;
export const CANDIDATE_SEARCH_BINDING = Object.freeze({ module: "app/lib/component-resolution/candidate-search.ts", symbol: "searchResolutionCandidates" });
export const CANDIDATE_SEARCH_VERIFICATION = "catalog-search+published-evidence" as const;
export const MAX_CANDIDATE_SEARCHES_PER_RUN = 3;
export const MAX_CANDIDATE_QUERY_CHARS = 300;
/** [PR-M, 2026-10-18] What the output says when the recall came from the fixture runtime's seam (app/api/chat/component-resolution-runtime.ts). */
export const FIXTURE_RECALL_NOTE = Object.freeze({ source: "fixture-catalog", note: "FIXTURE RUNTIME: the recall is a word-overlap match over the committed fixture catalog (no embedding, no reranker, no provider); every hit was still re-read through the catalog and the published revision evidence. This is not the production catalog search." });
export const CANDIDATE_SEARCH_INPUT_EXAMPLE = Object.freeze({ componentId: "D1", query: "small-signal fast switching diode 100 V 150 mA", functionalClass: "diode", limit: 8 });

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "bind", "publish", "place", "scope", "headMark", "revision", "expectedRevision", "revisionId", "atomicPartRevisionId", "lineageId", "schematic", "board", "pins", "nets", "mapping", "eligible", "verified", "live", "distributor", "source", "price", "stock"]);
const ALLOWED_KEYS = new Set(["componentId", "query", "category", "functionalClass", "mounting", "packageCode", "ratings", "limit"]);
const TEXT_PATTERN = /^[\x20-\x7E]{1,300}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,199}$/;
const DIMENSIONS: readonly QuantityDimension[] = ["dimensionless", "voltage", "current", "resistance", "capacitance", "inductance", "power", "frequency", "time", "temperature", "length", "mass"];
const MAX_TRACKED_RUNS = 256;

export type CandidateSearchBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

export function resolveCandidateSearchBinding(descriptor: ToolDescriptor): CandidateSearchBindingResolution {
  if (descriptor.toolId !== CANDIDATE_SEARCH_TOOL_ID) return { state: "not_callable", reason: "Only the resolution candidate search is invocable here." };
  if (descriptor.operationClass !== "read" || descriptor.approvalTier !== "none" || (descriptor.sideEffects !== "none" && descriptor.sideEffects !== "derived-cache")) return { state: "not_callable", reason: "The candidate search is a Tier 0 read with no side effects beyond a derived cache." };
  if (descriptor.binding.status !== "bound-read" || descriptor.binding.module !== CANDIDATE_SEARCH_BINDING.module || descriptor.binding.symbol !== CANDIDATE_SEARCH_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one shared candidate search composition." };
  if (descriptor.requiredAuthority.length !== 1 || descriptor.requiredAuthority[0] !== "catalog") return { state: "not_callable", reason: "The candidate search requires exactly the catalog authority." };
  return { state: "resolved" };
}

/** The loop's per-run rule: the binding resolves and the server bound the catalog, the search and the revision evidence ports. */
export function candidateSearchReadAvailable(descriptor: ToolDescriptor, context: AgentRunContext, warn: (message: string) => void): boolean {
  if (resolveCandidateSearchBinding(descriptor).state !== "resolved") { warn(`Tool ${descriptor.toolId} unavailable: no resolved candidate search binding.`); return false; }
  if (context.catalogInspectionAvailable !== true || context.catalogSearchAvailable !== true || context.componentResolutionAvailable !== true) { warn(`Tool ${descriptor.toolId} unavailable: no catalog search and published revision evidence are bound to this run.`); return false; }
  return true;
}

export interface CandidateSearchReadServiceOptions {
  catalog?: CatalogPartInspectionPort;
  search?: CatalogSearchPort;
  evidence?: RevisionEvidencePort;
  integrity: (context: AgentRunContext) => readonly string[];
  now?: () => number;
}
export interface CandidateSearchReadInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; timeoutMs: number; signal?: AbortSignal }

/** Parse the closed requirement surface (shared with the resolution proposal). Returns a refusal sentence or the requirement. */
export function parseResolutionRequirement(args: Record<string, unknown>): { ok: true; requirement: ResolutionRequirement } | { ok: false; detail: string } {
  const requirement: ResolutionRequirement = {};
  if (args.functionalClass !== undefined) {
    if (typeof args.functionalClass !== "string" || !(FUNCTIONAL_CLASSES as readonly string[]).includes(args.functionalClass) || args.functionalClass === "unknown") return { ok: false, detail: `functionalClass is one of ${FUNCTIONAL_CLASSES.filter((entry) => entry !== "unknown").join(", ")}.` };
    requirement.functionalClass = args.functionalClass as FunctionalClass;
  }
  if (args.mounting !== undefined) {
    if (args.mounting !== "smd" && args.mounting !== "through_hole") return { ok: false, detail: "mounting is smd or through_hole." };
    requirement.mounting = args.mounting;
  }
  if (args.packageCode !== undefined) {
    if (typeof args.packageCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._\-]{0,47}$/.test(args.packageCode)) return { ok: false, detail: "packageCode is a package code of 1-48 letters, digits, spaces, dots, underscores or hyphens (e.g. SOD-123)." };
    requirement.packageCode = args.packageCode;
  }
  if (args.ratings !== undefined) {
    if (!Array.isArray(args.ratings) || args.ratings.length > 8) return { ok: false, detail: "ratings is a list of at most 8 stated rating requirements." };
    const ratings: RatingRequirement[] = [];
    for (const entry of args.ratings as unknown[]) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { ok: false, detail: "each rating is an object {property, dimension, min?, max?}." };
      const record = entry as Record<string, unknown>;
      for (const key of Object.keys(record)) if (!["property", "dimension", "min", "max"].includes(key)) return { ok: false, detail: `a rating carries only property, dimension, min and max (not "${key.slice(0, 40)}").` };
      if (typeof record.property !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(record.property)) return { ok: false, detail: "a rating property is a lower-case claim property name (e.g. reverse_voltage)." };
      if (typeof record.dimension !== "string" || !(DIMENSIONS as readonly string[]).includes(record.dimension)) return { ok: false, detail: `a rating dimension is one of ${DIMENSIONS.join(", ")}.` };
      const min = record.min, max = record.max;
      if ((min !== undefined && (typeof min !== "number" || !Number.isFinite(min))) || (max !== undefined && (typeof max !== "number" || !Number.isFinite(max))) || (min === undefined && max === undefined)) return { ok: false, detail: "a rating states a finite min, max or both, in SI base units." };
      ratings.push({ property: record.property, dimension: record.dimension as QuantityDimension, ...(min !== undefined ? { min: min as number } : {}), ...(max !== undefined ? { max: max as number } : {}) });
    }
    requirement.ratings = ratings;
  }
  return { ok: true, requirement };
}

export class CandidateSearchReadService {
  private readonly searchesByRun = new Map<string, number>();
  constructor(private readonly registry: ToolRegistry, private readonly options: CandidateSearchReadServiceOptions) {}

  searchesUsed(runId: string): number {
    return this.searchesByRun.get(runId) ?? 0;
  }

  private charge(runId: string): void {
    const used = this.searchesUsed(runId) + 1;
    this.searchesByRun.delete(runId);
    this.searchesByRun.set(runId, used);
    while (this.searchesByRun.size > MAX_TRACKED_RUNS) {
      const oldest = this.searchesByRun.keys().next().value;
      if (oldest === undefined) break;
      this.searchesByRun.delete(oldest);
    }
  }

  async invoke(input: CandidateSearchReadInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveCandidateSearchBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    const { catalog, search, evidence } = this.options;
    if (!catalog || !search || !evidence || context.catalogInspectionAvailable !== true || context.catalogSearchAvailable !== true || context.componentResolutionAvailable !== true) return refuse("authority_unavailable", ["No catalog search and published revision evidence are bound to this run; the candidate search is unavailable."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    }
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    for (const key of Object.keys(input.args)) {
      if (ALLOWED_KEYS.has(key)) continue;
      return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - the candidate search derives every revision, pin and mapping on the server.` : `Unexpected argument "${key.slice(0, 40)}" - the candidate search accepts ${[...ALLOWED_KEYS].join(", ")}.`]);
    }
    const query = typeof input.args.query === "string" ? input.args.query.trim() : "";
    if (!TEXT_PATTERN.test(query) || query.length > MAX_CANDIDATE_QUERY_CHARS) return refuse("invalid_input", [`query is the functional role and specifications to search for: 1-${MAX_CANDIDATE_QUERY_CHARS} printable characters.`]);
    const category = input.args.category === undefined ? null : typeof input.args.category === "string" && TEXT_PATTERN.test(input.args.category.trim()) && input.args.category.trim().length <= 64 ? input.args.category.trim() : undefined;
    if (category === undefined) return refuse("invalid_input", ["category, when given, is a catalog category name or request of at most 64 printable characters."]);
    const limit = input.args.limit === undefined ? MAX_CANDIDATE_SEARCH_HITS : typeof input.args.limit === "number" && Number.isInteger(input.args.limit) && input.args.limit >= 1 && input.args.limit <= MAX_CANDIDATE_SEARCH_HITS ? input.args.limit : undefined;
    if (limit === undefined) return refuse("invalid_input", [`limit, when given, is an integer from 1 to ${MAX_CANDIDATE_SEARCH_HITS}.`]);
    const componentId = input.args.componentId;
    if (componentId !== undefined && (typeof componentId !== "string" || !ID_PATTERN.test(componentId.trim()))) return refuse("invalid_input", ["componentId, when given, is the stable instance id (or reference designator) of the instance to resolve."]);
    const parsed = parseResolutionRequirement(input.args);
    if (!parsed.ok) return refuse("invalid_input", [parsed.detail]);
    if (this.searchesUsed(input.runId) >= MAX_CANDIDATE_SEARCHES_PER_RUN) return refuse("budget_exhausted", [`At most ${MAX_CANDIDATE_SEARCHES_PER_RUN} candidate searches run per conversation turn; answer from the results you already have.`]);
    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);
    const timeoutMs = Math.max(1, Math.min(Math.floor(input.timeoutMs), descriptor.timeoutMs));
    const now = this.options.now ?? (() => Date.now());
    const started = now();
    const scope = { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId };
    let instance = null;
    if (typeof componentId === "string") {
      if (!context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No verified schematic snapshot is available for this run; an instance cannot be named."]);
      const partIds = [...new Set((context.schematic.kicadComponents ?? []).map((entry) => entry.partId))];
      const loaded = await loadCatalogParts(catalog, partIds, { scope, runId: input.runId, budgetMs: Math.floor(timeoutMs * 0.3), ...(input.signal ? { signal: input.signal } : {}), now });
      const inspection = inspectSchematicInstances({ state: context.schematic, targets: [componentId.trim()], parts: loaded.parts });
      instance = inspection.instances[0] ?? null;
      if (!instance) return refuse("invalid_input", [`No instance with the stable id or reference "${componentId.trim().slice(0, 64)}" exists in the current schematic.`]);
      if (instance.family !== "kicad") return refuse("invalid_input", [`${instance.refDes} is a Theory symbol; it is resolved by placing a catalog part with a published revision, not by a candidate for the same instance.`]);
    }
    this.charge(input.runId); // charged BEFORE the search port is asked (the server's provider may be spent even when the call later fails)
    let output: Record<string, unknown>;
    try {
      const outcome = await searchResolutionCandidates({ query, category, limit, instance, requirement: parsed.requirement, ports: { search, catalog, evidence }, scope, runId: input.runId, budgetMs: timeoutMs - (now() - started) - 250, ...(input.signal ? { signal: input.signal } : {}), now });
      if (!outcome.ok) return refuse(outcome.code === "search_timeout" ? "timeout" : "implementation_failed", [outcome.detail]);
      output = { result: { ...outcome.report, searchesThisRun: { used: this.searchesUsed(input.runId), limit: MAX_CANDIDATE_SEARCHES_PER_RUN }, ...(search.recall === "fixture-catalog" ? { recall: FIXTURE_RECALL_NOTE } : {}) } as unknown as Record<string, unknown> }; // [PR-M, 2026-10-18] the fixture runtime's seam is named in the output, never passed off as the production search
    } catch (error) {
      return refuse("implementation_failed", [`The candidate search failed internally: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
    const outputErrors = [...assertSafeJsonValue(output, DEFAULT_OUTPUT_LIMITS, "output"), ...validateAgainstSchema(output, descriptor.outputSchema, "output")];
    if (outputErrors.length > 0) return refuse("invalid_output", outputErrors.slice(0, 5));
    return { kind: "read", ok: true, toolId: descriptor.toolId, version: descriptor.version, output, sourceRevisionDigest: context.schematicDigest ?? context.canonicalRevisionDigest ?? context.discovery.currentRevisionDigest, verification: CANDIDATE_SEARCH_VERIFICATION };
  }
}
