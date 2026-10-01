/**
 * [SEC-1] The SPICE Studio deck injection (closes D22-3; the ngspice half of D22-5).
 *
 * The Studio compiler (`compileNgspiceNetlist`) wrote caller and model strings into the ngspice deck unscreened, and its line
 * writer split every pushed string on line breaks. A line break in a source value, a waveform, an `.ic` value, a `.param`
 * value, a custom `.options` entry (its screen admitted one through a whitespace class), a custom directive
 * (`assertSafeDirective` tested only the start of the whole text), an analysis field or an output expression (also written
 * INSIDE the compiler's own `.control` block, on the `write` line) therefore wrote a second, live `.control` block with
 * `shell` into the deck the worker writes and runs. `POST /api/spice/runs` takes the whole project from an authenticated
 * member's body, and the SPICE AI route pre-selects model-written overlays and variables. The smoke test and the worker's
 * `-v` probe spawned ngspice with the whole server environment.
 *
 * Reproduced at the DECK level (the compiler, with the worker's options) and through the routes with ngspice NOT executed:
 * `node:child_process` and `node:fs/promises` are in-process fakes (the b19-d pattern), so no deck reaches the disk and no
 * process starts. The fake spawn records environment KEY NAMES only, never a value.
 *
 * [SEC-1 review] The adversarial review's confirmed findings are pinned here too: a TAB is SPICE whitespace (admitted where
 * main admitted it; it never opens a line); a vendor `*#` banner and a form-feed page break in model text pass (a form feed
 * is read both as whitespace and as a line break); `ng_script` is refused only as a script title; the title line is never a
 * card; identity names are refused raw, never sanitized into a different deck; the run-plan preflight compiles one deck per
 * test and analysis; and each defence layer is pinned on its own.
 *
 * [SEC-1 round 3] The contract is the lead's ngspice-46 probe table: only a `.control` block (an included one too), a `*#`
 * line and an `*ng_script` title execute, so only those (and an `.include`/`.lib` in an executed deck) are refused; a command
 * word anywhere else is an element card and passes (round 1 refused the task's whole command-word list - moved, see below).
 * A non-banner `*#` TITLE is refused too, as defence in depth beyond the ground (the lead's p11-p13: a `*#` title runs nothing; a stated deviation).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnState = vi.hoisted(() => ({
  calls: [] as Array<{ args: readonly string[]; envKeys: string[] | null }>,
  all: [] as Array<{ args: readonly string[]; envKeys: string[] | null }>,
}));
vi.mock("node:child_process", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (_command: string, args: readonly string[], options?: { env?: Record<string, unknown> }) => {
      const call = { args: [...args], envKeys: options?.env ? Object.keys(options.env).sort() : null };
      spawnState.calls.push(call);
      spawnState.all.push(call);
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
/** Replaces the compiled `executed` deck AFTER the compiler ran (the worker's own final screen is then the only screen), and
 *  counts every compile (the run-plan preflight's are the ones made before `startRunPlan` returns). */
const deckOverride = vi.hoisted(() => ({ executed: null as string | null, compiles: 0 }));
vi.mock("@/app/lib/spice/netlist", async (orig) => {
  const actual = await orig() as typeof import("@/app/lib/spice/netlist");
  return {
    ...actual,
    compileNgspiceNetlist: (...args: Parameters<typeof actual.compileNgspiceNetlist>) => {
      deckOverride.compiles += 1;
      const bundle = actual.compileNgspiceNetlist(...args);
      return deckOverride.executed === null ? bundle : { ...bundle, executed: deckOverride.executed };
    },
  };
});

import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as smokePost } from "@/app/api/spice/models/smoke-test/route";
import { POST as runsPost } from "@/app/api/spice/runs/route";
import { compileCanonicalIr } from "../ir";
import { assertModelSafeForExecution, importModelText } from "../models";
import { __deckLayersForTests, assertCompiledDeckSafe, assertSafeDirective, compileNgspiceNetlist, SpiceDeckSafetyError } from "../netlist";
import { createSimulationProject } from "../project";
import { estimateRunPlan } from "../run-plan";
import { __resetJobStoreForTests, getRun, getRuns, startRunPlan } from "../server/job-store";
import type { DesignVariable, ModelAsset, NetlistBundle, OverlayElement, RunRecord, SimulationAnalysis, SimulationPartSnapshot, SimulationProject } from "../types";
import { dividerSchematic } from "./fixtures";

const C = (...codes: number[]): string => String.fromCharCode(...codes);
const NL = C(10);
const TAB = C(9);
const FF = C(12);
const MARK = "sec1-marker";
const NOW = "2026-09-30T00:00:00.000Z";
const deckLines = (deck: string) => deck.split(NL);

// ─── the payloads ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Form { name: string; make(prefix: string): string }
/** A line-break form carries a whole hostile control block; any other character is carried bare. A TAB is not one of them:
 *  it is SPICE whitespace (a token separator that never opens a line), valid in these fields on main, so it is checked on its
 *  own below ([SEC-1 review], finding regressions-tab-single-line-fields: the first suite refused it as a 13th form). */
const block = (separator: string) => (prefix: string) => [prefix, ".control", `shell ${MARK}`, ".endc"].join(separator);
const bare = (character: string) => (prefix: string) => `${prefix}${character}${MARK}`;
const FORMS: Form[] = [
  { name: "LF", make: block(C(10)) },
  { name: "CR", make: block(C(13)) },
  { name: "CRLF", make: block(C(13, 10)) },
  { name: "U+0085 NEL", make: block(C(0x85)) },
  { name: "U+2028 LS", make: block(C(0x2028)) },
  { name: "U+2029 PS", make: block(C(0x2029)) },
  { name: "VT", make: block(C(11)) },
  { name: "FF", make: block(C(12)) },
  { name: "NUL", make: bare(C(0)) },
  { name: "ESC", make: bare(C(27)) },
  { name: "DEL", make: bare(C(0x7f)) },
  { name: "backtick", make: (prefix) => `${prefix}${C(0x60)}${MARK}${C(0x60)}` },
];
/** [SEC-1 review] The same refused characters at the START or END of a value, where a trim would remove them. */
const EDGES: Form[] = [
  { name: "a trailing LF", make: (prefix) => `${prefix}${NL}` },
  { name: "a leading LF", make: (prefix) => `${NL}${prefix}` },
  { name: "a trailing CR", make: (prefix) => `${prefix}${C(13)}` },
  { name: "a trailing CRLF", make: (prefix) => `${prefix}${C(13, 10)}` },
  { name: "a trailing VT", make: (prefix) => `${prefix}${C(11)}` },
  { name: "a leading FF", make: (prefix) => `${FF}${prefix}` },
  { name: "a trailing U+2028", make: (prefix) => `${prefix}${C(0x2028)}` },
  { name: "a leading U+2029", make: (prefix) => `${C(0x2029)}${prefix}` },
  { name: "a leading U+0085", make: (prefix) => `${C(0x85)}${prefix}` },
  { name: "a trailing NUL", make: (prefix) => `${prefix}${C(0)}` },
];

// ─── the project every case starts from (a divider, a KiCad part bound to a subcircuit, one transient) ────────────────

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

