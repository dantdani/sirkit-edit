/**
 * [PR-M, 2026-10-18] Section M2: the WORKER side of the component-resolution task's composition - the ADMITTED CAD source adapters (the
 * one place the task reaches the bounded egress path), the slice ports (M1's catalog and evidence ports handed in, the lexical exact-MPN
 * recall, the governance publication read) and the topic runner the existing generation worker registers. Imported only by the worker's
 * transports (the pump route, the direct worker script) and the tests.
 *
 *  - Normal mode: `kicad-bundled` (the pinned local checkout; refused per request when absent or not at the pin); `kicad-gitlab` is
 *    BLOCKED - a recorded skip, never an adapter; `fixture-kicad` is refused (fixture only).
 *  - Fixture runtime: `fixture-kicad` only (the committed bytes through the production egress path and the fixture transport); the bundled
 *    checkout is not consulted, so fixture evidence stays fixture evidence.
 */
import { fixtureRuntimeCadTransport } from "../../fixture-runtime/cad-source/transport";
import { resolveMembershipRepository } from "../../auth/identity-runtime";
import { projectRoleFromMembership } from "../../auth/project-membership";
import { DurableAtomicPublicationStore } from "../../atomic/publication-review";
import { admitCadSource, CAD_SOURCE_ENTRIES } from "../../acquisition/cad-source-registry";
import { createBundledCadAdapter } from "../../acquisition/cad-adapters/bundled";
import { createFixtureCadAdapter } from "../../acquisition/cad-adapters/network";
import type { CadSourceAdapter } from "../../acquisition/cad-adapters/types";
import type { CadEgressDeps } from "../../acquisition/cad-egress";
import { DurableAcquiredObjectStore } from "../../acquisition/cad-object-store";
import type { CatalogPartInspectionPort } from "../../agent/catalog-inspection-reads";
import type { RevisionEvidencePort } from "../evidence";
import { DurableAcquisitionCandidateStore } from "../acquisition/candidate";
import { governanceScopeOf, HANDOFF_ID } from "../acquisition/handoff";
import type { AcquisitionPipelinePorts } from "../acquisition/pipeline";
import { catalogPartIdsByExactMpn, cachedIdentityEvidence } from "../acquisition/catalog-recall";
import type { ResolutionSliceRevalidator } from "./store";
import type { ComponentResolutionSlicePorts, HandoffPublicationStatus } from "./slices";
import { componentResolutionTopicRunner } from "./topic-runner";
import type { FencedTopicRunner } from "../../generation-task/worker/worker";
import { componentResolutionStoreOf, type ComponentResolutionRuntime } from "./runtime";

/** Injected by tests (a counting transport, an alternate checkout root); production composes the defaults below. */
export interface CadSourceInjection { fixtureEgress?: CadEgressDeps & { fetch: typeof fetch; resolve: (hostname: string) => Promise<string[]> }; bundledRoot?: string; fixtureAllowed?: boolean }
let injection: CadSourceInjection = {};
export function setCadSourceInjection(next: CadSourceInjection): void { injection = next; }
export function resetCadSourceInjection(): void { injection = {}; }

/** The admitted adapters in preference order, and every other row as a recorded skip (blocked / fixture-only / operator-off). */
export function admittedCadSources(runtime: ComponentResolutionRuntime): { adapters: CadSourceAdapter[]; skipped: Array<{ sourceId: string; code: string; detail: string }> } {
  const fixtureAllowed = injection.fixtureAllowed ?? runtime.fixture;
  const adapters: CadSourceAdapter[] = [];
  const skipped: Array<{ sourceId: string; code: string; detail: string }> = [];
  for (const entry of CAD_SOURCE_ENTRIES) {
    const admission = admitCadSource(entry.id, { env: runtime.environment, fixtureAllowed });
    if (!admission.admitted) { skipped.push({ sourceId: entry.id, code: admission.refusal, detail: admission.message }); continue; }
    if (entry.id === "kicad-bundled") {
      // the fixture runtime keeps fixture evidence separate: its bundled checkout is not consulted
      if (runtime.fixture && !injection.bundledRoot) { skipped.push({ sourceId: entry.id, code: "fixture_runtime", detail: "the fixture runtime serves only the fixture CAD source" }); continue; }
      adapters.push(createBundledCadAdapter({ ...(injection.bundledRoot ? { root: injection.bundledRoot } : {}), clock: runtime.clock }));
    } else if (entry.id === "fixture-kicad") {
      const transport = injection.fixtureEgress ?? (() => { const fixture = fixtureRuntimeCadTransport(); return { fetch: fixture.fetch, resolve: fixture.resolve }; })();
      adapters.push(createFixtureCadAdapter({ ...transport, fixtureAllowed: true, env: runtime.environment, clock: runtime.clock }));
    }
  }
  return { adapters, skipped };
}

