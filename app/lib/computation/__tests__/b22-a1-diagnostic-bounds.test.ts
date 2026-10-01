/**
 * [B22-A1] D22-4 / D22-8 - the diagnostic text channels ngspice output reaches a caller through are bounded: the stdout and
 * stderr the SPICE smoke test returns (smoke-test/route.ts:103), and the log events, failure message and stdout/stderr a
 * SPICE run record carries (worker.ts:186, :193-200, :207-218, :243-244). One byte bound decides them
 * (`DIAGNOSTIC_OUTPUT_MAX_BYTES`, 64 KiB per channel; a log event and a failure message get `DIAGNOSTIC_EXCERPT_MAX_BYTES`,
 * a sixty-fourth of it - [B22-A1 review] regressions-3: at or below the 1,500- and 3,000-character bounds they replace), the
 * tail is kept (where a failure prints), and an explicit marker opens any cut text. [B22-A1 review] The timed-out result is
 * bounded too (coverage-5, tests-4), and the reproducibility bundle says its logs are the record's bounded logs (regressions-4).
 *
 * Test-first: every bound case was run RED on the unmodified tree 0432fb8 (the smoke test returned up to 100,000 characters
 * per channel with no marker; a run record carried up to the worker's 100 MB output limit per channel, a 3,000-character
 * failure message and 1,500-character log events, none marked). RECORDED, not closed: a bounded channel still carries what
 * ngspice printed, up to the bound.
 *
 * ngspice is NOT executed: `node:child_process` and `node:fs/promises` are in-process fakes; the fake child prints the scripted
 * output and exits with the scripted code.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const proc = vi.hoisted(() => ({
  script: { stdout: "", stderr: "", code: 0 as number | null, hang: false, afterSpawn: null as null | (() => void) },
  calls: [] as Array<{ args: readonly string[] }>,
}));
vi.mock("node:child_process", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (_command: string, args: readonly string[]) => {
      proc.calls.push({ args: [...args] });
      const child = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>; kill: () => void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      let closed = false;
      const close = (code: number | null) => { if (!closed) { closed = true; child.emit("close", code); } };
      child.kill = () => { queueMicrotask(() => close(null)); };
      if (args[0] === "-v") {
        queueMicrotask(() => { child.stdout.emit("data", Buffer.from("ngspice-46 : Circuit level simulation program\n")); close(0); });
        return child;
      }
      const { stdout, stderr, code, hang, afterSpawn } = proc.script;
      queueMicrotask(() => {
        if (stdout) child.stdout.emit("data", Buffer.from(stdout));
        if (stderr) child.stderr.emit("data", Buffer.from(stderr));
        if (afterSpawn) setTimeout(afterSpawn, 0);
        if (!hang) close(code);
      });
      return child;
    },
  };
});
const fsState = vi.hoisted(() => ({ raw: null as string | null }));
vi.mock("node:fs/promises", async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  writeFile: async () => {},
  readFile: async () => {
    if (fsState.raw === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return fsState.raw;
  },
  mkdir: async () => undefined,
  mkdtemp: async (prefix: string) => `${prefix}fake`,
  rm: async () => {},
}));

import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as smokePost } from "@/app/api/spice/models/smoke-test/route";
import { importModelText } from "@/app/lib/spice/models";
import { createSimulationProject } from "@/app/lib/spice/project";
import { estimateRunPlan } from "@/app/lib/spice/run-plan";
import { executeRunPoint } from "@/app/lib/spice/server/worker";
import { POST as runsPost } from "@/app/api/spice/runs/route";
import { GET as bundleGet } from "@/app/api/spice/runs/[id]/bundle/route";
import { __resetJobStoreForTests, getRun } from "@/app/lib/spice/server/job-store";
import JSZip from "jszip";
import type { RunEvent, RunRecord } from "@/app/lib/spice/types";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";

/** The bounds this increment fixes (pinned against the module in the first case). */
const CHANNEL_MAX_BYTES = 65_536;
const EXCERPT_MAX_BYTES = 1_024;
const MARKER = "[SIRKIT: earlier output truncated]\n";
const TAIL = "TAIL-END-b22a1";
const bytes = (text: string): number => Buffer.byteLength(text, "utf8");
/** A channel's text of `size` characters ending in TAIL; `char` lets a case use a two-byte UTF-8 character. */
const output = (size: number, char = "x"): string => `${char.repeat(size)}${TAIL}`;
function expectBounded(text: string | undefined, maxBytes: number, label: string): void {
  expect(typeof text, label).toBe("string");
  expect(bytes(text!), `${label}: at most ${maxBytes} bytes`).toBeLessThanOrEqual(maxBytes);
  expect(text!.startsWith(MARKER), `${label}: opens with the truncation marker`).toBe(true);
  expect(text!.endsWith(TAIL), `${label}: keeps the tail`).toBe(true);
}

