/**
 * B13 — the SERVER-OWNED component-authority loader.
 *
 * Converts durable physical-binding aggregates (+ atomic-part confirmation)
 * into `ComponentAuthorityRecord[]` for one authenticated scope and one
 * canonical revision. This is the ONLY production producer of
 * component-authority facts for the agent run context: no browser/client
 * input, no catalog candidate, and no model output can reach this projection.
 *
 * Guarantees:
 *  - authenticated server scope only; [B13.2 §A] a binding aggregate whose
 *    durable scope is not COMPLETELY the requested scope — tenant, project,
 *    branch, board, COMPONENT, HIERARCHY, and variant applicability — fails
 *    the whole load closed with a bounded reason (never relabeled, never
 *    projected, never folded into a conflicted record, never a source of
 *    foreign durable identifiers);
 *  - duplicate/conflicting aggregates for one component are reported
 *    `conflicted` and NEVER merged;
 *  - a component becomes a verified replacement TARGET (carries
 *    `exactAuthority`) only when its selected binding is fully verified AND
 *    the atomic-part revision it names is confirmed published AND every exact
 *    asset identity (symbol/footprint/mapping) is present and internally
 *    consistent — a stale, unapproved, unavailable-footprint, unverified, or
 *    atomic-unconfirmed selection never mints exact authority;
 *  - database failure, timeout, or an aborted signal fails CLOSED as
 *    `unavailable` (no records, no envelope) — never a fabricated empty
 *    verified set;
 *  - deterministic ordering, bounded output, and no database rows,
 *    credentials, supplier internals, or SDK objects in the result.
 *
 * Server-only: importing this module pulls no browser state. It depends on
 * injected, narrow read interfaces so production wires the Postgres adapters
 * and tests use deterministic in-memory implementations.
 */

import type {
  BindingApprovalState,
  BindingConflictState,
  BindingFreshnessState,
  BindingLifecycleState,
  ComponentPhysicalBinding,
  ComponentPhysicalBindingSet,
  FootprintAssetAvailability,
  MappingVerificationState,
  PhysicalBindingScope,
} from "../physical-binding/types";
import { engineeringDigest } from "./stable";
import { validatePhysicalBinding, validateBindingSet } from "../physical-binding/validation";
import { PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH } from "../pcb/board-identity";
import type {
  ComponentAuthorityRecord,
  ComponentCatalogCandidate,
  ComponentExactAuthority,
} from "./component-authority";
import type { AtomicCatalogStatus } from "../atomic/revision-status";

/** Bounds — deterministic, defensive. */
export const MAX_AUTHORITY_COMPONENTS = 512;
export const MAX_AGGREGATES_PER_COMPONENT = 8;
export const MAX_BINDINGS_PER_AGGREGATE = 256;
export const MAX_EVIDENCE_PER_BINDING = 512;
export const MAX_AUTHORITY_HIERARCHY_ENTRIES = 64;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ComponentAuthorityScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
}

/**
 * [B13.2 §A] The ONE COMPLETE requested authority scope handed to the binding
 * source and compared against every durable aggregate. `componentInstanceId`
 * is part of the scope — never a separate parameter that could diverge from
 * the scope the source actually queried.
 */
export interface AuthorityComponentScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
  componentInstanceId: string;
  hierarchyPath: readonly string[];
  assemblyVariantId: string;
}

/** One durable binding aggregate for a component (the read-only subset the
 *  loader needs). Production adapts `PhysicalBindingRepository`. */
export interface AuthorityBindingAggregate {
  /** The FULL durable set — validated by `validateBindingSet`. */
  set: ComponentPhysicalBindingSet;
  bindings: readonly ComponentPhysicalBinding[];
}

/** Narrow, injectable, server-only binding read source. Implementations may
 *  throw (DB down/timeout) — the loader converts that into `unavailable`.
 *  [B13.2 §A] receives the ONE complete component scope (component id,
 *  hierarchy, and variant included) — never a separately-passed component id
 *  that could diverge from the queried scope. */
export interface AuthorityBindingSource {
  loadForComponent(
    scope: AuthorityComponentScope,
    signal?: AbortSignal,
  ): Promise<readonly AuthorityBindingAggregate[]>;
}