function baseProject(): SimulationProject {
  const schematic = dividerSchematic();
  schematic.kicadComponents = [{ id: "U1", partId: PART.id, x: 600, y: 600, rotation: 0, refDes: "U1", value: "AMP" }];
  const project = createSimulationProject(schematic, { now: NOW });
  const model = importModelText("amp.lib", `${SUBCKT}${NL}`).candidate;
  model.id = "model-amp";
  project.modelAssets.push(model);
  project.modelBindings.push({ id: "binding-u1", componentId: "U1", modelId: model.id, pinMap: { "1": "1", "2": "2" }, parameterOverrides: { GAIN: "2" }, confidence: 1, assignedBy: "user", reviewed: true, createdAt: NOW });
  const test = project.tests[0]!;
  test.analyses = [{ id: "an-tran", name: "Startup transient", type: "tran", outputStep: "10u", stopTime: "1m", enabled: true }];
  test.outputs = [{ id: "out-vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
  return project;
}
const t0 = (project: SimulationProject) => project.tests[0]!;
const design0 = (project: SimulationProject) => project.designRevisions[0]!;
const model0 = (project: SimulationProject): ModelAsset => project.modelAssets.find((model) => model.id === "model-amp")!;
const net = (name: string) => ({ kind: "net" as const, net: name });
const overlay = (project: SimulationProject, element: OverlayElement) => { t0(project).overlay.elements.push(element); };
const variable = (name: string, value: string): DesignVariable => ({ id: `var-${name.length}`, name, value, unit: "", enabled: true });
const corner = (patch: Record<string, unknown>) => ({ id: "cs", name: "Corners", mode: "listed" as const, enabled: true, corners: [{ id: "c1", name: "Hot", variableValues: {}, modelSections: {}, enabled: true, ...patch }] });
const sweepList = (name: string, values: string[]) => ({ id: "sw", name: "Load", variable: name, enabled: true, definition: { kind: "list" as const, values } });
/** One Monte Carlo sample (the plan's first run point), drawn from `distribution`. */
function monteCarlo(project: SimulationProject, distribution: DesignVariable["distribution"]): void {
  t0(project).variables = [{ ...variable("RLOAD", "1k"), distribution }];
  t0(project).monteCarlo = { enabled: true, samples: 1, seed: 7, method: "random", includeNominal: false };
  project.runPlans[0]!.includeMonteCarlo = true;
}

/** The deck the worker compiles for the plan's first run point (the worker's options: the server-owned raw output path). */
function compileWith(project: SimulationProject, parts: SimulationPartSnapshot[] = [PART]): NetlistBundle {
  const point = estimateRunPlan(project, project.runPlans[0]!.id).runPoints[0]!;
  const compiled = compileCanonicalIr({ project, testId: point.testId, parts });
  return compileNgspiceNetlist(compiled.ir, { analysisId: point.analysisId, runPoint: point, rawOutputPath: "result.raw", pinNodes: compiled.pointNodes });
}
/** The compile preview (`/api/spice/compile`): no control block, never executed by the server. */
function previewOf(project: SimulationProject): string {
  const compiled = compileCanonicalIr({ project, testId: t0(project).id, parts: [PART] });
  return compileNgspiceNetlist(compiled.ir, { pinNodes: compiled.pointNodes }).executed;
}

// ─── what a deck may hold (this suite's own reading of the GROUND — what ngspice executes — not a copy of the screen) ──
// [SEC-1 round 3] The lead's ngspice-46 probe table: a command runs ONLY inside a `.control` block (including one inside an
// included file), from a `*#` line, or in an `*ng_script` deck. A command word anywhere else — the top level, a `.subckt`,
// after a form feed, an included file's body, a top-level `set` — is read as an element card and never runs (probes
// p1/p2/p6/p7/p9). So this oracle flags only the constructs that execute; it does NOT flag a command-word line.
const WRITE_LINE = /^write result\.raw [A-Za-z0-9_.,:#@()[\]+*/ -]+$/;
const OWN_BLOCK = [".control", "set filetype=ascii", "run", null, "quit", ".endc"] as const;

function deckFindings(deck: string): string[] {
  const findings: string[] = [];
  for (let index = 0; index < deck.length; index += 1) {
    const code = deck.charCodeAt(index);
    // [SEC-1 review] a TAB is SPICE whitespace (a token separator, never a line); every other control character is a finding
    if (code !== 10 && code !== 9 && (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029)) {
      findings.push(`control character ${code}`);
      break;
    }
  }
  if (deck.includes(C(0x60))) findings.push("a backtick");
  const lines = deckLines(deck);
  // [SEC-1 review] the first line is the title: ngspice reads it as text, never as a card; it runs the deck as a script when
  // the title starts `*ng_script` (probe p4). A `.title` line sets the title, so the text after its directive word counts too.
  // [SEC-1 round 3 review] Whether a `*#` TITLE runs is INFERRED (probe p3 ran a `*#` line AFTER the title; no round-3 probe put one on
  // line 1; [SEC-1 lead] p11-p13 later CONFIRMED it runs nothing - the refusal stays as defence in depth), so this oracle reads the title as conservatively as any other line: every `*#` title is a finding (a banner case
  // filters its own finding, as for a banner line below); it copies no production pattern.
  const titles = [lines[0] ?? "", ...lines.filter((line) => /^\s*\.title/i.test(line)).map((line) => line.replace(/^\s*\.title\S*/i, ""))];
  if (titles.some((title) => /^\s*\*\s*ng_script/i.test(title))) findings.push("an ng_script title");
  if (titles.some((title) => /^\s*\*#/.test(title))) findings.push("a '*#' title");
  const starts = lines.flatMap((line, index) => (index > 0 && /^\s*\.control/i.test(line) ? [index] : []));
  const ends = lines.filter((line, index) => index > 0 && /^\s*\.endc/i.test(line)).length;
  if (starts.length !== 1 || ends !== 1) findings.push(`${starts.length} .control and ${ends} .endc lines`);
  const start = starts[0] ?? -1;
  const own = lines.slice(start, start + OWN_BLOCK.length);
  if (start >= 0 && !(own.length === OWN_BLOCK.length && OWN_BLOCK.every((line, offset) => line === null || own[offset] === line) && WRITE_LINE.test(own[3] ?? ""))) {
    findings.push("the control block is not exactly the compiler's own");
  }
  lines.forEach((line, index) => {
    if (index === 0 || (start >= 0 && index >= start && index < start + OWN_BLOCK.length)) return;
    // [SEC-1 round 3] no command-word finding: a command word outside the block is a card, not a command (the probe table)
    if (/^\s*\.(?:inc|lib)/i.test(line)) findings.push(`line ${index + 1} reads a file`);
    if (/^\s*\*#/.test(line)) findings.push(`line ${index + 1} is a '*#' command line`);
  });
  return findings;
}

/** A refusal is CLOSED when it carries the SEC-1 code and none of the refused text. */
function printable(text: string): string {
  let out = "";
  for (let index = 0; index < text.length && out.length < 90; index += 1) {
    const code = text.charCodeAt(index);
    out += code >= 0x20 && code < 0x7f ? text[index] : "?";
  }
  return out;
}
function outcomeOf(compile: () => NetlistBundle): string {
  try {
    const findings = deckFindings(compile().executed);
    return `compiled: ${findings.length ? findings.join("; ") : "clean deck"}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^SPICE_DECK_UNSAFE: /.test(message) && !message.includes(MARK)) return "refused (closed)";
    return `refused otherwise: ${printable(message)}`;
  }
}
function refusal(run: () => unknown): string {
  try {
    run();
    return "accepted";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return /^SPICE_DECK_UNSAFE: /.test(message) && !message.includes(MARK) ? "refused (closed)" : `refused otherwise: ${printable(message)}`;
  }
}
/** The outcomes grouped by result on one line: the assertion message, so a failure names every form's outcome. */
function grouped(outcomes: Array<{ form: string; outcome: string }>): string {
  const groups = new Map<string, string[]>();
  for (const entry of outcomes) groups.set(entry.outcome, [...(groups.get(entry.outcome) ?? []), entry.form]);
  return [...groups].map(([outcome, forms]) => `[${forms.join(", ")}] ${outcome}`).join(" | ");
}

// ─── every caller- or model-controlled string the compiler writes (enumerated from netlist.ts, ir.ts and run-plan.ts) ─

/** `tab: "refused"` marks a field held by the output-expression allowlist (the compiler's `write` line), where a TAB is refused. */
interface Field { name: string; prefix: string; apply(project: SimulationProject, value: string): void; tab?: "refused" }
const FIELDS: Field[] = [
  { name: "project name (deck title)", prefix: "Studio", apply: (p, v) => { p.name = v; } },
  { name: "test name (deck title, run point label)", prefix: "Nominal", apply: (p, v) => { t0(p).name = v; } },
  { name: "design revision id (comment line)", prefix: "design-1", apply: (p, v) => { design0(p).id = v; p.activeDesignRevisionId = v; t0(p).baseDesignRevisionId = v; } },
  { name: "test id (comment line)", prefix: "test-1", apply: (p, v) => { t0(p).id = v; p.runPlans[0]!.testIds = [v]; } },
  { name: "test revision (comment line)", prefix: "1", apply: (p, v) => { t0(p).revision = v as never; } },
  { name: "analysis name (run point label)", prefix: "Transient", apply: (p, v) => { t0(p).analyses[0]!.name = v; } },
  { name: "corner name (run point label)", prefix: "Hot", apply: (p, v) => { t0(p).cornerSets = [corner({ name: v })]; } },
  { name: "sweep variable name (run point label)", prefix: "RLOAD", apply: (p, v) => { t0(p).variables = [variable("RLOAD", "1k")]; t0(p).sweeps = [sweepList(v, ["2k"])]; } },
  { name: "design variable value (.param)", prefix: "1k", apply: (p, v) => { t0(p).variables = [variable("RLOAD", v)]; } },
  { name: "design variable name (.param)", prefix: "RLOAD", apply: (p, v) => { t0(p).variables = [variable(v, "1k")]; } },
  { name: "sweep value (run point .param)", prefix: "2k", apply: (p, v) => { t0(p).variables = [variable("RLOAD", "1k")]; t0(p).sweeps = [sweepList("RLOAD", [v])]; } },
  { name: "corner variable value (run point .param)", prefix: "3k", apply: (p, v) => { t0(p).variables = [variable("RLOAD", "1k")]; t0(p).cornerSets = [corner({ variableValues: { RLOAD: v } })]; } },
  { name: "Monte Carlo custom sample (run point .param)", prefix: "1.1k", apply: (p, v) => monteCarlo(p, { kind: "custom", samples: [v] }) },
  { name: "Monte Carlo discrete value (run point .param)", prefix: "1.2k", apply: (p, v) => monteCarlo(p, { kind: "discrete", values: [{ value: v, weight: 1 }] }) },
  { name: "corner temperature (.temp)", prefix: "85", apply: (p, v) => { t0(p).cornerSets = [corner({ temperatureC: v })]; } },
  { name: "global parameter value (.param)", prefix: "2", apply: (p, v) => { t0(p).environment.globalParameters = { GAIN: v }; } },
  { name: "global parameter name (.param)", prefix: "GAIN", apply: (p, v) => { t0(p).environment.globalParameters = { [v]: "2" }; } },
  { name: "temperature (.temp)", prefix: "27", apply: (p, v) => { t0(p).environment.temperatureC = v as never; } },
  { name: "solver method (.options)", prefix: "gear", apply: (p, v) => { t0(p).environment.solverProfile.method = v as never; } },
  { name: "solver tolerance given as text (.options)", prefix: "0.001", apply: (p, v) => { t0(p).environment.solverProfile.reltol = v as never; } },
  { name: "custom .options entry", prefix: "savecurrents", apply: (p, v) => { t0(p).environment.solverProfile.customOptions = [v]; } },
  { name: "schematic resistor value", prefix: "1k", apply: (p, v) => { design0(p).schematic.components[1]!.value = v; } },
  { name: "schematic source value", prefix: "5", apply: (p, v) => { design0(p).schematic.components[0]!.value = v; } },
  { name: "overlay source waveform", prefix: "PULSE(0 5 0 1n 1n 5u 10u)", apply: (p, v) => overlay(p, { id: "ov-v", kind: "voltage-source", name: "VSTEP", positive: net("VIN"), negative: net("GND"), value: "0", waveform: v, enabled: true }) },
  { name: "overlay current source value", prefix: "1m", apply: (p, v) => overlay(p, { id: "ov-i", kind: "current-source", name: "IBIAS", positive: net("VIN"), negative: net("GND"), value: v, enabled: true }) },
  { name: "overlay load value", prefix: "2k", apply: (p, v) => overlay(p, { id: "ov-r", kind: "resistive-load", name: "RLOAD", positive: net("VIN"), negative: net("GND"), value: v, enabled: true }) },
  { name: "overlay fault resistance", prefix: "1m", apply: (p, v) => overlay(p, { id: "ov-f", kind: "fault", name: "RSHORT", fault: "short", target: net("VIN"), resistance: v, enabled: true }) },
  { name: "initial condition value (.ic)", prefix: "0", apply: (p, v) => overlay(p, { id: "ov-ic", kind: "initial-condition", name: "IC", target: net("VIN"), value: v, enabled: true }) },
  { name: "advanced directive", prefix: ".save v(VIN)", apply: (p, v) => { t0(p).analyses[0]!.advancedDirectives = [v]; } },
  { name: "output expression (.save and the control block's write line)", prefix: "v(VIN)", tab: "refused", apply: (p, v) => { t0(p).outputs = [{ id: "out-x", label: "X", expression: v, enabled: true }]; } },
  { name: "probe name (current probe output expression)", prefix: "IPROBE", tab: "refused", apply: (p, v) => overlay(p, { id: "ov-p", kind: "probe", name: v, target: net("VIN"), quantity: "current", enabled: true }) },
  { name: "model subcircuit name (element line)", prefix: "AMP", apply: (p, v) => { model0(p).subcircuitName = v; } },
  { name: "model name (element line, no subcircuit name)", prefix: "AMP", apply: (p, v) => { model0(p).subcircuitName = undefined; model0(p).name = v; } },
  { name: "model parameter override value", prefix: "2", apply: (p, v) => { p.modelBindings[0]!.parameterOverrides = { GAIN: v }; } },
  { name: "model parameter override name", prefix: "GAIN", apply: (p, v) => { p.modelBindings[0]!.parameterOverrides = { [v]: "2" }; } },
  // [SEC-1 review] identity names reach the deck as element and node names through the IR compiler's identifier sanitizers
  // (ir.ts:43-52); their raw text is refused at the boundary, never sanitized into a different deck (was: pinned as clean)
  { name: "schematic reference (element name)", prefix: "R1", apply: (p, v) => { design0(p).schematic.components[1]!.refDes = v; } },
  { name: "net label name (node name)", prefix: "VIN", apply: (p, v) => { design0(p).schematic.netLabels![0]!.name = v; } },
  { name: "overlay element name (element name)", prefix: "RLOAD", apply: (p, v) => overlay(p, { id: "ov-r", kind: "resistive-load", name: v, positive: net("VIN"), negative: net("GND"), value: "2k", enabled: true }) },
  { name: "overlay target net (node name)", prefix: "VX", apply: (p, v) => overlay(p, { id: "ov-r", kind: "resistive-load", name: "RLOAD", positive: net(v), negative: net("GND"), value: "2k", enabled: true }) },
  { name: "KiCad reference (element name)", prefix: "U1", apply: (p, v) => { design0(p).schematic.kicadComponents![0]!.refDes = v; } },
];
const field = (name: string): Field => FIELDS.find((candidate) => candidate.name.startsWith(name))!;

const ANALYSIS_ID = { id: "an-tran", name: "Analysis", enabled: true };
type Shape = Record<string, unknown> & { type: string };
const SHAPES: Record<string, Shape> = {
  tran: { type: "tran", outputStep: "10u", stopTime: "1m", startTime: "0", maxStep: "1u" },
  dc: { type: "dc", source: "V1", start: "0", stop: "5", step: "1", nested: { source: "V1", start: "0", stop: "1", step: "1" } },
  ac: { type: "ac", scale: "dec", points: 10, startFrequency: "1", stopFrequency: "1Meg" },
  noise: { type: "noise", output: "v(VIN)", inputSource: "V1", scale: "dec", points: 10, startFrequency: "10", stopFrequency: "1Meg" },
  tf: { type: "tf", output: "v(VIN)", inputSource: "V1" },
  pz: { type: "pz", inputPositive: "VIN", inputNegative: "0", outputPositive: "VIN", outputNegative: "0", transfer: "vol", calculation: "pz" },
  sens: { type: "sens", output: "v(VIN)", ac: { scale: "dec", points: 10, start: "1", stop: "1k" } },
  disto: { type: "disto", scale: "dec", points: 10, startFrequency: "10", stopFrequency: "1k", f2overF1: 0.9 },
  fourier: { type: "fourier", fundamentalFrequency: "1k", outputs: ["v(VIN)"] },
  custom: { type: "custom", commands: [".op"] },
};
/** One field per string an analysis writes: `path` is a key, `parent.key` for a nested object, or `key[0]` for a list. */
function analysisField(type: string, path: string): Field {
  const shape = SHAPES[type]!;
  const [parent, key] = path.includes(".") ? path.split(".") as [string, string] : [null, path];
  const listKey = /^(\w+)\[0\]$/.exec(path)?.[1];
  const prefix = listKey ? String((shape[listKey] as unknown[])[0]) : parent ? String((shape[parent] as Record<string, unknown>)[key]) : String(shape[key]);
  return {
    name: `${type} analysis ${path}`,
    prefix,
    apply: (p, v) => {
      const analysis: Record<string, unknown> = { ...ANALYSIS_ID, ...structuredClone(shape) };
      if (listKey) analysis[listKey] = [v];
      else if (parent) analysis[parent] = { ...(analysis[parent] as Record<string, unknown>), [key]: v };
      else analysis[key] = v;
      t0(p).analyses = [analysis as unknown as SimulationAnalysis];
    },
  };
}
const ANALYSIS_FIELDS: Field[] = [
  ...["outputStep", "stopTime", "startTime", "maxStep"].map((path) => analysisField("tran", path)),
  ...["source", "start", "stop", "step", "nested.source", "nested.start", "nested.stop", "nested.step"].map((path) => analysisField("dc", path)),
  ...["scale", "startFrequency", "stopFrequency"].map((path) => analysisField("ac", path)),
  ...["output", "inputSource", "scale", "startFrequency", "stopFrequency"].map((path) => analysisField("noise", path)),
  ...["output", "inputSource"].map((path) => analysisField("tf", path)),
  ...["inputPositive", "inputNegative", "outputPositive", "outputNegative", "transfer", "calculation"].map((path) => analysisField("pz", path)),
  ...["output", "ac.scale", "ac.start", "ac.stop"].map((path) => analysisField("sens", path)),
  ...["scale", "startFrequency", "stopFrequency", "f2overF1"].map((path) => analysisField("disto", path)),
  ...["fundamentalFrequency", "outputs[0]"].map((path) => analysisField("fourier", path)),
  analysisField("custom", "commands[0]"),
];

/** Strings that never reach the deck at all. */
const NEUTRAL_FIELDS: Field[] = [
  { name: "measurement expression (evaluated in-process, never written)", prefix: "v(VIN)", apply: (p, v) => { t0(p).measurements = [{ id: "m", name: "VMAX", operator: "max", expression: v, enabled: true }]; } },
  { name: "design variable description (never written)", prefix: "load", apply: (p, v) => { t0(p).variables = [{ ...variable("RLOAD", "1k"), description: v }]; } },
];

afterEach(() => {
  resetInjectedIdentity();
  __resetJobStoreForTests();
  vi.unstubAllEnvs();
  spawnState.calls = [];
  fsState.writes = [];
  deckOverride.executed = null;
  deckOverride.compiles = 0;
});

describe("[SEC-1] every caller- or model-controlled string the Studio compiler writes is one line, or the deck is refused", () => {
  it("the base project compiles to exactly the compiler's own deck (baseline)", () => {
    const deck = compileWith(baseProject()).executed;
    expect(deckFindings(deck)).toEqual([]);
    expect(deck).toContain("XU1 ");
    expect(deck).toContain(`${NL}write result.raw v(VIN)${NL}`);
  });

  it.each([...FIELDS, ...ANALYSIS_FIELDS].map((entry) => [entry.name, entry] as const))("%s: each line-break form, NUL, other controls and a backtick are refused with a closed error; a TAB stays inside its line", (_name, entry) => {
    const legit = baseProject();
    entry.apply(legit, entry.prefix);
    expect(outcomeOf(() => compileWith(legit)), "the legitimate value still compiles to a clean deck").toBe("compiled: clean deck");
    const outcomes = FORMS.map((form) => {
      const project = baseProject();
      entry.apply(project, form.make(entry.prefix));
      return { form: form.name, outcome: outcomeOf(() => compileWith(project)) };
    });
    const open = outcomes.filter((outcome) => outcome.outcome !== "refused (closed)");
    expect(open, grouped(open)).toEqual([]);
    const tabbed = baseProject();
    entry.apply(tabbed, `${entry.prefix}${TAB}${MARK}`);
    const tab = outcomeOf(() => compileWith(tabbed));
    if (entry.tab === "refused") {
      expect(tab, "the write line's allowlist refuses a TAB").toBe("refused (closed)");
    } else {
      expect(tab, "a TAB is SPICE whitespace: the deck stays clean").toBe("compiled: clean deck");
      expect(deckLines(compileWith(tabbed).executed).length, "a TAB never opens a line").toBe(deckLines(compileWith(legit).executed).length);
    }
  });

  it.each(NEUTRAL_FIELDS.map((entry) => [entry.name, entry] as const))("%s: never reaches the deck, so every form (and a TAB) still compiles to a clean deck", (_name, entry) => {
    const outcomes = [...FORMS, { name: "TAB", make: bare(TAB) }].map((form) => {
      const project = baseProject();
      entry.apply(project, form.make(entry.prefix));
      return { form: form.name, outcome: outcomeOf(() => compileWith(project)) };
    });
    const unclean = outcomes.filter((outcome) => outcome.outcome !== "compiled: clean deck");
    expect(unclean, grouped(unclean)).toEqual([]);
  });

  it.each([
    "schematic resistor value",
    "custom .options entry",
    "advanced directive",
    "output expression",
    "overlay source waveform",
    "model parameter override value",
    "net label name",
  ])("[review] %s: a refused character at the start or end is refused raw, never trimmed away", (name) => {
    const entry = field(name);
    const outcomes = EDGES.map((form) => {
      const project = baseProject();
      entry.apply(project, form.make(entry.prefix));
      return { form: form.name, outcome: outcomeOf(() => compileWith(project)) };
    });
    const open = outcomes.filter((outcome) => outcome.outcome !== "refused (closed)");
    expect(open, grouped(open)).toEqual([]);
  });

  it.each([
    ["a command separator", "v(VIN);shell sec1-marker"],
    ["an output redirection", "v(VIN) > sec1-marker.txt"],
    ["an input redirection", "v(VIN) < sec1-marker.txt"],
    ["a pipe", "v(VIN) | sec1-marker"],
    ["an ampersand", "v(VIN) >& sec1-marker"],
    ["a variable substitution", "$sec1-marker"],
    ["a history escape", "v(VIN) !sec1-marker"],
    ["a brace expansion", "{sec1-marker}"],
    ["a home expansion", "~/sec1-marker"],
    ["a quote", "v(VIN) \"sec1-marker\""],
  ])("an output expression with %s (single line, written inside the compiler's own control block) is refused", (_label, expression) => {
    const project = baseProject();
    t0(project).outputs = [{ id: "out-x", label: "X", expression, enabled: true }];
    const outcome = outcomeOf(() => compileWith(project));
    expect(outcome, outcome).toBe("refused (closed)");
    const probe = baseProject();
    overlay(probe, { id: "ov-p", kind: "probe", name: `IPROBE) ${expression} (`, target: net("VIN"), quantity: "current", enabled: true });
    const asProbe = outcomeOf(() => compileWith(probe));
    expect(asProbe, `the same text as a current probe's name: ${asProbe}`).toBe("refused (closed)");
  });

  it.each([
    ["a project named as an ngspice script", (p: SimulationProject) => { p.name = "*ng_script"; }],
    // [SEC-1 lead] CONFIRMED by the lead's probe p10: a FIRST line `.title *ng_script` runs the deck as a script, so line 1 is read
    // through a `.title` prefix too (the check's new issue after round 3: line 1 was screened as written only)
    ["[SEC-1 lead] a project named as a .title line naming an ngspice script (line 1; probe p10)", (p: SimulationProject) => { p.name = ".title *ng_script"; }],
    ["[SEC-1 lead] a project named as a prefix-spelled, upper-case .TITLES line naming an ngspice script (line 1)", (p: SimulationProject) => { p.name = ".TITLES  *NG_SCRIPT"; }],
    // [SEC-1 round 3 review] A non-banner '*#' TITLE is refused as INFERRED defence in depth, NOT on the probes' ground: probe p3
    // ran a '*#' line after the title and no round-3 probe put one on line 1 ([SEC-1 lead] p11-p13 later CONFIRMED a '*#' title runs nothing). A stated
    // deviation: main and fe147c9 compiled a project named '*#2 buck stage'; the refusal fails closed (page section 4).
    ["a project named as a '*#' command line (the deck title, line 1; INFERRED)", (p: SimulationProject) => { p.name = `*# shell ${MARK}`; }],
    ["[stated deviation] a project named '*#2 buck stage' (a '*#' title; INFERRED, fails closed)", (p: SimulationProject) => { p.name = "*#2 buck stage"; }],
    // [SEC-1 round 3 review] coverage-1: a `.title` line sets the title, so the same title rules hold for its text, also as
    // ngspice's prefix match reads `.title` (a `.titlex` line; INFERRED from the ngspice front end, never probed)
    ["a .title directive naming a '*#' command (INFERRED)", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [`.title *# shell ${MARK}`]; }],
    ["model text with a .TITLE line naming a '*#' command (INFERRED)", (p: SimulationProject) => { model0(p).originalContent = [SUBCKT, `.TITLE *# shell ${MARK}`].join(NL); }],
    ["a prefix-spelled .title directive naming an ngspice script (INFERRED)", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [".titles *ng_script"]; }],
    ["a prefix-spelled .title directive naming a '*#' command (INFERRED)", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [`.titles *# shell ${MARK}`]; }],
    ["a .title directive naming an ngspice script", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [".title *ng_script"]; }],
    ["a one-line .control directive", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [".control"]; }],
    ["a prefix-spelled control directive (ngspice matches the prefix)", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [".controls"]; }],
    ["a one-line .endc directive", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [".endc"]; }],
    ["an .include directive", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [`.include "/${MARK}.lib"`]; }],
    ["a .lib directive", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [`.lib /${MARK}.lib tt`]; }],
  ])("%s is refused in the executed deck", (_label, mutate) => {
    const project = baseProject();
    mutate(project);
    const outcome = outcomeOf(() => compileWith(project));
    expect(outcome, outcome).toBe("refused (closed)");
  });
});

