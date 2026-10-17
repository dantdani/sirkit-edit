/**
 * [PR-D] Registry-backed tool manuals (assignment D.9): one concise Markdown manual per descriptor of the B04 catalog, rendered from
 * the registry and the handler modules it binds - never typed by hand and never a second tool list in a prompt (D.9). Every manual
 * has exactly these sections, in this order (`MANUAL_SECTION_TITLES`): ID and version; schema (JSON) with valid examples; units and
 * coordinate frame; preconditions; exact effects; permissions and approval; budget; failure codes; postconditions.
 *
 *  - examples: a curated example per known tool (`MANUAL_EXAMPLES`; the generation proposal reuses its module's own
 *    GENERATE_PROPOSAL_INPUT_EXAMPLE) or, for a tool without one, an example DERIVED from its schema (marked so). EVERY example is
 *    validated here against the descriptor's input schema with the project's deterministic validator (tool-io-validation.ts:
 *    assertSafeJsonValue + validateAgainstSchema) and the render THROWS when one does not validate, so the generator and the gate
 *    fail closed;
 *  - units and frame: only what the descriptor text, its schema field names or the bound domain module declares
 *    (`DOMAIN_UNIT_DECLARATIONS`, each with the text the gate finds in the cited file; a computation's units come from its catalog
 *    kind); otherwise "not declared" - nothing is invented;
 *  - preconditions: the discovery pipeline of tool-discovery.ts rendered with the descriptor's own values, then the handler's per-call
 *    requirements as read from the handler module the gateway dispatches to (`handlerFamilyOf` mirrors gateway.ts);
 *  - permissions: permission-tiers.ts, granted-execution-families.ts, agent-exposure.ts and mcp-exposure.ts, never a parallel table;
 *  - failure codes: the codes the handler modules DECLARE (`CodeSource` rows name the file; the gate checks every code is quoted in
 *    it). A family whose handler declared none would print the codes its tests assert, marked "from tests" (`declaredBy`); every
 *    family today declares its own. The loop's and the gateway's refusals that apply to every tool come first; a tool the gateway's
 *    dispatch does not classify says so instead of guessing;
 *  - the generator (scripts/generate-pr-d-tool-manuals.ts) writes `<toolId>.md` and MANIFEST.json ({ toolId, version, sha256 },
 *    sorted); the gate (__tests__/pr-d-tool-manuals.test.ts) regenerates in memory and compares byte for byte, so a registry or
 *    handler change is reviewed by regenerating.
 *
 * No clock, no I/O, no process: the render is a pure function of the registry and this module. An excluded or blocked tool is never
 * advertised as callable (D.8): its manual opens with NOT available to the assistant and the registry facts that exclude it.
 */
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, isAgentExposableDescriptor } from "./agent-exposure";
import { MAX_GRANT_OPERATIONS } from "./execution-grant";
import { GRANTED_EXECUTION_TOOLS, NEVER_EXPOSED_TOOL_PATTERNS, NEVER_GRANTED_COMMAND_IDS, grantedExecutionViolations } from "./granted-execution-families";
import { MCP_EXCLUSION_REASON_DECISIONS, mcpExclusionReason } from "./mcp-exposure";
import { PERMISSION_TIER_TITLES, TIER1_EXECUTE_ROLES, TIER3_FLOOR_PATTERN, decideAgentExecution, defaultAutonomySetting, permissionTierOfDescriptor, type AgentAutonomySetting, type PermissionTier } from "./permission-tiers";
import { REPLACEMENT_PROPOSAL_SCHEMA } from "./replacement-proposals";
import { TIER1_PROPOSAL_SCHEMA } from "./schematic-proposals";
import { engineeringDigest } from "./stable";
import { OPERATION_CLASS_RISK, type JsonSchema, type ToolDescriptor, type ToolRegistry } from "./tool-registry";
import { READ_FAILURE_STATUSES } from "./tool-invocation";
import { DEFAULT_INPUT_LIMITS, assertSafeJsonValue, validateAgainstSchema } from "./tool-io-validation";
import { DEFAULT_AGENT_BUDGET } from "../agent/contracts";
import { MAX_EXTERNAL_READ_OUTPUT_CHARS, MAX_EXTERNAL_SEARCH_MPNS, MAX_LIVE_MPNS_PER_RUN } from "../agent/acquisition-reads";
import { AGENT_GENERATION_PROPOSAL_TOOL_ID, GENERATE_PROPOSAL_INPUT_EXAMPLE, GENERATION_PROPOSAL_SCHEMA, GENERATION_PROPOSAL_TTL_MS, MAX_GENERATION_PROMPT_CHARS, MIN_GENERATION_BUDGET_MS } from "../agent/generation-proposals";
// [PR-F fB] the missing-facts read and the part draft request: their ids, bindings, examples and bounds, read from the modules themselves (never retyped here)
import { CATALOG_UNAVAILABLE, MAX_MISSING_FACTS_INSTANCES, MISSING_FACTS_BINDING, MISSING_FACTS_INPUT_EXAMPLE, MISSING_FACTS_REPORT_SCHEMA, MISSING_FACTS_TOOL_ID, MISSING_FACTS_VERIFICATION, MISSING_FACTS_VERIFICATION_WITH_CATALOG } from "../agent/missing-facts-reads";
import { DRAFT_REQUEST_HUMAN_PATH, DRAFT_REQUEST_INPUT_EXAMPLE, DRAFT_REQUEST_SCHEMA, DRAFT_REQUEST_TOOL_ID, DRAFT_REQUEST_TTL_MS, DRAFT_REQUEST_VERIFICATION, MAX_DRAFT_PIN_ROWS, PCB_ASSIGNMENT_BLOCKING_FACTS } from "../agent/draft-request-proposals";
import { MAX_MCP_NETWORK_OPERATIONS_PER_RUN, MAX_MCP_OUTPUT_CHARS, MCP_AGENT_ARGUMENTS_MAX_CHARS, MCP_PORT_REFUSAL_CODES } from "../agent/mcp-observation-reads";
// [PR-F fD] the module contract proposal: its id, binding, example, schema and bounds, read from the modules themselves (never retyped here)
import { MODULE_CONTRACT_BINDING, MODULE_CONTRACT_INPUT_EXAMPLE, MODULE_CONTRACT_PROPOSAL_SCHEMA, MODULE_CONTRACT_PROPOSAL_TOOL_ID, MODULE_CONTRACT_PROPOSAL_TTL_MS, MODULE_CONTRACT_REVIEW_PATH, MODULE_CONTRACT_VERIFICATION } from "../agent/module-contract-proposals";
import { ASTRA_QUALIFIED_PHYSICAL_INSTANCES, MAX_CONTRACT_CONSTRAINTS, MAX_CONTRACT_MODULES, MAX_CONTRACT_PORTS, MAX_CONTRACT_REQUIREMENTS, MODULE_CONTRACT_REFUSAL_CODES, MODULE_CONTRACT_SCHEMA, PORT_FACTS, REQUIREMENT_TOPICS } from "./module-contract";
// [PR-F fE] the placement intent and the stackup / via-policy proposal: ids, bindings, examples, schemas and bounds read from the modules themselves (never retyped here)
import { STACKUP_PROPOSAL_BINDING, STACKUP_PROPOSAL_INPUT_EXAMPLE, STACKUP_PROPOSAL_TOOL_ID } from "../agent/stackup-proposals";
import { MANUFACTURING_PRESET_IDS, STACKUP_CANDIDATE_SCHEMA, STACKUP_CANDIDATE_TTL_MS, STACKUP_HUMAN_PATH, STACKUP_PROFILE_IDS, UNSUPPORTED_CHAIN_REASON } from "../pcb/candidates/stackup-candidate";
import { MAX_INTENT_LIST_ITEMS, PLACEMENT_INTENT_FRAME_STATEMENT, PLACEMENT_INTENT_SCHEMA, PLACEMENT_SCOPE_LIMIT } from "../pcb/placement/intent";
import { computationKind } from "../computation/catalog";
import { BOARD_PAGE_REFUSALS, ITEM_OVER_BUDGET } from "../pcb/ai/board-pages";
import { BUILD_BUDGET } from "../schematic/build-result";
import { VIEW_REFUSAL_CODES } from "../view-session/types";

export const MANUAL_SCHEMA = "sirkit.tool-manual.v1" as const;
export const MANUAL_MANIFEST_SCHEMA = "sirkit.tool-manuals-manifest.v1" as const;
/** The nine sections, in the order every manual renders them (the gate checks the headings and their order). */
export const MANUAL_SECTION_TITLES = Object.freeze([
  "ID and version",
  "Schema (JSON) with valid examples",
  "Units and coordinate frame",
  "Preconditions",
  "Exact effects",
  "Permissions and approval",
  "Budget",
  "Failure codes",
  "Postconditions",
] as const);
export const REGENERATE_COMMAND = "pnpm exec tsx scripts/generate-pr-d-tool-manuals.ts";
export const toolManualFileName = (toolId: string): string => `${toolId}.md`;

// ── Literals cited from modules this file does not import (the gate finds each `text` in its `file`) ────────────────────────────────

/** Facts quoted from modules whose import would pull an engine, a session or the loop into this pure module (kept as literals; the
 *  gate reads each cited file and finds the text, so a renamed or renumbered constant fails the gate instead of drifting here). */
export const CITED_LITERALS = Object.freeze([
  { id: "loop.maxResultChars", file: "app/lib/agent/loop.ts", text: "export const MAX_RESULT_CHARS = 60_000" },
  { id: "loop.maxArgumentChars", file: "app/lib/agent/loop.ts", text: "const MAX_ARGUMENT_CHARS = 20_000" },
  { id: "loop.longRunningTimeout", file: "app/lib/agent/loop.ts", text: "Math.min(descriptor.timeoutMs, remainingRunMs)" },
  { id: "discovery.editorFamilies", file: "app/lib/engineering/tool-discovery.ts", text: 'pcb: ["pcb", "selection", "validation", "placement", "routing", "manufacturing", "view"]' },
  { id: "discovery.schematicFamily", file: "app/lib/engineering/tool-discovery.ts", text: 'schematic: ["schematic", "validation"]' },
  { id: "gateway.tier1Proposal", file: "app/lib/agent/gateway.ts", text: 'AGENT_PROPOSAL_TOOL_ID = "sirkit.schematic.propose-tier1-edit"' },
  { id: "gateway.replacementProposal", file: "app/lib/agent/gateway.ts", text: 'AGENT_REPLACEMENT_PROPOSAL_TOOL_ID = "sirkit.schematic.propose-component-replacement"' },
  { id: "pcbProposal.toolId", file: "app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts", text: 'PCB_EDIT_PROPOSAL_TOOL_ID = "sirkit.pcb.propose-bounded-edit"' },
  { id: "pcbProposal.schema", file: "app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts", text: 'PCB_EDIT_PROPOSAL_SCHEMA = "sirkit.pcb-bounded-edit-proposal.v2"' },
  { id: "layout.placementId", file: "app/lib/agent/layout-proposals.ts", text: 'AGENT_PLACEMENT_PROPOSAL_TOOL_ID = "sirkit.placement.propose"' },
  { id: "layout.routingId", file: "app/lib/agent/layout-proposals.ts", text: 'AGENT_ROUTING_PROPOSAL_TOOL_ID = "sirkit.routing.propose"' },
  { id: "layout.schema", file: "app/lib/pcb/candidates/layout-candidate.ts", text: 'LAYOUT_CANDIDATE_SCHEMA = "sirkit.layout-candidate.v1"' },
  { id: "mcp.toolId", file: "app/lib/agent/mcp-observation-reads.ts", text: 'MCP_OBSERVATION_TOOL_ID = "sirkit.mcp.observation-read"' },
  { id: "grant.settlementTimeout", file: "app/lib/engineering/execution-grant.ts", text: "EXECUTION_SETTLEMENT_TIMEOUT_MS = 60_000" },
  // [PR-D d2] the two Tier 0 reads of the concurrent d2 builder travel their own services (modelled on the computation reads), named by binding module
  { id: "d2.preflightBinding", file: "app/lib/agent/pcb-sync-preflight-reads.ts", text: 'PCB_SYNC_PREFLIGHT_BINDING = Object.freeze({ module: "app/lib/pcb-sync/preflight-read.ts", symbol: "buildPcbSyncPreflightReport" })' },
  { id: "d2.preflightVerification", file: "app/lib/agent/pcb-sync-preflight-reads.ts", text: 'PCB_SYNC_PREFLIGHT_VERIFICATION = "schematic-snapshot-verified"' },
  { id: "d2.catalogBinding", file: "app/lib/agent/catalog-inspection-reads.ts", text: 'CATALOG_INSPECTION_BINDING = Object.freeze({ module: "app/lib/atomic/catalog-part-detail.ts", symbol: "loadCatalogPartDetail" })' },
  { id: "d2.catalogVerification", file: "app/lib/agent/catalog-inspection-reads.ts", text: 'CATALOG_INSPECTION_VERIFICATION = "catalog-read"' },
  { id: "d2.catalogPartId", file: "app/lib/agent/catalog-inspection-reads.ts", text: "CATALOG_PART_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/" },
  { id: "d2.catalogBounds", file: "app/lib/agent/catalog-inspection-reads.ts", text: "MAX_INSPECTED_PINS = 128" },
  // [PR-F fE, 2026-10-17] the stackup / via-policy proposal and the placement intent, named by their modules' own constants
  { id: "fE.stackupBinding", file: "app/lib/agent/stackup-proposals.ts", text: 'STACKUP_PROPOSAL_BINDING = Object.freeze({ module: "app/lib/pcb/candidates/stackup-candidate.ts", symbol: "compileStackupCandidate" })' },
  { id: "fE.stackupSchema", file: "app/lib/pcb/candidates/stackup-candidate.ts", text: 'STACKUP_CANDIDATE_SCHEMA = "sirkit.stackup-candidate.v1"' },
  { id: "fE.unsupportedReason", file: "app/lib/pcb/candidates/stackup-candidate.ts", text: 'UNSUPPORTED_CHAIN_REASON = "unsupported until the complete chain is proven"' },
  { id: "fE.intentSchema", file: "app/lib/pcb/placement/intent.ts", text: 'PLACEMENT_INTENT_SCHEMA = "sirkit.placement-intent.v1"' },
  { id: "fE.scopeLimit", file: "app/lib/pcb/placement/intent.ts", text: "PLACEMENT_SCOPE_LIMIT = 50" },
  { id: "fE.intentSeed", file: "app/lib/pcb/placement/engine.ts", text: 'initializer: "intent_seed" as const' },
] as const);
const PCB_SYNC_PREFLIGHT_MODULE = "app/lib/pcb-sync/preflight-read.ts";
const CATALOG_INSPECTION_MODULE = "app/lib/atomic/catalog-part-detail.ts";
const MAX_RESULT_CHARS = 60_000;
const MAX_ARGUMENT_CHARS = 20_000;
const TIER1_PROPOSAL_TOOL_ID = "sirkit.schematic.propose-tier1-edit";
const REPLACEMENT_PROPOSAL_TOOL_ID = "sirkit.schematic.propose-component-replacement";
const PCB_PROPOSAL_TOOL_ID = "sirkit.pcb.propose-bounded-edit";
const PCB_PROPOSAL_SCHEMA = "sirkit.pcb-bounded-edit-proposal.v2";
const LAYOUT_PROPOSAL_TOOL_IDS: readonly string[] = ["sirkit.placement.propose", "sirkit.routing.propose"];
const LAYOUT_CANDIDATE_SCHEMA = "sirkit.layout-candidate.v1";
const MCP_OBSERVATION_TOOL_ID = "sirkit.mcp.observation-read";
/** The editor each category rides in discovery (tool-discovery.ts step 6; project and parts ride every editor). */
const EDITOR_FAMILIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  pcb: ["pcb", "selection", "validation", "placement", "routing", "manufacturing", "view"],
  schematic: ["schematic", "validation"],
});