/**
 * [B13.1 §D] The allowlisted projection of a PUBLISHED atomic snapshot —
 * the ONLY atomic facts that may cross-check a binding's exact identity.
 * Non-null ⇒ the revision is published AND its mapping is approved. Never
 * carries CAD blobs, supplier data, credentials, database rows, or SDK
 * objects. Production derives this from `loadPublishedPortableSnapshot`:
 *
 *  - `atomicPartRevisionId` = `snapshot.atomicRevision.id`
 *  - `exactMpn` = `snapshot.exactPart.exactMpn`
 *  - `manufacturerId` = `snapshot.exactPart.manufacturerId`
 *  - `symbolAssetVersionId` = `snapshot.symbol.id`
 *  - `footprintAssetVersionId` = `snapshot.footprint.id`
 *  - `mappingCertificateId` = `snapshot.mapping.id` (state `approved`)
 */
export interface AtomicRevisionConfirmation {
  atomicPartRevisionId: string;
  published: true;
  exactMpn: string;
  manufacturerId: string;
  symbolAssetVersionId: string;
  footprintAssetVersionId: string;
  mappingCertificateId: string;
}
export type AtomicRevisionConfirmer = (
  atomicPartRevisionId: string,
  signal?: AbortSignal,
) => Promise<AtomicRevisionConfirmation | null>;

/**
 * [B19-E E5] The catalog status of a published atomic revision, from its append-only withdrawal events (null when the id names
 * no published revision). Production: `loadAtomicCatalogStatusCancellable`; the fixture runtime: its committed catalog.
 */
export type AtomicCatalogStatusReader = (
  atomicPartRevisionId: string,
  signal?: AbortSignal,
) => Promise<{ state: AtomicCatalogStatus; successorRevisionId?: string } | null>;

export interface ComponentAuthoritySourceDeps {
  bindings: AuthorityBindingSource;
  atomic: AtomicRevisionConfirmer;
  /** [B19-E E5] when present, a verified selection's revision status becomes the record's catalogStatus facet (OD-38) */
  catalogStatus?: AtomicCatalogStatusReader;
}

export interface LoadComponentAuthorityInput {
  scope: ComponentAuthorityScope;
  /** The run's canonical revision (for provenance, not a binding filter). */
  canonicalRevision: string;
  /** Stable schematic component identities to resolve authority for. */
  componentInstanceIds: readonly string[];
  /** [B13.2 §A] the requested hierarchy — defaults to the ONE shared board
   *  hierarchy. A durable aggregate under any other hierarchy fails closed. */
  hierarchyPath?: readonly string[];
  assemblyVariantId?: string;
  signal?: AbortSignal;
}

export type ComponentAuthorityLoad =
  | {
      status: "loaded";
      records: ComponentAuthorityRecord[];
      candidates: ComponentCatalogCandidate[];
      /** Deterministic digest over the projected records (provenance). */
      sourceDigest: string;
    }
  | { status: "unavailable"; reason: string };

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * [B13.2 §A] COMPLETE requested-scope agreement for a durable aggregate:
 * tenant/project/branch/board equality, the EXACT requested component, the
 * EXACT requested hierarchy, and variant applicability. An empty durable
 * `assemblyVariantIds` means universally applicable — the repository's
 * existing authoritative semantic (`findForComponentVariant`); otherwise the
 * list must contain the requested variant.
 */
function aggregateScopeMatches(scope: PhysicalBindingScope, requested: AuthorityComponentScope): boolean {
  return scope.tenantId === requested.tenantId
    && scope.projectId === requested.projectId
    && scope.branchId === requested.branchId
    && scope.boardInstanceId === requested.boardInstanceId
    && scope.componentInstanceId === requested.componentInstanceId
    && sameStringArray(scope.hierarchyPath, requested.hierarchyPath)
    && (scope.assemblyVariantIds.length === 0 || scope.assemblyVariantIds.includes(requested.assemblyVariantId));
}

/** [B13.2 §A] EVERY binding must carry the same COMPLETE owner scope as its
 *  set — including the hierarchy and the full variant list. */
function bindingOwnsSetScope(binding: PhysicalBindingScope, set: PhysicalBindingScope): boolean {
  return binding.tenantId === set.tenantId
    && binding.projectId === set.projectId
    && binding.branchId === set.branchId
    && binding.boardInstanceId === set.boardInstanceId
    && binding.componentInstanceId === set.componentInstanceId
    && sameStringArray(binding.hierarchyPath, set.hierarchyPath)
    && sameStringArray(binding.assemblyVariantIds, set.assemblyVariantIds);
}

