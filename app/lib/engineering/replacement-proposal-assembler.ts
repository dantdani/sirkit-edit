/**
 * B14 §A/§B/§C — the SERVER-SIDE replacement-proposal assembler.
 *
 * Pure composition (no I/O): the caller supplies the validated run schematic,
 * the SERVER-OWNED component-authority records, the sealed resource bundle,
 * and the SERVER-OWNED published pin facts; this module verifies the strict
 * B14 envelope, consumes replacement authority against the sealed bundle,
 * plans through the ONE existing `planSchematicReplacement` algorithm, and
 * seals a `SealedReplacementProposal` — or returns structured blockers with
 * ZERO mutation.
 *
 * Authority discipline:
 *  - the target identity comes ONLY from the B13 exactAuthority block;
 *  - the model's input never carries asset identities, pin definitions,
 *    authority claims, approvals, or dropped-pin acknowledgements;
 *  - the proposal-time runtime grant is RETIRED before returning (the sealed
 *    artifact carries only the deterministic registry-handle string, which is
 *    worthless without a freshly minted server-side instance at apply time);
 *  - a connected pin that would be dropped is a BLOCKER — the assembler never
 *    supplies `acknowledgeDroppedPins`;
 *  - non-identity pin mappings are blockers (no provider-generated mapping,
 *    no pin-count inference); the target's APPROVED mapping certificate must
 *    corroborate the published symbol (mapping evidence layer).
 *
 * This module is one of the FOUR approved importers of
 * `schematic-authority.internal` (with schematic-plans, executor, and
 * schematic-replay-evidence) — enforced by the B06.1 boundary test.
 */

import type { SchematicState } from "@/lib/schematic-types";
import { inspectComponentAuthority, type ComponentAuthorityRecord, type ComponentCatalogCandidate } from "./component-authority";
import { consumeReplacementAuthority, retireReplacementAuthorityGrant, type VerifiedReplacementAuthority } from "./schematic-authority.internal";
import { planSchematicReplacement } from "./schematic-plans";
import { certificateCorroborates, type PublishedSymbolPinFacts } from "./replacement-pin-facts";
import {
  sealReplacementProposal,
  type ReplacementImpactSummary,
  type ReplacementTargetIdentity,
  type SealedReplacementProposal,
} from "./replacement-proposals";
import type { SchematicProposalAuthorizationBinding } from "./proposal-authorization";
import { buildReadResourceBundle, sealResourceEnvelope, type ReadResourceBundle } from "./resource-envelopes";
import { computeProjectRevision } from "./revision";
import { toCanonicalSchematic } from "./schematic-model";
import { createEmptyBoard } from "../pcb/types";
import type { Tier1ProposalScope } from "./schematic-proposals";
import { engineeringDigest } from "./stable";

export interface ReplacementBlocker {
  code:
    | "unknown-component"
    | "theory-component-unsupported"
    | "authority-not-verified-exact"
    | "expected-mpn-mismatch"
    | "already-installed"
    | "current-authority-missing"
    | "current-pin-authority-unavailable"
    | "target-pin-authority-unavailable"
    | "mapping-certificate-mismatch"
    | "canonical-head-mismatch"
    | "authority-consumption-refused"
    | "replacement-plan-refused";
  detail: string;
}

export type ReplacementProposalOutcome =
  | { kind: "sealed"; proposal: SealedReplacementProposal }
  | { kind: "blocked"; blockers: ReplacementBlocker[] };

const CONSUMED_AUTHORITY_DIGEST_SCHEMA = "sirkit.replacement-consumed-authority.v1";

export function consumedAuthorityDigestFor(resources: readonly { resourceId: string; contentDigest: string }[]): string {
  return engineeringDigest({ schema: CONSUMED_AUTHORITY_DIGEST_SCHEMA, resources });
}

function blocked(code: ReplacementBlocker["code"], detail: string): ReplacementProposalOutcome {
  return { kind: "blocked", blockers: [{ code, detail: `${detail} Nothing was changed.` }] };
}

/**
 * [B14 §E determinism] The replacement authority bundle is built the SAME
 * deterministic way at proposal time and at apply time, from (schematic
 * state, scope, authority records): a canonical-state envelope wrapping the
 * SCHEMATIC REFERENCE PROJECTION (the schematic under review inside a
 * reference project wrapper — the true canonical pin is
 * `sourceCanonicalRevision` = the live head's canonical-state digest, which
 * the executor separately verifies against the grant) plus the server-owned
 * component-authority-records envelope. Because both envelopes derive only
 * from the schematic, the records, and the head mark, the apply-time rebuild
 * is byte-identical — and therefore the fresh grant and recompiled operation
 * byte-match the reviewed proposal — IF AND ONLY IF the schematic, the
 * authority content, and the exact target are all unchanged.
 */
