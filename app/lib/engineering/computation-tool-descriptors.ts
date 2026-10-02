/**
 * [B22-B] The five named computation descriptors (OD-139), registered in the B04 catalog (`tool-catalog.ts` spreads this list at
 * its end, so no line of that file moves). Three Tier 0 reads on the `bound-computation` binding status, run in the bounded engine
 * host behind the server's computation fact; two process-backed requests a human approves, registered, never exposed and never
 * callable until a human approval route exists (B22-B adds none). Each input schema IS its catalog kind's closed wire schema.
 * Metadata only: nothing here imports an engine, a port or a runner.
 */
import { computationKind } from "../computation/catalog";
import type { JsonSchema, ToolDescriptor } from "./tool-registry";

const OUT_RESULT: JsonSchema = { type: "object", additionalProperties: false, properties: { result: { type: "object" } }, required: ["result"] };
const ALL_ROLES = ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"] as const;
/** The B04 read defaults (`tool-catalog.ts` readDefaults), restated: no approval tier, natural idempotency, no lineage, read-only audit. */
const COMPUTATION_DEFAULTS = {
  sideEffects: "none" as const,
  approvalTier: "none" as const,
  requiresExpectedRevision: false,
  idempotency: "natural" as const,
  requiresLineage: false,
  agentExposed: false,
  budgetClass: "interactive" as const,
  audit: "none-read-only" as const,
  lifecycle: "active" as const,
  requiredSelectionKinds: [] as const,
  owner: "ai-control-plane",
};
/** A computation kind's closed wire schema (the catalog fails closed at load, so every kind exists). */
const computationInput = (id: string): JsonSchema => computationKind(id)!.inputSchema;

