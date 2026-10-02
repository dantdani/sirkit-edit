import { diagnoseNgspiceLog } from "../diagnostics";
import { createId } from "../identity";
import { compileCanonicalIr } from "../ir";
import { evaluateTestResults } from "../measurements";
import { assertModelSafeForExecution } from "../models";
import { assertCompiledDeckSafe, compiledDeckExpectation, compileNgspiceNetlist } from "../netlist";
import { auditCompiledIr } from "../readiness";
import { parseNgspiceAsciiRawResult } from "../waveforms";
import type {
  RunEvent,
  RunManifest,
  RunPoint,
  RunRecord,
  SimulationPartSnapshot,
  SimulationProject,
} from "../types";
import { createRunManifest, sha256 } from "./manifest";
import { boundDiagnosticText, DIAGNOSTIC_EXCERPT_MAX_BYTES } from "@/app/lib/computation/output-bounds"; // [B22-A1] D22-4: what a run record carries is bounded
// [B22-A3] OD-136: ngspice runs only through the diagnostic runner (the pinned install, the profile's argv and exact environment, a
// per-run directory removed on every path, a bounded raw read, a tree kill, terminal after exit); this module starts no process
import { diagnosticNgspiceVersion, diagnosticProvenance, DIAGNOSTIC_RAW_OUTPUT_FILE, DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS, runDiagnosticNgspice, seedDiagnosticDeck, verifyDiagnosticInstall } from "@/app/lib/computation/diagnostic-runner";
export interface WorkerLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxWaveformPoints: number;
}

export const DEFAULT_WORKER_LIMITS: WorkerLimits = {
  timeoutMs: 120_000,
  maxOutputBytes: 100 * 1024 * 1024,
  maxWaveformPoints: 5_000_000,
};

export interface ExecuteRunInput {
  runId: string;
  project: SimulationProject;
  runPlanId: string;
  runPoint: RunPoint;
  parts: SimulationPartSnapshot[];
  signal: AbortSignal;
  limits?: Partial<WorkerLimits>;
  /** [B22-A3 review] security-2: the server-derived tenant the run belongs to (its share of the diagnostic runner's cap). */
  holder?: string;
  onEvent(event: Omit<RunEvent, "sequence" | "timestamp">): void;
}

