/** Bounded, monotonic multilayer FreeRouting completion endpoint. */

import type { PcbBoard } from "@/app/lib/pcb/types";
import { createFreeroutingPassExecutor, trackKey, viaKey } from "@/app/lib/pcb/autoroute/freerouting-pass-executor";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { resolveFreeroutingRuntime } from "@/app/lib/pcb/autoroute/runtime";
import {
  AUTOROUTE_COMPLETION_DEFAULTS,
  completeAutoroute,
} from "@/app/lib/pcb/autoroute/completion";
import { writeAutorouteDebugBundle } from "@/app/lib/pcb/autoroute/debug-bundle";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { randomUUID } from "crypto";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import type { DrcPresetId } from "@/app/lib/pcb/drc/types";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { evaluatePcbFabricationReadiness } from "@/app/lib/pcb/readiness/evaluate";

export const runtime = "nodejs";
export const maxDuration = 300;

function isBoardLike(value: unknown): value is PcbBoard {
  if (typeof value !== "object" || value === null) return false;
  const board = value as Record<string, unknown>;
  return Array.isArray(board.nets) && Array.isArray(board.footprints) && Array.isArray(board.tracks) &&
    Array.isArray(board.vias) && (board.stackup === 2 || board.stackup === 4) &&
    typeof board.outline === "object" && board.outline !== null;
}

function isNetlistLike(value: unknown): value is PcbNetlist {
  return typeof value === "object" && value !== null &&
    Array.isArray((value as PcbNetlist).components) && Array.isArray((value as PcbNetlist).nets);
}

function isPositive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function addedItemCount<T>(base: T[], candidate: T[], key: (item: T) => string): number {
  const remaining = new Map<string, number>();
  for (const item of base) remaining.set(key(item), (remaining.get(key(item)) ?? 0) + 1);
  let added = 0;
  for (const item of candidate) {
    const itemKey = key(item);
    const count = remaining.get(itemKey) ?? 0;
    if (count > 0) remaining.set(itemKey, count - 1);
    else added += 1;
  }
  return added;
}

/** [B16.0.2 §A/§D] a whole PcbBoard + netlist travels in the body. */
const AUTOROUTE_MAX_BODY_BYTES = 16_000_000;
const AUTOROUTE_BODY_DEADLINE_MS = 60_000;

