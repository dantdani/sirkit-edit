/**
 * [B22-A1] D22-4 (what SEC-1 left) - the SPICE model screen screens exactly the text the deck emits, refuses a file read
 * outside the run directory, and judges include dependencies by that text, never by the client's `dependencies`.
 *
 * Test-first: every refusal below was run RED on the unmodified tree 0432fb8 (the counterexamples): the model screen read
 * `transformedContent ?? originalContent` while the deck emits `transformedContent?.trim() || originalContent.trim()`
 * (models.ts:196 against netlist.ts:48-50), it refused only an absolute or UNC `.include`/`.inc` (models.ts:203), it had no
 * `.lib` or XSPICE file-parameter rule, and it trusted `model.dependencies` (models.ts:207-209). Legitimate vendor model text
 * (SEC-1's command-word element cards, `.subckt`/`.model`/`.param`/`.func`, a relative XSPICE data file name) passes before
 * and after, in compile, the preview, the smoke test and the runs route.
 *
 * [B22-A1 review] Red on the first fix, then green: a blank transformedContent hiding a refused original and a text include are
 * CLOSED refusals, so the runs route answers them 422 before any job, as SEC-1 did (regressions-1, coverage-3); both screens
 * read XSPICE over the cards as ngspice joins them - a `+` line opening with a form feed or a control character, a `#` comment
 * or a `;` comment inside a card, a parameter with no `=` - (tests-1), refuse every code model of the installed ngspice-46 that
 * starts a program or loads a library (d_process, d_cosim) and xfer's Touchstone file (coverage-1), and model text that opens
 * with a `+` line, which the deck would join to the previous model's card (coverage-2).
 *
 * ngspice is NOT executed: `node:child_process` and `node:fs/promises` are in-process fakes (the b19-d / SEC-1 pattern), so
 * no deck reaches the disk and no process starts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnState = vi.hoisted(() => ({ calls: [] as Array<{ args: readonly string[] }> }));
vi.mock("node:child_process", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (_command: string, args: readonly string[]) => {
      spawnState.calls.push({ args: [...args] });
      const child = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>; kill: () => void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  };
});
const fsState = vi.hoisted(() => ({ writes: [] as Array<{ path: string; content: string }> }));
vi.mock("node:fs/promises", async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  writeFile: async (path: string, content: string) => { fsState.writes.push({ path: String(path), content: String(content) }); },
  readFile: async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
  mkdir: async () => undefined,
  mkdtemp: async (prefix: string) => `${prefix}fake`,
  rm: async () => {},
}));
/** The model screen can be switched off for the defence-in-depth cases: the final deck screen's own refusals stay pinned
 *  behind it (SEC-1's tests-1 breakage, `executed: false` in the smoke test's `screenedSmokeDeck` - smoke-test/route.ts:102 since
 *  B22-A3, was :119 - is still caught here). */
const screenSwitch = vi.hoisted(() => ({ off: false }));
vi.mock("@/app/lib/spice/models", async (orig) => {
  const actual = await orig() as typeof import("@/app/lib/spice/models");
  return {
    ...actual,
    assertModelSafeForExecution: (model: Parameters<typeof actual.assertModelSafeForExecution>[0]) => {
      if (!screenSwitch.off) actual.assertModelSafeForExecution(model);
    },
  };
});

import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as smokePost } from "@/app/api/spice/models/smoke-test/route";
import { POST as runsPost } from "@/app/api/spice/runs/route";
import { compileCanonicalIr } from "@/app/lib/spice/ir";
import { assertModelSafeForExecution, importModelText } from "@/app/lib/spice/models";
import { compileNgspiceNetlist } from "@/app/lib/spice/netlist";
import { createSimulationProject } from "@/app/lib/spice/project";
import { estimateRunPlan } from "@/app/lib/spice/run-plan";
import { __resetJobStoreForTests, getRun, getRuns } from "@/app/lib/spice/server/job-store";
import type { ModelAsset, NetlistBundle, RunRecord, SimulationPartSnapshot, SimulationProject } from "@/app/lib/spice/types";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";
import { pinFakeNgspiceForSuite } from "./_pinned-ngspice";

// [B22-A3] reviewed pin move: ngspice runs only through the diagnostic runner, which refuses an unpinned install (OD-135)
pinFakeNgspiceForSuite();

const C = (...codes: number[]): string => String.fromCharCode(...codes);
const NL = C(10);
const TAB = C(9);
const BS = C(92);
const FF = C(12);
const SOH = C(1);
const MARK = "b22a1-marker";
const NOW = "2026-10-01T00:00:00.000Z";

