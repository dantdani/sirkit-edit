/**
 * [B22-C] The one output validator for ngspice's ASCII raw files (discovery D22-10; 9.5 item 21; runbook B22-C :930 "output units
 * and numerical tolerances are validated", :931 "cancellation and timeout produce no fabricated results"). Both live parsers - the
 * Studio worker's (`app/lib/spice/waveforms.ts`) and `/api/simulate`'s - route through it. They used to drop what they could not
 * read (the worker every non-finite token, the route only NaN, keeping `Infinity`), and both indexed a stride-ordered token stream,
 * so one dropped token moved every later value onto the wrong variable or point; a short file was only a warning.
 *
 * Here nothing is dropped: the output is refused WHOLE, with one closed code, when
 *  - its header is missing or inconsistent (`OUTPUT_HEADER_INVALID`), or it is binary; [B22-D] item 16: or it repeats `Flags:`,
 *    `No. Variables:` or `No. Points:` (before B22-D the strict reader read the first copy and this validator the last);
 *  - a value is no number, a point index is out of order, or it holds more values than it declares (`OUTPUT_MALFORMED`);
 *  - a value is NaN, an infinity or a literal that overflows to one (`OUTPUT_NON_FINITE`); [B22-D] item 9: or a complex value whose
 *    magnitude overflows though both parts are finite (both parsers derive its magnitude in dB: it would be an infinity);
 *  - it holds fewer values than its declared points need, or ends inside a point (`OUTPUT_SHORT`);
 *  - [B22-C review] regressions-5: it declares or holds no data point at all (`OUTPUT_EMPTY`);
 *  - it exceeds the caller's variable, point or value bound (`OUTPUT_OVER_LIMIT`; the route's former silent truncation);
 *  - its time or frequency axis does not strictly increase (`OUTPUT_AXIS_NOT_INCREASING`);
 *  - a vector's unit is named neither by its name nor by its declared type (`OUTPUT_UNIT_UNKNOWN`).
 * A refusal's message names the code and the rule, never the refused text.
 *
 * It is built over CD-10's `createWaveformArtifact`: every accepted output satisfies that artifact's `valid` rule (finite values, a
 * strictly increasing axis, every signal as long as the axis, at least one signal), by construction of the checks above, and
 * `waveformArtifactOf` builds the `sirkit.waveform.v1` artifact from it. A time or frequency output keeps its axis; any other first
 * vector (a DC sweep's swept source - declared order, repeated by a nested sweep - or an operating point's first vector) is a signal
 * on a point-index axis, so the strictly-increasing rule is never claimed for a vector that is not an axis. The artifact is
 * `lossless_normalized`, never `authoritative_raw`: a diagnostic run is evidence.
 *
 * [B22-C review] regressions-3: the parse path builds no artifact (it digested every value about sixteen times for a result no caller
 * read) and never joins the values section into one string: it reads the values line by line, once.
 */
import { createWaveformArtifact } from "@/app/lib/model-simulation/waveform";
import type { WaveformArtifact, WaveformSignal } from "@/app/lib/model-simulation/types";
import { unitForVector } from "@/app/lib/spice/units";

export const SIMULATION_OUTPUT_REFUSALS = Object.freeze(["OUTPUT_HEADER_INVALID", "OUTPUT_MALFORMED", "OUTPUT_NON_FINITE", "OUTPUT_SHORT", "OUTPUT_EMPTY", "OUTPUT_OVER_LIMIT", "OUTPUT_AXIS_NOT_INCREASING", "OUTPUT_UNIT_UNKNOWN"] as const);
export type SimulationOutputRefusal = (typeof SIMULATION_OUTPUT_REFUSALS)[number];
/** [B22-C] The validator the ngspice runtime profiles bind (`validator.id`), and the CD-10 function it is built over. */
export const SIMULATION_OUTPUT_VALIDATOR = Object.freeze({ id: "cd10-waveform-artifact/1", over: "createWaveformArtifact" } as const);

const RULES: Readonly<Record<SimulationOutputRefusal, string>> = Object.freeze({
  OUTPUT_HEADER_INVALID: "its header is missing, inconsistent, binary or declares no signal",
  OUTPUT_MALFORMED: "a value is not a number, a point index is out of order, or it holds more values than it declares",
  OUTPUT_NON_FINITE: "a value is not finite (NaN, an infinity, or a literal that overflows to one)",
  OUTPUT_SHORT: "it holds fewer values than its declared points need, or ends inside a point",
  OUTPUT_EMPTY: "it declares or holds no data point",
  OUTPUT_OVER_LIMIT: "it exceeds the server's variable, point or value bound",
  OUTPUT_AXIS_NOT_INCREASING: "its time or frequency axis does not strictly increase",
  OUTPUT_UNIT_UNKNOWN: "a vector's unit is named neither by its name nor by its declared type",
});

