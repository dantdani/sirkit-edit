import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import JSZip from "jszip";
import { getRun } from "@/app/lib/spice/server/job-store";
import { authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { runNotFound, spiceRunScopeFromContext } from "../../_scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [B16.0.2 §B] authorize BEFORE any artifact read; the run is resolved
// ONLY inside the trusted scope (uniform 404 otherwise). The anchor-download
// surface carries the project selector in the query string.
// [B16.0.23] canonical wrapper — selector parsing in the wrapper; the bundle
// includes ONLY this run's recorded artifacts, and the raw-vector read stays
// confined under the server-owned artifact root (path-prefix check below).
export const GET = authenticatedRoute({ querySelector: true, routeParams: ["id"] }, async ({ context, params }) => {
  const run = getRun(params!.id, spiceRunScopeFromContext(context));
  if (!run) return runNotFound();
  if (!run.manifest || !run.netlist) return Response.json({ ok: false, error: "Run has no reproducibility artifacts" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(run.manifest, null, 2));
  zip.file("netlist/generated.cir", run.netlist.generated);
  zip.file("netlist/normalized.cir", run.netlist.normalized);
  zip.file("netlist/executed.cir", run.netlist.executed);
  zip.file("netlist/source-map.json", JSON.stringify(run.netlist.sourceMap, null, 2));
  zip.file("results/scalars.json", JSON.stringify(run.scalars, null, 2));
  zip.file("results/waveforms.json", JSON.stringify(run.waveforms));
  zip.file("logs/stdout.log", run.stdout);
  zip.file("logs/stderr.log", run.stderr);
  zip.file("diagnostics.json", JSON.stringify(run.diagnostics, null, 2));
  zip.file("README.txt", `Sirkit SPICE Studio reproducibility bundle\n\nRun: ${run.id}\nManifest: ${run.manifest.id}\nSimulator: ${run.manifest.simulator.version}\nNetlist SHA-256: ${run.manifest.netlistChecksum}\n\nThe executed netlist, source map, logs, measurements, and raw vectors are preserved. Re-run with the same ngspice version and compare scalar results within the tolerance defined by your test suite.\n`);
  if (run.artifactId) {
    const root = resolve(join(tmpdir(), "sirkit-spice"));
    const artifact = resolve(run.artifactId);
    if (artifact.startsWith(`${root}${sep}`)) {
      const raw = await readFile(join(artifact, "result.raw")).catch(() => null);
      if (raw) zip.file("results/result.raw", raw);
    }
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="sirkit-spice-${run.id}.zip"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
});