const PART: SimulationPartSnapshot = {
  id: "part-amp",
  name: "AMP",
  mpn: null,
  manufacturer: null,
  pins: [
    { number: "1", name: "IN", type: "input", position: { x: 0, y: 0 }, orientation: 0, length: 2.54 },
    { number: "2", name: "OUT", type: "output", position: { x: 10.16, y: 0 }, orientation: 180, length: 2.54 },
  ],
};
const SUBCKT = [".subckt AMP 1 2", "R1 1 2 1k", ".ends AMP"].join(NL);
const HOSTILE = [".subckt AMP 1 2", "R1 1 2 1k", ".ends AMP", ".control", `shell ${MARK}`, ".endc"].join(NL);

function baseProject(): SimulationProject {
  const schematic = dividerSchematic();
  schematic.kicadComponents = [{ id: "U1", partId: PART.id, x: 600, y: 600, rotation: 0, refDes: "U1", value: "AMP" }];
  const project = createSimulationProject(schematic, { now: NOW });
  const model = importModelText("amp.lib", `${SUBCKT}${NL}`).candidate;
  model.id = "model-amp";
  project.modelAssets.push(model);
  project.modelBindings.push({ id: "binding-u1", componentId: "U1", modelId: model.id, pinMap: { "1": "1", "2": "2" }, parameterOverrides: {}, confidence: 1, assignedBy: "user", reviewed: true, createdAt: NOW });
  const test = project.tests[0]!;
  test.analyses = [{ id: "an-tran", name: "Startup transient", type: "tran", outputStep: "10u", stopTime: "1m", enabled: true }];
  test.outputs = [{ id: "out-vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
  return project;
}
const model0 = (project: SimulationProject): ModelAsset => project.modelAssets.find((model) => model.id === "model-amp")!;
const smokeModel = (text: string): ModelAsset => {
  const model = importModelText("amp.lib", `${SUBCKT}${NL}`).candidate;
  model.originalContent = text;
  return model;
};
const withText = (text: string, transformed?: string): ModelAsset => {
  const model = smokeModel(text);
  if (transformed !== undefined) model.transformedContent = transformed;
  return model;
};

/** The deck the worker compiles (its options: the server-owned raw output path) - the model screen is NOT run here. */
function compileWith(project: SimulationProject): NetlistBundle {
  const point = estimateRunPlan(project, project.runPlans[0]!.id).runPoints[0]!;
  const compiled = compileCanonicalIr({ project, testId: point.testId, parts: [PART] });
  return compileNgspiceNetlist(compiled.ir, { analysisId: point.analysisId, runPoint: point, rawOutputPath: "result.raw", pinNodes: compiled.pointNodes });
}
/** The compile preview (`/api/spice/compile`): no control block, never executed by the server. */
function previewOf(project: SimulationProject): string {
  const compiled = compileCanonicalIr({ project, testId: project.tests[0]!.id, parts: [PART] });
  return compileNgspiceNetlist(compiled.ir, { pinNodes: compiled.pointNodes }).executed;
}

function printable(text: string): string {
  let out = "";
  for (let index = 0; index < text.length && out.length < 90; index += 1) {
    const code = text.charCodeAt(index);
    out += code >= 0x20 && code < 0x7f ? text[index] : "?";
  }
  return out;
}
/** "admitted", "refused (closed)" (the SPICE_DECK_UNSAFE code and none of the refused text) or "refused: <message>". */
function screenOutcome(run: () => unknown): string {
  try {
    run();
    return "admitted";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^SPICE_DECK_UNSAFE: /.test(message) && !message.includes(MARK)) return "refused (closed)";
    return `refused: ${printable(message)}`;
  }
}
const refused = (outcome: string): boolean => outcome.startsWith("refused");

const SCOPE = { tenantId: "local", projectId: "proj-b22a1", branchId: "main" };
const SELECTOR = { "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId };
function post(path: string, body: unknown): Request {
  injectAuthorizedPrincipal({ userId: "u-b22a1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SELECTOR }, body: JSON.stringify(body) });
}
async function settled(runId: string): Promise<RunRecord | null> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const run = getRun(runId, SCOPE);
    if (!run || ["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return getRun(runId, SCOPE);
}
const closed = (text: unknown): boolean => typeof text === "string" && /^SPICE_DECK_UNSAFE: /.test(text) && !text.includes(MARK);
const ngspiceRuns = (): number => spawnState.calls.filter((call) => call.args[0] === "-b").length;
async function routeOutcome(project: SimulationProject) {
  const res = await runsPost(post("/api/spice/runs", { project, runPlanId: project.runPlans[0]!.id, parts: [PART] }));
  const body = await res.json() as { error?: string; batch?: { runIds: string[] } };
  const runs = await Promise.all((body.batch?.runIds ?? []).map(settled));
  return {
    status: res.status,
    closedError: closed(body.error),
    jobs: getRuns(SCOPE).length,
    runs: runs.map((run) => run?.status),
    decksWritten: fsState.writes.filter((write) => write.path.endsWith("deck.cir")).length, // [B22-A3] reviewed pin move: the runner writes deck.cir (was the worker's executed.cir)
    ngspiceRuns: ngspiceRuns(),
  };
}
async function smokeOutcome(model: ModelAsset) {
  const res = await smokePost(post("/api/spice/models/smoke-test", { model }));
  const body = await res.json() as { error?: string };
  return { status: res.status, closedError: closed(body.error), filesWritten: fsState.writes.length, ngspiceRuns: ngspiceRuns() };
}
const REFUSED_RUN = { status: 422, closedError: true, jobs: 0, runs: [], decksWritten: 0, ngspiceRuns: 0 };
const REFUSED_SMOKE = { status: 422, closedError: true, filesWritten: 0, ngspiceRuns: 0 };

afterEach(() => {
  spawnState.calls = [];
  fsState.writes = [];
  screenSwitch.off = false;
  __resetJobStoreForTests();
  resetInjectedIdentity();
  vi.unstubAllEnvs();
});

// ─── 1. the screen reads the text the deck emits ───────────────────────────────────────────────────────────────────────

describe("[B22-A1] the model screen reads exactly the text the deck emits (D22-4: the ??/|| differential)", () => {
  // [B22-A1 review] regressions-1: a blank transformedContent hiding a refused original is a CLOSED refusal (the runs preflight
  // answers it 422 before any job, as SEC-1's final screen did); no transformedContent keeps the screen's own message (202, the
  // worker's failure, as SEC-1 designed)
  it.each<[string, string | undefined, RegExp]>([
    ["an empty transformedContent", "", /^refused \(closed\)$/],
    ["a whitespace-only transformedContent", `  ${NL}${TAB} `, /^refused \(closed\)$/],
    ["no transformedContent", undefined, /^refused: .*contains forbidden \.control blocks$/],
  ])("%s over a hostile originalContent is refused (the deck would emit the original)", (_label, transformed, expected) => {
    const model = withText(HOSTILE, transformed);
    expect(screenOutcome(() => assertModelSafeForExecution(model))).toMatch(expected);
  });

  it("a benign transformedContent over a hostile originalContent is admitted, and the deck emits only the benign text", () => {
    const project = baseProject();
    model0(project).originalContent = HOSTILE;
    model0(project).transformedContent = SUBCKT;
    expect(screenOutcome(() => assertModelSafeForExecution(model0(project)))).toBe("admitted");
    const deck = compileWith(project).executed;
    expect(deck).toContain("R1 1 2 1k");
    expect(deck).not.toContain(MARK);
  });

  it("one helper gives the emitted model text: the run deck and the smoke deck carry it, and the screen reads it", async () => {
    const netlist = await import("@/app/lib/spice/netlist") as Record<string, unknown>;
    expect(typeof netlist.emittedModelText, "netlist.ts exports emittedModelText").toBe("function");
    const emitted = netlist.emittedModelText as (model: { transformedContent?: string; originalContent: string }) => string;
    expect(emitted({ originalContent: `${NL}${SUBCKT}${NL}`, transformedContent: "" })).toBe(SUBCKT);
    expect(emitted({ originalContent: HOSTILE, transformedContent: ` ${SUBCKT} ` })).toBe(SUBCKT);
    expect(emitted({ originalContent: ` ${SUBCKT}${NL}` })).toBe(SUBCKT);
    const project = baseProject();
    model0(project).originalContent = `${SUBCKT}${NL}`;
    model0(project).transformedContent = "   ";
    expect(compileWith(project).executed).toContain(emitted(model0(project)));
    const outcome = await smokeOutcome(withText(`${SUBCKT}${NL}`, "   "));
    expect(outcome.status, "the smoke deck emits the same text (it used ??, so a blank transformedContent emitted no model)").toBe(200);
    expect(fsState.writes.find((write) => write.path.endsWith("deck.cir"))?.content).toContain(SUBCKT); // [B22-A3] reviewed pin move: the runner writes deck.cir (was smoke.cir)
  });
});

// ─── 2. file reads outside the run directory ───────────────────────────────────────────────────────────────────────────

/** Each line goes into model text after the subcircuit. "closed" marks the B22-A1 refusals (the SPICE_DECK_UNSAFE code);
 *  "refused" marks the forms the screen already refused at 0432fb8 (absolute, UNC; its own message, kept). */
const FILE_READS: ReadonlyArray<readonly [string, string, "closed" | "refused"]> = [
  ["a .lib read with an absolute path", `.lib /${MARK}.lib tt`, "closed"],
  ["a .lib read with a UNC path", `.lib ${BS}${BS}srv${BS}share${BS}${MARK}.lib tt`, "closed"],
  ["a .lib read with a relative path", `.lib models/${MARK}.lib tt`, "closed"],
  ["an upper-case, indented .LIB read", `  .LIB ${MARK}.lib`, "closed"],
  ["a one-token .lib line (fail-closed: whether ngspice-46 reads its token as a file is UNKNOWN)", ".lib TT", "closed"],
  ["an .include with a root-relative path (a single backslash)", `.include ${BS}${MARK}.lib`, "closed"],
  ["an .include with a root-relative path (a single slash)", `.include /${MARK}.lib`, "refused"],
  ["an .inc with a drive-relative path", `.inc C:${MARK}.lib`, "closed"],
  ["an .include with a drive-absolute path", `.include "C:${BS}${MARK}.lib"`, "refused"],
  ["an .include with a UNC path", `.include ${BS}${BS}srv${BS}${MARK}.lib`, "refused"],
  ["an .include traversing with slashes", `.include ../../${MARK}.lib`, "closed"],
  ["an .include traversing with backslashes", `.include ..${BS}..${BS}${MARK}.lib`, "closed"],
  ["an .include traversing mid-path", `.include models/../../${MARK}.lib`, "closed"],
  ["a double-quoted traversing .include", `.include "../${MARK}.lib"`, "closed"],
  ["a single-quoted traversing upper-case .INC", `.INC '../${MARK}.lib'`, "closed"],
  ["a prefix-spelled .incl (ngspice reads any '.inc' line as an include)", `.incl ../${MARK}.lib`, "closed"],
  ["an .include of a home path", `.include ~/${MARK}.lib`, "closed"],
  ["an XSPICE filesource file= with an absolute path, quoted", `.model fsrc filesource (file="/${MARK}.txt" amploffset=[0] amplscale=[1])`, "closed"],
  ["an XSPICE file= with an absolute path, unquoted", `.model fsrc filesource (file=/${MARK}.txt)`, "closed"],
  ["an upper-case XSPICE FILE= with a drive path, single-quoted", `.model fsrc filesource (FILE='C:${BS}${MARK}.txt')`, "closed"],
  ["an XSPICE d_source input_file= traversing", `.model din d_source (input_file="..${BS}${MARK}.txt")`, "closed"],
  ["an XSPICE d_state state_file= with a UNC path", `.model st d_state (state_file=${BS}${BS}srv${BS}${MARK})`, "closed"],
  ["an XSPICE table2d file= on a continuation line, split around the equals sign", [".model tbl table2d (offset=0.0 gain=1.0 order=3", "+ file", `+ = "../${MARK}.tbl")`].join(NL), "closed"],
  ["an XSPICE file= naming a Windows device", '.model fsrc filesource (file="CON")', "closed"],
  ["an XSPICE file= built from a parameter", ".model fsrc filesource (file={fname})", "closed"],
  // [B22-A1 self-review] ngspice drops a comment line before it joins a `+` line to its card; joining first puts the `+` line on
  // the comment, which the comment skip then hides (red with the comment skip and the `+` lines joined first; the page, section 1)
  ["an XSPICE file= on a continuation line after a comment line inside the card", [".model fsrc filesource (amploffset=[0] amplscale=[1]", "* an innocuous comment", `+ file="/${MARK}.txt")`].join(NL), "closed"],
  // [B22-A1 review] tests-1: ngspice skips every character up to a space before a `+` and joins the line to its card, skips a
  // `#`/`$` comment line between, strips an end-of-line `;` comment, and XSPICE separates a parameter from its value by
  // whitespace as well as `=` (INFERRED from ngspice's inpcom.c and MIFgettok; red on the first fix)
  ["an XSPICE table2d file split over continuation lines, the second opening with a form feed", [".model tbl table2d (offset=0.0 gain=1.0 order=3", "+ file", `${FF}+ = "../${MARK}.tbl")`].join(NL), "closed"],
  ["an XSPICE table2d file split over continuation lines, the second opening with a control character", [".model tbl table2d (offset=0.0 gain=1.0 order=3", "+ file", `${SOH}+ = "../${MARK}.tbl")`].join(NL), "closed"],
  ["an XSPICE file parameter with no equals sign", `.model fsrc filesource (file "/${MARK}.txt")`, "closed"],
  ["an XSPICE file parameter split as `+ file =` and a form-feed `+` line carrying its value", [".model tbl table2d (offset=0.0 gain=1.0 order=3", "+ file =", `${FF}+ "/${MARK}.tbl")`].join(NL), "closed"],
  ["an XSPICE file parameter continued across a `#` comment line", [".model fsrc filesource (amploffset=[0] amplscale=[1] file", "# a hash comment", `+ = "/${MARK}.txt")`].join(NL), "closed"],
  ["an XSPICE file parameter whose value follows an end-of-line `;` comment", [".model fsrc filesource (amploffset=[0] amplscale=[1] file ; the value follows", `+ = "/${MARK}.txt")`].join(NL), "closed"],
  // [B22-A1 lead] the check's new issue: ngspice also skips a non-ASCII character before a `+` and joins the line to its card -
  // CONFIRMED by the lead's probes p14 (an e-acute) and p15 (a no-break space): `R1 1 0` then `<char>+ 1k` simulated as 1k
  ["[B22-A1 lead] an XSPICE input_file on a `+` line opened by a non-ASCII letter (probe p14)", [".model src d_source (", `${String.fromCharCode(0xe9)}+ input_file "/${MARK}.txt")`].join(NL), "closed"],
  ["[B22-A1 lead] an XSPICE input_file on a `+` line opened by a no-break space (probe p15)", [".model src d_source (", `${String.fromCharCode(0xa0)}+ input_file "/${MARK}.txt")`].join(NL), "closed"],
  // [B22-A1 review] coverage-1: every code model of the installed ngspice-46 whose parameter names a file, a program or a shared
  // library (its lib/ngspice/*.cm parameter tables, read as strings, never run): xfer's Touchstone `file` (analog.cm); d_process
  // spawns `process_file` and d_cosim loads the library `simulation` (digital.cm) - both refused whatever they name
  ["an XSPICE xfer Touchstone file with an absolute path", `.model xf xfer (file="/${MARK}.s2p")`, "closed"],
  ["an XSPICE d_process card (it spawns process_file)", `.model proc d_process (process_file="cmd.exe" process_params=["/c", "${MARK}"])`, "closed"],
  ["an upper-case D_PROCESS card naming a plain relative program", ".MODEL PROC D_PROCESS (PROCESS_FILE=helper)", "closed"],
  ["a d_process kind on a continuation line", [".model proc", "+ d_process (process_file=helper)"].join(NL), "closed"],
  ["an XSPICE d_cosim card (it loads the shared library simulation)", `.model cos d_cosim (simulation="ivlng" sim_args=["${MARK}.vvp"])`, "closed"],
  ["a d_cosim card naming its library by a host path", `.model cos d_cosim simulation="/${MARK}.dll"`, "closed"],
];

describe("[B22-A1] the model screen refuses a file read outside the run directory (D22-4)", () => {
  it.each(FILE_READS)("%s is refused", (_label, line, kind) => {
    const outcome = screenOutcome(() => assertModelSafeForExecution(withText([SUBCKT, line].join(NL))));
    if (kind === "closed") expect(outcome, outcome).toBe("refused (closed)");
    else expect(refused(outcome), outcome).toBe(true);
  });

  it("include dependencies are recomputed from the screened text: a client `dependencies: []` with an include in the text is refused, closed (SEC-1's final screen refused it closed)", () => {
    const model = withText([SUBCKT, ".include amp-extra.lib"].join(NL));
    model.dependencies = [];
    expect(screenOutcome(() => assertModelSafeForExecution(model))).toBe("refused (closed)");
    expect(() => assertModelSafeForExecution(model)).toThrow(/^SPICE_DECK_UNSAFE: .*1 unresolved include dependency/);
  });

  it("include dependencies are never taken from the client: a recorded dependency the text does not include is not trusted", () => {
    const model = withText(SUBCKT);
    model.dependencies = ["amp-extra.lib"];
    expect(screenOutcome(() => assertModelSafeForExecution(model))).toBe("admitted");
  });
});

// ─── 3. legitimate vendor model text ───────────────────────────────────────────────────────────────────────────────────

/** SEC-1's vendor element cards named like command words (the lead's probes p8a/p8b), `.subckt`/`.model`/`.param`/`.func`
 *  text, and relative XSPICE data file names (they resolve inside the run's fresh directory). */
const LEGITIMATE: ReadonlyArray<readonly [string, string]> = [
  ["SEC-1's vendor cards (Cd, Load, Define, Set, Source)", [".subckt AMP 1 2", ".model DVEND D", ".model SVEND SW", "R1 1 2 1k", "Cd 1 2 1p", "Load 1 2 10u", "Define 1 2 DVEND", "Set 1 2 1 2 SVEND", "Source 1 2 1 2 SVEND", ".ends AMP"].join(NL)],
  ["a .subckt with .param, .func and .model text", [".subckt AMP 1 2", ".param RV=1k", ".func dbl(x) {2*x}", ".model DX D(IS=1e-14 N=1.05)", "R1 1 2 {dbl(RV)}", "D1 2 0 DX", ".ends AMP"].join(NL)],
  ["relative XSPICE data file names", [".subckt AMP 1 2", "R1 1 2 1k", '.model fsrc filesource (file="pwl-data.txt" amploffset=[0] amplscale=[1])', ".model din d_source (input_file=source.txt)", '.model st d_state (state_file="models/state.in")', ".ends AMP"].join(NL)],
  // [B22-A1 self-review] a vendor header comment that mentions a file names no parameter (red against the first fix, which had no
  // comment skip: it refused this legitimate text)
  ["a vendor header comment naming its source file", [`* Netlist file = C:${BS}models${BS}amp.lib`, "* generated by the vendor's model editor", ".subckt AMP 1 2", "R1 1 2 1k", ".ends AMP"].join(NL)],
  // [B22-A1 review] a relative data file named on a `+` continuation line, and an xfer Touchstone file (green before and after)
  ["a relative XSPICE data file on a continuation line, and a relative xfer Touchstone file", [".subckt AMP 1 2", "R1 1 2 1k", ".model fsrc filesource (amploffset=[0] amplscale=[1]", '+ file="pwl-data.txt")', '.model xf xfer (file="filter.s2p")', ".ends AMP"].join(NL)],
];

describe("[B22-A1] legitimate vendor model text still passes: the screen, compile, the preview, the smoke test and the runs route", () => {
  it.each(LEGITIMATE)("%s", async (_label, text) => {
    expect(screenOutcome(() => assertModelSafeForExecution(withText(text)))).toBe("admitted");
    const project = baseProject();
    model0(project).originalContent = text;
    const deck = compileWith(project).executed;
    for (const line of text.split(NL)) expect(deck, line).toContain(line);
    expect(() => previewOf(project)).not.toThrow();
    expect(await smokeOutcome(withText(text)), "the smoke test").toMatchObject({ status: 200, ngspiceRuns: 1 });
    spawnState.calls = [];
    fsState.writes = [];
    expect(await routeOutcome(project), "the runs route").toMatchObject({ status: 202, jobs: 1, decksWritten: 1, ngspiceRuns: 1 });
  });
});

// ─── 4. through the routes, with ngspice faked ─────────────────────────────────────────────────────────────────────────

describe("[B22-A1] through the routes: a file read outside the run directory never reaches spawn", () => {
  const XSPICE = `.model fsrc filesource (file="/${MARK}.txt" amploffset=[0] amplscale=[1])`;

  it("the smoke test refuses model text with an XSPICE file parameter naming a host path: 422 (closed), no file, no process", async () => {
    expect(await smokeOutcome(withText([SUBCKT, XSPICE].join(NL)))).toEqual(REFUSED_SMOKE);
  });

  it("the smoke test refuses a root-relative .include (single backslash) and a .lib read: 422 (closed), no file, no process", async () => {
    for (const line of [`.include ${BS}${MARK}.lib`, `.lib /${MARK}.lib tt`]) {
      expect(await smokeOutcome(withText([SUBCKT, line].join(NL))), line).toEqual(REFUSED_SMOKE);
    }
  });

  it("POST /api/spice/runs refuses model text with an XSPICE file parameter naming a host path: 422 (closed), no job, no deck, no process", async () => {
    const project = baseProject();
    model0(project).originalContent = [SUBCKT, XSPICE].join(NL);
    expect(await routeOutcome(project)).toEqual(REFUSED_RUN);
  });

  it("POST /api/spice/runs refuses an advanced directive carrying an XSPICE model card that reads a host file: 422 (closed), no job, no deck, no process", async () => {
    const project = baseProject();
    project.tests[0]!.analyses[0]!.advancedDirectives = [XSPICE];
    expect(await routeOutcome(project)).toEqual(REFUSED_RUN);
  });

  it("POST /api/spice/runs refuses model text with a .lib read before any job: 422 (closed), no deck, no process", async () => {
    const project = baseProject();
    model0(project).originalContent = [SUBCKT, `.lib /${MARK}.lib tt`].join(NL);
    expect(await routeOutcome(project)).toEqual(REFUSED_RUN);
  });

  // [B22-A1 review] regressions-1, coverage-3: what SEC-1 answered 422 before any job (its final deck screen refused the
  // emitted text) is still answered 422 before any job now that the model screen refuses it first - closed, so the preflight
  // raises it (red on the first fix: 202, a job created, the run failed by the worker with a non-closed message)
  const sourceValueLf = (p: SimulationProject) => { p.designRevisions[0]!.schematic.components[0]!.value = ["5", ".control", `shell ${MARK}`, ".endc"].join(NL); };
  it.each<[string, (p: SimulationProject) => void]>([
    ["an empty transformedContent over a hostile originalContent", (p) => { model0(p).originalContent = HOSTILE; model0(p).transformedContent = ""; }],
    ["a whitespace transformedContent over a hostile originalContent", (p) => { model0(p).originalContent = HOSTILE; model0(p).transformedContent = ` ${NL}${TAB}`; }],
    ["a plain relative .include in the model text (a client `dependencies: []`)", (p) => { model0(p).originalContent = [SUBCKT, ".include amp-extra.lib"].join(NL); model0(p).dependencies = []; }],
    ["a plain relative .include in the model text, on a plan whose source value carries LF", (p) => { model0(p).originalContent = [SUBCKT, ".include amp-extra.lib"].join(NL); model0(p).dependencies = []; sourceValueLf(p); }],
  ])("POST /api/spice/runs with %s: 422 (closed), no job, no deck, no process - as SEC-1 answered it", async (_label, mutate) => {
    const project = baseProject();
    mutate(project);
    expect(await routeOutcome(project)).toEqual(REFUSED_RUN);
  });

  it("POST /api/spice/runs with a model the screen refuses with its own message, on a plan whose source value carries LF: 202, the worker fails the run before any deck (SEC-1's design, kept)", async () => {
    const project = baseProject();
    model0(project).originalContent = HOSTILE;
    sourceValueLf(project);
    expect(await routeOutcome(project)).toEqual({ status: 202, closedError: false, jobs: 1, runs: ["failed"], decksWritten: 0, ngspiceRuns: 0 });
    expect(getRuns(SCOPE)[0]?.error).toMatch(/contains forbidden \.control blocks/);
  });

  it.each<[string, () => ModelAsset]>([
    ["an empty transformedContent over a hostile originalContent", () => withText(HOSTILE, "")],
    ["a plain relative .include", () => withText([SUBCKT, ".include amp-extra.lib"].join(NL))],
    ["an XSPICE d_process card", () => withText([SUBCKT, `.model proc d_process (process_file="${MARK}")`].join(NL))],
  ])("the smoke test refuses model text with %s: 422 (closed), no file, no process", async (_label, model) => {
    expect(await smokeOutcome(model())).toEqual(REFUSED_SMOKE);
  });

  it.each<[string, (p: SimulationProject) => void]>([
    ["model text carrying an XSPICE d_process card", (p) => { model0(p).originalContent = [SUBCKT, `.model proc d_process (process_file="${MARK}")`].join(NL); }],
    ["model text carrying an XSPICE d_cosim card", (p) => { model0(p).originalContent = [SUBCKT, `.model cos d_cosim (simulation="${MARK}")`].join(NL); }],
    ["an advanced directive carrying an XSPICE d_process card", (p) => { p.tests[0]!.analyses[0]!.advancedDirectives = [`.model proc d_process (process_file="${MARK}")`]; }],
    ["an advanced directive carrying an XSPICE file parameter with no equals sign", (p) => { p.tests[0]!.analyses[0]!.advancedDirectives = [`.model fsrc filesource (file "/${MARK}.txt")`]; }],
  ])("POST /api/spice/runs refuses %s (coverage-1, tests-1): 422 (closed), no job, no deck, no process", async (_label, mutate) => {
    const project = baseProject();
    mutate(project);
    expect(await routeOutcome(project)).toEqual(REFUSED_RUN);
  });

  it("the compile preview (never executed by the server) keeps a relative XSPICE data file name and a file directive for the user's own machine", () => {
    const project = baseProject();
    model0(project).originalContent = [SUBCKT, '.model fsrc filesource (file="pwl-data.txt")', ".include models/amp-extra.lib"].join(NL);
    const preview = previewOf(project);
    expect(preview).toContain('file="pwl-data.txt"');
    expect(preview).toContain(".include models/amp-extra.lib");
  });
});

// ─── 5. defence in depth behind the model screen ───────────────────────────────────────────────────────────────────────

describe("[B22-A1] defence in depth: with the model screen switched off, the final deck screen still holds", () => {
  it.each([
    ["a relative traversing .include", `.include ../../${MARK}.lib`],
    ["a .lib read", `.lib /${MARK}.lib tt`],
  ])("the smoke test refuses model text with %s: 422 (closed), no file, no process (SEC-1's tests-1 pin, moved behind the model screen)", async (_label, line) => {
    screenSwitch.off = true;
    expect(await smokeOutcome(withText([SUBCKT, line].join(NL)))).toEqual(REFUSED_SMOKE);
  });

  it("the final screen refuses an executed deck whose model text carries an XSPICE file parameter naming a host path; a relative one passes", () => {
    const project = baseProject();
    model0(project).originalContent = [SUBCKT, `.model fsrc filesource (file="/${MARK}.txt")`].join(NL);
    expect(screenOutcome(() => compileWith(project))).toBe("refused (closed)");
    model0(project).originalContent = [SUBCKT, '.model fsrc filesource (file="pwl-data.txt")'].join(NL);
    expect(screenOutcome(() => compileWith(project))).toBe("admitted");
  });

  // [B22-A1 review] tests-1, coverage-1: the final screen reads the executed deck's cards as ngspice joins them (red on the first
  // fix, which read one line at a time and knew three parameter names)
  it.each([
    ["a table2d file split over continuation lines, the second opening with a form feed", [".model tbl table2d (offset=0.0 gain=1.0 order=3", "+ file", `${FF}+ = "/${MARK}.tbl")`].join(NL)],
    ["a filesource file with no equals sign", `.model fsrc filesource (file "/${MARK}.txt")`],
    ["a d_process card (it spawns process_file)", `.model proc d_process (process_file="${MARK}")`],
    ["a d_cosim card (it loads the shared library simulation)", `.model cos d_cosim (simulation="${MARK}")`],
    ["[B22-A1 lead] an input_file on a `+` line opened by a non-ASCII letter (probe p14)", [".model src d_source (", `${String.fromCharCode(0xe9)}+ input_file "/${MARK}.txt")`].join(NL)],
  ])("the final screen alone refuses an executed deck whose model text carries %s", (_label, line) => {
    const project = baseProject();
    model0(project).originalContent = [SUBCKT, line].join(NL);
    expect(screenOutcome(() => compileWith(project))).toBe("refused (closed)");
  });
});

// ─── 6. model text is joined to the card before it (coverage-2) ────────────────────────────────────────────────────────

/** Two subcircuit models, each bound to its own part: the deck emits model A's lines, then model B's, with nothing between. */
function twoModelProject(textA: string, textB: string): SimulationProject {
  const schematic = dividerSchematic();
  schematic.kicadComponents = [
    { id: "U1", partId: PART.id, x: 600, y: 600, rotation: 0, refDes: "U1", value: "AMP" },
    { id: "U2", partId: PART.id, x: 800, y: 600, rotation: 0, refDes: "U2", value: "AMP" },
  ];
  const project = createSimulationProject(schematic, { now: NOW });
  for (const [id, componentId, text] of [["model-amp", "U1", textA], ["model-amp-b", "U2", textB]] as const) {
    const model = importModelText(`${id}.lib`, `${SUBCKT}${NL}`).candidate;
    model.id = id;
    model.originalContent = text;
    project.modelAssets.push(model);
    project.modelBindings.push({ id: `binding-${componentId}`, componentId, modelId: id, pinMap: { "1": "1", "2": "2" }, parameterOverrides: {}, confidence: 1, assignedBy: "user", reviewed: true, createdAt: NOW });
  }
  const test = project.tests[0]!;
  test.analyses = [{ id: "an-tran", name: "Startup transient", type: "tran", outputStep: "10u", stopTime: "1m", enabled: true }];
  test.outputs = [{ id: "out-vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
  return project;
}

describe("[B22-A1 review] coverage-2: a model's `+` line would continue the card the model before it ended with", () => {
  const A = [SUBCKT, ".model fsrc filesource (amploffset=[0] amplscale=[1] file"].join(NL);
  const B = [`+ = "/${MARK}.txt")`, ".subckt AMPB 1 2", "R2 1 2 1k", ".ends AMPB"].join(NL);

  it("the model screen refuses model text that opens with a `+` continuation line (after comments too), and a file parameter left without its value", () => {
    expect(screenOutcome(() => assertModelSafeForExecution(withText(B)))).toBe("refused (closed)");
    expect(screenOutcome(() => assertModelSafeForExecution(withText(["* vendor header", "# hash comment", `${FF}${B}`].join(NL))))).toBe("refused (closed)");
    expect(screenOutcome(() => assertModelSafeForExecution(withText(A)))).toBe("refused (closed)");
  });

  it("the final screen alone refuses the executed deck that joins model B's `+` line to model A's card", () => {
    const deck = compileWith(twoModelProject([SUBCKT, "* the last line of model A"].join(NL), ["* the first line of model B", SUBCKT].join(NL))).executed;
    expect(deck, "the deck emits model B's first line right after model A's last").toContain(["* the last line of model A", "* the first line of model B"].join(NL));
    expect(screenOutcome(() => compileWith(twoModelProject(A, B)))).toBe("refused (closed)");
  });

  it("POST /api/spice/runs refuses the two models: 422 (closed), no job, no deck, no process", async () => {
    expect(await routeOutcome(twoModelProject(A, B))).toEqual(REFUSED_RUN);
  });
});