/** Section 3.2 step 3's rule for this task: the initiator still holds an editor role on the task's project. */
export function componentResolutionRevalidator(): ResolutionSliceRevalidator {
  return async (task) => {
    const repository = resolveMembershipRepository();
    if (!repository) throw new Error("COMPONENT_RESOLUTION_MEMBERSHIP_UNAVAILABLE");
    const membership = await repository.loadActiveMembership({ tenantId: task.scope.tenantId, projectId: task.scope.projectId, userId: task.initiator.principalId });
    const role = membership ? projectRoleFromMembership(membership.role) : null;
    return role && ["pcb_editor", "reviewer", "project_admin"].includes(role) ? { ok: true } : { ok: false, failure: "authority_revoked" };
  };
}

/** The publication request a handoff became, read in the governance scope (a server read; nothing about the source project is learnt). */
export function handoffPublicationReader(runtime: ComponentResolutionRuntime): (handoffId: string) => Promise<HandoffPublicationStatus | null> {
  return async (handoffId) => {
    const governance = governanceScopeOf(runtime.governance);
    if (!governance || !HANDOFF_ID.test(handoffId)) return null;
    const requests = await new DurableAtomicPublicationStore(runtime.repository).list(governance);
    const mine = requests.filter((stored) => stored.request.spec.symbol?.acquired?.handoffId === handoffId).sort((a, b) => b.request.requestedAt.localeCompare(a.request.requestedAt));
    const latest = mine.find((stored) => stored.request.status === "published") ?? mine[0];
    if (!latest) return { status: "not-submitted", requestId: null, revisionId: null, linkedPartIds: [], reason: null };
    const request = latest.request;
    return {
      status: request.status, requestId: request.requestId, revisionId: request.publication?.revisionId ?? null,
      // a discovery row is recalled by its exact MPN (the slice's lexical recall), so only the written links are named here
      linkedPartIds: [...new Set((request.publication?.links ?? request.links).map((link) => link.partId))],
      reason: request.status === "rejected" ? request.decision?.reason ?? null : request.withdrawal?.reason ?? request.retirement?.detail ?? null,
    };
  };
}

export function componentResolutionSlicePorts(runtime: ComponentResolutionRuntime, ports: { catalog: CatalogPartInspectionPort; evidence: RevisionEvidencePort }): ComponentResolutionSlicePorts {
  return {
    catalog: ports.catalog,
    evidence: ports.evidence,
    partsByExactMpn: (exactMpn) => catalogPartIdsByExactMpn(exactMpn),
    pipeline: (): AcquisitionPipelinePorts => {
      const sources = admittedCadSources(runtime);
      return { ...sources, objects: new DurableAcquiredObjectStore(runtime.repository), candidates: new DurableAcquisitionCandidateStore(runtime.repository), identityEvidence: runtime.fixture ? undefined : cachedIdentityEvidence, clock: runtime.clock };
    },
    publicationOf: handoffPublicationReader(runtime),
    clock: runtime.clock,
  };
}

/** The worker's topic runner for this runtime (the pump route and the direct worker register it). */
export function componentResolutionTopic(runtime: ComponentResolutionRuntime, ports: () => { catalog: CatalogPartInspectionPort; evidence: RevisionEvidencePort } | null, log?: (line: string) => void): FencedTopicRunner | null {
  const store = componentResolutionStoreOf(runtime);
  return componentResolutionTopicRunner({
    store, revalidate: componentResolutionRevalidator(), ...(log ? { log } : {}),
    ports: () => { const resolved = ports(); if (!resolved) throw new Error("COMPONENT_RESOLUTION_CATALOG_UNAVAILABLE"); return componentResolutionSlicePorts(runtime, resolved); },
  });
}
