/**
 * [B22-C] The dropped results (discovery D22-7; 9.5 item 18; runbook :147 "never invent a pass", :933 "results are evidence"). The
 * worker emits its own `completed` event before it returns its result, and the job store published that status at once: the record
 * became terminal, so the store's late-settle guard dropped the result - a completed run kept the empty initial record (no
 * waveforms, scalars, manifest, netlist or `finishedAt`) while the batch counted it completed. The studio closes its EventSource at
 * the first terminal record (`SpiceStudio.tsx`) and the events route closes the stream there (`events/route.ts`), so the browser
 * never saw the data. Now the store holds the worker's terminal event, attaches the result (and the server-built evidence document)
 * first, and only then publishes the terminal status; the batch counts a run completed only with its evidence.
 *
 * Test-first: cases 1-6 ran RED on b4c7be7 (the counterexample: the worker below emits `completed` through `onEvent` exactly as
 * the real worker does, which neither the B16.0.23 parity fake nor SEC-1's suite ever reached; case 5 is the second counterexample:
 * the late worker's own completed event reopened a cancelled record as completed). The worker is an in-process fake; no process,
 * file, network or model.
 *
 * [B22-C review] One truth for a run and its batch: a name the studio lets a user clear is evidence like any other (case 7,
 * regressions-4), and a document the closed evidence rules still refuse fails the run itself with a closed reason before any
 * terminal event (cases 3 and 8: security-4, coverage-5, tests-2); the record stays non-terminal while a bound store appends, so no
 * reader sees a terminal record before its evidence settles (case 9: coverage-6, tests-1); the snapshot digest binds the
 * server-derived scope (case 6, coverage-7). Those assertions ran RED on the reviewed tree; the store's failure branches (case 10,
 * tests-6) and the model-library references (case 6, tests-4) were green there and each was proved by a deliberate source
 * breakage.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workerState = vi.hoisted(() => ({
  mode: "result" as "result" | "no-manifest" | "throws-after-completed" | "empty-name" | "long-name",
  gates: [] as Array<() => void>,
  honorAbort: true,
}));
vi.mock("@/app/lib/spice/server/worker", () => ({
  executeRunPoint: async (input: { runId: string; signal: AbortSignal; onEvent(event: { status: string; progress: number; message: string }): void }) => {
    input.onEvent({ status: "running", progress: 45, message: "ngspice is solving" });
    const aborted = await new Promise<boolean>((resolve) => {
      workerState.gates.push(() => resolve(false));
      if (workerState.honorAbort) input.signal.addEventListener("abort", () => resolve(true), { once: true });
    });
    if (aborted) return { status: "cancelled", progress: 100, diagnostics: [], stdout: "", stderr: "" };
    // exactly as the real worker (worker.ts): the terminal event first, then the result
    input.onEvent({ status: "completed", progress: 100, message: "Completed with 1 waveform(s) and 1 scalar result(s)" });
    if (workerState.mode === "throws-after-completed") throw new Error("post-processing failed after the completed event");
    const hex = (c: string) => c.repeat(64);
    const manifest = {
      id: "manifest_b22c", projectId: "proj", projectRevision: 1, designRevisionId: "design", testId: "test", testRevision: 1, runPlanId: "plan",
      runPoint: { id: "point", label: "nominal" }, modelChecksums: { "model-1": hex("9") }, schematicHash: "fnv", netlistChecksum: hex("a"),
      analysis: { id: "op", name: "Operating point", type: "op", enabled: true }, solverProfile: { name: "default" },
      simulator: { name: "ngspice", version: "ngspice-46 (b22-c fake)", mode: "subprocess", runner: { profileId: "ngspice-local-diagnostic", profileDigest: hex("b"), installDigest: `sirkit-install-tree-sha256/1:${hex("c")}`, labels: ["diagnostic_only", "environment_dependent"], seed: "1", hostAddedEnvironment: [] } },
      rawOutput: { sha256: hex("d"), bytes: 120 }, createdAt: "2026-10-02T00:00:00.000Z",
    };
    return {
      status: "completed", progress: 100,
      ...(workerState.mode === "no-manifest" ? {} : { manifest, netlist: { generated: "* g", normalized: "* n", executed: "* e", sourceMap: [], nodeMap: {}, pinNodes: {}, warnings: [] } }),
      waveforms: [{ id: "w1", name: "v(out)", unit: "V", xName: "time", xUnit: "s", x: [0, 0.001], y: [0, 1], sourceRefs: [] }],
      // [B22-C review] a measurement the studio lets a user rename to "" (empty-name), or a name over the evidence text bound (long-name)
      scalars: [{ id: "s1", runId: input.runId, measurementId: "m1", name: workerState.mode === "empty-name" ? "" : workerState.mode === "long-name" ? "x".repeat(5_000) : "VOUT", value: 1, unit: "V", status: "pass" }],
      diagnostics: [], stdout: "", stderr: "", artifactId: "diagrun_00000000-0000-4000-8000-000000000000",
    };
  },
}));

import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { __resetJobStoreForTests, cancelRun, getBatch, getRun, startRunPlan, subscribeRun } from "@/app/lib/spice/server/job-store";
import { createSimulationProject } from "@/app/lib/spice/project";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";
import type { RunRecord } from "@/app/lib/spice/types";
import { GET as eventsGet } from "@/app/api/spice/runs/[id]/events/route";

const SCOPE = { tenantId: "local", projectId: "proj-1", branchId: "main" };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");
function seedProject(plan: { runs?: number; stopOnFailure?: boolean } = {}) {
  const project = createSimulationProject(dividerSchematic());
  const test = project.tests[0]!;
  test.analyses = Array.from({ length: plan.runs ?? 1 }, (_, index) => ({ id: index === 0 ? "op" : `op${index + 1}`, name: "Operating point", type: "op" as const, enabled: true }));
  test.outputs = [{ id: "vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
  if (plan.stopOnFailure) Object.assign(project.runPlans[0]!, { stopOnFailure: true, concurrency: 1 });
  return project;
}
function start(extra: Record<string, unknown> = {}, plan: { runs?: number; stopOnFailure?: boolean } = {}) {
  const project = seedProject(plan);
  const batch = startRunPlan({ scope: SCOPE, project, runPlanId: project.runPlans[0]!.id, ...extra } as Parameters<typeof startRunPlan>[0]);
  return { project, batch, runId: batch.runIds[0]! };
}
async function release(): Promise<void> {
  await flush();
  for (const open of workerState.gates.splice(0)) open();
  for (let round = 0; round < 5; round += 1) await flush();
}

beforeEach(() => { __resetJobStoreForTests(); });
afterEach(() => {
  __resetJobStoreForTests();
  resetInjectedIdentity();
  workerState.mode = "result";
  workerState.gates = [];
  workerState.honorAbort = true;
});

describe("[B22-C] the job store attaches the result before it publishes the terminal status (D22-7)", () => {
  it("1. a completed run carries its result, its manifest and finishedAt (pre-edit: the worker's completed event made the record terminal first and the result was dropped)", async () => {
    const { runId } = start();
    await release();
    const run = getRun(runId, SCOPE)!;
    expect(run.status).toBe("completed");
    expect(run.waveforms.map((waveform) => waveform.name)).toEqual(["v(out)"]);
    expect(run.scalars.map((scalar) => scalar.name)).toEqual(["VOUT"]);
    expect(run.manifest?.id).toBe("manifest_b22c");
    expect(run.netlist?.executed).toBe("* e");
    expect(typeof run.finishedAt).toBe("string");
    // the worker's own terminal event is kept, once, as the record's last event
    expect(run.events.map((event) => event.status)).toEqual(["queued", "running", "completed"]);
    expect(run.events.at(-1)!.message).toBe("Completed with 1 waveform(s) and 1 scalar result(s)");
  });

  it("2. the first terminal record a subscriber receives carries the result: the store's listener and the events route's SSE stream, which (like the studio) stop at the first terminal record", async () => {
    // the consequence pinned: both readers stop at the first terminal record, so it must already hold the result
    const events = read("app/api/spice/runs/[id]/events/route.ts");
    expect(events).toMatch(/if \(terminal\.has\(run\.status\)\) \{\s*unsubscribe\?\.\(\);\s*controller\.close\(\);/);
    expect(read("app/components/spice/SpiceStudio.tsx")).toContain('if (["completed", "failed", "cancelled"].includes(run.status)) { source.close(); eventSourcesRef.current.delete(runId); }');
    const { runId } = start();
    const seen: RunRecord[] = [];
    subscribeRun(runId, SCOPE, (record) => seen.push(record));
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" });
    const response = await eventsGet(new Request(`http://localhost/api/spice/runs/${runId}/events?tenantId=local&projectId=proj-1&branchId=main`), { params: Promise.resolve({ id: runId }) });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const frames: RunRecord[] = [];
    const reading = (async () => {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        const text = new TextDecoder().decode(chunk.value);
        const data = text.split(String.fromCharCode(10)).find((line) => line.startsWith("data: "));
        if (data) frames.push(JSON.parse(data.slice("data: ".length)) as RunRecord);
      }
    })();
    await release();
    await reading;
    const firstTerminal = seen.find((record) => ["completed", "failed", "cancelled"].includes(record.status))!;
    expect(firstTerminal.status).toBe("completed");
    expect(firstTerminal.waveforms).toHaveLength(1);
    expect(firstTerminal.manifest?.id).toBe("manifest_b22c");
    expect(typeof firstTerminal.finishedAt).toBe("string");
    const last = frames.at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.waveforms).toHaveLength(1);
    expect(last.scalars).toHaveLength(1);
    expect(typeof last.finishedAt).toBe("string");
    expect(frames.filter((frame) => frame.status === "completed")).toHaveLength(1);
  });

  it("3. the batch counts only runs with evidence: a run with its manifest is completed; a completion without its evidence is never counted completed", async () => {
    const good = start();
    await release();
    const batch = getBatch(good.batch.id, SCOPE)!;
    expect([batch.status, batch.completed, batch.failed]).toEqual(["completed", 1, 0]);
    expect(getRun(good.runId, SCOPE)!.evidence?.document.subjectId).toBe(good.runId);
    __resetJobStoreForTests();
    workerState.mode = "no-manifest";
    const bare = start();
    await release();
    const bareBatch = getBatch(bare.batch.id, SCOPE)!;
    expect(bareBatch.completed).toBe(0);
    expect(bareBatch.failed).toBe(1);
    expect(bareBatch.status).toBe("failed");
    expect(getRun(bare.runId, SCOPE)!.evidence).toBeUndefined();
    // [B22-C review] tests-2, coverage-5: the run itself says what its batch says - failed with a closed reason, never "completed"
    expect(getRun(bare.runId, SCOPE)!.status).toBe("failed");
    expect(getRun(bare.runId, SCOPE)!.error).toMatch(/^EVIDENCE_DOCUMENT_REFUSED: /);
  });

  it("4. a worker that emits completed and then throws ends failed with its error, never completed (pre-edit: the held-open terminal record kept 'completed' with no data)", async () => {
    workerState.mode = "throws-after-completed";
    const { runId, batch } = start();
    await release();
    const run = getRun(runId, SCOPE)!;
    expect(run.status).toBe("failed");
    expect(run.error).toBe("post-processing failed after the completed event");
    expect(run.events.map((event) => event.status)).not.toContain("completed");
    expect(getBatch(batch.id, SCOPE)!.completed).toBe(0);
  });

  it("5. the B16.0.23 terminal guard still holds on both settle paths: a cancelled run is never overwritten by a late completion, and its held completed event is never published", async () => {
    expect(read("app/lib/spice/server/job-store.ts").match(/if \(TERMINAL\.has\(job\.record\.status\)\) return;/g)).toHaveLength(2);
    workerState.honorAbort = false;
    const { runId } = start();
    await flush();
    expect(cancelRun(runId, SCOPE)).toBe(true);
    await release();
    const run = getRun(runId, SCOPE)!;
    expect(run.status).toBe("cancelled");
    expect(run.waveforms).toEqual([]);
    expect(run.manifest).toBeUndefined();
    expect(run.events.map((event) => event.status)).not.toContain("completed");
  });

  it("6. the terminal record carries the server-built evidence document, digest-bound and bound to the submitted snapshot; with an evidence store bound the document is appended before the terminal status is published", async () => {
    const evidence = await import("@/app/lib/computation/evidence-store");
    const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
    const { durableWorkflowDigest } = await import("@/app/lib/durable-workflow/stable");
    // unbound: the document rides on the record, labelled not recorded
    const unbound = start();
    await release();
    const record = getRun(unbound.runId, SCOPE)!.evidence!;
    expect(record.aggregateType).toBe("computation.evidence.v1");
    expect(record.documentDigest).toBe(durableWorkflowDigest(record.document));
    expect(evidence.validateEvidenceDocument(record.document)).toEqual([]);
    expect(record.document.labels).toEqual(["diagnostic_only", "environment_dependent"]);
    // [B22-C review] coverage-7: the snapshot digest binds the server-derived scope with the submitted, validated snapshot (OD-142)
    expect(record.document.input).toEqual({ binding: "bound to a submitted snapshot", snapshotSha256: evidence.submittedSnapshotDigest({ scope: SCOPE, project: unbound.project, runPlanId: unbound.project.runPlans[0]!.id, parts: [] }) });
    expect(record.document.input.snapshotSha256).not.toBe(evidence.submittedSnapshotDigest({ project: unbound.project, runPlanId: unbound.project.runPlans[0]!.id, parts: [] }));
    // [B22-C review] tests-4: each model library is named by the SHA-256 the manifest holds for the text its deck carries
    expect(record.document.modelLibraries).toEqual([{ id: "model-1", contentRef: `artifact://sha256/${"9".repeat(64)}` }]);
    expect(record.document.profile).toEqual({ profileId: "ngspice-local-diagnostic", profileDigest: "b".repeat(64), installDigest: `sirkit-install-tree-sha256/1:${"c".repeat(64)}`, seed: "1" });
    expect(record.document.rawArtifacts).toEqual([{ role: "executed-netlist", sha256: "a".repeat(64), bytes: null }, { role: "ngspice-ascii-raw", sha256: "d".repeat(64), bytes: 120 }]);
    const values = createHash("sha256").update(evidence.evidenceValuesText([0, 0.001], [0, 1])).digest("hex");
    expect(record.document.summary.waveforms).toEqual([{ name: "v(out)", unit: "V", xName: "time", xUnit: "s", points: 2, valuesSha256: values }]);
    expect(record.document.summary.scalars).toEqual([{ name: "VOUT", unit: "V", status: "pass", value: { state: "finite", value: 1 } }]);
    expect(record.durable).toEqual({ state: "not_recorded", reason: "EVIDENCE_STORE_UNBOUND" });
    // bound: appended once, before the terminal record is published, and re-verified on load
    __resetJobStoreForTests();
    const repository = new InMemoryDurableWorkflowRepository();
    const store = evidence.createComputationEvidenceStore(repository);
    const bound = start({ evidenceStore: store });
    const published: RunRecord[] = [];
    subscribeRun(bound.runId, SCOPE, (next) => published.push(next));
    await release();
    const firstTerminal = published.find((next) => next.status === "completed")!;
    expect(firstTerminal.evidence?.durable).toMatchObject({ state: "recorded", revision: 1 });
    const loaded = await store.load(SCOPE, bound.runId);
    expect(loaded?.revision).toBe(1);
    expect(loaded?.documentDigest).toBe(firstTerminal.evidence!.documentDigest);
    expect(await repository.listOutbox({ scope: SCOPE })).toEqual([]);
  });

  it("7. [B22-C review] regressions-4: a measurement the studio lets a user rename to \"\" is evidence like any other name - the run completes with its evidence and its batch counts it completed", async () => {
    workerState.mode = "empty-name";
    const unnamed = start();
    await release();
    expect(getRun(unnamed.runId, SCOPE)!.status).toBe("completed");
    expect(getRun(unnamed.runId, SCOPE)!.evidence?.document.summary.scalars.map((scalar) => scalar.name)).toEqual([""]);
    expect(getBatch(unnamed.batch.id, SCOPE)).toMatchObject({ status: "completed", completed: 1, failed: 0 });
  });

  it("8. [B22-C review] security-4, coverage-5, tests-2: a document the closed evidence rules still refuse fails the run itself, with a closed reason, before any terminal event - the record, its stream, the batch and stopOnFailure agree", async () => {
    // a name over the evidence text bound: the run is failed - its validated output, logs and manifest stay on the record for
    // inspection, but it is no completion and carries no evidence
    workerState.mode = "long-name";
    const refused = start({}, { runs: 2, stopOnFailure: true });
    const frames: RunRecord[] = [];
    subscribeRun(refused.runId, SCOPE, (record) => frames.push(record));
    await release();
    const run = getRun(refused.runId, SCOPE)!;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/^EVIDENCE_DOCUMENT_REFUSED: /);
    expect(run.error).not.toContain("x".repeat(100));
    expect(run.evidence).toBeUndefined();
    expect([run.waveforms.length, run.scalars.length]).toEqual([1, 1]);
    expect(run.manifest?.id).toBe("manifest_b22c");
    expect(run.events.map((event) => event.status)).toEqual(["queued", "running", "failed"]);
    expect(frames.filter((frame) => frame.status === "completed")).toEqual([]);
    expect(frames.at(-1)!.status).toBe("failed");
    expect(getRun(refused.batch.runIds[1]!, SCOPE)!.status).toBe("cancelled"); // stopOnFailure fired on the run's own status
    expect(getBatch(refused.batch.id, SCOPE)).toMatchObject({ status: "failed", completed: 0, failed: 1, cancelled: 1 });
    // [B22-C lead] the check's new issue: the failed run keeps its scalars for inspection, but no report cell and no comparison reads
    // a verdict from a run that did not complete (pre-edit: the report showed the kept 'pass' as PASS for a failed run)
    const { buildSpiceReport, compareRunRecords } = await import("@/app/lib/spice/report");
    const project = structuredClone(refused.project);
    project.tests[0]!.specifications.push({ id: "spec_b22c_lead", name: "VOUT", measurementId: "m1", comparison: "<=", limit: 2, unit: "V", severity: "error", applicableTestIds: [project.tests[0]!.id], enabled: true });
    const failedWithVerdict: RunRecord = { ...run, scalars: run.scalars.map((scalar) => ({ ...scalar, specificationId: "spec_b22c_lead" })) };
    expect(failedWithVerdict.scalars[0]!.status).toBe("pass");
    const cell = buildSpiceReport(project, [failedWithVerdict]).specificationMatrix[0]!.cells[0]!;
    expect(cell).toMatchObject({ status: "not-evaluated" });
    expect(cell.value).toBeUndefined();
    const completedTwin: RunRecord = { ...failedWithVerdict, id: "run_b22c_completed", status: "completed" };
    expect(buildSpiceReport(project, [completedTwin]).specificationMatrix[0]!.cells[0]!).toMatchObject({ status: "pass", value: 1 });
    expect(compareRunRecords(completedTwin, failedWithVerdict).scalarChanges.every((change) => change.statusAfter === "not-evaluated" && change.after === undefined)).toBe(true);
  });

  it("9. [B22-C review] coverage-6, tests-1: with a bound store, no reader sees a terminal record while the append is pending - not getRun, not a subscriber that joins in the window, not the batch", async () => {
    const evidence = await import("@/app/lib/computation/evidence-store");
    const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
    // the events route closes its stream at the first terminal record, so a subscriber joining in the window must not get one
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const gatedStore = evidence.createComputationEvidenceStore(new InMemoryDurableWorkflowRepository());
    const slow = start({ evidenceStore: { append: async (request: Parameters<typeof gatedStore.append>[0]) => { await gate; return gatedStore.append(request); } } });
    await release();
    const terminal = ["completed", "failed", "cancelled"];
    const during = getRun(slow.runId, SCOPE)!;
    expect(terminal).not.toContain(during.status);
    expect(during.finishedAt).toBeUndefined();
    const late: RunRecord[] = [];
    subscribeRun(slow.runId, SCOPE, (next) => late.push(next));
    expect(terminal).not.toContain(late[0]!.status);
    expect(getBatch(slow.batch.id, SCOPE)!.status).not.toBe("completed");
    expect(getBatch(slow.batch.id, SCOPE)!.finishedAt).toBeUndefined();
    open();
    for (let round = 0; round < 5; round += 1) await flush();
    expect(getRun(slow.runId, SCOPE)!.status).toBe("completed");
    // every terminal frame the late subscriber gets (the event's, then the settle's) already carries the recorded evidence
    const terminalFrames = late.filter((next) => terminal.includes(next.status));
    expect(terminalFrames.length).toBeGreaterThan(0);
    for (const frame of terminalFrames) expect([frame.status, frame.evidence?.durable]).toMatchObject(["completed", { state: "recorded", revision: 1 }]);
    expect(getRun(slow.runId, SCOPE)!.events.filter((event) => event.status === "completed")).toHaveLength(1);
    expect(getBatch(slow.batch.id, SCOPE)).toMatchObject({ status: "completed", completed: 1 });
  });

  it("10. [B22-C review] tests-6: a store that throws, answers a stale revision or refuses the document leaves the run completed with its evidence document, a closed durable reason and exactly one completed event", async () => {
    for (const [label, append, reason] of [
      ["throws", async () => { throw new Error("evidence store unavailable"); }, "EVIDENCE_STORE_UNAVAILABLE"],
      ["stale", async () => ({ ok: false as const, code: "stale_revision" as const, currentRevision: 1 }), "EVIDENCE_STALE_REVISION"],
      ["invalid", async () => ({ ok: false as const, code: "invalid_document" as const, problems: ["$"] }), "EVIDENCE_DOCUMENT_REFUSED"],
    ] as const) {
      __resetJobStoreForTests();
      const stubbed = start({ evidenceStore: { append } });
      await release();
      const settled = getRun(stubbed.runId, SCOPE)!;
      expect(settled.status, label).toBe("completed");
      expect(settled.evidence?.durable, label).toEqual({ state: "not_recorded", reason });
      expect(settled.events.filter((event) => event.status === "completed"), label).toHaveLength(1);
      expect(getBatch(stubbed.batch.id, SCOPE), label).toMatchObject({ status: "completed", completed: 1, failed: 0 });
    }
  });
});
