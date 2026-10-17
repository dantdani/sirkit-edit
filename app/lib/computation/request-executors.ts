/**
 * [B22-B] The server's executors for an APPROVED process-backed computation request (requests.ts; OD-139). Only the server
 * composition holds them; no agent path reaches them.
 *
 *  - `sirkit.computation.circuit-analysis`: the pinned SPICE analysis. The server writes the deck itself from the request's bounded
 *    numbers (formatted by the server; no caller text), seeds it with the profile's seed and screens the seeded deck with SEC-1's
 *    final screen (the deck screened is the deck run), then runs it ONCE on the B22-A3 diagnostic runner (`ngspice-local-diagnostic`,
 *    pinned by install digest, bounded, tree-killed). The raw file is parsed by a strict reader that refuses a malformed, short or
 *    non-finite file WHOLE, and the summary is checked by the kind's output validator. The evidence is labelled `diagnostic_only`
 *    and `environment_dependent`: never authority, never "verified".
 *  - `sirkit.computation.layout-experiment`: the placement experiment profile in the bounded engine host. Its engine has no worker
 *    entry in this build, so the host refuses it (`ENGINE_UNAVAILABLE`) and nothing runs on the request's thread. [PR-F, 2026-10-17] An injected `layoutExperiment` runner (the placement -> routing feedback loop, app/lib/pcb/experiments/placement-routing-feedback.ts, bound by a server composition root this build does not add) replaces the host for this kind only; the kind's wall clock, output bound and output validator still bound and check its answer (runInjectedLayoutExperiment, appended below).
 */
import { assertCompiledDeckSafe } from "../spice/netlist";
import { DiagnosticRunnerError, diagnosticProvenance, runDiagnosticNgspice, seedDiagnosticDeck } from "./diagnostic-runner";
import { computationKind, MICROCASE_QUANTITIES, validateComputationOutput, type AnalyticalMicrocase } from "./catalog";
import { EngineHostError, defaultEngineHost, type EngineHost } from "./engine-host";
import { SimulationOutputError, validateNgspiceAsciiOutput, type ValidatedSimulationOutput } from "./output-validator";
import { computationEvidence, type ComputationEvidence, type ComputationRequestExecutors, type SealedComputationRequest } from "./requests";

const NEWLINE = String.fromCharCode(10);
const CIRCUIT_KIND = "sirkit.computation.circuit-analysis";
const EXPERIMENT_KIND = "sirkit.computation.layout-experiment";
const ANALYSIS: Readonly<Record<AnalyticalMicrocase, "op" | "tran" | "ac">> = Object.freeze({ "resistor-divider": "op", "rc-step": "tran", "one-pole-lowpass": "ac" });

/** A number as the deck carries it: the server's own formatting (`toExponential(9)`), never a caller string. */
function spiceNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("CIRCUIT_INPUT_NOT_FINITE");
  return value.toExponential(9);
}

/** The pinned deck of one microcase circuit from the request's numbers: before (`unseeded`) or after (`seeded`) the profile's seed. */
export function buildCircuitAnalysisDeck(input: Readonly<Record<string, string | number>>, stage: "unseeded" | "seeded"): string {
  const circuit = input.circuit as AnalyticalMicrocase;
  const body: string[] = [`* sirkit circuit analysis: ${circuit}`];
  if (circuit === "resistor-divider") {
    body.push(`V1 in 0 DC ${spiceNumber(input.vin)}`, `R1 in out ${spiceNumber(input.r1)}`, `R2 out 0 ${spiceNumber(input.r2)}`, ".op");
  } else if (circuit === "rc-step") {
    const time = input.time as number;
    if (!(time > 0)) throw new Error("CIRCUIT_INPUT_NOT_SIMULABLE");
    body.push(`V1 in 0 DC ${spiceNumber(input.vin)}`, `R1 in out ${spiceNumber(input.r)}`, `C1 out 0 ${spiceNumber(input.c)} IC=0`, `.tran ${spiceNumber(time / 200)} ${spiceNumber(time)} uic`);
  } else if (circuit === "one-pole-lowpass") {
    body.push("V1 in 0 AC 1", `R1 in out ${spiceNumber(input.r)}`, `C1 out 0 ${spiceNumber(input.c)}`, `.ac lin 1 ${spiceNumber(input.frequency)} ${spiceNumber(input.frequency)}`);
  } else {
    throw new Error("CIRCUIT_UNKNOWN");
  }
  const vectors = circuit === "resistor-divider" ? "v(out) i(V1)" : "v(out)";
  const deck = [...body, ".control", "set filetype=ascii", "run", `write result.raw ${vectors}`, "quit", ".endc", ".end", ""].join(NEWLINE);
  return stage === "seeded" ? seedDiagnosticDeck(deck) : deck;
}

