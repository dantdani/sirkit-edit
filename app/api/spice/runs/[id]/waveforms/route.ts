import { getRun } from "@/app/lib/spice/server/job-store";
import { downsampleMinMax, sliceWaveform } from "@/app/lib/spice/waveforms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return Response.json({ ok: false, error: "Run not found" }, { status: 404 });
  const url = new URL(req.url);
  const signal = url.searchParams.get("signal");
  if (!signal) return Response.json({ ok: true, signals: run.waveforms.map((waveform) => ({ name: waveform.name, unit: waveform.unit, xName: waveform.xName, xUnit: waveform.xUnit, points: waveform.x.length })) });
  const waveform = run.waveforms.find((candidate) => candidate.name === signal);
  if (!waveform) return Response.json({ ok: false, error: "Signal not found" }, { status: 404 });
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const from = fromRaw === null ? undefined : Number(fromRaw);
  const to = toRaw === null ? undefined : Number(toRaw);
  const points = Math.max(32, Math.min(20_000, Number(url.searchParams.get("points") ?? 2000)));
  const sliced = sliceWaveform(waveform, Number.isFinite(from) ? from : undefined, Number.isFinite(to) ? to : undefined);
  const sampled = downsampleMinMax(sliced.x, sliced.y, points);
  return Response.json({ ok: true, waveform: { id: waveform.id, name: waveform.name, unit: waveform.unit, xName: waveform.xName, xUnit: waveform.xUnit, ...sampled, rawPoints: sliced.x.length } });
}
