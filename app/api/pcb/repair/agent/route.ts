import type { PcbBoard } from "@/app/lib/pcb/types";
import { createHistory } from "@/app/lib/pcb/history";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import type { DrcPresetId } from "@/app/lib/pcb/drc/types";
import { PCBToolService } from "@/app/lib/pcb/ai/pcb-tool-service";
import { PCB_AI_TOOLS } from "@/app/lib/pcb/ai/pcb-tool-schemas";
import { llmRouter } from "@/app/lib/llm/router";
import { requestedProvider } from "@/app/lib/llm/request";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { assistantResponseMessage, toolResultsMessage, type LLMMessage } from "@/app/lib/llm/types";
import type { PCBRepairPlan } from "@/app/lib/pcb/repair/types";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";

export const runtime = "nodejs";

const ALLOWED_TOOLS = new Set([
  "get_board_summary",
  "get_board_snapshot",
  "get_footprint",
  "get_net",
  "get_track",
  "get_via",
  "get_zone",
  "get_rule",
  "get_manufacturer_profile",
  "get_schematic_connectivity",
  "run_drc",
  "get_violation",
  "explain_constraint",
  "get_stackup",
  "get_layer_state",
  "get_layer_usage",
  "get_unrouted_connections",
  "get_congestion_map",
  "get_pad_access_report",
  "analyze_routeability",
  "verify_connectivity",
  "classify_drc_violations",
  "plan_drc_repairs",
]);

const SYSTEM = `You are Sirkit's engine-grounded PCB repair planner. You never invent geometry and never weaken rules. Inspect exact native board state using tools, run DRC, group violations by root cause, and call plan_drc_repairs. The PCB snapshot's PCB_FABRICATION_CHECKS report is the only fabrication-readiness authority: preserve failed, unknown, stale, warning, and waiver states exactly. Never infer readiness from raw geometry, clean DRC, or zero airwires; never approve a waiver; and never describe fabrication checks as proof of circuit function or production qualification. Explain safe fixes separately from approval-required, schematic-change, and manual-review blockers. You may not apply changes in this server planning pass. OpenAI and Anthropic receive this identical prompt and tool contract.`;

function isBoard(value: unknown): value is PcbBoard {
  if (typeof value !== "object" || value === null) return false;
  const board = value as Record<string, unknown>;
  return (board.stackup === 2 || board.stackup === 4) && Array.isArray(board.nets) && Array.isArray(board.footprints) && Array.isArray(board.tracks) && Array.isArray(board.vias) && Array.isArray(board.zones);
}

function isNetlist(value: unknown): value is PcbNetlist {
  return typeof value === "object" && value !== null && Array.isArray((value as PcbNetlist).components) && Array.isArray((value as PcbNetlist).nets);
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof raw !== "object" || raw === null) return Response.json({ ok: false, error: "body must be an object" }, { status: 400 });
  const body = raw as Record<string, unknown>;
  if (!isBoard(body.board)) return Response.json({ ok: false, error: "board must be a PcbBoard" }, { status: 400 });
  const instruction = typeof body.instruction === "string" && body.instruction.trim() ? body.instruction.trim().slice(0, 500) : "Inspect the PCB and plan safe repairs.";
  const presetId: DrcPresetId = typeof body.presetId === "string" && ["jlcpcb-2l", "jlcpcb-4l", "pcbway-standard", "oshpark-4l"].includes(body.presetId)
    ? body.presetId as DrcPresetId
    : body.board.stackup === 4 ? "jlcpcb-4l" : "jlcpcb-2l";
  const provider = requestedProvider(body.provider);
  const history = createHistory(body.board);
  const service = new PCBToolService({
    history,
    rules: getPreset(presetId).rules,
    projectId: typeof body.projectId === "string" ? body.projectId : "local-project",
    schematicRevisionId: typeof body.schematicRevisionId === "string" ? body.schematicRevisionId : "unknown",
    netlist: isNetlist(body.netlist) ? body.netlist : undefined,
    schematicConnectivity: body.schematicConnectivity,
  });
  const snapshot = (await service.inspectBoard()).snapshot;
  const messages: LLMMessage[] = [{ role: "user", content: instruction }];
  let plan: PCBRepairPlan | undefined;
  try {
    for (let iteration = 0; iteration < 8; iteration++) {
      const response = await llmRouter.generate({
        provider,
        messages,
        system: SYSTEM,
        tools: PCB_AI_TOOLS.filter((tool) => ALLOWED_TOOLS.has(tool.name)),
        toolChoice: "auto",
        temperature: 0,
        maxTokens: 3000,
        boardState: snapshot,
        schematicState: body.schematicConnectivity,
        designConstraints: { presetId, ruleWeakeningAllowed: false },
        userRequest: instruction,
      });
      if (response.toolCalls.length === 0) {
        if (!plan) plan = await service.planRepairs();
        return Response.json({ ok: true, provider, text: response.text, plan, snapshotRevisionId: snapshot.boardRevisionId });
      }
      messages.push(assistantResponseMessage(response));
      const results = [];
      for (const call of response.toolCalls) {
        if (!ALLOWED_TOOLS.has(call.name)) {
          results.push({ type: "tool_result" as const, toolCallId: call.id, output: "Tool is not allowed in planning mode.", isError: true });
          continue;
        }
        try {
          const output = await service.call(call.name, call.input);
          if (call.name === "plan_drc_repairs") plan = output as PCBRepairPlan;
          results.push({ type: "tool_result" as const, toolCallId: call.id, output: JSON.stringify(output) });
        } catch (error) {
          results.push({ type: "tool_result" as const, toolCallId: call.id, output: error instanceof Error ? error.message : String(error), isError: true });
        }
      }
      messages.push(toolResultsMessage(results));
    }
    if (!plan) plan = await service.planRepairs();
    return Response.json({ ok: true, provider, text: "Repair plan prepared from native PCB checks.", plan, snapshotRevisionId: snapshot.boardRevisionId });
  } catch (error) {
    return providerErrorResponse(error, provider);
  }
}
