import type { PcbBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { runPlacementCandidate, type PlacementRunRequest } from "@/app/lib/pcb/candidates/layout-candidate";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

function isBoard(value: unknown): value is PcbBoard {
  if (!value || typeof value !== "object") return false;
  const board = value as Record<string, unknown>;
  return board.formatVersion === 1 && Array.isArray(board.footprints) && Array.isArray(board.nets) && Array.isArray(board.tracks) && Array.isArray(board.vias) && Array.isArray(board.zones);
}

/** [B17-E] the request is the SHARED placement request; the engine options derive from the one options builder. */
function request(value: unknown): PlacementRunRequest {
  const result: PlacementRunRequest = { producer: "route" };
  if (!value || typeof value !== "object") return clampPublicPreviewRequest(result); // [B24-A3] absent options still get the public timeout
  const raw = value as Record<string, unknown>;
  if (Array.isArray(raw.selectedInstanceIds) && raw.selectedInstanceIds.every((id) => typeof id === "string")) result.instanceIds = raw.selectedInstanceIds.slice(0, 2_000) as string[];
  if (Array.isArray(raw.seeds) && raw.seeds.every((seed) => typeof seed === "number" && Number.isFinite(seed))) result.seeds = raw.seeds.slice(0, 8) as number[];
  for (const key of ["candidateCount", "maxIterations", "localRefinementPasses", "gridNm", "timeoutMs"] as const) if (typeof raw[key] === "number" && Number.isFinite(raw[key])) result[key] = raw[key] as number;
  if (typeof raw.projectId === "string" && raw.projectId.length <= 256) result.projectId = raw.projectId;
  return clampPublicPreviewRequest(result); // [B24-A3] OD-197: the public ceilings, clamped and never refused (closes B20 F1 as a work bound)
}

// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
// [B17-E] revision-bound: `expectedRevision` (when given) must equal the submitted board's semantic revision (409
// otherwise), and the answer is the shared `sirkit.layout-candidate.v1` envelope every consumer applies the same way.
export const POST = publicJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody, bytes }): Promise<Response> => {
  const body: unknown = rawBody;
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (!isBoard(input.board)) return Response.json({ ok: false, error: "board is required" }, { status: 400 }); const tooLarge = publicPreviewBoundRefusal(input.board, bytes); if (tooLarge) return tooLarge; // [B24-A3] OD-197: the public bound, before the revision hash and the engine ([B24-A3 review, 2026-10-08] the body's size first)
  const revision = pcbRevisionId(input.board);
  if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
    return Response.json({ ok: false, error: "expectedRevision does not match the submitted PCB semantic revision", revision }, { status: 409 });
  }
  try {
    const { run, candidate } = runPlacementCandidate({ board: input.board, request: request(input.options) });
    if (run.termination === "infeasible" || !candidate) return Response.json({ ok: false, error: `no legal placement candidate: ${run.termination}`, revision, result: run }, { status: 422 });
    return Response.json({ ok: true, revision, candidate, result: run });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "placement preview failed" }, { status: 422 });
  }
});

// ── [B24-A3] the public work bound (D24-8, OD-197; closes B20 F1 as a work bound) ──────────────────────────────────────────────────
// In this route only: the editor worker and the agent tool share the engine and `placementRunOptions`, which stay as they are. The
// engine checks its budget only between candidates (engine.ts `checkBudget`), so these are WORK bounds - fewer and cheaper candidates
// on a bounded board - not a preemptive stop: a running candidate still blocks the event loop until the next check.
const PUBLIC_PREVIEW_CEILINGS = Object.freeze({ timeoutMs: 5_000, candidateCount: 2, maxIterations: 400, localRefinementPasses: 0, gridNm: 100_000 }); // [B24-A3 review, 2026-10-08] security-1: candidates 4 -> 2, refinement passes 1 -> 0 (one pass is up to 64 more evaluations), measured on abuse-controls.md section 9
const PUBLIC_PREVIEW_BOUNDS = Object.freeze({ bytes: 1_000_000, footprints: 30, pads: 600, padsPerFootprint: 128, padPolygonVertices: 2_400, nets: 300, tracksAndVias: 100, zones: 8, zoneVertices: 512, keepoutVertices: 512, polygonOutlineVertices: 0, rotationsPerFootprint: 4, rotationValues: 0, pinPadMappingsPerFootprint: 128, pinPadMappings: 600 }); // [B24-A3 lead, 2026-10-08] the check's multipliers: a footprint's allowedRotations and pinPadMappings bounded too; [B24-A3 review, 2026-10-08] security-1, security-3: was { footprints: 200, pads: 4_000, nets: 1_000, tracksAndVias: 20_000, zones: 50 }; each bound a measured cost driver (section 9)
const BOUND_LABELS: Readonly<Record<keyof typeof PUBLIC_PREVIEW_BOUNDS, string>> = Object.freeze({ bytes: "body bytes", footprints: "footprints", pads: "pads", padsPerFootprint: "pads in one footprint", padPolygonVertices: "polygon-pad vertices", nets: "nets", tracksAndVias: "tracks and vias", zones: "zones", zoneVertices: "zone vertices (outlines and fills)", keepoutVertices: "keepout vertices", polygonOutlineVertices: "polygon outline vertices (a rect or roundrect outline only)", rotationsPerFootprint: "allowed rotations in one footprint", rotationValues: "allowed rotations other than 0, 90, 180 or 270", pinPadMappingsPerFootprint: "pin-pad mappings in one footprint", pinPadMappings: "pin-pad mappings" });

/** The caller's options clamped to the public ceilings (never refused); an absent timeout, candidate count or refinement pass count is
 *  its ceiling (the engine's own defaults, 4 candidates and 1 pass, are above them), every other absent option stays absent (the
 *  engine's own default is already inside its ceiling). */
