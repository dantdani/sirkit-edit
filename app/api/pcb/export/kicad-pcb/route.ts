/**
 * POST /api/pcb/export/kicad-pcb (PCB Stage 13).
 *
 * Body:  { board: PcbBoard, netlist?: PcbNetlist, options?: WriteKicadPcbOptions }
 * 200:   application/octet-stream — the .kicad_pcb file text.
 *        Content-Disposition: attachment; filename="<boardName>.kicad_pcb"
 * 400:   { ok: false, error }    — bad JSON / body shape
 * 500:   { ok: false, error }    — emit failure
 *
 * Validation is minimal-shape by hand (no zod in the dep tree — same posture
 * as /api/pcb/autoroute): the board is a complex denormalized structure, so
 * unknown fields pass through untouched. No auth for MVP (same as autoroute).
 */

import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import type { WriteKicadPcbOptions } from "@/app/lib/pcb/kicad/write-pcb";
import { writeKicadPcb, netlistFromBoard } from "@/app/lib/pcb/kicad/write-pcb";

export const runtime = "nodejs";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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

/** Filename stem safe for a Content-Disposition header. */
function sanitizeName(name: unknown): string {
  if (typeof name !== "string") return "sirkit-board";
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return clean.length > 0 ? clean.slice(0, 80) : "sirkit-board";
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof raw !== "object" || raw === null) {
    return Response.json({ ok: false, error: "body must be an object" }, { status: 400 });
  }
  const body = raw as { board?: unknown; netlist?: unknown; options?: unknown };

  if (!isBoardLike(body.board)) {
    return Response.json({ ok: false, error: "body.board must be a PcbBoard" }, { status: 400 });
  }
  if (body.netlist !== undefined && !isNetlistLike(body.netlist)) {
    return Response.json({ ok: false, error: "body.netlist must be a PcbNetlist" }, { status: 400 });
  }
  if (body.options !== undefined && (typeof body.options !== "object" || body.options === null)) {
    return Response.json({ ok: false, error: "body.options must be an object" }, { status: 400 });
  }

  const board = body.board;
  const netlist = isNetlistLike(body.netlist) ? body.netlist : netlistFromBoard(board);
  const options = (body.options ?? {}) as WriteKicadPcbOptions;
  const boardName = sanitizeName(options.boardName);

  let text: string;
  try {
    text = writeKicadPcb(board, netlist, { ...options, boardName });
  } catch (e) {
    return Response.json({ ok: false, error: `export failed: ${errMsg(e)}` }, { status: 500 });
  }

  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${boardName}.kicad_pcb"`,
    },
  });
}
