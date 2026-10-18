/**
 * [B17-F] THE intentional agent-exposure set — the one reviewed list every
 * exposure gate derives from. Adding a tool to the model's reach is a
 * reviewed change HERE (with its reason), never a count bumped in a test.
 *
 * Exposable operation classes are `read`, `propose` (sealed proposal
 * artifacts / revision-bound layout candidates the human applies) and
 * `view-session` (bus commands the browser executes; never engineering
 * state). [B18-C] A `mutate` tool is exposable ONLY as a reviewed granted
 * execution (`granted-execution-families.ts`): the model's call mints a
 * server-bound one-shot grant and the user's canonical editor session is
 * the only committer. `destructive` and `release` are never exposed; nothing
 * that qualifies or releases manufacturing, runs a raw process, replaces
 * state wholesale, or mutates a database/file is in this list.
 */
import type { ToolDescriptor, ToolRegistry } from "./tool-registry";
import { GRANTED_EXECUTION_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS, NEVER_GRANTED_COMMAND_IDS, grantedExecutionViolations, type GrantedExecutionCandidate } from "./granted-execution-families"; // [B18-C]

export const AGENT_EXPOSABLE_OPERATION_CLASSES = Object.freeze(["read", "propose", "view-session"] as const);

/**
 * [B18-C] THE exposure rule every gate and pin derives from: the three exposable classes, or a `mutate` tool that is a
 * reviewed granted execution (B18-B grants; `granted-execution-families.ts`). Nothing else is ever exposable.
 */
export function isAgentExposableDescriptor(descriptor: GrantedExecutionCandidate): boolean {
  if (descriptor.sideEffects === "external-transfer") return false; if ((AGENT_EXPOSABLE_OPERATION_CLASSES as readonly string[]).includes(descriptor.operationClass)) return true; // [B23-A2] data leaving Sirkit is Tier 3 and never exposable, whatever its class (OD-173)
  return descriptor.operationClass === "mutate" && grantedExecutionViolations(descriptor).length === 0;
}

