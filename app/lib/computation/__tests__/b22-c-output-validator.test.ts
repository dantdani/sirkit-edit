/**
 * [B22-C] One output validator (discovery D22-10; 9.5 item 21; runbook B22-C :930 "output units and numerical tolerances are
 * validated", :931 "no fabricated results"). The two live ngspice ASCII raw parsers lost values silently and disagreed: the
 * worker's (`waveforms.ts`) dropped every non-finite token, `/api/simulate`'s kept `Infinity` and dropped only NaN, and both then
 * indexed a stride-ordered token stream, so a dropped token shifted every later value onto the wrong variable or point; a short file
 * was a warning and the run still completed. Both now route through `app/lib/computation/output-validator.ts`, built over CD-10's
 * `createWaveformArtifact`: a non-finite value, a short or over-long values section, a misaligned point index, a time or frequency
 * axis that does not strictly increase and a unit it cannot name refuse the output WHOLE with a closed code - nothing is dropped.
 *
 * Test-first: cases 1-9 ran RED on b4c7be7 (pre-edit the worker dropped `Infinity`, `1e999`, `nan` and a short tail and
 * `/api/simulate` answered 200 with `Infinity` or a short table; the validator module did not exist). The diagnostic runner is an
 * in-process fake: no process, no file.
 *
 * [B22-C review] A vector's unit comes from its name or from ngspice's own declared type, from a closed list of ngspice's type
 * names (case 6, regressions-2: a TEMP or resistor sweep, device-parameter saves, decibel and phase, noise and pole-zero outputs);
 * the parse path builds no CD-10 artifact - `waveformArtifactOf` builds it where one is wanted (case 7, regressions-3); an output
 * with no data point has its own closed code and the route keeps its guidance (case 4, regressions-5); a refused output fails the
 * worker's run with its logs and manifest kept (case 8, coverage-10); the pages state the revisions the registry holds (case 9,
 * regressions-6, coverage-4). Those ran RED on the reviewed tree; the header refusals and the route's own bounds (case 10, tests-7)
 * were green there and each was proved by a deliberate source breakage.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runnerState = vi.hoisted(() => ({ raw: "", calls: 0, stdout: "" }));
// [B22-C review] regressions-3: count the CD-10 artifacts built, to show the parse path builds none
const waveformCalls = vi.hoisted(() => ({ created: 0 }));
vi.mock("@/app/lib/model-simulation/waveform", async (orig) => {
  const actual = await orig() as typeof import("@/app/lib/model-simulation/waveform");
  return { ...actual, createWaveformArtifact: (...args: Parameters<typeof actual.createWaveformArtifact>) => { waveformCalls.created += 1; return actual.createWaveformArtifact(...args); } };
});
vi.mock("@/app/lib/computation/diagnostic-runner", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return {
    ...actual,
    verifyDiagnosticInstall: async () => "e".repeat(64),
    diagnosticNgspiceVersion: async () => ({ version: "ngspice-46 (b22-c fake)", installDigest: null }),
    runDiagnosticNgspice: async () => {
      runnerState.calls += 1;
      return { runId: "diagrun_00000000-0000-4000-8000-000000000000", profileId: "ngspice-local-diagnostic", profileDigest: "f".repeat(64), installDigest: `sirkit-install-tree-sha256/1:${"e".repeat(64)}`, labels: actual.DIAGNOSTIC_RESULT_LABELS, operation: "run", outcome: "exited", spawned: true, killReason: null, exitCode: 0, stdout: runnerState.stdout, stderr: "", raw: { state: "read", text: runnerState.raw }, wallClockMs: 10_000, hostAddedEnvironment: [] };
    },
  };
});

import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { parseNgspiceAsciiRaw } from "@/app/lib/spice/waveforms";
import { createSimulationProject } from "@/app/lib/spice/project";
import { estimateRunPlan } from "@/app/lib/spice/run-plan";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";
import { validateWaveformArtifact } from "@/app/lib/model-simulation/waveform";
import { executeRunPoint } from "@/app/lib/spice/server/worker";
import { POST as simulatePost } from "@/app/api/simulate/route";

const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");
afterEach(() => {
  resetInjectedIdentity();
  runnerState.raw = "";
  runnerState.calls = 0;
  runnerState.stdout = "";
});

/** An ngspice ASCII raw file: header lines, then one `index value...` line per point (values as the tokens given). */
function raw(options: { plot?: string; flags?: string; variables: Array<[string, string]>; points: string[][]; declare?: number | null }): string {
  const lines = ["Title: b22-c", `Plotname: ${options.plot ?? "Transient Analysis"}`, `Flags: ${options.flags ?? "real"}`, `No. Variables: ${options.variables.length}`];
  const declared = options.declare === undefined ? options.points.length : options.declare;
  if (declared !== null) lines.push(`No. Points: ${declared}`);
  lines.push("Variables:", ...options.variables.map(([name, type], index) => ` ${index} ${name} ${type}`), "Values:");
  options.points.forEach((values, index) => lines.push(`${index} ${values.join(" ")}`));
  return [...lines, ""].join(NEWLINE);
}
const TRAN: Array<[string, string]> = [["time", "time"], ["v(out)", "voltage"]];
const transient = (tokens: string[], declare?: number | null) => raw({ variables: TRAN, points: tokens.map((value, index) => [String(index * 1e-3), value]), declare });

