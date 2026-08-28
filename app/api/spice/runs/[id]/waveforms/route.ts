import { getRun } from "@/app/lib/spice/server/job-store";
import { downsampleMinMax, sliceWaveform } from "@/app/lib/spice/waveforms";
import { authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { runNotFound, spiceRunScopeFromContext } from "../../_scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [B16.0.2 §B] authorize BEFORE any waveform read; trusted scope only.
// [B16.0.23] canonical wrapper — the signal/window/points filters arrive
// through the bounded first-value-wins query projection; the point count is
// clamped server-side (32..20,000) so a caller can never inflate the read.
export const GET = authenticatedRoute({ query: true, querySelector: true, routeParams: ["id"] }, ({ context, meta, params }) => {
  const run = getRun(params!.id, spiceRunScopeFromContext(context));
  if (!run) return runNotFound();
  const query = meta.query ?? {};
  const signal = query.signal;
  if (!signal) return Response.json({ ok: true, signals: run.waveforms.map((waveform) => ({ name: waveform.name, unit: waveform.unit, xName: waveform.xName, xUnit: waveform.xUnit, points: waveform.x.length })) }, { headers: { "Cache-Control": "no-store" } });
  const waveform = run.waveforms.find((candidate) => candidate.name === signal);
  if (!waveform) return Response.json({ ok: false, error: "Signal not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const fromRaw = query.from;
  const toRaw = query.to;
  const from = fromRaw === undefined ? undefined : Number(fromRaw);
  const to = toRaw === undefined ? undefined : Number(toRaw);
  const points = Math.max(32, Math.min(20_000, Number(query.points ?? 2000)));
  const sliced = sliceWaveform(waveform, Number.isFinite(from) ? from : undefined, Number.isFinite(to) ? to : undefined);
  const sampled = downsampleMinMax(sliced.x, sliced.y, points);
  return Response.json({ ok: true, waveform: { id: waveform.id, name: waveform.name, unit: waveform.unit, xName: waveform.xName, xUnit: waveform.xUnit, ...sampled, rawPoints: sliced.x.length } }, { headers: { "Cache-Control": "no-store" } });
});