export const INTENTIONAL_AGENT_EXPOSED_TOOL_IDS: readonly string[] = Object.freeze([
  "sirkit.component-authority.inspect",           // B13 — server-owned authority resource gates per-run availability
  "sirkit.manufacturing.readiness-inspect",       // read: a readiness REPORT; never authorizes a release
  "sirkit.mcp.observation-read",                  // B20-A4 — Tier 0 bound external read of approved, PINNED MCP servers through the server's injected port: the roster (no request), a pinned catalog, or one accepted tool's observation; at most 4 server operations per run at the agent's 25% share; arguments screened for run identity and credentials before anything is sent; labels only unless the committed registry permits disclosure; never writes (OD-74..OD-77)
  "sirkit.module.propose-contracts",               // [PR-F fD, 2026-10-17] propose: a typed module contract set (sirkit.module-contract.v1) for the run's pinned schematic, validated by the ONE validator (app/lib/engineering/module-contract.ts) against the sheet's own identities, named nets and unresolved-instance list - every owned component an exact identity owned once, every value with a unit, every recommendation with evidence naming a source, every part-authority gap acknowledged, every shared net stated by a cross-module constraint (an interface states its loading or declares it unknown) - and SEALED as an engineering note the page shows in the run log (no apply path; the human accepts by continuing; electricalCheck not_run, nothing verified electrically); a refused set is proposal-blocked data; withheld from MCP (mcp-exposure-review.ts)
  "sirkit.parts.catalog-inspect", "sirkit.parts.draft-request", "sirkit.parts.missing-facts", // [PR-F fB, 2026-10-17] draft-request - propose: a sealed UNVERIFIED draft request for one unresolved part in the human publication request's own vocabulary (facts with their source labels or listed missing; the C.4 PCB-assignment blockers as data; no certificate, approval or publication claimed; a human files it, OD-244 stands); missing-facts - read: the SAME missing-facts checklist the editor's missing-parts list renders (app/lib/parts/missing-facts.ts) for every unresolved instance, the catalog facts only through the bound catalog port, otherwise unknown as catalog unavailable; both withheld from MCP (mcp-exposure-review.ts). [PR-D d2, 2026-10-16] catalog-inspect - read: ONE catalog part by id through the chat route's injected catalog port (the SAME loadCatalogPartDetail the parts detail route answers the browser's part cache with, plus the published revision status read): name, MPN, manufacturer, library, footprint hint, lifecycle, bounded pins, exact revisions per value key with their catalog status and the withdrawn value keys; advertised only with the server's catalog fact; never a distributor call; nothing placed, bound or published; withheld from MCP (mcp-exposure-review.ts)
  "sirkit.parts.evidence-read",                   // B19-E E6 — Tier 0 read, offer cache only: the missing evidence, conflicting property names, stale observations and published revision status for ONE exact MPN; proves nothing (publication and binding stay human), labels only while agentDisclosure is unknown (OD-36)
  "sirkit.parts.external-search",                 // B19-E E6 — Tier 0 read of 1-5 exact MPNs at the registered distributors through the server's injected port: cache first, live only where the source's terms permit disclosure and the server allows it, at most 5 live MPNs per run within the agent's 25% quota share (OD-40); labels only today (OD-36); never places, binds, publishes or buys
  "sirkit.pcb-sync.preflight",                    // [PR-D d2, 2026-10-16] read: what the editor's Prepare PCB decides BEFORE its first server call, through the SAME listUnresolvedInstances / refusal sentence / row texts and bind filter the editor runs (app/lib/pcb-sync/preflight-read.ts), over the run's verified schematic snapshot and without a board (the editor's own run is board-less); the server stages (bindings, publication, the durable preflight and its blockers) travel as not-run data - not checked is not a pass; nothing bound, published or applied; withheld from MCP (mcp-exposure-review.ts)
  "sirkit.pcb.board-inspect", "sirkit.pcb.board-page-inspect", // [B24-D2, 2026-10-09] board-page-inspect - read (OD-213): ONE layer, net or region of board-inspect's own snapshot, a page at a time within the model's result budget, because board-inspect's whole snapshot does not fit on a routed board; no fact board-inspect does not already state; withheld from MCP (mcp-exposure-review.ts)
  "sirkit.pcb.mechanical-inspect",                // B18-E E11 — read: the board's extents and its mounting holes ONLY, because the full snapshot exceeds the model's result budget on a real board (scenario 3 could not otherwise be planned); no geometry the full snapshot did not already state
  "sirkit.pcb.via-inspect",                       // B18-E E13 — read: the vias on ONE named net with their padstack binding, plus the board's via padstack library. Vias exist only on a routed board, whose full snapshot does not fit; and the binding (which decides whether a size/drill change is possible at all) was in no agent-visible surface, so a via proposal could only discover it by being refused
  "sirkit.pcb.move-footprint",                    // B18-C I3 — the first reviewed granted execution (server-minted one-shot grant: a preview to confirm, or the exact requested move)
  "sirkit.pcb.rotate-side-footprint",             // B18-C I5 — reviewed granted execution (absolute rotation / board side; explicit rotate and flip grammar)
  "sirkit.pcb.arrange",                           // B18-C I5 — reviewed granted execution (align / distribute / snap-to-grid; confirmation-only)
  "sirkit.pcb.silkscreen-text",                   // B18-C I6 — reviewed granted execution (silkscreen TEXT only; confirmation-only)
  "sirkit.pcb.dimension",                         // B18-C I7 — reviewed granted execution (dimension annotations; re-tiered Tier 1 per OD-13; confirmation-only)
  "sirkit.pcb.undo-redo-granted",                 // B18-C I8 — reviewed granted execution (undo / redo of the assistant's own latest change; grant-only)
  "sirkit.pcb.propose-bounded-edit",              // B15.3 — sealed bounded PCB proposal
  "sirkit.pcb.revision-inspect",
  "sirkit.placement.propose",                     // B17-F — the shared revision-bound layout candidate (human applies it in the placement panel)
  "sirkit.project.canonical-revision-inspect",
  "sirkit.project.history-inspect",               // B17-F — the project operation timeline (read-only)
  "sirkit.routing.propose",                       // B17-F — the shared revision-bound routing candidate (human applies it in the routing panel)
  "sirkit.schematic.generate-proposal", "sirkit.generation.task-inspect", "sirkit.generation.task-control", // [PR-L, 2026-10-18] runbook L.5 (reviewed): generate-proposal 2.0.0 - propose: starts or ATTACHES the project's DURABLE generation task through the SAME GenerationTaskService.start the Build composer's POST /api/generation-tasks calls (the chat route's injected port, app/api/chat/schematic-generation-runtime.ts), answering the task reference at once (the design runs in a generation worker in saved slices; the turn's deadline and Stop answer never stop it); task-inspect - Tier 0 read of the task's public snapshot and a bounded result summary (never the prompt, conversation, tool outputs, reasoning or netlist); task-control - a sealed cancel / pause / resume / retry-block request the human confirms on a chip (OD-252 item 6; the control route runs under the human's authorization); all three advertised only with the server's generation fact (a durable task store and a servable provider) and a validated schematic, withheld from MCP (mcp-exposure-review.ts). [PR-D, 2026-10-16] OD-243 (1.0.0, superseded) - the in-turn runBuildMultiGeneration sealed as a proposal; removed from the agent tool by L.5.
  "sirkit.schematic.inspect",
  "sirkit.schematic.propose-component-replacement", // B14 — sealed replacement proposal
  "sirkit.schematic.propose-tier1-edit",
  "sirkit.selection.control",                     // B17-F — view-session selection/highlight commands
  "sirkit.selection.inspect",                     // B10
  "sirkit.stackup.propose",                       // [PR-F fE, 2026-10-17] propose: a sealed stackup / via-policy RECOMMENDATION (sirkit.stackup-candidate.v1) over the verified board, chosen only among the tree's stackup profiles, two- and four-layer manufacturing presets and via padstacks (app/lib/pcb/candidates/stackup-candidate.ts); physical and routable signal layer counts apart, release qualification per preset, via minima per padstack, a layer-count or profile change marked as invalidating dependent approvals with the rules cited; blind / buried / micro / via-in-pad / stacked vias, materials, impedance and other layer counts refused as proposal-blocked data ("unsupported until the complete chain is proven"); nothing applied - the human changes the stackup in the PCB editor; withheld from MCP (mcp-exposure-review.ts)
  "sirkit.validation.connectivity-verify",
  "sirkit.validation.drc-run",
  "sirkit.view.canvas-navigation",                // B17-F — fit/zoom/pan/focus + open editor tab (view-session)
  "sirkit.view.layers",                           // B17-F — layer visibility / active layer / grid (view-session)
  "sirkit.view.measure",                          // B17-F — measure between stable objects; never a dimension (view-session)
  "sirkit.view.pcb3d",                            // B17-F — 3D camera / focus / scene layers (view-session)
  "sirkit.view.read-state",                       // B17-F — read-only view state of every open editor
  "sirkit.view.reveal-finding",                   // B17-F — reveal a DRC/routing finding (view-session)
  "sirkit.computation.analytical-equation", "sirkit.computation.artifact-compare", "sirkit.computation.artifact-parse", /* [PR-M, 2026-10-17] section M (reviewed): instance-inspect - Tier 0 read of schematic instances WITHOUT a PCB (stable ids, catalog-symbol pins and their functions, nets, polarity, published-link status) over the verified schematic and the bound catalog port; candidate-search - Tier 0 read of the LOCAL catalog by requirements (the Build loop's own recall behind the chat route's search port, every hit re-read from the catalog and the published evidence and bucketed eligible / draft / missing-asset / withdrawn / incompatible / unresolved), at most 3 per run, no distributor; propose-component-resolution - a sealed Tier 2 BATCH binding unresolved instances to eligible published revisions with proved pin mappings, applied only by the human's reviewed schematic.resolve-components; all three withheld from MCP (mcp-exposure-review.ts) */ "sirkit.parts.candidate-search", "sirkit.schematic.instance-inspect", "sirkit.schematic.propose-component-resolution", /* [PR-M, 2026-10-18] section M2 (reviewed): acquisition-start - starts (or attaches to) the durable schematic-scoped CAD acquisition task (a verified schematic, the server's acquisition fact, no board); the worker reads only ADMITTED CAD sources, stores, parses and validates; NOTHING in the design changes and the agent can never send for review, approve or publish; acquisition-status - Tier 0 read of that task's public view; both withheld from MCP (mcp-exposure-review.ts) */ "sirkit.parts.acquisition-start", "sirkit.parts.acquisition-status"].sort()); // B22-B — three Tier 0 named computations (OD-139), run in the bounded engine host (a worker thread stopped hard at its budget) behind the server's computation fact, evidence never authority, withheld from MCP, dormant for specialists: analytical-equation, an approved closed-form microcase of the unreviewed analytical reference provider from bounded numbers; artifact-compare, the quantities of two results this run holds, named by digest; artifact-parse, a closed parser over one bounded server-held artifact named by digest (the run's canonical board or a held result), never a path or a URL

