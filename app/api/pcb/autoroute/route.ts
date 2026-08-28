/** Bounded, monotonic multilayer FreeRouting completion endpoint. */

import type { PcbBoard, Track, Via } from "@/app/lib/pcb/types";
import { boardToDsn, writeDsn } from "@/app/lib/pcb/dsn/write-dsn";
import { parseSes, SesImportError, type SesLayerUsage } from "@/app/lib/pcb/dsn/read-ses";
import { validateDsn } from "@/app/lib/pcb/dsn/preflight";
import { runFreerouting } from "@/app/lib/pcb/autoroute/runner";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { resolveFreeroutingRuntime } from "@/app/lib/pcb/autoroute/runtime";
import { buildAutorouteCandidate } from "@/app/lib/pcb/autoroute/verification";
import {
  AUTOROUTE_COMPLETION_DEFAULTS,
  completeAutoroute,
  type AutoroutePassExecutor,
} from "@/app/lib/pcb/autoroute/completion";
import { writeAutorouteDebugBundle } from "@/app/lib/pcb/autoroute/debug-bundle";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { getBoardStackup } from "@/app/lib/pcb/stackup";
import type { LayerId } from "@/app/lib/pcb/layers";
import { createHash, randomUUID } from "crypto";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import type { DsnBoard } from "@/app/lib/pcb/dsn/types";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import type { DrcPresetId } from "@/app/lib/pcb/drc/types";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { evaluatePcbFabricationReadiness } from "@/app/lib/pcb/readiness/evaluate";
import { viaSpannedLayers } from "@/app/lib/pcb/geometry-copper";
import { zoneFillIsCurrent } from "@/app/lib/pcb/zones/fill-lifecycle";
import { refillZoneFillsAtomically } from "@/app/lib/pcb/zones/fill-lifecycle";

export const runtime = "nodejs";
export const maxDuration = 300;

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

function generatedCopper(item: Track | Via): boolean {
  return item.locked !== true && (item.source === "ai" || item.source === "autorouter");
}

