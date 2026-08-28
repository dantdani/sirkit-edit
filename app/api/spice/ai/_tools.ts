/**
 * B16.0.23 §G — the SPICE studio's typed tool surface, moved out of the route
 * beside its SCHEMA-DERIVED structural validator (the B16.0.17.1 protocol):
 * the EXACT schema objects below are what both provider adapters receive
 * (reference identity pinned in b16-0-23-adapter-schema-parity), and
 * `validateSpiceToolInput` walks THESE nodes — required keys, declared
 * property types, enums, numeric bounds, array item shapes — so provider
 * output is structurally validated BEFORE any tool handler runs, and the
 * validator can never drift from the schema the providers were shown.
 */
import type { LLMTool } from "@/app/lib/llm/types";

export const SPICE_TOOL_SCHEMAS: LLMTool[] = [
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
Object.freeze(SPICE_TOOL_SCHEMAS);

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: readonly string[];
  enum?: readonly string[];
  items?: SchemaNode;
  additionalProperties?: SchemaNode;
  minimum?: number;
  maximum?: number;
}

/** Walk a schema NODE (not a hand-written duplicate) against a value. */
function checkNode(node: SchemaNode, value: unknown, path: string): string | null {
  switch (node.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return `${path} must be an object`;
      const record = value as Record<string, unknown>;
      for (const key of node.required ?? []) {
        if (record[key] === undefined) return `${path}.${key} is required`;
      }
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (record[key] === undefined) continue;
        const failure = checkNode(child, record[key], `${path}.${key}`);
        if (failure) return failure;
      }
      if (node.additionalProperties && typeof node.additionalProperties === "object") {
        for (const [key, child] of Object.entries(record)) {
          if (node.properties && key in node.properties) continue;
          const failure = checkNode(node.additionalProperties, child, `${path}.${key}`);
          if (failure) return failure;
        }
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return `${path} must be an array`;
      if (node.items) {
        for (let index = 0; index < value.length; index++) {
          const failure = checkNode(node.items, value[index], `${path}[${index}]`);
          if (failure) return failure;
        }
      }
      return null;
    }
    case "string": {
      if (typeof value !== "string") return `${path} must be a string`;
      if (node.enum && !node.enum.includes(value)) return `${path} must be one of ${node.enum.join(", ")}`;
      return null;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${path} must be a finite number`;
      if (node.type === "integer" && !Number.isInteger(value)) return `${path} must be an integer`;
      if (node.minimum !== undefined && value < node.minimum) return `${path} must be >= ${node.minimum}`;
      if (node.maximum !== undefined && value > node.maximum) return `${path} must be <= ${node.maximum}`;
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be a boolean`;
    default:
      return null; // an untyped node constrains nothing (e.g. bare { type: "object" } handled above)
  }
}

export type SpiceToolValidation = { ok: true } | { ok: false; error: string };

/**
 * Structural validation of a provider tool call against the EXACT schema node
 * shown to the provider. An unknown tool name returns ok — the route's
 * dispatch refuses it with its own deterministic local code.
 */
export function validateSpiceToolInput(toolName: string, input: unknown): SpiceToolValidation {
  const tool = SPICE_TOOL_SCHEMAS.find((candidate) => candidate.name === toolName);
  if (!tool) return { ok: true };
  const failure = checkNode(tool.inputSchema as SchemaNode, input, toolName);
  return failure ? { ok: false, error: failure } : { ok: true };
}