/** [B18-C review U1] defined in `granted-execution-families.ts` (a runtime key on every lift); re-exported for the gates. */
export { NEVER_EXPOSED_TOOL_PATTERNS };

export interface AgentExposureReport {
  ok: boolean;
  expected: readonly string[];
  actual: readonly string[];
  missing: string[];
  unexpected: string[];
  classViolations: string[];
  /** [B18-C] granted executions: every reviewed id exposed with zero violations, every exposed mutate in the list, no
   *  exposed tool bound to a never-granted command, no stray `executionMode`. */
  executionViolations: string[];
  count: number;
}

/** Compare the registry's ACTUAL exposure with the intentional set (both derived, nothing hard-coded). */
export function agentExposureReport(registry: ToolRegistry): AgentExposureReport {
  const exposed = registry.list().filter((descriptor) => descriptor.agentExposed);
  const actual = exposed.map((descriptor) => descriptor.toolId).sort();
  const expected = INTENTIONAL_AGENT_EXPOSED_TOOL_IDS;
  const missing = expected.filter((id) => !actual.includes(id));
  const unexpected = actual.filter((id) => !expected.includes(id));
  const classViolations = exposed
    .filter((descriptor) => !isAgentExposableDescriptor(descriptor) || NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(descriptor.toolId)))
    .map((descriptor) => `${descriptor.toolId} (${descriptor.operationClass})`);
  const executionViolations = grantedExecutionReport(registry.list());
  return { ok: missing.length === 0 && unexpected.length === 0 && classViolations.length === 0 && executionViolations.length === 0 && registry.coverageReport().agentExposedCount === expected.length, expected, actual, missing, unexpected, classViolations, executionViolations, count: actual.length };
}