/** [B22-C] A refused output: the closed code and its rule; never the refused text. */
export class SimulationOutputError extends Error {
  readonly code: SimulationOutputRefusal;
  constructor(code: SimulationOutputRefusal) {
    super(`${code}: the simulation output was refused whole because ${RULES[code]}; nothing was dropped and nothing was kept`);
    this.name = "SimulationOutputError";
    this.code = code;
  }
}
function refuse(code: SimulationOutputRefusal): never {
  throw new SimulationOutputError(code);
}

export interface SimulationOutputLimits {
  readonly maxVariables: number;
  readonly maxPoints: number;
  /** Every whitespace- or comma-separated token of the values section, point indexes included. */
  readonly maxValues: number;
}
export const DEFAULT_SIMULATION_OUTPUT_LIMITS: SimulationOutputLimits = Object.freeze({ maxVariables: 10_000, maxPoints: 5_000_000, maxValues: 50_000_000 });
export interface SimulationOutputOptions {
  readonly limits?: Partial<SimulationOutputLimits>;
}

export type SimulationAxisKind = "time" | "frequency" | "sweep";
export interface ValidatedVector {
  readonly name: string;
  /** The type ngspice declared for the vector (`time`, `voltage`, ...). */
  readonly type: string;
  /** The unit its name or its declared type names; `""` for a type ngspice itself declares without one. */
  readonly unit: string;
  readonly real: readonly number[];
  /** The imaginary parts of a complex output; null for a real one. */
  readonly imaginary: readonly number[] | null;
}
export interface ValidatedSimulationOutput {
  readonly title: string;
  readonly plotName: string;
  /** Lower-cased, as the legacy parser kept it. */
  readonly flags: string;
  readonly complex: boolean;
  readonly points: number;
  /** The file's first vector: the axis for time and frequency, the swept or first value otherwise. */
  readonly axis: ValidatedVector & { readonly kind: SimulationAxisKind };
  /** Every other vector, in the file's order. */
  readonly variables: readonly ValidatedVector[];
}

/**
 * [B22-C review] regressions-2: the unit each of ngspice's own vector types declares - the closed list of type names ngspice's front
 * end writes in a raw file's `Variables:` section, with the unit its type table gives each (INFERRED from ngspice's source, the
 * front end's type table and `guess_type`; no live run here). `temp-sweep` and `res-sweep` name a DC sweep over TEMP or a resistor;
 * admittance, capacitance, charge, power and impedance name the device-parameter saves (`@m1[gm]`, `@m1[cgs]`, `@q1[qbe]`,
 * `@r1[p]`, `@r1[r]`); decibel and phase the front end's `vdb()` and `vp()`; the noise types the noise analysis. The types ngspice
 * declares WITHOUT a unit (`notype`, `pole`, `zero`, `s-param`, `output-noise`, `input-noise`) keep the empty unit, as ngspice writes
 * them, and are read; only a type outside this list names no unit and refuses the output (`OUTPUT_UNIT_UNKNOWN`).
 */
export const NGSPICE_VECTOR_TYPE_UNITS: Readonly<Record<string, string>> = Object.freeze({
  notype: "",
  time: "s",
  frequency: "Hz",
  voltage: "V",
  current: "A",
  "voltage-density": "V/sqrt(Hz)",
  "current-density": "A/sqrt(Hz)",
  "sqr-voltage-density": "V^2/Hz",
  "sqr-current-density": "A^2/Hz",
  "sqr-voltage": "V^2",
  "sqr-current": "A^2",
  "onoise-spectrum": "(V or A)^2/Hz",
  "onoise-integrated": "V or A",
  "inoise-spectrum": "(V or A)^2/Hz",
  "inoise-integrated": "V or A",
  "output-noise": "",
  "input-noise": "",
  pole: "",
  zero: "",
  "s-param": "",
  "temp-sweep": "°C",
  "res-sweep": "Ω",
  impedance: "Ω",
  admittance: "S",
  power: "W",
  phase: "°",
  decibel: "dB",
  capacitance: "F",
  charge: "C",
});
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INDEX = /^\d+$/;
const NEWLINE = String.fromCharCode(10);