// ── Examples ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Example = Record<string, unknown>;
const HEX64 = "3f1c9a7e0d2b48c6e5a1f0b9d7c3e2a4f6b8d0c2e4a6f8b0d2c4e6a8f0b2d4c6";
/** One curated, realistic example per known tool (the ids are data, never a second list of what is exposed: a tool absent here gets
 *  a schema-derived example, so another builder's new tool is still rendered and validated). */
export const MANUAL_EXAMPLES: Readonly<Record<string, readonly Example[]>> = Object.freeze({
  "sirkit.project.canonical-revision-inspect": [{}],
  "sirkit.pcb.revision-inspect": [{}],
  "sirkit.schematic.inspect": [{}],
  "sirkit.schematic.propose-tier1-edit": [{ ops: [{ op: "set-value", target: "R1", value: "10k" }, { op: "rename", target: "R2", refDes: "R5" }] }],
  "sirkit.schematic.propose-component-replacement": [{ componentId: "kc-7f3a2b" }],
  "sirkit.pcb.propose-bounded-edit": [{ intent: "Move R3 clear of the mounting hole", operations: [{ kind: "move_footprint", footprintId: "fp-r3", to: { x: 6000000, y: 5000000 } }] }],
  "sirkit.pcb.board-inspect": [{}],
  "sirkit.pcb.mechanical-inspect": [{}],
  "sirkit.pcb.via-inspect": [{ netName: "GND" }],
  "sirkit.pcb.board-page-inspect": [{ layer: "copperTop" }, { netName: "GND" }],
  "sirkit.validation.drc-run": [{}],
  "sirkit.validation.connectivity-verify": [{}],
  "sirkit.selection.inspect": [{}],
  "sirkit.parts.search": [{ query: "10k 0603 resistor", limit: 10 }],
  "sirkit.parts.external-search": [{ mpns: ["NE555P"] }],
  "sirkit.parts.evidence-read": [{ mpn: "NE555P" }],
  "sirkit.mcp.observation-read": [{ operation: "servers", serverId: "", toolName: "", argumentsJson: "" }],
  "sirkit.component-authority.inspect": [{ componentIds: ["kc-7f3a2b"] }],
  "sirkit.manufacturing.readiness-inspect": [{}],
  "sirkit.placement.propose": [{ candidateCount: 4, maxIterations: 500 }, { candidateCount: 2, maxIterations: 200, intent: { schema: "sirkit.placement-intent.v1", units: "mm", frame: "board-world", placements: [{ component: { ref: "U1", instanceId: "fp-u1" }, xMm: 20, yMm: 15, rotationDeg: 0, side: "top" }], proximity: [{ component: { ref: "C1", instanceId: "fp-c1" }, pad: "1", near: { ref: "U1", instanceId: "fp-u1" }, nearPad: "8", maxDistanceMm: 3, reason: "decoupling of the VCC pin" }], criticalNets: [{ net: { name: "GND", id: 1 }, priority: 1 }] } }], // [PR-F fE, 2026-10-17] + an intent example (millimetres, board-world frame, exact identities)
  "sirkit.routing.propose": [{ netIds: [3, 7] }],
  "sirkit.pcb.repair-plan": [{ mode: "review_every_change" }],
  "sirkit.pcb.move-footprint": [{ moves: [{ footprintId: "fp-r3", x: 6000000, y: 5000000 }] }],
  "sirkit.pcb.rotate-side-footprint": [{ targets: [{ footprintId: "fp-r3", rotationDeg: 90 }, { footprintId: "fp-c1", side: "bottom" }] }],
  "sirkit.pcb.edit-track": [{ trackIds: ["trk-12"], widthNm: 250000 }],
  "sirkit.pcb.delete-item": [{ refs: [{ kind: "via", id: "via-4" }] }],
  "sirkit.pcb.arrange": [{ mode: "align", footprintIds: ["fp-r1", "fp-r2"], edge: "left" }],
  "sirkit.pcb.silkscreen-text": [{ edits: [{ op: "add", text: "REV A", layer: "silkTop", atNm: { x: 30000000, y: 25000000 } }] }],
  "sirkit.pcb.dimension": [{ edits: [{ op: "add", kind: "horizontal", a: { x: 0, y: 0 }, b: { x: 40000000, y: 0 }, offsetNm: -3000000 }] }],
  "sirkit.pcb.undo-redo-canonical": [{ referencedTransactionId: "txn-0a1b2c", direction: "undo" }],
  "sirkit.pcb.undo-redo-granted": [{ direction: "undo" }],
  "sirkit.manufacturing.release": [{}],
  "sirkit.view.read-state": [{ editor: "pcb" }],
  "sirkit.project.history-inspect": [{ limit: 10 }],
  "sirkit.view.pcb3d": [{ action: "camera-preset", preset: "iso" }],
  "sirkit.view.canvas-navigation": [{ editor: "pcb", action: "focus", target: { kind: "component", ref: "U1" } }],
  "sirkit.selection.control": [{ editor: "pcb", action: "select", target: { kind: "component", ref: "R3" } }],
  "sirkit.view.layers": [{ action: "set-visible", layer: "copperBottom", visible: true }],
  "sirkit.view.reveal-finding": [{ editor: "pcb", findingId: "drc:clearance-12" }],
  "sirkit.view.measure": [{ action: "measure", a: { kind: "component", ref: "U1" }, b: { kind: "component", ref: "J1" } }],
  "sirkit.pcb.create-via": [{ x: 12000000, y: 8000000, netId: 3 }],
  "sirkit.pcb.zone-edit": [{ zoneId: "zone-gnd" }],
  "sirkit.schematic.add-component": [{ partId: "lib:r-10k" }],
  "sirkit.computation.analytical-equation": [{ equation: "resistor-divider", vin: 5, r1: 10000, r2: 10000 }],
  "sirkit.computation.artifact-compare": [{ left: `dw1-${HEX64}`, right: `dw1-${HEX64.split("").reverse().join("")}` }],
  "sirkit.computation.artifact-parse": [{ artifact: "eng1-77aa66bb55cc44dd", parser: "board-statistics" }],
  "sirkit.computation.circuit-analysis": [{ circuit: "rc-step", vin: 5, r: 1000, c: 0.000001, time: 0.001 }],
  "sirkit.computation.layout-experiment": [{ experiment: "placement", seed: 7, budgetSeconds: 30 }],
  [AGENT_GENERATION_PROPOSAL_TOOL_ID]: [{ ...GENERATE_PROPOSAL_INPUT_EXAMPLE }],
  // [PR-D d2] the same values the d2 modules export as their descriptors' examples (PCB_SYNC_PREFLIGHT_INPUT_EXAMPLE, CATALOG_INSPECT_INPUT_EXAMPLE)
  "sirkit.pcb-sync.preflight": [{}],
  "sirkit.parts.catalog-inspect": [{ partId: "3f2a9c1e-0b7d-4e5a-9c21-7d8e6f5a4b3c" }],
  "sirkit.component.review-request": [{ componentInstanceId: "kc-7f3a2b", reason: "The exact candidate needs a reviewer's confirmation before binding." }],
  // [PR-F fB, 2026-10-17] the two PR-F modules' own descriptor examples (MISSING_FACTS_INPUT_EXAMPLE, DRAFT_REQUEST_INPUT_EXAMPLE), as the generation proposal's
  [MISSING_FACTS_TOOL_ID]: [{ ...MISSING_FACTS_INPUT_EXAMPLE }],
  // [PR-F fD, 2026-10-17] the module contract proposal's own descriptor example (MODULE_CONTRACT_INPUT_EXAMPLE: an anti-alias filter feeding an ADC, their interface stated)
  [MODULE_CONTRACT_PROPOSAL_TOOL_ID]: [structuredClone(MODULE_CONTRACT_INPUT_EXAMPLE) as unknown as Example],
  // [PR-F fE, 2026-10-17] the stackup / via-policy proposal's own descriptor example (STACKUP_PROPOSAL_INPUT_EXAMPLE: a four-layer signal-plane stackup with a GND plane)
  [STACKUP_PROPOSAL_TOOL_ID]: [structuredClone(STACKUP_PROPOSAL_INPUT_EXAMPLE) as unknown as Example],
  [DRAFT_REQUEST_TOOL_ID]: [structuredClone(DRAFT_REQUEST_INPUT_EXAMPLE) as unknown as Example],
});

/** An example derived from the schema alone: required fields only, the first enum member, placeholder scalars. */
export function deriveExampleFromSchema(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema.required ?? []) as string[];
      return Object.fromEntries(required.filter((key) => Object.hasOwn(properties, key)).map((key) => [key, deriveExampleFromSchema(properties[key]!)]));
    }
    case "array": return typeof schema.items === "object" && schema.items !== null ? [deriveExampleFromSchema(schema.items as Record<string, unknown>)] : [];
    case "string": return "example";
    case "integer": return 1;
    case "number": return 1;
    case "boolean": return true;
    default: return null; // an unknown construct never validates: the render refuses instead of guessing
  }
}

export interface ManualExample { value: unknown; origin: "curated" | "derived"; errors: string[] }

/** The examples of a descriptor with their validation errors (the project's own validator; empty errors = valid). */
export function manualExamplesOf(descriptor: ToolDescriptor): ManualExample[] {
  const curated = MANUAL_EXAMPLES[descriptor.toolId];
  const candidates: Array<{ value: unknown; origin: ManualExample["origin"] }> = curated
    ? curated.map((value) => ({ value, origin: "curated" as const }))
    : [{ value: deriveExampleFromSchema(descriptor.inputSchema), origin: "derived" as const }];
  return candidates.map(({ value, origin }) => ({
    value, origin,
    errors: [...assertSafeJsonValue(value, DEFAULT_INPUT_LIMITS, "example"), ...validateAgainstSchema(value, descriptor.inputSchema, "example")],
  }));
}

// ── Units and coordinate frame ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DomainUnitDeclaration {
  /** The binding modules this declaration applies to. */
  modules: readonly string[];
  statement: string;
  /** The text the gate finds in `file` (the declaration's evidence). */
  evidence: { file: string; text: string };
  /** A further condition on the descriptor (default: the module alone decides). */
  when?: (descriptor: ToolDescriptor) => boolean;
}
const UNITS_MM = (module: string): DomainUnitDeclaration => ({ modules: [module], statement: `the bound builder declares \`units: "mm"\` on its result (millimetres)`, evidence: { file: module, text: 'units: "mm"' } });
export const DOMAIN_UNIT_DECLARATIONS: readonly DomainUnitDeclaration[] = Object.freeze([
  { modules: ["app/lib/engineering/editor-adapter.ts", "app/lib/engineering/executor.ts"], statement: "PCB model coordinates are integer nanometres (Nm), +x right, +y down (the KiCad file convention); millimetres exist only at file and render boundaries", evidence: { file: "app/lib/pcb/units.ts", text: "INTEGER NANOMETERS" } },
  UNITS_MM("app/lib/pcb/ai/snapshot.ts"), UNITS_MM("app/lib/pcb/ai/mechanical.ts"), UNITS_MM("app/lib/pcb/ai/vias.ts"), UNITS_MM("app/lib/pcb/ai/board-pages.ts"),
  // [PR-F fE, 2026-10-17] the placement intent's frame, read from the intent module (which quotes units.ts and geometry.ts); the stackup candidate's nanometre fields
  { modules: ["app/lib/pcb/candidates/layout-candidate.ts"], statement: `the placement intent (\`intent\`, ${PLACEMENT_INTENT_SCHEMA}) is in millimetres (\`units: "mm"\`) in the ${PLACEMENT_INTENT_FRAME_STATEMENT}`, evidence: { file: "app/lib/pcb/placement/intent.ts", text: 'PLACEMENT_INTENT_UNITS = "mm"' }, when: (descriptor) => Object.hasOwn((descriptor.inputSchema.properties ?? {}) as Record<string, unknown>, "intent") },
  { modules: ["app/lib/pcb/candidates/stackup-candidate.ts"], statement: "the candidate's via and limit fields are integer nanometres (outerNm, drillNm, the preset's limitsNm); boardThicknessMm and defaultTraceWidthMm are millimetres; layers are the model's LayerId (copperTop, in1, in2, copperBottom) with their KiCad names", evidence: { file: "app/lib/pcb/candidates/stackup-candidate.ts", text: "outerNm: number; drillNm: number" } },
  { modules: ["app/lib/view-session/pcb.ts", "app/lib/view-session/pcb3d.ts"], statement: "a point target is in the editor's world units (board nm / sheet px), never a screen coordinate", evidence: { file: "app/lib/view-session/targets.ts", text: "world units (board nm / sheet px)" }, when: (descriptor) => schemaMentions(descriptor.inputSchema, "point") },
  { modules: ["app/lib/view-session/pcb.ts"], statement: "pcb.zoom takes a relative factor from PCB_ZOOM_FACTOR_MIN 0.25 to PCB_ZOOM_FACTOR_MAX; pcb.zoom-to an absolute scale in px per mm", evidence: { file: "app/lib/view-session/pcb.ts", text: "PCB_ZOOM_FACTOR_MIN = 0.25" }, when: (descriptor) => (descriptor.viewCommands ?? []).includes("pcb.zoom") },
]);
/** Phrases a descriptor or its schema may declare (closed; each quoted as the statement it supports). */
const TEXT_UNIT_RULES: ReadonlyArray<{ pattern: RegExp; statement: string }> = [
  { pattern: /integer nanomet|whole nanomet/i, statement: "lengths and positions in integer nanometres (nm)" },
  { pattern: /\+x right/i, statement: "frame: +x right" },
  { pattern: /\+y down/i, statement: "frame: +y down" },
  { pattern: /millimet(?:re|er)s?|\(mm\)|\bin mm\b/i, statement: "lengths and positions in millimetres (mm)" },
  { pattern: /whole degrees/i, statement: "angles in whole degrees" },
  { pattern: /counter-clockwise as seen on screen/i, statement: "rotation sense: counter-clockwise as seen on screen (clockwise subtracts)" },
  { pattern: /world units/i, statement: "point targets in the editor's world units, never screen coordinates" },
  { pattern: /px\/mm|px per mm/i, statement: "zoom-to scale: PCB px/mm (schematic: zoom)" },
];
const FIELD_SUFFIX_RULES: ReadonlyArray<{ pattern: RegExp; statement: string }> = [
  { pattern: /Nm$/, statement: "fields suffixed `Nm` are nanometres (the `Nm` type of app/lib/pcb/units.ts)" },
  { pattern: /Mm$/, statement: "fields suffixed `Mm` are millimetres" },
  { pattern: /Deg$/, statement: "fields suffixed `Deg` are degrees" },
];