async function simulate(text: string): Promise<{ status: number; body: Record<string, unknown> }> {
  runnerState.raw = text;
  injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "local", role: "editor" });
  const state = {
    components: [
      { id: "v1", type: "voltage-source", value: "5", position: { x: 100, y: 100 }, rotation: 0, refDes: "V1" },
      { id: "r1", type: "resistor", value: "1k", position: { x: 130, y: 70 }, rotation: 0, refDes: "R1" },
      { id: "g1", type: "ground", value: "", position: { x: 100, y: 180 }, rotation: 0, refDes: "" },
    ],
    wires: [{ id: "w1", vertices: [{ x: 100, y: 130 }, { x: 100, y: 160 }] }, { id: "w2", vertices: [{ x: 160, y: 70 }, { x: 160, y: 160 }, { x: 100, y: 160 }] }],
    netLabels: [],
  };
  const response = await simulatePost(new Request("http://localhost/api/simulate", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "local", "x-sirkit-branch-id": "local" }, body: JSON.stringify({ state }) }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
/** Both legacy parsers on one raw file: the worker's code (or null when it parses) and the route's answer. */
async function bothParsers(text: string): Promise<{ worker: string | null; route: { status: number; code: unknown } }> {
  let worker: string | null = null;
  try {
    parseNgspiceAsciiRaw(text);
  } catch (error) {
    worker = (error as { code?: string }).code ?? "UNCLOSED";
  }
  const answer = await simulate(text);
  return { worker, route: { status: answer.status, code: answer.body.code } };
}