/** Local mirror of the inspector's verified-exact precedence — a record only
 *  earns exact authority when EVERY facet is clean. */
function facetsVerified(input: {
  lifecycle: BindingLifecycleState;
  approval: BindingApprovalState;
  freshness: BindingFreshnessState;
  conflict: BindingConflictState;
  footprintAsset: FootprintAssetAvailability;
  mappingVerification: MappingVerificationState;
  hasSelectedPart: boolean;
}): boolean {
  return input.conflict === "none"
    && input.freshness !== "stale"
    && input.mappingVerification !== "stale"
    && input.hasSelectedPart
    && input.lifecycle === "selected"
    && input.footprintAsset === "available"
    && input.mappingVerification === "verified"
    && input.approval === "approved";
}

/**
 * Load server-owned component-authority records. Total: any thrown/aborted
 * repository or atomic call yields `unavailable` (fail closed). The atomic
 * confirmation is consulted ONLY for otherwise-verified selections, so an
 * unavailable atomic layer degrades a component to non-exact, never the whole
 * load (the binding facts are still authoritative for inspection).
 */
export async function loadComponentAuthorityRecords(
  deps: ComponentAuthoritySourceDeps,
  input: LoadComponentAuthorityInput,
): Promise<ComponentAuthorityLoad> {
  const { scope } = input;
  for (const value of [scope.tenantId, scope.projectId, scope.branchId, scope.boardInstanceId]) {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) return { status: "unavailable", reason: "authority scope is not a well-formed identifier" };
  }
  // [B13.2 §A] hierarchy + variant are part of the REQUESTED scope. They
  // default to the ONE shared board identity and are NEVER silently
  // substituted: a malformed requested hierarchy entry or variant fails the
  // load closed instead of degrading to the default.
  const hierarchyPath = input.hierarchyPath ?? PCB_BOARD_HIERARCHY_PATH;
  if (hierarchyPath.length === 0 || hierarchyPath.length > MAX_AUTHORITY_HIERARCHY_ENTRIES
    || hierarchyPath.some((entry) => typeof entry !== "string" || !ID_PATTERN.test(entry))) {
    return { status: "unavailable", reason: "authority scope is not a well-formed identifier" };
  }
  const assemblyVariantId = input.assemblyVariantId ?? PCB_BOARD_ASSEMBLY_VARIANT_ID;
  if (typeof assemblyVariantId !== "string" || !ID_PATTERN.test(assemblyVariantId)) {
    return { status: "unavailable", reason: "authority scope is not a well-formed identifier" };
  }
  const uniqueIds = [...new Set(input.componentInstanceIds)].filter((id) => typeof id === "string" && ID_PATTERN.test(id)).sort();
  if (uniqueIds.length > MAX_AUTHORITY_COMPONENTS) {
    return { status: "unavailable", reason: `authority request exceeds ${MAX_AUTHORITY_COMPONENTS} components` };
  }
  if (input.signal?.aborted) return { status: "unavailable", reason: "authority load aborted before it began" };

  const records: ComponentAuthorityRecord[] = [];
  for (const componentInstanceId of uniqueIds) {
    // [B13.2 §A] the ONE complete requested scope for this component — the
    // same object is what the source queries and what every durable aggregate
    // is compared against, so the two can never diverge.
    const componentScope: AuthorityComponentScope = { ...scope, componentInstanceId, hierarchyPath: [...hierarchyPath], assemblyVariantId };
    let aggregates: readonly AuthorityBindingAggregate[];
    try {
      aggregates = await deps.bindings.loadForComponent(componentScope, input.signal);
    } catch {
      // Fail CLOSED for the whole load — never a partial verified set.
      return { status: "unavailable", reason: "durable binding source is unavailable" };
    }
    if (input.signal?.aborted) return { status: "unavailable", reason: "authority load aborted" };

    // [B13.2 §A] bound the RAW collection BEFORE any filtering or validation
    // — an oversized return is untrusted source behaviour, not data to sift.
    if (aggregates.length > MAX_AGGREGATES_PER_COMPONENT) {
      return { status: "unavailable", reason: "durable source returned an oversized aggregate collection" };
    }
    if (aggregates.length === 0) continue; // no record for this component (reported as unknown by the inspector)

    // [B13.2 §A] COMPLETE scope agreement for EVERY aggregate and EVERY
    // binding inside it, before anything else. A mismatched aggregate is
    // never relabeled, never projected, never folded into a conflicted
    // record, and never exposes durable identifiers from another scope —
    // the whole load fails closed with a bounded reason.
    for (const aggregate of aggregates) {
      if (!aggregate || typeof aggregate !== "object" || !aggregate.set || !Array.isArray(aggregate.bindings)) {
        return { status: "unavailable", reason: "durable source returned a malformed aggregate" };
      }
      if (!aggregateScopeMatches(aggregate.set.scope, componentScope)) {
        return { status: "unavailable", reason: "durable source returned an aggregate outside the requested authority scope" };
      }
      for (const binding of aggregate.bindings) {
        if (!binding || typeof binding !== "object" || !bindingOwnsSetScope(binding.scope, aggregate.set.scope)) {
          return { status: "unavailable", reason: "durable aggregate carries a binding outside its owner scope" };
        }
      }
    }

    // Duplicate/conflicting aggregates are NEVER merged.
    if (aggregates.length > 1) {
      records.push(conflictedRecord(componentScope.componentInstanceId, scope.projectId, aggregates));
      continue;
    }
    const aggregate = aggregates[0]!;

    // [B13.1 §C] VALIDATE the durable aggregate before projecting anything. A
    // malformed/tampered binding or set fails CLOSED: the component surfaces
    // as a truthful `conflicted` record (never silently unknown, never
    // exactAuthority, never verified-exact).
    if (!aggregateIsValid(aggregate)) {
      records.push(conflictedRecord(componentScope.componentInstanceId, scope.projectId, aggregates));
      continue;
    }

    // [B13.2 §A] the selected binding must belong to the exact validated
    // owner scope (every binding already proved it above; re-checked here).
    const selected = aggregate.set.effectiveSelectedRevisionId
      ? aggregate.bindings.find((binding) => binding.revisionId === aggregate.set.effectiveSelectedRevisionId && bindingOwnsSetScope(binding.scope, aggregate.set.scope))
      : undefined;

    // [B13.2 §A] the projected component identity derives ONLY from the
    // VALIDATED durable scope (proven equal to the request above) — a durable
    // record can never be relabeled as a different component.
    const record = projectRecord(aggregate.set.scope.componentInstanceId, scope.projectId, aggregate, selected);

    // Exact authority — only for a fully verified selection whose atomic
    // revision is confirmed published and whose exact assets exactly agree
    // with the published snapshot (§D cross-check).
    if (selected && record.selectedPart && facetsVerified({
      lifecycle: record.lifecycle, approval: record.approval, freshness: record.freshness,
      conflict: record.conflict, footprintAsset: record.footprintAsset,
      mappingVerification: record.mappingVerification, hasSelectedPart: true,
    })) {
      // [B19-E E5] the revision's catalog status first: a revoked revision mints no exact authority (OD-38); a deprecated or
      // superseded one keeps its pin's authority with a facet naming the successor; a status read that fails fails closed
      const revisionId = selected.exactPart?.atomicPartRevisionId;
      let revoked = false;
      if (deps.catalogStatus && revisionId) {
        let status: Awaited<ReturnType<AtomicCatalogStatusReader>>;
        try {
          status = await deps.catalogStatus(revisionId, input.signal);
        } catch {
          return { status: "unavailable", reason: "atomic catalog status source is unavailable" };
        }
        if (status && status.state !== "published") {
          record.catalogStatus = { atomicPartRevisionId: revisionId, state: status.state, ...(status.successorRevisionId ? { successorRevisionId: status.successorRevisionId } : {}) };
          revoked = status.state === "revoked";
        }
      }
      const exact = revoked ? null : await resolveExactAuthority(deps, selected, input.signal);
      if (exact === "unavailable") return { status: "unavailable", reason: "atomic confirmation source is unavailable" };
      if (exact) record.exactAuthority = exact;
    }
    records.push(record);
  }

  records.sort((a, b) => a.componentId.localeCompare(b.componentId));
  const sourceDigest = engineeringDigest({ schema: "sirkit.component-authority-source.v1", canonicalRevision: input.canonicalRevision, records });
  return { status: "loaded", records, candidates: [], sourceDigest };
}

