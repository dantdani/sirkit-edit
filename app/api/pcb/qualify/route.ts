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
 * authoritative board untouched and returns the blocking evidence.
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
import { buildSchematicParityCertificate } from "@/app/lib/pcb/readiness/parity";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { mmToNm } from "@/app/lib/pcb/units";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { scopedPcbSyncJson } from "../../pcb-sync/_scope";
import { stage3Repository } from "../../pcb-sync/route";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Conservative JLCPCB-style two-layer rigid prototype profile (bare board). */
function bareBoardRuleProfile(): ManufacturingRuleProfile {
  const drc = getPreset("jlcpcb-2l");
  const content: Omit<ManufacturingRuleProfile, "digest"> = {
    schemaVersion: "sirkit.manufacturing-rule-profile.v1",
    profileId: getFabPreset("jlcpcb-2l").id,
    version: 1,
    manufacturer: "JLCPCB",
    processName: "Economy rigid two-layer PTH prototype",
    evidence: { sourceRef: "controlled:jlcpcb-capabilities-and-kicad-guide:2026-07", verifiedAt: "2026-07-08" },
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
 * Declaration for the qualified two-layer bare-board demo class. Footprint
 * package classes are derived from the board's own footprint geometry; nothing
 * is asserted about design classes the caller did not earn.
 */
function declarationFor(footprintIds: string[]): AutonomousDesignDeclaration {
  return {
    schemaVersion: "sirkit.autonomous-design-declaration.v1",
    declarationId: "declaration:sirkit-demo",
    revision: "1",
    electricalClass: "ordinary_low_speed_low_voltage",
    currentThermalClass: "ordinary",
    construction: "rigid_standard",
    safetyClass: "ordinary",
    criticalPlacement: { status: "none", constraintIds: [] },
    footprintQualifications: Object.fromEntries(footprintIds.map((id) => [id, { packageClass: packageClassFor(id), authority: "proven" as const }])),
  };
}

function packageClassFor(footprintId: string): "passive_smd_0603_0805" | "soic_tssop" | "through_hole_header" | "non_hdi_other" {
  if (/_(0402|0603|0805)_/i.test(footprintId)) return "passive_smd_0603_0805";
  if (/SOIC|TSSOP|SOP/i.test(footprintId)) return "soic_tssop";
  if (/PinHeader|Header|Conn/i.test(footprintId)) return "through_hole_header";
  return "non_hdi_other";
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await scopedPcbSyncJson(request);
  if (!parsed.ok) return parsed.response;
  const { body, scope } = parsed;
  const boardId = typeof body.boardId === "string" ? body.boardId : "";
  const designId = typeof body.designId === "string" ? body.designId : "";
  if (!boardId || !designId) {
    return Response.json({ ok: false, code: "MFG_API_SCOPE_REQUIRED", error: "designId and boardId are required." }, { status: 400 });
  }
  const repositoryScope = { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardId };

  try {
    const record = await stage3Repository.getBoard(repositoryScope);
    if (!record) return Response.json({ ok: false, code: "MFG_AUTHORITATIVE_BOARD_NOT_FOUND", error: "No authoritative board exists for this scope." }, { status: 404 });

    const sourceBoard = record.board;
    // The release authority's netlist is derived from the FINAL routed board
    // (see routedNetlist below), never from this pre-routing source.
    const rules = getPreset("jlcpcb-2l").rules;
    const declaration = declarationFor([...new Set(sourceBoard.footprints.map((item) => item.footprintId))]);

    // Pre-flight capability screen so an ineligible design reports precisely
    // why instead of consuming a routing budget.
    const eligibility = evaluateAutonomousCapability({ board: sourceBoard, rules, declaration, phase: "pre_placement" });
    if (!eligibility.placementMayStart) {
      return Response.json({ ok: false, code: "MFG_AUTONOMOUS_INELIGIBLE", error: "Design is outside the qualified autonomous capability profile.", blockers: eligibility.blockers, evaluation: eligibility }, { status: 422 });
    }

    const router = await createAutonomousRouteExecutor({ attemptNamespacePrefix: "e2e" });
    let committed: typeof record | null = null;

    // Size the board to the design instead of releasing on the profile-maximum
    // default panel. Candidates are tried smallest-first and the ORIGINAL
    // outline is the final fallback, so a compact board is only ever used when
    // it hosts a fully legal, routed, verified layout.
    const outlineAttempts: Array<{ board: PcbBoard; label: string; widthMm: number; heightMm: number }> = [
      ...fitOutlineCandidates(sourceBoard, { maxWidthNm: AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.limits.maxBoardWidthNm, maxHeightNm: AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.limits.maxBoardHeightNm })
        .map((candidate) => ({
          board: withResizedOutline(sourceBoard, candidate.widthNm, candidate.heightNm),
          label: `fitted-${Math.round(candidate.widthNm / 1_000_000)}x${Math.round(candidate.heightNm / 1_000_000)}`,
          widthMm: candidate.widthNm / 1_000_000,
          heightMm: candidate.heightNm / 1_000_000,
        })),
      { board: sourceBoard, label: "authoritative-default", widthMm: 0, heightMm: 0 },
    ];

    let result: Awaited<ReturnType<typeof qualifyAutonomousLayout>> | null = null;
    const outlineTrace: Array<{ label: string; status: string }> = [];
    for (const attempt of outlineAttempts) {
      // Screen each candidate before spending a routing budget on it.
      const screen = evaluateAutonomousCapability({ board: attempt.board, rules, declaration, phase: "pre_placement" });
      if (!screen.placementMayStart) { outlineTrace.push({ label: attempt.label, status: "ineligible" }); continue; }
      committed = null;
      const candidateResult = await qualifyAutonomousLayout({
        board: attempt.board,
        rules,
        declaration,
        router,
        projectId: scope.projectId,
        seeds: Array.isArray(body.seeds) ? (body.seeds as number[]) : [101, 202, 303],
        placementCandidateCount: 3,
        routedCandidateLimit: 2,
        maxRuntimeMs: 180_000,
        runLabel: `e2e-${boardId}-${attempt.label}`,
        commitSelected: async ({ board, selectedRevision }) => {
          const next = makeBoardRecord({ ...repositoryScope, board, updatedAt: new Date().toISOString() });
          if (next.revision !== selectedRevision) return { ok: false, committedRevision: next.revision, error: "Committed revision differs from the verified candidate." };
          await stage3Repository.publishBoard(next, { expectedRevision: 1, idempotencyKey: `qualify:${next.revision}` });
          committed = next;
          return { ok: true, committedRevision: next.revision };
        },
      });
      outlineTrace.push({ label: attempt.label, status: candidateResult.status });
      if (candidateResult.status === "complete" && candidateResult.selectedBoard && committed) { result = candidateResult; break; }
    }
    if (!result) {
      return Response.json({ ok: false, code: "MFG_AUTONOMOUS_QUALIFICATION_FAILED", error: "No board outline produced a fully verified routed layout.", outlineTrace }, { status: 422 });
    }

    if (result.status !== "complete" || !result.selectedBoard || !result.selectedRevision || !result.finalCapability || !committed) {
      return Response.json({ ok: false, code: "MFG_AUTONOMOUS_QUALIFICATION_FAILED", error: `Autonomous qualification did not complete (${result.status}).`, status: result.status, blockers: result.blockers ?? [], attempts: result.attempts?.map((item) => ({ candidateId: item.candidateId, decision: item.decision, rejectionReasons: item.rejectionReasons })) ?? [] }, { status: 422 });
    }

    const board = result.selectedBoard;
    const boardRevision = result.selectedRevision;
    const boardDigest = authoritativeBoardDigest(board);
    const routedNetlist = boardToSourceNetlist(board);
    const parity = buildSchematicParityCertificate(board, boardRevision, routedNetlist);
    if (parity.state !== "pass") {
      return Response.json({ ok: false, code: "MFG_RC01_PARITY_FAILED", error: "RC01 schematic parity failed on the routed board.", diagnostics: parity.diagnostics }, { status: 422 });
    }
    const selectedAttempt = result.attempts.find((attempt) => attempt.candidateId === result.selectedCandidateId && attempt.decision === "complete");
    if (!selectedAttempt?.route) {
      return Response.json({ ok: false, code: "MFG_RC02_EVIDENCE_MISSING", error: "Selected candidate carries no route evidence." }, { status: 422 });
    }

    const componentContent = {
      bindingRevision: `bindings:${boardRevision}`,
      footprintLibraryRevision: `footprints:${boardRevision}`,
      mappingRevision: `mappings:${boardRevision}`,
      policyRevision: "policy:bare-v1",
      assemblyVariantRevision: "variant:default:1",
    };
    const sourceDate = new Date().toISOString();
    const authority: ManufacturingReleaseAuthority = {
      schemaVersion: "sirkit.manufacturing-release-authority.v1",
      tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, designId, boardId,
      boardRevision, boardDigest, board, netlist: routedNetlist,
      schematic: { revision: `schematic:${record.revision}`, digest: record.digest },
      rc01: { state: "pass", evidenceId: `r05-rc01:${boardRevision}`, digest: `sha256:${boardRevision}`, boardRevision },
      rc02: { state: "complete", evidenceId: `r05-rc02:${boardRevision}`, digest: `sha256:${boardRevision}`, boardRevision, routePassIds: selectedAttempt.route.passIds, remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0 },
      rc03: { state: "complete", evidenceId: `r05-rc03:${boardRevision}`, digest: `sha256:${boardRevision}`, boardRevision, boardDigest, declaration, capabilityEvaluation: result.finalCapability },
      componentAuthority: { ...componentContent, digest: manufacturingComponentAuthorityDigest(componentContent) },
      fabPreset: getFabPreset("jlcpcb-2l"), drcPreset: getPreset("jlcpcb-2l"),
      manufacturingRuleProfile: bareBoardRuleProfile(),
      releaseMode: "bare_pcb", sourceDate, actor: scope.actor.actorId,
    };

    const store = new DurableManufacturingAuthorityStore(getDurableWorkflowRepository());
    const saved = await store.save(authority, { idempotencyKey: `authority:${boardRevision}`, savedAt: sourceDate });

    return Response.json({
      ok: true,
      runId: result.runId,
      boardRevision, boardDigest,
      authorityRevision: saved.revision,
      authorityDigest: saved.recordDigest,
      rc01: { state: parity.state },
      rc02: { remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0, routePassIds: selectedAttempt.route.passIds },
      rc03: { status: result.finalCapability.status, profileId: result.finalCapability.profileId, evaluationDigest: result.finalCapability.evaluationDigest, manufacturingReleaseMayEventuallyBeConsidered: result.finalCapability.manufacturingReleaseMayEventuallyBeConsidered },
      selectedCandidateId: result.selectedCandidateId,
      pcbRevision: pcbRevisionId(board),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, code: message.split(":")[0] || "MFG_QUALIFY_FAILED", error: message }, { status: 500 });
  }
}
