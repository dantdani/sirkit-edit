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
  if (!value || typeof value !== "object") return result;
  const raw = value as Record<string, unknown>;
  if (Array.isArray(raw.selectedInstanceIds) && raw.selectedInstanceIds.every((id) => typeof id === "string")) result.instanceIds = raw.selectedInstanceIds.slice(0, 2_000) as string[];
  if (Array.isArray(raw.seeds) && raw.seeds.every((seed) => typeof seed === "number" && Number.isFinite(seed))) result.seeds = raw.seeds.slice(0, 8) as number[];
  for (const key of ["candidateCount", "maxIterations", "localRefinementPasses", "gridNm", "timeoutMs"] as const) if (typeof raw[key] === "number" && Number.isFinite(raw[key])) result[key] = raw[key] as number;
  if (typeof raw.projectId === "string" && raw.projectId.length <= 256) result.projectId = raw.projectId;
  return result;
}

// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
// [B17-E] revision-bound: `expectedRevision` (when given) must equal the submitted board's semantic revision (409
// otherwise), and the answer is the shared `sirkit.layout-candidate.v1` envelope every consumer applies the same way.
export const POST = publicJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody }): Promise<Response> => {
  const body: unknown = rawBody;
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (!isBoard(input.board)) return Response.json({ ok: false, error: "board is required" }, { status: 400 });
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
