import { buildSpiceReport, reportToHtml, reportToJson } from "@/app/lib/spice/report";
import type { RunRecord, SimulationProject } from "@/app/lib/spice/types";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.23] canonical PUBLIC wrapper — a stateless report RENDERER over the
// caller-supplied project + run records (8 MB / 30 s bounded read). It reads
// no durable state and invents no results: it formats exactly the evidence
// the caller provides, as a downloadable document — never a certification,
// signoff, or release artifact.
export const POST = publicJsonRoute<{ project?: SimulationProject; runs?: RunRecord[]; format?: "json" | "html"; title?: string }>(
  { maxBytes: 8_000_000, deadlineMs: 30_000 },
  ({ body }) => {
  try {
    if (!body.project || !Array.isArray(body.runs)) return Response.json({ ok: false, error: "project and runs are required" }, { status: 400 });
    const report = buildSpiceReport(body.project, body.runs, body.title);
    if (body.format === "html") return new Response(reportToHtml(report), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="sirkit-spice-report.html"` } });
    return new Response(reportToJson(report), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="sirkit-spice-report.json"` } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
  });