describe("[SEC-1 review] legitimate inputs the first screen refused compile again, and nothing else opens", () => {
  it("a TAB-separated advanced directive and custom .options entry are written as one line each, in the run and the preview", () => {
    const project = baseProject();
    t0(project).analyses[0]!.advancedDirectives = [`.param${TAB}RL=1k`];
    t0(project).environment.solverProfile.customOptions = [`reltol=1e-4${TAB}abstol=1e-12`];
    const deck = compileWith(project).executed;
    expect(deckFindings(deck)).toEqual([]);
    expect(deckLines(deck)).toEqual(expect.arrayContaining([`.param${TAB}RL=1k`, `.options reltol=1e-4${TAB}abstol=1e-12`]));
    expect(deckLines(previewOf(project))).toContain(`.param${TAB}RL=1k`);
  });

  it.each([
    ["a project named 'ng_script tests' (only a '*ng_script' title is a script)", (p: SimulationProject) => { p.name = "ng_script tests"; }],
    ["a net label TIMING_SCRIPT (the substring in a node name)", (p: SimulationProject) => { design0(p).schematic.netLabels![0]!.name = "TIMING_SCRIPT"; }],
    ["a model comment that mentions ng_script", (p: SimulationProject) => { model0(p).originalContent = [SUBCKT, "* this model was checked in ng_script mode"].join(NL); }],
    ["a project named '.controller demo' (the title is never a card)", (p: SimulationProject) => { p.name = ".controller demo"; }],
    ["a project named '.endc review'", (p: SimulationProject) => { p.name = ".endc review"; }],
  ])("%s compiles to a clean deck", (_label, mutate) => {
    const project = baseProject();
    mutate(project);
    expect(outcomeOf(() => compileWith(project))).toBe("compiled: clean deck");
    expect(() => previewOf(project)).not.toThrow();
  });

  // [SEC-1 round 3 review] The title rules refuse no more than they name: a `.title` banner, and a `.title` that merely mentions
  // a `*#` after its text, compile (the oracle flags every `*#` title, so these assert acceptance, not a clean deck).
  it.each([
    ["a .title banner directive", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [".title *#====="]; }],
    ["a .title that mentions '*#' after its text", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [".title Buck stage *#2"]; }],
  ])("[SEC-1 round 3 review] %s is accepted in the run and the preview", (_label, mutate) => {
    const project = baseProject();
    mutate(project);
    expect(refusal(() => compileWith(project))).toBe("accepted");
    expect(refusal(() => previewOf(project))).toBe("accepted");
  });

  // [SEC-1 round 3] Pin move (was: "...only those cards are exempt", with a COMMAND_WORD filter over the findings). The ground
  // shows no command-word line outside the block runs, so the screen no longer refuses one and no `cards` exemption remains:
  // an element card named like a command word compiles to a clean deck wherever it appears.
  it("[SEC-1 round 3] element cards named like a command word (a capacitor CD, an inductor load) compile to a clean deck", () => {
    const project = baseProject();
    overlay(project, { id: "ov-c", kind: "capacitive-load", name: "CD", positive: net("VIN"), negative: net("GND"), value: "1u", enabled: true });
    overlay(project, { id: "ov-l", kind: "inductive-load", name: "load", positive: net("VIN"), negative: net("GND"), value: "10u", enabled: true });
    const deck = compileWith(project).executed;
    expect(deckFindings(deck)).toEqual([]);
    const beforeBlock = deckLines(deck).slice(0, deckLines(deck).indexOf(".control"));
    expect(beforeBlock.some((line) => /^CD /.test(line)), "the capacitor card is present").toBe(true);
    expect(beforeBlock.some((line) => /^load /.test(line)), "the inductor card is present").toBe(true);
  });

  const BANNERS = ["*##########################", "*#--------------------", "*#====================", "*#", `*#${TAB}####`];
  const PAGED = [".subckt AMP 1 2", `${FF}* page 2 of the vendor listing`, "R1 1 2 1k", FF, ".ends AMP"].join(NL);
  const acceptedModel = (findings: string[]) => findings.filter((finding) => !/'\*#' command line|control character 12/.test(finding));

  it("vendor '*#' banner lines and form-feed page breaks in model text compile (run and preview) and smoke-test", async () => {
    for (const text of [[...BANNERS, SUBCKT].join(NL), PAGED]) {
      const project = baseProject();
      model0(project).originalContent = text;
      expect(() => assertModelSafeForExecution(model0(project))).not.toThrow();
      const deck = compileWith(project).executed;
      expect(acceptedModel(deckFindings(deck)), deck).toEqual([]);
      expect(deck).toContain("R1 1 2 1k");
      expect(() => previewOf(project)).not.toThrow();
      const model = importModelText("amp.lib", `${SUBCKT}${NL}`).candidate;
      model.originalContent = text;
      const res = await smokePost(post("/api/spice/models/smoke-test", { model }));
      expect(res.status, text).toBe(200);
    }
    expect(spawnState.calls.filter((call) => call.args[0] === "-b")).toHaveLength(2);
  });

  it.each([
    ["a '*#' line naming a command", `*# shell ${MARK}`],
    ["a '*#' line with a glob (the command language expands '*')", "*#***"],
    ["a banner that goes on to a command", `*#### load ${MARK}`],
    ["a form feed before a '*#' command", `R2 1 2 1k${FF}*# shell ${MARK}`],
    ["a form feed hiding a control block", [".ends AMP", ".control", `shell ${MARK}`, ".endc"].join(FF)],
  ])("model text with %s is still refused", (_label, line) => {
    const project = baseProject();
    model0(project).originalContent = [SUBCKT, line].join(NL);
    expect(outcomeOf(() => compileWith(project))).toBe("refused (closed)");
  });
});