export const DEFAULT_AUTHORITY_LOAD_DEADLINE_MS = 5_000;

/**
 * [B13.1 §F / B13.2 §C] Deadline-bounded, HARD-CANCELLING, fail-closed load
 * of the run's component authority as a server-owned assembler input.
 *
 * External abort is a TERMINAL member of the settlement race — a mid-flight
 * request abort settles null IMMEDIATELY (never waiting for the separate
 * authority deadline), aborts the internal controller exactly once, clears
 * the deadline timer, and removes the external listener. The internal signal
 * is passed to the binding and atomic sources so a cooperative source (and
 * the production cancellable-read adapter) actually stops work. Guarantees:
 * exactly one terminal settlement; a deterministic null at the deadline
 * (fake-timer driven, no wall-clock dependence); late source resolution
 * discarded; late rejection handled (no unhandled rejection); a pre-aborted
 * external signal performs NO I/O. Returns null (WITHHOLD) on
 * unavailable/timeout/aborted/empty, and `deps === null` (local-only build)
 * withholds without any I/O.
 */
export async function loadRunComponentAuthority(
  deps: ComponentAuthoritySourceDeps | null,
  input: LoadComponentAuthorityInput,
  deadlineMs: number = DEFAULT_AUTHORITY_LOAD_DEADLINE_MS,
): Promise<{ records: readonly ComponentAuthorityRecord[]; candidates: readonly ComponentCatalogCandidate[] } | null> {
  if (!deps) return null;
  const external = input.signal;
  if (external?.aborted) return null; // pre-aborted → no I/O

  const controller = new AbortController();
  return await new Promise((resolve) => {
    let settled = false;
    // Hoisted declarations so the deadline timer can be created (and named)
    // before the listeners that clear it; no settle path can run earlier.
    function settle(value: { records: readonly ComponentAuthorityRecord[]; candidates: readonly ComponentCatalogCandidate[] } | null): void {
      // ONE terminal settlement: whichever of {external abort, deadline,
      // source settlement} arrives first wins; the rest are discarded.
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
      resolve(value);
    }
    function onExternalAbort(): void { controller.abort(); settle(null); }
    const timer = setTimeout(() => { controller.abort(); settle(null); }, deadlineMs);
    external?.addEventListener("abort", onExternalAbort, { once: true });
    // The load runs against the INTERNAL linked signal. Both settlement arms
    // are handled, so a late source rejection can never become an unhandled
    // rejection, and a late resolution is discarded by the `settled` latch.
    loadComponentAuthorityRecords(deps, { ...input, signal: controller.signal }).then(
      (result) => settle(result.status !== "loaded" || result.records.length === 0 ? null : { records: result.records, candidates: result.candidates }),
      () => settle(null),
    );
  });
}