/** [B18-C] the granted-execution side of the report (derived from the reviewed list, never a count). */
export function grantedExecutionReport(descriptors: readonly ToolDescriptor[]): string[] {
  const violations: string[] = [];
  for (const id of GRANTED_EXECUTION_TOOL_IDS) {
    const descriptor = descriptors.find((item) => item.toolId === id && item.lifecycle === "active");
    if (!descriptor) { violations.push(`${id}: in the granted-execution list but not registered`); continue; }
    if (!descriptor.agentExposed) violations.push(`${id}: in the granted-execution list but not exposed`);
    for (const violation of grantedExecutionViolations(descriptor)) violations.push(`${id}: ${violation}`);
    if (!INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.includes(id)) violations.push(`${id}: granted but not in the intentional exposure list`);
  }
  for (const descriptor of descriptors) {
    if (descriptor.agentExposed && descriptor.operationClass === "mutate" && !GRANTED_EXECUTION_TOOL_IDS.includes(descriptor.toolId)) violations.push(`${descriptor.toolId}: an exposed mutate tool outside the granted-execution list`);
    if (descriptor.executionMode !== undefined && !GRANTED_EXECUTION_TOOL_IDS.includes(descriptor.toolId)) violations.push(`${descriptor.toolId}: carries executionMode outside the granted-execution list`);
    if (descriptor.agentExposed && descriptor.binding.canonicalCommandId && NEVER_GRANTED_COMMAND_IDS.includes(descriptor.binding.canonicalCommandId)) violations.push(`${descriptor.toolId}: exposed while bound to the never-granted command ${descriptor.binding.canonicalCommandId}`);
  }
  return violations;
}