describe("[SEC-1] model text is multi-line by nature: the final deck screen holds what the model screen misses", () => {
  const hostile = (lines: string[]) => [SUBCKT, ...lines].join(NL);
  // [SEC-1 round 3] Only the constructs the probe table shows EXECUTE are pinned refused here (a second control block, a `*#`
  // line, an include/lib the compiler did not write). A bare command-word line is no longer among them — it is a card (see
  // the round-3 describe below), so the command-word array that used to live here moved to the accepted cases.
  it.each<[string, (model: ModelAsset) => void, "admits" | "refuses"]>([ // [B22-A1, 2026-10-01] reviewed pin move: the model screen now reads exactly the text the deck emits and refuses a file read outside the run directory (D22-4), so it refuses three of these four (was "the existing model screen admits it" for all four); the case's point is unchanged - compileWith never runs the model screen, so the final deck screen refuses each executed deck on its own
    ["an empty transformedContent over a hostile originalContent (the screen reads one, the deck emits the other)", (model: ModelAsset) => { model.originalContent = hostile([".control", `shell ${MARK}`, ".endc"]); model.transformedContent = ""; }, "refuses"],
    ["a '*#' line (ngspice runs it as a control command)", (model: ModelAsset) => { model.originalContent = hostile([`*# shell ${MARK}`]); }, "admits"],
    ["a relative .include with no recorded dependency", (model: ModelAsset) => { model.originalContent = hostile([`.include ../../${MARK}.lib`]); }, "refuses"],
    ["a .lib read", (model: ModelAsset) => { model.originalContent = hostile([`.lib /${MARK}.lib tt`]); }, "refuses"],
  ])("%s: the executed deck is refused by the final screen on its own (the model screen %s it)", (_label, mutate, screen) => {
    const project = baseProject();
    mutate(model0(project));
    expect(refusal(() => assertModelSafeForExecution(model0(project))) === "accepted" ? "admits" : "refuses", "the model screen (B22-A1)").toBe(screen);
    const outcome = outcomeOf(() => compileWith(project));
    expect(outcome, outcome).toBe("refused (closed)");
  });

  it("the compile preview (no control block, never executed) keeps a model's file directive for the user's own machine", () => {
    const project = baseProject();
    model0(project).originalContent = [SUBCKT, ".include models/amp-extra.lib"].join(NL);
    expect(previewOf(project)).toContain(".include models/amp-extra.lib");
  });

  const smokeModel = (text: string) => {
    const model = importModelText("amp.lib", `${SUBCKT}${NL}`).candidate;
    model.originalContent = text;
    return model;
  };
  it.each(FORMS.filter((form) => !["ESC", "DEL"].includes(form.name)).map((form) => [form.name, form] as const))("[review] model text carrying %s is refused by the final screen at compile, and by the smoke test before any file", async (_name, form) => {
    const project = baseProject();
    model0(project).originalContent = form.make(SUBCKT);
    const outcome = outcomeOf(() => compileWith(project));
    expect(outcome, outcome).toBe("refused (closed)");
    const res = await smokePost(post("/api/spice/models/smoke-test", { model: smokeModel(form.make(SUBCKT)) }));
    const body = await res.json() as { error?: string };
    expect({ status: res.status, marked: String(body.error).includes(MARK), files: fsState.writes.length, ngspiceRuns: spawnState.calls.length }).toEqual({ status: 422, marked: false, files: 0, ngspiceRuns: 0 });
  });

  it("[review] a TAB, ESC or DEL inside a model line opens no line: it passes as it did on main (no line-break meaning to ngspice)", () => {
    const clean = deckLines(compileWith(baseProject()).executed).length;
    for (const character of [TAB, C(27), C(0x7f)]) {
      const project = baseProject();
      model0(project).originalContent = bare(character)(SUBCKT);
      const deck = compileWith(project).executed;
      expect(deckLines(deck).length).toBe(clean);
      expect(deckLines(deck)).toContain(`.ends AMP${character}${MARK}`);
    }
  });
});

