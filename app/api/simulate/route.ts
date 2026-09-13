/**
 * B16.0.24 §G/§H — the legacy same-origin single-shot SPICE simulation route,
 * migrated to the canonical authenticated JSON boundary and hardened into a
 * confined ngspice sandbox.
 *
 * SECURITY BOUNDARY (§G): `authenticatedJsonRoute` runs identity + LIVE
 * membership + engineering role + same-origin CSRF, then the bounded 8 MB /
 * 30 s object read, BEFORE this callback — so NO process, temp file, or netlist
 * work is reachable before authorization, media type, body, and schema
 * validation. The runner then uses a SERVER-OWNED executable, a FIXED argument
 * vector `["-b", <server temp path>]`, `shell:false`, a per-request
 * server-created isolated temp directory (never a shared cwd), server-owned
 * filenames, a MINIMAL allowlisted environment (never the full inherited server
 * env), no network, a strict timeout, and bounded stdout/stderr/raw-file/parse
 * sizes. Caller input controls NONE of: executable, arguments, shell, working
 * directory, environment, output paths, include/library paths, control
 * directives, files, or network. The generated netlist is screened for
 * `.include`/`.lib`/`.control`/shell injection before spawning, and cleanup
 * runs in every success, refusal, timeout, abort, spawn-error, parse-error, and
 * disconnect path.
 *
 * TRUTHFULNESS (§H): a successful process exit is an EXECUTED simulation result
 * only — never physical validation, engineering approval, design readiness,
 * safety certification, or manufacturing release.
 */
import { spawn } from "node:child_process";
import { mkdtemp, open, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicToSpice, type SpiceAnalysis } from "@/app/lib/netlist";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

/** [B16.0.2 §A/§D] a whole SchematicState travels in the body. */
const MAX_BODY_BYTES = 8_000_000;
const BODY_DEADLINE_MS = 30_000;

/** Server-owned execution limits (never caller-influenced). */
const PROCESS_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const MAX_RAW_BYTES = 20_000_000;
const MAX_PARSE_TOKENS = 5_000_000;
const MAX_PARSE_POINTS = 2_000_000;
const MAX_PARSE_VARIABLES = 10_000;

const NGSPICE_EXECUTABLE = process.env.NGSPICE_BIN?.trim() || (process.platform === "win32" ? "ngspice_con" : "ngspice");

/** A MINIMAL allowlisted environment — the exact worker allowlist. Never the
 *  full inherited server environment. */
function safeEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LD_LIBRARY_PATH"];
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

/**
 * PRIMARY injection defense — reject caller-supplied schematic fields that could
 * inject an arbitrary SPICE directive line. Every caller string the serializer
 * writes into the deck is screened: a component's value, its element name (the
 * displayed reference, or the id when there is no reference), a net-label name
 * and the analysis fields. A line break, another control character or a backtick
 * in one is the way to smuggle a `.include`/`.control`/shell line into the
 * emitted deck (the serializer legitimately emits exactly ONE `.control` block
 * with `run` + `write result.raw`; the output screen below refuses a second one).
 * [B19-D I5e review] the reference and id were not screened, and a newline in a
 * reference wrote a live `.control` + `shell` block.
 */
