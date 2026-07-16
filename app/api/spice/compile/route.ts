import { compileCanonicalIr } from "@/app/lib/spice/ir";
import { compileNgspiceNetlist } from "@/app/lib/spice/netlist";
import { auditCompiledIr } from "@/app/lib/spice/readiness";
import type { SimulationPartSnapshot, SimulationProject } from "@/app/lib/spice/types";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: { project?: SimulationProject; testId?: string; analysisId?: string; parts?: SimulationPartSnapshot[] };
  try {
    body = await req.json() as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.project || typeof body.testId !== "string") {
    return Response.json({ ok: false, error: "project and testId are required" }, { status: 400 });
  }
  try {
    const compiled = compileCanonicalIr({ project: body.project, testId: body.testId, parts: body.parts ?? [] });
    const readiness = auditCompiledIr(compiled);
    const netlist = compileNgspiceNetlist(compiled.ir, { analysisId: body.analysisId, pinNodes: compiled.pointNodes });
    return Response.json({
      ok: true,
      readiness,
      netlist,
      irSummary: {
        nodes: compiled.ir.nodes.length,
        devices: compiled.ir.devices.length,
        models: compiled.ir.models.map((model) => ({ id: model.id, name: model.name, version: model.version, status: model.validationStatus })),
        analyses: compiled.ir.analyses.map((analysis) => ({ id: analysis.id, name: analysis.name, type: analysis.type })),
        outputs: compiled.ir.outputs,
        warnings: compiled.ir.warnings,
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
