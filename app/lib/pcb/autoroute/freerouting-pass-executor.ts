/**
 * [B17-F] The FreeRouting PASS EXECUTOR — one shared service for every caller
 * that routes a board through the local headless engine: the autoroute API
 * route (the editor's routing candidate) and the agent's routing proposal
 * (`sirkit.routing.propose`). Extracted verbatim from the route so both
 * paths produce identical, revision-bound pass artifacts.
 */
import { createHash } from "crypto";
import type { PcbBoard, Track, Via } from "../types";
import { boardToDsn, writeDsn } from "../dsn/write-dsn";
import { parseSes, SesImportError, type SesLayerUsage } from "../dsn/read-ses";
import { validateDsn } from "../dsn/preflight";
import type { DsnBoard } from "../dsn/types";
import { runFreerouting } from "./runner";
import type { resolveFreeroutingRuntime } from "./runtime";
import { buildAutorouteCandidate } from "./verification";
import type { AutoroutePassExecutor } from "./completion";
import { getBoardStackup } from "../stackup";
import type { LayerId } from "../layers";
import { pcbRevisionId } from "../revision";
import { viaSpannedLayers } from "../geometry-copper";
import { zoneFillIsCurrent, refillZoneFillsAtomically } from "../zones/fill-lifecycle";

export type FreeroutingRuntimeInfo = Extract<Awaited<ReturnType<typeof resolveFreeroutingRuntime>>, { ok: true }>;

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function generatedCopper(item: Track | Via): boolean {
  return item.locked !== true && (item.source === "ai" || item.source === "autorouter");
}
export function trackKey(track: Track): string {
  const a = `${track.start.x},${track.start.y}`;
  const b = `${track.end.x},${track.end.y}`;
  return `${track.netId}|${track.layer}|${track.width}|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
}
export function viaKey(via: Via): string {
  return `${via.netId}|${via.at.x},${via.at.y}|${via.size}|${via.drill}|${via.layers.join("|")}`;
}
export const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
export function preserveProtectedCopper(base: PcbBoard, candidate: PcbBoard): PcbBoard {
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
export function highEffortRoutingBoard(board: PcbBoard, targetNetIds: number[] | undefined, passIndex: number): PcbBoard {
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
export function layerUsageForBoard(board: PcbBoard): Partial<Record<LayerId, SesLayerUsage>> {
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

/** Build the per-pass executor over a resolved local FreeRouting runtime, a wall-clock deadline and a cancellation signal. */
export function createFreeroutingPassExecutor(input: { runtimeInfo: FreeroutingRuntimeInfo; deadline: number; signal: AbortSignal }): AutoroutePassExecutor {
  const { runtimeInfo, deadline, signal } = input;
  return async (pass) => {
    const routerEvidence = {
      engine: "Freerouting" as const,
      version: runtimeInfo.version,
      runtime: runtimeInfo.javaSource,
      commandProfile: "headless-offline-cli" as const,
      maxPasses: pass.engineMaxPasses,
      timeoutMs: Math.max(1, deadline - Date.now()),
    };
    if (signal.aborted) return {
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
      signal: signal,
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
}