describe("[SEC-1] the final deck screen (defence in depth behind the field screen)", () => {
  const legit = () => compileWith(baseProject()).executed;
  const beforeControl = (deck: string, extra: string[]) => {
    const all = deckLines(deck);
    all.splice(all.indexOf(".control"), 0, ...extra);
    return all.join(NL);
  };
  const replaceLine = (deck: string, match: RegExp, replacement: string) => deckLines(deck).map((line) => (match.test(line) ? replacement : line)).join(NL);
  const EXECUTED = { controlBlock: true, executed: true };

  it("a compiled deck passes and is returned unchanged", () => {
    const deck = legit();
    expect(assertCompiledDeckSafe(deck, EXECUTED)).toBe(deck);
  });

  it.each<[string, (deck: string) => string]>([
    ["a second control block", (deck: string) => beforeControl(deck, [".control", `shell ${MARK}`, ".endc"])],
    ["a prefix-spelled second control line", (deck: string) => beforeControl(deck, [".controls", `shell ${MARK}`, ".endc"])],
    ["a '*#' command line", (deck: string) => beforeControl(deck, [`*# shell ${MARK}`])],
    ["a script title", (deck: string) => `*ng_script${NL}${deck}`],
    ["an include", (deck: string) => beforeControl(deck, [`.include "/${MARK}.lib"`])],
    ["a library read", (deck: string) => beforeControl(deck, [`.lib /${MARK}.lib tt`])],
    ["a dot shell directive", (deck: string) => beforeControl(deck, [`.shell ${MARK}`])],
    ["a shell escape line", (deck: string) => beforeControl(deck, [`!${MARK}`])],
    ["command substitution", (deck: string) => beforeControl(deck, [`* ${C(0x60)}${MARK}${C(0x60)}`])],
    ["an extra command inside the compiler's block", (deck: string) => replaceLine(deck, /^run$/, ["run", `shell ${MARK}`].join(NL))],
    ["a command separator on the write line", (deck: string) => replaceLine(deck, /^write /, `write result.raw v(VIN);shell ${MARK}`)],
    ["a redirection on the write line", (deck: string) => replaceLine(deck, /^write /, `write result.raw v(VIN) > ${MARK}`)],
    ["a CR inside a line", (deck: string) => beforeControl(deck, [`R9 VIN 0 1k${C(13)}${MARK}`])],
    ["a NUL", (deck: string) => beforeControl(deck, [`R9 VIN 0 1k${C(0)}${MARK}`])],
    ["a U+2028", (deck: string) => beforeControl(deck, [`R9 VIN 0 1k${C(0x2028)}${MARK}`])],
    ["[review] a U+2029", (deck: string) => beforeControl(deck, [`R9 VIN 0 1k${C(0x2029)}${MARK}`])],
    ["[review] a U+0085", (deck: string) => beforeControl(deck, [`R9 VIN 0 1k${C(0x85)}${MARK}`])],
    ["[review] a VT", (deck: string) => beforeControl(deck, [`R9 VIN 0 1k${C(11)}${MARK}`])],
    ["[review] a form feed hiding a control block", (deck: string) => beforeControl(deck, [[`R9 VIN 0 1k`, ".control", `shell ${MARK}`, ".endc"].join(FF)])],
    // [SEC-1 round 3 review] tests-3: the title's own form-feed pieces are screened too (a form feed in the title hiding a
    // command word stays accepted, round-3 describe below; these hide an executing construct)
    ["[round 3 review] a form feed in the title hiding a '*#' command", (deck: string) => [`${deckLines(deck)[0]}${FF}*# shell ${MARK}`, ...deckLines(deck).slice(1)].join(NL)],
    ["[round 3 review] a form feed in the title hiding a control block", (deck: string) => [[deckLines(deck)[0], ".control", `shell ${MARK}`, ".endc"].join(FF), ...deckLines(deck).slice(1)].join(NL)],
    // [SEC-1 round 3] The `.shell/.cd/.source/.quit/.exec/.system/.destroy/.remcirc` DOTTED forms stay refused as defence in
    // depth: no legitimate element card is a dotted directive; the list is a superset of the model screen's own
    // `.shell/.cd/.source/.quit` (models.ts:200, unchanged). A bare command-word line (no dot) is NOT here any more — the probe
    // table shows it is a card (round-3 describe).
    ...[".cd /", `.source /${MARK}`, ".quit", `.exec ${MARK}`, `.system ${MARK}`, ".destroy all", ".remcirc"]
      .map((line): [string, (deck: string) => string] => [`[review] a '${line.split(" ")[0]}' directive`, (deck: string) => beforeControl(deck, [line])]),
  ])("%s is refused with a closed error", (_label, alter) => {
    const outcome = refusal(() => assertCompiledDeckSafe(alter(legit()), EXECUTED));
    expect(outcome, outcome).toBe("refused (closed)");
  });

  // [SEC-1 round 3] Pin move (was: "a compiler element card may spell a command word; the same line from anywhere else is
  // refused", which required an exact-line `cards` exemption). The lead's probes show ngspice reads an element card as a
  // device wherever it appears, so the screen accepts it from anywhere and the `cards` exemption is gone.
  it("[SEC-1 round 3] an element card that spells a command word is accepted from anywhere: ngspice reads it as a device (the probe table)", () => {
    for (const card of ["CD VIN 0 1u", "Load VIN 0 10u", "Define VIN 0 DMOD", "Set VIN 0 A B SMOD", "Source VIN 0 A B SMOD"]) {
      const deck = beforeControl(legit(), [card]);
      expect(refusal(() => assertCompiledDeckSafe(deck, EXECUTED)), card).toBe("accepted");
    }
  });

  it("a deck that carries no control block (the preview, the smoke test) refuses any; only an executed deck refuses file directives", () => {
    const preview = previewOf(baseProject());
    expect(assertCompiledDeckSafe(preview, { controlBlock: false, executed: false })).toBe(preview);
    expect(refusal(() => assertCompiledDeckSafe(`${preview}.control${NL}.endc${NL}`, { controlBlock: false, executed: false }))).toBe("refused (closed)");
    const withInclude = `${preview}.include "models/x.lib"${NL}`;
    expect(refusal(() => assertCompiledDeckSafe(withInclude, { controlBlock: false, executed: false }))).toBe("accepted");
    expect(refusal(() => assertCompiledDeckSafe(withInclude, { controlBlock: false, executed: true }))).toBe("refused (closed)");
  });

  // [SEC-1 round 3 review] tests-2: the compile preview (`/api/spice/compile`, the export a user runs on their own machine) refuses
  // every executing construct as the executed deck does: the `*#` line and the title rules are never gated on execution.
  it.each<[string, (p: SimulationProject) => void]>([
    ["model text with a '*#' command line", (p) => { model0(p).originalContent = [SUBCKT, `*# shell ${MARK}`].join(NL); }],
    ["a project named as an ngspice script (the title)", (p) => { p.name = "*ng_script"; }],
    ["a project named as a '*#' command line (the title; INFERRED)", (p) => { p.name = `*# shell ${MARK}`; }],
    ["a .title directive naming an ngspice script", (p) => { t0(p).analyses[0]!.advancedDirectives = [".title *ng_script"]; }],
    ["a .title directive naming a '*#' command (INFERRED)", (p) => { t0(p).analyses[0]!.advancedDirectives = [`.title *# shell ${MARK}`]; }],
  ])("[round 3 review] the compile preview refuses %s with a closed error", (_label, mutate) => {
    const project = baseProject();
    mutate(project);
    expect(refusal(() => previewOf(project))).toBe("refused (closed)");
  });
});

