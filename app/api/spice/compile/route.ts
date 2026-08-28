import { compileCanonicalIr } from "@/app/lib/spice/ir";
import { compileNgspiceNetlist } from "@/app/lib/spice/netlist";
import { auditCompiledIr } from "@/app/lib/spice/readiness";
import type { SimulationPartSnapshot, SimulationProject } from "@/app/lib/spice/types";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.23] canonical PUBLIC wrapper — a stateless, deterministic compile
// transform over the caller-supplied project (8 MB / 30 s bounded read). It
// executes no simulator, reaches no durable store, and its result is COMPILE
// evidence only — never simulation or physical validation.
export const POST = publicJsonRoute<{ project?: SimulationProject; testId?: string; analysisId?: string; parts?: SimulationPartSnapshot[] }>(
  { maxBytes: 8_000_000, deadlineMs: 30_000 },
  ({ body }) => {
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
  });
