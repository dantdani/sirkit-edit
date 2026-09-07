/**
 * POST /api/pcb/qualify
 *
 * Server-owned autonomous placement + routing qualification (RC01/RC02/RC03)
 * over the DURABLE authoritative board, followed by persistence of the exact
 * ManufacturingReleaseAuthority the MFG01 release gate will reload.
 *
 * The client supplies only scope identifiers — never board content. The board
 * is loaded from the durable repository, qualified with the bundled
 * FreeRouting runtime through the production executor, and the selected
 * verified candidate is committed back durably. Failure at any gate leaves the
 * authoritative board untouched and returns bounded blocking evidence.
 *
 * [B16.1C §D] Qualification authority, corrected against the pre-edit probes:
 *  - package class, footprint, and pin-mapping authority come ONLY from the
 *    server-owned physical-binding records the synchronization committed
 *    (`resolveQualificationComponentAuthority`); the former regex guess over
 *    the footprint id is gone and missing/unapproved authority fails closed;
 *  - the routed board is published with the board's CURRENT durable aggregate
 *    revision (compare-and-swap), never a literal;
 *  - rc01/rc02/rc03 digests hash the actual parity certificate, route
 *    evidence, and capability evaluation; the component-authority facets are
 *    digests of the exact tuples; the schematic identity is the last applied
 *    synchronization snapshot;
 *  - re-qualifying the ALREADY qualified board is idempotent (no router run);
 *    a concurrent qualification of the same board is refused (409);
 *  - every failure is a bounded public envelope with a correlation id; raw
 *    exceptions go only to the redacted server trace.
 */

import { boardToSourceNetlist } from "@/app/lib/pcb/board-netlist";
import { AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1, evaluateAutonomousCapability } from "@/app/lib/pcb/autonomous/capability-profile";
import type { AutonomousDesignDeclaration } from "@/app/lib/pcb/autonomous/capability-profile";
import { createAutonomousRouteExecutor } from "@/app/lib/pcb/autonomous/production-router";
import { qualifyAutonomousLayout } from "@/app/lib/pcb/autonomous/qualify-layout";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { fitOutlineCandidates, withResizedOutline } from "@/app/lib/pcb/autoplace/fit-outline";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { DurableManufacturingAuthorityStore } from "@/app/lib/pcb/fab/authority-store";
import { authoritativeBoardDigest, manufacturingComponentAuthorityDigest, type ManufacturingReleaseAuthority } from "@/app/lib/pcb/fab/release-gate";
import { manufacturingRuleProfileDigest, type ManufacturingRuleProfile } from "@/app/lib/pcb/fab/release-manifest";
import { boundedManufacturingFailure, manufacturingRefusal } from "@/app/lib/pcb/fab/manufacturing-errors";
import { resolveQualificationComponentAuthority, type QualificationComponentAuthority } from "@/app/lib/pcb/fab/qualification-authority";
import { rc01ParityEvidenceDigest, rc02RouteEvidence, rc02RouteEvidenceDigest, rc03CapabilityEvidenceDigest, type SchematicAuthorityIdentity } from "@/app/lib/pcb/fab/qualification-evidence";
import { buildSchematicParityCertificate } from "@/app/lib/pcb/readiness/parity";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { mmToNm } from "@/app/lib/pcb/units";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { PCB_SYNC_API_MAX_BYTES, PCB_SYNC_API_DEADLINE_MS, pcbSyncScopeFromContext, pcbSyncForbiddenAuthorityRefusal, type PcbSyncApiScope } from "../../pcb-sync/_scope";
import { stage3BindingRepository, stage3Repository } from "../../pcb-sync/route";

export const runtime = "nodejs";
export const maxDuration = 300;

/** The ONE fabrication profile this release path has actually placed, routed,
 *  released, and independently verified: JLCPCB economy two-layer rigid FR-4,
 *  bare board. No other preset is releasable (the release gate structurally
 *  refuses non-two-layer profiles). */
export const QUALIFIED_FABRICATION_PROFILE_ID = "jlcpcb-2l" as const;
/** Official capability page the profile limits were re-verified against (B16.1C §D). */
export const QUALIFIED_FABRICATION_PROFILE_EVIDENCE = Object.freeze({ sourceRef: "https://jlcpcb.com/capabilities/pcb-capabilities", verifiedAt: "2026-09-07" });

