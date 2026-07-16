import { createId } from "./identity";
import { sourceForNetlistLine } from "./netlist";
import type { Diagnostic, DiagnosticCode, NetlistBundle, SolverProfile } from "./types";

interface PatternDefinition {
  code: DiagnosticCode;
  pattern: RegExp;
  title: string;
  summary: string;
}

const PATTERNS: PatternDefinition[] = [
  { code: "singular-matrix", pattern: /singular matrix|matrix is singular|check nodes?\s+\S+\s+and\s+\S+/i, title: "Singular circuit matrix", summary: "ngspice could not establish a unique voltage/current solution, usually because a node is floating or an ideal constraint is contradictory." },
  { code: "timestep-too-small", pattern: /timestep too small|time step too small/i, title: "Transient timestep collapsed", summary: "The transient solver repeatedly reduced its timestep without finding a converged state." },
  { code: "dc-operating-point-failed", pattern: /doAnalyses: OP.*failed|operating point.*failed|dcop.*failed/i, title: "DC operating point failed", summary: "ngspice could not find the initial nonlinear operating point required by this analysis." },
  { code: "newton-nonconvergence", pattern: /newton-raphson.*failed|no convergence|iteration limit reached|convergence problem/i, title: "Newton iteration did not converge", summary: "The nonlinear device equations did not settle within the configured iteration budget." },
  { code: "model-not-found", pattern: /could not find a model named|unknown model|model .* not found|can't find model/i, title: "Simulation model not found", summary: "A device references a model name that was not packaged into the executed netlist." },
  { code: "subckt-pin-count", pattern: /too (?:few|many) parameters for subcircuit|mismatch.*subckt|subckt.*(?:pin|port).*count|unknown subckt/i, title: "Subcircuit interface mismatch", summary: "The model call does not match the subcircuit name or external pin count." },
  { code: "unknown-parameter", pattern: /unknown parameter|unrecognized parameter|Undefined parameter|can't evaluate parameter/i, title: "Unknown model or circuit parameter", summary: "A parameter expression references a missing name or unsupported parameter." },
  { code: "unsupported-syntax", pattern: /syntax error|unknown device type|unimplemented control card|warning:.*unsupported/i, title: "Unsupported model syntax", summary: "The model or custom directive uses syntax that this ngspice build does not accept." },
  { code: "numeric-overflow", pattern: /overflow|underflow|nan detected|floating point exception/i, title: "Numerical overflow or underflow", summary: "An equation exceeded the numerical range or produced a non-finite value." },
  { code: "excessive-output", pattern: /no space left|file size limit|too many data points|out of memory/i, title: "Simulation output exceeded a resource limit", summary: "The run generated more waveform data than the worker could safely retain." },
  { code: "discontinuous-expression", pattern: /discontinuity|non-differentiable|behavioral source.*converg/i, title: "Discontinuous behavioral expression", summary: "A behavioral source changes too abruptly for stable Newton iteration." },
  { code: "ideal-topology", pattern: /voltage source loop|inductor loop|current source cutset/i, title: "Unrealistic ideal-element topology", summary: "An all-ideal loop or cutset prevents a unique physical solution." },
  { code: "timeout", pattern: /timed?\s*out|timeout/i, title: "Simulation exceeded runtime limit", summary: "The worker stopped the run after its configured deadline." },
  { code: "cancelled", pattern: /cancelled|canceled|terminated by user/i, title: "Simulation cancelled", summary: "The run was stopped before completion." },
];

function lineFromExcerpt(excerpt: string): number | undefined {
  const patterns = [/(?:line|at line)\s+(\d+)/i, /Error on line\s+(\d+)/i, /^\s*(\d+)\s*:/m];
  for (const pattern of patterns) {
    const match = excerpt.match(pattern);
    if (match) return Number.parseInt(match[1], 10);
  }
  return undefined;
}

function suggestions(code: DiagnosticCode): Diagnostic["suggestions"] {
  const inspect = { order: 1, label: "Inspect topology and model mapping", kind: "inspection" as const, explanation: "Resolve physical connectivity and model-interface problems before relaxing numerical tolerances." };
  switch (code) {
    case "singular-matrix":
      return [
        inspect,
        { order: 2, label: "Add realistic leakage paths", kind: "physical", explanation: "Add justified high-value resistance from otherwise floating capacitive nodes to a reference." },
        { order: 3, label: "Enable GMIN stepping", kind: "numerical", explanation: "Use a disclosed conductance-stepping retry after topology is confirmed.", solverPatch: { gminStepping: true } },
      ];
    case "timestep-too-small":
      return [
        inspect,
        { order: 2, label: "Add source and reactive-element ESR", kind: "physical", explanation: "Real sources, capacitors, and inductors have non-zero impedance that damps impossible instantaneous transitions." },
        { order: 3, label: "Constrain maximum timestep", kind: "numerical", explanation: "Resolve switching events explicitly; this can increase runtime and does not change circuit topology." },
        { order: 4, label: "Try Gear integration", kind: "numerical", explanation: "Gear can damp stiff switching systems but may numerically suppress ringing.", solverPatch: { method: "gear", maxord: 2 } },
      ];
    case "dc-operating-point-failed":
    case "newton-nonconvergence":
      return [
        inspect,
        { order: 2, label: "Enable source stepping", kind: "numerical", explanation: "Ramp independent sources from zero to their operating values.", solverPatch: { sourceStepping: true } },
        { order: 3, label: "Enable GMIN stepping", kind: "numerical", explanation: "Temporarily add conductance during the solve and remove it as convergence improves.", solverPatch: { gminStepping: true } },
        { order: 4, label: "Increase DC iteration limit", kind: "numerical", explanation: "Allow more Newton iterations without weakening the convergence criteria.", solverPatch: { itl1: 500 } },
      ];
    case "model-not-found":
    case "subckt-pin-count":
    case "unknown-parameter":
    case "unsupported-syntax":
      return [
        inspect,
        { order: 2, label: "Review model import report", kind: "inspection", explanation: "Verify subcircuit selection, dependency packaging, dialect, external pins, and every compatibility patch." },
        { order: 3, label: "Run isolated model smoke test", kind: "inspection", explanation: "Exercise the model in a minimal fixture before returning it to the production testbench." },
      ];
    case "numeric-overflow":
    case "discontinuous-expression":
      return [
        inspect,
        { order: 2, label: "Limit ideal behavioral discontinuities", kind: "physical", explanation: "Use smooth transitions or realistic slew where it represents the device." },
        { order: 3, label: "Tighten event timestep", kind: "numerical", explanation: "Capture the transition with smaller steps without changing the intended model." },
      ];
    case "ideal-topology":
      return [
        inspect,
        { order: 2, label: "Add physically justified impedance", kind: "physical", explanation: "Represent source resistance, capacitor ESR, inductor DCR, or switch on-resistance." },
      ];
    case "excessive-output":
      return [
        { order: 1, label: "Reduce saved vectors", kind: "inspection", explanation: "Save only signals required by plots, measurements, and specifications." },
        { order: 2, label: "Increase output interval", kind: "numerical", explanation: "Store fewer transient points while preserving a sufficiently small solver max-step." },
      ];
    case "timeout":
      return [
        inspect,
        { order: 2, label: "Inspect progress before extending runtime", kind: "inspection", explanation: "A longer timeout is justified only when the solver is making useful progress." },
      ];
    case "cancelled":
      return [];
    case "unknown":
      return [inspect, { order: 2, label: "Open complete simulator log", kind: "inspection", explanation: "Review the first error and its generated-netlist source mapping." }];
  }
}

function excerpts(log: string, pattern: RegExp): string[] {
  const lines = log.split(/\r?\n/);
  const hits: string[] = [];
  lines.forEach((line, index) => {
    pattern.lastIndex = 0;
    if (!pattern.test(line)) return;
    hits.push(lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join("\n").trim());
  });
  return [...new Set(hits)].slice(0, 5);
}

export function diagnoseNgspiceLog(log: string, netlist?: NetlistBundle): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const definition of PATTERNS) {
    for (const excerpt of excerpts(log, definition.pattern)) {
      const line = lineFromExcerpt(excerpt);
      diagnostics.push({
        id: createId("diag"),
        code: definition.code,
        severity: definition.code === "cancelled" ? "info" : "error",
        title: definition.title,
        summary: definition.summary,
        rawExcerpt: excerpt.slice(0, 2000),
        netlistLine: line,
        sourceRefs: line && netlist ? sourceForNetlistLine(netlist, line) : [],
        suggestions: suggestions(definition.code),
      });
    }
  }
  if (diagnostics.length === 0 && log.trim()) {
    diagnostics.push({
      id: createId("diag"),
      code: "unknown",
      severity: "error",
      title: "ngspice reported an unclassified failure",
      summary: "The complete log is preserved. No known diagnostic pattern matched the first failure.",
      rawExcerpt: log.slice(-3000),
      sourceRefs: [],
      suggestions: suggestions("unknown"),
    });
  }
  return diagnostics;
}