export async function executeRunPoint(input: ExecuteRunInput): Promise<Partial<RunRecord> & { manifest?: RunManifest }> {
  const limits = { ...DEFAULT_WORKER_LIMITS, ...input.limits };
  if (input.signal.aborted) {
    return { status: "cancelled", progress: 100, diagnostics: diagnoseNgspiceLog("cancelled by user"), stdout: "", stderr: "" };
  }
  const test = input.project.tests.find((candidate) => candidate.id === input.runPoint.testId);
  const runPlan = input.project.runPlans.find((candidate) => candidate.id === input.runPlanId);
  if (!test || !runPlan) throw new Error("Run point references a missing test or run plan");
  const analysis = test.analyses.find((candidate) => candidate.id === input.runPoint.analysisId);
  if (!analysis) throw new Error("Run point references a missing analysis");
  input.onEvent({ status: "preparing", progress: 5, message: "Checking the pinned ngspice install" });
  const verified = await verifyDiagnosticInstall(); // [B22-A3] OD-135: an unpinned or mismatched install fails the run (closed) before anything is compiled
  input.onEvent({ status: "netlisting", progress: 12, message: "Compiling canonical circuit IR" });
  const compiled = compileCanonicalIr({ project: input.project, testId: test.id, parts: input.parts });
  for (const model of compiled.ir.models) assertModelSafeForExecution(model);
  const readiness = auditCompiledIr(compiled);
  if (!readiness.ready) {
    const message = readiness.issues.filter((issue) => issue.severity === "error").map((issue) => issue.title).join("; ");
    throw new Error(`Readiness gate blocked execution: ${message}`);
  }
  input.onEvent({ status: "validating", progress: 20, message: "Validating models, pin maps, and generated directives" });
  const compiledNetlist = compileNgspiceNetlist(compiled.ir, {
    analysisId: analysis.id,
    runPoint: input.runPoint,
    rawOutputPath: DIAGNOSTIC_RAW_OUTPUT_FILE,
    pinNodes: compiled.pointNodes,
  });
  // [SEC-1] final screen: refused -> the run fails, no deck; [B22-A3] it screens the deck the runner writes and the record keeps (the profile's seed option before `.end`)
  const netlist = { ...compiledNetlist, executed: assertCompiledDeckSafe(seedDiagnosticDeck(compiledNetlist.executed), compiledDeckExpectation({ rawOutputPath: DIAGNOSTIC_RAW_OUTPUT_FILE })) };
  // [B22-A3 review] security-2: a Studio point is a background job: it waits for a slot up to the runner's longest wait (abortable)
  const { version } = await diagnosticNgspiceVersion({ signal: input.signal, verified, holder: input.holder, queueWaitMs: DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS });
  input.onEvent({ status: "running", progress: 28, message: `Running ${version}` });
  let lastLogEmit = 0;
  const run = await runDiagnosticNgspice({
    operation: "run",
    deck: netlist.executed,
    readRaw: true,
    wallClockMs: limits.timeoutMs,
    readBackBytes: limits.maxOutputBytes,
    signal: input.signal,
    holder: input.holder,
    queueWaitMs: DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS,
    onOutput: (channel, chunk) => {
      const now = Date.now();
      if (now - lastLogEmit > 120) {
        input.onEvent({ status: "running", progress: 45, message: "ngspice is solving", log: `[${channel}] ${boundDiagnosticText(chunk, DIAGNOSTIC_EXCERPT_MAX_BYTES)}` }); // [B22-A1] D22-4
        lastLogEmit = now;
      }
    },
  });
  // [B22-A3] the manifest carries the runner's labels, profile and observed install digest; the artifact id is the runner's opaque
  // run id, never a host path (D22-8); nothing is written to disk but the runner's deck, in a directory it removes. [B22-A3 review]
  // regressions-3: the raw file is not kept, so the manifest keeps its SHA-256 and size as the runner read them (a re-run compares)
  const rawOutput = run.raw.state === "read" ? { sha256: sha256(run.raw.text), bytes: Buffer.byteLength(run.raw.text, "utf8") } : undefined;
  const manifest = createRunManifest({ project: input.project, test, runPlan, runPoint: input.runPoint, analysis, ir: compiled.ir, netlist: netlist.executed, simulatorVersion: version, runner: { ...diagnosticProvenance(run), profileDigest: run.profileDigest }, rawOutput }); // [B22-C] the evidence names the profile's digest
  const artifactId = run.runId;
  const output = { stdout: boundDiagnosticText(run.stdout), stderr: boundDiagnosticText(run.stderr) }; // [B22-A1] D22-4 (the runner holds both within the same bound)
  if (run.outcome === "spawn_failed") throw new Error("ngspice could not be started from the pinned install");
  if (run.outcome === "cancelled") {
    return { status: "cancelled", ...output, diagnostics: diagnoseNgspiceLog("cancelled by user", netlist), manifest, netlist, artifactId };
  }
  if (run.outcome === "timeout") {
    return { status: "failed", error: `Simulation timed out after ${run.wallClockMs} ms`, ...output, diagnostics: diagnoseNgspiceLog(`timeout\n${run.stderr}`, netlist), manifest, netlist, artifactId };
  }
  if (run.outcome === "kill_unconfirmed") {
    // [B22-A3] OD-145: the tree was killed but the child's exit was not observed within the bounded wait - never reported cancelled;
    // [B22-A3 review] coverage-1: the message and the diagnosis name the cause (the wall clock or a cancel)
    const cause = run.killReason === "cancelled" ? "after a cancel" : `at the wall clock (${run.wallClockMs} ms)`;
    return { status: "failed", error: `Simulation stopped (kill_unconfirmed) ${cause}: the ngspice process exit was not observed within the bounded wait`, ...output, diagnostics: diagnoseNgspiceLog(run.killReason === "cancelled" ? "cancelled by user" : `timeout\n${run.stderr}`, netlist), manifest, netlist, artifactId };
  }
  if (run.exitCode !== 0) {
    const log = `${run.stderr}\n${run.stdout}`;
    return { status: "failed", error: boundDiagnosticText(run.stderr, DIAGNOSTIC_EXCERPT_MAX_BYTES) || `ngspice exited with code ${run.exitCode}`, ...output, diagnostics: diagnoseNgspiceLog(log, netlist), manifest, netlist, artifactId }; // [B22-A1] D22-4
  }
  input.onEvent({ status: "post-processing", progress: 78, message: "Parsing waveforms and evaluating specifications" });
  // [B22-A3] D22-8: the runner read the raw file back through the bounded reader - an over-bound file refused whole, never read
  if (run.raw.state === "over-limit") throw new Error(`Waveform artifact exceeds ${limits.maxOutputBytes} bytes`);
  if (run.raw.state !== "read") {
    const log = `${run.stderr}\n${run.stdout}\nngspice produced no raw waveform artifact`;
    return {
      status: "failed",
      progress: 100,
      error: run.raw.state === "invalid-utf8" ? "ngspice produced a waveform artifact that is not valid UTF-8" : "ngspice exited without producing the requested waveform artifact",
      ...output, // [B22-A1] D22-4
      diagnostics: diagnoseNgspiceLog(log, netlist),
      manifest,
      netlist,
      artifactId,
    };
  }
  const outcome = parseNgspiceAsciiRawResult(run.raw.text); if (!outcome.ok) return { status: "failed", progress: 100, error: outcome.refusal.message, ...output, diagnostics: diagnoseNgspiceLog(`${run.stderr}\n${run.stdout}`, netlist), manifest, netlist, artifactId }; const parsed = outcome.parsed; // [B22-C review] coverage-10: a refused output (D22-10) fails the run like every other failure - its logs, manifest (the raw SHA-256) and netlist kept; one line, so the cited lines below keep their numbers
  const totalPoints = parsed.waveforms.reduce((sum, waveform) => sum + waveform.x.length, 0);
  if (totalPoints > limits.maxWaveformPoints) throw new Error(`Waveform point count ${totalPoints} exceeds ${limits.maxWaveformPoints}`);
  const scalars = evaluateTestResults(input.runId, test.id, test.measurements, test.specifications, parsed.waveforms, { autoSteadyState: analysis.type === "tran", finalCycles: 5 });
  input.onEvent({ status: "completed", progress: 100, message: `Completed with ${parsed.waveforms.length} waveform(s) and ${scalars.length} scalar result(s)` });
  return {
    status: "completed",
    progress: 100,
    manifest,
    netlist,
    waveforms: parsed.waveforms,
    scalars,
    diagnostics: parsed.warnings.map((warning) => ({
      id: createId("diag"),
      code: "unknown" as const,
      severity: "warning" as const,
      title: "Waveform import warning",
      summary: warning,
      sourceRefs: [],
      suggestions: [],
    })),
    ...output, // [B22-A1] D22-4
    artifactId,
  };
}