// [B16.0.13] canonical wrapper — freerouting is an external (java) process on
// caller-supplied data: the wrapper runs authenticated membership + role +
// CSRF and the bounded total-settlement read BEFORE the callback, so no
// process can spawn until every boundary succeeds. The callback receives ONLY
// the wrapper-projected AbortSignal (exposeAbortSignal) for cancellation.
export const POST = authenticatedJsonRoute({ maxBytes: AUTOROUTE_MAX_BODY_BYTES, deadlineMs: AUTOROUTE_BODY_DEADLINE_MS, exposeAbortSignal: true }, async ({ body: rawBody, signal }): Promise<Response> => {
  const body = rawBody as {
    board?: unknown;
    maxPasses?: unknown;
    timeoutMs?: unknown;
    netIds?: unknown;
    maxCompletionPasses?: unknown;
    maxSelectedNetRetries?: unknown;
    maxNoImprovementPasses?: unknown;
    netlist?: unknown;
    fabPresetId?: unknown;
    sourceRevision?: unknown;
  };
  if (!isBoardLike(body.board)) {
    return Response.json({ ok: false, error: "body.board must be a PcbBoard" }, { status: 400 });
  }
  if (body.netlist !== undefined && !isNetlistLike(body.netlist)) {
    return Response.json({ ok: false, error: "body.netlist must be a PcbNetlist" }, { status: 400 });
  }
  for (const [name, value] of [
    ["maxPasses", body.maxPasses],
    ["timeoutMs", body.timeoutMs],
    ["maxCompletionPasses", body.maxCompletionPasses],
    ["maxSelectedNetRetries", body.maxSelectedNetRetries],
    ["maxNoImprovementPasses", body.maxNoImprovementPasses],
  ] as const) {
    if (value !== undefined && !isPositive(value)) {
      return Response.json({ ok: false, error: `${name} must be a positive number` }, { status: 400 });
    }
  }
  if (body.netIds !== undefined &&
    (!Array.isArray(body.netIds) || body.netIds.length === 0 || body.netIds.some((id) => !Number.isInteger(id) || (id as number) <= 0))) {
    return Response.json({ ok: false, error: "netIds must be a non-empty array of positive integer net ids" }, { status: 400 });
  }

  const board = body.board;
  const sourceRevision = pcbRevisionId(board);
  if (body.sourceRevision !== undefined && body.sourceRevision !== sourceRevision) {
    return Response.json({ ok: false, error: "sourceRevision does not match the submitted PCB semantic revision" }, { status: 409 });
  }
  const netIds = body.netIds as number[] | undefined;
  if (netIds?.some((id) => !board.nets.some((net) => net.id === id))) {
    return Response.json({ ok: false, error: "netIds contains a net that is not on this board" }, { status: 400 });
  }
  const runtimeInfo = await resolveFreeroutingRuntime();
  const jobId = randomUUID();
  if (!runtimeInfo.ok) {
    return Response.json({
      ok: false,
      error: runtimeInfo.error,
      stderr: runtimeInfo.stderr,
      job: { id: jobId, status: "failed" },
    }, { status: 500 });
  }

  const totalTimeoutMs = Math.min(290_000, Math.round(body.timeoutMs as number | undefined ?? 280_000));
  const deadline = Date.now() + totalTimeoutMs;
  // [B17-F] the SAME pass executor the agent's routing proposal uses (shared service).
  const executor = createFreeroutingPassExecutor({ runtimeInfo, deadline, signal: signal! });

  let drcPreset;
  try {
    drcPreset = getPreset((typeof body.fabPresetId === "string"
      ? body.fabPresetId
      : board.stackup === 4 ? "jlcpcb-4l" : "jlcpcb-2l") as DrcPresetId);
  } catch {
    return Response.json({ ok: false, error: "unknown fabPresetId" }, { status: 400 });
  }
  const fabPreset = getFabPreset(drcPreset.id);
  const rules = drcPreset.rules;
  const completion = await completeAutoroute(board, rules, executor, {
    attemptNamespace: jobId,
    selectedNetIds: netIds,
    maxGlobalPasses: body.maxCompletionPasses as number | undefined,
    maxSelectedNetRetries: body.maxSelectedNetRetries as number | undefined,
    maxNoImprovementPasses: body.maxNoImprovementPasses as number | undefined,
    baseEnginePasses: body.maxPasses as number | undefined,
  });
  const readiness = evaluatePcbFabricationReadiness({
    board: completion.candidate,
    netlist: isNetlistLike(body.netlist) ? body.netlist : undefined,
    fabPreset,
    drcPreset,
  });

  if (completion.engineError && completion.acceptedPasses === 0 && completion.passes.length === 1) {
    return Response.json({
      ok: false,
      error: completion.engineError,
      stderr: completion.lastAttempt?.stderr?.slice(-4000) || undefined,
      job: { id: jobId, status: "failed" },
      completion: { passes: completion.passes, failures: completion.failures },
    }, { status: completion.engineError === "DSN preflight failed" || completion.engineError.startsWith("DSN input refused: ") ? 422 : 500 });
  }

  let debugArtifactId: string | undefined;
  const acceptedArtifact = completion.bestAcceptedAttempt;
  if (acceptedArtifact?.dsnText && acceptedArtifact.sesText && acceptedArtifact.parsed && acceptedArtifact.validation) {
    try {
      await writeAutorouteDebugBundle({
        jobId,
        routeAttemptId: acceptedArtifact.routeAttemptId,
        sourceRevision: acceptedArtifact.sourceRevision,
        candidateRevision: acceptedArtifact.candidateRevision ?? completion.verification.designRevision,
        inputBoard: board,
        candidateBoard: completion.candidate,
        dsnText: acceptedArtifact.dsnText,
        sesText: acceptedArtifact.sesText,
        freeroutingLog: acceptedArtifact.stderr ?? "",
        validation: acceptedArtifact.validation,
        parsed: acceptedArtifact.parsed,
        verification: completion.verification,
        readiness,
        elapsedMs: completion.totalElapsedMs,
        attempts: completion.attempts,
      });
      debugArtifactId = jobId;
    } catch {
      // Diagnostics cannot invalidate a verified route candidate.
    }
  }

  return Response.json({
    ok: true,
    sourceRevision,
    candidateRevision: completion.verification.designRevision,
    routeAttemptId: acceptedArtifact?.routeAttemptId,
    sesText: acceptedArtifact?.sesText ?? "",
    routes: { tracks: completion.candidate.tracks, vias: completion.candidate.vias },
    job: { id: jobId, status: completion.status === "complete" ? "complete" : "partial" },
    validation: acceptedArtifact?.validation,
    verification: completion.verification,
    readiness,
    completion: {
      status: completion.status,
      acceptedPasses: completion.acceptedPasses,
      passes: completion.passes,
      attempts: completion.attempts.map((attempt) => ({
        routeAttemptId: attempt.routeAttemptId,
        pass: attempt.pass,
        sourceRevision: attempt.sourceRevision,
        reportedSourceRevision: attempt.reportedSourceRevision,
        reportedRouteAttemptId: attempt.reportedRouteAttemptId,
        candidateRevision: attempt.candidateRevision,
        phase: attempt.phase,
        accepted: attempt.accepted,
        error: attempt.error,
        elapsedMs: attempt.elapsedMs,
        targetNetIds: attempt.targetNetIds,
        effort: attempt.effort,
        engineMaxPasses: attempt.engineMaxPasses,
        evidence: attempt.evidence,
        connectivityBefore: attempt.connectivityBefore,
        connectivityAfter: attempt.connectivityAfter,
        drcBefore: attempt.drcBefore,
        drcAfter: attempt.drcAfter,
        decision: attempt.decision,
        rejectionReasons: attempt.rejectionReasons,
        returnedCandidate: attempt.returnedCandidate,
      })),
      failures: completion.failures,
      routeability: completion.routeability,
      limits: {
        maxGlobalPasses: body.maxCompletionPasses ?? AUTOROUTE_COMPLETION_DEFAULTS.maxGlobalPasses,
        maxSelectedNetRetries: body.maxSelectedNetRetries ?? AUTOROUTE_COMPLETION_DEFAULTS.maxSelectedNetRetries,
        maxNoImprovementPasses: body.maxNoImprovementPasses ?? AUTOROUTE_COMPLETION_DEFAULTS.maxNoImprovementPasses,
      },
    },
    debugArtifactId,
    stats: {
      elapsedMs: completion.totalElapsedMs,
      tracksImported: addedItemCount(board.tracks, completion.candidate.tracks, trackKey),
      viasImported: addedItemCount(board.vias, completion.candidate.vias, viaKey),
      tracksReturned: completion.candidate.tracks.length,
      viasReturned: completion.candidate.vias.length,
      candidateRevision: completion.verification.designRevision,
      completedConnections: completion.verification.completedConnections,
      remainingConnections: completion.verification.remainingConnections,
      routeBlockingDrcErrors: completion.verification.routeBlockingDrcErrors,
      layerUsage: completion.verification.layerUsage,
    },
    engine: {
      name: "Freerouting",
      version: runtimeInfo.version,
      source: runtimeInfo.jarSource,
      runtime: runtimeInfo.javaSource,
      apiKeyRequired: false,
    },
  });
});
