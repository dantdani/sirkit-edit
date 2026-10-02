/**
 * [B22-B] The closed computation catalog (runbook B22-B :908-920; discovery D22-15; OD-139, OD-149): Sirkit's named engineering
 * computations, never generic execution. Exactly the runbook's five operation kinds, in its order (:912-916), each with
 *  - a closed input schema: every object closed, every string a closed enum or a server-held artifact digest, every number bounded
 *    server-side; no argv, path, URL, deck text, script or code field anywhere (checked structurally, `closedInputViolations`);
 *  - where it runs: the bounded engine host (a worker thread, OD-140) or the B22-A3 diagnostic runner (a process);
 *  - a profile id for the process-backed kinds, an output validator id and a budget.
 * The three process-free kinds are Tier 0 reads the agent may call (their port is injected by the chat composition root); the two
 * process-backed kinds are inert sealed REQUESTS a human approves (`requests.ts`), dormant for the agent in B22-B: approving one
 * needs a route, and B22-B adds none. Every kind is withheld from MCP and dormant for B21 specialists.
 *
 * Pure data and pure checks: no import but types, no I/O, no clock, no process. A result is evidence, never engineering authority.
 */
import type { JsonSchema } from "../engineering/tool-registry";

/** OD-139: every computation id lives under this prefix and spells none of these words. */
export const COMPUTATION_ID_PREFIX = "sirkit.computation." as const;
export const COMPUTATION_ID_FORBIDDEN = /spice|simulate|exec|process|shell|file\.|order|ship|qualif/i;
/** The binding status and the per-run authority of the process-free kinds (registered in tool-registry.ts). */
export const COMPUTATION_BINDING_STATUS = "bound-computation" as const;
export const COMPUTATION_ENGINE_AUTHORITY = "computation-engine" as const;
/** OD-149: an input field may never be named like an argument vector, a location, a deck or code. */
export const FORBIDDEN_INPUT_FIELD = /argv|^args?$|path|dir|file|url|uri|href|link|host|deck|netlist|script|code|command|cmd|expr|formula|source|program|eval|shell|exec|module|import|require|spawn|process|env/i;
/** A server-held artifact is named by its digest only: an engineering identity (a run's canonical state) or a SHA-256 result digest. */
export const ARTIFACT_DIGEST_PATTERN = /^(?:eng1-[0-9a-f]{16}|dw1-[0-9a-f]{64})$/;
const RESULT_DIGEST_PATTERN = /^dw1-[0-9a-f]{64}$/;

export const COMPUTATION_KIND_IDS = Object.freeze([
  "sirkit.computation.circuit-analysis",
  "sirkit.computation.analytical-equation",
  "sirkit.computation.artifact-parse",
  "sirkit.computation.layout-experiment",
  "sirkit.computation.artifact-compare",
] as const);
export type ComputationKindId = (typeof COMPUTATION_KIND_IDS)[number];

/** The analytical reference provider's microcases (its supportedFeaturesAndLimits: resistor divider, first-order RC, single pole). */
export const ANALYTICAL_MICROCASES = Object.freeze(["resistor-divider", "rc-step", "one-pole-lowpass"] as const);
export type AnalyticalMicrocase = (typeof ANALYTICAL_MICROCASES)[number];
export const ARTIFACT_PARSERS = Object.freeze(["board-statistics", "result-fields"] as const);
export type ArtifactParser = (typeof ARTIFACT_PARSERS)[number];
export const LAYOUT_EXPERIMENTS = Object.freeze(["placement"] as const);

export const COMPUTATION_VALIDATOR_IDS = Object.freeze([
  "sirkit.computation-validator.circuit-waveform/1",
  "sirkit.computation-validator.analytical-quantities/1",
  "sirkit.computation-validator.artifact-statistics/1",
  "sirkit.computation-validator.layout-experiment/1",
  "sirkit.computation-validator.artifact-comparison/1",
] as const);
export type ComputationValidatorId = (typeof COMPUTATION_VALIDATOR_IDS)[number];