/** Conservative JLCPCB-style two-layer rigid prototype profile (bare board). */
export function bareBoardRuleProfile(): ManufacturingRuleProfile {
  const drc = getPreset(QUALIFIED_FABRICATION_PROFILE_ID);
  const content: Omit<ManufacturingRuleProfile, "digest"> = {
    schemaVersion: "sirkit.manufacturing-rule-profile.v1",
    profileId: getFabPreset(QUALIFIED_FABRICATION_PROFILE_ID).id,
    version: 1,
    manufacturer: "JLCPCB",
    processName: "Economy rigid two-layer PTH prototype",
    evidence: { ...QUALIFIED_FABRICATION_PROFILE_EVIDENCE },
    construction: { copperLayers: 2, copperThicknessUm: 35, boardThicknessMm: 1.6, material: "FR-4", maxBoardWidthMm: 100, maxBoardHeightMm: 80 },
    limitsNm: {
      minTraceWidth: drc.rules.default.minTrackWidthNm,
      minSpace: drc.rules.default.clearanceNm,
      minDrill: drc.rules.default.minViaDrillNm,
      minFinishedHole: drc.rules.default.minViaDrillNm,
      minAnnularRing: drc.rules.default.minAnnularRingNm,
      minCopperToEdge: drc.rules.default.minEdgeClearanceNm,
      minHoleToEdge: drc.rules.default.minEdgeClearanceNm,
      solderMaskExpansion: mmToNm(0.05),
      minSolderMaskSliver: mmToNm(0.1),
      minSilkscreenWidth: mmToNm(0.15),
      minSilkscreenClearance: drc.rules.default.minSilkPadClearanceNm,
    },
    maskPolicy: { componentPads: "explicit_or_profile_opening", defaultViaTenting: "tented" },
    specialFeatures: { slots: "unsupported", castellations: "unsupported", edgePlating: "unsupported", flex: "unsupported" },
    assembly: { supported: false },
  };
  return { ...content, digest: manufacturingRuleProfileDigest(content) };
}

/**
 * Declaration for the qualified two-layer bare-board class. The footprint
 * qualifications are the SERVER-OWNED classes the binding authority earned —
 * nothing is asserted about a footprint the authority did not prove. The
 * risk classes are the profile's own declared envelope (ordinary low-speed
 * low-voltage rigid standard construction); the capability profile refuses
 * anything the board itself contradicts.
 */
function declarationFor(authority: QualificationComponentAuthority): AutonomousDesignDeclaration {
  return {
    schemaVersion: "sirkit.autonomous-design-declaration.v1",
    declarationId: "declaration:sirkit-bare-two-layer",
    revision: authority.digest,
    electricalClass: "ordinary_low_speed_low_voltage",
    currentThermalClass: "ordinary",
    construction: "rigid_standard",
    safetyClass: "ordinary",
    criticalPlacement: { status: "none", constraintIds: [] },
    footprintQualifications: structuredClone(authority.footprintQualifications),
  };
}

/** [B16.1C] one qualification per board at a time — a concurrent second call is refused, never a second router run. */
const inFlight = new Map<string, Promise<Response>>();

// [B16.0.15 §B] canonical wrapper — the authenticated-release policy
// (pcb_editor | project_admin), same-origin CSRF, media-type, and the bounded
// 8 MB/30 s body read all run inside the wrapper BEFORE the callback, so no
// durable board load, capability evaluation, router creation, routing process,
// or authority persistence can begin until every boundary succeeds. The
// callback receives the trusted context and parsed body only — never the
// Request, URL, host, origin, or any client-provided identity/role.
export const POST = authenticatedJsonRoute({ maxBytes: PCB_SYNC_API_MAX_BYTES, deadlineMs: PCB_SYNC_API_DEADLINE_MS }, async ({ context, body }): Promise<Response> => {
  const forbidden = pcbSyncForbiddenAuthorityRefusal(body);
  if (forbidden) return forbidden;
  const scope = pcbSyncScopeFromContext(context);
  const correlationId = context.correlationId;
  const boardId = typeof body.boardId === "string" ? body.boardId : "";
  const designId = typeof body.designId === "string" ? body.designId : "";
  if (!boardId || !designId) return manufacturingRefusal("MFG_API_SCOPE_REQUIRED", { correlationId });
  const guardKey = `${scope.tenantId}\0${scope.projectId}\0${scope.branchId}\0${boardId}`;
  if (inFlight.has(guardKey)) return manufacturingRefusal("MFG_QUALIFICATION_IN_PROGRESS", { correlationId });
  const run = qualifyBoard({ scope, boardId, designId, seeds: Array.isArray(body.seeds) ? (body.seeds as number[]) : undefined, correlationId });
  inFlight.set(guardKey, run);
  try { return await run; } finally { inFlight.delete(guardKey); }
});

