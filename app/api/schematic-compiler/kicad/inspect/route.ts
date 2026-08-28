import { LOW_VOLTAGE_SCHEMATIC_PROFILE_V1 } from "@/app/lib/schematic-compiler/capability";
import { inspectKiCadSchematic } from "@/app/lib/schematic-compiler/kicad-adapter";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { SCHEMATIC_COMPILER_API_MAX_BYTES, SCHEMATIC_COMPILER_API_DEADLINE_MS } from "../../_scope";
export const runtime = "nodejs";
export const POST = authenticatedJsonRoute({ maxBytes: SCHEMATIC_COMPILER_API_MAX_BYTES, deadlineMs: SCHEMATIC_COMPILER_API_DEADLINE_MS }, async ({ body }): Promise<Response> => { if (typeof body.source !== "string") return Response.json({ ok: false, error: "KiCad source string is required" }, { status: 400 }); const inspection = inspectKiCadSchematic(body.source, LOW_VOLTAGE_SCHEMATIC_PROFILE_V1); return Response.json({ ok: inspection.parserState === "parsed", inspection, authority: "quarantine_inspection_only", semanticImport: null }, { status: inspection.parserState === "parsed" ? 200 : 422, headers: { "Cache-Control": "no-store" } }); });
