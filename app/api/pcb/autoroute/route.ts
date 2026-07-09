/**
 * POST /api/pcb/autoroute (PCB Stage 9).
 *
 * Body:  { board: PcbBoard, maxPasses?: number, timeoutMs?: number }
 * 200:   { ok: true, sesText, stats: { elapsedMs, tracksImported, viasImported } }
 * 400:   { ok: false, error }                         — bad JSON / body shape
 * 500:   { ok: false, error, stderr? }                — env / subprocess failure
 *
 * The endpoint is PURE with respect to board state: it emits DSN, runs
 * Freerouting, parses the SES only to count tracks/vias for `stats`, and hands
 * the raw `sesText` back. The CLIENT parses it again and dispatches the
 * single-undo AutorouteImport through the history stack. Same auth posture as
 * /api/pcb/ai-rules/from-brief (none yet — add when global auth lands).
 */

import { join } from "node:path";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { boardToDsn, writeDsn } from "@/app/lib/pcb/dsn/write-dsn";
import { parseSes } from "@/app/lib/pcb/dsn/read-ses";
import { runFreerouting } from "@/app/lib/pcb/autoroute/runner";

export const runtime = "nodejs";
export const maxDuration = 300; // Freerouting can take minutes on dense boards

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
    (b.stackup === 2 || b.stackup === 4) &&
    typeof b.outline === "object" &&
    b.outline !== null
  );
}

function isPositive(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Prefer $JAVA_HOME/bin/java when set; otherwise rely on PATH. */
function resolveJavaPath(): string {
  const home = process.env.JAVA_HOME;
  if (!home) return "java";
  return join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
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
  const body = raw as { board?: unknown; maxPasses?: unknown; timeoutMs?: unknown };

  if (!isBoardLike(body.board)) {
    return Response.json({ ok: false, error: "body.board must be a PcbBoard" }, { status: 400 });
  }
  if (body.maxPasses !== undefined && !isPositive(body.maxPasses)) {
    return Response.json({ ok: false, error: "maxPasses must be a positive number" }, { status: 400 });
  }
  if (body.timeoutMs !== undefined && !isPositive(body.timeoutMs)) {
    return Response.json({ ok: false, error: "timeoutMs must be a positive number" }, { status: 400 });
  }

  const jar = process.env.FREEROUTING_JAR;
  if (!jar) {
    return Response.json(
      { ok: false, error: "jar-missing", stderr: "FREEROUTING_JAR environment variable is not set" },
      { status: 500 },
    );
  }

  const board = body.board;
  let dsnText: string;
  try {
    dsnText = writeDsn(boardToDsn(board));
  } catch (e) {
    return Response.json({ ok: false, error: `DSN generation failed: ${errMsg(e)}` }, { status: 500 });
  }

  const result = await runFreerouting({
    dsnText,
    freeroutingJarPath: jar,
    javaPath: resolveJavaPath(),
    maxPasses: body.maxPasses as number | undefined,
    timeoutMs: body.timeoutMs as number | undefined,
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, stderr: result.stderr.slice(-4000) || undefined },
      { status: 500 },
    );
  }

  let parsed;
  try {
    parsed = parseSes(result.sesText, board);
  } catch (e) {
    return Response.json({ ok: false, error: `SES parse failed: ${errMsg(e)}` }, { status: 500 });
  }
  return Response.json({
    ok: true,
    sesText: result.sesText,
    stats: {
      elapsedMs: result.elapsedMs,
      tracksImported: parsed.tracks.length,
      viasImported: parsed.vias.length,
    },
  });
}