/** The canonical reference content mirrors EXACTLY how the schematic
 *  session constructs its engineering project (empty board + canonical
 *  schematic — schematic-session.ts openLineage), so its computed revision
 *  IS the session's head canonical-state digest when the state is the
 *  session's schematic. */
function replacementCanonicalContent(state: SchematicState, scope: { tenantId: string; projectId: string; branchId: string }) {
  return {
    schemaVersion: "sirkit.engineering.v1" as const,
    tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId,
    pcb: createEmptyBoard(),
    schematic: toCanonicalSchematic(state),
    pinnedAssets: [],
  };
}

/** The head canonical-state digest the schematic session reports for this
 *  schematic (test/verification convenience — the ONE digest domain the
 *  replacement grant binds). */
export function replacementHeadDigestFor(state: SchematicState, scope: { tenantId: string; projectId: string; branchId: string }): string {
  return computeProjectRevision(replacementCanonicalContent(state, scope)).canonicalStateDigest;
}

export function buildReplacementAuthorityBundle(input: {
  state: SchematicState;
  scope: Tier1ProposalScope;
  records: readonly ComponentAuthorityRecord[];
  candidates: readonly ComponentCatalogCandidate[];
  /** [B18-E E16] the component being replaced. The sealed envelope carries ITS authority and nothing else — see below. */
  componentId?: string;
}): ReadResourceBundle {
  const { tenantId, projectId, branchId } = input.scope;
  const content = replacementCanonicalContent(input.state, input.scope);
  const revision = computeProjectRevision(content).canonicalStateDigest;
  const canonicalEnvelope = sealResourceEnvelope({
    resourceId: `replacement-canonical:${projectId}`,
    kind: "canonical-state",
    tenantId, projectId, branchId,
    authoritySource: "local-working-copy",
    authorityStatus: "verified",
    sourceVersion: revision,
    sourceCanonicalRevision: revision,
    producer: "replacement-proposal-assembler",
    producerVersion: "1.0.0",
    freshness: "current",
    content,
  });
  const authorityEnvelope = sealResourceEnvelope({
    resourceId: `component-authority:${projectId}`,
    kind: "component-authority-records",
    tenantId, projectId, branchId,
    authoritySource: "durable-server-board",
    authorityStatus: "verified",
    sourceVersion: revision,
    sourceCanonicalRevision: revision,
    producer: "component-authority-source",
    producerVersion: "1.0.0",
    freshness: "current",
    // [B18-E E16] ONLY the replaced component's authority is sealed here. This envelope's content digest feeds the grant
    // id, which is embedded in the canonical operation — so anything in it that is not about this replacement makes the
    // SAME replacement digest differently. The two production callers load different breadths on purpose (the chat run
    // loads every component, because the model may inspect any of them; the apply loads the one it is applying), and a
    // sealed proposal could therefore never byte-match its own recompile on any project with more than one bound
    // component: measured in the browser, where every apply was refused "the recompiled plan no longer matches".
    // Narrowing here rather than widening the apply keeps the browser out of deciding what authority is consulted.
    content: {
      records: structuredClone(input.componentId ? input.records.filter((record) => record.componentId === input.componentId) : input.records),
      candidates: structuredClone(input.componentId ? input.candidates.filter((candidate) => candidate.componentId === input.componentId) : input.candidates),
    },
  });
  return buildReadResourceBundle(canonicalEnvelope, [authorityEnvelope]);
}

/**
 * [B14 §E] Consume FRESH replacement authority for the apply path. Identical
 * derivation discipline to the proposal path; the caller OWNS the returned
 * grant's lifecycle and MUST retire it on every terminal path.
 */
export function consumeFreshReplacementAuthority(input: {
  bundle: ReadResourceBundle;
  scope: { tenantId: string; projectId: string; branchId: string };
  expectedCanonicalRevision: string;
  componentId: string;
  targetPartId: string;
  atomicPartRevisionId: string;
}): { ok: true; authority: VerifiedReplacementAuthority } | { ok: false; code: string; detail: string } {
  const consumed = consumeReplacementAuthority({
    bundle: input.bundle,
    scope: input.scope,
    expectedCanonicalRevision: input.expectedCanonicalRevision,
    componentId: input.componentId,
    targetPartId: input.targetPartId,
    target: { atomicPartRevisionId: input.atomicPartRevisionId },
  });
  if (!consumed.ok) return { ok: false, code: consumed.code, detail: consumed.detail };
  return { ok: true, authority: consumed.authority };
}

/** Retire a runtime replacement grant (single-use lifecycle boundary). */
export function retireReplacementGrant(grantId: string): void {
  retireReplacementAuthorityGrant(grantId);
}