describe("[SEC-1 review] each defence layer holds on its own (pinned behind the field screen, which refuses first)", () => {
  it("assertSafeDirective refuses a line break anywhere in the text, before the trim, with a closed error", () => {
    for (const text of [`.options x${NL}.control`, `.save v(VIN)${NL}`, `${NL}.save v(VIN)`, `.save v(VIN)${C(13)}`, `.save v(VIN)${C(0x2028)}`]) {
      expect(() => assertSafeDirective(text), printable(text)).toThrow(SpiceDeckSafetyError);
    }
    expect(assertSafeDirective(`  .param${TAB}RL=1k  `)).toBe(`.param${TAB}RL=1k`);
  });

  it("the writer pushes one line per string: a string carrying a line break is refused, never split", () => {
    const writer = __deckLayersForTests.createWriter();
    expect(() => writer.push(`R1 VIN 0 1k${NL}.control`)).toThrow(SpiceDeckSafetyError);
    expect(() => writer.push(`R1 VIN 0 1k${C(13, 10)}.control`)).toThrow(SpiceDeckSafetyError);
    writer.push(["* model line 1", "* model line 2"]);
    writer.push(`R1 VIN 0 1k${TAB}x`);
    expect(writer.lines).toEqual(["* model line 1", "* model line 2", `R1 VIN 0 1k${TAB}x`]);
  });

  it("the .options screen admits space and tab only: an entry with a line break or another separator is dropped", () => {
    const irWith = (options: string[]) => {
      const project = baseProject();
      t0(project).environment.solverProfile.customOptions = options;
      return compileCanonicalIr({ project, testId: t0(project).id, parts: [PART] }).ir;
    };
    const base = __deckLayersForTests.optionLines(irWith([]));
    const lines = __deckLayersForTests.optionLines(irWith([`reltol=1e-4${TAB}abstol=1e-12`, `savecurrents${NL}.control`, `savecurrents${C(13)}x`, `savecurrents${C(11)}x`, "x;y"]));
    expect(lines).toEqual([...base, `.options reltol=1e-4${TAB}abstol=1e-12`]);
  });
});

// ─── end to end: POST /api/spice/runs with ngspice NOT executed ──────────────────────────────────────────────────────

const SCOPE = { tenantId: "local", projectId: "proj-sec1", branchId: "main" };
const SELECTOR = { "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId };
/** The three spawners' allowlist, as written in their sources ([SEC-1 review]: pinned literally, not only equal). */
const SPAWN_ALLOWLIST = '["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LD_LIBRARY_PATH"]';
const ALLOWED_ENV = ["HOME", "LD_LIBRARY_PATH", "NODE_ENV", "PATH", "PATHEXT", "Path", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "WINDIR"];
/** Variables set in the test process only (fake values; secret-shaped names assembled at runtime, never real ones). */
const CANARIES = [["SIRKIT", "SEC1", "ENV", "CANARY"], ["SIRKIT", "SEC1", "FAKE", "API", "KEY"], ["SIRKIT", "SEC1", "FAKE", "SERVICE", "ROLE", "KEY"]].map((parts) => parts.join("_"));

function post(path: string, body: unknown): Request {
  injectAuthorizedPrincipal({ userId: "u-sec1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
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
const closed = (text: unknown) => typeof text === "string" && /^SPICE_DECK_UNSAFE: /.test(text) && !text.includes(MARK);
async function routeOutcome(project: SimulationProject) {
  const res = await runsPost(post("/api/spice/runs", { project, runPlanId: project.runPlans[0]!.id, parts: [PART] }));
  const body = await res.json() as { error?: string; batch?: { runIds: string[] } };
  const runs = await Promise.all((body.batch?.runIds ?? []).map(settled));
  const decks = fsState.writes.filter((write) => write.path.endsWith("executed.cir"));
  return {
    status: res.status,
    closedError: closed(body.error),
    jobs: getRuns(SCOPE).length,
    runs: runs.map((run) => ({ status: run?.status, closedError: closed(run?.error) })),
    decksWritten: decks.length,
    deckFindings: decks.flatMap((deck) => deckFindings(deck.content)),
    ngspiceRuns: spawnState.calls.filter((call) => call.args[0] === "-b").length,
  };
}
const disallowedEnv = (keys: string[] | null | undefined) => (keys ? keys.filter((key) => !ALLOWED_ENV.includes(key)) : ["(no env option: the whole server environment)"]);
const REFUSED = { status: 422, closedError: true, jobs: 0, runs: [], decksWritten: 0, deckFindings: [], ngspiceRuns: 0 };

describe("[SEC-1] POST /api/spice/runs: a hostile run request is refused with a closed 4xx; no job, no deck, no process", () => {
  it("a legitimate run request still starts, writes exactly the compiler's deck, and spawns ngspice (the -v probe included) with the allowlisted environment", async () => {
    for (const name of CANARIES) vi.stubEnv(name, "sec1-canary");
    const outcome = await routeOutcome(baseProject());
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ status: 202, jobs: 1, decksWritten: 1, deckFindings: [], ngspiceRuns: 1 });
    const probe = spawnState.all.find((call) => call.args[0] === "-v");
    const run = spawnState.calls.find((call) => call.args[0] === "-b");
    expect(probe, "the version probe ran").toBeDefined();
    expect(disallowedEnv(probe?.envKeys), "the version probe's environment").toEqual([]);
    expect(disallowedEnv(run?.envKeys), "the run's environment").toEqual([]);
    for (const name of CANARIES) {
      expect(probe?.envKeys ?? []).not.toContain(name);
      expect(run?.envKeys ?? []).not.toContain(name);
    }
  });

  it("[review] TAB-separated directives and options, a vendor banner and a form-feed page break still run: 202, the deck written, ngspice spawned", async () => {
    const project = baseProject();
    t0(project).analyses[0]!.advancedDirectives = [`.param${TAB}RL=1k`];
    t0(project).environment.solverProfile.customOptions = [`reltol=1e-4${TAB}abstol=1e-12`];
    model0(project).originalContent = ["*##########################", ".subckt AMP 1 2", `${FF}* page 2`, "R1 1 2 1k", ".ends AMP"].join(NL);
    const outcome = await routeOutcome(project);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ status: 202, jobs: 1, decksWritten: 1, ngspiceRuns: 1 });
    const deck = fsState.writes.find((write) => write.path.endsWith("executed.cir"))?.content ?? "";
    expect(deckLines(deck)).toEqual(expect.arrayContaining([`.param${TAB}RL=1k`, `.options reltol=1e-4${TAB}abstol=1e-12`, "*##########################"]));
  });

  it.each([
    ...FORMS.map((form) => [`a source value carrying ${form.name}`, (p: SimulationProject) => { design0(p).schematic.components[0]!.value = form.make("5"); }] as const),
    ["a custom .options entry carrying LF", (p: SimulationProject) => { t0(p).environment.solverProfile.customOptions = [block(NL)("savecurrents")]; }] as const,
    ["an .ic value carrying LF", (p: SimulationProject) => overlay(p, { id: "ov-ic", kind: "initial-condition", name: "IC", target: net("VIN"), value: block(NL)("0"), enabled: true })] as const,
    ["an advanced directive carrying LF", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [block(NL)(".save v(VIN)")]; }] as const,
    ["an output expression with a command separator", (p: SimulationProject) => { t0(p).outputs = [{ id: "out-x", label: "X", expression: `v(VIN);shell ${MARK}`, enabled: true }]; }] as const,
    ["a model whose empty transformedContent hides a hostile originalContent", (p: SimulationProject) => { model0(p).originalContent = [SUBCKT, ".control", `shell ${MARK}`, ".endc"].join(NL); model0(p).transformedContent = ""; }] as const,
    ["a model text '*#' command line", (p: SimulationProject) => { model0(p).originalContent = [SUBCKT, `*# shell ${MARK}`].join(NL); }] as const,
    ["a model with a recorded include dependency, on a plan whose source value carries LF", (p: SimulationProject) => { model0(p).dependencies = ["amp-extra.lib"]; design0(p).schematic.components[0]!.value = block(NL)("5"); }] as const, // [B22-A1, 2026-10-01] reviewed pin move from the 202 cases below, its input unchanged: the model screen judges include dependencies by the model text, never by the client's `dependencies` (D22-4), so it admits this model and the preflight refuses the plan's LF source value - 422 before any job (was 202, the worker's "unresolved include dependency"); a text include is refused 422 (closed) in b22-a1-model-screen
    ["a one-line .control directive", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = [".control"]; }] as const,
    ["[review] a net label carrying LF (an identity name)", (p: SimulationProject) => { design0(p).schematic.netLabels![0]!.name = block(NL)("VIN"); }] as const,
    // [SEC-1 review] the first run point is clean; the hostile value is on a later one
    ["[review] a later sweep point", (p: SimulationProject) => { t0(p).variables = [variable("RLOAD", "1k")]; t0(p).sweeps = [sweepList("RLOAD", ["2k", block(NL)("3k")])]; }] as const,
    ["[review] a second analysis", (p: SimulationProject) => { t0(p).analyses.push({ id: "an-tran-2", name: "Second", type: "tran", outputStep: "10u", stopTime: block(NL)("2m"), enabled: true }); }] as const,
    ["[review] a second test", (p: SimulationProject) => {
      const second = structuredClone(t0(p));
      second.id = "test-2";
      second.name = "Second";
      second.environment.temperatureC = block(NL)("85") as never;
      p.tests.push(second);
      p.runPlans[0]!.testIds.push(second.id);
    }] as const,
  ])("%s", async (_label, mutate) => {
    const project = baseProject();
    mutate(project);
    const outcome = await routeOutcome(project);
    expect(outcome, JSON.stringify(outcome)).toEqual(REFUSED);
  });

  it.each([
    ["a model the existing model screen refuses (a .control line in its text)", (p: SimulationProject) => { model0(p).originalContent = [SUBCKT, ".control", `shell ${MARK}`, ".endc"].join(NL); }, /contains forbidden \.control blocks/],
    ["a compile error that is no deck refusal (a directive without its period)", (p: SimulationProject) => { t0(p).analyses[0]!.advancedDirectives = ["save v(VIN)"]; }, /must start with a period/],
  ])("[review] %s: the preflight leaves it to the worker, which fails the run before any deck (202, the run's own message)", async (_label, mutate, message) => {
    const project = baseProject();
    mutate(project);
    const outcome = await routeOutcome(project);
    expect(outcome, JSON.stringify(outcome)).toEqual({ status: 202, closedError: false, jobs: 1, runs: [{ status: "failed", closedError: false }], decksWritten: 0, deckFindings: [], ngspiceRuns: 0 });
    expect(getRuns(SCOPE)[0]?.error).toMatch(message);
  });

  it("the worker's own final screen refuses a deck altered after compilation: the run ends failed (closed), no deck is written, ngspice never runs", async () => {
    const all = compileWith(baseProject()).executed.split(NL);
    all.splice(all.indexOf(".control"), 0, ".control", `shell ${MARK}`, ".endc");
    deckOverride.executed = all.join(NL);
    const outcome = await routeOutcome(baseProject());
    expect(outcome, JSON.stringify(outcome)).toEqual({ status: 202, closedError: false, jobs: 1, runs: [{ status: "failed", closedError: true }], decksWritten: 0, deckFindings: [], ngspiceRuns: 0 });
  });

  it.each([
    ["one analysis, 24 sweep points", 1, 24],
    ["two analyses, 12 sweep points each", 2, 24],
  ])("[review] the preflight compiles one deck per test and analysis, not one per run point (%s)", async (_label, analyses, total) => {
    const project = baseProject();
    t0(project).variables = [variable("RLOAD", "1k")];
    t0(project).sweeps = [sweepList("RLOAD", Array.from({ length: total / analyses }, (_, index) => `${index + 1}k`))];
    if (analyses === 2) t0(project).analyses.push({ id: "an-tran-2", name: "Second", type: "tran", outputStep: "10u", stopTime: "2m", enabled: true });
    deckOverride.compiles = 0;
    const batch = startRunPlan({ scope: SCOPE, project, runPlanId: project.runPlans[0]!.id, parts: [PART] });
    const preflight = deckOverride.compiles; // synchronous: a worker compiles only after its first await
    await Promise.all(batch.runIds.map(settled));
    expect({ total: batch.total, preflight }).toEqual({ total, preflight: analyses });
  });
});

