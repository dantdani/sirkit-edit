/**
 * [B21 E1] The result-tool protocol for the scripted doubles of the B21 suites (not a test file). Since B21-E1 a specialist answers
 * through ONE strict function tool, `sirkit_specialist_result` (OD-116): its adapter is handed the run's registry tools plus that
 * synthetic declaration, and a turn that ends without calling it is `malformed` (`result_tool_not_called`) - the B-era "parse the
 * final text as JSON" path is gone. A double that scripts a result document therefore answers THROUGH the tool whenever the tool is
 * offered (a specialist run; the coordinator's turns are never offered it) and with plain text otherwise, and it records the tools it
 * was offered WITHOUT the synthetic declaration, so an assertion about a role's advertised registry tools keeps its meaning - any
 * other declaration outside the registry would still be recorded. `offeredResultTool` says whether the declaration was there.
 */
import type { AgentStep, AgentToolCall } from "@/app/lib/agent/contracts";
import { SPECIALIST_RESULT_TOOL_NAME } from "../result-tool";

type Offered = ReadonlyArray<{ toolId: string; providerName: string }>;

/** Whether the run offered the synthetic result tool (by its provider name: the only thing a provider sees). */
export function offeredResultTool(tools: ReadonlyArray<{ providerName: string }>): boolean {
  return tools.some((tool) => tool.providerName === SPECIALIST_RESULT_TOOL_NAME);
}
/** The offered tool ids without the synthetic result tool: what the role's registry view advertised. */
export function registryToolIds(tools: Offered): string[] {
  return tools.filter((tool) => tool.providerName !== SPECIALIST_RESULT_TOOL_NAME).map((tool) => tool.toolId);
}
/** One call of the result tool whose arguments are `argumentsText` (a scripted document, verbatim). */
export function resultCall(argumentsText: string, callId = "call-specialist-result"): AgentToolCall {
  return { callId, providerName: SPECIALIST_RESULT_TOOL_NAME, argumentsText };
}
/** A double's closing step: through the result tool when the run offers it, else the plain text (a coordinator turn). */
export function answer(text: string, tools: ReadonlyArray<{ providerName: string }>): Partial<AgentStep> {
  return offeredResultTool(tools) ? { text: "", toolCalls: [resultCall(text)], stopReason: "tool_use" } : { text, toolCalls: [] };
}
