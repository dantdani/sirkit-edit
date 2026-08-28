/**
 * B10 — deterministic runtime-tool-availability matrix generator:
 * artifacts/ai-control-plane-b10/runtime-tool-availability.csv
 *
 * Each row is computed from the REAL runtime (assembleAgentRunContext +
 * buildRunToolset over the production registry) — never hand-authored.
 * Byte-stable across runs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicState } from "../lib/schematic-types";
import { assembleAgentRunContext } from "../app/lib/agent/context";
import { buildRunToolset } from "../app/lib/agent/loop";
import { sirkitToolRegistry } from "../app/lib/engineering/tool-catalog";
import { schematicStateDigest } from "../app/lib/engineering/schematic-model";
import { createEmptyBoard, type PcbBoard } from "../app/lib/pcb/types";
import { projectAgentNetlist, type AgentNetlistProjection } from "../app/lib/agent/netlist-validation";
import { buildNetlist } from "../app/lib/pcb/netlist-bridge";

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const MARK = { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" };
const SCOPE = { tenantId: "local", projectId: "p10", branchId: "main" };

function boardWithTrack(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
  board.tracks.push({ id: "t1", layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 3_000_000 }, end: { x: 5_000_000, y: 3_000_000 }, netId: 1, source: "human" });
  board.vias.push({ id: "v1", at: { x: 3_000_000, y: 3_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] });
  return board;
}

function validNetlist(): AgentNetlistProjection {
  // [B10.2] fixtures are derived through the production netlist authority.
  return projectAgentNetlist(buildNetlist(SCHEMATIC));
}

function contextOf(input: Record<string, unknown>): ReturnType<typeof buildRunToolset> {
  const assembly = assembleAgentRunContext({ ...SCOPE, ...input });
  if (!assembly.ok) throw new Error(assembly.reason);
  return buildRunToolset(sirkitToolRegistry(), assembly.context, () => undefined);
}

const digest = schematicStateDigest(SCHEMATIC);
const CASES: Array<{ id: string; description: string; input: Record<string, unknown> }> = [
  { id: "no-board-no-mark", description: "no board, no schematic, no head mark", input: {} },
  { id: "schematic+mark-no-board", description: "valid schematic + valid head mark, no board", input: { schematic: SCHEMATIC, schematicHeadMark: MARK } },
  { id: "board+schematic+mark+selection", description: "valid board + schematic + head mark + selection", input: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK, selection: { refs: [{ kind: "track", id: "t1" }], primary: null } } },
  { id: "board+schematic-no-mark", description: "valid board + schematic + selection, no head mark", input: { schematic: SCHEMATIC, board: boardWithTrack(), selection: { refs: [], primary: null } } },
  { id: "board-no-schematic", description: "valid board + selection, no schematic", input: { board: boardWithTrack(), selection: { refs: [], primary: null } } },
  { id: "board+invalid-netlist", description: "valid board + schematic + INVALID netlist (withheld; readiness parity not evaluated)", input: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK, netlist: { components: "x", nets: [] }, editorSchematicDigest: digest } },
  { id: "no-selection-resource", description: "valid board + schematic + head mark, NO selection resource", input: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK } },
  { id: "no-component-authority-resource", description: "full context (board + schematic + mark + selection + valid netlist) — component-authority.inspect still absent (no proven producer)", input: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK, selection: { refs: [], primary: null }, netlist: validNetlist(), editorSchematicDigest: digest } },
];

const outDir = join(process.cwd(), "artifacts", "ai-control-plane-b10");
mkdirSync(outDir, { recursive: true });
const rows = CASES.map(({ id, description, input }) => {
  const tools = contextOf(input).declarations.map((declaration) => declaration.toolId).sort().join(";");
  return `${id},${tools === "" ? "(none)" : tools},"${description}"`;
});
writeFileSync(join(outDir, "runtime-tool-availability.csv"), ["case_id,advertised_tools,description", ...rows].join("\n") + "\n");
console.log(`Wrote ${rows.length} runtime availability cases to ${outDir}`);
