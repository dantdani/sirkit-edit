/**
 * POST /api/pcb/export/gerbers (PCB Stage 14).
 *
 * Body:  { board, netlist?, fabPresetId, drcPresetId?, overrideDrcFail?, boardName? }
 * 200:   application/zip — the fab bundle; Content-Disposition names it.
 * 400:   { error: 'drc-failed', violations }  — hard DRC gate, no override
 * 400:   { error: 'bad-request', message }    — body shape problems
 * 500:   { error: 'kicad-cli-missing' | 'kicad-cli-failed', stderr? }
 *
 * Validation is minimal-shape by hand (no zod in the dep tree — same posture
 * as /api/pcb/autoroute and /api/pcb/export/kicad-pcb). The DRC gate re-runs
 * server-side inside buildFabBundle — the client's checkbox only sets
 * `overrideDrcFail`; it can never skip the check itself.
 */

import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import { netlistFromBoard } from "@/app/lib/pcb/kicad/write-pcb";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import type { DrcPresetId } from "@/app/lib/pcb/drc/types";
import { FAB_PRESETS } from "@/app/lib/pcb/fab/presets";
import { buildFabBundle } from "@/app/lib/pcb/fab/build-bundle";
import { FabExportGatedByDrc, KicadCliError } from "@/app/lib/pcb/fab/types";

export const runtime = "nodejs";
export const maxDuration = 300; // three kicad-cli invocations at 60 s each, worst case

function isBoardLike(x: unknown): x is PcbBoard {
  if (typeof x !== "object" || x === null) return false;
  const b = x as Record<string, unknown>;
  return (
    Array.isArray(b.nets) &&
    Array.isArray(b.footprints) &&
    Array.isArray(b.tracks) &&
    Array.isArray(b.vias) &&
    Array.isArray(b.zones) &&
    (b.stackup === 2 || b.stackup === 4) &&
    typeof b.outline === "object" &&
    b.outline !== null
  );
}

function isNetlistLike(x: unknown): x is PcbNetlist {
  if (typeof x !== "object" || x === null) return false;
  const n = x as Record<string, unknown>;
  return Array.isArray(n.components) && Array.isArray(n.nets);
}

function bad(message: string): Response {
  return Response.json({ error: "bad-request", message }, { status: 400 });
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }
  if (typeof raw !== "object" || raw === null) return bad("body must be an object");
  const body = raw as {
    board?: unknown;
    netlist?: unknown;
    fabPresetId?: unknown;
    drcPresetId?: unknown;
    overrideDrcFail?: unknown;
    boardName?: unknown;
  };

  if (!isBoardLike(body.board)) return bad("body.board must be a PcbBoard");
  if (body.netlist !== undefined && !isNetlistLike(body.netlist)) {
    return bad("body.netlist must be a PcbNetlist");
  }
  const fabPreset = FAB_PRESETS.find((p) => p.id === body.fabPresetId);
  if (!fabPreset) return bad(`unknown fabPresetId ${JSON.stringify(body.fabPresetId)}`);
  if (body.overrideDrcFail !== undefined && typeof body.overrideDrcFail !== "boolean") {
    return bad("overrideDrcFail must be a boolean");
  }

  // DRC preset: explicit request wins, else the fab preset's soft link.
  let drcPreset;
  try {
    drcPreset = getPreset(
      (typeof body.drcPresetId === "string" ? body.drcPresetId : fabPreset.drcPresetId) as DrcPresetId,
    );
  } catch {
    return bad(`unknown drcPresetId ${JSON.stringify(body.drcPresetId)}`);
  }

  const board = body.board;
  const netlist = isNetlistLike(body.netlist) ? body.netlist : netlistFromBoard(board);
  const boardName = typeof body.boardName === "string" ? body.boardName : "sirkit-board";

  try {
    const result = await buildFabBundle({
      board,
      netlist,
      fabPreset,
      drcPreset,
      overrideDrcFail: body.overrideDrcFail === true,
      boardName,
    });
    return new Response(Buffer.from(result.zipBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Sirkit-Bundle-Stats": JSON.stringify({
          files: result.stats.gerberFiles.length + result.stats.drillFiles.length + result.stats.posFiles.length + 2,
          totalBytes: result.stats.totalBytes,
          drcErrors: result.stats.drcErrors,
          drcWarnings: result.stats.drcWarnings,
          elapsedMs: result.stats.elapsedMs,
        }),
      },
    });
  } catch (e) {
    if (e instanceof FabExportGatedByDrc) {
      return Response.json({ error: "drc-failed", violations: e.violations }, { status: 400 });
    }
    if (e instanceof KicadCliError) {
      return Response.json(
        {
          error: e.kind === "cli-missing" ? "kicad-cli-missing" : "kicad-cli-failed",
          message: e.message,
          stderr: e.stderr.slice(-4000) || undefined,
        },
        { status: 500 },
      );
    }
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: "export-failed", message }, { status: 500 });
  }
}
