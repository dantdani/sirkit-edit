import { diffSchematicGraphs } from "@/app/lib/schematic-compiler/diff";
import { validateSchematicGraph } from "@/app/lib/schematic-compiler/graph";
import type { SchematicSemanticGraph } from "@/app/lib/schematic-compiler/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { object, schematicCompilerScopeFromContext, SCHEMATIC_COMPILER_API_MAX_BYTES, SCHEMATIC_COMPILER_API_DEADLINE_MS } from "../_scope";
export const runtime = "nodejs";
export const POST = authenticatedJsonRoute({ maxBytes: SCHEMATIC_COMPILER_API_MAX_BYTES, deadlineMs: SCHEMATIC_COMPILER_API_DEADLINE_MS }, async ({ context, body }): Promise<Response> => { const scope = schematicCompilerScopeFromContext(context); if (!object(body.base) || !object(body.candidate)) return Response.json({ ok: false, error: "base and candidate graphs are required" }, { status: 400 }); const base = body.base as unknown as SchematicSemanticGraph, candidate = body.candidate as unknown as SchematicSemanticGraph; if (base.projectId !== scope.projectId || candidate.projectId !== scope.projectId || !validateSchematicGraph(base).valid || !validateSchematicGraph(candidate).valid) return Response.json({ ok: false, error: "graph integrity or scope failed" }, { status: 422 }); return Response.json({ ok: true, diff: diffSchematicGraphs(base, candidate) }, { headers: { "Cache-Control": "no-store" } }); });