interface StrictRaw { readonly complex: boolean; readonly names: readonly string[]; readonly points: ReadonlyArray<ReadonlyArray<readonly [number, number]>> }
/** The strict reader's own bounds, narrower than the validator's defaults: at most 64 variables and 100,000 points. */
const STRICT_RAW_LIMITS = Object.freeze({ maxVariables: 64, maxPoints: 100_000 });
/** The strict ngspice ASCII raw reader: the declared variable and point counts met exactly (every point complete), every value a
 *  finite number literal (a complex value `re,im`), every point's index in order. Anything else refuses the file whole (no dropping,
 *  D22-10).
 *  [B22-D] item 16 (parser differentials): it is read by the ONE output validator (`validateNgspiceAsciiOutput`, B22-C) under its own
 *  bounds, so it reads every file exactly as the Studio worker's and `/api/simulate`'s parsers do. Its own reading disagreed with
 *  theirs (b22-d-adversarial case 8, red first): it refused a variable line carrying ngspice's attributes (` grid=3`, INFERRED from
 *  ngspice's raw writer), a file without `Flags:` or `No. Points:`, a `00` index and a complex value written `re, im`; it read a
 *  repeated time point and an undeclared vector type the validator refuses; it kept `-0`; it took the first of two `No. Points:`
 *  headers where the validator took the last. */
export function readStrictRaw(text: string): StrictRaw | null {
  let output: ValidatedSimulationOutput;
  try {
    output = validateNgspiceAsciiOutput(text, { limits: STRICT_RAW_LIMITS });
  } catch (error) {
    if (error instanceof SimulationOutputError) return null;
    throw error;
  }
  const vectors = [output.axis, ...output.variables];
  return {
    complex: output.complex,
    names: vectors.map((vector) => vector.name.toLowerCase()),
    points: Array.from({ length: output.points }, (_, point) => vectors.map((vector) => [vector.real[point]!, vector.imaginary ? vector.imaginary[point]! : 0] as const)),
  };
}

/** The microcase summary of a strict raw file (the quantities the analytical engine names), or null. */
function summarize(circuit: AnalyticalMicrocase, input: Readonly<Record<string, string | number>>, raw: StrictRaw): Record<string, unknown> | null {
  const column = (name: string): number => raw.names.indexOf(name);
  const last = raw.points[raw.points.length - 1]!;
  const out = column("v(out)");
  if (out < 0) return null;
  const units = MICROCASE_QUANTITIES[circuit];
  const quantities: Array<{ name: string; value: number; unit: string }> = [];
  if (circuit === "resistor-divider") {
    const current = column("i(v1)");
    if (current < 0) return null;
    quantities.push({ name: "vout", value: last[out]![0], unit: units.vout! }, { name: "current", value: -last[current]![0], unit: units.current! });
  } else if (circuit === "rc-step") {
    quantities.push({ name: "vout", value: last[out]![0], unit: units.vout! });
    if (typeof input.vin === "number" && input.vin !== 0) quantities.push({ name: "fraction", value: last[out]![0] / input.vin, unit: units.fraction! });
  } else {
    const [re, im] = last[out]!;
    const magnitude = Math.hypot(re, im);
    if (!(magnitude > 0)) return null;
    quantities.push({ name: "magnitude", value: magnitude, unit: units.magnitude! }, { name: "gainDb", value: 20 * Math.log10(magnitude), unit: units.gainDb! }, { name: "phaseDeg", value: (Math.atan2(im, re) * 180) / Math.PI, unit: units.phaseDeg! });
  }
  return { circuit, analysis: ANALYSIS[circuit], points: raw.points.length, quantities };
}

async function runCircuitAnalysis(request: SealedComputationRequest, signal?: AbortSignal): Promise<ComputationEvidence> {
  const refused = (refusal: string, outcome = "refused"): ComputationEvidence => computationEvidence(request, { outcome, refusal, result: null, provenance: null });
  const kind = computationKind(CIRCUIT_KIND)!;
  let deck: string;
  try {
    deck = assertCompiledDeckSafe(buildCircuitAnalysisDeck(request.input, "seeded"), { controlBlock: true, executed: true });
  } catch (error) {
    return refused(error instanceof Error && /^CIRCUIT_/.test(error.message) ? error.message : "DECK_REFUSED");
  }
  let record: Awaited<ReturnType<typeof runDiagnosticNgspice>>;
  try {
    record = await runDiagnosticNgspice({ operation: "run", deck, readRaw: true, wallClockMs: kind.budget.wallClockMs, holder: request.scope.tenantId, signal });
  } catch (error) {
    return refused(error instanceof DiagnosticRunnerError ? error.code : "RUNNER_FAILED");
  }
  const provenance = diagnosticProvenance(record) as unknown as Record<string, unknown>;
  const outcome = record.outcome;
  const withRun = (result: Record<string, unknown> | null, refusal: string | null): ComputationEvidence => computationEvidence(request, { outcome, refusal, result, provenance });
  if (record.outcome !== "exited" || record.exitCode !== 0 || record.raw.state !== "read") return withRun(null, "NO_OUTPUT");
  const raw = readStrictRaw(record.raw.text);
  const summary = raw ? summarize(request.input.circuit as AnalyticalMicrocase, request.input, raw) : null;
  if (!summary || validateComputationOutput(kind.outputValidatorId, summary).length > 0) return withRun(null, "OUTPUT_INVALID");
  return withRun(summary, null);
}

