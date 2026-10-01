import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnoseNgspiceLog } from "../diagnostics";
import { createId } from "../identity";
import { compileCanonicalIr } from "../ir";
import { evaluateTestResults } from "../measurements";
import { assertModelSafeForExecution } from "../models";
import { assertCompiledDeckSafe, compiledDeckExpectation, compileNgspiceNetlist } from "../netlist";
import { auditCompiledIr } from "../readiness";
import { parseNgspiceAsciiRaw } from "../waveforms";
import type {
  RunEvent,
  RunManifest,
  RunPoint,
  RunRecord,
  SimulationPartSnapshot,
  SimulationProject,
} from "../types";
import { createRunManifest } from "./manifest";

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
  onEvent(event: Omit<RunEvent, "sequence" | "timestamp">): void;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

let cachedVersion: string | null = null;
export const NGSPICE_EXECUTABLE = process.env.NGSPICE_BIN?.trim() || (process.platform === "win32" ? "ngspice_con" : "ngspice");

async function ngspiceVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  cachedVersion = await new Promise<string>((resolve) => {
    const child = spawn(NGSPICE_EXECUTABLE, ["-v"], { env: safeEnvironment(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); // [SEC-1] D22-5: never the inherited server env
    let output = "";
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout?.on("data", (data: Buffer) => { output += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { output += data.toString(); });
    child.on("error", () => finish("unavailable"));
    child.on("close", () => finish(output.split(/\r?\n/).find((line) => /ngspice/i.test(line))?.trim() || "ngspice (version unknown)"));
    const timer = setTimeout(() => {
      child.kill();
      finish("ngspice (version probe timed out)");
    }, 2_000);
  });
  return cachedVersion;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LD_LIBRARY_PATH"];
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

async function runNgspice(
  netlistPath: string,
  cwd: string,
  signal: AbortSignal,
  limits: WorkerLimits,
  onLog: (channel: "stdout" | "stderr", chunk: string) => void,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(NGSPICE_EXECUTABLE, ["-b", netlistPath], {
      cwd,
      env: safeEnvironment(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const append = (channel: "stdout" | "stderr", data: Buffer) => {
      const text = data.toString();
      onLog(channel, text);
      if (channel === "stdout") stdout = (stdout + text).slice(-limits.maxOutputBytes);
      else stderr = (stderr + text).slice(-limits.maxOutputBytes);
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >= limits.maxOutputBytes) {
        stderr += "\nSIRKIT: simulator log limit exceeded\n";
        child.kill();
      }
    };
    child.stdout?.on("data", (data: Buffer) => append("stdout", data));
    child.stderr?.on("data", (data: Buffer) => append("stderr", data));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(error.code === "ENOENT" ? new Error("ngspice executable not found on PATH") : error);
    });
    const abort = () => {
      cancelled = true;
      child.kill();
    };
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, limits.timeoutMs);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve({ code, stdout, stderr, timedOut, cancelled });
    });
  });
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
  input.onEvent({ status: "preparing", progress: 5, message: "Creating isolated artifact directory" });
  const artifactId = createId("runartifact");
  const artifactDir = join(tmpdir(), "sirkit-spice", artifactId);
  await mkdir(artifactDir, { recursive: true });
  const rawPath = join(artifactDir, "result.raw");
  const netlistPath = join(artifactDir, "executed.cir");
  input.onEvent({ status: "netlisting", progress: 12, message: "Compiling canonical circuit IR" });
  const compiled = compileCanonicalIr({ project: input.project, testId: test.id, parts: input.parts });
  for (const model of compiled.ir.models) assertModelSafeForExecution(model);
  const readiness = auditCompiledIr(compiled);
  if (!readiness.ready) {
    const message = readiness.issues.filter((issue) => issue.severity === "error").map((issue) => issue.title).join("; ");
    throw new Error(`Readiness gate blocked execution: ${message}`);
  }
  input.onEvent({ status: "validating", progress: 20, message: "Validating models, pin maps, and generated directives" });
  const netlist = compileNgspiceNetlist(compiled.ir, {
    analysisId: analysis.id,
    runPoint: input.runPoint,
    rawOutputPath: "result.raw",
    pinNodes: compiled.pointNodes,
  });
  await writeFile(netlistPath, assertCompiledDeckSafe(netlist.executed, compiledDeckExpectation({ rawOutputPath: "result.raw" })), "utf8"); // [SEC-1] final screen: refused -> the run fails, no deck
  const version = await ngspiceVersion();
  const manifest = createRunManifest({ project: input.project, test, runPlan, runPoint: input.runPoint, analysis, ir: compiled.ir, netlist: netlist.executed, simulatorVersion: version });
  await writeFile(join(artifactDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(join(artifactDir, "source-map.json"), JSON.stringify(netlist.sourceMap, null, 2), "utf8");
  input.onEvent({ status: "running", progress: 28, message: `Running ${version}` });
  let lastLogEmit = 0;
  const processResult = await runNgspice(netlistPath, artifactDir, input.signal, limits, (channel, chunk) => {
    const now = Date.now();
    if (now - lastLogEmit > 120) {
      input.onEvent({ status: "running", progress: 45, message: "ngspice is solving", log: `[${channel}] ${chunk.slice(-1500)}` });
      lastLogEmit = now;
    }
  });
  await writeFile(join(artifactDir, "stdout.log"), processResult.stdout, "utf8");
  await writeFile(join(artifactDir, "stderr.log"), processResult.stderr, "utf8");
  if (processResult.cancelled) {
    return { status: "cancelled", stdout: processResult.stdout, stderr: processResult.stderr, diagnostics: diagnoseNgspiceLog("cancelled by user", netlist), manifest, netlist, artifactId: artifactDir };
  }
  if (processResult.timedOut) {
    return { status: "failed", error: `Simulation timed out after ${limits.timeoutMs} ms`, stdout: processResult.stdout, stderr: processResult.stderr, diagnostics: diagnoseNgspiceLog(`timeout\n${processResult.stderr}`, netlist), manifest, netlist, artifactId: artifactDir };
  }
  if (processResult.code !== 0) {
    const log = `${processResult.stderr}\n${processResult.stdout}`;
    return { status: "failed", error: processResult.stderr.slice(-3000) || `ngspice exited with code ${processResult.code}`, stdout: processResult.stdout, stderr: processResult.stderr, diagnostics: diagnoseNgspiceLog(log, netlist), manifest, netlist, artifactId: artifactDir };
  }
  input.onEvent({ status: "post-processing", progress: 78, message: "Parsing waveforms and evaluating specifications" });
  let raw: string;
  try {
    raw = await readFile(rawPath, "utf8");
  } catch {
    const log = `${processResult.stderr}\n${processResult.stdout}\nngspice produced no raw waveform artifact`;
    return {
      status: "failed",
      progress: 100,
      error: "ngspice exited without producing the requested waveform artifact",
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      diagnostics: diagnoseNgspiceLog(log, netlist),
      manifest,
      netlist,
      artifactId: artifactDir,
    };
  }
  if (Buffer.byteLength(raw) > limits.maxOutputBytes) throw new Error(`Waveform artifact exceeds ${limits.maxOutputBytes} bytes`);
  const parsed = parseNgspiceAsciiRaw(raw);
  const totalPoints = parsed.waveforms.reduce((sum, waveform) => sum + waveform.x.length, 0);
  if (totalPoints > limits.maxWaveformPoints) throw new Error(`Waveform point count ${totalPoints} exceeds ${limits.maxWaveformPoints}`);
  const scalars = evaluateTestResults(input.runId, test.id, test.measurements, test.specifications, parsed.waveforms, { autoSteadyState: analysis.type === "tran", finalCycles: 5 });
  await writeFile(join(artifactDir, "scalars.json"), JSON.stringify(scalars, null, 2), "utf8");
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
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    artifactId: artifactDir,
  };
}