function walkSchema(schema: unknown, visit: (node: Record<string, unknown>, name: string | null) => void, name: string | null = null): void {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return;
  const node = schema as Record<string, unknown>;
  visit(node, name);
  const properties = node.properties;
  if (typeof properties === "object" && properties !== null) for (const [key, child] of Object.entries(properties as Record<string, unknown>)) walkSchema(child, visit, key);
  if (node.items) walkSchema(node.items, visit, name);
}
function schemaTexts(schema: JsonSchema): { descriptions: string[]; names: string[] } {
  const descriptions: string[] = []; const names: string[] = [];
  walkSchema(schema, (node, name) => { if (typeof node.description === "string") descriptions.push(node.description); if (name) names.push(name); });
  return { descriptions, names: [...new Set(names)].sort() };
}
const schemaMentions = (schema: JsonSchema, word: string): boolean => schemaTexts(schema).descriptions.some((text) => text.includes(word));

export function unitsAndFrameOf(descriptor: ToolDescriptor): string[] {
  const facts: string[] = [];
  const input = schemaTexts(descriptor.inputSchema); const output = schemaTexts(descriptor.outputSchema);
  const corpus = [descriptor.title, descriptor.description, ...input.descriptions, ...output.descriptions].join("\n");
  for (const rule of TEXT_UNIT_RULES) if (rule.pattern.test(corpus)) facts.push(`${rule.statement} (declared by the descriptor text)`);
  for (const rule of FIELD_SUFFIX_RULES) { const fields = [...input.names, ...output.names].filter((name) => rule.pattern.test(name)); if (fields.length > 0) facts.push(`${rule.statement}: ${[...new Set(fields)].sort().map((name) => `\`${name}\``).join(", ")}`); }
  const bindingModule = descriptor.binding.module ?? "";
  for (const declaration of DOMAIN_UNIT_DECLARATIONS) if (declaration.modules.includes(bindingModule) && (!declaration.when || declaration.when(descriptor))) facts.push(`${declaration.statement} (${declaration.evidence.file})`);
  const kind = computationKind(descriptor.toolId);
  if (kind) {
    const fields = Object.entries(kind.numberFields).map(([name, field]) => `\`${name}\` in ${field.unit} (${field.minimum} to ${field.maximum}${field.integer ? ", integer" : ""})`);
    facts.push(fields.length > 0 ? `the computation catalog declares each number field's unit and bounds (app/lib/computation/catalog.ts): ${fields.join("; ")}` : "the computation catalog declares no number field for this kind (digests and enums only; app/lib/computation/catalog.ts)");
  }
  return facts;
}

// ── Handler families (the gateway's dispatch, mirrored) ─────────────────────────────────────────────────────────────────────────────

export type HandlerFamily = "read" | "external-read" | "mcp-observation" | "computation" | "pcb-sync-preflight" | "catalog-inspection" | "missing-facts" | "view-session" | "sealed-proposal" | "layout-proposal" | "generation-proposal" | "draft-request-proposal" | "module-contract-proposal" | "stackup-proposal" | "granted-execution" | "not-callable" | "unclassified"; // [PR-F fE] + stackup-proposal (its own pure compile and sealing service) // [PR-F fD] + module-contract-proposal (its own validating and sealing service) // [PR-F fB] + missing-facts (its own read service over the UI's derivation) and draft-request-proposal (its own sealing service)
/** The families an exposed tool may resolve to (never `not-callable` or `unclassified`). */
export const CLASSIFIED_HANDLER_FAMILIES: readonly HandlerFamily[] = Object.freeze(["read", "external-read", "mcp-observation", "computation", "pcb-sync-preflight", "catalog-inspection", "missing-facts", "view-session", "sealed-proposal", "layout-proposal", "generation-proposal", "draft-request-proposal", "module-contract-proposal", "stackup-proposal", "granted-execution"]); // [PR-F fE, 2026-10-17] + the stackup family // [PR-F fD, 2026-10-17] + the module contract family // [PR-F fB, 2026-10-17] + the two PR-F families

/** Which service `createAgentToolGateway` hands a descriptor to (gateway.ts, in its dispatch order), or `not-callable` when the
 *  gateway or the run toolset refuses it; `unclassified` when an exposed descriptor matches no known dispatch (a new builder's tool
 *  whose service this module does not know - the manual says so). */
export function handlerFamilyOf(descriptor: ToolDescriptor): HandlerFamily {
  const d = descriptor;
  const offered = d.agentExposed && d.lifecycle === "active" && d.discovery === "discoverable" && d.callability === "callable";
  if (!offered) return "not-callable";
  if (d.toolId === MCP_OBSERVATION_TOOL_ID && d.binding.status === "bound-external-read") return "mcp-observation";
  if (d.binding.status === "bound-computation") return "computation";
  if (d.binding.status === "bound-external-read") return "external-read";
  if (d.operationClass === "read" && d.binding.status === "bound-read" && d.binding.module === PCB_SYNC_PREFLIGHT_MODULE) return "pcb-sync-preflight"; // [PR-D d2] its own service (no board needed)
  if (d.operationClass === "read" && d.binding.status === "bound-read" && d.binding.module === CATALOG_INSPECTION_MODULE) return "catalog-inspection"; // [PR-D d2] its own service over the injected catalog port
  if (d.operationClass === "read" && d.binding.status === "bound-read" && d.binding.module === MISSING_FACTS_BINDING.module) return "missing-facts"; // [PR-F fB] its own service over the UI's derivation (the catalog port optional)
  if (d.operationClass === "read") return d.binding.status === "bound-read" ? "read" : "unclassified";
  if (d.operationClass === "view-session") return d.binding.status === "bound-view-session" ? "view-session" : "unclassified";
  if (d.toolId === AGENT_GENERATION_PROPOSAL_TOOL_ID) return "generation-proposal";
  if (d.toolId === DRAFT_REQUEST_TOOL_ID && d.binding.status === "bound-proposal") return "draft-request-proposal"; // [PR-F fB] its own sealing service (a refused request is proposal-blocked data)
  if (d.toolId === MODULE_CONTRACT_PROPOSAL_TOOL_ID && d.binding.status === "bound-proposal" && d.binding.module === MODULE_CONTRACT_BINDING.module) return "module-contract-proposal"; // [PR-F fD] its own validating and sealing service (a refused set is proposal-blocked data)
  if (d.toolId === STACKUP_PROPOSAL_TOOL_ID && d.binding.status === "bound-proposal" && d.binding.module === STACKUP_PROPOSAL_BINDING.module) return "stackup-proposal"; // [PR-F fE] its own compile-and-seal service (an unsupported request is proposal-blocked data)
  if (d.operationClass === "propose" && LAYOUT_PROPOSAL_TOOL_IDS.includes(d.toolId)) return "layout-proposal";
  if (d.operationClass === "propose") return [TIER1_PROPOSAL_TOOL_ID, REPLACEMENT_PROPOSAL_TOOL_ID, PCB_PROPOSAL_TOOL_ID].includes(d.toolId) && d.binding.status === "bound-proposal" ? "sealed-proposal" : "unclassified";
  if (d.operationClass === "mutate") return grantedExecutionViolations(d).length === 0 ? "granted-execution" : "not-callable";
  return "not-callable";
}

export interface CodeSource {
  stage: string;
  file: string;
  codes: readonly string[];
  /** `handler`: the module declares them; `tests`: the handler declares none and these are what its tests assert. */
  declaredBy: "handler" | "tests";
  note: string;
}
const handlerCodes = (stage: string, file: string, codes: readonly string[], note: string): CodeSource => ({ stage, file, codes, declaredBy: "handler", note });

/** The refusals every tool shares, before and at the gateway (loop.ts, gateway.ts). */
export const LOOP_CODE_SOURCE: CodeSource = handlerCodes("before the gateway: the run loop (every tool)", "app/lib/agent/loop.ts",
  ["unknown_tool", "budget_exhausted", "invalid_input", "repeated_call", "proposal_exists", "execution_exists", "implementation_failed", "output_too_large_for_model", "invalid_outcome"],
  "an unknown provider name; the run's tool-call budget; arguments over the size limit, not a JSON object or not bounded plain JSON; the same call beyond maxIdenticalCalls; a second proposal or grant in one run (single-flight); a handler that threw; a result over the model's transfer budget; a gateway outcome of no known kind");
export const GATEWAY_CODE_SOURCE: CodeSource = handlerCodes("the gateway (every tool)", "app/lib/agent/gateway.ts", ["not_registered", "context_integrity", "invalid_input"],
  "no descriptor of this id and version; the actor / discovery / resource integrity check (verifyAgentContextIntegrity) found a divergence; arguments that are not bounded plain JSON after normalization");
const READ_CODES = handlerCodes("the handler: ReadToolInvocationService (fresh discovery, role and capability recheck, the sealed resource bundle, the binding's own validation and output verification)", "app/lib/engineering/tool-invocation.ts", READ_FAILURE_STATUSES, "READ_FAILURE_STATUSES: the service's closed vocabulary; resource-provenance and authority-status failures are never collapsed into a generic failure");
const READ_GATEWAY_CODES = handlerCodes("the gateway's read path", "app/lib/agent/gateway.ts", ["authority_unavailable"], "no complete validated canonical project state exists for the run, so no resource bundle can be assembled");
const BOARD_PAGE_CODES = handlerCodes("in-result refusals (the read succeeds and its page carries a closed refusal instead of items)", "app/lib/pcb/ai/board-pages.ts", [...BOARD_PAGE_REFUSALS, ITEM_OVER_BUDGET], "BOARD_PAGE_REFUSALS: a wrong or doubled selector, an incomplete or inverted region, an unknown layer or net, an invalid or stale cursor; ITEM_OVER_BUDGET: one item larger than a whole page, refused by kind and id, never truncated");
const EXTERNAL_READ_CODES = handlerCodes("the handler: ExternalReadInvocationService over the server-injected acquisition port", "app/lib/agent/acquisition-reads.ts",
  ["not_registered", "not_callable", "context_integrity", "authority_unavailable", "not_discoverable", "unauthorized", "invalid_input", "cancelled", "timeout", "implementation_failed", "invalid_output"],
  "the allowlisted external-read binding; the server's acquisition fact and canonical state; fresh discovery; role and capability; exact keys, safe JSON, schema and the exact-MPN rule; the port's deadline; a port answer the closed projection rejects; an answer over the output budget or outside its schema");
const MCP_SERVICE_CODES = handlerCodes("the handler: McpObservationReadService over the server-injected external tool port", "app/lib/agent/mcp-observation-reads.ts",
  ["not_registered", "not_callable", "context_integrity", "authority_unavailable", "not_discoverable", "unauthorized", "invalid_input", "cancelled", "disclosure_prohibited", "run_call_limit", "timeout", "implementation_failed", "invalid_output"],
  "one fixed sentence per status (SENTENCES); disclosure_prohibited: the committed registry forbids showing the server to the assistant; run_call_limit: the run's MAX_MCP_NETWORK_OPERATIONS_PER_RUN is spent");
const MCP_PORT_CODES = handlerCodes("the port's closed refusals, passed through as the status (with the call's attribution)", "app/lib/agent/mcp-observation-reads.ts", MCP_PORT_REFUSAL_CODES, "MCP_PORT_REFUSAL_CODES (D18): a refusal of the port after the server was asked, or before anything was sent (arguments, pins, disclosure, pause)");
const COMPUTATION_CODES = handlerCodes("the handler: ComputationReadService over the server-injected computation port (the bounded engine host)", "app/lib/agent/computation-reads.ts",
  ["not_registered", "not_callable", "context_integrity", "authority_unavailable", "not_discoverable", "unauthorized", "invalid_input", "cancelled", "timeout", "implementation_failed", "invalid_output", "artifact_not_found", "busy", "engine_unavailable", "resource_limit"],
  "the catalog's closed input; the engine host's refusals mapped by REFUSAL_STATUS (ARTIFACT_NOT_FOUND, ENGINE_HOST_BUSY, ENGINE_UNAVAILABLE, the input refusals) and a hard stop mapped by TERMINATED_STATUS (budget, cancelled, resource-limit); the kind's output validator refuses the whole result");
const VIEW_GATEWAY_CODES = handlerCodes("the gateway's view-session path", "app/lib/agent/gateway.ts", ["not_callable", "not_discoverable", "unauthorized"], "only a bound, exposed view-session tool; fresh discovery; the descriptor's roles and capability");
const VIEW_PREPARE_CODES = handlerCodes("the handler: prepareViewCommandRequest (the registry command list, the captured surface, the board, the command's role gate and payload contract)", "app/lib/agent/view-context.ts",
  ["invalid_input", "view_command_unknown", "view_surface_unavailable", "authority_unavailable"], "arguments naming no command of the tool or failing the command's own validation, a command outside the descriptor's viewCommands, no captured view or surface for the editor, no validated board for a PCB / 3D command");
const VIEW_BUS_CODES = handlerCodes("the browser's view bus (the request is dispatched there; a refusal reaches the user, the model learns only that the request was dispatched)", "app/lib/view-session/types.ts", VIEW_REFUSAL_CODES, "VIEW_REFUSAL_CODES: the bus's envelope, session, project and editor checks, its stale-revision rule (VS_STALE_REVISION), its role gate and the command handler's own refusal");
const PROPOSAL_SERVICE_CODES = handlerCodes("the handler: ProposalInvocationService (the allowlisted sealed-proposal bindings)", "app/lib/agent/gateway.ts",
  ["not_registered", "not_callable", "context_integrity", "not_discoverable", "unauthorized", "authority_unavailable", "invalid_input", "stale_revision"],
  "exact descriptor and class; the integrity check; fresh discovery; role AND capability of the effective actor; the verified schematic snapshot and canonical head mark (or the verified board and PCB basis); strict arguments; a sealed base digest that must equal the run's verified snapshot");
