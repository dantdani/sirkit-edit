import type { PcbBoard } from "@/app/lib/pcb/types";
import type { ConstraintDocument } from "@/app/lib/constraints/types";
import { formatConstraintDocument, parseConstraintDocument } from "@/app/lib/constraints/parser";
import { previewConstraintTransaction } from "@/app/lib/constraints/transactions";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

function isBoard(value: unknown): value is PcbBoard {
  if (!value || typeof value !== "object") return false;
  const board = value as Record<string, unknown>;
  return board.formatVersion === 1 && Array.isArray(board.nets) && Array.isArray(board.footprints) && Array.isArray(board.tracks) && Array.isArray(board.vias) && Array.isArray(board.zones);
}

// [B16.0.8] canonical wrapper — policy → media → bounded body inside the wrapper.
export const POST = publicJsonRoute({ maxBytes: 2000000, deadlineMs: 15000 }, ({ body }) => {
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
});

