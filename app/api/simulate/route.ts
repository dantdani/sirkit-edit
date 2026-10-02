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
 *
 * [B22-A3, 2026-10-01] Superseded in part: this route starts no process. ngspice
 * runs only through the diagnostic runner (`app/lib/computation/diagnostic-runner.ts`,
 * OD-136): the pinned install (never NGSPICE_BIN or PATH), the profile's argv with
 * `-n` and its exact environment map (no HOME/USERPROFILE in it; on win32 Node adds the server's USERPROFILE and seven other libuv-required variables, recorded per run - B22-A3 lead), a per-run directory the runner
 * creates and removes, its bounded raw read, its tree kill and its global cap. The
 * runner is diagnostic only (`diagnostic_only`, `environment_dependent`) and no
 * isolation boundary; the wording above that says otherwise is the B22 closeout's to
 * supersede (D22-14).
 */
import type { SchematicState } from "@/lib/schematic-types";
import { schematicToSpice, type SpiceAnalysis } from "@/app/lib/netlist";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { DiagnosticRunnerError, diagnosticProvenance, runDiagnosticNgspice, seedDiagnosticDeck, type DiagnosticRunRecord } from "@/app/lib/computation/diagnostic-runner";
import { SimulationOutputError, validateNgspiceAsciiOutput } from "@/app/lib/computation/output-validator"; // [B22-C] D22-10

/** [B16.0.2 §A/§D] a whole SchematicState travels in the body. */
const MAX_BODY_BYTES = 8_000_000;
const BODY_DEADLINE_MS = 30_000;

/** Server-owned execution limits (never caller-influenced), each within the diagnostic runner's profile bound. [B22-A3] The
 *  stdout/stderr bound is the runner's (A1's 64 KiB per channel); the former 1 MB route constant is gone. */
const PROCESS_TIMEOUT_MS = 10_000;
const MAX_RAW_BYTES = 20_000_000;
const MAX_PARSE_TOKENS = 5_000_000;
const MAX_PARSE_POINTS = 2_000_000;
const MAX_PARSE_VARIABLES = 10_000;

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

/** [B22-C] D22-10: the route's parser routes through the one output validator (built over CD-10's `createWaveformArtifact`), the
 *  same the Studio worker's uses: a non-finite value (this parser used to keep `Infinity` and drop NaN), a short or over-long values
 *  section, a misaligned point, a time or frequency axis that does not strictly increase, an unknown unit, or more variables,
 *  points or tokens than the bounds below (it used to cut them silently) refuses the output whole with a closed code. The response
 *  shape is unchanged. */
function parseAsciiRaw(raw: string): SimResult {
  const output = validateNgspiceAsciiOutput(raw, { limits: { maxVariables: MAX_PARSE_VARIABLES, maxPoints: MAX_PARSE_POINTS, maxValues: MAX_PARSE_TOKENS } });
  const vectors = [output.axis, ...output.variables];
  const points: Record<string, number>[] = [];
  for (let index = 0; index < output.points; index++) {
    const point: Record<string, number> = {};
    vectors.forEach((vector, k) => {
      if (vector.imaginary) {
        const re = vector.real[index]!;
        if (k === 0 && /freq/i.test(vector.name)) {
          point[vector.name] = re;
        } else {
          const im = vector.imaginary[index]!;
          const mag    = Math.hypot(re, im); // [B22-D] item 16: the worker's formula (waveforms.ts), so both answer one number - `re * re` overflowed past 1e154 and the 1e-30 floor held only at zero
          const magDb  = 20 * Math.log10(Math.max(1e-30, mag));
          const phase  = (Math.atan2(im, re) * 180) / Math.PI;
          point[`${vector.name}.mag`]   = magDb;
          point[`${vector.name}.phase`] = phase;
        }
      } else {
        point[vector.name] = vector.real[index]!;
      }
    });
    points.push(point);
  }
  const finalVars = output.complex
    ? vectors.flatMap((vector, k) => (k === 0 && /freq/i.test(vector.name) ? [vector.name] : [`${vector.name}.mag`, `${vector.name}.phase`]))
    : vectors.map((vector) => vector.name);
  return { analysis: (output.plotName || "Unknown").slice(0, 200), variables: finalVars, points };
}

// ─── Bounded raw-file reader ──────────────────────────────────────────────────

/** [B16.0.24.1 §1] the TRULY bounded raw read, [B22-A3] lifted into the diagnostic runner (which reads `result.raw` back with it);
 *  re-exported here for the B16.0.24.1 suite that pins it. */
export { readBoundedRawFile, type BoundedRawRead } from "@/app/lib/computation/diagnostic-runner";

// [B16.0.24 §G] canonical authenticated wrapper — authorization + CSRF + the
// bounded 8 MB / 30 s object read happen BEFORE this callback; the request
// abort signal reaches the runner only through the declared `exposeAbortSignal`
// input.
export const POST = authenticatedJsonRoute<{ state?: SchematicState; analysis?: SpiceAnalysis }>(
  { maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS, exposeAbortSignal: true },
  async ({ context, body, signal }) => {
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

  // Generate the netlist (server-owned RELATIVE raw filename), add the profile's seed option and screen the
  // deck that will run for injected control/include/shell directives BEFORE anything runs.
  let netlist: string;
  let nodeMap: Record<string, string>;
  let pinNodes: Record<string, string>;
  try {
    assertSchematicFieldsSafe(state, analysis);
    ({ netlist, nodeMap, pinNodes } = schematicToSpice(state, { analysis, rawOutputPath: "result.raw" }));
    netlist = seedDiagnosticDeck(netlist); // [B22-A3] D22-11: the profile's seed option; the screen reads the deck that runs
    assertNetlistSafe(netlist);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Netlist generation failed: ${msg}` }, { status: 400 });
  }

  // [B22-A3] OD-136: the diagnostic runner writes the deck into its own per-run directory, runs the pinned ngspice with the
  // profile's argv and exact environment, reads `result.raw` back bounded (MAX_RAW_BYTES) and removes the directory on every path.
  // [B22-A3 review] security-2, regressions-1: the request shares the runner's cap as its tenant and waits for a slot at most its
  // own wall clock (the runner's default), so a queued request is answered within 10 s of waiting plus 10 s of running.
  let run: DiagnosticRunRecord;
  try {
    run = await runDiagnosticNgspice({ operation: "run", deck: netlist, readRaw: true, wallClockMs: PROCESS_TIMEOUT_MS, readBackBytes: MAX_RAW_BYTES, signal: signal ?? undefined, holder: context.tenantId, interactive: true });
  } catch (e) {
    // a closed refusal before any process (an unpinned or mismatched install, the runner's cap or an expired wait, a run directory
    // that could not be prepared): the setting or the errno is named, never a value or a path
    if (e instanceof DiagnosticRunnerError) return Response.json({ error: e.message }, { status: 503 });
    throw e;
  }
  if (run.outcome === "spawn_failed") {
    return Response.json({ error: "ngspice could not be started from the pinned install" }, { status: 500 });
  }
  if (run.outcome === "timeout") {
    return Response.json({ error: "Simulation timed out" }, { status: 504 });
  }
  if (run.outcome === "kill_unconfirmed") {
    // [B22-A3 review] coverage-1: the cause is kept - an abort whose exit was not confirmed is a cancel, never "timed out"
    if (run.killReason === "cancelled") return Response.json({ ok: false, error: "Simulation cancelled; the ngspice process exit was not confirmed (kill_unconfirmed)" }, { status: 500 });
    return Response.json({ error: "Simulation timed out; the ngspice process exit was not confirmed (kill_unconfirmed)" }, { status: 504 });
  }
  if (run.outcome === "cancelled") {
    return Response.json({ ok: false, error: "Simulation cancelled" }, { status: 500 });
  }
  if (run.exitCode !== 0) {
    return Response.json({ ok: false, error: run.stderr.slice(-3000) || run.stdout.slice(-3000) || `NGSpice exited with code ${String(run.exitCode)}` }, { status: 500 });
  }

  // [B16.0.24.1 §1] TRULY bounded read (the runner's): at most MAX_RAW_BYTES actual bytes,
  // chunked storage (never allocated from the declared size), explicit
  // over-limit refusal — partial oversized output is NEVER parsed.
  if (run.raw.state !== "read") {
    if (run.raw.state === "over-limit") {
      return Response.json({ ok: false, error: "Simulation output exceeded the bounded size limit" }, { status: 500 });
    }
    if (run.raw.state === "invalid-utf8") {
      return Response.json({ ok: false, error: "Could not parse simulation output" }, { status: 500 });
    }
    return Response.json({ error: "NGSpice produced no output file" }, { status: 500 });
  }
  const rawText = run.raw.text;

  let parsed: SimResult;
  try {
    parsed = parseAsciiRaw(rawText);
  } catch (error) {
    // [B22-C] D22-10: a refused output is answered with its closed code, nothing of it returned; [B22-C review] regressions-5: an
    // output with no data point keeps the route's actionable guidance (B16.0.24's "no data" answer), now under its own closed code -
    // the validator returns no output without a vector and a point, so the former empty-table check could no longer fire
    if (error instanceof SimulationOutputError && error.code === "OUTPUT_EMPTY") return Response.json({ ok: false, error: "Simulation produced no data points. Check the netlist and analysis settings.", code: error.code }, { status: 500 });
    if (error instanceof SimulationOutputError) return Response.json({ ok: false, error: `Simulation output refused whole: ${error.code}`, code: error.code }, { status: 500 });
    return Response.json({ ok: false, error: "Could not parse simulation output" }, { status: 500 });
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
    runner:       diagnosticProvenance(run), // [B22-A3] diagnostic_only, environment_dependent, the profile and the observed install digest
  });
  });