const TIER1_BLOCKERS = handlerCodes("compile blockers (`proposal-blocked`, the whole proposal refused)", "app/lib/engineering/schematic-plans.ts", ["empty-proposal", "unknown-target", "unsupported-theory-rename", "pins-unavailable", "delete-plan-refused"], "Tier1BlockerCode: all-or-nothing; the seal adds delete-plan-refused when no scope, head mark or authorization binding is available (schematic-proposals.ts)");
const TIER1_APPLY_CODES = handlerCodes("apply-time verification at the human review boundary (verifySealedTier1Proposal; never a tool outcome)", "app/lib/engineering/schematic-proposals.ts", ["malformed", "wrong-version", "legacy-authorization-missing", "altered", "stale-base", "foreign-scope", "stale-head", "expired"], "the artifact is re-verified structurally and against the live scope, head and schematic before anything applies");
const REPLACEMENT_BLOCKERS = handlerCodes("assembler blockers (`proposal-blocked`)", "app/lib/engineering/replacement-proposal-assembler.ts",
  ["unknown-component", "theory-component-unsupported", "authority-not-verified-exact", "expected-mpn-mismatch", "already-installed", "current-authority-missing", "current-pin-authority-unavailable", "target-pin-authority-unavailable", "mapping-certificate-mismatch", "canonical-head-mismatch", "authority-consumption-refused", "replacement-plan-refused"],
  "ReplacementBlocker: server-owned authority, published pin facts and the one replacement plan; a dropped connected pin is a blocker, never a warning");
const REPLACEMENT_APPLY_CODES = handlerCodes("apply-time verification at the human review boundary (verifySealedReplacementProposal; never a tool outcome)", "app/lib/engineering/replacement-proposals.ts", ["malformed", "wrong-version", "legacy-authorization-missing", "altered", "stale-base", "foreign-scope", "stale-head", "expired"], "re-verified with fresh server authority, a recompiled plan byte-match and a fresh runtime grant");
const PCB_HANDLER_CODES = handlerCodes("the handler: handlePcbProposeTool (the one agent-facing handler; strict {intent, operations})", "app/lib/pcb/proposal/pcb-propose-tool-handler.ts", ["invalid_input", "authority_unavailable"], "an unknown argument key or a missing intent / operations; no verified canonical board, no PCB history basis, or a validation preset the canonical registry does not hold");
const PCB_PARSE_BLOCKERS = handlerCodes("request parse blockers (`proposal-blocked`; parseBoundedEditRequest)", "app/lib/pcb/proposal/bounded-edit-operations.ts", ["malformed", "unknown-field", "too-many-operations", "too-large", "too-deep", "excluded-operation", "unknown-operation", "invalid-value", "hostile-input"], "BoundedEditRefusalCode: closed per-kind key sets, at most 16 operations, the 32,768-byte ceiling, excluded destructive intents");
const PCB_COMPILE_BLOCKERS = handlerCodes("bounded compile blockers (`proposal-blocked`)", "app/lib/pcb/proposal/bounded-edit-compiler.ts", ["unknown-object", "locked-object", "invalid-layer", "invalid-net", "invalid-padstack", "escapes-board", "drc-regression", "connectivity-regression", "new-short", "weakened-minimum", "not-canonical"], "BoundedEditCompileRefusalCode: structure, locks, geometry inside the exact outline, rules floors, DRC and connectivity no-regression, canonical expressibility");
const PCB_SERVICE_BLOCKERS = handlerCodes("sealing service blockers", "app/lib/pcb/proposal/pcb-edit-proposal-service.ts", ["inconsistent-compilation", "invalid-validation-policy"], "a recompile that disagrees with itself; a DRC preset the canonical registry does not hold (surfaced as authority_unavailable by the handler)");
const LAYOUT_CODES = handlerCodes("the handler: LayoutProposalService (the shared placement / routing candidate producers)", "app/lib/agent/layout-proposals.ts",
  ["not_registered", "not_callable", "not_discoverable", "unauthorized", "authority_unavailable", "invalid_input", "no_candidate", "routing_engine_unavailable", "routing_failed"],
  "exact allowlisted descriptor; fresh discovery; role AND capability; a verified canonical board; strict keys and bounds (instanceIds / candidateCount / maxIterations / intent; netIds); an engine that produced nothing; no wired routing engine for the run; a routing engine failure (details redacted)"); // [PR-F fE] + intent among the strict keys
const INTENT_BLOCKERS = handlerCodes("placement intent compile blockers (`proposal-blocked`, the whole proposal refused with every blocker listed; compilePlacementIntent)", "app/lib/pcb/placement/intent.ts",
  ["intent-malformed", "units-unsupported", "frame-unsupported", "empty-intent", "too-many-items", "unknown-component", "identity-mismatch", "unknown-net", "unknown-pad", "unknown-region", "duplicate-id", "polygon-malformed", "value-out-of-range"],
  "PlacementIntentBlockerCode: the schema / units / frame literals; at most MAX_INTENT_LIST_ITEMS per list; a component is { ref, instanceId } and BOTH must name the same footprint of this board revision; a net is { name, id } and both must name the same board net; a pad must exist on its component; a region id must be the intent's own; ids and placements are unique; polygons have 3 to 32 corners and an area; coordinates and distances are finite millimetres within 10 m"); // [PR-F fE, 2026-10-17]
const STACKUP_CODES = handlerCodes("the handler: StackupProposalService (the exact binding, the verified board, the closed request and the pure compile; no port)", "app/lib/agent/stackup-proposals.ts",
  ["not_registered", "not_callable", "context_integrity", "authority_unavailable", "not_discoverable", "unauthorized", "invalid_input", "cancelled", "implementation_failed"],
  "the one stackup binding; the integrity check; a verified canonical board with its revision digest; fresh discovery; role and capability; the request's keys only (authority-shaped keys refused by name; the unsupported-capability keys pass through to the compiler so their refusal carries the exact reason); cancellation before the compile"); // [PR-F fE, 2026-10-17]
const STACKUP_BLOCKERS = handlerCodes("compile blockers (`proposal-blocked`, the whole recommendation refused with every blocker listed; compileStackupCandidate)", "app/lib/pcb/candidates/stackup-candidate.ts",
  ["request-malformed", "unsupported-via-technology", "unsupported-material", "unsupported-impedance", "unsupported-layer-count", "unsupported-profile", "unsupported-manufacturing-profile", "profile-layer-mismatch", "plane-layer-not-plane", "unknown-net", "unknown-padstack", "duplicate-id"],
  `StackupCandidateBlockerCode: every unsupported capability (blind / buried / micro / via-in-pad / stacked vias, materials, dielectrics, copper weights, thicknesses, impedance, other layer counts, a profile or manufacturing preset outside the tree's) carries the one reason "${UNSUPPORTED_CHAIN_REASON}"; the profile's copper layer count must equal the preset's fab bundle; a plane only on a plane layer of the profile with an exact board net; via profiles only among the board's padstacks and the class defaults`); // [PR-F fE, 2026-10-17]
const GENERATION_CODES = handlerCodes("the handler: SchematicGenerationProposalService over the chat route's injected generation port", "app/lib/agent/generation-proposals.ts",
  ["not_registered", "not_callable", "context_integrity", "authority_unavailable", "not_discoverable", "unauthorized", "invalid_input", "cancelled", "budget_exhausted", "implementation_failed", "timeout"],
  "the one generation binding; the integrity check; the server's generation fact and port, a validated schematic and its head mark; fresh discovery; role and capability; exactly `prompt` (authority-shaped keys refused by name) within 1 to MAX_GENERATION_PROMPT_CHARS; the run's remaining wall clock below MIN_GENERATION_BUDGET_MS; the port's race timer");
const GENERATION_BLOCKERS = handlerCodes("a failed generation as `proposal-blocked` data (generationFailureBlockers; never ok)", "app/lib/schematic/build-result.ts", ["provider_unavailable", "build_budget_exhausted", "build_loop_failed", "build_invalid_output"], "BuildFailureCode: the failure class the route answers too");
const GENERATION_BLOCKER_FLAGS = handlerCodes("the blocker rows beside the failure class", "app/lib/agent/generation-proposals.ts", ["retryable", "not_retryable", "provider", "provider_reason"], "whether a retry can help, the provider and its reason when known");
const GENERATION_INTAKE_CODES = handlerCodes("intake verification at the review dialog (verifySealedSchematicGenerationProposalIntegrity; never a tool outcome)", "app/lib/agent/generation-proposals.ts", ["malformed", "wrong-version", "altered"], "schema, exact key set and both sealed digests; currency (base digest, scope, head mark, expiry) is the intake's own check against the live editor");
const DISPATCH_CODES = handlerCodes("the handler: dispatchGrantedExecution (re-discovery, role recheck, the pure seal, the base, the composition root's minter)", "app/lib/agent/execution-dispatch.ts",
  ["not_callable", "execution_unavailable", "invalid_input", "not_discoverable", "unauthorized", "authority_unavailable", "grant_unavailable"],
  "not a reviewed granted execution; no minter or prompt version bound to the run; no provider call id; not discoverable now; a role outside the descriptor's roles or TIER1_EXECUTE_ROLES; no verified board with a PCB history basis; a minter that threw");
const SEAL_CODES = handlerCodes("the pure seal (sealExecutionIntent: the family's argument contract and the kernel binding)", "app/lib/agent/execution-intents.ts", ["not_callable", "unauthorized", "authority_unavailable", "invalid_input", "tier_exceeded", "kind_not_allowed"], "a non-canonical binding or a command outside the execution families; a role or an ungrantable capability; no verified board with a basis; the family's argument contract (1-16 targets, integer nanometres, exact keys, no authority-shaped key); a permission tier other than 1; an operation kind outside the family's kernel binding");
const MINTER_CODES = handlerCodes("the server minter (AgentExecutionGrantOutcome; the decision of permission-tiers.ts)", "app/lib/agent/contracts.ts", ["execution_not_permitted", "grant_unavailable", "nothing_to_replay"], "decideAgentExecution answered never or proposal_only; the grant store is unavailable; an undo / redo with nothing of this principal's to replay at the verified head");
const SETTLEMENT_CODES = handlerCodes("after an execute_explicit grant: what the DURABLE settlement reports to the model (loop.ts)", "app/lib/agent/loop.ts", ["execution_not_committed", "execution_retired", "execution_unsettled", "execution_poisoned"], "the editor refused or the commit failed (nothing changed); the grant was retired first (nothing changed); the editor did not report in time (the model must not claim the change); a transaction landed but could not be verified against the grant (the user must inspect the board)");
const RITUAL_CODES = handlerCodes("the browser's granted-execution ritual (GrantedExecutionRefusalCode; refusals reach the user's card, and the durable settlement, never the model directly)", "app/lib/engineering/granted-executions.ts",
  ["grant-invalid", "grant-expired", "confirmation-required", "session-superseded", "foreign-scope", "already-in-flight", "identity-poisoned", "recovery-required", "stale-revision", "stale-history", "stale-lineage", "stale-selection", "policy-mismatch", "recompile-mismatch", "consume-refused", "commit-rejected", "execution-failed", "precheck-refused"],
  "verification of the grant, its expiry, scope and session; the one-shot claim; durable replay evidence; drift of the revision, history head, lineage, DRC policy or selection since the grant was issued; a recompile that no longer matches; the server's consume; the canonical commit");
const PREFLIGHT_CODES = handlerCodes("the handler: PcbSyncPreflightReadService (the pure preflight report over the run's verified schematic snapshot; no board, no server call)", "app/lib/agent/pcb-sync-preflight-reads.ts",
  ["not_registered", "not_callable", "context_integrity", "authority_unavailable", "not_discoverable", "unauthorized", "invalid_input", "cancelled", "implementation_failed", "invalid_output"],
  "the one preflight binding; the integrity check; a verified schematic snapshot with its digest; fresh discovery; role and capability; NO arguments (an authority-shaped key refused by name); the report must fit its output schema and the B05 output limits");
const CATALOG_INSPECTION_CODES = handlerCodes("the handler: CatalogInspectionReadService over the chat route's injected catalog port (app/api/chat/catalog-inspection-runtime.ts)", "app/lib/agent/catalog-inspection-reads.ts",
  ["not_registered", "not_callable", "context_integrity", "authority_unavailable", "not_discoverable", "unauthorized", "invalid_input", "cancelled", "timeout", "implementation_failed", "invalid_output"],
  "the one catalog binding; the integrity check; the server's catalog fact and port; fresh discovery; role and capability; exactly `partId` matching CATALOG_PART_ID_PATTERN (authority-shaped keys refused by name); the port's deadline; a port failure with a closed code; a projection outside the output schema. A part that is not in the catalog is DATA (`found: false`), never a refusal");
const MISSING_FACTS_CODES = handlerCodes("the handler: MissingFactsReadService (the UI's one derivation over the run's verified schematic snapshot; the catalog facts through the chat route's injected catalog port when bound)", "app/lib/agent/missing-facts-reads.ts",
  ["not_registered", "not_callable", "context_integrity", "authority_unavailable", "not_discoverable", "unauthorized", "invalid_input", "cancelled", "implementation_failed", "invalid_output"],
  "the one missing-facts binding; the integrity check; a verified schematic snapshot with its digest; fresh discovery; role and capability; NO arguments (an authority-shaped key refused by name); the report must fit its output schema and the B05 output limits. A catalog miss, a failed or late catalog read, or no bound catalog are DATA per instance (the fact's source says catalog unavailable), never a refusal");
const DRAFT_REQUEST_CODES = handlerCodes("the handler: PartDraftRequestProposalService (the closed request, the optional catalog cross-check through the injected port, the pure compile and the unverified seal)", "app/lib/agent/draft-request-proposals.ts",
  ["not_registered", "not_callable", "context_integrity", "authority_unavailable", "not_discoverable", "unauthorized", "invalid_input", "cancelled", "implementation_failed"],
  "the one draft request binding; the integrity check; a verified schematic snapshot with its digest; fresh discovery; role and capability; the request's keys only (authority-shaped keys and the symbol / footprint references refused by name; refDes required); cancellation before or during the catalog read");
const DRAFT_REQUEST_BLOCKERS = handlerCodes("compile blockers (`proposal-blocked`, the whole request refused with every blocker listed; compilePartDraftRequest)", "app/lib/agent/draft-request-proposals.ts",
  ["instance-missing", "instance-not-unresolved", "source-label-missing", "identity-malformed", "identity-missing", "pin-table-missing", "pin-table-malformed", "pin-table-conflict", "package-malformed", "geometry-malformed", "datasheet-malformed", "missing-malformed", "fact-conflict", "identity-conflict", "incompatible-package", "pin-count-conflict", "profile-malformed", "pcb-assignable-blocked"],
  "the instance must be one the editor's refusal list names; every given fact carries its source label; an exact MPN and a manufacturer are required; a pin table is required, with unique pin numbers and a pad mapped by one pin; a fact both given and listed missing conflicts; with the catalog port bound, the placed part's MPN, manufacturer, package and pin count must agree (a different part is never substituted silently); the pcb_assignable profile needs every C.4 fact");