function assertSchematicFieldsSafe(state: SchematicState, analysis?: SpiceAnalysis): void {
  const unsafe = (value: unknown): boolean => typeof value === "string" && /[\x00-\x1f\x7f`]/.test(value);
  for (const component of state.components) {
    if (unsafe(component.value)) throw new Error("a component value contains an illegal control character");
    if (unsafe(component.refDes) || unsafe(component.id)) throw new Error("a component reference contains an illegal control character");
  }
  for (const label of state.netLabels ?? []) {
    if (unsafe(label.name)) throw new Error("a net label name contains an illegal control character");
  }
  if (analysis) {
    for (const value of Object.values(analysis as Record<string, unknown>)) {
      if (unsafe(value)) throw new Error("an analysis field contains an illegal control character");
    }
  }
}

/**
 * Belt-and-braces OUTPUT screen — refuse a generated netlist that carries an
 * include/library/source/shell directive (which the serializer NEVER emits, so
 * any occurrence is injected). The serializer emits exactly one batch-mode
 * `.control` block of its own, so a deck with any other number of `.control` or
 * `.endc` lines, or a `shell` line anywhere, is injected.
 */
function assertNetlistSafe(netlist: string): void {
  // [B19-D I5e review] defence in depth behind the input guard
  const controlBlocks = netlist.match(/^\s*\.control\b/gim)?.length ?? 0;
  const controlEnds = netlist.match(/^\s*\.endc\b/gim)?.length ?? 0;
  if (controlBlocks !== 1 || controlEnds !== 1) throw new Error("generated netlist contains an unexpected control block");
  const forbidden: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /^\s*\.(?:include|inc|lib)\b/im, label: "include/library directives" },
    { pattern: /^\s*\.(?:shell|cd|source|quit|exec|system|destroy|remcirc)\b/im, label: "filesystem or shell commands" },
    { pattern: /^\s*shell\b/im, label: "control-block shell commands" }, // element names never start with S
    { pattern: /(?:^|\n)\s*![^=]/m, label: "shell escapes" },
    { pattern: /`[^`]+`/, label: "command substitution" },
  ];
  const hit = forbidden.find((entry) => entry.pattern.test(netlist));
  if (hit) throw new Error(`generated netlist contains a forbidden ${hit.label}`);
}

// ─── ASCII raw-file parser (bounded) ──────────────────────────────────────────

interface SimResult {
  analysis: string;
  variables: string[];
  points: Record<string, number>[];
}

function parseAsciiRaw(raw: string): SimResult {
  const lines = raw.split(/\r?\n/);
  let plotname = "Unknown";
  let flags    = "real";
  let numVars  = 0;
  const variables: string[] = [];
  let i = 0;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("Plotname:")) {
      plotname = line.slice("Plotname:".length).trim().slice(0, 200);
    } else if (line.startsWith("Flags:")) {
      flags = line.slice("Flags:".length).trim();
    } else if (line.startsWith("No. Variables:")) {
      numVars = Math.min(MAX_PARSE_VARIABLES, Math.max(0, parseInt(line.slice("No. Variables:".length).trim(), 10) || 0));
    } else if (line.trimEnd() === "Variables:") {
      i++;
      for (; i < lines.length; i++) {
        const vl = lines[i];
        if (vl.trimEnd() === "Values:") break;
        const parts = vl.trim().split(/\s+/);
        if (parts.length >= 2 && variables.length < MAX_PARSE_VARIABLES) variables.push(parts[1]);
      }
      break;
    }
  }

  for (; i < lines.length; i++) {
    if (lines[i].trimEnd() === "Values:") { i++; break; }
  }

  const isComplex  = flags.toLowerCase().includes("complex");
  const valsPerVar = isComplex ? 2 : 1;
  const stride     = 1 + numVars * valsPerVar;

  const tokens: number[] = [];
  for (; i < lines.length; i++) {
    for (const part of lines[i].split(/[\s,]+/)) {
      if (part === "") continue;
      const n = Number(part);
      if (!isNaN(n)) tokens.push(n);
      if (tokens.length >= MAX_PARSE_TOKENS) break;
    }
    if (tokens.length >= MAX_PARSE_TOKENS) break;
  }

  const points: Record<string, number>[] = [];
  for (let t = 0; t + stride <= tokens.length && points.length < MAX_PARSE_POINTS; t += stride) {
    const point: Record<string, number> = {};
    for (let k = 0; k < variables.length && k < numVars; k++) {
      const name   = variables[k];
      const valIdx = t + 1 + k * valsPerVar;
      if (isComplex) {
        const re = tokens[valIdx];
        const im = tokens[valIdx + 1];
        if (k === 0 && /freq/i.test(name)) {
          point[name] = re;
        } else {
          const mag    = Math.sqrt(re * re + im * im);
          const magDb  = 20 * Math.log10(mag === 0 ? 1e-30 : mag);
          const phase  = (Math.atan2(im, re) * 180) / Math.PI;
          point[`${name}.mag`]   = magDb;
          point[`${name}.phase`] = phase;
        }
      } else {
        point[name] = tokens[valIdx];
      }
    }
    points.push(point);
  }

  let finalVars: string[];
  if (isComplex) {
    finalVars = [];
    for (let k = 0; k < variables.length; k++) {
      const name = variables[k];
      if (k === 0 && /freq/i.test(name)) finalVars.push(name);
      else finalVars.push(`${name}.mag`, `${name}.phase`);
    }
  } else {
    finalVars = variables;
  }

  return { analysis: plotname, variables: finalVars, points };
}

