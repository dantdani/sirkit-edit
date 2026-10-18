/**
 * [B20 B1] THE reviewed MCP decision: which of the registry tools the structural rule admits (`mcp-exposure.ts`) are
 * exposed to an MCP principal, and which are withheld. Exposure needs BOTH: the rule admits the descriptor AND its id is
 * listed here as exposed and not withheld. So a descriptor never becomes MCP-exposed by joining the agent set: an admissible
 * id that is neither listed nor withheld is refused (`not_mcp_reviewed`) and reported as drift until it is reviewed here.
 *
 * This file is what a reviewed ratchet move of the MCP subset edits, together with the pins of the B1 suites and the
 * regenerated manifest. Adding an id is a reviewed change with its reason. REMOVING one (B3 or B4, for an id they cannot
 * serve safely) moves it from the exposed list to the withheld list with its reason: the descriptor, the registry digest and
 * the agent path stay untouched.
 */

/** The 9 bound reads B3 serves from durable server state (the agent set minus the 23 left out); [B20 B4] no proposal (OD-82). */
export const INTENTIONAL_MCP_EXPOSED_TOOL_IDS: readonly string[] = Object.freeze([
  "sirkit.component-authority.inspect",           // read: the server-owned component authority records (B13); inspection, never a binding
  "sirkit.manufacturing.readiness-inspect",       // read: a fabrication readiness REPORT (Tier 0); never qualifies, never authorizes a release
  "sirkit.pcb.board-inspect",                     // read: the canonical board snapshot (B05 read binding)
  "sirkit.pcb.mechanical-inspect",                // read: the board's extents and mounting holes only (B18-E E11)
  "sirkit.pcb.revision-inspect",                  // read: the pcb2 semantic content revision of the board
  "sirkit.pcb.via-inspect",                       // read: one net's vias with their padstack binding (B18-E E13)
  "sirkit.project.canonical-revision-inspect",    // read: the canonical ProjectRevision digest set
  "sirkit.validation.connectivity-verify",        // read: board connectivity, a validation read (not fabrication readiness by itself)
  "sirkit.validation.drc-run",                    // read: a DRC run over the canonical board, a validation read (derived cache only)
].sort());

/**
 * Admissible ids withheld from MCP by a reviewed decision, one reason comment per id (sorted). [B20 B3] OD-69: the two reads
 * whose only input is browser-only state, so no durable server source can serve them (each descriptor is unchanged; restoring
 * one needs an owner decision and a durable source for its state). [B20 B4] OD-82 / OD-87: all five proposals, so MCP exposure
 * is read-only in B20; restoring one needs an owner decision, a serving path and, for placement, a bounded engine host. [B24-D2, 2026-10-09] OD-235: a third category, B24-D2's paged board read - servable from durable state, withheld by choice (paged answers were never reviewed for MCP clients, OD-48, OD-54); restoring it needs an owner decision.
 */
export const MCP_WITHHELD_TOOL_IDS: readonly string[] = Object.freeze([
  "sirkit.pcb.propose-bounded-edit",              // B4 (OD-82): seals the open editor's history head, lineage and DRC preset; no durable source holds them and apply re-verifies them against the live editor
  "sirkit.placement.propose",                     // B4 (OD-87): its engine blocks the event loop and cannot be stopped inside a spec (measured, mcp-server-proposals.md); served only once a bounded engine host with kill semantics exists
  "sirkit.project.history-inspect",               // B3 (OD-69): bound to the browser's captured project timeline; no durable history source serves it
  "sirkit.routing.propose",                       // B4 (OD-82): its engine is the FreeRouting child process, and an MCP call may not start a process (b20-b4-process-gate)
  "sirkit.schematic.inspect",                     // B3 (OD-69): the editor's SchematicState lives in browser storage; no durable table holds it (F4)
  "sirkit.schematic.propose-component-replacement", // B4 (OD-82): compiles against the editor's SchematicState and head mark, which are browser-only (as B3's OD-69)
  "sirkit.schematic.propose-tier1-edit",          // B4 (OD-82): compiles against the editor's SchematicState and head mark, which are browser-only (as B3's OD-69)
  "sirkit.pcb.board-page-inspect",                // B24-D2 (OD-235): a choice, not an inability - it is servable from the durable board, but paged answers and their cursors were never reviewed for MCP clients (OD-48, OD-54)
  "sirkit.schematic.generate-proposal",           // PR-D (OD-243): seals against the editor's SchematicState and head mark, which are browser-only (as B4's OD-82); [PR-L, 2026-10-18] since 2.0.0 it starts a durable design task that spends provider credits in a worker - a proposal-class start MCP exposure does not allow (read-only, OD-82), and the MCP server binds no generation-task port
  "sirkit.pcb-sync.preflight",                    // PR-D d2: its only input is the editor's SchematicState, which lives in browser storage; no durable table holds it (as B3's OD-69 reads)
  "sirkit.parts.catalog-inspect",                 // PR-D d2: a choice, not an inability - servable from the catalog tables in principle (as OD-235's read), but the MCP server binds no catalog port and its catalog reads were never reviewed for MCP clients; restoring it needs an owner decision and a served port
  "sirkit.parts.missing-facts",                   // PR-F fB (2026-10-17): its only input is the editor's SchematicState, which lives in browser storage (as OD-244's preflight read); the catalog facts ride the chat route's injected port, which the MCP server does not bind
  "sirkit.parts.draft-request",                   // PR-F fB (2026-10-17): seals against the editor's SchematicState (the unresolved instance it names), which is browser-only (as B4's OD-82 proposals); and MCP exposure stays read-only (OD-82)
  "sirkit.module.propose-contracts",              // PR-F fD (2026-10-17): validates against the editor's SchematicState and seals its canonical head mark, both browser-only (as B4's OD-82 proposals); MCP exposure stays read-only (OD-82); the sealed note is shown in the chat run log, which no MCP client has
  "sirkit.stackup.propose",                       // PR-F fE (2026-10-17): a proposal, and MCP exposure stays read-only (B4, OD-82); it seals against the run's verified board revision and the active DRC preset of the editor's run context, which no durable MCP source carries
  "sirkit.schematic.instance-inspect",             // PR-M (2026-10-17): its input is the editor's SchematicState, which lives in browser storage (as OD-244's preflight read); the catalog facts ride the chat route's injected port, which the MCP server does not bind
  "sirkit.parts.candidate-search",                // PR-M (2026-10-17): a choice, not an inability for the catalog half - but the MCP server binds no catalog, search or revision evidence port and its embedding-backed search was never reviewed for MCP clients (as OD-235's catalog read)
  "sirkit.schematic.propose-component-resolution", // PR-M (2026-10-17): a proposal, and MCP exposure stays read-only (B4, OD-82); it seals against the editor's browser-only SchematicState and head mark
  "sirkit.generation.task-inspect",               // PR-L (2026-10-18, runbook L.5): a choice - the MCP server binds no generation-task port and a task's live state was never reviewed for MCP clients; the chat and the page read it
  "sirkit.generation.task-control",               // PR-L (2026-10-18, runbook L.5): a proposal (a confirm chip only the page shows), and MCP exposure stays read-only (B4, OD-82)
  "sirkit.parts.acquisition-start",               // PR-M M2 (2026-10-18): it starts a durable task from the editor's browser-only SchematicState (as OD-244's reads) and MCP exposure stays read-only (B4, OD-82)
  "sirkit.parts.acquisition-status",              // PR-M M2 (2026-10-18): a choice - the MCP server binds no component-resolution task port and a task's live state was never reviewed for MCP clients (as the generation task-inspect)
].sort());