const DRAFT_REQUEST_INTAKE_CODES = handlerCodes("intake verification (verifySealedPartDraftRequestIntegrity; never a tool outcome)", "app/lib/agent/draft-request-proposals.ts", ["malformed", "wrong-version", "altered"], "schema, exact key set, the constant verification unverified, a pin table and no asset reference, both sealed digests");
const MODULE_CONTRACT_CODES = handlerCodes("the handler: ModuleContractProposalService (the closed set, the one validator against the pinned schematic and the seal; no port)", "app/lib/agent/module-contract-proposals.ts",
  ["not_registered", "not_callable", "context_integrity", "authority_unavailable", "not_discoverable", "unauthorized", "invalid_input", "cancelled", "implementation_failed"],
  "the one module contract binding; the integrity check; a verified schematic snapshot with its digest and its canonical head mark; fresh discovery; role and capability; exactly system, modules and constraints (authority-shaped keys refused by name; each of the three required); cancellation before the validation"); // [PR-F fD, 2026-10-17]
const MODULE_CONTRACT_BLOCKERS = handlerCodes("validation blockers (`proposal-blocked`, the whole set refused with every blocker listed; validateModuleContractSet)", "app/lib/engineering/module-contract.ts", MODULE_CONTRACT_REFUSAL_CODES,
  "the set's shape; a sheet over the qualified scope of physical instances; module shape and duplicate ids; a component the sheet does not hold, an ambiguous reference, a stated part or revision id that disagrees, a component owned twice; a port's shape, an unnamed net, a fact neither stated nor listed unknown; a value without a unit; evidence without a source or malformed, a stated port fact without evidence; a requirement's shape or missing evidence, a topic neither stated, unknown nor not applicable (or more than one), a part-authority gap claimed falsely or hidden; a test's shape; a constraint's shape, an unnamed net, an unknown module, missing evidence, a shared resource without its owner, two owners of one net; a shared net no constraint states, a driver-to-receiver net without its loading (stated or declared unknown), a shared reference without its owner");
const MODULE_CONTRACT_INTAKE_CODES = handlerCodes("intake verification (verifySealedModuleContractProposalIntegrity; never a tool outcome)", "app/lib/agent/module-contract-proposals.ts", ["malformed", "wrong-version", "altered"], "schema, exact key set, the constant verification contract-structure-checked, the electrical check not run, both sealed digests");
const NOT_CALLABLE_CODES = handlerCodes("a direct gateway invocation of a tool the run never offers", "app/lib/agent/gateway.ts", ["not_callable", "not_discoverable"], "the run toolset lists only what discovery includes on the assistant-agent channel, so the model's call is unknown_tool at the loop; a direct invocation refuses not_discoverable (reason not_agent_exposed) or not_callable");

/** Every code source this module renders (the gate finds each code quoted in its file). */
export const HANDLER_CODE_SOURCES: readonly CodeSource[] = Object.freeze([
  LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, READ_CODES, READ_GATEWAY_CODES, BOARD_PAGE_CODES, EXTERNAL_READ_CODES, MCP_SERVICE_CODES, MCP_PORT_CODES, COMPUTATION_CODES,
  VIEW_GATEWAY_CODES, VIEW_PREPARE_CODES, VIEW_BUS_CODES, PROPOSAL_SERVICE_CODES, TIER1_BLOCKERS, TIER1_APPLY_CODES, REPLACEMENT_BLOCKERS, REPLACEMENT_APPLY_CODES,
  PCB_HANDLER_CODES, PCB_PARSE_BLOCKERS, PCB_COMPILE_BLOCKERS, PCB_SERVICE_BLOCKERS, LAYOUT_CODES, GENERATION_CODES, GENERATION_BLOCKERS, GENERATION_BLOCKER_FLAGS, GENERATION_INTAKE_CODES,
  DISPATCH_CODES, SEAL_CODES, MINTER_CODES, SETTLEMENT_CODES, RITUAL_CODES, PREFLIGHT_CODES, CATALOG_INSPECTION_CODES, NOT_CALLABLE_CODES,
  MISSING_FACTS_CODES, DRAFT_REQUEST_CODES, DRAFT_REQUEST_BLOCKERS, DRAFT_REQUEST_INTAKE_CODES, // [PR-F fB, 2026-10-17]
  MODULE_CONTRACT_CODES, MODULE_CONTRACT_BLOCKERS, MODULE_CONTRACT_INTAKE_CODES, // [PR-F fD, 2026-10-17]
  INTENT_BLOCKERS, STACKUP_CODES, STACKUP_BLOCKERS, // [PR-F fE, 2026-10-17]
]);

interface FamilyProfile {
  /** The handler module the gateway dispatches to (null: none). */
  handler: string | null;
  /** The gateway outcome kind on success (null: never invoked). */
  outcomeKind: string | null;
  requirements: string[];
  effect: string;
  postconditions: string[];
  codes: CodeSource[];
  budget: string[];
}