// ─── Bounded raw-file reader ──────────────────────────────────────────────────

export type BoundedRawRead =
  | { ok: true; text: string }
  | { ok: false; reason: "over-limit" | "invalid-utf8" | "unreadable" };

/**
 * [B16.0.24.1 §1] a TRULY bounded read of the server-owned simulator output.
 * The file is opened through a handle; the declared size is an ADVISORY
 * fast-fail only — storage is allocated in fixed 64 KiB chunks proportional to
 * the ACTUAL bytes read (never the declared size), so an enormous declared
 * size cannot cause a proportional allocation, and a stat/read race (a file
 * that grows after stat) is caught by the actual-read cap. At most
 * `maxBytes` + 1 bytes are ever consumed; crossing the ceiling refuses
 * EXPLICITLY (partial oversized output is never returned, so parsing can
 * never begin on it). Invalid UTF-8 fails deterministically (fatal decode —
 * never a lossy replacement-character parse). The handle is closed in every
 * path; a close failure never masks the read outcome.
 */
export async function readBoundedRawFile(path: string, maxBytes: number): Promise<BoundedRawRead> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(path, "r");
    // Advisory fast-fail: a hugely-declared artifact is refused without a
    // single content read (and without any size-proportional allocation).
    const declared = (await handle.stat()).size;
    if (declared > maxBytes) return { ok: false, reason: "over-limit" };
    const chunkSize = 65_536;
    const chunk = Buffer.alloc(chunkSize);
    const pieces: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunkSize, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      // The REAL bound: actual bytes, immune to the stat/growth race.
      if (total > maxBytes) return { ok: false, reason: "over-limit" };
      pieces.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pieces, total));
    } catch {
      return { ok: false, reason: "invalid-utf8" };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

interface ProcessResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; }

function runNgspice(netlistPath: string, cwd: string, signal: AbortSignal): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    // shell:false (explicit); server-owned exe + fixed argv; isolated cwd;
    // minimal env; no network reachable through the deck's directives.
    const child = spawn(NGSPICE_EXECUTABLE, ["-b", netlistPath], { stdio: ["ignore", "pipe", "pipe"], cwd, env: safeEnvironment(), windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const onAbort = () => { timedOut = false; child.kill(); };
    if (signal.aborted) child.kill();
    else signal.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (d: Buffer) => { stdout = (stdout + d.toString()).slice(-MAX_OUTPUT_BYTES); });
    child.stderr?.on("data", (d: Buffer) => { stderr = (stderr + d.toString()).slice(-MAX_OUTPUT_BYTES); });
    child.on("error", (err: NodeJS.ErrnoException) => { reject(err.code === "ENOENT" ? new Error("ngspice executable not found on PATH") : err); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, PROCESS_TIMEOUT_MS);
    child.on("close", (code) => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); resolve({ code, stdout, stderr, timedOut }); });
  });
}

