import type { PcbBoard } from "@/app/lib/pcb/types";
import type { ConstraintDocument } from "@/app/lib/constraints/types";
import { formatConstraintDocument, parseConstraintDocument } from "@/app/lib/constraints/parser";
import { previewConstraintTransaction } from "@/app/lib/constraints/transactions";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 1_500_000;

function isBoard(value: unknown): value is PcbBoard {
  if (!value || typeof value !== "object") return false;
  const board = value as Record<string, unknown>;
  return board.formatVersion === 1 && Array.isArray(board.nets) && Array.isArray(board.footprints) && Array.isArray(board.tracks) && Array.isArray(board.vias) && Array.isArray(board.zones);
}

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "constraint preview body is too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (!isBoard(input.board) || typeof input.projectId !== "string" || !Array.isArray(input.documents)) return Response.json({ ok: false, error: "board, projectId, and documents are required" }, { status: 400 });
  const documents: ConstraintDocument[] = [];
  for (const raw of input.documents) {
    const parsed = parseConstraintDocument(JSON.stringify(raw));
    if (!parsed.ok) return Response.json({ ok: false, diagnostics: parsed.diagnostics }, { status: 422 });
    documents.push(parsed.document);
  }
  const preview = previewConstraintTransaction({ board: input.board, projectId: input.projectId, documents });
  return Response.json({ ok: preview.compilation.ok, preview, canonicalDocuments: documents.map(formatConstraintDocument) }, { status: preview.compilation.ok ? 200 : 422 });
}

