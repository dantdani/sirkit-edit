import JSZip from "jszip";
import { getRun } from "@/app/lib/spice/server/job-store";
import { authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { runNotFound, spiceRunScopeFromContext } from "../../_scope";
import { DIAGNOSTIC_OUTPUT_MAX_BYTES, OUTPUT_TRUNCATION_MARKER } from "@/app/lib/computation/output-bounds"; // [B22-A1 review] regressions-4: the README states the logs' bound
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [B16.0.2 §B] authorize BEFORE any artifact read; the run is resolved
// ONLY inside the trusted scope (uniform 404 otherwise). The anchor-download
// surface carries the project selector in the query string.
// [B16.0.23] canonical wrapper — selector parsing in the wrapper; the bundle
// includes ONLY this run's recorded artifacts. [B22-A3] It reads no file: the
// diagnostic runner removes each run directory on every path and a record's
// artifact id is an opaque run id, never a host path (D22-8), so the former
// whole read of `result.raw` from the artifact directory is gone; the parsed
// waveforms are the record's. [B22-A3 review] regressions-3: the raw file's
// SHA-256 and size travel in the manifest (`rawOutput`) and the README names them.
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
  zip.file("README.txt", `Sirkit SPICE Studio reproducibility bundle\n\nRun: ${run.id}\nManifest: ${run.manifest.id}\nSimulator: ${run.manifest.simulator.version}\nNetlist SHA-256: ${run.manifest.netlistChecksum}\n\nThe executed netlist, source map, measurements and parsed waveforms are preserved; the raw ngspice file is not (the diagnostic runner removes each run's directory) - its SHA-256 and size are in manifest.json (rawOutput: ${run.manifest.rawOutput ? `${run.manifest.rawOutput.sha256}, ${run.manifest.rawOutput.bytes} bytes` : "none read"}), so a re-run can be compared byte for byte, and the parsed waveforms drop the non-finite values ngspice may write. The run is diagnostic only and environment dependent. The logs are the run record's, each bounded to its last ${DIAGNOSTIC_OUTPUT_MAX_BYTES / 1024} KiB; a cut log opens with "${OUTPUT_TRUNCATION_MARKER.trim()}". Re-run with the same ngspice version and compare scalar results within the tolerance defined by your test suite.\n`); // [B22-A1 review] regressions-4: the logs are no longer said to be preserved whole (the worker bounds what a record carries, D22-4)
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
