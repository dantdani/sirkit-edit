import type { PcbBoard } from "@/app/lib/pcb/types";
import type { EngineeringPlacementOptions } from "@/app/lib/pcb/placement/types";
import { runEngineeringPlacement } from "@/app/lib/pcb/placement/engine";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 8_000_000;

function isBoard(value: unknown): value is PcbBoard {
  if (!value || typeof value !== "object") return false;
  const board = value as Record<string, unknown>;
  return board.formatVersion === 1 && Array.isArray(board.footprints) && Array.isArray(board.nets) && Array.isArray(board.tracks) && Array.isArray(board.vias) && Array.isArray(board.zones);
}

function options(value: unknown): EngineeringPlacementOptions {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const result: EngineeringPlacementOptions = {};
  if (["initial_unrouted", "preserve_routed", "generated_copper_ripup", "selected_scope"].includes(String(raw.mode))) result.mode = raw.mode as EngineeringPlacementOptions["mode"];
  if (Array.isArray(raw.selectedInstanceIds) && raw.selectedInstanceIds.every((id) => typeof id === "string")) result.selectedInstanceIds = raw.selectedInstanceIds.slice(0, 2_000) as string[];
  for (const key of ["candidateCount", "maxIterations", "localRefinementPasses", "gridNm", "capacityColumns", "capacityRows", "timeoutMs"] as const) if (typeof raw[key] === "number" && Number.isFinite(raw[key])) result[key] = raw[key] as never;
  if (typeof raw.projectId === "string" && raw.projectId.length <= 256) result.projectId = raw.projectId;
  return result;
}

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "placement preview body is too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (!isBoard(input.board)) return Response.json({ ok: false, error: "board is required" }, { status: 400 });
  try {
    const result = runEngineeringPlacement({ board: input.board, options: options(input.options) });
    return Response.json({ ok: result.selectedCandidateId !== undefined, result }, { status: result.termination === "infeasible" ? 422 : 200 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "placement preview failed" }, { status: 422 });
  }
}