export interface ComputationNumberField { readonly unit: string; readonly minimum: number; readonly maximum: number; readonly integer: boolean }
export interface ComputationBudget { readonly wallClockMs: number; readonly maxOutputBytes: number; readonly heapMiB: number }
export interface ComputationKind {
  readonly id: ComputationKindId;
  readonly version: string;
  readonly runbookLine: number;
  readonly runbookText: string;
  /** OD-139: in-process kinds read; process-backed kinds are inert requests a human approves. */
  readonly backing: "in-process" | "process-backed";
  readonly operationClass: "read" | "propose";
  readonly execution: "engine-host" | "diagnostic-runner";
  readonly engineId: string | null;
  readonly profileId: string | null;
  readonly outputValidatorId: ComputationValidatorId;
  readonly budget: ComputationBudget;
  /** The closed wire schema (the provider wire subset: no bound keyword travels; the server holds every bound below). */
  readonly inputSchema: JsonSchema;
  readonly numberFields: Readonly<Record<string, ComputationNumberField>>;
  readonly digestFields: readonly string[];
  /** The enum field whose value names the microcase, and the number fields each value requires (all others must be absent). */
  readonly selectorField: string | null;
  readonly selectorFields: Readonly<Record<string, readonly string[]>>;
  readonly exposure: { readonly agent: "exposed" | "dormant"; readonly reason: string };
  readonly mcp: { readonly withheld: boolean; readonly reason: string };
  readonly specialists: { readonly dormant: boolean; readonly reason: string };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

const PARAMETERS: Readonly<Record<string, ComputationNumberField & { readonly description: string }>> = {
  vin: { unit: "V", minimum: -1_000, maximum: 1_000, integer: false, description: "Source voltage in volts (resistor-divider, rc-step)." },
  r1: { unit: "ohm", minimum: 1e-3, maximum: 1e9, integer: false, description: "Upper divider resistance in ohms (resistor-divider)." },
  r2: { unit: "ohm", minimum: 1e-3, maximum: 1e9, integer: false, description: "Lower divider resistance in ohms (resistor-divider)." },
  r: { unit: "ohm", minimum: 1e-3, maximum: 1e9, integer: false, description: "Series resistance in ohms (rc-step, one-pole-lowpass)." },
  c: { unit: "F", minimum: 1e-15, maximum: 1, integer: false, description: "Capacitance in farads (rc-step, one-pole-lowpass)." },
  time: { unit: "s", minimum: 0, maximum: 1_000, integer: false, description: "Time after the step in seconds (rc-step)." },
  frequency: { unit: "Hz", minimum: 1e-3, maximum: 1e9, integer: false, description: "Frequency in hertz (one-pole-lowpass)." },
};
const MICROCASE_PARAMETERS: Readonly<Record<AnalyticalMicrocase, readonly string[]>> = {
  "resistor-divider": ["vin", "r1", "r2"],
  "rc-step": ["vin", "r", "c", "time"],
  "one-pole-lowpass": ["r", "c", "frequency"],
};
const PARAMETER_NAMES = Object.keys(PARAMETERS);
const numberProperties = (): Record<string, unknown> => Object.fromEntries(PARAMETER_NAMES.map((name) => [name, { type: "number", description: PARAMETERS[name]!.description }]));
const numberFieldTable = (): Record<string, ComputationNumberField> => Object.fromEntries(PARAMETER_NAMES.map((name) => { const { unit, minimum, maximum, integer } = PARAMETERS[name]!; return [name, { unit, minimum, maximum, integer }]; }));
const microcaseSchema = (selector: string, text: string): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties: { [selector]: { type: "string", enum: [...ANALYTICAL_MICROCASES], description: text }, ...numberProperties() },
  required: [selector],
});
const MCP_REASON = "a named computation runs in the server's bounded engine host (a worker thread) or the diagnostic runner (a process), bound to a chat run by its composition root; an MCP call may start neither (b20-b4-process-gate), and MCP stays a read-only adapter over durable state (OD-82)";
const SPECIALIST_REASON = "dormant for B21 specialists: no role row holds a computation id, and a specialist's derived context carries neither the server's computation fact nor the computation-engine authority (OD-120 unchanged)";
const DORMANT_REASON = "an inert sealed request a HUMAN approves (requests.ts); approving it needs an authenticated route and B22-B adds none (the census stays 165), so the descriptor is registered, never agent-exposed and never callable until that route exists";