async function qualifyBoard(input: { scope: PcbSyncApiScope; boardId: string; designId: string; seeds?: number[]; correlationId: string }): Promise<Response> {
  const { scope, boardId, designId, correlationId } = input;
  const repositoryScope = { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardId };
  const authorityScope = { ...repositoryScope, designId };
  const noStore = { "Cache-Control": "no-store", "X-Sirkit-Correlation-Id": correlationId } as const;
  try {
    const head = await stage3Repository.getBoardHead(repositoryScope);
    if (!head) return manufacturingRefusal("MFG_AUTHORITATIVE_BOARD_NOT_FOUND", { correlationId });
    const sourceBoard = head.record.board;
    const sourceRevision = head.record.revision;

    // 1. Server-owned component/package authority — fail closed on any gap.
    const resolved = await resolveQualificationComponentAuthority({ board: sourceBoard, scope: repositoryScope, bindings: stage3BindingRepository });
    if (!resolved.ok) {
      const onlyUnsupported = resolved.blockers.every((item) => item.code === "QA_PACKAGE_UNSUPPORTED");
      return manufacturingRefusal(onlyUnsupported ? "MFG_PACKAGE_AUTHORITY_UNSUPPORTED" : "MFG_COMPONENT_AUTHORITY_INCOMPLETE", { correlationId, extra: { blockers: resolved.blockers } });
    }
    const componentAuthority = resolved.authority;

    // 2. The schematic identity the board was last synchronized from.
    const schematic = await schematicAuthorityFor(repositoryScope);
    if (!schematic) return manufacturingRefusal("MFG_SCHEMATIC_AUTHORITY_MISSING", { correlationId });

    // 3. Idempotency: the current board IS the already-qualified routed board.
    const store = new DurableManufacturingAuthorityStore(getDurableWorkflowRepository());
    const existing = await store.getHead(authorityScope);
    if (existing && existing.authority.boardRevision === sourceRevision && existing.authority.boardDigest === authoritativeBoardDigest(sourceBoard) && existing.authority.qualificationAuthority?.digest === componentAuthority.digest && existing.authority.schematic.digest === schematic.digest) {
      return Response.json(summarize(existing.authority, existing.revision, existing.recordDigest, { idempotent: true, runId: null, selectedCandidateId: null }), { headers: noStore });
    }

    const rules = getPreset(QUALIFIED_FABRICATION_PROFILE_ID).rules;
    const declaration = declarationFor(componentAuthority);

    // Pre-flight capability screen so an ineligible design reports precisely
    // why instead of consuming a routing budget.
    const eligibility = evaluateAutonomousCapability({ board: sourceBoard, rules, declaration, phase: "pre_placement" });
    if (!eligibility.placementMayStart) {
      return manufacturingRefusal("MFG_AUTONOMOUS_INELIGIBLE", { correlationId, extra: { blockers: eligibility.blockers, evaluationDigest: eligibility.evaluationDigest } });
    }

    const router = await createAutonomousRouteExecutor({ attemptNamespacePrefix: "e2e" });
    let committed: typeof head.record | null = null;

    // Size the board to the design instead of releasing on the profile-maximum
    // default panel. Candidates are tried smallest-first and the ORIGINAL
    // outline is the final fallback, so a compact board is only ever used when
    // it hosts a fully legal, routed, verified layout.
    const outlineAttempts: Array<{ board: PcbBoard; label: string }> = [
      ...fitOutlineCandidates(sourceBoard, { maxWidthNm: AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.limits.maxBoardWidthNm, maxHeightNm: AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.limits.maxBoardHeightNm })
        .map((candidate) => ({ board: withResizedOutline(sourceBoard, candidate.widthNm, candidate.heightNm), label: `fitted-${Math.round(candidate.widthNm / 1_000_000)}x${Math.round(candidate.heightNm / 1_000_000)}` })),
      { board: sourceBoard, label: "authoritative-default" },
    ];

    let result: Awaited<ReturnType<typeof qualifyAutonomousLayout>> | null = null;
    const outlineTrace: Array<{ label: string; status: string }> = [];
    for (const attempt of outlineAttempts) {
      const screen = evaluateAutonomousCapability({ board: attempt.board, rules, declaration, phase: "pre_placement" });
      if (!screen.placementMayStart) { outlineTrace.push({ label: attempt.label, status: "ineligible" }); continue; }
      committed = null;
      const candidateResult = await qualifyAutonomousLayout({
        board: attempt.board,
        rules,
        declaration,
        router,
        projectId: scope.projectId,
        seeds: input.seeds ?? [101, 202, 303],
        placementCandidateCount: 3,
        routedCandidateLimit: 2,
        maxRuntimeMs: 180_000,
        runLabel: `e2e-${boardId}-${attempt.label}`,
        commitSelected: async ({ board, selectedRevision }) => {
          const next = makeBoardRecord({ ...repositoryScope, board, updatedAt: new Date().toISOString() });
          if (next.revision !== selectedRevision) return { ok: false, committedRevision: next.revision, error: "Committed revision differs from the verified candidate." };
          // [B16.1C §D] compare-and-swap against the board's CURRENT durable
          // aggregate revision — a board re-synchronized or re-qualified
          // meanwhile is refused (MFG_BOARD_REVISION_CONFLICT), never overwritten.
          await stage3Repository.publishBoard(next, { expectedRevision: head.aggregateRevision, idempotencyKey: `qualify:${boardId}:${sourceRevision}->${next.revision}` });
          committed = next;
          return { ok: true, committedRevision: next.revision };
        },
      });
      outlineTrace.push({ label: attempt.label, status: candidateResult.status });
      if (candidateResult.status === "complete" && candidateResult.selectedBoard && committed) { result = candidateResult; break; }
    }
    if (!result || result.status !== "complete" || !result.selectedBoard || !result.selectedRevision || !result.finalCapability || !committed) {
      return manufacturingRefusal("MFG_AUTONOMOUS_QUALIFICATION_FAILED", { correlationId, extra: { outlineTrace, status: result?.status ?? "blocked", blockers: result?.blockers ?? [], attempts: result?.attempts?.map((item) => ({ candidateId: item.candidateId, decision: item.decision, rejectionReasons: item.rejectionReasons })) ?? [] } });
    }

    const board = result.selectedBoard;
    const boardRevision = result.selectedRevision;
    const boardDigest = authoritativeBoardDigest(board);
    const routedNetlist = boardToSourceNetlist(board);
    const parity = buildSchematicParityCertificate(board, boardRevision, routedNetlist);
    if (parity.state !== "pass") return manufacturingRefusal("MFG_RC01_PARITY_FAILED", { correlationId, extra: { diagnostics: parity.diagnostics } });
    const selectedAttempt = result.attempts.find((attempt) => attempt.candidateId === result.selectedCandidateId && attempt.decision === "complete");
    const routeEvidence = selectedAttempt ? rc02RouteEvidence(selectedAttempt) : null;
    if (!selectedAttempt?.route || !routeEvidence) return manufacturingRefusal("MFG_RC02_EVIDENCE_MISSING", { correlationId });

    const componentContent = {
      bindingRevision: componentAuthority.bindingRevision,
      footprintLibraryRevision: componentAuthority.footprintLibraryRevision,
      mappingRevision: componentAuthority.mappingRevision,
      policyRevision: componentAuthority.vocabularyVersion,
      assemblyVariantRevision: componentAuthority.assemblyVariantRevision,
    };
    const sourceDate = new Date().toISOString();
    const authority: ManufacturingReleaseAuthority = {
      schemaVersion: "sirkit.manufacturing-release-authority.v1",
      tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, designId, boardId,
      boardRevision, boardDigest, board, netlist: routedNetlist,
      schematic: { revision: schematic.revision, digest: schematic.digest },
      rc01: { state: "pass", evidenceId: `rc01:${boardRevision}`, digest: rc01ParityEvidenceDigest(parity), boardRevision },
      rc02: { state: "complete", evidenceId: `rc02:${boardRevision}:${routeEvidence.candidateId}`, digest: rc02RouteEvidenceDigest(routeEvidence), boardRevision, routePassIds: selectedAttempt.route.passIds, remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0 },
      rc03: { state: "complete", evidenceId: `rc03:${boardRevision}`, digest: rc03CapabilityEvidenceDigest(result.finalCapability), boardRevision, boardDigest, declaration, capabilityEvaluation: result.finalCapability },
      componentAuthority: { ...componentContent, digest: manufacturingComponentAuthorityDigest(componentContent) },
      qualificationAuthority: componentAuthority,
      schematicAuthority: schematic,
      fabPreset: getFabPreset(QUALIFIED_FABRICATION_PROFILE_ID), drcPreset: getPreset(QUALIFIED_FABRICATION_PROFILE_ID),
      manufacturingRuleProfile: bareBoardRuleProfile(),
      releaseMode: "bare_pcb", sourceDate, actor: scope.actor.actorId,
    };
    const saved = await store.save(authority, { idempotencyKey: `authority:${boardId}:${boardRevision}:${componentAuthority.digest}`, savedAt: sourceDate });
    return Response.json(summarize(authority, saved.revision, saved.recordDigest, { idempotent: false, runId: result.runId, selectedCandidateId: result.selectedCandidateId ?? null }), { headers: noStore });
  } catch (error) {
    return boundedManufacturingFailure(error, "qualify", correlationId);
  }
}