function profileOf(descriptor: ToolDescriptor, family: HandlerFamily): FamilyProfile {
  const d = descriptor;
  const kind = computationKind(d.toolId);
  switch (family) {
    case "read": return {
      handler: "app/lib/engineering/tool-invocation.ts (ReadToolInvocationService) over the run's sealed resource bundle (app/lib/agent/context.ts buildAgentResourceBundle)",
      outcomeKind: "read",
      requirements: ["a complete validated canonical project state for the run (`canonicalState` and `canonicalRevisionDigest`; otherwise `authority_unavailable`)", "the B05/B05.1 resource bundle sealed fresh per invocation; the binding's own resource must be present (see the binding notes)", "arguments under the B05 input limits (DEFAULT_INPUT_LIMITS) and the input schema; the bound implementation's own validation"],
      effect: `the bound read runs over the sealed resources and answers its output pinned to the source revision; side effects: \`${d.sideEffects}\` (${d.sideEffects === "none" ? "nothing is written" : "a derived cache only, never engineering state"})`,
      postconditions: ["engineering state is unchanged", "the result carries `sourceRevisionDigest` (the run's canonical revision) and a verification state", `the loop reports \`succeeded\`; a result over ${MAX_RESULT_CHARS} characters is replaced by \`output_too_large_for_model\``],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, READ_GATEWAY_CODES, READ_CODES, ...(d.binding.module === "app/lib/pcb/ai/board-pages.ts" ? [BOARD_PAGE_CODES] : [])],
      budget: [],
    };
    case "external-read": return {
      handler: "app/lib/agent/acquisition-reads.ts (ExternalReadInvocationService) over the port the chat route injects (app/api/chat/external-acquisition-runtime.ts)",
      outcomeKind: "read",
      requirements: ["the server's external acquisition fact for the run (`externalAcquisitionAvailable`) and the injected port; otherwise `authority_unavailable`", "a complete validated canonical project state", "exact argument keys of the binding; printable-ASCII exact MPNs, de-duplicated"],
      effect: `a bounded sourcing observation is read (cache first; live only where the source's terms permit and the run's live budget allows); side effects: \`${d.sideEffects}\` (the connector's own in-process memo); nothing is placed, bound, published or acquired`,
      postconditions: ["engineering state is unchanged; the answer is an observation, never authority", "the closed projection of the port's answer (registry sources, closed statuses, ISO times, requested MPNs only; vendor values only for a permitting source) is returned, bounded", "the run's live-MPN budget is charged before a vendor is asked"],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, EXTERNAL_READ_CODES],
      budget: [`at most ${MAX_EXTERNAL_SEARCH_MPNS} MPNs per call and ${MAX_LIVE_MPNS_PER_RUN} live MPNs per run (MAX_EXTERNAL_SEARCH_MPNS, MAX_LIVE_MPNS_PER_RUN; app/lib/agent/acquisition-reads.ts)`, `the answer is at most ${MAX_EXTERNAL_READ_OUTPUT_CHARS} characters (MAX_EXTERNAL_READ_OUTPUT_CHARS)`],
    };
    case "mcp-observation": return {
      handler: "app/lib/agent/mcp-observation-reads.ts (McpObservationReadService) over the port the chat route injects (app/api/chat/mcp-observation-runtime.ts)",
      outcomeKind: "read (servers / tools) or external-observation (call: with the call's attribution)",
      requirements: ["the server's external tool fact for the run (`mcpObservationAvailable`) and the injected port; otherwise `authority_unavailable`", "a complete validated canonical project state", "all four keys present; the per-operation empty-string rules; `argumentsJson` a bounded plain JSON object text with no secret shape and no run identity", "the server must be on the run's roster and its registry row must not prohibit disclosure"],
      effect: `one roster read, one pinned catalog read or one tool call of an approved, pinned MCP server; side effects: \`${d.sideEffects}\` (the per-run negotiation memo and the listing cache); the answer is an untrusted observation under untrusted keys, never an instruction`,
      postconditions: ["engineering state is unchanged; nothing is written to any server", "a roster, a pinned catalog (schema-node text removed) or an observation record's labels, bounded and re-validated; untrusted text only where the committed registry permits it", "the run's operation budget is charged per server operation (`servers` is free)"],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, MCP_SERVICE_CODES, MCP_PORT_CODES],
      budget: [`at most ${MAX_MCP_NETWORK_OPERATIONS_PER_RUN} server operations per run (MAX_MCP_NETWORK_OPERATIONS_PER_RUN); arguments at most ${MCP_AGENT_ARGUMENTS_MAX_CHARS} characters (MCP_AGENT_ARGUMENTS_MAX_CHARS); the answer at most ${MAX_MCP_OUTPUT_CHARS} characters (MAX_MCP_OUTPUT_CHARS; app/lib/agent/mcp-observation-reads.ts)`],
    };
    case "computation": return {
      handler: "app/lib/agent/computation-reads.ts (ComputationReadService) over the port the chat route injects (app/api/chat/computation-runtime.ts): the bounded engine host, a worker thread stopped hard at the kind's budget",
      outcomeKind: "read",
      requirements: ["the server's computation fact for the run (`computationAvailable`) and the injected port; otherwise `authority_unavailable`", "the catalog kind's closed input (its selector enum and exactly its own bounded finite numbers; digests of the closed grammar)", "a digest-named artifact must be one the server holds for this run"],
      effect: `one named computation runs in the bounded engine host; side effects: \`${d.sideEffects}\` (the result is held in process memory for this run so a later call can name it by digest); the answer is computation evidence, never engineering authority and never a simulation`,
      postconditions: ["engineering state is unchanged", "the kind's typed output validator accepted the whole result (closed quantity names and units, finite values, digests); a refused result is refused whole", "the result's `resultDigest` can be named by a later comparison or parse in the same run"],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, COMPUTATION_CODES],
      budget: kind ? [`the catalog kind's budget: wall clock ${kind.budget.wallClockMs} ms, output at most ${kind.budget.maxOutputBytes} bytes, heap ${kind.budget.heapMiB} MiB (app/lib/computation/catalog.ts)`] : ["the computation catalog holds no kind of this id (budget not declared)"],
    };
    case "pcb-sync-preflight": return {
      handler: "app/lib/agent/pcb-sync-preflight-reads.ts (PcbSyncPreflightReadService) -> buildPcbSyncPreflightReport (app/lib/pcb-sync/preflight-read.ts), the SAME unresolved-instance checks the editor's Prepare PCB runs before its first server call",
      outcomeKind: "read",
      requirements: ["a verified schematic snapshot with its digest for the run (`schematic`, `schematicDigest`); otherwise `authority_unavailable` - no board is needed (Prepare PCB exists to make the first board)", "NO arguments: any key refuses (`invalid_input`; an authority-shaped key is refused by name)"],
      effect: `the pure preflight report is built over the run's verified schematic snapshot (the server stages travel as \`not_run\` inside it); side effects: \`${d.sideEffects}\` - nothing is bound, published, preflighted on the server or applied; the user runs Prepare PCB in the PCB editor`,
      postconditions: ["engineering state is unchanged; no server call was made", "the result's `sourceRevisionDigest` is the schematic snapshot digest and its verification is `schematic-snapshot-verified`; the report fits its output schema and the B05 output limits"],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, PREFLIGHT_CODES],
      budget: [],
    };
    case "catalog-inspection": return {
      handler: "app/lib/agent/catalog-inspection-reads.ts (CatalogInspectionReadService) over the port the chat route injects (app/api/chat/catalog-inspection-runtime.ts) -> loadCatalogPartDetail (app/lib/atomic/catalog-part-detail.ts), the SAME read the parts detail route answers the browser with",
      outcomeKind: "read",
      requirements: ["the server's catalog fact for the run (`catalogInspectionAvailable`: the catalog authority) and the injected port; otherwise `authority_unavailable` - no board and no schematic are needed", "exactly `partId` matching CATALOG_PART_ID_PATTERN (1 to 128 characters of letters, digits, dot, underscore, colon or hyphen); authority-shaped keys are refused by name"],
      effect: `one part of Sirkit's own catalog is read by its part id and projected CLOSED and bounded (no raw symbol text, no properties blob, no links; at most MAX_INSPECTED_PINS pins, MAX_INSPECTED_KEYS keys, MAX_INSPECTED_TEXT_CHARS characters per text); side effects: \`${d.sideEffects}\`; no distributor is called; nothing is placed, bound or published`,
      postconditions: ["engineering state is unchanged", "the result's verification is `catalog-read` (a server catalog read at the time of the call, never pinned to a project revision); a part that is not in the catalog is `found: false` data, never an error"],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, CATALOG_INSPECTION_CODES],
      budget: ["the projection is bounded by MAX_INSPECTED_PINS 128, MAX_INSPECTED_KEYS 64 and MAX_INSPECTED_TEXT_CHARS 300 (app/lib/agent/catalog-inspection-reads.ts)"],
    };
    case "missing-facts": return {
      handler: "app/lib/agent/missing-facts-reads.ts (MissingFactsReadService) -> deriveMissingFacts (app/lib/parts/missing-facts.ts), the SAME checklist the editor's missing-parts list renders, over listUnresolvedInstances (app/lib/pcb-sync/unresolved-instances.ts); the catalog facts through the port the chat route injects for the catalog inspection (app/api/chat/catalog-inspection-runtime.ts) when bound",
      outcomeKind: "read",
      requirements: ["a verified schematic snapshot with its digest for the run (`schematic`, `schematicDigest`); otherwise `authority_unavailable` - no board is needed", "NO arguments: any key refuses (`invalid_input`; an authority-shaped key is refused by name)", `the catalog port is OPTIONAL: with the server's catalog fact the placed parts are read through it (once per distinct part id, under the call's deadline); without it every identity and evidence fact is unknown with the source "${CATALOG_UNAVAILABLE}" - never a guess`],
      effect: `the editor's refusal list is derived over the run's verified schematic snapshot and each unresolved instance's checklist (identity, evidence, stock/pricing facts with their states and sources; the next actions with their availability) is built by the UI's one derivation; side effects: \`${d.sideEffects}\` - nothing is placed, bound, published, searched at a distributor or bought`,
      postconditions: ["engineering state is unchanged; no distributor was called", `the result's \`sourceRevisionDigest\` is the schematic snapshot digest; its verification is \`${MISSING_FACTS_VERIFICATION}\`, or \`${MISSING_FACTS_VERIFICATION_WITH_CATALOG}\` when the catalog facts were read at the time of the call; the report (\`${MISSING_FACTS_REPORT_SCHEMA}\`) fits its output schema and the B05 output limits`, `at most ${MAX_MISSING_FACTS_INSTANCES} checklists are listed, the rest counted; a sourcing observation never makes an identity or evidence fact known; a Theory symbol is not a physical part`],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, MISSING_FACTS_CODES],
      budget: [`at most ${MAX_MISSING_FACTS_INSTANCES} instances listed (MAX_MISSING_FACTS_INSTANCES; app/lib/agent/missing-facts-reads.ts); the catalog reads share the call's deadline`],
    };
    case "view-session": return {
      handler: "app/lib/agent/view-context.ts (prepareViewCommandRequest); the browser dispatches the request on its own view bus (app/lib/agent/view-session-bridge.ts)",
      outcomeKind: "view-command",
      requirements: ["a captured view context for the run with the target editor's surface open (`view.surfaces`); otherwise `view_surface_unavailable`", "a validated board for a PCB or 3D command (`authority_unavailable` otherwise)", "the arguments must name one of the descriptor's `viewCommands` and pass that bus command's own payload validation and role gate", "a selection-relative target pins the captured selection digest; a changed selection refuses on the bus"],
      effect: `the gateway VALIDATES a view-command request and hands it to the browser, which dispatches it on the user's own view session (\`${(d.viewCommands ?? []).join("`, `")}\`); side effects: \`${d.sideEffects}\` - view state only, never engineering state`,
      postconditions: ["engineering state is unchanged", "a `view-command` request with `expectedViewRevision` and a 60 s expiry is emitted (`view_command_ready`); the bus's stale-revision rule, role gate and session scoping decide there", "the model learns only that the request was dispatched (`view_command_dispatched`); the resulting view revision is reported to the user"],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, VIEW_GATEWAY_CODES, VIEW_PREPARE_CODES, VIEW_BUS_CODES],
      budget: [],
    };
    case "sealed-proposal": {
      const tier1 = d.toolId === TIER1_PROPOSAL_TOOL_ID; const replacement = d.toolId === REPLACEMENT_PROPOSAL_TOOL_ID;
      const schema = tier1 ? TIER1_PROPOSAL_SCHEMA : replacement ? REPLACEMENT_PROPOSAL_SCHEMA : PCB_PROPOSAL_SCHEMA;
      const blockers = tier1 ? [TIER1_BLOCKERS, TIER1_APPLY_CODES] : replacement ? [REPLACEMENT_BLOCKERS, REPLACEMENT_APPLY_CODES] : [PCB_HANDLER_CODES, PCB_PARSE_BLOCKERS, PCB_COMPILE_BLOCKERS, PCB_SERVICE_BLOCKERS];
      return {
        handler: tier1 ? "app/lib/agent/gateway.ts (ProposalInvocationService) -> compileTier1Proposal + sealTier1Proposal (app/lib/engineering/schematic-plans.ts, schematic-proposals.ts)"
          : replacement ? "app/lib/agent/gateway.ts (ProposalInvocationService) -> assembleReplacementProposal (app/lib/engineering/replacement-proposal-assembler.ts)"
          : "app/lib/agent/gateway.ts (ProposalInvocationService) -> handlePcbProposeTool -> createSealedPcbEditProposal (app/lib/pcb/proposal/pcb-propose-tool-handler.ts, pcb-edit-proposal-service.ts)",
        outcomeKind: tier1 || replacement ? "proposal" : "pcb-proposal",
        requirements: tier1 ? ["a verified schematic snapshot and its canonical head mark for the run (`schematic`, `schematicDigest`, `schematicHeadMark`); otherwise `authority_unavailable`", "1-20 well-formed set-value / rename / delete operations (parseOps); the compiler blocks the WHOLE proposal on an unknown target, a theory rename or missing pin data"]
          : replacement ? ["a verified schematic snapshot and its canonical head mark; the server-owned component-authority resource and canonical state (`componentAuthority`, `canonicalState`); otherwise `authority_unavailable`", "exactly `componentId` (1-200 chars) and an optional `expectedMpn` assertion; any other key refuses"]
          : ["a verified canonical board and the PCB proposal basis captured by the editor bridge (`canonicalState.pcb`, `pcbProposalBasis`: history head, lineage, active DRC preset); otherwise `authority_unavailable`", "exactly `intent` and `operations`; the canonical parseBoundedEditRequest bounds (closed per-kind key sets, at most 16 operations, the 32,768-byte ceiling) and the full bounded compile"],
        effect: `the proposal compiles all-or-nothing against the exact verified snapshot and is SEALED into a digest-pinned artifact (\`${schema}\`); side effects: \`${d.sideEffects}\` - receiving the artifact changes nothing; apply is a human-only step in the review boundary and is never provider-callable`,
        postconditions: ["engineering state is unchanged", `a sealed artifact (\`${schema}\`) is emitted once (${tier1 || replacement ? "`proposal_ready`" : "`pcb_proposal_ready`"}); the loop reports \`proposal_sealed\` and allows no second proposal or grant in the run`, `at apply the artifact is re-verified against the LIVE state (${d.verificationStrategy})`],
        codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, PROPOSAL_SERVICE_CODES, ...blockers],
        budget: ["one proposal or grant per run (the loop's single-flight: `proposal_exists` / `execution_exists`)"],
      };
    }
    case "layout-proposal": return {
      handler: "app/lib/agent/layout-proposals.ts (LayoutProposalService) -> runPlacementCandidate / runRoutingCandidate (app/lib/pcb/candidates), the SAME producers the editor's own hooks use",
      outcomeKind: "layout-candidate",
      requirements: ["a verified canonical board for the run (`canonicalState.pcb`, `canonicalRevisionDigest`); otherwise `authority_unavailable`", d.toolId === "sirkit.routing.propose" ? "a routing executor wired by the server composition root (otherwise `routing_engine_unavailable`); `netIds` 1-500 positive integers naming nets of this board" : "`instanceIds` 1-500 footprint ids of this board, `candidateCount` 2-8, `maxIterations` 1-2000; authority-shaped keys are refused by name", ...(d.toolId === "sirkit.placement.propose" ? [`an optional \`intent\` (${PLACEMENT_INTENT_SCHEMA}): millimetres in the board-world frame, every component { ref, instanceId } and every net { name, id } bound to the SAME object of this board revision, at most ${MAX_INTENT_LIST_ITEMS} items per list; the compile is all-or-nothing (an unknown identity refuses the whole proposal as \`proposal-blocked\` data); a board over ${PLACEMENT_SCOPE_LIMIT} physical instances records the intent unapplied (\`unsupported-scope\`)`] : [])], // [PR-F fE] + the structured intent
      effect: `the engine runs over the current board and produces a revision-bound layout candidate (\`${LAYOUT_CANDIDATE_SCHEMA}\`) for the editor's own panel; side effects: \`${d.sideEffects}\` - nothing moves and no copper is committed${d.toolId === "sirkit.placement.propose" ? "; an intent seeds ONE extra engine candidate (initializer intent_seed) that passes the SAME orientation refinement, exact legalization, hard anchors, hard validator and objectives, and is preferred when hard-legal; the candidate's `intent` block lists the bound identities, the scope, what was seeded and every CONFLICT (component, what was asked, what a lock / keepout / clearance / legalization did instead) - locks, keepouts, mechanical envelopes and protected copper are preserved, the board is never resized, no routing is erased by this path; critical-net priorities are data the engine does not enforce" : ""}`,
      postconditions: ["engineering state is unchanged", `a candidate (\`${LAYOUT_CANDIDATE_SCHEMA}\`) is emitted (\`layout_candidate_ready\`); the loop reports \`layout_candidate_ready\`; the run allows no second proposal or grant`, `apply is the human's explicit action in the panel: applyLayoutCandidate re-verifies ${d.verificationStrategy}`, ...(d.toolId === "sirkit.placement.propose" ? ["with an intent: the model is handed the conflict list (bounded) and PLACEMENT_INTENT_NOTE; a conflict listed is never reported as honoured"] : [])],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, LAYOUT_CODES, ...(d.toolId === "sirkit.placement.propose" ? [INTENT_BLOCKERS] : [])],
      budget: ["a long-running tool: the registered timeout bounded by the run's REMAINING deadline (loop.ts); the engine stops at the budget and reports its termination", "one proposal or grant per run (the loop's single-flight)"],
    };
    case "generation-proposal": return {
      handler: "app/lib/agent/generation-proposals.ts (SchematicGenerationProposalService) over the chat route's injected port (app/api/chat/schematic-generation-runtime.ts) -> runBuildMultiGeneration (app/lib/schematic/build-multi-generation.ts), the SAME generation the Build composer's route runs",
      outcomeKind: "generation-proposal",
      requirements: ["the server's generation fact for the run (`schematicGenerationAvailable`: a configured provider) and the injected port; otherwise `authority_unavailable`", "a validated schematic with its canonical head mark (the sheet the proposal would replace); Build mode (`schematic-build-mode`: no Theory component)", `exactly \`prompt\`, 1 to ${MAX_GENERATION_PROMPT_CHARS} characters; authority-shaped keys are refused by name`, `at least ${MIN_GENERATION_BUDGET_MS} ms of the run's wall clock remaining (otherwise \`budget_exhausted\` before anything runs)`],
      effect: `the planner, the bounded build loops, the merge and the advisory electrical check run once under the run's remaining deadline and the outcome is SEALED (\`${GENERATION_PROPOSAL_SCHEMA}\`): completeness, omitted blocks, the check's state, the planner's state and the budget spent travel as data; a failed generation is \`proposal-blocked\` data, never ok; side effects: \`${d.sideEffects}\` - nothing is applied`,
      postconditions: ["engineering state is unchanged", `a sealed proposal (\`${GENERATION_PROPOSAL_SCHEMA}\`) is emitted on its own event (\`generation_proposal_ready\`); the loop reports \`proposal_sealed\` and tells the model the result's data, never the netlist; no second proposal or grant in the run`, `the human approves or discards it in the schematic review dialog; the intake re-verifies integrity, base digest, scope, head mark and expiry (${(GENERATION_PROPOSAL_TTL_MS / 60_000).toFixed(0)} min TTL)`],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, GENERATION_CODES, GENERATION_BLOCKERS, GENERATION_BLOCKER_FLAGS, GENERATION_INTAKE_CODES],
      budget: [`a long-running tool: min(the registered timeout, the run's remaining deadline); the generation's own deadline is min(BUILD_BUDGET.deadlineMs ${BUILD_BUDGET.deadlineMs} ms, that timeout minus the margin); BUILD_BUDGET: ${BUILD_BUDGET.iterationCap} iterations per loop, ${BUILD_BUDGET.concurrencyCap} loops at once (app/lib/schematic/build-result.ts)`, "one generation per run (the loop's single-flight)"],
    };
    case "draft-request-proposal": return {
      handler: "app/lib/agent/draft-request-proposals.ts (PartDraftRequestProposalService) -> compilePartDraftRequest + sealPartDraftRequest (the same module), over listUnresolvedInstances (app/lib/pcb-sync/unresolved-instances.ts) and, when bound, the catalog port the chat route injects (app/api/chat/catalog-inspection-runtime.ts) for the placed part's cross-check",
      outcomeKind: "draft-request-proposal",
      requirements: ["a verified schematic snapshot with its digest for the run (`schematic`, `schematicDigest`); otherwise `authority_unavailable` - no board and no head mark are needed (the artifact is a review task, not a sheet edit)", "exactly the request's keys (refDes required; exactMpn, manufacturer, package, pinTable, pitchMm, bodyMm, pin1Orientation, exposedPad, datasheet, missing, profile); authority-shaped keys and the symbol / footprint references are refused by name - the person picks the KiCad assets at submission", "the compile is all-or-nothing: an exact MPN, a manufacturer and a pin table are required; every given fact carries its source label; conflicting pin numbers, pad mappings, or a placed-part identity, package or pin count that disagrees (catalog port bound) refuse the whole request as `proposal-blocked` data"],
      effect: `the request is compiled against the editor's own refusal list and SEALED into a digest-pinned UNVERIFIED review task (\`${DRAFT_REQUEST_SCHEMA}\`, verification \`${DRAFT_REQUEST_VERIFICATION}\`) in the publication path's own vocabulary (AtomicPublicationSpec: exactMpn, profile, terminals, package, datasheet, manufacturer; symbol and footprint null); the documented facts with their sources, the missing facts and the C.4 PCB-assignment blockers (${PCB_ASSIGNMENT_BLOCKING_FACTS.join("; ")}) travel as data; side effects: \`${d.sideEffects}\` - nothing is filed, approved, published or verified`,
      postconditions: ["engineering state and the catalog are unchanged; no distributor was called", `a sealed artifact is emitted on its own event (\`draft_request_ready\`); the loop reports \`proposal_sealed\` and tells the model the facts' data (documented count, missing list, PCB-assignment blockers, the human path), never a verification; no second proposal or grant in the run`, `the human path is ${DRAFT_REQUEST_HUMAN_PATH}: the server's normalizer and draft assembly, the reviewer's approval, the administrator's publication and the deterministic mapping checks decide later (${(DRAFT_REQUEST_TTL_MS / 60_000).toFixed(0)} min TTL on the artifact)`],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, DRAFT_REQUEST_CODES, DRAFT_REQUEST_BLOCKERS, DRAFT_REQUEST_INTAKE_CODES],
      budget: [`a pin table of at most ${MAX_DRAFT_PIN_ROWS} pins (MAX_DRAFT_PIN_ROWS; app/lib/agent/draft-request-proposals.ts); the optional catalog cross-check shares the call's deadline`, "one proposal or grant per run (the loop's single-flight)"],
    };
    case "module-contract-proposal": return {
      handler: "app/lib/agent/module-contract-proposals.ts (ModuleContractProposalService) -> validateModuleContractSet (app/lib/engineering/module-contract.ts) over the run's verified schematic snapshot: identities from the sheet's own instances, named nets from the netlist authority (app/lib/pcb/netlist-bridge.ts buildNetlist) and the sheet's labels, part authority from the editor's refusal list (app/lib/pcb-sync/unresolved-instances.ts); then sealModuleContractProposal (the same module)",
      outcomeKind: "module-contract-proposal",
      requirements: ["a verified schematic snapshot with its digest and its canonical head mark for the run (`schematic`, `schematicDigest`, `schematicHeadMark`); otherwise `authority_unavailable` - no board, no port, no provider", "exactly `system`, `modules` and `constraints` (each required; an empty constraints list is allowed when no net is shared); authority-shaped keys are refused by name", `the validation is all-or-nothing: every owned component an exact identity of the sheet owned exactly once (a stated part or revision id must agree), every port and constraint net a named net of the sheet (a net label or GND), every quantity with a unit, every stated port fact (${PORT_FACTS.join(", ")}) and every requirement topic (${REQUIREMENT_TOPICS.join(", ")}) stated with evidence naming a source or listed unknown (a topic may be not applicable), every owned instance without published authority acknowledged in partAuthorityGaps, every net two modules share stated by a constraint over all of them (a driver-to-receiver net by an interface stating its loading or declaring it unknown; a shared reference naming its owner), one owner per net, at most ${ASTRA_QUALIFIED_PHYSICAL_INSTANCES} physical instances on the sheet`],
      effect: `the set is validated against the pinned sheet and SEALED into a digest-pinned engineering note (\`${MODULE_CONTRACT_PROPOSAL_SCHEMA}\`, verification \`${MODULE_CONTRACT_VERIFICATION}\`, electricalCheck not_run) carrying the validated \`${MODULE_CONTRACT_SCHEMA}\` set with the exact identities read from the sheet, the derived part-authority rows and the coverage (physical instances, owned, unassigned, known and referenced nets, shared nets with their constraints); side effects: \`${d.sideEffects}\` - nothing is applied, verified electrically or approved`,
      postconditions: ["engineering state is unchanged; no electrical check, simulation or ERC ran", `a sealed artifact is emitted on its own event (\`module_contracts_ready\`); the loop reports \`proposal_sealed\` and tells the model the set's data (modules, owned references, stated interfaces, unknowns, part-authority gaps, coverage), never a verification; no second proposal or grant in the run`, `the human path is ${MODULE_CONTRACT_REVIEW_PATH} (${(MODULE_CONTRACT_PROPOSAL_TTL_MS / 60_000).toFixed(0)} min TTL on the artifact); the existing deterministic checks recheck the composed circuit later`],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, MODULE_CONTRACT_CODES, MODULE_CONTRACT_BLOCKERS, MODULE_CONTRACT_INTAKE_CODES],
      budget: [`at most ${MAX_CONTRACT_MODULES} modules, ${MAX_CONTRACT_PORTS} ports and ${MAX_CONTRACT_REQUIREMENTS} requirements per module, ${MAX_CONTRACT_CONSTRAINTS} constraints, ${ASTRA_QUALIFIED_PHYSICAL_INSTANCES} physical instances on the sheet (app/lib/engineering/module-contract.ts)`, "one proposal or grant per run (the loop's single-flight)"],
    };
    case "stackup-proposal": return {
      handler: "app/lib/agent/stackup-proposals.ts (StackupProposalService) -> compileStackupCandidate (app/lib/pcb/candidates/stackup-candidate.ts) over the run's verified canonical board: STACKUP_PROFILES (app/lib/pcb/stackup.ts), the DRC presets with their fab copper bundles (app/lib/pcb/drc/presets, app/lib/pcb/fab/presets), QUALIFIED_RULE_PROFILE_IDS (app/lib/pcb/fab/rule-profile.ts), the board's via padstacks and DEFAULT_PADSTACKS (app/lib/pcb/padstack)",
      outcomeKind: "stackup-candidate",
      requirements: ["a verified canonical board for the run (`canonicalState.pcb`, `canonicalRevisionDigest`); otherwise `authority_unavailable` - no port, no provider, no network", `exactly the request's keys: \`profileId\` (required; one of ${STACKUP_PROFILE_IDS.join(", ")}), \`manufacturingProfileId\` (one of ${MANUFACTURING_PRESET_IDS.join(", ")}; absent: the run's active preset), \`planes\` (an inner plane layer of the profile and an exact board net), \`viaPadstackIds\` (the board's padstacks and the class defaults), \`viaTechnology\` (through only), \`rationale\`; authority-shaped keys are refused by name`, `the compile is all-or-nothing: a request naming blind / buried / micro / via-in-pad / stacked vias, a material, dielectric, copper weight, thickness, impedance or another layer count is refused as \`proposal-blocked\` data with the reason "${UNSUPPORTED_CHAIN_REASON}"; the profile's copper layer count must equal the preset's`],
      effect: `the recommendation is compiled against the tree's own authorities and SEALED into a digest-pinned, revision-bound candidate (\`${STACKUP_CANDIDATE_SCHEMA}\`): the current and the recommended stackup with PHYSICAL and ROUTABLE SIGNAL layer counts apart, the layer roles and plane nets, the manufacturing preset with its release qualification and limits, the via profiles with their manufacturer-minimum check, the scope classification, and \`invalidation\` (whether the layer count, profile or preset changes and the existing revision / approval rules that re-run); side effects: \`${d.sideEffects}\` - nothing is applied, no impedance or manufacturability is claimed`,
      postconditions: ["engineering state is unchanged; no DRC, routing or manufacturer check ran (the candidate's `notValidated` says so)", `a sealed candidate (\`${STACKUP_CANDIDATE_SCHEMA}\`) is emitted on its own event (\`stackup_candidate_ready\`); the loop reports \`stackup_candidate_ready\` and tells the model the recommendation's data (layer counts apart, qualification, via minima, invalidation), never a validation; no second proposal or grant in the run`, `the human path is ${STACKUP_HUMAN_PATH} (${(STACKUP_CANDIDATE_TTL_MS / 60_000).toFixed(0)} min TTL on the candidate); a different layer count or profile invalidates dependent approvals: DRC, the export preflight and the manufacturing qualification re-run from scratch`],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, STACKUP_CODES, STACKUP_BLOCKERS],
      budget: ["an interactive tool (the registered timeout, never the run's remaining deadline); the compile is pure and bounded by the request's own limits (at most 2 planes, 8 via profiles, 600 characters of rationale)", "one proposal or grant per run (the loop's single-flight)"],
    };
    case "granted-execution": return {
      handler: "app/lib/agent/execution-dispatch.ts (dispatchGrantedExecution) -> sealExecutionIntent (app/lib/agent/execution-intents.ts) -> the composition root's minter (app/lib/execution-grant/mint.ts); the browser's ritual commits through CanonicalEditorSession (app/lib/engineering/granted-executions.ts)",
      outcomeKind: "execution-grant",
      requirements: ["an execution-grant minter and a prompt version bound to the run (a human session principal with a readable autonomy setting); otherwise `execution_unavailable`", "the provider call id (a grant is minted once per run and call)", "a verified canonical board with its PCB history basis (`canonicalState.pcb`, `pcbProposalBasis`); otherwise `authority_unavailable`", `the actor's role in TIER1_EXECUTE_ROLES (${TIER1_EXECUTE_ROLES.join(", ")}); the capability \`${d.requiredCapability}\` is the GRANT's, satisfied by the server-derived grantable set, never the actor's own`, "the family's argument contract (exact keys; named stable ids; integer nanometres; 1-16 targets; no authority-shaped key); locked footprints refuse", "no earlier proposal or grant in the run (the loop's single-flight)"],
      effect: `the call seals an execution intent against the verified board and MINTS a server-bound one-shot grant (\`sirkit.agent-execution-grant.v1\`) bound to the board revision, history head, lineage and DRC policy; NOTHING changes here - the user's editor tenders the grant: a preview the user confirms (\`preview_then_confirm\`), or the exact user-requested operation under \`execute_explicit_tier1\` (\`execute_explicit\`); the commit is one canonical transaction through CanonicalEditorSession (\`${d.binding.canonicalCommandId ?? "?"}\`), one undo entry`,
      postconditions: ["before the editor commits: a grant exists (issued); the board is unchanged", "preview_then_confirm: the loop reports `execution_preview_issued`; the user's Confirm runs the ritual later", "execute_explicit: the loop awaits the DURABLE settlement and reports `executed` (transaction id, revisions before / after, head sequence, validations, undo eligibility) or one of the settlement failures listed under the failure codes; it never claims a change the settlement does not prove", `on commit: the board revision and history head advance by one canonical transaction with exact inverses; ${d.verificationStrategy}`],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE, DISPATCH_CODES, SEAL_CODES, MINTER_CODES, SETTLEMENT_CODES, RITUAL_CODES],
      budget: [`at most ${MAX_GRANT_OPERATIONS} operations per grant (MAX_GRANT_OPERATIONS; app/lib/engineering/execution-grant.ts)`, `the run waits at most ${DEFAULT_AGENT_BUDGET.executionSettlementTimeoutMs} ms for an execute_explicit settlement, bounded by the remaining run deadline (executionSettlementTimeoutMs)`, "one proposal or grant per run (the loop's single-flight)"],
    };
    case "unclassified": return {
      handler: null,
      outcomeKind: null,
      requirements: ["handler not classified in tool-manual.ts: the gateway's dispatch for this binding is not known to the manual generator, so only the discovery requirements above are stated; add the family to `handlerFamilyOf` and `profileOf` before relying on this manual"],
      effect: `not classified in tool-manual.ts (operation class \`${d.operationClass}\`, binding \`${d.binding.status}\`, side effects \`${d.sideEffects}\`); the registry's own statement is the description above`,
      postconditions: ["not classified in tool-manual.ts"],
      codes: [LOOP_CODE_SOURCE, GATEWAY_CODE_SOURCE],
      budget: [],
    };
    case "not-callable": default: return {
      handler: null,
      outcomeKind: null,
      requirements: ["none reachable: the run toolset never offers this tool (see the availability line at the top)"],
      effect: `none through the assistant. ${d.binding.status === "unbound" ? "No runtime implementation binding exists (a schema declaration is not an implementation)" : `The binding \`${d.binding.module ?? "?"}#${d.binding.symbol ?? "?"}\` serves the trusted editor session or the server, never the agent`}; the registry's own statement is the description above`,
      postconditions: ["none: nothing is invocable by the assistant; the human path is the UI or the route the owning command names"],
      codes: [LOOP_CODE_SOURCE, NOT_CALLABLE_CODES],
      budget: [],
    };
  }
}

