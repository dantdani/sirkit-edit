import { llmRouter } from "@/app/lib/llm/router";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import {
  assistantResponseMessage,
  toolResultsMessage,
  type LLMMessage,
  type LLMTool,
} from "@/app/lib/llm/types";
import { createId, nowIso } from "@/app/lib/spice/identity";
import { createDefaultTest } from "@/app/lib/spice/project";
import { auditSimulationReadiness } from "@/app/lib/spice/readiness";
import { compareRunRecords } from "@/app/lib/spice/report";
import { estimateRunPlan } from "@/app/lib/spice/run-plan";
import { searchModels } from "@/app/lib/spice/models";
import type {
  AiStudioOperation,
  AiStudioProposal,
  ApprovalLevel,
  Corner,
  EvidenceRef,
  Measurement,
  ModelBinding,
  OverlayElement,
  RunRecord,
  SimulationAnalysis,
  SimulationPartSnapshot,
  SimulationProject,
  Specification,
  Sweep,
} from "@/app/lib/spice/types";

export const runtime = "nodejs";

const MAX_ITERATIONS = 18;

type JsonObject = Record<string, unknown>;

const TOOL_SCHEMAS: LLMTool[] = [
  { name: "inspect_schematic", description: "Inspect the immutable design revision, components, nets, and current simulation setup.", inputSchema: { type: "object", properties: {} } },
  { name: "audit_simulation_readiness", description: "Run the deterministic readiness audit and return blocking errors, warnings, and fixes.", inputSchema: { type: "object", properties: { test_id: { type: "string" } } } },
  { name: "search_models", description: "Search governed simulation models by query and validation constraints.", inputSchema: { type: "object", properties: { query: { type: "string" }, category: { type: "string" }, trusted_only: { type: "boolean" } }, required: ["query"] } },
  { name: "assign_model", description: "Propose assigning a governed model and explicit symbol-to-model pin map. Review is always required.", inputSchema: { type: "object", properties: { component_id: { type: "string" }, model_id: { type: "string" }, pin_map: { type: "object", additionalProperties: { type: "string" } }, confidence: { type: "number", minimum: 0, maximum: 1 }, rationale: { type: "string" } }, required: ["component_id", "model_id", "pin_map", "confidence", "rationale"] } },
  { name: "create_test", description: "Propose a named, non-destructive simulation test overlay.", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name"] } },
  { name: "add_overlay_element", description: "Propose a simulation-only source, load, probe, initial condition, or fault.", inputSchema: { type: "object", properties: { test_id: { type: "string" }, kind: { type: "string", enum: ["voltage-source", "current-source", "resistive-load", "capacitive-load", "inductive-load", "probe", "initial-condition", "fault"] }, name: { type: "string" }, positive_net: { type: "string" }, negative_net: { type: "string" }, target_net: { type: "string" }, value: { type: "string" }, waveform: { type: "string" }, quantity: { type: "string", enum: ["voltage", "current", "power"] }, fault: { type: "string", enum: ["open", "short", "stuck-high", "stuck-low"] }, rationale: { type: "string" } }, required: ["test_id", "kind", "name", "rationale"] } },
  { name: "set_design_variable", description: "Propose a unit-aware design variable and optional bounds/tolerance distribution.", inputSchema: { type: "object", properties: { test_id: { type: "string" }, name: { type: "string" }, value: { type: "string" }, unit: { type: "string" }, description: { type: "string" }, min: { type: "string" }, max: { type: "string" }, distribution: { type: "object" } }, required: ["test_id", "name", "value", "unit"] } },
  { name: "configure_analysis", description: "Propose an operating-point, DC, AC, transient, or noise analysis using structured fields.", inputSchema: { type: "object", properties: { test_id: { type: "string" }, name: { type: "string" }, type: { type: "string", enum: ["op", "dc", "ac", "tran", "noise"] }, source: { type: "string" }, start: { type: "string" }, stop: { type: "string" }, step: { type: "string" }, scale: { type: "string", enum: ["dec", "oct", "lin"] }, points: { type: "integer" }, start_frequency: { type: "string" }, stop_frequency: { type: "string" }, output_step: { type: "string" }, stop_time: { type: "string" }, max_step: { type: "string" }, output: { type: "string" }, input_source: { type: "string" }, rationale: { type: "string" } }, required: ["test_id", "name", "type", "rationale"] } },
  { name: "configure_sweep", description: "Propose a linear, logarithmic, or list sweep over a named design variable.", inputSchema: { type: "object", properties: { test_id: { type: "string" }, name: { type: "string" }, variable: { type: "string" }, kind: { type: "string", enum: ["linear", "log", "list"] }, start: { type: "string" }, stop: { type: "string" }, step: { type: "string" }, points_per_decade: { type: "integer" }, values: { type: "array", items: { type: "string" } } }, required: ["test_id", "name", "variable", "kind"] } },
  { name: "configure_corner_set", description: "Propose named supply, component, temperature, or model corners.", inputSchema: { type: "object", properties: { test_id: { type: "string" }, name: { type: "string" }, corners: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "object", additionalProperties: { type: "string" } }, temperature_c: { type: "number" } }, required: ["name", "values"] } } }, required: ["test_id", "name", "corners"] } },
  { name: "define_measurement", description: "Propose a typed engineering measurement tied to actual saved signals.", inputSchema: { type: "object", properties: { test_id: { type: "string" }, name: { type: "string" }, operator: { type: "string" }, expression: { type: "string" }, secondary_expression: { type: "string" }, unit: { type: "string" }, from: { type: "string" }, to: { type: "string" }, at: { type: "string" }, threshold: { type: "number" }, tolerance: { type: "number" }, description: { type: "string" } }, required: ["test_id", "name", "operator", "expression"] } },
  { name: "define_specification", description: "Propose pass/fail logic around a previously defined measurement.", inputSchema: { type: "object", properties: { test_id: { type: "string" }, name: { type: "string" }, measurement_name: { type: "string" }, comparison: { type: "string", enum: ["<", "<=", ">", ">=", "between", "outside"] }, limit: { type: "number" }, upper_limit: { type: "number" }, unit: { type: "string" }, severity: { type: "string", enum: ["warning", "error"] } }, required: ["test_id", "name", "measurement_name", "comparison", "limit", "unit", "severity"] } },
  { name: "estimate_run_plan", description: "Expand the structured run plan and return exact run count, cost estimate, and warnings.", inputSchema: { type: "object", properties: { run_plan_id: { type: "string" } }, required: ["run_plan_id"] } },
  { name: "run_simulation", description: "Propose executing a run plan. The user still sees and approves the structured proposal.", inputSchema: { type: "object", properties: { run_plan_id: { type: "string" }, rationale: { type: "string" } }, required: ["run_plan_id", "rationale"] } },
  { name: "read_results", description: "Read actual run scalars and signal ranges. Using this tool creates evidence references for conclusions.", inputSchema: { type: "object", properties: { run_id: { type: "string" }, signals: { type: "array", items: { type: "string" } } }, required: ["run_id"] } },
  { name: "diagnose_failure", description: "Read structured diagnostics, logs, and source mappings for a failed run.", inputSchema: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"] } },
  { name: "compare_runs", description: "Compare scalar results, statuses, analyses, and model checksums across two runs.", inputSchema: { type: "object", properties: { run_a: { type: "string" }, run_b: { type: "string" } }, required: ["run_a", "run_b"] } },
  { name: "propose_design_patch", description: "Propose—but never apply—a production schematic change grounded in result evidence. Explicit confirmation is required.", inputSchema: { type: "object", properties: { description: { type: "string" }, changes: { type: "array", items: { type: "object" } } }, required: ["description", "changes"] } },
  { name: "ask_user", description: "Ask one concise question when a safety-critical requirement is ambiguous.", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
  { name: "submit_proposal", description: "Finish by presenting the recorded typed operations for review, with assumptions and uncertainty.", inputSchema: { type: "object", properties: { summary: { type: "string" }, rationale: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, assumptions: { type: "array", items: { type: "string" } }, uncertainty: { type: "string" } }, required: ["summary", "rationale", "confidence", "assumptions"] } },
];

const SYSTEM_PROMPT = `You are Sirkit SPICE Studio's simulation engineer. Work only through the typed tools. Inspect the schematic and run the deterministic readiness audit before proposing setup. Do not invent nets, components, models, signals, measurements, or result values. Testbench elements are overlays; never mutate the production schematic. Model assignments, pin maps, analyses, distributions, and solver changes require review. Production component or topology changes require explicit confirmation. Before any claim about results, call read_results, diagnose_failure, or compare_runs; the gateway attaches evidence. State uncertainty when models are approximate or unverified. Build the smallest technically sufficient setup, record operations with tools, then call submit_proposal.`;

function object(input: unknown): JsonObject {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Tool input must be an object");
  return input as JsonObject;
}

function string(input: JsonObject, key: string, required = true): string {
  const value = input[key];
  if (typeof value !== "string" || (required && value.trim() === "")) throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

function number(input: JsonObject, key: string, fallback?: number): number {
  const value = input[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
}

function activeTest(project: SimulationProject, id: string) {
  const test = project.tests.find((candidate) => candidate.id === id);
  if (!test) throw new Error(`Test ${id} was not found`);
  return test;
}

function approvalFor(operation: AiStudioOperation): ApprovalLevel {
  if (operation.op === "assign-model" || operation.op === "configure-analysis" || operation.op === "configure-sweep" || operation.op === "configure-corners" || operation.op === "set-solver-profile") return "review";
  if (operation.op === "propose-design-patch") return "explicit";
  return "automatic";
}

function schematicDigest(project: SimulationProject, parts: SimulationPartSnapshot[]) {
  const design = project.designRevisions.find((candidate) => candidate.id === project.activeDesignRevisionId)!;
  const partMap = new Map(parts.map((part) => [part.id, part]));
  return {
    design: { id: design.id, revision: design.revision, checksum: design.schematicHash },
    theoryComponents: design.schematic.components.map((component) => ({ id: component.id, type: component.type, value: component.value })),
    catalogComponents: (design.schematic.kicadComponents ?? []).map((component) => ({ id: component.id, ref: component.refDes, value: component.value, part: partMap.get(component.partId)?.name ?? component.partId, pins: partMap.get(component.partId)?.pins.map((pin) => ({ number: pin.number, name: pin.name, type: pin.type })) ?? [] })),
    netLabels: (design.schematic.netLabels ?? []).map((label) => label.name),
    wires: design.schematic.wires.length,
    tests: project.tests.map((test) => ({ id: test.id, name: test.name, analyses: test.analyses.map((analysis) => analysis.type), measurements: test.measurements.map((measurement) => measurement.name), specifications: test.specifications.map((specification) => specification.name) })),
    runPlans: project.runPlans.map((plan) => ({ id: plan.id, name: plan.name, tests: plan.testIds })),
  };
}

function analysisOperation(raw: JsonObject): Extract<AiStudioOperation, { op: "configure-analysis" }> {
  const testId = string(raw, "test_id");
  const name = string(raw, "name");
  const type = string(raw, "type") as SimulationAnalysis["type"];
  const base = { id: createId("analysis"), name, enabled: true };
  let analysis: SimulationAnalysis;
  if (type === "op") analysis = { ...base, type };
  else if (type === "tran") analysis = { ...base, type, outputStep: string(raw, "output_step"), stopTime: string(raw, "stop_time"), maxStep: typeof raw.max_step === "string" ? raw.max_step : undefined };
  else if (type === "ac") analysis = { ...base, type, scale: string(raw, "scale") as "dec" | "oct" | "lin", points: number(raw, "points"), startFrequency: string(raw, "start_frequency"), stopFrequency: string(raw, "stop_frequency") };
  else if (type === "dc") analysis = { ...base, type, source: string(raw, "source"), start: string(raw, "start"), stop: string(raw, "stop"), step: string(raw, "step") };
  else if (type === "noise") analysis = { ...base, type, output: string(raw, "output"), inputSource: string(raw, "input_source"), scale: string(raw, "scale") as "dec" | "oct" | "lin", points: number(raw, "points"), startFrequency: string(raw, "start_frequency"), stopFrequency: string(raw, "stop_frequency") };
  else throw new Error(`Unsupported AI analysis type ${type}`);
  return { op: "configure-analysis", testId, analysis };
}

function overlayOperation(raw: JsonObject): Extract<AiStudioOperation, { op: "add-overlay-element" }> {
  const testId = string(raw, "test_id");
  const kind = string(raw, "kind");
  const common = { id: createId("overlayel"), name: string(raw, "name"), enabled: true };
  const net = (name: string) => ({ kind: "net" as const, net: string(raw, name) });
  let element: OverlayElement;
  if (["voltage-source", "current-source"].includes(kind)) {
    element = { ...common, kind: kind as "voltage-source" | "current-source", positive: net("positive_net"), negative: net("negative_net"), value: string(raw, "value"), waveform: typeof raw.waveform === "string" ? raw.waveform : undefined };
  } else if (["resistive-load", "capacitive-load", "inductive-load"].includes(kind)) {
    element = { ...common, kind: kind as "resistive-load" | "capacitive-load" | "inductive-load", positive: net("positive_net"), negative: net("negative_net"), value: string(raw, "value") };
  } else if (kind === "probe") {
    element = { ...common, kind, target: net("target_net"), quantity: string(raw, "quantity") as "voltage" | "current" | "power" };
  } else if (kind === "initial-condition") {
    element = { ...common, kind, target: net("target_net"), value: string(raw, "value") };
  } else if (kind === "fault") {
    element = { ...common, kind, target: net("target_net"), fault: string(raw, "fault") as "open" | "short" | "stuck-high" | "stuck-low", resistance: typeof raw.value === "string" ? raw.value : undefined };
  } else throw new Error(`Unsupported overlay kind ${kind}`);
  return { op: "add-overlay-element", testId, element };
}

function sweepOperation(raw: JsonObject): Extract<AiStudioOperation, { op: "configure-sweep" }> {
  const kind = string(raw, "kind");
  const sweep: Sweep = { id: createId("sweep"), name: string(raw, "name"), variable: string(raw, "variable"), enabled: true, definition: kind === "linear"
    ? { kind, start: string(raw, "start"), stop: string(raw, "stop"), step: string(raw, "step") }
    : kind === "log"
      ? { kind, start: string(raw, "start"), stop: string(raw, "stop"), pointsPerDecade: number(raw, "points_per_decade") }
      : { kind: "list", values: Array.isArray(raw.values) && raw.values.every((value) => typeof value === "string") ? raw.values : (() => { throw new Error("values must be a string array"); })() } };
  return { op: "configure-sweep", testId: string(raw, "test_id"), sweep };
}

function measurementOperation(raw: JsonObject): Extract<AiStudioOperation, { op: "define-measurement" }> {
  const operator = string(raw, "operator") as Measurement["operator"];
  const allowed: Measurement["operator"][] = ["min", "max", "average", "rms", "peak-to-peak", "integral", "derivative", "value-at", "crossing", "rise-time", "fall-time", "propagation-delay", "pulse-width", "duty-cycle", "overshoot", "undershoot", "settling-time", "slew-rate", "gain", "phase", "bandwidth", "unity-gain-frequency", "gain-margin", "phase-margin", "impedance", "ripple", "average-power", "peak-power", "energy", "thd", "integrated-noise", "formula"];
  if (!allowed.includes(operator)) throw new Error(`Unsupported measurement operator ${operator}`);
  const measurement: Measurement = {
    id: createId("measurement"), name: string(raw, "name"), operator, expression: string(raw, "expression"),
    secondaryExpression: typeof raw.secondary_expression === "string" ? raw.secondary_expression : undefined,
    unit: typeof raw.unit === "string" ? raw.unit : undefined, from: typeof raw.from === "string" ? raw.from : undefined,
    to: typeof raw.to === "string" ? raw.to : undefined, at: typeof raw.at === "string" ? raw.at : undefined,
    threshold: typeof raw.threshold === "number" ? raw.threshold : undefined, tolerance: typeof raw.tolerance === "number" ? raw.tolerance : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined, enabled: true,
  };
  return { op: "define-measurement", testId: string(raw, "test_id"), measurement };
}

export async function POST(req: Request): Promise<Response> {
  let body: { instruction?: string; project?: SimulationProject; testId?: string; parts?: SimulationPartSnapshot[]; runs?: RunRecord[]; provider?: unknown };
  try { body = await req.json() as typeof body; } catch { return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.project || typeof body.instruction !== "string" || body.instruction.trim() === "") return Response.json({ ok: false, error: "instruction and project are required" }, { status: 400 });
  const project = body.project;
  const parts = body.parts ?? [];
  const runs = body.runs ?? [];
  const operations: Array<{ approval: ApprovalLevel; operation: AiStudioOperation }> = [];
  const evidence: EvidenceRef[] = [];
  const provider = requestedProvider(body.provider);
  const messages: LLMMessage[] = [{ role: "user", content: `Current selected test: ${body.testId ?? "none"}\nUser request: ${body.instruction.trim()}` }];
  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const response = await llmRouter.generate({ provider, maxTokens: 4096, temperature: 0, system: SYSTEM_PROMPT, tools: TOOL_SCHEMAS, toolChoice: "required", messages, schematicState: schematicDigest(project, parts), userRequest: body.instruction.trim() });
      const tool = response.toolCalls[0];
      if (!tool) throw new Error("AI did not call a typed simulation tool");
      const raw = object(tool.input);
      let toolResult: unknown;
      if (tool.name === "inspect_schematic") toolResult = schematicDigest(project, parts);
      else if (tool.name === "audit_simulation_readiness") {
        const testId = typeof raw.test_id === "string" ? raw.test_id : body.testId ?? project.tests[0]?.id;
        if (!testId) throw new Error("No test is available for readiness audit");
        toolResult = auditSimulationReadiness({ project, testId, parts }).report;
      } else if (tool.name === "search_models") {
        toolResult = searchModels(project.modelAssets, string(raw, "query"), { category: typeof raw.category === "string" ? raw.category : undefined, trustedOnly: raw.trusted_only === true }).slice(0, 12).map((model) => ({ id: model.id, name: model.name, version: model.version, manufacturer: model.manufacturer, mpn: model.mpn, pins: model.externalPins, provenance: model.provenance, status: model.validationStatus, warnings: model.warnings }));
      } else if (tool.name === "assign_model") {
        const modelId = string(raw, "model_id");
        if (!project.modelAssets.some((model) => model.id === modelId)) throw new Error(`Model ${modelId} was not found`);
        const pinMapRaw = object(raw.pin_map);
        const binding: ModelBinding = { id: createId("binding"), componentId: string(raw, "component_id"), modelId, pinMap: Object.fromEntries(Object.entries(pinMapRaw).map(([key, value]) => [key, String(value)])), parameterOverrides: {}, confidence: number(raw, "confidence"), assignedBy: "ai", reviewed: false, createdAt: nowIso() };
        const operation: AiStudioOperation = { op: "assign-model", binding }; operations.push({ approval: approvalFor(operation), operation }); toolResult = { recorded: true, approval: "review" };
      } else if (tool.name === "create_test") {
        const test = createDefaultTest(project.activeDesignRevisionId); test.name = string(raw, "name"); test.description = typeof raw.description === "string" ? raw.description : undefined;
        const operation: AiStudioOperation = { op: "create-test", test }; operations.push({ approval: approvalFor(operation), operation }); toolResult = { recorded: true, test_id: test.id };
      } else if (tool.name === "add_overlay_element") {
        const operation = overlayOperation(raw); activeTest(project, operation.testId); operations.push({ approval: approvalFor(operation), operation }); toolResult = { recorded: true, element_id: operation.element.id };
      } else if (tool.name === "set_design_variable") {
        const testId = string(raw, "test_id"); activeTest(project, testId);
        const operation: AiStudioOperation = { op: "set-variable", testId, variable: { id: createId("variable"), name: string(raw, "name"), value: string(raw, "value"), unit: string(raw, "unit", false), description: typeof raw.description === "string" ? raw.description : undefined, min: typeof raw.min === "string" ? raw.min : undefined, max: typeof raw.max === "string" ? raw.max : undefined, distribution: typeof raw.distribution === "object" && raw.distribution !== null ? raw.distribution as never : undefined, enabled: true } };
        operations.push({ approval: raw.distribution ? "review" : "automatic", operation }); toolResult = { recorded: true };
      } else if (tool.name === "configure_analysis") {
        const operation = analysisOperation(raw); activeTest(project, operation.testId); operations.push({ approval: approvalFor(operation), operation }); toolResult = { recorded: true, analysis_id: operation.analysis.id, approval: "review" };
      } else if (tool.name === "configure_sweep") {
        const operation = sweepOperation(raw); activeTest(project, operation.testId); operations.push({ approval: approvalFor(operation), operation }); toolResult = { recorded: true, sweep_id: operation.sweep.id };
      } else if (tool.name === "configure_corner_set") {
        const testId = string(raw, "test_id"); activeTest(project, testId);
        if (!Array.isArray(raw.corners)) throw new Error("corners must be an array");
        const corners: Corner[] = raw.corners.map((entry) => { const item = object(entry); return { id: createId("corner"), name: string(item, "name"), variableValues: Object.fromEntries(Object.entries(object(item.values)).map(([key, value]) => [key, String(value)])), modelSections: {}, temperatureC: typeof item.temperature_c === "number" ? item.temperature_c : undefined, enabled: true }; });
        const operation: AiStudioOperation = { op: "configure-corners", testId, cornerSet: { id: createId("cornerset"), name: string(raw, "name"), corners, mode: "listed", enabled: true } };
        operations.push({ approval: approvalFor(operation), operation }); toolResult = { recorded: true, corner_set_id: operation.cornerSet.id };
      } else if (tool.name === "define_measurement") {
        const operation = measurementOperation(raw); activeTest(project, operation.testId); operations.push({ approval: approvalFor(operation), operation }); toolResult = { recorded: true, measurement_id: operation.measurement.id };
      } else if (tool.name === "define_specification") {
        const testId = string(raw, "test_id"); const test = activeTest(project, testId); const name = string(raw, "measurement_name");
        const pendingMeasurement = operations.map((entry) => entry.operation).find((operation): operation is Extract<AiStudioOperation, { op: "define-measurement" }> => operation.op === "define-measurement" && operation.testId === testId && operation.measurement.name === name)?.measurement;
        const measurement = pendingMeasurement ?? test.measurements.find((candidate) => candidate.name === name);
        if (!measurement) throw new Error(`Measurement ${name} was not found`);
        const specification: Specification = { id: createId("spec"), name: string(raw, "name"), measurementId: measurement.id, comparison: string(raw, "comparison") as Specification["comparison"], limit: number(raw, "limit"), upperLimit: typeof raw.upper_limit === "number" ? raw.upper_limit : undefined, unit: string(raw, "unit", false), severity: string(raw, "severity") as "warning" | "error", applicableTestIds: [testId], enabled: true };
        const operation: AiStudioOperation = { op: "define-specification", testId, specification }; operations.push({ approval: approvalFor(operation), operation }); toolResult = { recorded: true, specification_id: specification.id };
      } else if (tool.name === "estimate_run_plan") toolResult = estimateRunPlan(project, string(raw, "run_plan_id"));
      else if (tool.name === "run_simulation") {
        const runPlanId = string(raw, "run_plan_id"); estimateRunPlan(project, runPlanId); const operation: AiStudioOperation = { op: "request-run", runPlanId }; operations.push({ approval: "automatic", operation }); toolResult = { recorded: true, note: "Execution begins only after the user applies this proposal." };
      } else if (tool.name === "read_results") {
        const run = runs.find((candidate) => candidate.id === string(raw, "run_id")); if (!run) throw new Error("Run was not found in supplied evidence set");
        const requested = Array.isArray(raw.signals) ? raw.signals.filter((item): item is string => typeof item === "string") : [];
        const waveforms = run.waveforms.filter((waveform) => requested.length === 0 || requested.includes(waveform.name)).slice(0, 20).map((waveform) => ({ name: waveform.name, unit: waveform.unit, points: waveform.y.length, min: Math.min(...waveform.y), max: Math.max(...waveform.y), from: waveform.x[0], to: waveform.x.at(-1) }));
        for (const scalar of run.scalars) evidence.push({ runId: run.id, testId: run.testId, measurementId: scalar.measurementId, value: scalar.value, unit: scalar.unit });
        for (const waveform of waveforms) evidence.push({ runId: run.id, testId: run.testId, signal: waveform.name, from: waveform.from, to: waveform.to });
        toolResult = { run: { id: run.id, label: run.label, status: run.status }, scalars: run.scalars, waveforms };
      } else if (tool.name === "diagnose_failure") {
        const run = runs.find((candidate) => candidate.id === string(raw, "run_id")); if (!run) throw new Error("Run was not found in supplied evidence set");
        for (const diagnostic of run.diagnostics) evidence.push({ runId: run.id, testId: run.testId, diagnosticId: diagnostic.id });
        toolResult = { run: { id: run.id, status: run.status, error: run.error }, diagnostics: run.diagnostics, logTail: `${run.stderr}\n${run.stdout}`.slice(-5000) };
      } else if (tool.name === "compare_runs") {
        const a = runs.find((candidate) => candidate.id === string(raw, "run_a")); const b = runs.find((candidate) => candidate.id === string(raw, "run_b")); if (!a || !b) throw new Error("Both runs must be supplied");
        for (const run of [a, b]) for (const scalar of run.scalars) evidence.push({ runId: run.id, testId: run.testId, measurementId: scalar.measurementId, value: scalar.value, unit: scalar.unit });
        toolResult = compareRunRecords(a, b);
      } else if (tool.name === "propose_design_patch") {
        const operation: AiStudioOperation = { op: "propose-design-patch", description: string(raw, "description"), changes: Array.isArray(raw.changes) ? raw.changes : [], evidence: [...evidence] };
        operations.push({ approval: "explicit", operation }); toolResult = { recorded: true, approval: "explicit", evidence_count: evidence.length };
      } else if (tool.name === "ask_user") return Response.json({ ok: true, question: string(raw, "question"), proposal: null });
      else if (tool.name === "submit_proposal") {
        const proposal: AiStudioProposal = { id: createId("aiprop"), summary: string(raw, "summary"), rationale: string(raw, "rationale"), confidence: number(raw, "confidence"), assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.filter((item): item is string => typeof item === "string").slice(0, 12) : [], uncertainty: typeof raw.uncertainty === "string" ? raw.uncertainty.slice(0, 600) : undefined, operations, evidence: dedupeEvidence(evidence), createdAt: nowIso() };
        return Response.json({ ok: true, proposal });
      } else throw new Error(`Unknown tool ${tool.name}`);
      messages.push(assistantResponseMessage(response));
      messages.push(toolResultsMessage([{ type: "tool_result", toolCallId: tool.id, output: JSON.stringify(toolResult).slice(0, 30_000) }]));
    }
    return Response.json({ ok: false, error: "AI tool loop reached its iteration limit" }, { status: 422 });
  } catch (error) {
    return providerErrorResponse(error, provider);
  }
}

function dedupeEvidence(evidence: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return evidence.filter((item) => { const key = JSON.stringify(item); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 200);
}