export function assembleReplacementProposal(input: {
  state: SchematicState;
  componentId: string;
  /** Expected-value assertion ONLY — never chooses the target. */
  expectedMpn?: string;
  authority: { records: readonly ComponentAuthorityRecord[]; candidates: readonly ComponentCatalogCandidate[] };
  scope: Tier1ProposalScope;
  /** [B16.0.1 §E] the server-verified authorization binding sealed into the
   *  proposal — derived by the trusted gateway from the run context, never
   *  from provider arguments. */
  authorization: SchematicProposalAuthorizationBinding;
  currentPinFacts: PublishedSymbolPinFacts | null;
  targetPinFacts: PublishedSymbolPinFacts | null;
  provenance: { provider: string; note: string; instruction: string };
  now: number;
  /** [B14 §E] apply-time recompilation: keep the minted grant registered and
   *  report its id (the CALLER then owns retirement on every terminal path).
   *  Proposal-time sealing leaves this unset — the grant is always retired
   *  before the artifact leaves the assembler. */
  retainGrant?: (grantId: string) => void;
}): ReplacementProposalOutcome {
  const { state, componentId } = input;

  // ── 1. The exact component: one live KiCad instance with a stable id. ──────
  const instance = (state.kicadComponents ?? []).find((candidate) => candidate.id === componentId);
  if (!instance) {
    if ((state.components ?? []).some((candidate) => candidate.id === componentId)) {
      return blocked("theory-component-unsupported", `Component ${componentId.slice(0, 64)} is a theory component; exact replacement targets KiCad component instances only.`);
    }
    return blocked("unknown-component", `No KiCad component instance with the stable id ${componentId.slice(0, 64)} exists in the current schematic.`);
  }

  // ── 2. SERVER-OWNED authority must classify the component verified-exact. ──
  const summary = inspectComponentAuthority({
    componentIds: [componentId],
    projectId: input.scope.projectId,
    records: input.authority.records,
    candidates: input.authority.candidates,
  })[0]!;
  if (summary.state !== "verified-exact") {
    return blocked("authority-not-verified-exact", `Component ${componentId.slice(0, 64)} has authority state "${summary.state}" — a verified-exact server-owned target is required. Gaps: ${summary.authorityGaps.join("; ") || "none reported"}.`);
  }
  const record = input.authority.records.find((candidate) => candidate.componentId === componentId);
  const exact = record?.exactAuthority;
  if (!exact) {
    return blocked("authority-not-verified-exact", `Component ${componentId.slice(0, 64)} carries no server-owned exact authority block.`);
  }
  if (input.expectedMpn !== undefined && input.expectedMpn !== exact.mpn) {
    return blocked("expected-mpn-mismatch", `The expected MPN does not match the server-owned verified target. The caller may assert an expectation, never choose the target.`);
  }

  // ── 3. Structured no-op: the exact target is already installed. ────────────
  if (instance.partId === exact.mpn
    && instance.atomicPartRevisionId === exact.atomicPartRevisionId
    && instance.symbolAssetVersionId === exact.symbolAssetVersionId
    && instance.footprintAssetVersionId === exact.footprintAssetVersionId
    && instance.mappingCertificateId === exact.mappingCertificateId
    && instance.selectionRecordId === exact.selectionRecordId) {
    return blocked("already-installed", `Component ${componentId.slice(0, 64)} already carries the exact verified identity ${exact.mpn.slice(0, 64)}; there is nothing to replace.`);
  }

  // ── 4. SERVER-OWNED current pin authority. ─────────────────────────────────
  if (!instance.atomicPartRevisionId || !instance.symbolAssetVersionId) {
    return blocked("current-authority-missing", `Component ${componentId.slice(0, 64)} carries no atomic/symbol authority identity, so its current pins cannot be resolved from durable server facts.`);
  }
  const current = input.currentPinFacts;
  if (!current || current.atomicPartRevisionId !== instance.atomicPartRevisionId || current.symbolAssetVersionId !== instance.symbolAssetVersionId) {
    return blocked("current-pin-authority-unavailable", `Published pin facts for the CURRENT component's atomic revision are unavailable or do not match its installed symbol identity.`);
  }

  // ── 5. SERVER-OWNED target pin authority + certificate corroboration. ──────
  const target = input.targetPinFacts;
  if (!target || target.atomicPartRevisionId !== exact.atomicPartRevisionId || target.symbolAssetVersionId !== exact.symbolAssetVersionId) {
    return blocked("target-pin-authority-unavailable", `Published pin facts for the TARGET atomic revision are unavailable or do not match the server-owned exact symbol identity.`);
  }
  if (!certificateCorroborates(target, exact.mappingCertificateId)) {
    return blocked("mapping-certificate-mismatch", `The target's approved mapping certificate does not corroborate the published symbol (certificate identity, symbol version, or pin coverage disagrees).`);
  }

  // ── 6. Consume replacement authority against the DETERMINISTIC bundle. ─────
  // [B14 §E] the ONE digest domain the replacement binds: the schematic
  // session's head canonical-state digest must equal the reference content's
  // computed revision — a run context that does not sit at the claimed head
  // fails closed here.
  const referenceDigest = replacementHeadDigestFor(state, input.scope);
  if (referenceDigest !== input.scope.headMark.canonicalStateDigest) {
    return blocked("canonical-head-mismatch", `The run context's schematic does not sit at the claimed canonical head; regenerate from the current schematic.`);
  }
  const bundle = buildReplacementAuthorityBundle({
    state,
    scope: input.scope,
    records: input.authority.records,
    candidates: input.authority.candidates,
    componentId,
  });
  const consumed = consumeFreshReplacementAuthority({
    bundle,
    scope: { tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId },
    expectedCanonicalRevision: input.scope.headMark.canonicalStateDigest,
    componentId,
    targetPartId: exact.mpn,
    atomicPartRevisionId: exact.atomicPartRevisionId,
  });
  if (!consumed.ok) {
    return blocked("authority-consumption-refused", `Replacement authority was refused (${consumed.code}): ${consumed.detail}`);
  }
  const grant = consumed.authority;
  let retained = false;

  try {
    // ── 7. ONE planning algorithm; identity mapping only; zero drops. ────────
    const planned = planSchematicReplacement(state, {
      componentId,
      target: { partId: exact.mpn, pins: [...target.pins], authority: grant },
      currentPins: [...current.pins],
      // NEVER: explicitPinMapping / acknowledgeDroppedPins — non-identity
      // mappings and dropped connected pins are blockers, not options.
    });
    if (!planned.ok) {
      const detail = planned.refusal === "unacknowledged-dropped-connections"
        ? `The replacement would drop connected pin(s) ${(planned.pins ?? []).join(", ")}; B14 never drops a connected pin.`
        : planned.refusal === "explicit-pin-mapping-required"
          ? `The old→new pin mapping is not an exact number+name identity for pin(s) ${(planned.pins ?? []).join(", ")}; ambiguous or non-identity mappings are out of scope.`
          : `${planned.refusal}: ${planned.detail}`;
      return blocked("replacement-plan-refused", detail);
    }
    if (planned.plan.droppedConnections.length > 0) {
      return blocked("replacement-plan-refused", `The plan reports dropped connections; a B14 replacement never drops a connected pin.`);
    }

    // ── 8. Seal. ────────────────────────────────────────────────────────────
    const authorityEnvelope = bundle.auxiliary.find((envelope) => envelope.kind === "component-authority-records")!;
    const targetIdentity: ReplacementTargetIdentity = {
      partId: exact.mpn,
      manufacturer: exact.manufacturer,
      atomicPartRevisionId: exact.atomicPartRevisionId,
      symbolAssetVersionId: exact.symbolAssetVersionId,
      footprintAssetVersionId: exact.footprintAssetVersionId,
      mappingCertificateId: exact.mappingCertificateId,
      ...(exact.selectionRecordId !== undefined ? { selectionRecordId: exact.selectionRecordId } : {}),
    };
    const impact: ReplacementImpactSummary = {
      mode: planned.plan.mode,
      mappingEvidence: "exact-pin-identity+certificate",
      pinMapping: planned.plan.pinMapping,
      preservedConnections: planned.plan.preservedConnections,
      droppedConnections: planned.plan.droppedConnections,
      wireEndpointMoves: planned.plan.wireEndpointMoves,
      netLabelMoves: planned.plan.netLabelMoves,
      downstream: planned.plan.downstream,
      warnings: planned.plan.warnings,
    };
    const proposal = sealReplacementProposal({
      state,
      scope: input.scope,
      authorization: input.authorization,
      componentInstanceId: componentId,
      expectedCurrentPartId: instance.partId,
      target: targetIdentity,
      operation: planned.operation,
      impact,
      authorityResource: { resourceId: authorityEnvelope.resourceId, contentDigest: authorityEnvelope.contentDigest },
      canonicalResource: { resourceId: bundle.canonicalState.resourceId, contentDigest: bundle.canonicalState.contentDigest },
      resourceManifestDigest: bundle.manifestDigest,
      consumedAuthorityDigest: consumedAuthorityDigestFor(grant.consumedResources),
      provenance: input.provenance,
      now: input.now,
    });
    if (input.retainGrant) {
      retained = true;
      input.retainGrant(grant.grantId);
    }
    return { kind: "sealed", proposal };
  } finally {
    // The PROPOSAL path never leaves a live runtime capability behind: the
    // sealed artifact carries only the deterministic registry-handle string.
    // [B14 §E] apply-time recompilation RETAINS the fresh grant instead —
    // the caller then owns retirement on every terminal path.
    if (!retained) retireReplacementAuthorityGrant(grant.grantId);
  }
}