/** The schematic synchronization identity of the LAST committed apply for the board. */
async function schematicAuthorityFor(repositoryScope: { tenantId: string; projectId: string; branchId: string; boardId: string }): Promise<SchematicAuthorityIdentity | null> {
  const audits = await stage3Repository.listAudits(repositoryScope);
  const last = [...audits].reverse().find((audit) => audit.outcome === "committed");
  if (!last) return null;
  const plan = await stage3Repository.getPlan(repositoryScope, last.planId);
  if (!plan) return null;
  return { revision: plan.snapshot.schematicRevision, digest: plan.snapshot.schematicDigest, planId: plan.planId, snapshotDigest: plan.snapshot.snapshotDigest };
}

function summarize(authority: ManufacturingReleaseAuthority, authorityRevision: number, authorityDigest: string, run: { idempotent: boolean; runId: string | null; selectedCandidateId: string | null }) {
  return {
    ok: true,
    idempotent: run.idempotent,
    runId: run.runId,
    boardRevision: authority.boardRevision,
    boardDigest: authority.boardDigest,
    authorityRevision,
    authorityDigest,
    componentAuthorityDigest: authority.qualificationAuthority?.digest ?? authority.componentAuthority.digest,
    schematicRevision: authority.schematic.revision,
    schematicDigest: authority.schematic.digest,
    fabricationProfileId: authority.manufacturingRuleProfile.profileId,
    fabricationProfileDigest: authority.manufacturingRuleProfile.digest,
    qualifiedAt: authority.sourceDate,
    actor: authority.actor,
    rc01: { state: authority.rc01.state, digest: authority.rc01.digest },
    rc02: { remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0, routePassIds: authority.rc02.routePassIds, digest: authority.rc02.digest },
    rc03: { status: authority.rc03.capabilityEvaluation.status, profileId: authority.rc03.capabilityEvaluation.profileId, evaluationDigest: authority.rc03.capabilityEvaluation.evaluationDigest, digest: authority.rc03.digest, manufacturingReleaseMayEventuallyBeConsidered: authority.rc03.capabilityEvaluation.manufacturingReleaseMayEventuallyBeConsidered },
    selectedCandidateId: run.selectedCandidateId,
    pcbRevision: pcbRevisionId(authority.board),
  };
}