async function runLayoutExperiment(request: SealedComputationRequest, host: EngineHost, signal?: AbortSignal): Promise<ComputationEvidence> {
  const kind = computationKind(EXPERIMENT_KIND)!;
  try {
    const outcome = await host.run({ engineId: kind.engineId!, input: { ...request.input, basis: request.basis }, budget: { wallClockMs: Math.min(kind.budget.wallClockMs, Number(request.input.budgetSeconds) * 1_000), heapMiB: kind.budget.heapMiB, maxOutputBytes: kind.budget.maxOutputBytes }, signal, holder: request.scope.tenantId }); // [B22-B review] security-2: the request's tenant holds its share
    if (outcome.state !== "completed") return computationEvidence(request, { outcome: outcome.state, refusal: outcome.state === "terminated" ? outcome.reason : outcome.code, result: null, provenance: null });
    const valid = validateComputationOutput(kind.outputValidatorId, outcome.output).length === 0;
    return computationEvidence(request, { outcome: "completed", refusal: valid ? null : "OUTPUT_INVALID", result: valid ? (outcome.output as Record<string, unknown>) : null, provenance: null });
  } catch (error) {
    return computationEvidence(request, { outcome: "refused", refusal: error instanceof EngineHostError ? error.code : "ENGINE_FAILED", result: null, provenance: null });
  }
}

/** The server's executors (the host defaults to the process's one engine host). */
export function createComputationRequestExecutors(options: { engineHost?: EngineHost; layoutExperiment?: LayoutExperimentRunner } = {}): ComputationRequestExecutors { // [PR-F, 2026-10-17] layoutExperiment: the injected feedback-loop runner; absent = the host path, unchanged
  const host = options.engineHost ?? defaultEngineHost();
  return Object.freeze({
    [CIRCUIT_KIND]: (request: SealedComputationRequest, signal?: AbortSignal) => runCircuitAnalysis(request, signal),
    [EXPERIMENT_KIND]: (request: SealedComputationRequest, signal?: AbortSignal) => (options.layoutExperiment ? runInjectedLayoutExperiment(request, options.layoutExperiment, signal) : runLayoutExperiment(request, host, signal)),
  });
}

// [PR-F, 2026-10-17] The injected layout-experiment runner: a server composition root (none in this build; OD-159's approval route is
// still absent) binds the placement -> routing feedback loop over the request's basis (its canonical revision digest resolves the
// isolated snapshot server-side; the loop itself is app/lib/pcb/experiments/placement-routing-feedback.ts and runs no process of its
// own). The runner answers the kind's validator body plus provenance; the kind's wall clock (the smaller of the budget and the request's
// seconds), its output bound and its output validator still apply; a timeout, a cancellation, an invalid answer or a thrown runner is
// evidence with a refusal, never ok.
export type LayoutExperimentRunner = (input: { request: SealedComputationRequest; budget: { wallClockMs: number; maxOutputBytes: number }; signal: AbortSignal }) => Promise<{ body: Record<string, unknown>; provenance: Record<string, unknown> | null }>;

async function runInjectedLayoutExperiment(request: SealedComputationRequest, runner: LayoutExperimentRunner, signal?: AbortSignal): Promise<ComputationEvidence> {
  const kind = computationKind(EXPERIMENT_KIND)!;
  const budget = { wallClockMs: Math.min(kind.budget.wallClockMs, Number(request.input.budgetSeconds) * 1_000), maxOutputBytes: kind.budget.maxOutputBytes };
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), budget.wallClockMs);
  try {
    const answer = await runner({ request, budget, signal: controller.signal });
    if (controller.signal.aborted) return computationEvidence(request, { outcome: signal?.aborted ? "cancelled" : "timeout", refusal: signal?.aborted ? "CANCELLED" : "WALL_CLOCK", result: null, provenance: null });
    if (validateComputationOutput(kind.outputValidatorId, answer.body).length > 0) return computationEvidence(request, { outcome: "completed", refusal: "OUTPUT_INVALID", result: null, provenance: null });
    if (JSON.stringify(answer.body).length + JSON.stringify(answer.provenance ?? null).length > budget.maxOutputBytes) return computationEvidence(request, { outcome: "completed", refusal: "OUTPUT_TOO_LARGE", result: null, provenance: null });
    return computationEvidence(request, { outcome: "completed", refusal: null, result: answer.body, provenance: answer.provenance });
  } catch {
    return computationEvidence(request, { outcome: "refused", refusal: "RUNNER_FAILED", result: null, provenance: null });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
