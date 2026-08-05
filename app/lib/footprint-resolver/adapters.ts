import { performance } from "node:perf_hooks";
import { getDurableWorkflowRepository } from "../durable-workflow/runtime";
import { DurablePassivePolicyContextStore } from "../passive-policy/durable";
import { PassivePolicyCandidateSource } from "../passive-policy/stage2-adapter";
import type { PassivePolicyContextProvider } from "../passive-policy/types";
import { resolverId } from "./stable";
import type {
  CandidateCollectionContext,
  CandidateSourceKind,
  CandidateSourceResult,
  FootprintCandidateSource,
  RawFootprintCandidate,
} from "./types";

function sourceKindForOrigin(origin: CandidateCollectionContext["bindings"][number]["origin"]["kind"]): CandidateSourceKind {
  if (origin === "exact_catalog_binding") return "approved_exact_part_binding";
  if (origin === "human_selection") return "explicit_component_assignment";
  if (origin === "symbol_property_import" || origin === "upstream_library_import") return "symbol_attached_fact";
  if (origin === "package_derived") return "normalized_package_mapping";
  if (origin === "legacy_migration") return "legacy_assignment";
  if (origin === "project_passive_policy") return "passive_policy";
  if (origin === "generated_overlay") return "generated_overlay";
  return "ai_catalog_suggestion";
}

export class Stage1BindingCandidateSource implements FootprintCandidateSource {
  readonly sourceVersion = "sirkit.stage1-binding-source/1";
  constructor(readonly sourceKind: CandidateSourceKind) {}
  async collect(context: CandidateCollectionContext, signal: AbortSignal): Promise<CandidateSourceResult> {
    const started = performance.now();
    if (signal.aborted) return { sourceKind: this.sourceKind, sourceVersion: this.sourceVersion, status: "cancelled", candidates: [], diagnostics: [{ code: "FR_ADAPTER_CANCELLED", severity: "warning", message: "Candidate collection was cancelled." }], dependencyDigests: [], durationMs: 0 };
    const selected = new Set(context.bindingSets.map((set) => set.effectiveSelectedRevisionId).filter((id): id is string => Boolean(id)));
    const matches = context.bindings.filter((binding) => this.sourceKind === "selected_stage1_binding" ? selected.has(binding.revisionId) : !selected.has(binding.revisionId) && sourceKindForOrigin(binding.origin.kind) === this.sourceKind);
    const candidates: RawFootprintCandidate[] = matches.map((binding) => ({ schemaVersion: "sirkit.raw-footprint-candidate.v1" as const, rawCandidateId: resolverId("raw-footprint-candidate", { sourceKind: this.sourceKind, sourceVersion: this.sourceVersion, binding: binding.recordDigest }), sourceKind: this.sourceKind, sourceVersion: this.sourceVersion, binding: structuredClone(binding) })).sort((a, b) => a.rawCandidateId.localeCompare(b.rawCandidateId));
    return { sourceKind: this.sourceKind, sourceVersion: this.sourceVersion, status: candidates.length ? "success" : "empty", candidates, diagnostics: [], dependencyDigests: matches.map((binding) => binding.recordDigest).sort(), durationMs: Number((performance.now() - started).toFixed(3)) };
  }
}

export class DisabledCandidateSource implements FootprintCandidateSource {
  constructor(readonly sourceKind: CandidateSourceKind, readonly sourceVersion: string, private readonly code: string) {}
  async collect(_context: CandidateCollectionContext, signal: AbortSignal): Promise<CandidateSourceResult> {
    return { sourceKind: this.sourceKind, sourceVersion: this.sourceVersion, status: signal.aborted ? "cancelled" : "unsupported", candidates: [], diagnostics: [{ code: signal.aborted ? "FR_ADAPTER_CANCELLED" : this.code, severity: "info", message: signal.aborted ? "Candidate collection was cancelled." : "Candidate source is deferred and unavailable in Stage 2." }], dependencyDigests: [], durationMs: 0 };
  }
}

export const PRODUCTION_FOOTPRINT_SOURCE_COMPOSITION_VERSION = "sirkit.footprint-source-composition/2.1.0" as const;

/** The one source composition used by production single, batch, and Stage 3 resolution. */
export function productionFootprintCandidateSources(
  passivePolicyContexts: PassivePolicyContextProvider = new DurablePassivePolicyContextStore(getDurableWorkflowRepository()),
): FootprintCandidateSource[] {
  return [
    new Stage1BindingCandidateSource("selected_stage1_binding"),
    new Stage1BindingCandidateSource("approved_exact_part_binding"),
    new Stage1BindingCandidateSource("explicit_component_assignment"),
    new Stage1BindingCandidateSource("symbol_attached_fact"),
    new Stage1BindingCandidateSource("normalized_package_mapping"),
    new Stage1BindingCandidateSource("legacy_assignment"),
    new Stage1BindingCandidateSource("human_suggestion"),
    new Stage1BindingCandidateSource("ai_catalog_suggestion"),
    new PassivePolicyCandidateSource(passivePolicyContexts),
    new DisabledCandidateSource("generated_overlay", "sirkit.generated-overlay-hook/disabled-stage2", "FR_STAGE10_OVERLAY_UNAVAILABLE"),
  ].sort((a, b) => a.sourceKind.localeCompare(b.sourceKind));
}

export const DEFAULT_FOOTPRINT_CANDIDATE_SOURCES: readonly FootprintCandidateSource[] = productionFootprintCandidateSources();

async function collectOne(source: FootprintCandidateSource, context: CandidateCollectionContext, timeoutMs: number, outerSignal?: AbortSignal): Promise<CandidateSourceResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outerSignal?.addEventListener("abort", abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutResult = new Promise<CandidateSourceResult>((resolve) => {
      timeout = setTimeout(() => { controller.abort(); resolve({ sourceKind: source.sourceKind, sourceVersion: source.sourceVersion, status: "timeout", candidates: [], diagnostics: [{ code: "FR_ADAPTER_TIMEOUT", severity: "error", message: "Candidate source exceeded its time budget." }], dependencyDigests: [], durationMs: timeoutMs }); }, timeoutMs);
    });
    return await Promise.race([source.collect(context, controller.signal), timeoutResult]);
  } catch {
    return { sourceKind: source.sourceKind, sourceVersion: source.sourceVersion, status: outerSignal?.aborted ? "cancelled" : "failed", candidates: [], diagnostics: [{ code: outerSignal?.aborted ? "FR_ADAPTER_CANCELLED" : "FR_ADAPTER_FAILED", severity: "error", message: outerSignal?.aborted ? "Candidate collection was cancelled." : "Candidate source failed safely." }], dependencyDigests: [], durationMs: 0 };
  } finally {
    if (timeout) clearTimeout(timeout);
    outerSignal?.removeEventListener("abort", abort);
  }
}

export async function collectCandidateSources(sources: readonly FootprintCandidateSource[], context: CandidateCollectionContext, signal?: AbortSignal): Promise<CandidateSourceResult[]> {
  const unique = new Map<CandidateSourceKind, FootprintCandidateSource>();
  for (const source of sources) {
    if (unique.has(source.sourceKind)) throw new Error(`FR_DUPLICATE_SOURCE_KIND:${source.sourceKind}`);
    unique.set(source.sourceKind, source);
  }
  const results = await Promise.all([...unique.values()].map((source) => collectOne(source, context, context.policy.adapterTimeoutMs, signal)));
  return results.sort((a, b) => a.sourceKind.localeCompare(b.sourceKind));
}