export interface ConvergenceRetry {
  index: number;
  name: string;
  profile: SolverProfile;
  disclosure: string;
  numericalOnly: boolean;
}

export function convergenceRetryLadder(base: SolverProfile): ConvergenceRetry[] {
  return [
    { index: 0, name: "Original settings", profile: structuredClone(base), disclosure: "No numerical changes.", numericalOnly: true },
    { index: 1, name: "Source stepping", profile: { ...base, sourceStepping: true, itl1: Math.max(base.itl1 ?? 100, 250) }, disclosure: "Independent sources are ramped during the operating-point solve.", numericalOnly: true },
    { index: 2, name: "GMIN stepping", profile: { ...base, sourceStepping: true, gminStepping: true, gmin: Math.max(base.gmin ?? 1e-12, 1e-12), itl1: Math.max(base.itl1 ?? 100, 350) }, disclosure: "Temporary conductance assists the nonlinear operating-point solve.", numericalOnly: true },
    { index: 3, name: "Stiff-system integration", profile: { ...base, sourceStepping: true, gminStepping: true, method: "gear", maxord: 2, itl4: Math.max(base.itl4 ?? 50, 150) }, disclosure: "Gear-2 integration adds numerical damping; ringing must be compared against the original method.", numericalOnly: true },
    { index: 4, name: "Relaxed tolerance diagnostic", profile: { ...base, sourceStepping: true, gminStepping: true, reltol: Math.max(base.reltol ?? 1e-3, 3e-3), abstol: Math.max(base.abstol ?? 1e-12, 1e-10), vntol: Math.max(base.vntol ?? 1e-6, 1e-5), itl1: 500, itl4: 250 }, disclosure: "Solver tolerances are relaxed. Treat results as diagnostic and never equivalent to the original run without comparison.", numericalOnly: true },
  ];
}