function integerHeader(text: string): number {
  const value = text.trim();
  if (!INDEX.test(value)) refuse("OUTPUT_HEADER_INVALID");
  return Number(value);
}
/** A value token as a finite number, or the code that refuses it. */
function numberOf(token: string): number | SimulationOutputRefusal {
  if (NUMBER.test(token)) {
    const value = Number(token);
    if (!Number.isFinite(value)) return "OUTPUT_NON_FINITE";
    return value === 0 ? 0 : value;
  }
  return /nan|inf|#ind/i.test(token) ? "OUTPUT_NON_FINITE" : "OUTPUT_MALFORMED"; // [B22-D review] tests-8: the MSVC indeterminate (`-1.#IND00e+000`) is a NaN
}
function unitOf(name: string, type: string): string {
  const named = unitForVector(name);
  if (named !== "") return named;
  if (!Object.prototype.hasOwnProperty.call(NGSPICE_VECTOR_TYPE_UNITS, type)) refuse("OUTPUT_UNIT_UNKNOWN");
  return NGSPICE_VECTOR_TYPE_UNITS[type]!;
}

/**
 * [B22-C] Validate an ngspice ASCII raw file WHOLE: the header, every value, the declared point count, the axis and every unit.
 * Throws `SimulationOutputError` with the first rule the file breaks; returns only a complete output.
 */
export function validateNgspiceAsciiOutput(raw: string, options: SimulationOutputOptions = {}): ValidatedSimulationOutput {
  const limits: SimulationOutputLimits = { ...DEFAULT_SIMULATION_OUTPUT_LIMITS, ...options.limits };
  const lines = raw.replace(/\r\n?/g, NEWLINE).split(NEWLINE);
  let title = "";
  let plotName = "";
  let flags: string | null = null;
  let declaredVariables: number | null = null;
  let declaredPoints: number | null = null;
  const declarations: Array<{ name: string; type: string }> = [];
  let valuesFrom = -1;
  let inVariables = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (trimmed === "Values:") {
      valuesFrom = index + 1;
      break;
    }
    if (trimmed === "Binary:") refuse("OUTPUT_HEADER_INVALID");
    if (inVariables) {
      const match = /^(\d+)\s+(\S+)\s+(\S+)/.exec(trimmed);
      if (!match || Number(match[1]) !== declarations.length) refuse("OUTPUT_HEADER_INVALID");
      declarations.push({ name: match[2]!, type: match[3]!.toLowerCase() });
      continue;
    }
    if (line.startsWith("Title:")) title = line.slice("Title:".length).trim();
    else if (line.startsWith("Plotname:")) plotName = line.slice("Plotname:".length).trim();
    else if (line.startsWith("Flags:")) flags = flags === null ? line.slice("Flags:".length).trim().toLowerCase() : refuse("OUTPUT_HEADER_INVALID"); // [B22-D] item 16: one copy of each header that decides the reading
    else if (line.startsWith("No. Variables:")) declaredVariables = declaredVariables === null ? integerHeader(line.slice("No. Variables:".length)) : refuse("OUTPUT_HEADER_INVALID");
    else if (line.startsWith("No. Points:")) declaredPoints = declaredPoints === null ? integerHeader(line.slice("No. Points:".length)) : refuse("OUTPUT_HEADER_INVALID");
    else if (trimmed === "Variables:") inVariables = true;
  }
  if (valuesFrom < 0 || declaredVariables === null || declaredVariables < 1 || declarations.length !== declaredVariables) refuse("OUTPUT_HEADER_INVALID");
  if (flags !== null && !/\b(?:real|complex)\b/.test(flags)) refuse("OUTPUT_HEADER_INVALID");
  if (declaredVariables > limits.maxVariables || (declaredPoints !== null && declaredPoints > limits.maxPoints)) refuse("OUTPUT_OVER_LIMIT");
  const complex = flags !== null && /\bcomplex\b/.test(flags);
  const perVariable = complex ? 2 : 1;
  const stride = 1 + declaredVariables * perVariable;

  // [B22-C review] regressions-3: one pass over the values, line by line - no joined copy of the section, no array of token strings.
  // A value is stored only up to the declared points (or the value bound); the count decides first, exactly as before: the value
  // bound, then a short or over-long section, then an empty one, then the point bound, and only then the first value refused in order
  const declaredTotal = declaredPoints === null ? null : declaredPoints * stride;
  const real: number[][] = declarations.map(() => []);
  const imaginary: number[][] | null = complex ? declarations.map(() => []) : null;
  const token = /[^\s,]+/g;
  let count = 0;
  let firstValueRefusal: SimulationOutputRefusal | null = null;
  for (let index = valuesFrom; index < lines.length; index += 1) {
    const line = lines[index]!;
    token.lastIndex = 0;
    for (let match = token.exec(line); match !== null; match = token.exec(line)) {
      if (count >= limits.maxValues) refuse("OUTPUT_OVER_LIMIT");
      const position = count;
      count += 1;
      if (firstValueRefusal !== null || (declaredTotal !== null && position >= declaredTotal)) continue;
      const offset = position % stride;
      if (offset === 0) {
        if (!INDEX.test(match[0]) || Number(match[0]) !== (position - offset) / stride) firstValueRefusal = "OUTPUT_MALFORMED";
        continue;
      }
      const value = numberOf(match[0]);
      if (typeof value !== "number") {
        firstValueRefusal = value;
        continue;
      }
      const slot = offset - 1;
      const variable = complex ? slot >> 1 : slot;
      (imaginary && slot % 2 === 1 ? imaginary : real)[variable]!.push(value);
      if (imaginary && slot % 2 === 1 && !Number.isFinite(Math.hypot(real[variable]![real[variable]!.length - 1]!, value))) firstValueRefusal = "OUTPUT_NON_FINITE"; // [B22-D] item 9
    }
  }
  let points: number;
  if (declaredTotal !== null) {
    if (count < declaredTotal) refuse("OUTPUT_SHORT");
    if (count > declaredTotal) refuse("OUTPUT_MALFORMED");
    points = declaredPoints!;
  } else {
    if (count % stride !== 0) refuse("OUTPUT_SHORT");
    points = count / stride;
  }
  if (points === 0) refuse("OUTPUT_EMPTY");
  if (points > limits.maxPoints) refuse("OUTPUT_OVER_LIMIT");
  if (firstValueRefusal !== null) refuse(firstValueRefusal);

  const vectors: ValidatedVector[] = declarations.map((declaration, index) => Object.freeze({ name: declaration.name, type: declaration.type, unit: unitOf(declaration.name, declaration.type), real: real[index]!, imaginary: imaginary ? imaginary[index]! : null }));
  const first = vectors[0]!;
  const lowered = first.name.toLowerCase();
  const kind: SimulationAxisKind = lowered === "time" || first.type === "time" ? "time" : lowered === "frequency" || first.type === "frequency" ? "frequency" : "sweep";
  if (kind !== "sweep" && !first.real.every((value, index) => index === 0 || value > first.real[index - 1]!)) refuse("OUTPUT_AXIS_NOT_INCREASING");
  if (kind !== "sweep" && vectors.length < 2) refuse("OUTPUT_HEADER_INVALID");
  return Object.freeze({ title, plotName, flags: flags ?? "real", complex, points, axis: Object.freeze({ ...first, kind }), variables: Object.freeze(vectors.slice(1)) });
}