export const COMPUTATION_CATALOG: readonly ComputationKind[] = deepFreeze<readonly ComputationKind[]>([
  {
    id: "sirkit.computation.circuit-analysis", version: "1.0.0", runbookLine: 912, runbookText: "run a pinned SPICE analysis",
    backing: "process-backed", operationClass: "propose", execution: "diagnostic-runner", engineId: null, profileId: "ngspice-local-diagnostic",
    outputValidatorId: "sirkit.computation-validator.circuit-waveform/1",
    budget: { wallClockMs: 10_000, maxOutputBytes: 8_192, heapMiB: 64 },
    inputSchema: microcaseSchema("circuit", "The pinned microcase circuit the server writes from these numbers (resistor-divider: operating point; rc-step: transient; one-pole-lowpass: AC at one frequency)."),
    numberFields: numberFieldTable(), digestFields: [], selectorField: "circuit", selectorFields: MICROCASE_PARAMETERS,
    exposure: { agent: "dormant", reason: DORMANT_REASON },
    mcp: { withheld: true, reason: MCP_REASON },
    specialists: { dormant: true, reason: SPECIALIST_REASON },
  },
  {
    id: "sirkit.computation.analytical-equation", version: "1.0.0", runbookLine: 913, runbookText: "evaluate an approved equation/model",
    backing: "in-process", operationClass: "read", execution: "engine-host", engineId: "sirkit.engine.analytical-equations/1", profileId: null,
    outputValidatorId: "sirkit.computation-validator.analytical-quantities/1",
    budget: { wallClockMs: 5_000, maxOutputBytes: 4_096, heapMiB: 32 },
    inputSchema: microcaseSchema("equation", "The approved closed-form microcase of the analytical reference provider; only its own parameters are given."),
    numberFields: numberFieldTable(), digestFields: [], selectorField: "equation", selectorFields: MICROCASE_PARAMETERS,
    exposure: { agent: "exposed", reason: "a Tier 0 read: closed-form quantities of an approved analytical microcase from bounded numbers, evaluated in the bounded engine host; never authority, never a simulation" },
    mcp: { withheld: true, reason: MCP_REASON },
    specialists: { dormant: true, reason: SPECIALIST_REASON },
  },
  {
    id: "sirkit.computation.artifact-parse", version: "1.0.0", runbookLine: 914, runbookText: "parse a bounded approved file",
    backing: "in-process", operationClass: "read", execution: "engine-host", engineId: "sirkit.engine.artifact-parse/1", profileId: null,
    outputValidatorId: "sirkit.computation-validator.artifact-statistics/1",
    budget: { wallClockMs: 10_000, maxOutputBytes: 8_192, heapMiB: 128 },
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        artifact: { type: "string", description: "The digest of a server-held artifact of this run: the canonical board's revision digest, or a computation result's resultDigest." },
        parser: { type: "string", enum: [...ARTIFACT_PARSERS], description: "board-statistics for the canonical board; result-fields for a computation result." },
      },
      required: ["artifact", "parser"],
    },
    numberFields: {}, digestFields: ["artifact"], selectorField: null, selectorFields: {},
    exposure: { agent: "exposed", reason: "a Tier 0 read: a closed parser over one bounded server-held artifact named by its digest (never a path or a URL), in the bounded engine host" },
    mcp: { withheld: true, reason: MCP_REASON },
    specialists: { dormant: true, reason: SPECIALIST_REASON },
  },
  {
    id: "sirkit.computation.layout-experiment", version: "1.0.0", runbookLine: 915, runbookText: "run a pinned placement/routing experiment",
    backing: "process-backed", operationClass: "propose", execution: "engine-host", engineId: "sirkit.engine.placement-experiment/1", profileId: "engine-host:placement-experiment/1",
    outputValidatorId: "sirkit.computation-validator.layout-experiment/1",
    budget: { wallClockMs: 60_000, maxOutputBytes: 8_192, heapMiB: 512 },
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        experiment: { type: "string", enum: [...LAYOUT_EXPERIMENTS], description: "The pinned experiment profile." },
        seed: { type: "integer", description: "The experiment's seed." },
        budgetSeconds: { type: "integer", description: "The wall clock the experiment may use, in seconds (the host stops it hard there)." },
      },
      required: ["experiment", "seed", "budgetSeconds"],
    },
    numberFields: { seed: { unit: "1", minimum: 0, maximum: 2_147_483_647, integer: true }, budgetSeconds: { unit: "s", minimum: 1, maximum: 60, integer: true } },
    digestFields: [], selectorField: null, selectorFields: {},
    exposure: { agent: "dormant", reason: DORMANT_REASON },
    mcp: { withheld: true, reason: MCP_REASON },
    specialists: { dormant: true, reason: SPECIALIST_REASON },
  },
  {
    id: "sirkit.computation.artifact-compare", version: "1.0.0", runbookLine: 916, runbookText: "compare deterministic artifacts",
    backing: "in-process", operationClass: "read", execution: "engine-host", engineId: "sirkit.engine.artifact-compare/1", profileId: null,
    outputValidatorId: "sirkit.computation-validator.artifact-comparison/1",
    budget: { wallClockMs: 5_000, maxOutputBytes: 8_192, heapMiB: 32 },
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        left: { type: "string", description: "The resultDigest of a computation result of this run." },
        right: { type: "string", description: "The resultDigest of another computation result of this run." },
      },
      required: ["left", "right"],
    },
    numberFields: {}, digestFields: ["left", "right"], selectorField: null, selectorFields: {},
    exposure: { agent: "exposed", reason: "a Tier 0 read: compares the quantities of two deterministic computation results the server holds for this run, named by digest, in the bounded engine host" },
    mcp: { withheld: true, reason: MCP_REASON },
    specialists: { dormant: true, reason: SPECIALIST_REASON },
  },
]);

