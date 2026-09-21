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

/** The 9 bound reads B3 serves from durable server state and the 5 inert proposals (the agent set minus the 18 left out). */
export const INTENTIONAL_MCP_EXPOSED_TOOL_IDS: readonly string[] = Object.freeze([
  "sirkit.component-authority.inspect",           // read: the server-owned component authority records (B13); inspection, never a binding
  "sirkit.manufacturing.readiness-inspect",       // read: a fabrication readiness REPORT (Tier 0); never qualifies, never authorizes a release
  "sirkit.pcb.board-inspect",                     // read: the canonical board snapshot (B05 read binding)
  "sirkit.pcb.mechanical-inspect",                // read: the board's extents and mounting holes only (B18-E E11)
  "sirkit.pcb.propose-bounded-edit",              // propose: a sealed bounded PCB proposal; a human approves it in the PCB editor (B15.3)
  "sirkit.pcb.revision-inspect",                  // read: the pcb2 semantic content revision of the board
  "sirkit.pcb.via-inspect",                       // read: one net's vias with their padstack binding (B18-E E13)
  "sirkit.placement.propose",                     // propose: a revision-bound layout candidate a human applies (B17-F)
  "sirkit.project.canonical-revision-inspect",    // read: the canonical ProjectRevision digest set
  "sirkit.routing.propose",                       // propose: a revision-bound routing candidate a human applies (B17-F)
  "sirkit.schematic.propose-component-replacement", // propose: a sealed exact-replacement proposal; apply stays human-only (B14)
  "sirkit.schematic.propose-tier1-edit",          // propose: a sealed tier-1 schematic proposal; apply stays human-only (B09)
  "sirkit.validation.connectivity-verify",        // read: board connectivity, a validation read (not fabrication readiness by itself)
  "sirkit.validation.drc-run",                    // read: a DRC run over the canonical board, a validation read (derived cache only)
].sort());

/**
 * Admissible ids withheld from MCP by a reviewed decision, one reason comment per id (sorted). [B20 B3] OD-69: the two reads
 * whose only input is browser-only state, so no durable server source can serve them (each descriptor is unchanged; restoring
 * one needs an owner decision and a durable source for its state).
 */
export const MCP_WITHHELD_TOOL_IDS: readonly string[] = Object.freeze([
  "sirkit.project.history-inspect",               // B3 (OD-69): bound to the browser's captured project timeline; no durable history source serves it
  "sirkit.schematic.inspect",                     // B3 (OD-69): the editor's SchematicState lives in browser storage; no durable table holds it (F4)
].sort());
