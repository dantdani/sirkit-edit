/**
 * B13.1 shared test fixtures — genuinely VALID durable binding aggregates
 * produced through the REAL physical-binding service (no database), so they
 * pass `validatePhysicalBinding` / `validateBindingSet` in the authority
 * loader. Not a test file (no `.test`); imported by b13 and b13.1 suites.
 */

import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "../../physical-binding/repository";
import { createApprovedValidation } from "../../physical-binding/transitions";
import { ACTOR, exactCandidate, transition } from "../../physical-binding/__tests__/fixtures";
import type { PhysicalBindingScope } from "../../physical-binding/types";
import type { AuthorityBindingAggregate, AtomicRevisionConfirmer, AtomicRevisionConfirmation } from "../component-authority-source";

/** The scope the physical-binding fixtures write under. */
export const FIXTURE_AUTHORITY_SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardInstanceId: "board-1" } as const;

/** [B13.2] the hierarchy the physical-binding fixtures write under — loads
 *  against fixture aggregates must request exactly this hierarchy. */
export const FIXTURE_AUTHORITY_HIERARCHY = ["root", "motor-control"] as const;

/** [B13.2] the variant the fixture aggregates apply to by default. */
export const FIXTURE_AUTHORITY_VARIANT = "variant-default" as const;

/** The exact identities the fixture candidate carries — the atomic snapshot
 *  projection must agree with these for exact authority to be minted. */
export const FIXTURE_EXACT = {
  atomicPartRevisionId: "atomic-revision-1",
  exactMpn: "STM32F411CEU6",
  manufacturerId: "manufacturer-st",
  symbolAssetVersionId: "symbol-stm32:r2",
  footprintAssetVersionId: "footprint-stm32-ufqfpn48:r3",
  mappingCertificateId: "mapping-certificate-1",
} as const;

/**
 * Drive the real service through create → select → revalidate → approve and
 * return the resulting validated aggregate `{ set, bindings }`.
 * [B13.2] `options.variants` and `options.scopeOverrides` parameterize the
 * durable scope (e.g. a route-derived board id or hierarchy) — the service
 * still produces a genuinely valid aggregate under that scope.
 */
export async function validApprovedAggregate(
  componentInstanceId = "component-uuid-1",
  options: { variants?: string[]; scopeOverrides?: Partial<PhysicalBindingScope> } = {},
): Promise<AuthorityBindingAggregate> {
  const repository = new InMemoryPhysicalBindingRepository();
  const service = new PhysicalBindingService(repository);
  const candidate = exactCandidate(componentInstanceId, { variants: options.variants, scopeOverrides: options.scopeOverrides });
  let state = await service.createCandidate(candidate, `create-${candidate.bindingId}`);

  const selectRequest = transition(candidate, state.set.revision, "select", ACTOR);
  selectRequest.decisionEvidenceRefs = ["evidence-datasheet"];
  state = await service.transition(state.set.setId, selectRequest);

  let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
  const revalidateRequest = transition(current, state.set.revision, "revalidate", ACTOR);
  revalidateRequest.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: revalidateRequest.at, evidenceRefs: ["evidence-mapping"] });
  state = await service.transition(state.set.setId, revalidateRequest);

  current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
  const approveRequest = transition(current, state.set.revision, "approve", ACTOR);
  approveRequest.decisionEvidenceRefs = ["evidence-datasheet"];
  state = await service.transition(state.set.setId, approveRequest);

  return { set: state.set, bindings: state.bindings };
}

/** An atomic confirmer whose published projection AGREES with the fixture
 *  exact identity (override one field to model a mismatch). */
export function matchingAtomicConfirmer(over: Partial<Omit<AtomicRevisionConfirmation, "published">> = {}): AtomicRevisionConfirmer {
  return async (atomicPartRevisionId) => {
    if (atomicPartRevisionId !== FIXTURE_EXACT.atomicPartRevisionId && !over.atomicPartRevisionId) return null;
    return {
      atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId,
      published: true,
      exactMpn: FIXTURE_EXACT.exactMpn,
      manufacturerId: FIXTURE_EXACT.manufacturerId,
      symbolAssetVersionId: FIXTURE_EXACT.symbolAssetVersionId,
      footprintAssetVersionId: FIXTURE_EXACT.footprintAssetVersionId,
      mappingCertificateId: FIXTURE_EXACT.mappingCertificateId,
      ...over,
    };
  };
}

/** A confirmer that returns null (revision not published / not found). */
export const unpublishedAtomicConfirmer: AtomicRevisionConfirmer = async () => null;