const BY_ID: ReadonlyMap<string, ComputationKind> = new Map(COMPUTATION_CATALOG.map((kind) => [kind.id, kind]));
/** The kind with this exact id, or undefined (a Map lookup: no prototype key resolves). */
export function computationKind(id: string): ComputationKind | undefined {
  return BY_ID.get(id);
}

// ── the structural checks ─────────────────────────────────────────────────────────────────────────────────────────────

const SCHEMA_KEYWORDS = new Set(["type", "description", "enum", "properties", "required", "additionalProperties"]);
const PROPERTY_KEYWORDS = new Set(["type", "description", "enum"]);

/** OD-139, OD-149: why a kind's input is not closed (empty: it is). */
export function closedInputViolations(kind: Pick<ComputationKind, "id" | "inputSchema" | "numberFields" | "digestFields" | "selectorField" | "selectorFields">): string[] {
  const issues: string[] = [];
  const at = (text: string): void => { issues.push(`${kind.id}: ${text}`); };
  const schema = kind.inputSchema as Record<string, unknown>;
  for (const key of Object.keys(schema)) if (!SCHEMA_KEYWORDS.has(key)) at(`root keyword ${key} is outside the closed set`);
  if (schema.type !== "object") at("the root is not an object");
  if (schema.additionalProperties !== false) at("additionalProperties is not false");
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) { at("no properties"); return issues; }
  const names = Object.keys(properties);
  if (names.length === 0) at("no properties");
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
  for (const name of required) if (typeof name !== "string" || !names.includes(name)) at(`required name ${String(name)} is no property`);
  for (const name of names) {
    const property = (properties as Record<string, unknown>)[name] as Record<string, unknown>;
    if (FORBIDDEN_INPUT_FIELD.test(name)) at(`field ${name} is named like argv, a path, a URL, a deck or code`);
    if (typeof property !== "object" || property === null) { at(`field ${name} is not a schema`); continue; }
    for (const key of Object.keys(property)) if (!PROPERTY_KEYWORDS.has(key)) at(`field ${name} keyword ${key} is outside the closed set`);
    if (property.type === "string") {
      const isDigest = kind.digestFields.includes(name);
      const values = property.enum;
      const isEnum = Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(value));
      if (!isDigest && !isEnum) at(`field ${name} is a free string (neither a closed enum nor a digest field)`);
      if (isDigest && values !== undefined) at(`digest field ${name} carries an enum`);
    } else if (property.type === "number" || property.type === "integer") {
      const bound = kind.numberFields[name];
      if (!bound || !Number.isFinite(bound.minimum) || !Number.isFinite(bound.maximum) || bound.minimum >= bound.maximum) at(`field ${name} has no server-side bound`);
      else if ((property.type === "integer") !== bound.integer) at(`field ${name} disagrees with its bound on integrality`);
    } else {
      at(`field ${name} has type ${String(property.type)}: only closed strings, digests and bounded numbers are inputs`);
    }
  }
  if (kind.selectorField !== null) {
    if (!names.includes(kind.selectorField) || !required.includes(kind.selectorField)) at("the selector field is not a required property");
    for (const [value, fields] of Object.entries(kind.selectorFields)) for (const field of fields) if (!kind.numberFields[field] || !names.includes(field)) at(`selector value ${value} names an unknown field ${field}`);
  }
  for (const name of kind.digestFields) if (!names.includes(name)) at(`digest field ${name} is no property`);
  return issues;
}

