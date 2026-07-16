/** Bounded, monotonic multilayer FreeRouting completion endpoint. */

import type { PcbBoard, Track, Via } from "@/app/lib/pcb/types";
import { boardToDsn, writeDsn } from "@/app/lib/pcb/dsn/write-dsn";
import { parseSes, SesImportError, type SesLayerUsage } from "@/app/lib/pcb/dsn/read-ses";
import { validateDsn } from "@/app/lib/pcb/dsn/preflight";
import { runFreerouting } from "@/app/lib/pcb/autoroute/runner";
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
import { randomUUID } from "crypto";

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

function preserveProtectedCopper(base: PcbBoard, candidate: PcbBoard): PcbBoard {
  const protectedTracks = base.tracks.filter((track) => !generatedCopper(track));
  const protectedVias = base.vias.filter((via) => !generatedCopper(via));
  const protectedTrackKeys = new Set(protectedTracks.map(trackKey));
  const protectedViaKeys = new Set(protectedVias.map(viaKey));
  return {
    ...candidate,
    tracks: [
      ...candidate.tracks.filter((track) => !protectedTrackKeys.has(trackKey(track))),
      ...protectedTracks.map((track) => ({ ...track, start: { ...track.start }, end: { ...track.end } })),
    ],
    vias: [
      ...candidate.vias.filter((via) => !protectedViaKeys.has(viaKey(via))),
      ...protectedVias.map((via) => ({ ...via, at: { ...via.at }, layers: [...via.layers] as [LayerId, LayerId] })),
    ],
  };
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
  return usage;
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof raw !== "object" || raw === null) {
    return Response.json({ ok: false, error: "body must be an object" }, { status: 400 });
  }
  const body = raw as {
    board?: unknown;
    maxPasses?: unknown;
    timeoutMs?: unknown;
    netIds?: unknown;
    maxCompletionPasses?: unknown;
    maxSelectedNetRetries?: unknown;
    maxNoImprovementPasses?: unknown;
  };
  if (!isBoardLike(body.board)) {
    return Response.json({ ok: false, error: "body.board must be a PcbBoard" }, { status: 400 });
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
    if (request.signal.aborted) return { ok: false, error: "cancelled", elapsedMs: 0 };
    const routingBoard = highEffortRoutingBoard(pass.board, pass.targetNetIds, pass.passIndex);
    let dsnText: string;
    let validation;
    try {
      const dsn = boardToDsn(routingBoard, { includeNetIds: pass.targetNetIds });
      validation = validateDsn(routingBoard, dsn);
      if (!validation.ok) return { ok: false, error: "DSN preflight failed", elapsedMs: 0, validation };
      dsnText = writeDsn(dsn);
    } catch (error) {
      return { ok: false, error: `DSN generation failed: ${errMsg(error)}`, elapsedMs: 0 };
    }
    const remainingMs = Math.max(1, deadline - Date.now());
    if (remainingMs <= 1) return { ok: false, error: "timeout", elapsedMs: 0, dsnText, validation };
    const result = await runFreerouting({
      dsnText,
      freeroutingJarPath: runtimeInfo.jarPath,
      javaPath: runtimeInfo.javaPath,
      maxPasses: pass.engineMaxPasses,
      timeoutMs: remainingMs,
      signal: request.signal,
    });
    if (!result.ok) return {
      ok: false,
      error: result.error,
      stderr: result.stderr,
      elapsedMs: result.elapsedMs,
      dsnText,
      validation,
    };
    try {
      const parsed = parseSes(result.sesText, routingBoard);
      const routedCandidate = buildAutorouteCandidate(routingBoard, parsed);
      const candidate = preserveProtectedCopper(pass.board, routedCandidate);
      return {
        ok: true,
        candidate,
        sesText: result.sesText,
        dsnText,
        stderr: result.stderr,
        elapsedMs: result.elapsedMs,
        layerUsage: layerUsageForBoard(candidate),
        validation,
        parsed,
      };
    } catch (error) {
      return {
        ok: false,
        error: `SES import rejected: ${errMsg(error)}`,
        stderr: result.stderr,
        elapsedMs: result.elapsedMs,
        dsnText,
        sesText: result.sesText,
        validation,
        parsed: error instanceof SesImportError ? error.result : undefined,
      };
    }
  };

  const rules = getPreset(board.stackup === 4 ? "jlcpcb-4l" : "jlcpcb-2l").rules;
  const completion = await completeAutoroute(board, rules, executor, {
    selectedNetIds: netIds,
    maxGlobalPasses: body.maxCompletionPasses as number | undefined,
    maxSelectedNetRetries: body.maxSelectedNetRetries as number | undefined,
    maxNoImprovementPasses: body.maxNoImprovementPasses as number | undefined,
    baseEnginePasses: body.maxPasses as number | undefined,
  });

  if (completion.engineError && completion.acceptedPasses === 0 && completion.passes.length === 1) {
    return Response.json({
      ok: false,
      error: completion.engineError,
      stderr: completion.lastStderr?.slice(-4000) || undefined,
      job: { id: jobId, status: "failed" },
      completion: { passes: completion.passes, failures: completion.failures },
    }, { status: completion.engineError === "DSN preflight failed" ? 422 : 500 });
  }

  let debugDirectory: string | undefined;
  if (completion.lastDsnText && completion.lastSesText && completion.lastParsed && completion.lastValidation) {
    try {
      debugDirectory = await writeAutorouteDebugBundle({
        jobId,
        inputBoard: board,
        candidateBoard: completion.candidate,
        dsnText: completion.lastDsnText,
        sesText: completion.lastSesText,
        freeroutingLog: completion.lastStderr ?? "",
        validation: completion.lastValidation,
        parsed: completion.lastParsed,
        verification: completion.verification,
        elapsedMs: completion.totalElapsedMs,
      });
    } catch {
      // Diagnostics cannot invalidate a verified route candidate.
    }
  }

  return Response.json({
    ok: true,
    sesText: completion.lastSesText ?? "",
    routes: { tracks: completion.candidate.tracks, vias: completion.candidate.vias },
    job: { id: jobId, status: completion.status === "complete" ? "complete" : "partial" },
    validation: completion.lastValidation,
    verification: completion.verification,
    completion: {
      status: completion.status,
      acceptedPasses: completion.acceptedPasses,
      passes: completion.passes,
      failures: completion.failures,
      routeability: completion.routeability,
      limits: {
        maxGlobalPasses: body.maxCompletionPasses ?? AUTOROUTE_COMPLETION_DEFAULTS.maxGlobalPasses,
        maxSelectedNetRetries: body.maxSelectedNetRetries ?? AUTOROUTE_COMPLETION_DEFAULTS.maxSelectedNetRetries,
        maxNoImprovementPasses: body.maxNoImprovementPasses ?? AUTOROUTE_COMPLETION_DEFAULTS.maxNoImprovementPasses,
      },
    },
    debugDirectory,
    stats: {
      elapsedMs: completion.totalElapsedMs,
      tracksImported: completion.lastParsed?.tracks.length ?? 0,
      viasImported: completion.lastParsed?.vias.length ?? 0,
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
}