const SELECTOR = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-b22a1", "x-sirkit-branch-id": "main" };
function post(path: string, body: unknown): Request {
  injectAuthorizedPrincipal({ userId: "u-b22a1", tenantId: "local", projectId: "proj-b22a1", role: "editor" });
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SELECTOR }, body: JSON.stringify(body) });
}
const smokeModel = () => importModelText("dtest.lib", ".model DTEST D(IS=1e-14)\n").candidate;

/** The divider project with one transient analysis and one output. */
function dividerProject() {
  const project = createSimulationProject(dividerSchematic());
  const test = project.tests[0]!;
  test.analyses = [{ id: "tran", name: "Transient", type: "tran", outputStep: "10u", stopTime: "1m", enabled: true }];
  test.outputs = [{ id: "vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
  return project;
}
const RAW = "Title: demo\nPlotname: Transient Analysis\nFlags: real\nNo. Variables: 2\nNo. Points: 2\nVariables:\n  0 time time\n  1 v(vin) voltage\nValues:\n0 0\n 5\n1 1e-3\n 5\n";

/** One run point of the divider project, executed by the real worker against the fake ngspice. */
async function runWorker(signal = new AbortController().signal, limits = { timeoutMs: 5_000 }) {
  const project = dividerProject();
  const plan = project.runPlans[0]!;
  const point = estimateRunPlan(project, plan.id).runPoints[0]!;
  const events: Array<Omit<RunEvent, "sequence" | "timestamp">> = [];
  const record = await executeRunPoint({ runId: "run-b22a1", project, runPlanId: plan.id, runPoint: point, parts: [], signal, limits, onEvent: (event) => events.push(event) });
  return { record: record as Partial<RunRecord>, logs: events.map((event) => event.log).filter((log): log is string => typeof log === "string") };
}

afterEach(() => {
  proc.script = { stdout: "", stderr: "", code: 0, hang: false, afterSpawn: null };
  proc.calls = [];
  fsState.raw = null;
  __resetJobStoreForTests();
  resetInjectedIdentity();
});

describe("[B22-A1] one constant decides the diagnostic bounds", () => {
  it("the module pins the channel bound (64 KiB), the excerpt bound (a sixty-fourth of it), the tool output file bound (64 MiB) and the marker", async () => {
    const bounds = await import("@/app/lib/computation/output-bounds");
    expect({ channel: bounds.DIAGNOSTIC_OUTPUT_MAX_BYTES, excerpt: bounds.DIAGNOSTIC_EXCERPT_MAX_BYTES, file: bounds.TOOL_OUTPUT_FILE_MAX_BYTES, marker: bounds.OUTPUT_TRUNCATION_MARKER })
      .toEqual({ channel: CHANNEL_MAX_BYTES, excerpt: EXCERPT_MAX_BYTES, file: 64 * 1024 * 1024, marker: MARKER });
    expect(bounds.DIAGNOSTIC_EXCERPT_MAX_BYTES * 64).toBe(bounds.DIAGNOSTIC_OUTPUT_MAX_BYTES);
    // [B22-A1 review] regressions-3: never above what it replaced (worker.ts:186 `chunk.slice(-1500)`, :200 `stderr.slice(-3000)`)
    expect(bounds.DIAGNOSTIC_EXCERPT_MAX_BYTES).toBeLessThanOrEqual(Math.min(1_500, 3_000));
    expect(bounds.boundDiagnosticText("short")).toBe("short");
    expectBounded(bounds.boundDiagnosticText(output(70_000)), CHANNEL_MAX_BYTES, "a long text");
    const twoByte = bounds.boundDiagnosticText(output(40_000, String.fromCharCode(0xe9)));
    expectBounded(twoByte, CHANNEL_MAX_BYTES, "a two-byte text");
    expect(twoByte.includes(String.fromCharCode(0xfffd)), "never cuts a character in half").toBe(false);
  });
});

describe("[B22-A1] POST /api/spice/models/smoke-test returns bounded ngspice output", () => {
  it("a short stdout and stderr come back unchanged", async () => {
    proc.script = { stdout: "Note: operating point computed", stderr: "warning: one", code: 0, hang: false, afterSpawn: null };
    const res = await smokePost(post("/api/spice/models/smoke-test", { model: smokeModel() }));
    const body = await res.json() as { stdout?: string; stderr?: string };
    expect({ status: res.status, stdout: body.stdout, stderr: body.stderr }).toEqual({ status: 200, stdout: "Note: operating point computed", stderr: "warning: one" });
  });

  it("a long stdout and stderr are each cut to the channel bound, the tail kept, the marker first", async () => {
    proc.script = { stdout: output(200_000), stderr: output(90_000, String.fromCharCode(0xe9)), code: 0, hang: false, afterSpawn: null };
    const res = await smokePost(post("/api/spice/models/smoke-test", { model: smokeModel() }));
    const body = await res.json() as { stdout?: string; stderr?: string };
    expectBounded(body.stdout, CHANNEL_MAX_BYTES, "smoke stdout");
    expectBounded(body.stderr, CHANNEL_MAX_BYTES, "smoke stderr");
  });
});

describe("[B22-A1] a SPICE run record carries bounded ngspice output", () => {
  it("a failed run (non-zero exit): stdout and stderr to the channel bound, the failure message and every log event to the excerpt bound", async () => {
    proc.script = { stdout: output(300_000), stderr: output(300_000), code: 1, hang: false, afterSpawn: null };
    const { record, logs } = await runWorker();
    expect(record.status).toBe("failed");
    expectBounded(record.stdout, CHANNEL_MAX_BYTES, "record stdout");
    expectBounded(record.stderr, CHANNEL_MAX_BYTES, "record stderr");
    expectBounded(record.error, EXCERPT_MAX_BYTES, "record error");
    expect(logs.length, "ngspice's progress reached the event stream").toBeGreaterThan(0);
    for (const log of logs) expectBounded(log.replace(/^\[(?:stdout|stderr)\] /, ""), EXCERPT_MAX_BYTES, "a log event");
  });

  it("a run that wrote no waveform artifact: stdout and stderr to the channel bound", async () => {
    proc.script = { stdout: output(300_000), stderr: output(300_000), code: 0, hang: false, afterSpawn: null };
    const { record } = await runWorker();
    expect(record.status).toBe("failed");
    expectBounded(record.stdout, CHANNEL_MAX_BYTES, "record stdout");
    expectBounded(record.stderr, CHANNEL_MAX_BYTES, "record stderr");
  });

  it("a cancelled run: stdout and stderr to the channel bound", async () => {
    const controller = new AbortController();
    proc.script = { stdout: output(300_000), stderr: output(300_000), code: 0, hang: true, afterSpawn: () => controller.abort() };
    const { record } = await runWorker(controller.signal);
    expect(record.status).toBe("cancelled");
    expectBounded(record.stdout, CHANNEL_MAX_BYTES, "record stdout");
    expectBounded(record.stderr, CHANNEL_MAX_BYTES, "record stderr");
  });

  it("[B22-A1 review] a timed-out run (coverage-5, tests-4): stdout and stderr to the channel bound", async () => {
    proc.script = { stdout: output(300_000), stderr: output(300_000), code: 0, hang: true, afterSpawn: null };
    const { record } = await runWorker(undefined, { timeoutMs: 20 });
    expect({ status: record.status, error: record.error }).toEqual({ status: "failed", error: "Simulation timed out after 20 ms" });
    expectBounded(record.stdout, CHANNEL_MAX_BYTES, "record stdout");
    expectBounded(record.stderr, CHANNEL_MAX_BYTES, "record stderr");
  });

  it("a completed run: stdout and stderr to the channel bound; a short failure-free run keeps its output unchanged", async () => {
    fsState.raw = RAW;
    proc.script = { stdout: output(300_000), stderr: output(300_000), code: 0, hang: false, afterSpawn: null };
    const long = await runWorker();
    expect(long.record.status).toBe("completed");
    expectBounded(long.record.stdout, CHANNEL_MAX_BYTES, "record stdout");
    expectBounded(long.record.stderr, CHANNEL_MAX_BYTES, "record stderr");
    proc.script = { stdout: "Note: done", stderr: "", code: 0, hang: false, afterSpawn: null };
    const short = await runWorker();
    expect({ status: short.record.status, stdout: short.record.stdout, stderr: short.record.stderr }).toEqual({ status: "completed", stdout: "Note: done", stderr: "" });
  });
});

describe("[B22-A1 review] regressions-4: the reproducibility bundle says its logs are the run record's bounded logs", () => {
  const SCOPE = { tenantId: "local", projectId: "proj-b22a1", branchId: "main" };
  /** The record once the worker's result is merged (`finishedAt`). A failed run is used: a completed one never gets its result
   *  merged (D22-7, B22-C: the worker's own "completed" event makes the record terminal first; this suite's first run of the
   *  case saw the bundle answer 409 for it), so its bundle would be refused before any log. */
  async function settled(runId: string) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const run = getRun(runId, SCOPE);
      if (!run || run.finishedAt) return run;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return getRun(runId, SCOPE);
  }

  it("a failed run with long output: the bundle's logs are bounded with the marker, and its README states the bound (it said the logs were preserved)", async () => {
    proc.script = { stdout: output(300_000), stderr: output(300_000), code: 1, hang: false, afterSpawn: null };
    const project = dividerProject();
    const started = await runsPost(post("/api/spice/runs", { project, runPlanId: project.runPlans[0]!.id, parts: [] }));
    expect(started.status).toBe(202);
    const runId = ((await started.json()) as { batch: { runIds: string[] } }).batch.runIds[0]!;
    expect((await settled(runId))?.status).toBe("failed");
    injectAuthorizedPrincipal({ userId: "u-b22a1", tenantId: "local", projectId: "proj-b22a1", role: "editor" });
    const bundle = await bundleGet(new Request(`http://localhost/api/spice/runs/${runId}/bundle`, { headers: SELECTOR }), { params: Promise.resolve({ id: runId }) });
    expect(bundle.status).toBe(200);
    const zip = await JSZip.loadAsync(await bundle.arrayBuffer());
    expectBounded(await zip.file("logs/stdout.log")?.async("string"), CHANNEL_MAX_BYTES, "the bundle's stdout.log");
    expectBounded(await zip.file("logs/stderr.log")?.async("string"), CHANNEL_MAX_BYTES, "the bundle's stderr.log");
    const readme = await zip.file("README.txt")?.async("string") ?? "";
    expect(readme).not.toContain("logs, measurements, and raw vectors are preserved");
    expect(readme).toContain(`each bounded to its last ${CHANNEL_MAX_BYTES / 1024} KiB`);
    expect(readme).toContain(MARKER.trim());
  });
});
