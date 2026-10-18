/**
 * [PR-M, 2026-10-17] Reading the resolution's SERVER facts through the injected ports, bounded: the catalog parts (one port call
 * per distinct part id, a few at a time, each under what is left of the call's deadline) and the published revision evidence
 * with its catalog status (one port call for every revision id). A miss, a failure and a late answer are DATA per part (the
 * part is `unavailable` with a closed reason) - never a guess, never a refusal of the whole read. Used by the agent's instance
 * inspection, candidate search and resolution proposal services; the chat route injects the ports.
 */
import type { CatalogPartInspectionPort, CatalogPartInspectionPortAnswer } from "../agent/catalog-inspection-reads";
import { boundedPortCall } from "./candidate-search";
import type { FreshResolutionFacts, ResolutionPortScope, RevisionEvidencePort, RevisionEvidencePortAnswer, PublishedRevisionEvidence } from "./evidence";
import type { CatalogPartLoad } from "./instance-facts";
import type { AtomicRevisionStatus } from "../atomic/revision-status";

export const CATALOG_PART_READ_CONCURRENCY = 4;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface FactsLoadContext { scope: ResolutionPortScope; runId: string; budgetMs: number; signal?: AbortSignal; now?: () => number }

/** Read the catalog parts; without a port every part is unavailable (`no catalog port is bound to this run`). */
export async function loadCatalogParts(port: CatalogPartInspectionPort | undefined, partIds: readonly string[], context: FactsLoadContext): Promise<{ parts: Map<string, CatalogPartLoad>; asked: number; failed: number }> {
  const parts = new Map<string, CatalogPartLoad>();
  const unique = [...new Set(partIds)].sort();
  if (!port) {
    for (const partId of unique) parts.set(partId, { state: "unavailable", reason: "catalog unavailable: no catalog port is bound to this run" });
    return { parts, asked: 0, failed: unique.length };
  }
  const now = context.now ?? (() => Date.now());
  const started = now();
  let failed = 0;
  for (let index = 0; index < unique.length; index += CATALOG_PART_READ_CONCURRENCY) {
    const batch = unique.slice(index, index + CATALOG_PART_READ_CONCURRENCY);
    const budget = context.budgetMs - (now() - started);
    const answers = await Promise.all(batch.map((partId) => boundedPortCall<CatalogPartInspectionPortAnswer>((signal, deadlineMs) => port.inspect({ partId, scope: context.scope, runId: context.runId, deadlineMs, signal }), budget, context.signal)));
    batch.forEach((partId, offset) => {
      const answer = answers[offset];
      if (answer?.state === "found") parts.set(partId, { state: "found", detail: answer.detail, revisionStatus: answer.revisionStatus });
      else if (answer?.state === "not_found") { parts.set(partId, { state: "not_found" }); }
      else {
        failed += 1;
        parts.set(partId, { state: "unavailable", reason: answer === null || answer === undefined ? "catalog unavailable: the catalog read exceeded the call's deadline" : `catalog unavailable: CATALOG_READ_FAILED:${SAFE_CODE.test(answer.code) ? answer.code : "UNKNOWN"}` });
      }
    });
  }
  return { parts, asked: unique.length, failed };
}

/** Read the published evidence + status of the revisions; null when the port is absent, fails or is late (the caller refuses). */
export async function loadRevisionEvidence(port: RevisionEvidencePort | undefined, revisionIds: readonly string[], context: FactsLoadContext): Promise<{ evidence: Record<string, PublishedRevisionEvidence | null>; status: Record<string, AtomicRevisionStatus> } | null> {
  const unique = [...new Set(revisionIds)].sort();
  if (unique.length === 0) return { evidence: {}, status: {} };
  if (!port) return null;
  const answer = await boundedPortCall<RevisionEvidencePortAnswer>((signal, deadlineMs) => port.load({ revisionIds: unique, scope: context.scope, runId: context.runId, deadlineMs, signal }), context.budgetMs, context.signal);
  if (!answer || answer.state !== "ok") return null;
  const evidence: Record<string, PublishedRevisionEvidence | null> = {};
  const status: Record<string, AtomicRevisionStatus> = {};
  for (const id of unique) {
    evidence[id] = Object.hasOwn(answer.evidence, id) ? answer.evidence[id] ?? null : null;
    if (Object.hasOwn(answer.status, id)) status[id] = answer.status[id]!;
  }
  return { evidence, status };
}

/**
 * The server half of the resolution apply's fresh-facts exchange: what the same-origin endpoint answers the one-shot channel with
 * (app/lib/component-resolution/resolution-reauthorization.ts). Every catalog part the batch is decided on and the published
 * evidence and status of every asserted revision, read NOW through the same ports the proposal used. Null when the evidence cannot
 * be read (the apply refuses authority-unavailable; nothing is guessed). The HTTP route that calls it lands with the page intake.
 */
export const MAX_FRESH_FACT_PARTS = 128;
export async function loadFreshResolutionFacts(input: {
  catalog?: CatalogPartInspectionPort;
  evidence?: RevisionEvidencePort;
  request: { items: ReadonlyArray<{ componentInstanceId: string; currentPartId: string; candidatePartId: string; atomicPartRevisionId: string }>; partIds: readonly string[] };
  context: FactsLoadContext;
}): Promise<FreshResolutionFacts | null> {
  if (!input.catalog || !input.evidence) return null;
  const partIds = [...new Set([...input.request.partIds, ...input.request.items.flatMap((item) => [item.currentPartId, item.candidatePartId])])].sort();
  if (partIds.length > MAX_FRESH_FACT_PARTS) return null;
  const now = input.context.now ?? (() => Date.now());
  const started = now();
  const loaded = await loadCatalogParts(input.catalog, partIds, { ...input.context, budgetMs: Math.floor(input.context.budgetMs * 0.6) });
  const facts = await loadRevisionEvidence(input.evidence, input.request.items.map((item) => item.atomicPartRevisionId), { ...input.context, budgetMs: input.context.budgetMs - (now() - started) });
  if (!facts) return null;
  return {
    parts: partIds.map((partId) => {
      const load = loaded.parts.get(partId);
      return load?.state === "found" ? { partId, detail: load.detail, revisionStatus: { ...load.revisionStatus } } : { partId, detail: null, revisionStatus: {} };
    }),
    evidence: facts.evidence,
    status: facts.status,
  };
}