function clampPublicPreviewRequest(asked: PlacementRunRequest): PlacementRunRequest {
  const out: PlacementRunRequest = { ...asked, timeoutMs: Math.min(asked.timeoutMs ?? PUBLIC_PREVIEW_CEILINGS.timeoutMs, PUBLIC_PREVIEW_CEILINGS.timeoutMs) };
  out.candidateCount = Math.min(asked.candidateCount ?? PUBLIC_PREVIEW_CEILINGS.candidateCount, PUBLIC_PREVIEW_CEILINGS.candidateCount);
  if (asked.maxIterations !== undefined) out.maxIterations = Math.min(asked.maxIterations, PUBLIC_PREVIEW_CEILINGS.maxIterations);
  out.localRefinementPasses = Math.min(asked.localRefinementPasses ?? PUBLIC_PREVIEW_CEILINGS.localRefinementPasses, PUBLIC_PREVIEW_CEILINGS.localRefinementPasses);
  if (asked.gridNm !== undefined) out.gridNm = Math.max(asked.gridNm, PUBLIC_PREVIEW_CEILINGS.gridNm);
  return out;
}

/** 413 PLACEMENT_PREVIEW_TOO_LARGE naming the first bound the request is above, or null. The body's size is checked first, so the
 *  counting below walks at most a megabyte of board; only list lengths are read (a footprint's pads through its definition, a polygon's
 *  points), so nothing else of the board is touched before the refusal. */
function publicPreviewBoundRefusal(board: PcbBoard, bytes: number): Response | null {
  const refuse = (bound: keyof typeof PUBLIC_PREVIEW_BOUNDS, actual: number): Response => {
    const limit = PUBLIC_PREVIEW_BOUNDS[bound];
    return Response.json({ ok: false, code: "PLACEMENT_PREVIEW_TOO_LARGE", error: `The board is above the public preview's bound: ${actual} ${BOUND_LABELS[bound]}, at most ${limit}.`, bound, limit, actual }, { status: 413, headers: { "Cache-Control": "no-store" } });
  };
  if (bytes > PUBLIC_PREVIEW_BOUNDS.bytes) return refuse("bytes", bytes);
  const length = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  let pads = 0;
  let padsPerFootprint = 0;
  let padPolygonVertices = 0;
  for (const footprint of board.footprints as unknown[]) {
    const list = (footprint as { def?: { pads?: unknown } } | null)?.def?.pads;
    if (!Array.isArray(list)) continue;
    pads += list.length;
    padsPerFootprint = Math.max(padsPerFootprint, list.length);
    for (const pad of list as unknown[]) {
      const shape = (pad as { shape?: { kind?: unknown; points?: unknown } } | null)?.shape;
      if (shape?.kind === "polygon") padPolygonVertices += length(shape.points);
    }
  }
  let zoneVertices = 0;
  for (const zone of board.zones as unknown[]) {
    const { polygon, fill } = (zone ?? {}) as { polygon?: unknown; fill?: unknown };
    zoneVertices += length(polygon);
    for (const region of Array.isArray(fill) ? (fill as unknown[]) : []) {
      const { outer, holes } = (region ?? {}) as { outer?: unknown; holes?: unknown };
      zoneVertices += length(outer);
      for (const hole of Array.isArray(holes) ? (holes as unknown[]) : []) zoneVertices += length(hole);
    }
  }
  let keepoutVertices = 0;
  for (const keepout of Array.isArray(board.routingKeepouts) ? (board.routingKeepouts as unknown[]) : []) keepoutVertices += length((keepout as { polygon?: unknown } | null)?.polygon);
  const outline = board.outline as { kind?: unknown; points?: unknown } | null | undefined;
  const polygonOutlineVertices = outline?.kind === "rect" || outline?.kind === "roundrect" ? 0 : Math.max(1, length(outline?.points));
  // [B24-A3 lead, 2026-10-08] the engine refines every distinct allowed rotation (problem.ts:106-107, engine.ts:174) and makes each
  // pin-pad mapping a terminal, inside a first candidate its budget cannot interrupt: both are counted per footprint and in all
  let rotationsPerFootprint = 0;
  let rotationValues = 0;
  let pinPadMappingsPerFootprint = 0;
  let pinPadMappings = 0;
  for (const footprint of board.footprints as unknown[]) {
    const record = (footprint ?? {}) as { placementConstraints?: { allowedRotations?: unknown }; pinPadMappings?: unknown };
    const rotations = record.placementConstraints?.allowedRotations;
    if (Array.isArray(rotations)) {
      rotationsPerFootprint = Math.max(rotationsPerFootprint, rotations.length);
      rotationValues += rotations.filter((value) => value !== 0 && value !== 90 && value !== 180 && value !== 270).length;
    }
    const mapped = length(record.pinPadMappings);
    pinPadMappingsPerFootprint = Math.max(pinPadMappingsPerFootprint, mapped);
    pinPadMappings += mapped;
  }
  const counts: Record<keyof typeof PUBLIC_PREVIEW_BOUNDS, number> = { rotationsPerFootprint, rotationValues, pinPadMappingsPerFootprint, pinPadMappings, bytes, footprints: board.footprints.length, pads, padsPerFootprint, padPolygonVertices, nets: board.nets.length, tracksAndVias: board.tracks.length + board.vias.length, zones: board.zones.length, zoneVertices, keepoutVertices, polygonOutlineVertices };
  for (const bound of Object.keys(PUBLIC_PREVIEW_BOUNDS) as Array<keyof typeof PUBLIC_PREVIEW_BOUNDS>) if (counts[bound] > PUBLIC_PREVIEW_BOUNDS[bound]) return refuse(bound, counts[bound]);
  return null;
}
