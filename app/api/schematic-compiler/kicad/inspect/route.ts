import { LOW_VOLTAGE_SCHEMATIC_PROFILE_V1 } from "@/app/lib/schematic-compiler/capability";
import { inspectKiCadSchematic } from "@/app/lib/schematic-compiler/kicad-adapter";
import { scopedJson } from "../../_scope";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> { const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response; if (typeof parsed.body.source !== "string") return Response.json({ ok: false, error: "KiCad source string is required" }, { status: 400 }); const inspection = inspectKiCadSchematic(parsed.body.source, LOW_VOLTAGE_SCHEMATIC_PROFILE_V1); return Response.json({ ok: inspection.parserState === "parsed", inspection, authority: "quarantine_inspection_only", semanticImport: null }, { status: inspection.parserState === "parsed" ? 200 : 422, headers: { "Cache-Control": "no-store" } }); }
