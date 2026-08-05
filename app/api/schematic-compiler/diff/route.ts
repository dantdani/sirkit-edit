import { diffSchematicGraphs } from "@/app/lib/schematic-compiler/diff";
import { validateSchematicGraph } from "@/app/lib/schematic-compiler/graph";
import type { SchematicSemanticGraph } from "@/app/lib/schematic-compiler/types";
import { object, scopedJson } from "../_scope";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> { const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response; const { body, scope } = parsed; if (!object(body.base) || !object(body.candidate)) return Response.json({ ok: false, error: "base and candidate graphs are required" }, { status: 400 }); const base = body.base as unknown as SchematicSemanticGraph, candidate = body.candidate as unknown as SchematicSemanticGraph; if (base.projectId !== scope.projectId || candidate.projectId !== scope.projectId || !validateSchematicGraph(base).valid || !validateSchematicGraph(candidate).valid) return Response.json({ ok: false, error: "graph integrity or scope failed" }, { status: 422 }); return Response.json({ ok: true, diff: diffSchematicGraphs(base, candidate) }, { headers: { "Cache-Control": "no-store" } }); }