/** OD-139: why the catalog is not the closed five (empty: it is). */
export function computationCatalogViolations(catalog: readonly ComputationKind[] = COMPUTATION_CATALOG): string[] {
  const issues: string[] = [];
  const ids = catalog.map((kind) => kind.id as string);
  if (ids.length !== COMPUTATION_KIND_IDS.length || new Set(ids).size !== ids.length || !COMPUTATION_KIND_IDS.every((id) => ids.includes(id))) issues.push(`the catalog holds exactly the five kinds once each (got ${ids.length}${new Set(ids).size !== ids.length ? ", a duplicate" : ""})`);
  for (const kind of catalog) {
    const at = (text: string): void => { issues.push(`${kind.id}: ${text}`); };
    if (!kind.id.startsWith(COMPUTATION_ID_PREFIX) || !/^sirkit\.computation\.[a-z][a-z0-9-]*$/.test(kind.id)) at("the id is outside sirkit.computation.*");
    if (COMPUTATION_ID_FORBIDDEN.test(kind.id)) at("the id spells a forbidden word (OD-139)");
    if (!(COMPUTATION_VALIDATOR_IDS as readonly string[]).includes(kind.outputValidatorId)) at("unknown output validator");
    for (const limit of ["wallClockMs", "maxOutputBytes", "heapMiB"] as const) if (!Number.isInteger(kind.budget?.[limit]) || kind.budget[limit] <= 0) at(`budget ${limit} is not a positive integer`);
    if (kind.backing === "in-process") {
      if (kind.operationClass !== "read" || kind.execution !== "engine-host" || kind.engineId === null || kind.profileId !== null) at("an in-process kind is a read in the engine host with no profile");
    } else if (kind.backing === "process-backed") {
      if (kind.operationClass !== "propose" || kind.profileId === null) at("a process-backed kind is a propose-class request with a profile");
      if (kind.exposure.agent !== "dormant") at("a process-backed kind stays dormant until a human approval route exists");
      if ((kind.execution === "diagnostic-runner") !== (kind.engineId === null)) at("the runner kinds name no engine; the host kinds name one");
    } else {
      at("unknown backing");
    }
    if (kind.mcp?.withheld !== true) at("every computation is withheld from MCP");
    if (kind.specialists?.dormant !== true) at("every computation is dormant for specialists");
    issues.push(...closedInputViolations(kind));
  }
  return issues;
}

const LOAD_ISSUES = computationCatalogViolations();
if (LOAD_ISSUES.length > 0) throw new Error(`COMPUTATION_CATALOG_INVALID:\n${LOAD_ISSUES.join("\n")}`);

// ── the server-side input validation ─────────────────────────────────────────────────────────────────────────────────

export type ComputationInputCheck = { ok: true; input: Readonly<Record<string, string | number>> } | { ok: false; errors: string[] };
const safeName = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, "?").slice(0, 40);

/** The server's own check of a call's arguments against the kind: exact keys, closed enums, the digest grammar, bounded finite numbers,
 *  and a microcase's own parameters only. A strict provider sends an optional property as null: null is absence. Never throws. */