/** [B13.1 §C] Full durable-aggregate validation before projection. Every
 *  binding must pass `validatePhysicalBinding`; the set must pass
 *  `validateBindingSet` against the complete binding collection; counts are
 *  bounded. Any issue ⇒ invalid (fail closed). [B13.2 §A] scope agreement is
 *  enforced by the caller BEFORE this runs (a scope mismatch fails the whole
 *  load — it never reaches validation or a conflicted record). */
function aggregateIsValid(aggregate: AuthorityBindingAggregate): boolean {
  const bindings = aggregate.bindings;
  if (bindings.length === 0 || bindings.length > MAX_BINDINGS_PER_AGGREGATE) return false;
  for (const binding of bindings) {
    if (binding.evidenceRefs && binding.evidenceRefs.length > MAX_EVIDENCE_PER_BINDING) return false;
    if (validatePhysicalBinding(binding).length > 0) return false;
  }
  // The set itself: scope, candidate membership, selected-revision
  // membership + lifecycle, and the set digest — all against the complete
  // collection. A set carrying a forged digest cannot pass this.
  return validateBindingSet(aggregate.set, bindings).length === 0;
}

function conflictedRecord(componentId: string, projectId: string, owned: readonly AuthorityBindingAggregate[]): ComponentAuthorityRecord {
  return {
    authorityRecordId: [...owned].map((aggregate) => aggregate.set.setId).sort().join("+"),
    componentId,
    projectId,
    authorityRevision: "conflicted",
    lifecycle: "candidate",
    approval: "unreviewed",
    freshness: "unknown",
    conflict: "present",
    footprintAsset: "unresolved",
    mappingVerification: "missing",
    evidenceRefs: [],
  };
}