export const COMPUTATION_TOOL_DESCRIPTORS: readonly ToolDescriptor[] = Object.freeze([
  {
    ...COMPUTATION_DEFAULTS,
    toolId: "sirkit.computation.analytical-equation", version: "1.0.0",
    agentExposed: true, // B22-B — per-run availability requires the server's computation fact (the engine port the chat route binds)
    owningCommandId: "computation.named-read",
    title: "Evaluate an approved analytical equation",
    description: "Evaluate one approved closed-form microcase of the analytical reference provider from bounded numbers: a resistor divider (vin, r1, r2), a first-order RC step (vin, r, c, time) or a single-pole low-pass (r, c, frequency). The answer lists the microcase's quantities with their units and a resultDigest a later comparison or parse can name. It is computation evidence from an unreviewed reference provider, never engineering authority and never a simulation.",
    category: "validation", operationClass: "read",
    sideEffects: "derived-cache", // the result is held in process memory for this run only, so a later call can name it by digest
    inputSchema: computationInput("sirkit.computation.analytical-equation"), outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: [], requiredAuthority: ["computation-engine"],
    binding: { status: "bound-computation", module: "app/lib/computation/computation-port.ts", symbol: "evaluateAnalyticalEquation", notes: "B22-B: invoked only through ComputationReadService (app/lib/agent/computation-reads.ts) over the port the chat route injects through app/api/chat/computation-runtime.ts; one closed engine in the bounded engine host (a worker thread stopped hard at the kind's budget)." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "the catalog's closed input: the microcase enum and exactly its own bounded finite numbers (a strict provider's null is absence); safe JSON; the server's computation fact, role and capability rechecked per call",
    verificationStrategy: "the analytical-quantities output validator over the whole result (closed quantity names and units, finite values, the unreviewed non-authoritative provider, the two labels, SHA-256 input and result digests), refused whole",
    sourceEvidence: ["app/lib/computation/catalog.ts", "app/lib/computation/computation-port.ts", "app/lib/computation/engine-host.ts", "app/lib/computation/engine-worker.mjs", "app/lib/agent/computation-reads.ts", "app/api/chat/computation-runtime.ts"],
    versionNotes: "1.0.0 (B22-B): first exposure, reviewed in agent-exposure.ts; withheld from MCP (the computation exclusion) and dormant for B21 specialists.",
  },
  {
    ...COMPUTATION_DEFAULTS,
    toolId: "sirkit.computation.artifact-compare", version: "1.0.0",
    agentExposed: true, // B22-B — per-run availability requires the server's computation fact
    owningCommandId: "computation.named-read",
    title: "Compare two computation results",
    description: "Compare the quantities of two deterministic computation results this run already holds, each named by its resultDigest: per shared quantity both values, the absolute and the relative difference, whether the two results are of the same microcase (comparable) and whether they are the same result (identical). Nothing is fetched or recomputed; the answer is computation evidence, never engineering authority.",
    category: "validation", operationClass: "read",
    sideEffects: "derived-cache", // the comparison is itself held for this run, named by its own digest
    inputSchema: computationInput("sirkit.computation.artifact-compare"), outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: [], requiredAuthority: ["computation-engine"],
    binding: { status: "bound-computation", module: "app/lib/computation/computation-port.ts", symbol: "compareHeldArtifacts", notes: "B22-B: both sides must be results the server holds for this run (by digest); invoked only through ComputationReadService over the injected port; the bounded engine host computes the differences." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "the catalog's closed input: two server-held result digests of the closed grammar; safe JSON; the fact, role and capability rechecked per call",
    verificationStrategy: "the artifact-comparison output validator (closed keys, finite values, non-negative differences, at most 16 fields), refused whole",
    sourceEvidence: ["app/lib/computation/catalog.ts", "app/lib/computation/computation-port.ts", "app/lib/computation/engine-worker.mjs", "app/lib/agent/computation-reads.ts"],
    versionNotes: "1.0.0 (B22-B): first exposure, reviewed in agent-exposure.ts; withheld from MCP and dormant for B21 specialists.",
  },
  {
    ...COMPUTATION_DEFAULTS,
    toolId: "sirkit.computation.artifact-parse", version: "1.0.0",
    agentExposed: true, // B22-B — per-run availability requires the server's computation fact
    owningCommandId: "computation.named-read",
    title: "Parse a server-held artifact",
    description: "Parse one bounded artifact the server holds for this run, named by its digest, with a closed parser: board-statistics over the canonical board (named by the canonical revision digest a read reported) gives its layer, footprint, net, track, via, zone and text counts and the track length per layer; result-fields over a computation result lists its quantities. Nothing outside the server is read; the answer is computation evidence, never engineering authority.",
    category: "validation", operationClass: "read",
    sideEffects: "derived-cache", // the parse is held for this run, named by its own digest
    inputSchema: computationInput("sirkit.computation.artifact-parse"), outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: [], requiredAuthority: ["computation-engine"],
    binding: { status: "bound-computation", module: "app/lib/computation/computation-port.ts", symbol: "parseHeldArtifact", notes: "B22-B: the artifact is the run's verified canonical board (by its revision digest, at most 8 MiB of canonical JSON) or a result the server holds for this run; invoked only through ComputationReadService over the injected port." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 15_000,
    validationStrategy: "the catalog's closed input: one server-held artifact digest and the closed parser enum; the parser must fit the artifact; safe JSON; the fact, role and capability rechecked per call",
    verificationStrategy: "the artifact-statistics output validator (closed keys, counts, finite lengths, at most 16 layers or fields), refused whole",
    sourceEvidence: ["app/lib/computation/catalog.ts", "app/lib/computation/computation-port.ts", "app/lib/computation/engine-worker.mjs", "app/lib/agent/computation-reads.ts"],
    versionNotes: "1.0.0 (B22-B): first exposure, reviewed in agent-exposure.ts; withheld from MCP and dormant for B21 specialists.",
  },
  {
    ...COMPUTATION_DEFAULTS,
    toolId: "sirkit.computation.circuit-analysis", version: "1.0.0",
    owningCommandId: "computation.request",
    title: "Request a pinned circuit analysis",
    description: "Request one pinned analysis of a microcase circuit the server writes from bounded numbers (a divider operating point, an RC step transient, a single-pole response at one frequency), run once on the pinned diagnostic simulator after a human approves the exact request. Registered only: it is not offered to the assistant until a human approval surface exists.",
    category: "validation", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: computationInput("sirkit.computation.circuit-analysis"), outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: [], requiredAuthority: ["none"],
    binding: { status: "unbound", notes: "B22-B: an inert sealed request awaiting human approval (app/lib/computation/requests.ts); an approved request runs once on the B22-A3 diagnostic runner through app/lib/computation/request-executors.ts. Approving one needs an authenticated route and B22-B adds none, so the tool stays unbound and dormant." },
    discovery: "discoverable", callability: "not-callable",
    timeoutMs: 10_000,
    validationStrategy: "the catalog's closed input; the human approval of the exact request digest by an editor, reviewer or project administrator of its scope",
    verificationStrategy: "a strict raw reader that refuses a malformed, short or non-finite file whole, then the circuit-waveform output validator; the evidence is labelled diagnostic_only and environment_dependent",
    sourceEvidence: ["app/lib/computation/catalog.ts", "app/lib/computation/requests.ts", "app/lib/computation/request-executors.ts", "app/lib/computation/diagnostic-runner.ts"],
    versionNotes: "1.0.0 (B22-B): registered, dormant (never agent-exposed, never callable) until a human approval route exists.",
  },
  {
    ...COMPUTATION_DEFAULTS,
    toolId: "sirkit.computation.layout-experiment", version: "1.0.0",
    owningCommandId: "computation.request",
    title: "Request a pinned placement experiment",
    description: "Request one pinned placement experiment (a seed and a wall clock of at most 60 s) in the bounded engine host, stopped hard at its budget, after a human approves the exact request. Registered only: the placement engine has no worker entry in this build and it is not offered to the assistant.",
    category: "placement", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: computationInput("sirkit.computation.layout-experiment"), outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["none"],
    binding: { status: "unbound", notes: "B22-B: an inert sealed request awaiting human approval (app/lib/computation/requests.ts); the experiment profile runs in the bounded engine host, whose placement engine has no worker entry in this build (refused ENGINE_UNAVAILABLE). Approving one needs a route B22-B does not add." },
    discovery: "discoverable", callability: "not-callable",
    timeoutMs: 60_000, budgetClass: "long-running",
    validationStrategy: "the catalog's closed input; the human approval of the exact request digest",
    verificationStrategy: "the layout-experiment output validator; the evidence is labelled diagnostic_only and environment_dependent",
    sourceEvidence: ["app/lib/computation/catalog.ts", "app/lib/computation/requests.ts", "app/lib/computation/request-executors.ts", "app/lib/computation/engine-host.ts"],
    versionNotes: "1.0.0 (B22-B): registered, dormant until a human approval route and a worker entry for the placement engine exist.",
  },
] satisfies readonly ToolDescriptor[]);