// ── Availability and permissions ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const NOT_AVAILABLE = "NOT available to the assistant";

/** The availability statement at the top of a manual (D.8: an excluded or blocked tool is never advertised as callable). */
export function assistantAvailabilityOf(descriptor: ToolDescriptor, family: HandlerFamily = handlerFamilyOf(descriptor)): string {
  const d = descriptor;
  if (family === "not-callable") {
    const why: string[] = [];
    if (d.lifecycle !== "active") why.push(`lifecycle ${d.lifecycle}`);
    if (d.discovery === "internal-only") why.push("discovery internal-only (excluded from every channel)");
    if (d.callability !== "callable" || d.binding.status === "unbound") why.push(`callability ${d.callability}, binding ${d.binding.status}`);
    if (!d.agentExposed) why.push("agentExposed false");
    if (!INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.includes(d.toolId)) why.push("not in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS (agent-exposure.ts)");
    const never = NEVER_EXPOSED_TOOL_PATTERNS.find((pattern) => pattern.test(d.toolId));
    if (never) why.push(`matches NEVER_EXPOSED_TOOL_PATTERNS ${String(never)}`);
    if (d.binding.canonicalCommandId && NEVER_GRANTED_COMMAND_IDS.includes(d.binding.canonicalCommandId)) why.push(`canonical command ${d.binding.canonicalCommandId} is in NEVER_GRANTED_COMMAND_IDS`);
    if (d.operationClass === "mutate" && d.agentExposed) why.push(`not a granted execution: ${grantedExecutionViolations(d)[0] ?? "no reviewed row"}`);
    if (permissionTierOfDescriptor(d) === 3) why.push("permission Tier 3 is never agent-executable (permission-tiers.ts)");
    if (d.operationClass === "destructive" || d.operationClass === "release") why.push(`operation class ${d.operationClass} is never exposable (agent-exposure.ts)`);
    return `**${NOT_AVAILABLE}**: ${why.join("; ")}. The run toolset never lists it; this manual documents the registry entry and the human path.`;
  }
  switch (family) {
    case "read": case "external-read": case "mcp-observation": case "computation": case "pcb-sync-preflight": case "catalog-inspection": case "missing-facts": return "callable now - a Tier 0 read; executes directly for an authorized reader when its per-run resource or server fact is present";
    case "view-session": return "view-session command - the server validates the request, the user's browser executes it on its view bus; never engineering state";
    case "sealed-proposal": case "layout-proposal": case "generation-proposal": case "draft-request-proposal": case "module-contract-proposal": case "stackup-proposal": return "proposal only - the call seals an inert artifact or candidate; a human applies it in the review boundary"; // [PR-F fD] + the module contract note (no apply path: the human accepts it by continuing)
    case "granted-execution": return "granted execution - the call mints a server-bound one-shot grant; the user's editor commits (preview + confirmation by default; the exact explicit request under execute_explicit_tier1)";
    default: return "exposed, but its handler is not classified in tool-manual.ts (see the preconditions)";
  }
}

const tierLabel = (tier: PermissionTier): string => `Tier ${tier} (${PERMISSION_TIER_TITLES[tier]})`;
const SCOPE = { tenantId: "-", projectId: "-" };
const PROPOSAL_ONLY: AgentAutonomySetting = defaultAutonomySetting(SCOPE);
const EXECUTE_EXPLICIT: AgentAutonomySetting = { ...defaultAutonomySetting(SCOPE), mode: "execute_explicit_tier1" };

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const json = (value: unknown): string => JSON.stringify(value, null, 2);
const code = (value: string): string => `\`${value}\``;
const fence = (value: unknown): string => `\`\`\`json\n${json(value)}\n\`\`\``;
const bullets = (items: readonly string[]): string => items.map((item) => `- ${item}`).join("\n");
const heading = (index: number): string => `## ${index + 1}. ${MANUAL_SECTION_TITLES[index]}`;

export interface RenderedToolManual { toolId: string; version: string; file: string; markdown: string; examples: ManualExample[]; family: HandlerFamily }