function trackKey(track: Track): string {
  const a = `${track.start.x},${track.start.y}`;
  const b = `${track.end.x},${track.end.y}`;
  return `${track.netId}|${track.layer}|${track.width}|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
}

function viaKey(via: Via): string {
  return `${via.netId}|${via.at.x},${via.at.y}|${via.size}|${via.drill}|${via.layers.join("|")}`;
}

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

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

function preserveProtectedCopper(base: PcbBoard, candidate: PcbBoard): PcbBoard {
  const protectedTracks = base.tracks.filter((track) => !generatedCopper(track));
  const protectedVias = base.vias.filter((via) => !generatedCopper(via));
  const protectedTrackKeys = new Set(protectedTracks.map(trackKey));
  const protectedViaKeys = new Set(protectedVias.map(viaKey));
  return refillZoneFillsAtomically({
    // Engine-only routing preferences must never leak into the accepted board.
    // Only the candidate copper is projected onto the exact pass source board.
    ...base,
    tracks: [
      ...candidate.tracks.filter((track) => !protectedTrackKeys.has(trackKey(track))),
      ...protectedTracks.map((track) => ({ ...track, start: { ...track.start }, end: { ...track.end } })),
    ],
    vias: [
      ...candidate.vias.filter((via) => !protectedViaKeys.has(viaKey(via))),
      ...protectedVias.map((via) => ({ ...via, at: { ...via.at }, layers: [...via.layers] as [LayerId, LayerId] })),
    ],
  });
}

function highEffortRoutingBoard(board: PcbBoard, targetNetIds: number[] | undefined, passIndex: number): PcbBoard {
  const targets = targetNetIds ? new Set(targetNetIds) : undefined;
  const stackup = getBoardStackup(board);
  return {
    ...board,
    tracks: targets
      ? board.tracks.filter((track) => !targets.has(track.netId) || !generatedCopper(track))
      : board.tracks,
    vias: targets
      ? board.vias.filter((via) => !targets.has(via.netId) || !generatedCopper(via))
      : board.vias,
    stackupConfig: {
      ...stackup,
      copperLayers: stackup.copperLayers.map((layer) => ({ ...layer })),
      routing: {
        ...stackup.routing,
        viasAllowed: true,
        fanout: true,
        postroute: true,
        viaCost: Math.max(20, stackup.routing.viaCost - passIndex * 5),
        startRipupCost: Math.max(25, Math.round(stackup.routing.startRipupCost / Math.max(1, passIndex))),
      },
    },
  };
}

function layerUsageForBoard(board: PcbBoard): Partial<Record<LayerId, SesLayerUsage>> {
  const usage: Partial<Record<LayerId, SesLayerUsage>> = {};
  for (const track of board.tracks) {
    const current = usage[track.layer] ?? { segments: 0, trackLengthNm: 0 };
    current.segments += 1;
    current.trackLengthNm += Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y);
    usage[track.layer] = current;
  }
  for (const layer of getBoardStackup(board).copperLayers.filter((candidate) => candidate.enabled)) {
    const current = usage[layer.id] ?? { segments: 0, trackLengthNm: 0 };
    const zones = board.zones.filter((zone) => zone.layer === layer.id);
    const currentZones = zones.filter((zone) => zoneFillIsCurrent(board, zone));
    current.viaAccessCount = board.vias.filter((via) => viaSpannedLayers(via).includes(layer.id)).length;
    current.filledAreaNm2 = currentZones.flatMap((zone) => zone.fill).reduce((sum, region) => sum + region.areaNm2, 0);
    current.zoneIds = zones.map((zone) => zone.id).sort();
    current.stableNetIds = [...new Set(currentZones.map((zone) => board.nets.find((net) => net.id === zone.netId)?.stableId).filter((id): id is string => Boolean(id)))].sort();
    current.fillStatuses = zones.map((zone) => zone.fillState?.status ?? "legacy-unproven").sort();
    usage[layer.id] = current;
  }
  return usage;
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
  const executor: AutoroutePassExecutor = async (pass) => {
    const routerEvidence = {
      engine: "Freerouting" as const,
      version: runtimeInfo.version,
      runtime: runtimeInfo.javaSource,
      commandProfile: "headless-offline-cli" as const,
      maxPasses: pass.engineMaxPasses,
      timeoutMs: Math.max(1, deadline - Date.now()),
    };
    if (signal!.aborted) return {
      ok: false,
      routeAttemptId: pass.routeAttemptId,
      authoritativeSourceRevision: pass.requestedSourceRevision,
      sourceRevision: pass.requestedSourceRevision,
      error: "cancelled",
      elapsedMs: 0,
      evidence: { router: routerEvidence, processStatus: "cancelled", outputFileStatus: "not-checked", parserStatus: "not-run", semanticStatus: "not-run" },
    };
    const routingBoard = highEffortRoutingBoard(pass.board, pass.targetNetIds, pass.passIndex);
    let dsnText: string;
    let dsn: DsnBoard;
    let validation;
    try {
      dsn = boardToDsn(routingBoard, { includeNetIds: pass.targetNetIds });
      dsnText = writeDsn(dsn);
      validation = validateDsn(routingBoard, dsn);
      if (!validation.ok) return {
        ok: false,
        routeAttemptId: pass.routeAttemptId,
        authoritativeSourceRevision: pass.requestedSourceRevision,
        sourceRevision: dsn.integrity?.sourceRevision,
        phase: "file",
        error: "DSN preflight failed",
        elapsedMs: 0,
        validation,
        dsnText,
        evidence: { dsnDigest: sha256(dsnText), dsnSourceRevision: dsn.integrity?.sourceRevision, router: routerEvidence, processStatus: "not-started", outputFileStatus: "not-checked", parserStatus: "not-run", semanticStatus: "not-run" },
      };
    } catch (error) {
      return {
        ok: false,
        routeAttemptId: pass.routeAttemptId,
        authoritativeSourceRevision: pass.requestedSourceRevision,
        sourceRevision: pass.requestedSourceRevision,
        phase: "file",
        error: `DSN generation failed: ${errMsg(error)}`,
        elapsedMs: 0,
        evidence: { router: routerEvidence, processStatus: "not-started", outputFileStatus: "not-checked", parserStatus: "not-run", semanticStatus: "not-run" },
      };
    }
    const remainingMs = Math.max(1, deadline - Date.now());
    if (remainingMs <= 1) return {
      ok: false,
      routeAttemptId: pass.routeAttemptId,
      authoritativeSourceRevision: pass.requestedSourceRevision,
      sourceRevision: pass.requestedSourceRevision,
      error: "timeout",
      elapsedMs: 0,
      dsnText,
      validation,
      evidence: { dsnDigest: sha256(dsnText), dsnSourceRevision: dsn.integrity?.sourceRevision, router: routerEvidence, processStatus: "timeout", outputFileStatus: "not-checked", parserStatus: "not-run", semanticStatus: "not-run" },
    };
    const result = await runFreerouting({
      dsnText,
      freeroutingJarPath: runtimeInfo.jarPath,
      javaPath: runtimeInfo.javaPath,
      maxPasses: pass.engineMaxPasses,
      timeoutMs: remainingMs,
      signal: signal!,
    });
    const processEvidence = {
      dsnDigest: sha256(dsnText),
      dsnSourceRevision: dsn.integrity?.sourceRevision,
      router: { ...routerEvidence, timeoutMs: remainingMs },
      processStatus: result.processStatus,
      outputFileStatus: result.outputFileStatus,
      parserStatus: "not-run" as const,
      semanticStatus: "not-run" as const,
    };
    if (!result.ok) return {
      ok: false,
      routeAttemptId: pass.routeAttemptId,
      authoritativeSourceRevision: pass.requestedSourceRevision,
      sourceRevision: dsn.integrity?.sourceRevision,
      phase: result.error === "output-empty" ? "file" : "process",
      error: result.error,
      stderr: result.stderr,
      elapsedMs: result.elapsedMs,
      dsnText,
      validation,
      evidence: processEvidence,
    };
    const sesByteLength = result.sesByteLength ?? Buffer.byteLength(result.sesText, "utf8");
    const successfulProcessEvidence = {
      dsnDigest: sha256(dsnText),
      dsnSourceRevision: dsn.integrity?.sourceRevision,
      router: { ...routerEvidence, timeoutMs: remainingMs },
      processStatus: result.processStatus,
      outputFileStatus: result.outputFileStatus,
      sesDigest: sha256(result.sesText),
      sesByteLength,
    };
    try {
      const parsed = parseSes(result.sesText, routingBoard, {
        manifest: dsn.integrity,
        routeAttemptId: pass.routeAttemptId,
        sourceRevision: dsn.integrity?.sourceRevision,
      });
      const routedCandidate = buildAutorouteCandidate(routingBoard, parsed);
      const candidate = preserveProtectedCopper(pass.board, routedCandidate);
      return {
        ok: true,
        routeAttemptId: pass.routeAttemptId,
        authoritativeSourceRevision: pass.requestedSourceRevision,
        sourceRevision: parsed.sourceRevision,
        candidateRevision: pcbRevisionId(candidate),
        phase: "candidate",
        candidate,
        sesText: result.sesText,
        dsnText,
        stderr: result.stderr,
        elapsedMs: result.elapsedMs,
        layerUsage: layerUsageForBoard(candidate),
        validation,
        parsed,
        evidence: {
          ...successfulProcessEvidence,
          parserStatus: "success",
          semanticStatus: "success",
          importedTrackCount: parsed.tracks.length,
          importedViaCount: parsed.vias.length,
        },
      };
    } catch (error) {
      return {
        ok: false,
        routeAttemptId: pass.routeAttemptId,
        authoritativeSourceRevision: pass.requestedSourceRevision,
        sourceRevision: dsn.integrity?.sourceRevision,
        phase: error instanceof SesImportError ? error.result.phase === "file" ? "file" : "parse" : "parse",
        error: `SES import rejected: ${errMsg(error)}`,
        stderr: result.stderr,
        elapsedMs: result.elapsedMs,
        dsnText,
        sesText: result.sesText,
        validation,
        parsed: error instanceof SesImportError ? error.result : undefined,
        evidence: {
          ...successfulProcessEvidence,
          parserStatus: "rejected",
          semanticStatus: "rejected",
          importedTrackCount: 0,
          importedViaCount: 0,
        },
      };
    }
  };

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
    }, { status: completion.engineError === "DSN preflight failed" ? 422 : 500 });
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