export function validateComputationInput(kindId: string, args: unknown): ComputationInputCheck {
  const kind = computationKind(kindId);
  if (!kind) return { ok: false, errors: ["unknown computation kind"] };
  if (typeof args !== "object" || args === null || Array.isArray(args)) return { ok: false, errors: ["arguments must be an object"] };
  const prototype = Object.getPrototypeOf(args);
  if (prototype !== Object.prototype && prototype !== null) return { ok: false, errors: ["arguments must be a plain object"] };
  const properties = kind.inputSchema.properties as Record<string, Record<string, unknown>>;
  const errors: string[] = [];
  const present: Record<string, string | number> = {};
  for (const name of Reflect.ownKeys(args)) {
    if (typeof name !== "string" || !Object.hasOwn(properties, name)) { errors.push(`unexpected argument ${typeof name === "string" ? safeName(name) : "(symbol)"}`); continue; }
    const value = (args as Record<string, unknown>)[name];
    if (value === null || value === undefined) continue;
    const property = properties[name]!;
    if (property.type === "string") {
      if (typeof value !== "string") { errors.push(`${name} must be a string`); continue; }
      if (kind.digestFields.includes(name)) { if (!ARTIFACT_DIGEST_PATTERN.test(value)) { errors.push(`${name} must be a server-held artifact digest`); continue; } }
      else if (!(property.enum as string[]).includes(value)) { errors.push(`${name} must be one of ${(property.enum as string[]).join(", ")}`); continue; }
      present[name] = value;
    } else {
      const bound = kind.numberFields[name]!;
      if (typeof value !== "number" || !Number.isFinite(value)) { errors.push(`${name} must be a finite number`); continue; }
      if (bound.integer && !Number.isInteger(value)) { errors.push(`${name} must be an integer`); continue; }
      if (value < bound.minimum || value > bound.maximum) { errors.push(`${name} must lie in [${bound.minimum}, ${bound.maximum}] ${bound.unit}`); continue; }
      present[name] = Object.is(value, -0) ? 0 : value;
    }
  }
  const required = (kind.inputSchema.required as string[] | undefined) ?? [];
  for (const name of required) if (!Object.hasOwn(present, name)) errors.push(`${name} is required`);
  if (kind.selectorField !== null && typeof present[kind.selectorField] === "string") {
    const wanted = kind.selectorFields[present[kind.selectorField] as string] ?? [];
    for (const name of Object.keys(kind.numberFields)) {
      if (wanted.includes(name) && !Object.hasOwn(present, name)) errors.push(`${name} is required for ${present[kind.selectorField]}`);
      if (!wanted.includes(name) && Object.hasOwn(present, name)) errors.push(`${name} does not belong to ${present[kind.selectorField]}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 8) };
  const ordered = Object.fromEntries(Object.keys(properties).filter((name) => Object.hasOwn(present, name)).map((name) => [name, present[name]!]));
  return { ok: true, input: Object.freeze(ordered) };
}

// ── the output validators (typed, closed, independent of the engines) ─────────────────────────────────────────────────

export const COMPUTATION_RESULT_SCHEMA = "sirkit.computation-result.v1" as const;
export const COMPUTATION_RESULT_LABELS = Object.freeze(["computation_evidence", "not_authoritative"] as const);
export const COMPUTATION_AUTHORITY_TEXT = "computation evidence - never engineering authority" as const;
/** Each microcase's quantities and their units (the engine's names; the circuit analysis reports the same names). */
export const MICROCASE_QUANTITIES: Readonly<Record<AnalyticalMicrocase, Readonly<Record<string, string>>>> = deepFreeze({
  "resistor-divider": { vout: "V", current: "A", ratio: "1", power: "W" },
  "rc-step": { tau: "s", vout: "V", fraction: "1", current: "A" },
  "one-pole-lowpass": { cutoff: "Hz", magnitude: "1", gainDb: "dB", phaseDeg: "deg" },
});
const UNITS = new Set(["V", "A", "W", "1", "s", "Hz", "dB", "deg"]);
const QUANTITY_NAME = /^[a-z][A-Za-z]{0,31}$/;
const MAX_LIST = 16;

type Check = (value: unknown, at: string, issues: string[]) => void;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function exactKeys(value: unknown, keys: readonly string[], at: string, issues: string[]): value is Record<string, unknown> {
  if (!isRecord(value)) { issues.push(`${at}: not a plain object`); return false; }
  const own = Object.keys(value);
  for (const key of own) if (!keys.includes(key)) issues.push(`${at}.${safeName(key)}: unknown key`);
  for (const key of keys) if (!Object.hasOwn(value, key)) issues.push(`${at}.${key}: missing`);
  return own.every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(value, key));
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000_000;
function list(value: unknown, at: string, issues: string[], each: Check, min = 0): void {
  if (!Array.isArray(value)) { issues.push(`${at}: not a list`); return; }
  if (value.length < min || value.length > MAX_LIST) { issues.push(`${at}: ${value.length} entries outside [${min}, ${MAX_LIST}]`); return; }
  value.forEach((item, index) => each(item, `${at}[${index}]`, issues));
}
const quantity = (allowed: Readonly<Record<string, string>> | null): Check => (value, at, issues) => {
  if (!exactKeys(value, ["name", "value", "unit"], at, issues)) return;
  const name = value.name;
  const unit = value.unit;
  if (typeof name !== "string" || !QUANTITY_NAME.test(name)) { issues.push(`${at}.name: malformed`); return; }
  if (allowed !== null && !Object.hasOwn(allowed, name)) issues.push(`${at}.name: ${name} is not a quantity of this microcase`);
  if (typeof unit !== "string" || !UNITS.has(unit) || (allowed !== null && Object.hasOwn(allowed, name) && allowed[name] !== unit)) issues.push(`${at}.unit: wrong unit`);
  if (!finite(value.value)) issues.push(`${at}.value: not finite`);
};
function uniqueNames(value: unknown, at: string, issues: string[]): void {
  if (!Array.isArray(value)) return;
  const names = value.map((item) => (isRecord(item) ? item.name : undefined));
  if (new Set(names).size !== names.length) issues.push(`${at}: a name repeats`);
}

const BODY_CHECKS: Readonly<Record<ComputationValidatorId, Check>> = {
  "sirkit.computation-validator.analytical-quantities/1": (body, at, issues) => {
    if (!exactKeys(body, ["equation", "provider", "quantities"], at, issues)) return;
    if (!(ANALYTICAL_MICROCASES as readonly unknown[]).includes(body.equation)) { issues.push(`${at}.equation: unknown`); return; }
    if (exactKeys(body.provider, ["providerId", "reviewState", "authoritative"], `${at}.provider`, issues)) {
      const provider = body.provider as Record<string, unknown>;
      if (provider.providerId !== "provider:analytical-reference" || provider.reviewState !== "unreviewed" || provider.authoritative !== false) issues.push(`${at}.provider: only the unreviewed analytical reference provider, never authoritative`);
    }
    list(body.quantities, `${at}.quantities`, issues, quantity(MICROCASE_QUANTITIES[body.equation as AnalyticalMicrocase]), 1);
    uniqueNames(body.quantities, `${at}.quantities`, issues);
  },
  "sirkit.computation-validator.artifact-comparison/1": (body, at, issues) => {
    if (!exactKeys(body, ["left", "right", "comparable", "identical", "fields"], at, issues)) return;
    for (const side of ["left", "right"] as const) {
      if (exactKeys(body[side], ["digest", "kindId"], `${at}.${side}`, issues)) {
        const ref = body[side] as Record<string, unknown>;
        if (typeof ref.digest !== "string" || !RESULT_DIGEST_PATTERN.test(ref.digest)) issues.push(`${at}.${side}.digest: malformed`);
        if (typeof ref.kindId !== "string" || !computationKind(ref.kindId)) issues.push(`${at}.${side}.kindId: unknown`);
      }
    }
    if (typeof body.comparable !== "boolean" || typeof body.identical !== "boolean") issues.push(`${at}: comparable and identical are booleans`);
    list(body.fields, `${at}.fields`, issues, (field, where, found) => {
      if (!exactKeys(field, ["name", "unit", "left", "right", "absoluteDifference", "relativeDifference"], where, found)) return;
      if (typeof field.name !== "string" || !QUANTITY_NAME.test(field.name)) found.push(`${where}.name: malformed`);
      if (typeof field.unit !== "string" || !UNITS.has(field.unit)) found.push(`${where}.unit: unknown`);
      if (!finite(field.left) || !finite(field.right)) found.push(`${where}: values not finite`);
      if (!finite(field.absoluteDifference) || field.absoluteDifference < 0) found.push(`${where}.absoluteDifference: not a finite non-negative number`);
      if (field.relativeDifference !== null && (!finite(field.relativeDifference) || field.relativeDifference < 0)) found.push(`${where}.relativeDifference: not a finite non-negative number or null`);
    });
    uniqueNames(body.fields, `${at}.fields`, issues);
  },
  "sirkit.computation-validator.artifact-statistics/1": (body, at, issues) => {
    if (!exactKeys(body, ["artifact", "parser", "statistics"], at, issues)) return;
    if (exactKeys(body.artifact, ["digest", "kind"], `${at}.artifact`, issues)) {
      const artifact = body.artifact as Record<string, unknown>;
      if (typeof artifact.digest !== "string" || !ARTIFACT_DIGEST_PATTERN.test(artifact.digest)) issues.push(`${at}.artifact.digest: malformed`);
      if (artifact.kind !== (body.parser === "board-statistics" ? "canonical-board" : "computation-result")) issues.push(`${at}.artifact.kind: does not fit the parser`);
    }
    if (body.parser === "board-statistics") {
      if (!exactKeys(body.statistics, ["copperLayers", "footprints", "nets", "tracks", "vias", "zones", "texts", "layers"], `${at}.statistics`, issues)) return;
      const statistics = body.statistics as Record<string, unknown>;
      for (const key of ["copperLayers", "footprints", "nets", "tracks", "vias", "zones", "texts"] as const) if (!count(statistics[key])) issues.push(`${at}.statistics.${key}: not a count`);
      list(statistics.layers, `${at}.statistics.layers`, issues, (layer, where, found) => {
        if (!exactKeys(layer, ["layer", "tracks", "lengthNm"], where, found)) return;
        if (typeof layer.layer !== "string" || !/^[A-Za-z0-9_.]{1,32}$/.test(layer.layer)) found.push(`${where}.layer: malformed`);
        if (!count(layer.tracks)) found.push(`${where}.tracks: not a count`);
        if (!finite(layer.lengthNm) || layer.lengthNm < 0) found.push(`${where}.lengthNm: not a finite non-negative number`);
      });
    } else if (body.parser === "result-fields") {
      if (!exactKeys(body.statistics, ["kindId", "fields"], `${at}.statistics`, issues)) return;
      const statistics = body.statistics as Record<string, unknown>;
      if (typeof statistics.kindId !== "string" || !computationKind(statistics.kindId)) issues.push(`${at}.statistics.kindId: unknown`);
      list(statistics.fields, `${at}.statistics.fields`, issues, quantity(null));
      uniqueNames(statistics.fields, `${at}.statistics.fields`, issues);
    } else {
      issues.push(`${at}.parser: unknown`);
    }
  },
  "sirkit.computation-validator.circuit-waveform/1": (body, at, issues) => {
    if (!exactKeys(body, ["circuit", "analysis", "points", "quantities"], at, issues)) return;
    if (!(ANALYTICAL_MICROCASES as readonly unknown[]).includes(body.circuit)) { issues.push(`${at}.circuit: unknown`); return; }
    const analysis = { "resistor-divider": "op", "rc-step": "tran", "one-pole-lowpass": "ac" }[body.circuit as AnalyticalMicrocase];
    if (body.analysis !== analysis) issues.push(`${at}.analysis: does not fit the circuit`);
    if (!count(body.points) || body.points < 1) issues.push(`${at}.points: not a positive count`);
    list(body.quantities, `${at}.quantities`, issues, quantity(MICROCASE_QUANTITIES[body.circuit as AnalyticalMicrocase]), 1);
    uniqueNames(body.quantities, `${at}.quantities`, issues);
  },
  "sirkit.computation-validator.layout-experiment/1": (body, at, issues) => {
    if (!exactKeys(body, ["experiment", "seed", "candidates", "bestScore"], at, issues)) return;
    if (!(LAYOUT_EXPERIMENTS as readonly unknown[]).includes(body.experiment)) issues.push(`${at}.experiment: unknown`);
    if (!count(body.seed) || !count(body.candidates)) issues.push(`${at}: seed and candidates are counts`);
    if (body.bestScore !== null && !finite(body.bestScore)) issues.push(`${at}.bestScore: not finite`);
  },
};
const VALIDATOR_KIND: Readonly<Record<ComputationValidatorId, ComputationKindId>> = Object.fromEntries(COMPUTATION_CATALOG.map((kind) => [kind.outputValidatorId, kind.id])) as Record<ComputationValidatorId, ComputationKindId>;

/**
 * The typed output validator `validatorId` names (closed): for an in-process kind it checks the whole result envelope (schema, kind,
 * engine, digests, labels, the authority sentence, size) and its body; for a process-backed kind it checks the evidence body the
 * server's executor parsed. An answer that fails is refused whole, never trimmed. Never throws.
 */
export function validateComputationOutput(validatorId: string, value: unknown): string[] {
  const issues: string[] = [];
  try {
    if (!Object.hasOwn(BODY_CHECKS, validatorId)) return ["unknown output validator"];
    const id = validatorId as ComputationValidatorId;
    const kind = computationKind(VALIDATOR_KIND[id])!;
    if (kind.backing === "process-backed") {
      BODY_CHECKS[id](value, "$", issues);
      return issues;
    }
    if (!exactKeys(value, ["schema", "kindId", "kindVersion", "engineId", "inputDigest", "resultDigest", "labels", "authority", "elapsedMs", "body"], "$", issues)) return issues;
    if (value.schema !== COMPUTATION_RESULT_SCHEMA) issues.push("$.schema: wrong");
    if (value.kindId !== kind.id || value.kindVersion !== kind.version || value.engineId !== kind.engineId) issues.push("$: the result is not this kind's");
    for (const key of ["inputDigest", "resultDigest"] as const) if (typeof value[key] !== "string" || !RESULT_DIGEST_PATTERN.test(value[key] as string)) issues.push(`$.${key}: malformed`);
    if (!Array.isArray(value.labels) || value.labels.length !== COMPUTATION_RESULT_LABELS.length || value.labels.some((label, index) => label !== COMPUTATION_RESULT_LABELS[index])) issues.push("$.labels: the two closed labels are required");
    if (value.authority !== COMPUTATION_AUTHORITY_TEXT) issues.push("$.authority: the fixed sentence is required");
    if (!count(value.elapsedMs)) issues.push("$.elapsedMs: not a count");
    BODY_CHECKS[id](value.body, "$.body", issues);
    if (issues.length === 0 && JSON.stringify(value).length > kind.budget.maxOutputBytes) issues.push(`$: over the ${kind.budget.maxOutputBytes}-byte output budget`);
  } catch {
    issues.push("$: unreadable");
  }
  return issues;
}