describe("[SEC-1] POST /api/spice/models/smoke-test: the explicit environment and the same deck screens", () => {
  const smokeModel = () => importModelText("amp.lib", `${SUBCKT}${NL}`).candidate;
  async function smokeOutcome(model: ModelAsset) {
    const res = await smokePost(post("/api/spice/models/smoke-test", { model }));
    const body = await res.json() as { error?: string };
    return { status: res.status, closedError: closed(body.error), filesWritten: fsState.writes.length, ngspiceRuns: spawnState.calls.length };
  }

  it("a legitimate smoke test spawns ngspice with the allowlisted environment, never the inherited one", async () => {
    for (const name of CANARIES) vi.stubEnv(name, "sec1-canary");
    const outcome = await smokeOutcome(smokeModel());
    expect(outcome.ngspiceRuns, JSON.stringify(outcome)).toBe(1);
    expect(disallowedEnv(spawnState.calls[0]?.envKeys), "the smoke test's environment").toEqual([]);
    for (const name of CANARIES) expect(spawnState.calls[0]?.envKeys ?? []).not.toContain(name);
  });

  it.each(FORMS.map((form) => [form.name, form] as const))("a subcircuit name carrying %s is refused 422 (closed) before any file or process", async (_name, form) => {
    const model = smokeModel();
    model.subcircuitName = form.make("AMP");
    const outcome = await smokeOutcome(model);
    expect(outcome, JSON.stringify(outcome)).toEqual({ status: 422, closedError: true, filesWritten: 0, ngspiceRuns: 0 });
  });

  it("a model text '*#' command line is refused 422 (closed) before any file or process", async () => {
    const model = smokeModel();
    model.originalContent = [SUBCKT, `*# shell ${MARK}`].join(NL);
    const outcome = await smokeOutcome(model);
    expect(outcome, JSON.stringify(outcome)).toEqual({ status: 422, closedError: true, filesWritten: 0, ngspiceRuns: 0 });
  });

  // [SEC-1 round 3 review] tests-1: the model screen refuses only an ABSOLUTE `.include`/`.inc` and has no `.lib` rule, so the
  // smoke deck's final screen, run as an EXECUTED deck (smoke-test/route.ts), is the only guard against a file read (an included
  // control block RUNS, probe p7b); each request is refused before any file or process.
  it.each([ // [B22-A1, 2026-10-01] reviewed pin move: the model screen now refuses both first, closed (D22-4; was "the model screen admits it"); the outcome is unchanged, and the final screen's executed reading (the tests-1 breakage, `executed: false` at smoke-test/route.ts:119) stays pinned in b22-a1-model-screen with the model screen switched off
    ["a relative traversing .include", `.include ../../${MARK}.lib`],
    ["a .lib read", `.lib /${MARK}.lib tt`],
  ])("[round 3 review] model text with %s (the model screen refuses it first since B22-A1) is refused 422 (closed) before any file or process", async (_label, line) => {
    const model = smokeModel();
    model.originalContent = [SUBCKT, line].join(NL);
    expect(refusal(() => assertModelSafeForExecution(model)), "the model screen (B22-A1)").toBe("refused (closed)");
    const outcome = await smokeOutcome(model);
    expect(outcome, JSON.stringify(outcome)).toEqual({ status: 422, closedError: true, filesWritten: 0, ngspiceRuns: 0 });
  });

  it("a Windows (CRLF) model file still smoke-tests, and [review] the deck written is the deck screened: LF only", async () => {
    const model = importModelText("amp.lib", `${[".subckt AMP 1 2", "R1 1 2 1k", ".ends AMP"].join(C(13, 10))}${C(13, 10)}`).candidate;
    const outcome = await smokeOutcome(model);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ status: 200, ngspiceRuns: 1 });
    const written = fsState.writes.find((write) => write.path.endsWith("smoke.cir"))?.content ?? "";
    expect(written.includes(C(13)), "no CR reaches the written deck").toBe(false);
    expect(written).toContain([".subckt AMP 1 2", "R1 1 2 1k", ".ends AMP"].join(NL));
  });
});

describe("[SEC-1] the three ngspice spawners share one environment allowlist", () => {
  it("the worker, /api/simulate and the smoke test name the same keys, and [review] exactly these keys", () => {
    const allowlist = (path: string) => /const allowed = (\[[^\]]*\]);/.exec(readFileSync(join(process.cwd(), path), "utf8"))?.[1] ?? null;
    const worker = allowlist("app/lib/spice/server/worker.ts");
    expect(worker).toBe(SPAWN_ALLOWLIST);
    expect(allowlist("app/api/simulate/route.ts")).toBe(worker);
    expect(allowlist("app/api/spice/models/smoke-test/route.ts")).toBe(worker);
    expect([...JSON.parse(SPAWN_ALLOWLIST) as string[], "NODE_ENV"].sort()).toEqual([...ALLOWED_ENV].sort());
  });
});

describe("[SEC-1 review] the page records this suite's own counts", () => {
  it("every per-field count the page states is the suite's (coverage-1: it said 65 and 33)", () => {
    const page = readFileSync(join(process.cwd(), "artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md"), "utf8");
    const counts = (pattern: RegExp) => [...page.matchAll(pattern)].map((match) => Number(match[1]));
    const fields = counts(/\b(\d+) fields\b/g);
    const analysis = counts(/\b(\d+) analysis fields\b/g);
    expect(fields.length, "the page states the field count").toBeGreaterThan(0);
    expect(analysis.length, "the page states the analysis field count").toBeGreaterThan(0);
    expect(new Set(fields)).toEqual(new Set([FIELDS.length + ANALYSIS_FIELDS.length]));
    expect(new Set(analysis)).toEqual(new Set([ANALYSIS_FIELDS.length]));
  });
});

