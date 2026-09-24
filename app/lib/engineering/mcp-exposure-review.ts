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
 * is read-only in B20; restoring one needs an owner decision, a serving path and, for placement, a bounded engine host.
 */
export const MCP_WITHHELD_TOOL_IDS: readonly string[] = Object.freeze([
  "sirkit.pcb.propose-bounded-edit",              // B4 (OD-82): seals the open editor's history head, lineage and DRC preset; no durable source holds them and apply re-verifies them against the live editor
  "sirkit.placement.propose",                     // B4 (OD-87): its engine blocks the event loop and cannot be stopped inside a spec (measured, mcp-server-proposals.md); served only once a bounded engine host with kill semantics exists
  "sirkit.project.history-inspect",               // B3 (OD-69): bound to the browser's captured project timeline; no durable history source serves it
  "sirkit.routing.propose",                       // B4 (OD-82): its engine is the FreeRouting child process, and an MCP call may not start a process (b20-b4-process-gate)
  "sirkit.schematic.inspect",                     // B3 (OD-69): the editor's SchematicState lives in browser storage; no durable table holds it (F4)
  "sirkit.schematic.propose-component-replacement", // B4 (OD-82): compiles against the editor's SchematicState and head mark, which are browser-only (as B3's OD-69)
  "sirkit.schematic.propose-tier1-edit",          // B4 (OD-82): compiles against the editor's SchematicState and head mark, which are browser-only (as B3's OD-69)
].sort());