function discoveryPreconditions(d: ToolDescriptor, family: HandlerFamily): string[] {
  const granted = family === "granted-execution";
  const ridesEvery = d.category === "project" || d.category === "parts";
  const editor = Object.entries(EDITOR_FAMILIES).filter(([, categories]) => categories.includes(d.category)).map(([name]) => name);
  const portAuthority = d.requiredAuthority.filter((source) => source === "external-observation" || source === "external-mcp-observation" || source === "computation-engine" || source === "schematic-generation");
  return [
    `lifecycle ${code(d.lifecycle)} (must be \`active\`)${d.lifecycle === "active" ? "" : " - EXCLUDED (`lifecycle`)"}`,
    `discovery ${code(d.discovery)} (must be \`discoverable\`)${d.discovery === "discoverable" ? "" : " - EXCLUDED (`internal_only`)"}`,
    `channel: the assistant-agent channel lists only \`agentExposed: true\` tools (${d.agentExposed ? "exposed" : "EXCLUDED (`not_agent_exposed`)"})${d.grantOnly ? "; `grantOnly`: reachable only under a grant on the assistant-agent channel (never interactive-ui, api or automation discovery)" : ""}${d.sideEffects === "external-transfer" ? "; an external-transfer side effect is never listed for an agent" : ""}`,
    `actor role in ${code(d.requiredRoles.join(" | "))} (\`role_not_permitted\` otherwise)`,
    granted ? `capability ${code(d.requiredCapability)} must be in the run's SERVER-derived grantable set (\`grantableCapabilities\`: present only when a minter, a verified board, a PCB basis and a Tier 1 execute role exist); the actor's own capabilities never count (\`capability_missing\` otherwise)` : `capability ${code(d.requiredCapability)} granted to the actor (\`capability_missing\` otherwise)`,
    d.requiresExpectedRevision ? "a canonical head digest must be present (`requiresExpectedRevision`; `revision_required` otherwise)" : "no canonical head digest is required (`requiresExpectedRevision: false`)",
    d.requiresLineage ? (granted ? "a grant lineage must be present (`requiresLineage`; for a granted execution it is the PCB proposal basis lineage, never the schematic head mark; `lineage_required` otherwise)" : "an open lineage anchor must be present (`requiresLineage`: the schematic head mark's lineage; `lineage_required` otherwise)") : "no lineage anchor is required (`requiresLineage: false`)",
    ridesEvery ? `editor: category ${code(d.category)} rides every editor` : `editor: category ${code(d.category)} rides the ${editor.length > 0 ? editor.map(code).join(" / ") : "(no)"} editor (\`editor_mismatch\` on another current editor)`,
    d.requiredSelectionKinds.length > 0 ? `a current selection of kind ${d.requiredSelectionKinds.map(code).join(" | ")} (\`selection_kind_missing\` otherwise)` : "no selection kind is required (targets are named by stable id or the tool reads the sealed selection itself)",
    d.requiredProjectState.length > 0 ? `project state ${d.requiredProjectState.map(code).join(" and ")} (\`project_state_missing\` otherwise${d.requiredProjectState.some((state) => state.endsWith("-surface")) ? "; a `*-surface` state means the editor surface is open in the user's browser session, proven by the captured view context" : ""}${d.requiredProjectState.includes("schematic-build-mode") ? "; `schematic-build-mode`: the validated sheet holds no Theory component (derived by the server, never a body claim)" : ""})` : "no project state is required",
    d.requiredAuthority.includes("none") ? "no engineering authority is required (`none`)" : `authority: one of ${d.requiredAuthority.map(code).join(" | ")} advertised for the run (\`authority_missing\` otherwise)${portAuthority.length > 0 ? `; ${portAuthority.map(code).join(", ")} is the server's per-run port fact and counts on the assistant-agent channel only` : ""}`,
    `callability ${code(d.callability)} (must be \`callable\`)${d.callability === "callable" ? "" : " - EXCLUDED (`not_callable`)"}`,
    d.approvalTier === "none" ? "no approval tier gates discovery (`approvalTier: none`)" : `the approval tier ${code(d.approvalTier)} must be available to the session (\`approval_unavailable\` otherwise; the chat run advertises \`reversible\` exactly when a grant can be minted)`,
    `risk: operation class ${code(d.operationClass)} ranks ${OPERATION_CLASS_RISK[d.operationClass]} and must not exceed the run's risk ceiling (\`risk_ceiling\`; the chat run's ceiling is \`mutate\` when a grant can be minted, else \`propose\`)`,
    `provider: JSON-schema support, the name length and the tool count (\`provider_schema_unsupported\`, \`provider_name_length\`, \`provider_tool_count\`); the schema-byte budget when set (\`budget_exceeded\`)`,
    d.featureFlag ? `feature flag ${code(d.featureFlag)} enabled (\`feature_flag_disabled\` otherwise)` : "no feature flag",
    `reviewed exposure: ${INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.includes(d.toolId) ? "listed in" : "NOT in"} INTENTIONAL_AGENT_EXPOSED_TOOL_IDS (agent-exposure.ts); isAgentExposableDescriptor ${isAgentExposableDescriptor(d)}`,
  ];
}

function permissionsSection(d: ToolDescriptor, family: HandlerFamily): string {
  const tier = permissionTierOfDescriptor(d);
  const row = GRANTED_EXECUTION_TOOLS.find((candidate) => candidate.toolId === d.toolId);
  const violations = grantedExecutionViolations(d);
  const decision = (setting: AgentAutonomySetting, explicit: boolean): string => {
    const decided = decideAgentExecution({ tier, setting, actorRole: "pcb_editor", explicitUserRequest: explicit });
    return `${code(decided.decision)} (grant ${decided.requiresGrant ? "required" : "not required"}, human approval ${decided.requiresHumanApproval ? "required" : "not required"}): ${decided.reason}`;
  };
  const mcp = mcpExclusionReason(d);
  const boundary = family === "sealed-proposal" || family === "layout-proposal" || family === "generation-proposal" || family === "draft-request-proposal" || family === "module-contract-proposal" || family === "stackup-proposal" // [PR-F fE] + the stackup family // [PR-F fD]
    ? `proposal / apply boundary: sealing requires no approval of its own (it mints an inert artifact); apply is a human step in the review boundary and is never provider-callable - ${d.verificationStrategy}`
    : family === "granted-execution"
      ? `proposal / apply boundary: the grant is the proposal; the user's editor tenders it (${row && /confirmation-only/.test(row.reason) ? "confirmation-only: always previewed" : "a preview to confirm, or the exact explicit request when the project opted in"}); the ritual re-checks revision, head, lineage and DRC policy before one canonical commit`
      : family === "view-session" ? "proposal / apply boundary: none - view state only; the browser bus applies its own role gate and stale-revision rule"
      : family === "not-callable" ? "proposal / apply boundary: not applicable to the assistant; the human path keeps its own approval (the owning command's tier)"
      : "proposal / apply boundary: none - a read changes nothing";
  const lines = [
    `permission tier: ${tierLabel(tier)} - permissionTierOfDescriptor over approvalTier ${code(d.approvalTier)} and operation class ${code(d.operationClass)}${TIER3_FLOOR_PATTERN.test(d.toolId) ? "; the id matches TIER3_FLOOR_PATTERN" : ""}${d.sideEffects === "external-transfer" ? "; external-transfer side effects floor it at Tier 3 (OD-173)" : ""}`,
    `registry approval tier: ${code(d.approvalTier)}; required roles: ${d.requiredRoles.map(code).join(", ")}; required capability: ${code(d.requiredCapability)}${family === "granted-execution" ? " (carried by the grant, never the agent actor)" : ""}`,
    `execution decision for a pcb_editor (decideAgentExecution): default mode \`proposal_only\` -> ${decision(PROPOSAL_ONLY, false)}; mode \`execute_explicit_tier1\` with the exact user request proven -> ${decision(EXECUTE_EXPLICIT, true)}`,
    row ? `grant family: ${code(row.family)} - reviewed row in GRANTED_EXECUTION_TOOLS: ${row.reason}` : `grant family: none (${d.operationClass === "mutate" ? `grantedExecutionViolations: ${violations.join("; ")}` : "not a mutation"})`,
    `never-lists: ${NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(d.toolId)) ? "the id matches NEVER_EXPOSED_TOOL_PATTERNS" : "the id matches no NEVER_EXPOSED_TOOL_PATTERNS entry"}; ${d.binding.canonicalCommandId ? (NEVER_GRANTED_COMMAND_IDS.includes(d.binding.canonicalCommandId) ? `canonical command ${code(d.binding.canonicalCommandId)} is in NEVER_GRANTED_COMMAND_IDS (can never be granted)` : `canonical command ${code(d.binding.canonicalCommandId)} is not in NEVER_GRANTED_COMMAND_IDS`) : "no canonical command"}`,
    boundary,
    `MCP channel: ${mcp === null ? "exposed to MCP principals (the structural rule admits it and mcp-exposure-review.ts lists it)" : `excluded (${code(mcp)}): ${MCP_EXCLUSION_REASON_DECISIONS[mcp]}`}`,
    `audit: ${code(d.audit)}; idempotency: ${code(d.idempotency)}`,
  ];
  return bullets(lines);
}

function budgetSection(d: ToolDescriptor, profile: FamilyProfile): string {
  const perCall = d.budgetClass === "long-running"
    ? `min(${d.timeoutMs} ms, the run's remaining deadline) - a long-running tool may use its registered timeout up to the remaining run deadline`
    : `min(perToolTimeoutMs ${DEFAULT_AGENT_BUDGET.perToolTimeoutMs} ms, ${d.timeoutMs} ms) = ${Math.min(DEFAULT_AGENT_BUDGET.perToolTimeoutMs, d.timeoutMs)} ms`;
  return bullets([
    `registry: timeout ${d.timeoutMs} ms, budget class ${code(d.budgetClass)}`,
    `effective per-call timeout in a chat run (app/lib/agent/loop.ts): ${perCall}`,
    `the run (DEFAULT_AGENT_BUDGET, app/lib/agent/contracts.ts): ${DEFAULT_AGENT_BUDGET.maxModelSteps} model steps, ${DEFAULT_AGENT_BUDGET.maxToolCalls} tool calls, ${DEFAULT_AGENT_BUDGET.runDeadlineMs} ms wall clock, the same call at most ${DEFAULT_AGENT_BUDGET.maxIdenticalCalls} times`,
    `arguments: at most ${MAX_ARGUMENT_CHARS} characters of JSON text; bounded plain JSON under DEFAULT_INPUT_LIMITS (depth ${DEFAULT_INPUT_LIMITS.maxDepth}, strings ${DEFAULT_INPUT_LIMITS.maxStringLength}, arrays ${DEFAULT_INPUT_LIMITS.maxArrayItems}, keys ${DEFAULT_INPUT_LIMITS.maxObjectKeys}, nodes ${DEFAULT_INPUT_LIMITS.maxTotalNodes})`,
    `result: at most ${MAX_RESULT_CHARS} characters reach the model (MAX_RESULT_CHARS; a larger result becomes \`output_too_large_for_model\`)`,
    ...profile.budget,
  ]);
}

function failureCodesSection(sources: readonly CodeSource[]): string {
  return sources.map((source) => `- ${source.stage} - ${code(source.file)}${source.declaredBy === "tests" ? " (from tests: the handler declares none)" : ""}:\n  ${source.codes.map(code).join(", ")}\n  ${source.note}`).join("\n");
}

/** Render one manual. THROWS when an example does not validate against the input schema (the generator and the gate fail closed). */
export function renderToolManual(descriptor: ToolDescriptor, registry: ToolRegistry): RenderedToolManual {
  const d = descriptor;
  const examples = manualExamplesOf(d);
  const invalid = examples.filter((example) => example.errors.length > 0);
  if (invalid.length > 0) throw new Error(`TOOL_MANUAL_EXAMPLE_INVALID: ${d.toolId}@${d.version}: ${invalid.map((example) => example.errors.join("; ")).join(" | ")}`);
  const family = handlerFamilyOf(d);
  const profile = profileOf(d, family);
  const availability = assistantAvailabilityOf(d, family);
  const units = unitsAndFrameOf(d);
  const descriptorDigest = engineeringDigest({ schema: MANUAL_SCHEMA, descriptor: d });
  const binding = `${code(d.binding.status)}${d.binding.module ? ` -> ${code(`${d.binding.module}#${d.binding.symbol ?? "?"}`)}` : ""}${d.binding.canonicalCommandId ? `; canonical command ${code(d.binding.canonicalCommandId)}` : ""}`;
  const sections = [
    bullets([
      `tool id: ${code(d.toolId)}`,
      `version: ${code(d.version)}; lifecycle: ${code(d.lifecycle)}${d.deprecation ? `; deprecation: ${d.deprecation.reason}${d.deprecation.replacedBy ? ` (replaced by ${code(d.deprecation.replacedBy)})` : ""}` : ""}`,
      `title: ${d.title}`,
      `category ${code(d.category)}; operation class ${code(d.operationClass)}; side effects ${code(d.sideEffects)}`,
      `owning command (action registry): ${code(d.owningCommandId)}`,
      `binding: ${binding}${d.binding.notes ? `; notes: ${d.binding.notes}` : ""}`,
      `handler (the gateway's dispatch): ${profile.handler ?? "none for the assistant"}; success outcome: ${profile.outcomeKind ? code(profile.outcomeKind) : "none"}`,
      `assistant availability: ${availability}`,
      `descriptor digest: ${code(descriptorDigest)} (${MANUAL_SCHEMA}; the registry digest is in MANIFEST.json)`,
      `source evidence: ${d.sourceEvidence.map(code).join(", ")}; owner ${code(d.owner)}`,
      `version notes: ${d.versionNotes}`,
    ]),
    [
      `Input schema (the registry's wire schema; the runtime bounds beyond it are the handler's: ${d.validationStrategy}):`,
      fence(d.inputSchema),
      `Valid example${examples.length > 1 ? "s" : ""} (each validated at generation time against the input schema by \`assertSafeJsonValue\` and \`validateAgainstSchema\`, app/lib/engineering/tool-io-validation.ts; the render refuses an example that does not validate):`,
      ...examples.map((example) => `${fence(example.value)}\n${example.origin === "curated" ? "(curated example)" : "(derived from the schema: required fields with placeholder values; add a curated example to MANUAL_EXAMPLES in app/lib/engineering/tool-manual.ts)"}`),
      "Output schema:",
      fence(d.outputSchema),
    ].join("\n"),
    units.length > 0 ? bullets(units) : "- not declared: neither the descriptor text, its schema field names nor the bound domain module declares a unit or a coordinate frame for this tool; nothing is assumed",
    [`Discovery (app/lib/engineering/tool-discovery.ts, the policy pipeline in order; deny by default - a missing or restrictive context field excludes, never widens):`, bullets(discoveryPreconditions(d, family)), "", "Per call, the handler additionally requires:", bullets(profile.requirements)].join("\n"),
    bullets([`registry statement: ${d.description}`, `effect: ${profile.effect}`, `validation (registry): ${d.validationStrategy}`]),
    permissionsSection(d, family),
    budgetSection(d, profile),
    failureCodesSection(profile.codes),
    bullets([...profile.postconditions, `verification (registry): ${d.verificationStrategy}`]),
  ];
  const markdown = [
    `# ${d.title} - ${code(d.toolId)}`,
    "",
    `Generated by \`${REGENERATE_COMMAND}\` from the tool registry (app/lib/engineering/tool-catalog.ts, ${registry.list().length} descriptors) and the handler modules it binds; do not edit by hand - edit the registry or app/lib/engineering/tool-manual.ts and regenerate. Assistant availability: ${availability}`,
    "",
    ...sections.flatMap((body, index) => [heading(index), "", body, ""]),
  ].join("\n");
  return { toolId: d.toolId, version: d.version, file: toolManualFileName(d.toolId), markdown, examples, family };
}

/** Every descriptor's manual, in registry order (toolId, then version). Refuses two versions of one tool id (one file per id). */
export function renderToolManuals(registry: ToolRegistry): RenderedToolManual[] {
  const manuals = registry.list().map((descriptor) => renderToolManual(descriptor, registry));
  const seen = new Map<string, string>();
  for (const manual of manuals) {
    const earlier = seen.get(manual.toolId);
    if (earlier) throw new Error(`TOOL_MANUAL_DUPLICATE_ID: ${manual.toolId} is registered as ${earlier} and ${manual.version}; a manual file is one per tool id`);
    seen.set(manual.toolId, manual.version);
  }
  return manuals;
}
