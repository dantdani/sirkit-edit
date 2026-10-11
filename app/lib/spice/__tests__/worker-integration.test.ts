import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"; import { assertLiveResources } from "../../evaluation/live-suites"; // [B24-B3, 2026-10-08] D24-19, OD-209: the resource gate (the pinned ngspice install on a win32-x64 host), on this line so no line moves
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import JSZip from "jszip";
import { createSimulationProject } from "../project";
import { estimateRunPlan } from "../run-plan";
import { executeRunPoint } from "../server/worker";
import { getBatch, getRun, startRunPlan } from "../server/job-store";
import { dividerSchematic } from "./fixtures";
import { importModelText } from "../models";
import { GET as getBundle } from "@/app/api/spice/runs/[id]/bundle/route";
import { GET as getWaveform } from "@/app/api/spice/runs/[id]/waveforms/route";
import { POST as smokeModel } from "@/app/api/spice/models/smoke-test/route";

const LIVE = process.env.SPICE_WORKER_LIVE === "1";

// [B16.0.2 §B] every run is bound to a TRUSTED scope and every route is
// authenticated + project-scoped: the test acts as an editor of this project.
const SCOPE = { tenantId: "local", projectId: "spice-worker-project", branchId: "main" };
const SELECTOR = { "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId };

describe.runIf(LIVE)("isolated ngspice worker", () => { // [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): no isolation boundary - the worker's points run on the diagnostic runner, a diagnostic local process (B22-A3)]
  beforeEach(() => { injectAuthorizedPrincipal({ userId: "spice-worker-editor", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" }); });
  afterEach(() => { resetInjectedIdentity(); });

  it("creates a manifest, executes, parses waveforms, and retains artifacts", async () => {
    const project = createSimulationProject(dividerSchematic());
    const test = project.tests[0];
    test.analyses = [{ id: "tran", name: "Transient", type: "tran", outputStep: "10u", stopTime: "1m", maxStep: "10u", enabled: true }];
    test.outputs = [{ id: "vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
    const plan = project.runPlans[0];
    const point = estimateRunPlan(project, plan.id).runPoints[0];
    const events: string[] = [];
    const result = await executeRunPoint({
      runId: "integration-run",
      project,
      runPlanId: plan.id,
      runPoint: point,
      parts: [],
      signal: new AbortController().signal,
      limits: { timeoutMs: 15_000 },
      onEvent: (event) => events.push(event.status),
    });
    expect(result.status).toBe("completed");
    expect(result.manifest?.netlistChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(result.waveforms?.some((waveform) => waveform.name.toLowerCase() === "v(vin)")).toBe(true);
    expect(result.artifactId).toMatch(/^diagrun_[0-9a-f-]{36}$/); // [B22-A3] reviewed pin move: the diagnostic runner's opaque run id, never a host path (was the artifact directory under sirkit-spice, D22-8); this opt-in suite also needs SIRKIT_NGSPICE_INSTALL_ROOT and SIRKIT_NGSPICE_INSTALL_SHA256
    expect(events).toContain("post-processing");
  }, 30_000);

  it("runs through the queued job lifecycle", async () => {
    const project = createSimulationProject(dividerSchematic());
    const test = project.tests[0];
    test.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
    test.outputs = [{ id: "vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
    const batch = startRunPlan({ scope: SCOPE, project, runPlanId: project.runPlans[0].id, maxRuns: 10 });
    let run = getRun(batch.runIds[0], SCOPE);
    const deadline = Date.now() + 10_000;
    while (run && !["completed", "failed", "cancelled"].includes(run.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      run = getRun(batch.runIds[0], SCOPE);
    }
    expect(run?.status).toBe("completed");
    expect(run?.events.map((event) => event.status)).toContain("running");
    expect(run?.manifest?.simulator.name).toBe("ngspice");
    expect(getBatch(batch.id, SCOPE)?.completed).toBe(1);
    const bundleResponse = await getBundle(new Request(`http://localhost/api/spice/runs/${run!.id}/bundle`, { headers: SELECTOR }), { params: Promise.resolve({ id: run!.id }) });
    expect(bundleResponse.status).toBe(200);
    const zip = await JSZip.loadAsync(await bundleResponse.arrayBuffer());
    expect(Object.keys(zip.files)).toContain("manifest.json");
    expect(Object.keys(zip.files)).toContain("netlist/executed.cir");
    const signal = run!.waveforms[0].name;
    const waveformResponse = await getWaveform(new Request(`http://localhost/api/spice/runs/${run!.id}/waveforms?signal=${encodeURIComponent(signal)}&points=64`, { headers: SELECTOR }), { params: Promise.resolve({ id: run!.id }) });
    const waveformBody = await waveformResponse.json() as { waveform: { x: number[]; rawPoints: number } };
    expect(waveformBody.waveform.x.length).toBeLessThanOrEqual(66);
    expect(waveformBody.waveform.rawPoints).toBeGreaterThan(0);
  }, 15_000);

  it("promotes a parsed model only after an isolated smoke test", async () => { // [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): not isolated - the smoke run is a diagnostic local process with no isolation boundary (B22-A3)]
    const imported = importModelText("diode.mod", ".model DTEST D(IS=1e-9 N=1.5)\n");
    const response = await smokeModel(new Request("http://localhost/api/spice/models/smoke-test", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost", ...SELECTOR },
      body: JSON.stringify({ model: imported.candidate }),
    }));
    const body = await response.json() as { ok: boolean; model: { validationStatus: string }; check: { status: string } };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.check.status).toBe("pass");
    expect(body.model.validationStatus).toBe("smoke-tested");
  }, 15_000);
  beforeAll(() => assertLiveResources("worker-integration")); // [B24-B3, 2026-10-08] with SPICE_WORKER_LIVE=1 and the pin or the host absent this block fails NOT EXERCISED before any case body runs, never a runner error
});
