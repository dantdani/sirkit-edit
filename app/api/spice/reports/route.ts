import { buildSpiceReport, reportToHtml, reportToJson } from "@/app/lib/spice/report";
import type { RunRecord, SimulationProject } from "@/app/lib/spice/types";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { project?: SimulationProject; runs?: RunRecord[]; format?: "json" | "html"; title?: string };
    if (!body.project || !Array.isArray(body.runs)) return Response.json({ ok: false, error: "project and runs are required" }, { status: 400 });
    const report = buildSpiceReport(body.project, body.runs, body.title);
    if (body.format === "html") return new Response(reportToHtml(report), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="sirkit-spice-report.html"` } });
    return new Response(reportToJson(report), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="sirkit-spice-report.json"` } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
