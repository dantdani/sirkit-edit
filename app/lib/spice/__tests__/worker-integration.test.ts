import { describe, expect, it } from "vitest";
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

describe.runIf(LIVE)("isolated ngspice worker", () => {
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
    expect(result.artifactId).toContain("sirkit-spice");
    expect(events).toContain("post-processing");
  }, 30_000);

  it("runs through the queued job lifecycle", async () => {
    const project = createSimulationProject(dividerSchematic());
    const test = project.tests[0];
    test.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
    test.outputs = [{ id: "vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
    const batch = startRunPlan({ project, runPlanId: project.runPlans[0].id, maxRuns: 10 });
    let run = getRun(batch.runIds[0]);
    const deadline = Date.now() + 10_000;
    while (run && !["completed", "failed", "cancelled"].includes(run.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      run = getRun(batch.runIds[0]);
    }
    expect(run?.status).toBe("completed");
    expect(run?.events.map((event) => event.status)).toContain("running");
    expect(run?.manifest?.simulator.name).toBe("ngspice");
    expect(getBatch(batch.id)?.completed).toBe(1);
    const bundleResponse = await getBundle(new Request(`http://localhost/api/spice/runs/${run!.id}/bundle`), { params: Promise.resolve({ id: run!.id }) });
    expect(bundleResponse.status).toBe(200);
    const zip = await JSZip.loadAsync(await bundleResponse.arrayBuffer());
    expect(Object.keys(zip.files)).toContain("manifest.json");
    expect(Object.keys(zip.files)).toContain("netlist/executed.cir");
    const signal = run!.waveforms[0].name;
    const waveformResponse = await getWaveform(new Request(`http://localhost/api/spice/runs/${run!.id}/waveforms?signal=${encodeURIComponent(signal)}&points=64`), { params: Promise.resolve({ id: run!.id }) });
    const waveformBody = await waveformResponse.json() as { waveform: { x: number[]; rawPoints: number } };
    expect(waveformBody.waveform.x.length).toBeLessThanOrEqual(66);
    expect(waveformBody.waveform.rawPoints).toBeGreaterThan(0);
  }, 15_000);

  it("promotes a parsed model only after an isolated smoke test", async () => {
    const imported = importModelText("diode.mod", ".model DTEST D(IS=1e-9 N=1.5)\n");
    const response = await smokeModel(new Request("http://localhost/api/spice/models/smoke-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: imported.candidate }),
    }));
    const body = await response.json() as { ok: boolean; model: { validationStatus: string }; check: { status: string } };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.check.status).toBe("pass");
    expect(body.model.validationStatus).toBe("smoke-tested");
  }, 15_000);
});