function projectRecord(
  componentId: string,
  projectId: string,
  aggregate: AuthorityBindingAggregate,
  selected: ComponentPhysicalBinding | undefined,
): ComponentAuthorityRecord {
  const exactPart = selected?.exactPart;
  const hasSelection = selected !== undefined && selected.lifecycleState === "selected" && exactPart !== undefined;
  const record: ComponentAuthorityRecord = {
    authorityRecordId: aggregate.set.setId,
    componentId,
    projectId,
    authorityRevision: selected?.revisionId ?? aggregate.set.setId,
    ...(hasSelection && exactPart
      ? {
          selectedPart: {
            mpn: exactPart.exactPublishedMpn,
            manufacturer: exactPart.manufacturerId,
            ...(selected?.package?.canonicalName ? { package: selected.package.canonicalName } : {}),
            provenance: "physical-binding" as const,
          },
        }
      : {}),
    lifecycle: selected?.lifecycleState ?? "candidate",
    approval: selected?.approval.state ?? "unreviewed",
    freshness: selected?.freshness.state ?? "unknown",
    conflict: selected?.conflict.state ?? "none",
    footprintAsset: selected?.footprint?.availability ?? "missing",
    mappingVerification: selected?.pinPadMapping.state ?? "missing",
    ...(selected?.footprint?.assetVersionId ? { footprintBindingRevision: selected.footprint.assetVersionId } : {}),
    ...(selected?.pinPadMapping.mappingCertificateId ? { mappingVerificationRevision: selected.pinPadMapping.mappingCertificateId } : {}),
    ...(selected?.approval.decisionId ? { approvalRevision: selected.approval.decisionId } : {}),
    evidenceRefs: [...(selected?.evidenceRefs ?? [])].sort(),
  };
  return record;
}

/**
 * Resolve the complete server-owned exact identity for a verified selection,
 * or `null` when any required exact fact is absent/inconsistent, or
 * `"unavailable"` when the atomic confirmation source itself fails.
 */
async function resolveExactAuthority(
  deps: ComponentAuthoritySourceDeps,
  selected: ComponentPhysicalBinding,
  signal?: AbortSignal,
): Promise<ComponentExactAuthority | null | "unavailable"> {
  const exactPart = selected.exactPart;
  const mapping = selected.pinPadMapping;
  const footprint = selected.footprint;
  const atomicPartRevisionId = exactPart?.atomicPartRevisionId;
  const symbolAssetVersionId = mapping.symbolAssetVersionId;
  const footprintAssetVersionId = footprint?.assetVersionId ?? mapping.footprintAssetVersionId;
  const mappingCertificateId = mapping.mappingCertificateId;
  // Every exact identity fact must be present on the durable binding.
  if (!atomicPartRevisionId || !symbolAssetVersionId || !footprintAssetVersionId || !mappingCertificateId || !exactPart) {
    return null;
  }
  // The atomic revision must be confirmed PUBLISHED by the atomic authority.
  let confirmation: AtomicRevisionConfirmation | null;
  try {
    confirmation = await deps.atomic(atomicPartRevisionId, signal);
  } catch {
    return "unavailable";
  }
  if (!confirmation || confirmation.atomicPartRevisionId !== atomicPartRevisionId) return null;
  // [B13.1 §D] CROSS-CHECK every binding-side exact identity against the
  // published snapshot projection. A binding-controlled symbol/footprint/
  // mapping/MPN/manufacturer that disagrees with the published atomic
  // revision NEVER enters exactAuthority (counterexample R5). Every field
  // must exactly agree across the durable binding AND the published snapshot.
  if (
    exactPart.exactPublishedMpn !== confirmation.exactMpn
    || exactPart.manufacturerId !== confirmation.manufacturerId
    || symbolAssetVersionId !== confirmation.symbolAssetVersionId
    || footprintAssetVersionId !== confirmation.footprintAssetVersionId
    || mappingCertificateId !== confirmation.mappingCertificateId
  ) {
    return null;
  }
  const exact: ComponentExactAuthority = {
    atomicPartRevisionId,
    mpn: exactPart.exactPublishedMpn,
    manufacturer: exactPart.manufacturerId,
    symbolAssetVersionId,
    footprintAssetVersionId,
    mappingCertificateId,
    ...(mapping.mappingRevisionId ? { selectionRecordId: mapping.mappingRevisionId } : {}),
  };
  return exact;
}