/**
 * [B22-C review] regressions-3: the CD-10 `sirkit.waveform.v1` artifact of a validated output, built only where one is wanted (no
 * live path persists one in B22-C). It is `valid` for every output `validateNgspiceAsciiOutput` returns, and `lossless_normalized`.
 */
export function waveformArtifactOf(output: ValidatedSimulationOutput, options: { readonly runId?: string } = {}): WaveformArtifact {
  const signalsOf = (vector: ValidatedVector, index: number): Array<Omit<WaveformSignal, "deterministicDigest">> => vector.imaginary
    ? [{ signalId: `signal:${index}:re`, semanticObjectId: `${vector.name}#re`, name: `${vector.name}#re`, unit: vector.unit, values: [...vector.real] }, { signalId: `signal:${index}:im`, semanticObjectId: `${vector.name}#im`, name: `${vector.name}#im`, unit: vector.unit, values: [...vector.imaginary] }]
    : [{ signalId: `signal:${index}`, semanticObjectId: vector.name, name: vector.name, unit: vector.unit, values: [...vector.real] }];
  const sweep = output.axis.kind === "sweep";
  return createWaveformArtifact({
    runId: options.runId ?? "ngspice-ascii-raw",
    axis: sweep ? { semanticName: "point", unit: "index", values: Array.from({ length: output.points }, (_, index) => index) } : { semanticName: output.axis.name, unit: output.axis.unit, values: [...output.axis.real] },
    signals: (sweep ? [output.axis, ...output.variables] : output.variables).flatMap((vector, index) => signalsOf(vector, sweep ? index : index + 1)),
    rawOrDerivedState: "lossless_normalized",
    retentionAndLicensePolicy: "diagnostic-evidence; the raw file is not retained",
  });
}