// [B16.0.24 §G] canonical authenticated wrapper — authorization + CSRF + the
// bounded 8 MB / 30 s object read happen BEFORE this callback; the request
// abort signal reaches the runner only through the declared `exposeAbortSignal`
// input.
export const POST = authenticatedJsonRoute<{ state?: SchematicState; analysis?: SpiceAnalysis }>(
  { maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS, exposeAbortSignal: true },
  async ({ body, signal }) => {
  const { state, analysis } = body;

  // Semantic validation — BEFORE any temp file or process work.
  if (!state?.components?.length) {
    return Response.json({ error: "Schematic has no components" }, { status: 400 });
  }
  const hasSrc = state.components.some((c) => c.type === "voltage-source" || c.type === "current-source");
  if (!hasSrc) {
    return Response.json({ error: "Schematic must have at least one voltage or current source" }, { status: 400 });
  }
  const hasGroundLabel = (state.netLabels ?? []).some((l) => {
    const name = l.name.trim().toUpperCase();
    return l.kind === "ground" || name === "GND" || name === "0";
  });
  if (!state.components.some((c) => c.type === "ground") && !hasGroundLabel) {
    return Response.json({ error: "Schematic must have at least one ground component or GND label" }, { status: 400 });
  }

  // Generate the netlist (server-owned RELATIVE raw filename) and screen it for
  // injected control/include/shell directives BEFORE spawning anything.
  let netlist: string;
  let nodeMap: Record<string, string>;
  let pinNodes: Record<string, string>;
  try {
    assertSchematicFieldsSafe(state, analysis);
    ({ netlist, nodeMap, pinNodes } = schematicToSpice(state, { analysis, rawOutputPath: "result.raw" }));
    assertNetlistSafe(netlist);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Netlist generation failed: ${msg}` }, { status: 400 });
  }

  // Per-request server-created isolated temp directory; server-owned filenames.
  let directory: string | null = null;
  try {
    directory = await mkdtemp(join(tmpdir(), "sirkit-simulate-"));
    const netlistPath = join(directory, "netlist.cir");
    const rawPath = join(directory, "result.raw");
    await writeFile(netlistPath, netlist, "utf8");

    let result: ProcessResult;
    try {
      result = await runNgspice(netlistPath, directory, signal ?? new AbortController().signal);
    } catch (e) {
      if (e instanceof Error && e.message === "ngspice executable not found on PATH") {
        return Response.json({ error: "ngspice executable not found on PATH" }, { status: 500 });
      }
      throw e;
    }
    if (result.timedOut) {
      return Response.json({ error: "Simulation timed out" }, { status: 504 });
    }
    if (result.code !== 0) {
      return Response.json({ ok: false, error: result.stderr.slice(-3000) || result.stdout.slice(-3000) || `NGSpice exited with code ${String(result.code)}` }, { status: 500 });
    }

    // [B16.0.24.1 §1] TRULY bounded read: at most MAX_RAW_BYTES actual bytes,
    // chunked storage (never allocated from the declared size), explicit
    // over-limit refusal — partial oversized output is NEVER parsed.
    const rawRead = await readBoundedRawFile(rawPath, MAX_RAW_BYTES);
    if (!rawRead.ok) {
      if (rawRead.reason === "over-limit") {
        return Response.json({ ok: false, error: "Simulation output exceeded the bounded size limit" }, { status: 500 });
      }
      if (rawRead.reason === "invalid-utf8") {
        return Response.json({ ok: false, error: "Could not parse simulation output" }, { status: 500 });
      }
      return Response.json({ error: "NGSpice produced no output file" }, { status: 500 });
    }
    const rawText = rawRead.text;

    let parsed: SimResult;
    try {
      parsed = parseAsciiRaw(rawText);
    } catch {
      return Response.json({ ok: false, error: "Could not parse simulation output" }, { status: 500 });
    }
    if (parsed.variables.length === 0 || parsed.points.length === 0) {
      return Response.json({ ok: false, error: "Simulation produced no data points. Check the netlist and analysis settings." }, { status: 500 });
    }

    return Response.json({
      ok:           true,
      analysis:     parsed.analysis,
      analysisType: analysis?.type ?? "tran",
      variables:    parsed.variables,
      points:       parsed.points,
      netlist,
      nodeMap,
      pinNodes,
    });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
  });