describe("[B22-C] one output validator: refused whole, never dropped (D22-10)", () => {
  it("1. Infinity: the worker dropped it and shifted every later value, /api/simulate kept it (the parser differential); both now refuse the output whole with OUTPUT_NON_FINITE", async () => {
    const text = transient(["1", "Infinity", "3"]);
    expect(await bothParsers(text)).toEqual({ worker: "OUTPUT_NON_FINITE", route: { status: 500, code: "OUTPUT_NON_FINITE" } });
    expect(runnerState.calls).toBe(1);
  });

  it("2. an overflowing literal (1e999, Infinity in JS) is refused whole by both, with the same closed code", async () => {
    expect(await bothParsers(transient(["1", "1e999", "3"]))).toEqual({ worker: "OUTPUT_NON_FINITE", route: { status: 500, code: "OUTPUT_NON_FINITE" } });
    expect(await bothParsers(transient(["1", "-1e999", "3"]))).toEqual({ worker: "OUTPUT_NON_FINITE", route: { status: 500, code: "OUTPUT_NON_FINITE" } });
  });

  it("3. textual non-finite tokens (nan, inf, 1.#INF00e+000, 1.#QNAN0e+000) - dropped alike by both before - are refused whole; the closed message never echoes the token", async () => {
    const messages = new Set<string>();
    for (const token of ["nan", "inf", "-inf", "1.#INF00e+000", "1.#QNAN0e+000"]) {
      const result = await bothParsers(transient(["1", token, "3"]));
      expect(result, token).toEqual({ worker: "OUTPUT_NON_FINITE", route: { status: 500, code: "OUTPUT_NON_FINITE" } });
      let message = "";
      try { parseNgspiceAsciiRaw(transient(["1", token, "3"])); } catch (error) { message = (error as Error).message; }
      expect(message.startsWith("OUTPUT_NON_FINITE: "), token).toBe(true);
      messages.add(message);
    }
    expect(messages.size).toBe(1); // one closed sentence whatever the token: the message never carries the refused text
    expect([...messages][0]).not.toMatch(/#|QNAN|e\+000/);
    // a token that is no number at all, or a decimal comma (locale drift), is malformed or misaligned, never read
    expect((await bothParsers(transient(["1", "abc", "3"]))).worker).toBe("OUTPUT_MALFORMED");
    expect((await bothParsers(transient(["1", "2,5", "3"]))).worker).toBe("OUTPUT_MALFORMED");
  });

  it("4. a short output (fewer points than declared, a partial last point), an over-long one and a misaligned point index are refused whole; a raw that declares no point count is read when every point is complete", async () => {
    const short = [...transient(["1", "2", "3"]).split(NEWLINE).filter((line) => !line.startsWith("2 ")), ""].join(NEWLINE);
    expect(await bothParsers(short)).toEqual({ worker: "OUTPUT_SHORT", route: { status: 500, code: "OUTPUT_SHORT" } });
    const partial = transient(["1", "2", "3"]).replace(`${NEWLINE}2 0.002 3`, `${NEWLINE}2 0.002`);
    expect(await bothParsers(partial)).toEqual({ worker: "OUTPUT_SHORT", route: { status: 500, code: "OUTPUT_SHORT" } });
    expect(await bothParsers(transient(["1", "2", "3"], 2))).toEqual({ worker: "OUTPUT_MALFORMED", route: { status: 500, code: "OUTPUT_MALFORMED" } });
    const misaligned = transient(["1", "2", "3"]).replace(`${NEWLINE}1 0.001 2`, `${NEWLINE}7 0.001 2`);
    expect(await bothParsers(misaligned)).toEqual({ worker: "OUTPUT_MALFORMED", route: { status: 500, code: "OUTPUT_MALFORMED" } });
    // B16.0.24's parity raw declares no point count: two complete points are read by both, as before
    const undeclared = ["Plotname: Transient Analysis", "Flags: real", "No. Variables: 2", "Variables:", " 0 time time", " 1 v(out) voltage", "Values:", "0 0 1.0", "1 1e-3 2.0"].join(NEWLINE);
    expect(await bothParsers(undeclared)).toEqual({ worker: null, route: { status: 200, code: undefined } });
    expect((await simulate(undeclared)).body.points).toEqual([{ time: 0, "v(out)": 1 }, { time: 0.001, "v(out)": 2 }]);
    // [B22-C review] regressions-5: an output with no data point (declared zero, or none written) has its own closed code and rule,
    // and /api/simulate keeps its actionable guidance for it
    const empty = raw({ variables: TRAN, points: [] });
    expect(await bothParsers(empty)).toEqual({ worker: "OUTPUT_EMPTY", route: { status: 500, code: "OUTPUT_EMPTY" } });
    expect((await simulate(empty)).body.error).toBe("Simulation produced no data points. Check the netlist and analysis settings.");
    expect((await bothParsers(raw({ variables: TRAN, points: [], declare: null }))).worker).toBe("OUTPUT_EMPTY");
    let rule = "";
    try { parseNgspiceAsciiRaw(empty); } catch (error) { rule = (error as Error).message; }
    expect(rule).toMatch(/^OUTPUT_EMPTY: [^\n]*no data point/);
    expect(rule).not.toMatch(/fewer values/);
  });

  it("5. a time or frequency axis that does not strictly increase is refused whole; a DC sweep's swept value (declared order, nested sweeps repeat it) is a signal on an index axis and is read", async () => {
    const backwards = raw({ variables: TRAN, points: [["0", "1"], ["0.002", "2"], ["0.001", "3"]] });
    expect(await bothParsers(backwards)).toEqual({ worker: "OUTPUT_AXIS_NOT_INCREASING", route: { status: 500, code: "OUTPUT_AXIS_NOT_INCREASING" } });
    const repeated = raw({ variables: TRAN, points: [["0", "1"], ["0.001", "2"], ["0.001", "3"]] });
    expect((await bothParsers(repeated)).worker).toBe("OUTPUT_AXIS_NOT_INCREASING");
    const ac = raw({ plot: "AC Analysis", flags: "complex", variables: [["frequency", "frequency"], ["v(out)", "voltage"]], points: [["1000,0", "1,0"], ["100,0", "0.5,-0.5"]] });
    expect((await bothParsers(ac)).worker).toBe("OUTPUT_AXIS_NOT_INCREASING");
    const sweep = raw({ plot: "DC transfer characteristic", variables: [["v-sweep", "voltage"], ["v(out)", "voltage"]], points: [["5", "2.5"], ["4", "2"], ["3", "1.5"]] });
    expect(await bothParsers(sweep)).toEqual({ worker: null, route: { status: 200, code: undefined } });
    expect(parseNgspiceAsciiRaw(sweep).waveforms.map((waveform) => [waveform.name, waveform.x, waveform.y])).toEqual([["v(out)", [5, 4, 3], [2.5, 2, 1.5]]]);
  });

  it("6. a vector's unit comes from its name or from ngspice's own declared type (v(...) and voltage are V, i(...) and current are A); [B22-C review] regressions-2: every type on ngspice's closed type list is read with ngspice's unit - a TEMP or resistor sweep, device-parameter saves, decibel and phase, noise and pole-zero outputs - and only a type outside that list refuses the output whole", async () => {
    const { validateNgspiceAsciiOutput } = await import("@/app/lib/computation/output-validator");
    const unitsOf = (variables: Array<[string, string]>, points: string[][]) => {
      const output = validateNgspiceAsciiOutput(raw({ variables, points }));
      return [output.axis, ...output.variables].map((vector) => [vector.name, vector.unit]);
    };
    // a DC sweep over TEMP or over a resistor (the studio's DC source is a free-text field): the swept value is a signal on an index axis
    expect(unitsOf([["temp-sweep", "temp-sweep"], ["v(out)", "voltage"]], [["-40", "1"], ["25", "2"], ["125", "3"]])).toEqual([["temp-sweep", "°C"], ["v(out)", "V"]]);
    expect(unitsOf([["res-sweep", "res-sweep"], ["v(out)", "voltage"]], [["1000", "1"], ["2000", "2"]])).toEqual([["res-sweep", "Ω"], ["v(out)", "V"]]);
    // device-parameter saves (SEC-1's output allowlist admits @dev[param]) and the front end's decibel and phase vectors
    const device: Array<[string, string]> = [["time", "time"], ["@m1[gm]", "admittance"], ["@m1[cgs]", "capacitance"], ["@q1[qbe]", "charge"], ["@r1[p]", "power"], ["@r1[r]", "impedance"], ["vdb(out)", "decibel"], ["vp(out)", "phase"]];
    expect(unitsOf(device, [["0", "1", "2", "3", "4", "5", "6", "7"], ["0.001", "1", "2", "3", "4", "5", "6", "7"]])).toEqual([["time", "s"], ["@m1[gm]", "S"], ["@m1[cgs]", "F"], ["@q1[qbe]", "C"], ["@r1[p]", "W"], ["@r1[r]", "Ω"], ["vdb(out)", "dB"], ["vp(out)", "°"]]);
    // noise and pole-zero outputs: the types ngspice itself declares without a unit keep the empty unit, as ngspice writes them
    expect(unitsOf([["frequency", "frequency"], ["onoise_spectrum", "notype"], ["inoise_spectrum", "notype"]], [["10", "1e-9", "2e-9"], ["100", "1e-9", "2e-9"]])).toEqual([["frequency", "Hz"], ["onoise_spectrum", ""], ["inoise_spectrum", ""]]);
    expect(unitsOf([["frequency", "frequency"], ["onoise_spectrum", "sqr-voltage-density"]], [["10", "1e-9"], ["100", "1e-9"]])).toEqual([["frequency", "Hz"], ["onoise_spectrum", "V^2/Hz"]]);
    expect(unitsOf([["pole(1)", "pole"], ["zero(1)", "zero"]], [["-1000", "-2000"]])).toEqual([["pole(1)", ""], ["zero(1)", ""]]);
    // both parsers read a TEMP sweep and a device-parameter save the same way
    expect(await bothParsers(raw({ plot: "DC transfer characteristic", variables: [["temp-sweep", "temp-sweep"], ["v(out)", "voltage"]], points: [["-40", "1"], ["25", "2"]] }))).toEqual({ worker: null, route: { status: 200, code: undefined } });
    expect(parseNgspiceAsciiRaw(raw({ variables: [["time", "time"], ["@r1[p]", "power"]], points: [["0", "1"], ["0.001", "2"]] })).waveforms.map((waveform) => [waveform.name, waveform.unit])).toEqual([["@r1[p]", "W"]]);
    // a type outside ngspice's closed type list names no unit: refused whole by both
    const unknown = raw({ variables: [["time", "time"], ["x", "furlongs"]], points: [["0", "1"], ["0.001", "2"]] });
    expect(await bothParsers(unknown)).toEqual({ worker: "OUTPUT_UNIT_UNKNOWN", route: { status: 500, code: "OUTPUT_UNIT_UNKNOWN" } });
    const typed = raw({ variables: [["time", "time"], ["out", "voltage"], ["v1#branch", "current"]], points: [["0", "1", "0.001"], ["0.001", "2", "0.002"]] });
    const output = validateNgspiceAsciiOutput(typed);
    expect(output.axis).toMatchObject({ name: "time", unit: "s", kind: "time" });
    expect(output.variables.map((variable) => [variable.name, variable.unit])).toEqual([["out", "V"], ["v1#branch", "A"]]);
    expect(parseNgspiceAsciiRaw(typed).waveforms.map((waveform) => [waveform.name, waveform.unit])).toEqual([["out", "V"], ["v1#branch", "A"]]);
  });

  it("7. the validator is built over createWaveformArtifact: a valid CD-10 artifact, lossless_normalized (never authoritative_raw), with closed codes; legacy shapes are unchanged for good files", async () => {
    const validator = await import("@/app/lib/computation/output-validator");
    // [B22-C review] regressions-3: the parse path (the validator and both parsers) builds no CD-10 artifact; it is built on demand
    waveformCalls.created = 0;
    const output = validator.validateNgspiceAsciiOutput(transient(["1", "2", "3"]));
    parseNgspiceAsciiRaw(transient(["1", "2", "3"]));
    await simulate(transient(["1", "2", "3"]));
    expect(waveformCalls.created).toBe(0);
    expect(Object.keys(output)).not.toContain("artifact");
    expect([...validator.SIMULATION_OUTPUT_REFUSALS]).toEqual(["OUTPUT_HEADER_INVALID", "OUTPUT_MALFORMED", "OUTPUT_NON_FINITE", "OUTPUT_SHORT", "OUTPUT_EMPTY", "OUTPUT_OVER_LIMIT", "OUTPUT_AXIS_NOT_INCREASING", "OUTPUT_UNIT_UNKNOWN"]);
    const artifact = validator.waveformArtifactOf(output, { runId: "run-b22c" });
    expect(waveformCalls.created).toBe(1);
    expect(artifact.runId).toBe("run-b22c");
    expect(artifact.validationState).toBe("valid");
    expect(artifact.rawOrDerivedState).toBe("lossless_normalized");
    expect(artifact.formatAndSchema).toBe("sirkit.waveform.v1");
    expect(artifact.axis).toEqual({ semanticName: "time", unit: "s", values: [0, 0.001, 0.002] });
    expect(artifact.signals.map((signal) => [signal.name, signal.unit, signal.values])).toEqual([["v(out)", "V", [1, 2, 3]]]);
    expect(validateWaveformArtifact(artifact)).toEqual([]);
    // every output the validator accepts is a valid CD-10 artifact: a transient, a complex AC file, a DC sweep and an operating point
    for (const accepted of [
      raw({ plot: "AC Analysis", flags: "complex", variables: [["frequency", "frequency"], ["v(out)", "voltage"]], points: [["100,0", "1,0"], ["1000,0", "0,-1"]] }),
      raw({ plot: "DC transfer characteristic", variables: [["v-sweep", "voltage"], ["v(out)", "voltage"]], points: [["5", "2.5"], ["5", "2"], ["3", "1.5"]] }),
      raw({ plot: "Operating Point", variables: [["v(1)", "voltage"]], points: [["1"]] }),
    ]) {
      const built = validator.waveformArtifactOf(validator.validateNgspiceAsciiOutput(accepted));
      expect(built.validationState).toBe("valid");
      expect(validateWaveformArtifact(built)).toEqual([]);
    }
    expect(validator.SIMULATION_OUTPUT_VALIDATOR).toEqual({ id: "cd10-waveform-artifact/1", over: "createWaveformArtifact" });
    expect(read("app/lib/computation/output-validator.ts")).toMatch(/import \{[^}]*createWaveformArtifact[^}]*\} from "@\/app\/lib\/model-simulation\/waveform";/);
    // over-limit refused whole (the route's former silent truncation)
    expect(() => validator.validateNgspiceAsciiOutput(transient(["1", "2", "3"]), { limits: { maxPoints: 2 } })).toThrow(/^OUTPUT_OVER_LIMIT: /);
    // the existing fixture (waveforms suite) parses exactly as before
    const legacy = `Title: demo\nPlotname: Transient Analysis\nFlags: real\nNo. Variables: 2\nNo. Points: 3\nVariables:\n  0 time time\n  1 v(out) voltage\nValues:\n0 0\n 0\n1 1e-3\n 1.2\n2 2e-3\n 2.4\n`;
    const parsed = parseNgspiceAsciiRaw(legacy);
    expect(parsed.waveforms.map((waveform) => [waveform.name, waveform.unit, waveform.xName, waveform.xUnit, waveform.x, waveform.y])).toEqual([["v(out)", "V", "time", "s", [0, 0.001, 0.002], [0, 1.2, 2.4]]]);
    expect(parsed.warnings).toEqual([]);
    // a complex AC file keeps its magnitude and phase series
    const ac = raw({ plot: "AC Analysis", flags: "complex", variables: [["frequency", "frequency"], ["v(out)", "voltage"]], points: [["100,0", "1,0"], ["1000,0", "0,-1"]] });
    const complex = parseNgspiceAsciiRaw(ac);
    expect(complex.waveforms.map((waveform) => [waveform.name, waveform.unit, waveform.x])).toEqual([["v(out).mag", "dB", [100, 1000]], ["v(out).phase", "°", [100, 1000]]]);
    expect(complex.waveforms[1]!.y[0]).toBe(0);
    expect(complex.waveforms[1]!.y[1]).toBeCloseTo(-90, 9);
    const routed = await simulate(ac);
    expect(routed.status).toBe(200);
    expect(routed.body.variables).toEqual(["frequency", "v(out).mag", "v(out).phase"]);
    // an operating point with one vector keeps its single inspectable series
    const op = raw({ plot: "Operating Point", variables: [["v(1)", "voltage"]], points: [["1"]] });
    expect(parseNgspiceAsciiRaw(op).waveforms.map((waveform) => [waveform.name, waveform.x, waveform.y])).toEqual([["v(1)", [0], [1]]]);
  });

  it("8. the worker refuses a non-finite raw output: the run fails with the closed code and returns no waveform; [B22-C review] coverage-10: it keeps the run's logs, its manifest (the raw file's SHA-256) and its netlist, as every other failure does; a good file completes", async () => {
    const project = createSimulationProject(dividerSchematic());
    const test = project.tests[0]!;
    test.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
    test.outputs = [{ id: "vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
    const planId = project.runPlans[0]!.id;
    const point = estimateRunPlan(project, planId).runPoints[0]!;
    const run = () => executeRunPoint({ runId: "run-b22c", project, runPlanId: planId, runPoint: point, parts: [], signal: new AbortController().signal, onEvent: () => {} });
    runnerState.raw = transient(["1", "Infinity", "3"]);
    runnerState.stdout = "the solver's own log";
    const refused = await run();
    expect(refused.status).toBe("failed");
    expect(refused.error).toMatch(/^OUTPUT_NON_FINITE: /);
    expect(refused.waveforms).toBeUndefined();
    expect(refused.scalars).toBeUndefined();
    expect(refused.stdout).toBe("the solver's own log");
    expect(refused.manifest?.rawOutput?.sha256).toBe(createHash("sha256").update(runnerState.raw).digest("hex"));
    expect(refused.netlist?.executed).toMatch(/\.end/);
    expect(refused.artifactId).toBe("diagrun_00000000-0000-4000-8000-000000000000");
    runnerState.stdout = "";
    runnerState.raw = transient(["1", "2", "3"]);
    const result = await run();
    expect(result.status).toBe("completed");
    expect(result.waveforms?.map((waveform) => waveform.y)).toEqual([[1, 2, 3]]);
    expect(result.manifest?.simulator.runner?.profileDigest).toBe("f".repeat(64));
  });

  it("9. the records say so: the ngspice profiles bind the wired validator (an immutable profile moves by revision), and the bundle README no longer says the parsed waveforms drop values", async () => {
    const { runtimeProfile } = await import("@/app/lib/computation/runtime-profile");
    for (const id of ["ngspice-local-diagnostic", "ngspice-oci"] as const) {
      const profile = runtimeProfile(id, () => undefined);
      expect(profile.validator, id).toMatchObject({ id: "cd10-waveform-artifact/1", module: "app/lib/computation/output-validator.ts", wired: true });
      expect(profile.parser.note, id).not.toMatch(/drops/);
    }
    expect(runtimeProfile("ngspice-local-diagnostic", () => undefined).revision).toBe(3);
    expect(runtimeProfile("ngspice-oci", () => undefined).revision).toBe(2);
    const bundle = read("app/api/spice/runs/[id]/bundle/route.ts");
    expect(bundle).not.toContain("drop the non-finite values");
    expect(bundle).toContain("refused whole");
    // [B22-C review] regressions-6, coverage-4: the A2/A3 pages state the revisions the registry holds, the parsers no longer drop,
    // and the threat model's T12 row names its control and its pinning suites (every missing statement is reported together)
    const runnerPage = read("artifacts/ai-control-plane-b22/diagnostic-runner.md");
    const revisionRow = read("artifacts/ai-control-plane-b22/runtime-profiles.md").split(NEWLINE).find((line) => line.startsWith("| `revision` |"))!;
    const t12 = read("artifacts/ai-control-plane-b22/threat-model.md").split(NEWLINE).find((line) => line.startsWith("| T12 |"))!;
    const statements: Array<[string, string, RegExp]> = [
      ["diagnostic-runner.md: the profile it executes", runnerPage, /`ngspice-local-diagnostic` \(revision 2; \[B22-C review, 2026-10-02\] revision 3 since B22-C/],
      ["diagnostic-runner.md: the bundle's RECORDED loss", runnerPage, /the non-finite values the parser drops\s+\(D22-10\) \[B22-C review, 2026-10-02\] \(the parsers no longer drop them/],
      ["runtime-profiles.md: the revision row", revisionRow, /\[B22-C review, 2026-10-02\] `ngspice-local-diagnostic` is 3 and `ngspice-oci` 2/],
      ["threat-model.md: T12's note", t12, /\[B22-C review, 2026-10-02\]/],
      ["threat-model.md: T12's job-store suite", t12, /`b22-c-job-store-terminal`/],
      ["threat-model.md: T12's validator suite", t12, /`b22-c-output-validator`/],
    ];
    expect(statements.filter(([, text, pattern]) => !pattern.test(text)).map(([label]) => label)).toEqual([]);
  });

  it("10. [B22-C review] tests-7: the route passes its own bounds to the validator, and a header that is missing, inconsistent or binary is refused whole by both parsers", async () => {
    // [B22-C review] tests-7: the route passes its own bounds (2,000,000 points, below the validator's default 5,000,000): a header
    // declaring 3,000,000 points is over the route's bound, while the worker's defaults read it as a short file
    expect(await bothParsers(transient(["1", "2", "3"], 3_000_000))).toEqual({ worker: "OUTPUT_SHORT", route: { status: 500, code: "OUTPUT_OVER_LIMIT" } });
    // [B22-C review] tests-7: a header that is missing, inconsistent or binary is refused whole by both, never read
    const header = (lines: string[]) => [...lines, ""].join(NEWLINE);
    const invalidHeaders: Array<[string, string]> = [
      ["a variable count that disagrees", header(["Plotname: Transient Analysis", "Flags: real", "No. Variables: 3", "No. Points: 1", "Variables:", " 0 time time", " 1 v(out) voltage", "Values:", "0 0 1"])],
      ["a binary file", header(["Plotname: Transient Analysis", "Flags: real", "No. Variables: 2", "No. Points: 1", "Variables:", " 0 time time", " 1 v(out) voltage", "Binary:"])],
      ["unknown flags", header(["Plotname: Transient Analysis", "Flags: weird", "No. Variables: 2", "No. Points: 1", "Variables:", " 0 time time", " 1 v(out) voltage", "Values:", "0 0 1"])],
      ["a time axis with no signal", header(["Plotname: Transient Analysis", "Flags: real", "No. Variables: 1", "No. Points: 1", "Variables:", " 0 time time", "Values:", "0 0"])],
      ["out-of-order variable indexes", header(["Plotname: Transient Analysis", "Flags: real", "No. Variables: 2", "No. Points: 1", "Variables:", " 1 v(out) voltage", " 0 time time", "Values:", "0 0 1"])],
      ["no Values section", header(["Plotname: Transient Analysis", "Flags: real", "No. Variables: 2", "No. Points: 1", "Variables:", " 0 time time", " 1 v(out) voltage"])],
      ["no variable count", header(["Plotname: Transient Analysis", "Flags: real", "No. Points: 1", "Variables:", " 0 time time", " 1 v(out) voltage", "Values:", "0 0 1"])],
    ];
    const misses: string[] = [];
    for (const [label, text] of invalidHeaders) {
      const result = await bothParsers(text);
      if (result.worker !== "OUTPUT_HEADER_INVALID" || result.route.status !== 500 || result.route.code !== "OUTPUT_HEADER_INVALID") misses.push(`${label}: ${JSON.stringify(result)}`);
    }
    expect(misses).toEqual([]);
  });
});