describe("[SEC-1 round 3 review] the page's record matches the round-3 tree", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const PAGE = "artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md";

  it("its pins into netlist.ts and models.ts land on the code they name (regressions-2, coverage-3, tests-5)", () => {
    const page = read(PAGE);
    const source = deckLines(read("app/lib/spice/netlist.ts"));
    const misplaced: string[] = [];
    for (const symbol of ["assertDeckText", "assertDeckInputsSafe", "DeckExpectation", "compiledDeckExpectation", "BANNER_LINE", "assertTitleSafe", "assertDeckLineSafe", "assertCompiledDeckSafe", "__deckLayersForTests"]) {
      const start = source.findIndex((line) => new RegExp(`^(?:export )?(?:function|const|interface) ${symbol}\\b`).test(line)) + 1;
      const end = /^(?:export )?const /.test(source[start - 1] ?? "") ? start : start + source.slice(start - 1).findIndex((line) => line === "}");
      const cited = [...page.matchAll(new RegExp(`\`${symbol}\`[^\`\\n]{0,12}\`(?:[\\w/.-]*netlist\\.ts)?:(\\d+)(?:-(\\d+))?\``, "g"))];
      if (start === 0) misplaced.push(`${symbol} is not declared in netlist.ts`);
      if (cited.length === 0) misplaced.push(`the page never cites ${symbol}`);
      for (const match of cited) {
        if (Number(match[1]) !== start || (match[2] !== undefined && Number(match[2]) !== end)) misplaced.push(`${match[0]} (declared :${start}-${end})`);
      }
    }
    const models = deckLines(read("app/lib/spice/models.ts"));
    const dotted = [...page.matchAll(/model\s+screen's own[\s\S]{0,80}?`models\.ts:(\d+)`/g)];
    if (dotted.length === 0) misplaced.push("the page never cites the model screen's dotted list");
    for (const match of dotted) if (!(models[Number(match[1]) - 1] ?? "").includes("shell|cd|source|quit")) misplaced.push(`${match[0]} (not the dotted list)`);
    expect(misplaced).toEqual([]);
  });

  it("it states the round-3 contract, one current suite size and the probes' provenance (regressions-1/3/4, coverage-1/2/4/5/6)", () => {
    const page = read(PAGE);
    const stale: Array<[string, RegExp]> = [
      ["the probes credited to the owner (the lead ran them)", /owner-run|run by the owner/i],
      ["round 1's suite size stated as the suite's", /The suite has \d+ cases/],
      ["the 13 command words listed as refused model text", /a line starting with each of the 13 command words/],
      ["the 12 command words listed as refused final-screen alterations", /the 12\s+command words other than `shell`\): red/],
      ["the compiler-card exemption stated as current", /passes only as the compiler's own card/],
      ["a form feed before a command word listed as still refused", /Still refused:[^.]*a command word/],
      ["a model `codemodel` line listed among the refused run requests", /a model `codemodel`\s+line, and a hostile value/],
      ["the `*#` title refusal stated as grounded by the probes", /one gap the review found; it is closed|`\*#`\s+title too \(red-on-revert/],
    ];
    const problems = stale.filter(([, pattern]) => pattern.test(page)).map(([label]) => `stale: ${label}`);
    const header = read("app/lib/spice/__tests__/sec-1-deck-injection.test.ts").split("*/")[0] ?? "";
    if (/command-word list is refused/.test(header)) problems.push("this suite's header states round 1's command-word contract");
    const sizes = [...new Set([...page.matchAll(/\((\d+) cases\)/g)].map((match) => Number(match[1])))];
    if (sizes.length !== 1) problems.push(`the page states ${sizes.length} current suite sizes: ${sizes.join(", ")}`);
    for (const match of page.matchAll(/(\d+) failed \/ (\d+) passed/g)) {
      if (Number(match[1]) + Number(match[2]) !== sizes[0]) problems.push(`'${match[0]}' is not a run of the ${sizes[0]}-case suite`);
    }
    for (const match of page.matchAll(/[Gg]reen (\d+)\/(\d+)/g)) {
      if (Number(match[1]) !== sizes[0] || Number(match[2]) !== sizes[0]) problems.push(`'${match[0]}' is not the ${sizes[0]}-case suite`);
    }
    const inferred = /Still INFERRED[^\n]*(?:\n(?![ \t]*- |[ \t]*\n)[^\n]*)*/.exec(page)?.[0] ?? "";
    if (!/`\*#` title/i.test(inferred)) problems.push("section 4's 'Still INFERRED' list does not name the `*#` title refusal");
    expect(problems).toEqual([]);
  });
});

// ─── [SEC-1 round 3] vendor element cards named like command words are devices, not commands (red on fe147c9) ─────────

/** A vendor subcircuit whose body holds element cards whose names spell ngspice command words the round-1 screen refused:
 *  Cd (capacitor), Load (inductor), Define (diode), Set/Source (voltage-controlled switches). The lead's probes p8/p8a/p8b
 *  parse and simulate each; a command runs only inside a `.control` block, a `*#` line or an `*ng_script` deck. */
const VENDOR = [
  ".subckt AMP 1 2",
  ".model DVEND D",
  ".model SVEND SW",
  "R1 1 2 1k",
  "Cd 1 2 1p",
  "Load 1 2 10u",
  "Define 1 2 DVEND",
  "Set 1 2 1 2 SVEND",
  "Source 1 2 1 2 SVEND",
  ".ends AMP",
].join(NL);
const VENDOR_CARDS = ["Cd 1 2 1p", "Load 1 2 10u", "Define 1 2 DVEND", "Set 1 2 1 2 SVEND", "Source 1 2 1 2 SVEND"];

describe("[SEC-1 round 3] vendor element cards named like command words compile, preview, smoke-test and run (the regression)", () => {
  it("the model screen admits the vendor subckt, and compile and the preview accept every command-word element card", () => {
    const project = baseProject();
    model0(project).originalContent = VENDOR;
    expect(() => assertModelSafeForExecution(model0(project)), "the existing model screen admits it").not.toThrow();
    expect(outcomeOf(() => compileWith(project)), "compile is a clean deck").toBe("compiled: clean deck");
    expect(() => previewOf(project), "the preview compiles").not.toThrow();
    const deck = deckLines(compileWith(project).executed);
    for (const card of VENDOR_CARDS) expect(deck, card).toContain(card);
  });

  it("the smoke test accepts the vendor subckt: 200 and one ngspice spawn (no refusal before the process)", async () => {
    const model = importModelText("amp.lib", `${SUBCKT}${NL}`).candidate;
    model.originalContent = VENDOR;
    const res = await smokePost(post("/api/spice/models/smoke-test", { model }));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(spawnState.calls.filter((call) => call.args[0] === "-b"), "ngspice spawned once").toHaveLength(1);
  });

  it("POST /api/spice/runs accepts the vendor subckt: 202, the deck written, ngspice spawned, no finding", async () => {
    const project = baseProject();
    model0(project).originalContent = VENDOR;
    const outcome = await routeOutcome(project);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ status: 202, jobs: 1, decksWritten: 1, deckFindings: [], ngspiceRuns: 1 });
  });
});

describe("[SEC-1 round 3] a command word outside an executing construct is a card, not a command (moved from refused)", () => {
  const EXECUTED = { controlBlock: true, executed: true };
  const legit = () => compileWith(baseProject()).executed;
  const beforeControl = (deck: string, extra: string[]) => {
    const all = deckLines(deck);
    all.splice(all.indexOf(".control"), 0, ...extra);
    return all.join(NL);
  };
  // The 13 command words the round-1 screen (COMMAND_LINE) refused outside the block. The probes show none runs there.
  const WORDS = ["cd /", `load /${MARK}.raw`, "quit", "define f(x) x", `codemodel /${MARK}.cm`, `source /${MARK}`, "set noaskquit", "alias q quit", `write /${MARK}.raw`, "unset noaskquit", "setcs x=1", "unsetcs x", `shell ${MARK}`];

  it.each(WORDS)("the final screen accepts a '%s' line before the control block (ngspice reads it as a card)", (line) => {
    expect(refusal(() => assertCompiledDeckSafe(beforeControl(legit(), [line]), EXECUTED)), line).toBe("accepted");
  });

  it.each(WORDS)("model text carrying a '%s' line compiles to a clean deck (the run and the preview)", (line) => {
    const project = baseProject();
    model0(project).originalContent = [SUBCKT, line].join(NL);
    expect(() => assertModelSafeForExecution(model0(project)), "the model screen admits it").not.toThrow();
    expect(outcomeOf(() => compileWith(project)), line).toBe("compiled: clean deck");
    expect(() => previewOf(project), line).not.toThrow();
  });

  it("a form feed before a command word is one card (the form feed is whitespace): the deck compiles", () => {
    const project = baseProject();
    model0(project).originalContent = [SUBCKT, `R2 1 2 1k${FF}shell ${MARK}`].join(NL);
    expect(() => compileWith(project), "production accepts the form-feed card").not.toThrow();
    // the form feed is a legacy page break (control character 12): the oracle flags it but no executing construct remains
    const findings = deckFindings(compileWith(project).executed).filter((finding) => !/control character 12/.test(finding));
    expect(findings, "no '*#', command block or file read — only the form-feed page break").toEqual([]);
  });

  it("a command line outside the block, and a form feed in the title, are accepted by the final screen", () => {
    expect(refusal(() => assertCompiledDeckSafe(beforeControl(legit(), [`shell ${MARK}`]), EXECUTED)), "command line outside the block").toBe("accepted");
    const titled = [`${deckLines(legit())[0]}${FF}shell ${MARK}`, ...deckLines(legit()).slice(1)].join(NL);
    expect(refusal(() => assertCompiledDeckSafe(titled, EXECUTED)), "a form feed in the title").toBe("accepted");
  });

  it("POST /api/spice/runs runs a model whose text carries a command-word element line: 202, the deck written, ngspice spawned", async () => {
    const project = baseProject();
    model0(project).originalContent = [SUBCKT, `codemodel /${MARK}.cm`, `shell ${MARK}`].join(NL);
    const outcome = await routeOutcome(project);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ status: 202, jobs: 1, decksWritten: 1, deckFindings: [], ngspiceRuns: 1 });
  });
});
